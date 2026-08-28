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

/* Ids der drei eingebauten Szenen plus frei vergebene Ids eigener Szenen. */
export type SceneId = string;

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

/* ── Eigene Szenen und Umbenennungen: PRO RAUM ──
   Die drei eingebauten Szenen gibt es in jedem Raum. Alles, was der Nutzer
   daran ändert — eine neue Szene anlegen, eine umbenennen, eine löschen —
   gilt nur für den Raum, in dem er es getan hat: das Wohnzimmer bekommt
   „Filmabend", die Küche sieht davon nichts.

   Deshalb liegt das Szenen-Set je Raum in `scenes[roomId]`, getrennt von den
   Mitglieder-Abweichungen in `rooms[roomId]`. Der Name ist bei eigenen Szenen
   direkt im Eintrag überschrieben, bei den eingebauten in `names` — so bleibt
   der Produkttext ohne Override übersetzbar. */
export interface CustomSceneDef {
  id: SceneId;
  label: string;
  on: boolean;
  brightness: number;
}

/** Szenen-Set eines Raums: was er über die eingebauten Szenen hinaus hat. */
export interface RoomSceneSet {
  /** eigene Szenen dieses Raums */
  custom?: CustomSceneDef[];
  /** abweichende Namen der eingebauten Szenen in diesem Raum (id → Name) */
  names?: Record<string, string>;
  /** in diesem Raum gelöschte eingebaute Szenen */
  hidden?: string[];
}

export function roomSceneSet(config: SceneConfig, roomId: string): RoomSceneSet | undefined {
  return config.scenes?.[roomId];
}

/** Die wählbaren Szenen EINES Raums: eingebaute (ggf. umbenannt, ohne dort
    gelöschte) plus die eigenen dieses Raums. */
export function sceneList(config: SceneConfig, roomId: string): SceneDef[] {
  const set = roomSceneSet(config, roomId);
  const hidden = new Set(set?.hidden ?? []);
  const builtins = SCENES.filter((def) => !hidden.has(def.id)).map((def) => {
    const label = set?.names?.[def.id];
    return label ? { ...def, label } : def;
  });
  return [...builtins, ...(set?.custom ?? [])];
}

/* Szenen-Set eines Raums immutabel ersetzen; ein leeres Set wird entfernt,
   damit „alles auf Standard" auch den Storage räumt. */
function withSceneSet(config: SceneConfig, roomId: string, next: RoomSceneSet): SceneConfig {
  const clone = cloneSceneConfig(config);
  const set: RoomSceneSet = {};
  if (next.custom?.length) set.custom = next.custom;
  if (next.names && Object.keys(next.names).length > 0) set.names = next.names;
  if (next.hidden?.length) set.hidden = next.hidden;
  if (Object.keys(set).length === 0) {
    if (clone.scenes) {
      delete clone.scenes[roomId];
      if (Object.keys(clone.scenes).length === 0) delete clone.scenes;
    }
    return clone;
  }
  clone.scenes = { ...(clone.scenes ?? {}), [roomId]: set };
  return clone;
}

/** Szene in EINEM Raum löschen: eigene fallen aus `custom`, eingebaute wandern
    in `hidden` — beides nur für diesen Raum. Auch die letzte Szene darf
    verschwinden; RoomControls lässt die Szenenleiste dann vollständig weg. */
export function deleteScene(config: SceneConfig, roomId: string, id: SceneId): SceneConfig {
  const set = roomSceneSet(config, roomId) ?? {};
  const custom = set.custom?.filter((s) => s.id !== id);
  const next: RoomSceneSet = { custom: custom ?? set.custom, names: set.names, hidden: set.hidden };
  if (custom && custom.length !== set.custom?.length) {
    // eigene Szene dieses Raums — sie ist mit dem Filter oben schon weg
  } else if (SCENES.some((s) => s.id === id)) {
    next.hidden = [...(set.hidden ?? []), id];
  } else {
    return config;
  }
  // Der Name-Override der Szene geht mit.
  if (next.names?.[id]) {
    const names = { ...next.names };
    delete names[id];
    next.names = names;
  }
  // …und ihre Mitglieder-Abweichungen in genau diesem Raum.
  const cleared = withSceneSet(config, roomId, next);
  if (cleared.rooms[roomId] && id in cleared.rooms[roomId]) {
    delete cleared.rooms[roomId][id];
    if (Object.keys(cleared.rooms[roomId]).length === 0) delete cleared.rooms[roomId];
  }
  return cleared;
}

