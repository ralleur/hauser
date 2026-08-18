/* ── Szenen-Konfiguration (Enduser-Anpassung per Long-Press auf die Szenen-Pille) ──
   Szenen sind HMI-lokale Presets, KEINE HA-scene.*-Entitäten: Anwenden heißt
   ein Licht-/Schalt-Command pro Mitglied (optimistisch, docs/02) — dadurch
   spiegeln die Geräte-Kacheln den Szenenwechsel sofort.

   Default-Mitglieder = alle light.*-Geräte des Raums, DYNAMISCH aufgelöst:
   ein später in den Raum gelegtes Licht (Raum-Geräte-Editor) nimmt automatisch
   an den Szenen teil. Persistiert werden deshalb nur ABWEICHUNGEN vom Default
   (include/exclude pro Raum+Szene), analog zum Override-Muster in
   device-config.ts. Reine Logik + Persistenz, keine Runes — der reaktive
   Zustand lebt in scene-manager.svelte.ts. */

import { m } from '../../paraglide/messages.js';
import type { Command, LightValue, SwitchValue } from '../adapter/types.ts';
import { sharedStorage } from './shared-config.ts';

export type SceneId = 'gemuetlich' | 'hell' | 'aus';

export interface SceneDef {
  id: SceneId;
  readonly label: string;
  /** false = Szene schaltet alle Mitglieder aus */
  on: boolean;
  /** Ziel-Helligkeit dimmbarer Lichter in % (nur bei on-Szenen relevant) */
  brightness: number;
}

/* `label` als Getter (ADR-021): die drei eingebauten Szenen sind Produkttext,
   kein Nutzerinhalt — sie müssen der Oberflächensprache folgen. */
export const SCENES: readonly SceneDef[] = [
  { id: 'gemuetlich', get label() { return m.scene_cozy(); }, on: true, brightness: 20 },
  { id: 'hell', get label() { return m.scene_bright(); }, on: true, brightness: 100 },
  { id: 'aus', get label() { return m.scene_off(); }, on: false, brightness: 0 },
];

export function sceneDef(id: SceneId): SceneDef {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

function isSceneId(value: unknown): value is SceneId {
  return SCENES.some((s) => s.id === value);
}

/* ── Mitgliedschaft ──
   Szenen steuern Lichter und Schalter (bewusst NICHT die weiteren Overlay-
   Kategorien wie Sensoren/Klima/Media): Default sind die Raum-Lichter,
   per Editor kommen beliebige light.*- und switch.*-Entitäten dazu bzw. weg. */

export function isLightEntity(entityId: string): boolean {
  return entityId.startsWith('light.');
}

export function isSceneCapableEntity(entityId: string): boolean {
  return entityId.startsWith('light.') || entityId.startsWith('switch.');
}

export function defaultSceneMembers(devices: readonly { entityId: string }[]): string[] {
  return devices.map((d) => d.entityId).filter(isLightEntity);
}

export interface SceneOverride {
  /** zusätzlich zur Default-Menge (z. B. Schalter, Lichter anderer Räume) */
  include: string[];
  /** aus der Default-Menge entfernt */
  exclude: string[];
}

export interface SceneConfig {
  version: 1;
  rooms: Record<string, Partial<Record<SceneId, SceneOverride>>>;
}

export const EMPTY_SCENE_CONFIG: SceneConfig = { version: 1, rooms: {} };

export function cloneSceneConfig(config: SceneConfig): SceneConfig {
  const rooms: SceneConfig['rooms'] = {};
  for (const [roomId, scenes] of Object.entries(config.rooms)) {
    rooms[roomId] = {};
    for (const [sceneId, o] of Object.entries(scenes)) {
      if (o) rooms[roomId][sceneId as SceneId] = { include: [...o.include], exclude: [...o.exclude] };
    }
  }
  return { version: 1, rooms };
}

export function sceneOverride(config: SceneConfig, roomId: string, sceneId: SceneId): SceneOverride | undefined {
  return config.rooms[roomId]?.[sceneId];
}

/* Aufgelöste Mitglieder: Defaults minus exclude, plus include (stabil geordnet:
   erst Raum-Reihenfolge, dann Hinzufüge-Reihenfolge). */
export function resolveSceneMembers(defaults: readonly string[], override?: SceneOverride): string[] {
  const exclude = new Set(override?.exclude ?? []);
  const members = defaults.filter((id) => !exclude.has(id));
  for (const id of override?.include ?? []) {
    if (!members.includes(id)) members.push(id);
  }
  return members;
}

export function isSceneCustomized(config: SceneConfig, roomId: string, sceneId: SceneId): boolean {
  const o = sceneOverride(config, roomId, sceneId);
  return !!o && (o.include.length > 0 || o.exclude.length > 0);
}

/* Immutable Updates (Muster device-config.ts): leere Overrides werden
   normalisiert entfernt, damit „zurück auf Standard" auch den Storage räumt. */
function withOverride(
  config: SceneConfig,
  roomId: string,
  sceneId: SceneId,
  next: SceneOverride,
): SceneConfig {
  const clone = cloneSceneConfig(config);
  if (next.include.length === 0 && next.exclude.length === 0) {
    if (clone.rooms[roomId]) {
      delete clone.rooms[roomId][sceneId];
      if (Object.keys(clone.rooms[roomId]).length === 0) delete clone.rooms[roomId];
    }
    return clone;
  }
  clone.rooms[roomId] = { ...(clone.rooms[roomId] ?? {}), [sceneId]: next };
  return clone;
}

export function addSceneMember(
  config: SceneConfig,
  roomId: string,
  sceneId: SceneId,
  entityId: string,
  defaults: readonly string[],
): SceneConfig {
  if (!isSceneCapableEntity(entityId)) return config;
  const cur = sceneOverride(config, roomId, sceneId) ?? { include: [], exclude: [] };
  const next: SceneOverride = defaults.includes(entityId)
    ? { include: cur.include, exclude: cur.exclude.filter((id) => id !== entityId) }
    : { include: cur.include.includes(entityId) ? cur.include : [...cur.include, entityId], exclude: cur.exclude };
  return withOverride(config, roomId, sceneId, next);
}

export function removeSceneMember(
  config: SceneConfig,
  roomId: string,
  sceneId: SceneId,
  entityId: string,
  defaults: readonly string[],
): SceneConfig {
  const cur = sceneOverride(config, roomId, sceneId) ?? { include: [], exclude: [] };
  const next: SceneOverride = defaults.includes(entityId)
    ? { include: cur.include, exclude: cur.exclude.includes(entityId) ? cur.exclude : [...cur.exclude, entityId] }
    : { include: cur.include.filter((id) => id !== entityId), exclude: cur.exclude };
  return withOverride(config, roomId, sceneId, next);
}

export function resetSceneOverride(config: SceneConfig, roomId: string, sceneId: SceneId): SceneConfig {
  return withOverride(config, roomId, sceneId, { include: [], exclude: [] });
}

/* ── Persistenz (localStorage, Muster device-config.ts) ── */

export const SCENE_CONFIG_KEY = 'hmi:scene-config:v1';

export interface SceneStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function parseSceneConfig(raw: string | null): SceneConfig {
  if (!raw) return cloneSceneConfig(EMPTY_SCENE_CONFIG);
  try {
    const obj = JSON.parse(raw) as Partial<SceneConfig>;
    if (!obj || obj.version !== 1 || typeof obj.rooms !== 'object' || obj.rooms === null || Array.isArray(obj.rooms)) {
      return cloneSceneConfig(EMPTY_SCENE_CONFIG);
    }
    const rooms: SceneConfig['rooms'] = {};
    for (const [roomId, scenes] of Object.entries(obj.rooms as Record<string, unknown>)) {
      if (typeof scenes !== 'object' || scenes === null || Array.isArray(scenes)) continue;
      for (const [sceneId, o] of Object.entries(scenes as Record<string, unknown>)) {
        if (!isSceneId(sceneId) || typeof o !== 'object' || o === null) continue;
        const cand = o as Partial<SceneOverride>;
        const clean = (ids: unknown): string[] => Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === 'string' && isSceneCapableEntity(id))
          : [];
        const include = clean(cand.include);
        const exclude = clean(cand.exclude);
        if (include.length === 0 && exclude.length === 0) continue;
        rooms[roomId] = { ...(rooms[roomId] ?? {}), [sceneId]: { include, exclude } };
      }
    }
    return { version: 1, rooms };
  } catch {
    return cloneSceneConfig(EMPTY_SCENE_CONFIG);
  }
}

