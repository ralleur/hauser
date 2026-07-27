/* ── Szenen-Manager: reaktiver Zustand rund um scene-config.ts ──
   Hält die persistierte Szenen-Konfiguration als Rune, löst Mitglieder gegen
   die AKTUELLE Raum-Geräteliste auf (Default bleibt dynamisch: neue Raum-
   Lichter nehmen automatisch teil) und wendet Szenen als optimistische
   Einzel-Commands über den Adapter-Seam an (docs/02) — kein scene.turn_on,
   die Geräte-Kacheln spiegeln den Szenenwechsel sofort.

   Der Szenen-Editor (SceneEdit.svelte) hat hier auch seine Overlay-
   Zustandsmaschine: Config, Auflösung und Editor-Zustand des Szenen-Features
   bleiben eine Einheit (gleiches hidden→open→closing-Muster wie
   overlay.svelte.ts). */

import { runtime } from '../adapter/runtime.svelte.ts';
import { appState, type Room } from './app.svelte.ts';
import { deviceManager } from './device-manager.svelte.ts';
import {
  addSceneMember,
  buildSceneCommands,
  defaultSceneMembers,
  loadSceneConfig,
  removeSceneMember,
  resetSceneOverride,
  resolveSceneMembers,
  saveSceneConfig,
  sceneDef,
  sceneOverride,
  isSceneCustomized,
  type SceneConfig,
  type SceneId,
} from './scene-config.ts';

export const sceneManager = $state({
  config: loadSceneConfig(),
});

function roomById(roomId: string): Room | undefined {
  return appState.rooms.find((r) => r.id === roomId);
}

/** Default-Mitglieder (alle Raum-Lichter) der Szene eines Raums. */
export function sceneDefaults(roomId: string): string[] {
  const room = roomById(roomId);
  return room ? defaultSceneMembers(room.lights) : [];
}

/** Aufgelöste Mitglieder (Default ± Overrides) einer Szene. */
export function sceneMembers(roomId: string, sceneId: SceneId): string[] {
  return resolveSceneMembers(sceneDefaults(roomId), sceneOverride(sceneManager.config, roomId, sceneId));
}

export function sceneCustomized(roomId: string, sceneId: SceneId): boolean {
  return isSceneCustomized(sceneManager.config, roomId, sceneId);
}

export function addToScene(roomId: string, sceneId: SceneId, entityId: string): void {
  updateConfig(addSceneMember(sceneManager.config, roomId, sceneId, entityId, sceneDefaults(roomId)));
}

export function removeFromScene(roomId: string, sceneId: SceneId, entityId: string): void {
  updateConfig(removeSceneMember(sceneManager.config, roomId, sceneId, entityId, sceneDefaults(roomId)));
}

export function resetScene(roomId: string, sceneId: SceneId): void {
  updateConfig(resetSceneOverride(sceneManager.config, roomId, sceneId));
}

function updateConfig(config: SceneConfig): void {
  sceneManager.config = config;
  saveSceneConfig(config);
}

/* Dimmbarkeit eines Mitglieds: erst die Raum-Projektion (trägt die Seed-/
   Capability-Flags), dann der Katalog. Unbekannt (Fremd-Entität ohne
   Katalog-Eintrag) → undefined, buildSceneCommands nimmt dann dimmbar an. */
function dimmableOf(entityId: string): boolean | undefined {
  for (const room of appState.rooms) {
    const device = room.lights.find((l) => l.entityId === entityId);
    if (device) return device.dimmable;
  }
  return deviceManager.catalog.find((i) => i.entityId === entityId)?.capabilities?.dimmable;
}

/** Szene anwenden: ein optimistischer Command pro Mitglied (Dedup pro Entität
    übernimmt die Queue; rapides Umschalten zweier Szenen kollabiert sauber). */
export function applyScene(roomId: string, sceneId: SceneId): void {
  const members = sceneMembers(roomId, sceneId)
    .map((entityId) => ({ entityId, dimmable: dimmableOf(entityId) }));
  for (const { command, optimistic } of buildSceneCommands(sceneDef(sceneId), members)) {
    runtime.dispatch(command, optimistic);
  }
}

/* ── Szenen-Editor-Overlay (Long-Press auf eine Szenen-Pille) ──
   hidden → open → closing, analog roomEdit (overlay.svelte.ts). Trägt
   roomId + sceneId; die Szene ist im Editor per Tabs umschaltbar. */
export const sceneEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
  roomId: '',
  sceneId: 'gemuetlich' as SceneId,
});

export function openSceneEdit(roomId: string, sceneId: SceneId): void {
  sceneEdit.roomId = roomId;
  sceneEdit.sceneId = sceneId;
  sceneEdit.mode = 'open';
}

export function closeSceneEdit(instant = false): void {
  if (sceneEdit.mode === 'hidden' || sceneEdit.mode === 'closing') return;
  sceneEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishSceneEditClose(): void {
  if (sceneEdit.mode === 'closing') sceneEdit.mode = 'hidden';
}
