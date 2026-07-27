/* ============================================
   Raum-Audio durch den Adapter-Seam (ADR-017 Addendum). media_player ist der
   letzte steuerbare Rest: Play/Pause, Volume und Preset-Start (play_media) laufen
   über CommandQueue/Overlay — die UI liest die gemergte Sicht (mergedMedia) und
   dispatcht optimistisch, kennt aber weder EntityStore noch Backend.

   Shape-Trennung: optimistische Felder (playing/volume/source) werden per
   Intent-Patch überlagert; Server-Metadaten (track/artist/duration/available)
   fließen unverändert durch. `position` ist bewusst KEIN Entity-Feld, sondern
   lokale Simulation (1-Hz-Tick über die gemergte playing-Sicht) — so friert die
   Anzeige beim optimistischen Pause sofort ein und rührt die Reconciliation nie an.
   ============================================ */

import { SvelteMap } from 'svelte/reactivity';
import { runtime } from '../adapter/runtime.svelte.ts';
import { mediaEntityId } from './entities.ts';
import { MEDIA_SEED } from './app.svelte.ts';
import type { MediaValue, ReconcileEvent } from '../adapter/types.ts';

/* ── Lesen: gemergte Sicht ── */
export function mergedMedia(playerId: string): MediaValue {
  return runtime.merged(mediaEntityId(playerId)) as MediaValue;
}

export function mediaStateLabel(v: MediaValue): string {
  if (!v.available) return 'Nicht verfügbar';
  if (v.playing) return 'Läuft';
  if (v.track) return 'Pause';
  return 'Bereit';
}

export function mediaPending(playerId: string): boolean {
  return runtime.intentStatus(mediaEntityId(playerId)) === 'pending';
}

export function mediaReconcile(playerId: string): ReconcileEvent | null {
  return runtime.reconcileEvent(mediaEntityId(playerId));
}

/* ── Lokale Positions-Simulation (kein Entity-Feld, kein Backend-Push) ── */
const positions = new SvelteMap<string, number>(MEDIA_SEED.map((p) => [p.id, p.position]));

export function mediaPosition(playerId: string): number {
  return positions.get(playerId) ?? 0;
}

/* Position beim Titelwechsel/Skip auf 0 (optimistisch, wie der Track-Start). */
function resetPosition(playerId: string): void {
  positions.set(playerId, 0);
}

/* 1-Hz-Tick: zählt hoch, solange die GEMERGTE playing-Sicht wahr ist (docs/02:
   optimistisches Pause friert die Anzeige sofort ein). Kein Screen-Sichtbarkeits-
   Check nötig — Svelte updated nur die DOM-Knoten, die den Wert zeigen. */
setInterval(() => {
  for (const p of MEDIA_SEED) {
    const v = mergedMedia(p.id);
    if (!v?.available || !v.playing || !v.duration) continue;
    const next = (positions.get(p.id) ?? 0) + 1;
    positions.set(p.id, next >= v.duration ? 0 : next);
  }
}, 1000);

/* ── Schreiben: optimistischer Patch + Command (docs/02, docs/04) ── */
export function toggleMedia(playerId: string): void {
  const entityId = mediaEntityId(playerId);
  const cur = mergedMedia(playerId);
  // Nur das optimistische Feld als Patch — Metadaten bleiben Server-Wahrheit.
  runtime.dispatch(
    { entityId, domain: 'media_player', service: 'media_play_pause', data: {}, queuedAt: Date.now() },
    { playing: !cur.playing },
  );
}

/* Nur beim Release (final) — der Volume-Thumb folgt während des Drags dem Finger
   (Slider-Action), erst das Loslassen dispatcht (docs/02 Slider). */
export function setVolume(playerId: string, pct: number): void {
  const entityId = mediaEntityId(playerId);
  runtime.dispatch(
    { entityId, domain: 'media_player', service: 'volume_set', data: { volume_level: pct / 100 }, queuedAt: Date.now() },
    { volume: pct },
  );
}

export interface Preset { label: string; value: string }

export function playPreset(playerId: string, preset: Preset): void {
  const entityId = mediaEntityId(playerId);
  resetPosition(playerId);
  // Optimistisch nur playing + source; track/artist/duration löst der „Server"
  // (FakeBackend) aus media_id auf — sie erscheinen mit dem Echo (docs/02).
  runtime.dispatch(
    { entityId, domain: 'media_player', service: 'play_media',
      data: { media_id: preset.value, label: preset.label }, queuedAt: Date.now() },
    { playing: true, source: preset.label === 'Radio' ? 'Radio' : 'Spotify' },
  );
}

/* Skip: fire-and-forget (kein optimistisches Feld, kein Intent — analog Szene).
   Sichtbarer Effekt im Fake ist die Positions-Rückstellung. */
export function skipTrack(playerId: string, dir: 'next' | 'prev'): void {
  resetPosition(playerId);
  runtime.send({
    entityId: mediaEntityId(playerId), domain: 'media_player',
    service: dir === 'next' ? 'media_next_track' : 'media_previous_track',
    data: {}, queuedAt: Date.now(),
  });
}