export function sceneDefIn(config: SceneConfig, roomId: string, id: SceneId): SceneDef {
  const list = sceneList(config, roomId);
  return list.find((s) => s.id === id) ?? list[0];
}

function nextCustomSceneId(config: SceneConfig, roomId: string): SceneId {
  const used = new Set<string>([
    ...SCENES.map((s) => s.id),
    ...(roomSceneSet(config, roomId)?.custom ?? []).map((s) => s.id),
  ]);
  for (let n = 1; ; n++) {
    const id = `custom-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Neue eigene Szene in EINEM Raum anlegen; sie startet als „alles an, volle
    Helligkeit". */
export function addCustomScene(
  config: SceneConfig,
  roomId: string,
  label: string,
): { config: SceneConfig; id: SceneId } {
  const id = nextCustomSceneId(config, roomId);
  const set = roomSceneSet(config, roomId) ?? {};
  const next = withSceneSet(config, roomId, {
    ...set,
    custom: [...(set.custom ?? []), { id, label, on: true, brightness: 100 }],
  });
  return { config: next, id };
}

/** Szenennamen setzen — auch für die eingebauten Szenen. Leer = keine Änderung;
    ein Name gleich dem Produkttext räumt den Override wieder weg. */
export function setSceneName(config: SceneConfig, roomId: string, id: SceneId, label: string): SceneConfig {
  const trimmed = label.trim();
  if (!trimmed) return config;
  const set = roomSceneSet(config, roomId) ?? {};
  if (set.custom?.some((s) => s.id === id)) {
    const custom = set.custom.map((s) => (s.id === id ? { ...s, label: trimmed } : s));
    return withSceneSet(config, roomId, { ...set, custom });
  }
  const names = { ...(set.names ?? {}) };
  if (trimmed === sceneDef(id).label) delete names[id];
  else names[id] = trimmed;
  return withSceneSet(config, roomId, { ...set, names });
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

/* Zielzustand EINES Mitglieds (Apple-Home-Muster): die Szene legt pro Gerät
   fest, ob es an oder aus ist und — soweit das Gerät es kann — mit welcher
   Helligkeit/Farbtemperatur. Ohne Eintrag gilt weiter der Szenen-Default
   (SceneDef.on/brightness), damit bestehende Szenen unverändert wirken. */
export interface SceneMemberState {
  on: boolean;
  /** Ziel-Helligkeit in % (nur bei dimmbaren Lichtern) */
  brightness?: number;
  /** Ziel-Farbtemperatur in Kelvin (nur bei farbtemperaturfähigen Lichtern) */
  colorTemp?: number;
}

export interface SceneOverride {
  /** zusätzlich zur Default-Menge (z. B. Schalter, Lichter anderer Räume) */
  include: string[];
  /** aus der Default-Menge entfernt */
  exclude: string[];
  /** abweichender Zielzustand je Mitglied; fehlt, solange nichts gesetzt ist */
  states?: Record<string, SceneMemberState>;
  /** vom Nutzer gezogene Reihenfolge; Unbekanntes hängt hinten an */
  order?: string[];
}

export interface SceneConfig {
  version: 1;
  /** Mitglieder-Abweichungen je Raum und Szene */
  rooms: Record<string, Partial<Record<SceneId, SceneOverride>>>;
  /** welche Szenen ein Raum überhaupt hat (eigene, umbenannte, gelöschte) */
  scenes?: Record<string, RoomSceneSet>;
}

export const EMPTY_SCENE_CONFIG: SceneConfig = { version: 1, rooms: {} };

export function cloneSceneConfig(config: SceneConfig): SceneConfig {
  const rooms: SceneConfig['rooms'] = {};
  for (const [roomId, scenes] of Object.entries(config.rooms)) {
    rooms[roomId] = {};
    for (const [sceneId, o] of Object.entries(scenes)) {
      if (!o) continue;
      const next: SceneOverride = { include: [...o.include], exclude: [...o.exclude] };
      if (o.states) {
        next.states = Object.fromEntries(Object.entries(o.states).map(([id, s]) => [id, { ...s }]));
      }
      if (o.order?.length) next.order = [...o.order];
      rooms[roomId][sceneId as SceneId] = next;
    }
  }
  const clone: SceneConfig = { version: 1, rooms };
  if (config.scenes && Object.keys(config.scenes).length > 0) {
    clone.scenes = {};
    for (const [roomId, set] of Object.entries(config.scenes)) {
      const next: RoomSceneSet = {};
      if (set.custom?.length) next.custom = set.custom.map((s) => ({ ...s }));
      if (set.names && Object.keys(set.names).length > 0) next.names = { ...set.names };
      if (set.hidden?.length) next.hidden = [...set.hidden];
      if (Object.keys(next).length > 0) clone.scenes[roomId] = next;
    }
    if (Object.keys(clone.scenes).length === 0) delete clone.scenes;
  }
  return clone;
}

export function sceneOverride(config: SceneConfig, roomId: string, sceneId: SceneId): SceneOverride | undefined {
  return config.rooms[roomId]?.[sceneId];
}

/* Aufgelöste Mitglieder: Defaults minus exclude, plus include (stabil geordnet:
   erst Raum-Reihenfolge, dann Hinzufüge-Reihenfolge). Eine gezogene
   Reihenfolge sticht; was sie nicht kennt (neues Raum-Licht), hängt hinten an. */
export function resolveSceneMembers(defaults: readonly string[], override?: SceneOverride): string[] {
  const exclude = new Set(override?.exclude ?? []);
  const members = defaults.filter((id) => !exclude.has(id));
  for (const id of override?.include ?? []) {
    if (!members.includes(id)) members.push(id);
  }
  const order = override?.order;
  if (!order?.length) return members;
  const rank = new Map(order.map((id, index) => [id, index]));
  return members
    .map((id, index) => ({ id, index }))
    .sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.index - b.index;
    })
    .map((entry) => entry.id);
}

/** Mitglied an eine neue Position schieben; die Reihenfolge wird danach
    vollständig festgeschrieben. */
export function reorderSceneMember(
  config: SceneConfig,
  roomId: string,
  sceneId: SceneId,
  entityId: string,
  targetIndex: number,
  defaults: readonly string[],
): SceneConfig {
  const cur = sceneOverride(config, roomId, sceneId) ?? { include: [], exclude: [] };
  const members = resolveSceneMembers(defaults, cur);
  const from = members.indexOf(entityId);
  const to = Math.max(0, Math.min(members.length - 1, targetIndex));
  if (from < 0 || from === to) return config;
  const order = [...members];
  order.splice(to, 0, ...order.splice(from, 1));
  return withOverride(config, roomId, sceneId, { ...cur, order });
}

export function isSceneCustomized(config: SceneConfig, roomId: string, sceneId: SceneId): boolean {
  const o = sceneOverride(config, roomId, sceneId);
  return !!o && (o.include.length > 0 || o.exclude.length > 0 || !!o.states);
}

/** Gesetzter Zielzustand eines Mitglieds; undefined = Szenen-Default. */
export function sceneMemberState(
  config: SceneConfig,
  roomId: string,
  sceneId: SceneId,
  entityId: string,
): SceneMemberState | undefined {
  return sceneOverride(config, roomId, sceneId)?.states?.[entityId];
}

/** Zielzustand, den die Szene für ein Mitglied tatsächlich fährt. */
export function sceneMemberTarget(scene: SceneDef, state?: SceneMemberState): SceneMemberState {
  return state ?? (scene.on ? { on: true, brightness: scene.brightness } : { on: false });
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
  const states = next.states && Object.keys(next.states).length > 0 ? next.states : undefined;
  const order = next.order && next.order.length > 0 ? next.order : undefined;
  if (next.include.length === 0 && next.exclude.length === 0 && !states && !order) {
    if (clone.rooms[roomId]) {
      delete clone.rooms[roomId][sceneId];
      if (Object.keys(clone.rooms[roomId]).length === 0) delete clone.rooms[roomId];
    }
    return clone;
  }
  const normalized: SceneOverride = { include: next.include, exclude: next.exclude };
  if (states) normalized.states = states;
  if (order) normalized.order = order;
  clone.rooms[roomId] = { ...(clone.rooms[roomId] ?? {}), [sceneId]: normalized };
  return clone;
}

/** Zielzustand eines Mitglieds setzen bzw. (undefined) auf den Szenen-Default
    zurückfallen lassen. */
export function setSceneMemberState(
  config: SceneConfig,
  roomId: string,
  sceneId: SceneId,
  entityId: string,
  state: SceneMemberState | undefined,
): SceneConfig {
  const cur = sceneOverride(config, roomId, sceneId) ?? { include: [], exclude: [] };
  const states = { ...(cur.states ?? {}) };
  if (state) states[entityId] = state;
  else delete states[entityId];
  return withOverride(config, roomId, sceneId, { include: cur.include, exclude: cur.exclude, states, order: cur.order });
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
    ? { include: cur.include, exclude: cur.exclude.filter((id) => id !== entityId), states: cur.states, order: cur.order }
    : {
        include: cur.include.includes(entityId) ? cur.include : [...cur.include, entityId],
        exclude: cur.exclude,
        states: cur.states,
        order: cur.order,
      };
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
  // Der Zielzustand gehört zur Mitgliedschaft: wer draußen ist, hat keinen.
  const states = { ...(cur.states ?? {}) };
  delete states[entityId];
  const order = cur.order?.filter((id) => id !== entityId);
  const next: SceneOverride = defaults.includes(entityId)
    ? { include: cur.include, exclude: cur.exclude.includes(entityId) ? cur.exclude : [...cur.exclude, entityId], states, order }
    : { include: cur.include.filter((id) => id !== entityId), exclude: cur.exclude, states, order };
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
    // Szenen-Sets zuerst: sie bestimmen je Raum mit, welche Ids gültig sind.
    const sets = cleanSceneSets((obj as { scenes?: unknown }).scenes);
    const knownIn = (roomId: string) => new Set<string>([
      ...SCENES.map((s) => s.id),
      ...(sets[roomId]?.custom ?? []).map((s) => s.id),
    ]);
    const rooms: SceneConfig['rooms'] = {};
    for (const [roomId, scenes] of Object.entries(obj.rooms as Record<string, unknown>)) {
      if (typeof scenes !== 'object' || scenes === null || Array.isArray(scenes)) continue;
      const known = knownIn(roomId);
      for (const [sceneId, o] of Object.entries(scenes as Record<string, unknown>)) {
        if (!known.has(sceneId) || typeof o !== 'object' || o === null) continue;
        const cand = o as Partial<SceneOverride>;
        const clean = (ids: unknown): string[] => Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === 'string' && isSceneCapableEntity(id))
          : [];
        const include = clean(cand.include);
        const exclude = clean(cand.exclude);
        const states = cleanStates(cand.states);
        const order = clean(cand.order);
        if (include.length === 0 && exclude.length === 0 && !states && order.length === 0) continue;
        const override: SceneOverride = { include, exclude };
        if (states) override.states = states;
        if (order.length > 0) override.order = order;
        rooms[roomId] = { ...(rooms[roomId] ?? {}), [sceneId]: override };
      }
    }
    const config: SceneConfig = { version: 1, rooms };
    if (Object.keys(sets).length > 0) config.scenes = sets;
    return config;
  } catch {
    return cloneSceneConfig(EMPTY_SCENE_CONFIG);
  }
}

/* Szenen-Sets aus dem Storage, je Raum validiert. Ein Raum, der am Ende nichts
   Eigenes mehr hat, fällt raus (Normalform). */
function cleanSceneSets(raw: unknown): Record<string, RoomSceneSet> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const sets: Record<string, RoomSceneSet> = {};
  for (const [roomId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const cand = value as Partial<RoomSceneSet>;
    const custom = cleanCustomScenes(cand.custom);
    const known = new Set<string>([...SCENES.map((s) => s.id), ...custom.map((s) => s.id)]);
    const names = cleanSceneNames(cand.names, known);
    const hidden = Array.isArray(cand.hidden)
      ? [...new Set(cand.hidden.filter((id): id is string => typeof id === 'string' && SCENES.some((s) => s.id === id)))]
      : [];
    const set: RoomSceneSet = {};
    if (custom.length > 0) set.custom = custom;
    if (Object.keys(names).length > 0) set.names = names;
    // Nie den letzten Rest verstecken — der Raum braucht mindestens eine Szene.
    if (hidden.length > 0 && hidden.length < SCENES.length + custom.length) set.hidden = hidden;
    if (Object.keys(set).length > 0) sets[roomId] = set;
  }
  return sets;
}

/* Eigene Szenen aus dem Storage: Id und Name müssen tragen, Id-Kollisionen mit
   den eingebauten Szenen und Dubletten fallen weg. */
function cleanCustomScenes(raw: unknown): CustomSceneDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(SCENES.map((s) => s.id));
  const scenes: CustomSceneDef[] = [];
  for (const value of raw) {
    if (typeof value !== 'object' || value === null) continue;
    const cand = value as Partial<CustomSceneDef>;
    const id = typeof cand.id === 'string' ? cand.id.trim() : '';
    const label = typeof cand.label === 'string' ? cand.label.trim() : '';
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const brightness = typeof cand.brightness === 'number' && cand.brightness >= 0 && cand.brightness <= 100
      ? cand.brightness
      : 100;
    scenes.push({ id, label, on: cand.on !== false, brightness });
  }
  return scenes;
}

function cleanSceneNames(raw: unknown, known: ReadonlySet<string>): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const names: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(id) || typeof value !== 'string' || !value.trim()) continue;
    names[id] = value.trim();
  }
  return names;
}

/* Zielzustände aus dem Storage: nur szenenfähige Entitäten mit plausiblen
   Werten überleben; ohne Treffer bleibt `states` weg (Normalform). */
function cleanStates(raw: unknown): Record<string, SceneMemberState> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const states: Record<string, SceneMemberState> = {};
  for (const [entityId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSceneCapableEntity(entityId) || typeof value !== 'object' || value === null) continue;
    const cand = value as Partial<SceneMemberState>;
    if (typeof cand.on !== 'boolean') continue;
    const state: SceneMemberState = { on: cand.on };
    if (typeof cand.brightness === 'number' && cand.brightness >= 0 && cand.brightness <= 100) {
      state.brightness = cand.brightness;
    }
    if (typeof cand.colorTemp === 'number' && cand.colorTemp > 0) state.colorTemp = cand.colorTemp;
    states[entityId] = state;
  }
  return Object.keys(states).length > 0 ? states : undefined;
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
  /** gesetzter Zielzustand; ohne ihn gilt der Szenen-Default */
  state?: SceneMemberState;
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
  return members.map(({ entityId, dimmable, state }) => {
    const domain = entityId.slice(0, entityId.indexOf('.'));
    const target = sceneMemberTarget(scene, state);
    if (domain === 'light') {
      if (!target.on) {
        return {
          command: { entityId, domain, service: 'turn_off', data: {}, queuedAt: now },
          optimistic: { on: false } satisfies Partial<LightValue>,
        };
      }
      const dim = dimmable ?? true;
      const data: Record<string, unknown> = {};
      const optimistic: Partial<LightValue> = { on: true };
      if (dim && typeof target.brightness === 'number') {
        data.brightness_pct = target.brightness;
        optimistic.brightness = target.brightness;
      }
      // Farbtemperatur verlässt den Farbmodus (HA-color_mode, docs/04).
      if (typeof target.colorTemp === 'number') {
        data.color_temp_kelvin = target.colorTemp;
        optimistic.colorTemp = target.colorTemp;
        optimistic.color = null;
      }
      return { command: { entityId, domain, service: 'turn_on', data, queuedAt: now }, optimistic };
    }
    return {
      command: { entityId, domain, service: target.on ? 'turn_on' : 'turn_off', data: {}, queuedAt: now },
      optimistic: { on: target.on } satisfies SwitchValue,
    };
  });
}

/* ── Vorschau zurücknehmen ──
   Der Szenen-Editor fährt Änderungen live auf die Geräte; beim Verlassen wird
   der Zustand von vor dem Öffnen wiederhergestellt. Aus einem gemergten Wert
   (LightValue/SwitchValue) wird dafür der gegenläufige Command gebaut. */
export function buildRestoreCommand(entityId: string, value: unknown, now = Date.now()): SceneCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  const domain = entityId.slice(0, entityId.indexOf('.'));
  if (domain === 'light') {
    const light = value as Partial<LightValue>;
    if (!light.on) {
      return {
        command: { entityId, domain, service: 'turn_off', data: {}, queuedAt: now },
        optimistic: { on: false } satisfies Partial<LightValue>,
      };
    }
    const data: Record<string, unknown> = {};
    if (typeof light.brightness === 'number') data.brightness_pct = light.brightness;
    // Farbmodus hat Vorrang: die Vorschau kann das Licht auf Farbtemperatur
    // gezogen haben, dann bringt erst rgb_color die Farbe zurück.
    if (typeof light.color === 'string') data.rgb_color = hexToRgbTriple(light.color);
    else if (typeof light.colorTemp === 'number') data.color_temp_kelvin = light.colorTemp;
    return {
      command: { entityId, domain, service: 'turn_on', data, queuedAt: now },
      optimistic: { ...light, on: true } as Partial<LightValue>,
    };
  }
  const sw = value as Partial<SwitchValue>;
  return {
    command: { entityId, domain, service: sw.on ? 'turn_on' : 'turn_off', data: {}, queuedAt: now },
    optimistic: { on: !!sw.on } satisfies SwitchValue,
  };
}

function hexToRgbTriple(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}
