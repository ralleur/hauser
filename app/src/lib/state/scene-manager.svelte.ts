/* ── Szenen-Manager: reaktiver Zustand rund um scene-config.ts ──
   Hält die persistierte Szenen-Konfiguration als Rune, löst Mitglieder gegen
   die AKTUELLE Raum-Geräteliste auf (Default bleibt dynamisch: neue Raum-
   Lichter nehmen automatisch teil) und wendet Szenen als optimistische
   Einzel-Commands über den Adapter-Seam an (docs/02) — kein scene.turn_on,
   die Geräte-Kacheln spiegeln den Szenenwechsel sofort.

   Der Overlay-Zustand des Editors liegt daneben in
   scene-edit-overlay.svelte.ts — die Shells brauchen ihn, sollen aber nicht die
   ganze Szenen-Logik laden. */

import { runtime } from '../adapter/runtime.svelte.ts';
import type { HaScene } from '../adapter/types.ts';
import { setSceneEditLeaveHook } from './scene-edit-overlay.svelte.ts';
import { appState, type Room } from './app.svelte.ts';
import { deviceManager } from './device-manager.svelte.ts';
import {
  addCustomScene,
  addSceneMember,
  buildRestoreCommand,
  buildSceneCommands,
  defaultSceneMembers,
  deleteScene,
  loadSceneConfig,
  removeSceneMember,
  reorderSceneMember,
  resetSceneOverride,
  resolveSceneMembers,
  saveSceneConfig,
  sceneDefIn,
  sceneList,
  sceneMemberState,
  sceneMemberStateFromValue,
  sceneMemberTarget,
  sceneOverride,
  setSceneMemberState,
  setSceneName,
  isSceneCapableEntity,
  isSceneCustomized,
  type SceneConfig,
  type SceneDef,
  type SceneId,
  type SceneMemberState,
} from './scene-config.ts';

export const sceneManager = $state({
  config: loadSceneConfig(),
});

function roomById(roomId: string): Room | undefined {
  return appState.rooms.find((r) => r.id === roomId);
}

/* Szenen gehören dem Raum: die eingebauten hat jeder, alles Angelegte,
   Umbenannte und Gelöschte gilt nur dort, wo es gemacht wurde. */

/** Die wählbaren Szenen eines Raums, in Anzeigereihenfolge. */
export function scenes(roomId: string): SceneDef[] {
  return sceneList(sceneManager.config, roomId);
}

/** Definition einer Szene in einem Raum. */
export function sceneDefOf(roomId: string, sceneId: SceneId): SceneDef {
  return sceneDefIn(sceneManager.config, roomId, sceneId);
}

/** Neue eigene Szene in diesem Raum anlegen und ihre Id liefern. */
export function createScene(roomId: string, label: string): SceneId {
  const { config, id } = addCustomScene(sceneManager.config, roomId, label);
  updateConfig(config);
  return id;
}

/** Szene in diesem Raum umbenennen — auch eine der eingebauten. */
export function renameScene(roomId: string, sceneId: SceneId, label: string): void {
  updateConfig(setSceneName(sceneManager.config, roomId, sceneId, label));
}

/** Szene aus diesem Raum löschen und die Id der danach anzuzeigenden liefern. */
export function removeScene(roomId: string, sceneId: SceneId): SceneId | null {
  const next = deleteScene(sceneManager.config, roomId, sceneId);
  if (next === sceneManager.config) return sceneId;
  updateConfig(next);
  return scenes(roomId)[0]?.id ?? null;
}

