/* Reconciliation-Fälle aus docs/02 als Unit-Tests (ADR-015) —
   die ersten Tests des Projekts. Jeder Test bildet eine Zeile der
   Konflikt-Tabelle bzw. des Timeout-Handlings ab. */

import { describe, it, expect } from 'vitest';
import {
  mergedValue, applyIntent, reconcile, markTimeouts, COMMAND_TIMEOUT_MS,
  subsetMatch, mergePatch,
} from './overlay.ts';
import type { EntityState, Intent } from './types.ts';

const T0 = 1_000_000;

function server(value: boolean): EntityState<boolean> {
  return { entityId: 'light.wohnzimmer_deckenlicht', value, updatedAt: T0, stale: false };
}

describe('Optimistic Overlay — gemergte Sicht', () => {
  it('ohne Intent zählt die Server-Wahrheit', () => {
    expect(mergedValue(server(false), undefined)).toBe(false);
  });

  it('pending Intent überlagert den Server-State (Touch → UI sofort)', () => {
    const intents = applyIntent<boolean>([], 'light.wohnzimmer_deckenlicht', true, T0);
    expect(mergedValue(server(false), intents[0])).toBe(true);
  });

  it('ohne Server-State (offline, kein Cache) liefert der Merge undefined', () => {
    expect(mergedValue(undefined, undefined)).toBeUndefined();
  });

  it('neuer Intent derselben Entität ersetzt den alten (letzter Touch gewinnt)', () => {
    let intents = applyIntent<boolean>([], 'light.a', true, T0);
    intents = applyIntent(intents, 'light.a', false, T0 + 100);
    expect(intents).toHaveLength(1);
    expect(intents[0].value).toBe(false);
    expect(intents[0].sentAt).toBe(T0 + 100);
  });
});

describe('Reconciliation (docs/02 Konflikt-Typen)', () => {
  const pending: Intent<boolean>[] = [
    { entityId: 'light.a', value: true, sentAt: T0, status: 'inflight' },
  ];

  it('HA bestätigt → Intent weg, keine Aktion', () => {
    const { intents, outcome } = reconcile(pending, { entityId: 'light.a', value: true });
    expect(outcome).toBe('confirmed');
    expect(intents).toHaveLength(0);
  });

  it('HA widerspricht → Intent weg, Zurückspringen (reverted-Indikator)', () => {
    const { intents, outcome } = reconcile(pending, { entityId: 'light.a', value: false });
    expect(outcome).toBe('contradicted');
    expect(intents).toHaveLength(0);
    // UI liest danach wieder die Server-Wahrheit
    expect(mergedValue(server(false), intents.find((i) => i.entityId === 'light.a'))).toBe(false);
  });

  it('State-Änderung von anderem Client → external, eigene Intents unberührt', () => {
    const { intents, outcome } = reconcile(pending, { entityId: 'light.b', value: true });
    expect(outcome).toBe('external');
    expect(intents).toEqual(pending);
  });
});

describe('Patch-Merge + Subset-Match (ADR-017 Addendum: media_player durch den Seam)', () => {
  // Server-Wahrheit eines media_player: optimistische + Metadaten-Felder gemischt.
  const server = {
    playing: true, volume: 45, source: 'Spotify',
    available: true, track: 'Weightless', artist: 'Marconi Union', duration: 485,
  };

  it('Teil-Patch überlagert nur seine Felder; Metadaten fließen durch', () => {
    // Optimistisches Pause: nur { playing } — track/artist bleiben Server-Wahrheit
    expect(mergePatch(server, { playing: false })).toEqual({ ...server, playing: false });
  });

  it('voller Wert (Licht/Klima) ersetzt deckungsgleich', () => {
    expect(mergePatch({ on: true, brightness: 75 }, { on: false, brightness: 75 }))
      .toEqual({ on: false, brightness: 75 });
  });

  it('Subset-Match ignoriert nicht behauptete Felder (Volume-Push bestätigt Play-Intent nicht fälschlich)', () => {
    // Intent behauptet nur playing:false → bestätigt, obwohl volume/track abweichen
    expect(subsetMatch({ playing: false }, { ...server, playing: false, volume: 12 })).toBe(true);
    // Widerspruch nur, wenn ein behauptetes Feld abweicht
    expect(subsetMatch({ playing: false }, server)).toBe(false);
  });

  it('reconcile mit Subset-Comparator: Metadaten-Abweichung widerspricht dem Patch nicht', () => {
    const intents: Intent[] = [{ entityId: 'media_player.wohnzimmer', value: { volume: 50 }, sentAt: T0, status: 'inflight' }];
    // Server bestätigt volume:50, hat aber inzwischen andere position/track — egal
    const { outcome } = reconcile(
      intents,
      { entityId: 'media_player.wohnzimmer', value: { ...server, volume: 50, track: 'Anderer Titel' } },
      subsetMatch,
    );
    expect(outcome).toBe('confirmed');
  });

  it('Subset-Match bleibt für Primitive Object.is (Reconcile-Tests unberührt)', () => {
    expect(subsetMatch(true, true)).toBe(true);
    expect(subsetMatch(true, false)).toBe(false);
  });
});

describe('Timeout-Handling (docs/02: kein Dauer-Spinner, kein Auto-Retry)', () => {
  const sent: Intent<boolean>[] = [
    { entityId: 'light.a', value: true, sentAt: T0, status: 'inflight' },
    { entityId: 'light.b', value: false, sentAt: T0 + 3000, status: 'inflight' },
  ];

  it('nach 5 s wird der Intent pending — bleibt aber optimistisch sichtbar', () => {
    const after = markTimeouts(sent, T0 + COMMAND_TIMEOUT_MS);
    expect(after[0].status).toBe('pending');
    expect(after[1].status).toBe('inflight'); // erst 2 s alt
    // Der optimistische Wert steht weiterhin in der gemergten Sicht
    expect(mergedValue(server(false), after[0])).toBe(true);
  });

  it('vor der Schwelle bleibt alles inflight', () => {
    const after = markTimeouts(sent, T0 + COMMAND_TIMEOUT_MS - 1);
    expect(after.every((i) => i.status === 'inflight')).toBe(true);
  });

  it('späte Antwort nach Timeout reconciled normal (Timer cancel)', () => {
    const after = markTimeouts(sent, T0 + COMMAND_TIMEOUT_MS);
    const { intents, outcome } = reconcile(after, { entityId: 'light.a', value: true });
    expect(outcome).toBe('confirmed');
    expect(intents.find((i) => i.entityId === 'light.a')).toBeUndefined();
  });
});
