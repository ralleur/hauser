import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error Vitest läuft in Node; die App-Typen kennen dessen Globals bewusst nicht.
import { readFileSync } from 'node:fs';
import { loadRoomRegionsOnce, roomHasOvercast, roomRegions } from './room-regions.svelte.ts';
import { replaceRoomHeroConfigs } from './room-hero-config.svelte.ts';

/* Paket 13: Ein Haushalt ohne eigene Bilder soll dieselben Fenster haben wie
   einer mit. Die Flächen der mitgelieferten Bilder liegen deshalb als Datei
   bei — geprüft wird hier, dass sie greifen, wenn kein eigenes Bildset im
   Raum hängt, und dass ein eigenes Set weiterhin Vorrang hat. */

const mitgeliefert = JSON.parse(
  readFileSync(new URL('../../../public/hero/regions.json', import.meta.url), 'utf8'),
) as Record<string, { kind: string }[]>;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  replaceRoomHeroConfigs({});
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('hero/regions.json')) {
      return new Response(JSON.stringify(mitgeliefert), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Flächen der mitgelieferten Bilder', () => {
  it('liegen für jeden Raum bei, dessen Standardbild eine trübe Fassung hat', () => {
    expect(Object.keys(mitgeliefert).sort())
      .toEqual(['bad', 'kinderzimmer', 'kueche', 'schlafzimmer', 'wohnzimmer']);
    /* Ohne Fenster zöge im Standardbild kein Regen — bis auf das Bad, das
       keines hat, muss jeder Raum mindestens eines mitbringen. */
    for (const [room, regions] of Object.entries(mitgeliefert)) {
      if (room === 'bad') continue;
      expect(`${room}: ${regions.some((region) => region.kind === 'window')}`).toBe(`${room}: true`);
    }
  });

  it('greifen in einem Raum ohne eigenes Bildset', async () => {
    await loadRoomRegionsOnce();
    expect(roomRegions('wohnzimmer', 'window').length).toBe(
      mitgeliefert.wohnzimmer.filter((region) => region.kind === 'window').length,
    );
    /* Auch für einen Raum, den es im Standardsatz gar nicht gibt: Dort gilt
       das Wohnzimmer, also gelten auch dessen Fenster. */
    expect(roomRegions('garage', 'window').length).toBe(roomRegions('wohnzimmer', 'window').length);
  });

  it('melden die trübe Fassung des Standardbildes', () => {
    expect(roomHasOvercast('kueche')).toBe(true);
    expect(roomHasOvercast('flur')).toBe(false);
  });
});