export function loadSceneConfig(storage: SceneStorage | undefined = browserStorage()): SceneConfig {
  if (!storage) return cloneSceneConfig(EMPTY_SCENE_CONFIG);
  return parseSceneConfig(storage.getItem(SCENE_CONFIG_KEY));
}

export function saveSceneConfig(config: SceneConfig, storage: SceneStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SCENE_CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): SceneStorage | undefined {
  try { if (typeof localStorage === 'undefined') return undefined; } catch { return undefined; }
  const candidate = sharedStorage as Partial<SceneStorage>;
  if (!candidate.getItem || !candidate.setItem || !candidate.removeItem) return undefined;
  return candidate as SceneStorage;
}

/* ── Anwenden: Szene → ein Command pro Mitglied ──
   light.*: turn_on mit brightness_pct (dimmbar) bzw. plain turn_on / turn_off.
   Alles andere (switch.*): turn_on/turn_off in der eigenen Domäne. Optimistische
   Werte sind Teil-Patches — mergePatch/subsetMatch (runtime) überlagern nur die
   gesetzten Felder, Server-Metadaten fließen unverändert durch. */

export interface SceneMemberInfo {
  entityId: string;
  /** undefined = unbekannt → dimmbar annehmen (Lichter sind es meist) */
  dimmable?: boolean;
}

export interface SceneCommand {
  command: Command;
  optimistic: Partial<LightValue> | SwitchValue;
}

export function buildSceneCommands(
  scene: SceneDef,
  members: readonly SceneMemberInfo[],
  now = Date.now(),
): SceneCommand[] {
  return members.map(({ entityId, dimmable }) => {
    const domain = entityId.slice(0, entityId.indexOf('.'));
    if (domain === 'light') {
      if (!scene.on) {
        return {
          command: { entityId, domain, service: 'turn_off', data: {}, queuedAt: now },
          optimistic: { on: false } satisfies Partial<LightValue>,
        };
      }
      const dim = dimmable ?? true;
      return {
        command: {
          entityId,
          domain,
          service: 'turn_on',
          data: dim ? { brightness_pct: scene.brightness } : {},
          queuedAt: now,
        },
        optimistic: (dim ? { on: true, brightness: scene.brightness } : { on: true }) satisfies Partial<LightValue>,
      };
    }
    return {
      command: { entityId, domain, service: scene.on ? 'turn_on' : 'turn_off', data: {}, queuedAt: now },
      optimistic: { on: scene.on } satisfies SwitchValue,
    };
  });
}