/** Mitglied innerhalb der Szene an eine neue Position schieben. */
export function reorderMember(roomId: string, sceneId: SceneId, entityId: string, targetIndex: number): void {
  updateConfig(reorderSceneMember(sceneManager.config, roomId, sceneId, entityId, targetIndex, sceneDefaults(roomId)));
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

/** Gesetzter Zielzustand eines Mitglieds (undefined = Szenen-Default). */
export function memberState(roomId: string, sceneId: SceneId, entityId: string): SceneMemberState | undefined {
  return sceneMemberState(sceneManager.config, roomId, sceneId, entityId);
}

/** Zielzustand, den die Szene für das Mitglied fährt (Default eingerechnet). */
export function memberTarget(roomId: string, sceneId: SceneId, entityId: string): SceneMemberState {
  return sceneMemberTarget(sceneDefOf(roomId, sceneId), memberState(roomId, sceneId, entityId));
}

/** Zielzustand setzen (undefined = zurück auf den Szenen-Default) und ihn
    sofort auf das Gerät fahren, damit die Wirkung sichtbar ist. */
export function setMemberState(
  roomId: string,
  sceneId: SceneId,
  entityId: string,
  state: SceneMemberState | undefined,
): void {
  updateConfig(setSceneMemberState(sceneManager.config, roomId, sceneId, entityId, state));
  previewMember(roomId, sceneId, entityId);
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

/* Fähigkeiten eines Mitglieds für den Editor: erst die Raum-Projektion, dann
   der Katalog. Was das Gerät nicht kann, zeigt der Editor auch nicht an. */
export interface SceneMemberCapabilities {
  dimmable: boolean;
  colorTemp: boolean;
  colorTempMin?: number;
  colorTempMax?: number;
}

export function memberCapabilities(entityId: string): SceneMemberCapabilities {
  for (const room of appState.rooms) {
    const device = room.lights.find((l) => l.entityId === entityId);
    if (device) {
      return {
        dimmable: !!device.dimmable,
        colorTemp: !!device.colorTemp,
        colorTempMin: device.colorTempMin,
        colorTempMax: device.colorTempMax,
      };
    }
  }
  const caps = deviceManager.catalog.find((i) => i.entityId === entityId)?.capabilities;
  return {
    dimmable: !!caps?.dimmable,
    colorTemp: !!caps?.colorTemp,
    colorTempMin: caps?.colorTempMin,
    colorTempMax: caps?.colorTempMax,
  };
}

function memberInfo(roomId: string, sceneId: SceneId, entityId: string) {
  return { entityId, dimmable: dimmableOf(entityId), state: memberState(roomId, sceneId, entityId) };
}

/** Szene anwenden: ein optimistischer Command pro Mitglied (Dedup pro Entität
    übernimmt die Queue; rapides Umschalten zweier Szenen kollabiert sauber). */
export function applyScene(roomId: string, sceneId: SceneId): void {
  const members = sceneMembers(roomId, sceneId).map((entityId) => memberInfo(roomId, sceneId, entityId));
  for (const { command, optimistic } of buildSceneCommands(sceneDefOf(roomId, sceneId), members)) {
    runtime.dispatch(command, optimistic);
  }
}

/* ── Aktive Szene erkennen ──
   Eine Szene gilt als aktiv, wenn JEDES ihrer Mitglieder gerade den
   Zielzustand der Szene zeigt — unabhängig davon, ob sie über die Pille
   gefahren oder von Hand nachgestellt wurde. Verglichen wird gegen die
   gemergte Sicht (docs/02), damit die Hervorhebung sofort mit dem
   optimistischen Wert kommt und nicht erst mit dem Server-Echo.

   Toleranzen, weil HA Helligkeit in 0–255 rechnet und beim Rückweg nach
   Prozent rundet, und weil Lampen die Farbtemperatur auf ihr Raster ziehen. */
const BRIGHTNESS_TOLERANCE = 2; // %
const COLOR_TEMP_TOLERANCE = 60; // K

function memberMatchesTarget(entityId: string, target: SceneMemberState): boolean {
  const value = runtime.merged(entityId);
  if (typeof value !== 'object' || value === null) return false;
  const current = value as { on?: boolean; brightness?: number; colorTemp?: number };
  if (current.on !== target.on) return false;
  if (!target.on) return true;
  if (typeof target.brightness === 'number' && dimmableOf(entityId) !== false) {
    if (typeof current.brightness !== 'number') return false;
    if (Math.abs(current.brightness - target.brightness) > BRIGHTNESS_TOLERANCE) return false;
  }
  if (typeof target.colorTemp === 'number') {
    if (typeof current.colorTemp !== 'number') return false;
    if (Math.abs(current.colorTemp - target.colorTemp) > COLOR_TEMP_TOLERANCE) return false;
  }
  return true;
}

/** Fährt der Raum gerade genau diese Szene? Eine Szene ohne Mitglieder ist nie
    aktiv — sonst wäre sie es immer. */
export function isSceneActive(roomId: string, sceneId: SceneId): boolean {
  const members = sceneMembers(roomId, sceneId);
  if (members.length === 0) return false;
  return members.every((entityId) => memberMatchesTarget(entityId, memberTarget(roomId, sceneId, entityId)));
}

/* ── Live-Vorschau im Editor ──
   Der Editor fährt jede Änderung sofort auf die Geräte (Apple-Home-Gefühl).
   Vor dem ersten Eingriff pro Entität wird der aktuelle Zustand gemerkt; beim
   Verlassen des Overlays stellt restoreScenePreview() ihn wieder her. */
const previewSnapshot = new Map<string, unknown>();

function rememberPreview(entityId: string): void {
  if (previewSnapshot.has(entityId)) return;
  const value = runtime.merged(entityId);
  if (value !== undefined) previewSnapshot.set(entityId, value);
}

/** Ein einzelnes Mitglied auf seinen Szenen-Zielzustand fahren. */
export function previewMember(roomId: string, sceneId: SceneId, entityId: string): void {
  rememberPreview(entityId);
  const [cmd] = buildSceneCommands(sceneDefOf(roomId, sceneId), [memberInfo(roomId, sceneId, entityId)]);
  if (cmd) runtime.dispatch(cmd.command, cmd.optimistic);
}

/** Die ganze Szene als Vorschau fahren (Öffnen, Szenen-Tab-Wechsel). */
export function previewScene(roomId: string, sceneId: SceneId): void {
  for (const entityId of sceneMembers(roomId, sceneId)) rememberPreview(entityId);
  applyScene(roomId, sceneId);
}

/* ── Szenen aus Home Assistant übernehmen ──
   Wer in HA schon Szenen gepflegt hat, soll sie nicht nachbauen müssen. Die
   Mitglieder stehen in der Szene selbst; die Zielzustände gibt Home Assistant
   über den WebSocket nicht heraus, deshalb wird die Szene EINMAL gefahren und
   der erreichte Zustand der Mitglieder übernommen. Das ist im Editor kein
   Fremdkörper: er fährt ohnehin jede Änderung live auf die Geräte, und beim
   Schließen stellt restoreScenePreview() den Zustand von vorher wieder her. */

/** Wartezeit zwischen `scene.turn_on` und dem Auslesen — Lampen brauchen einen
    Moment, bis der neue Zustand in Home Assistant steht. */
const IMPORT_SETTLE_MS = 1200;

/** Ist eine der HA-Szenen bereits nach Hauser übernommen? Verglichen wird über
    den Namen, den der Import vergibt — mehr Bindung gibt es nicht: die Hauser-
    Szene ist danach eine eigene, unabhängige Szene. */
export function sceneImportCandidates(roomId: string, haScenes: readonly HaScene[]): HaScene[] {
  const room = roomById(roomId);
  const roomEntities = new Set(room?.lights.map((l) => l.entityId) ?? []);
  // Szenen des eigenen Raums zuerst: gleicher Bereichsname oder Mitglieder,
  // die im Raum liegen. Der Rest bleibt wählbar, nur weiter unten.
  return [...haScenes]
    .map((scene) => ({
      scene,
      rank: (room && scene.area === room.name ? 2 : 0)
        + (scene.members.some((id) => roomEntities.has(id)) ? 1 : 0),
    }))
    .sort((a, b) => b.rank - a.rank || a.scene.name.localeCompare(b.scene.name, 'de'))
    .map((entry) => entry.scene);
}

/** HA-Szene als neue Hauser-Szene des Raums anlegen. Liefert die Id der neuen
    Szene; `null`, wenn die Szene kein steuerbares Mitglied hat. */
export async function importHaScene(roomId: string, scene: HaScene): Promise<SceneId | null> {
  const members = scene.members.filter(isSceneCapableEntity);
  if (members.length === 0) return null;
  const sceneId = createScene(roomId, scene.name);

  // Mitgliedschaft: exakt die der HA-Szene — Raum-Lichter, die sie nicht kennt,
  // fliegen aus der Default-Menge heraus.
  for (const entityId of sceneDefaults(roomId)) {
    if (!members.includes(entityId)) removeFromScene(roomId, sceneId, entityId);
  }
  for (const entityId of members) addToScene(roomId, sceneId, entityId);

  // Vor dem Fahren merken, damit das Schließen des Editors zurücknimmt.
  for (const entityId of members) rememberPreview(entityId);
  await runtime.activateScene(scene.entityId);
  await new Promise((resolve) => setTimeout(resolve, IMPORT_SETTLE_MS));
  const values = await runtime.readStates(members);
  for (const entityId of members) {
    const state = sceneMemberStateFromValue(values[entityId]);
    if (state) updateConfig(setSceneMemberState(sceneManager.config, roomId, sceneId, entityId, state));
  }
  return sceneId;
}

/** Zustand von vor dem Öffnen des Editors wiederherstellen. */
export function restoreScenePreview(): void {
  for (const [entityId, value] of previewSnapshot) {
    const restore = buildRestoreCommand(entityId, value);
    if (restore) runtime.dispatch(restore.command, restore.optimistic);
  }
  previewSnapshot.clear();
}

/* Der Overlay-Zustand liegt in scene-edit-overlay.svelte.ts, damit die Shells
   ihn lesen können, ohne die Szenen-Logik in den Startup-Chunk zu ziehen
   (docs/03). Hier wird nur das Zurücknehmen der Vorschau eingehängt und die
   Overlay-API weitergereicht, damit Aufrufer eine Import-Quelle behalten. */
setSceneEditLeaveHook(restoreScenePreview);

export {
  sceneEdit,
  openSceneEdit,
  closeSceneEdit,
  finishSceneEditClose,
} from './scene-edit-overlay.svelte.ts';
