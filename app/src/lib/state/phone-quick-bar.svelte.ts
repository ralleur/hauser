/* SPDX-License-Identifier: AGPL-3.0-only */

/* ── Schnellaktions-Leiste am Telefon (wie die iOS-App) ──
   Vier Felder, frei belegt: „Alles aus" und die kompakte Temperatur nehmen
   eines, die zentrale Temperatur zwei, jeder eigene Knopf eines. Ein eigener
   Knopf löst mit einem Tipp seine Schritte aus — Szenen, Geräte aus
   beliebigen Räumen, den Urlaubsmodus. Gerätelokal wie das übrige Layout
   des Telefons.

   Altbestand: Wer noch keine Leiste gespeichert hat, bekommt „Alles aus" und
   die Temperatur. Lag auf dem alten rechten Knopf ein Gerät, wird daraus ein
   eigener Knopf; ist der Urlaubsmodus gerade an, bleibt sein Knopf, damit man
   ihn wieder ausschalten kann. */
import { runtime } from '../adapter/runtime.svelte.ts';
import { toggleVacationMode, vacationModeActive } from './commands.ts';
import { categoryOf } from './device-config.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { isSafeIconId } from './icon-path.ts';
import { defaultIconFor } from './light-icons.ts';
import { phoneActionConfig } from './phone-action.svelte.ts';
import { applyScene, sceneDefOf } from './scene-manager.svelte.ts';

export type QuickKind = 'off' | 'climate' | 'climateCompact' | 'action';
export type QuickStepKind = 'scene' | 'device' | 'vacation';
export type QuickStepMode = 'toggle' | 'on' | 'off';

export interface QuickStep {
  kind: QuickStepKind;
  roomId?: string;
  sceneId?: string;
  entityId?: string;
  mode: QuickStepMode;
}

export interface QuickItem {
  id: string;
  kind: QuickKind;
  /** Nur der eigene Knopf: Wort unter dem Zeichen (höchstens 14 Zeichen). */
  name: string;
  icon: string;
  steps: QuickStep[];
}

export const QUICK_FIELDS = 4;
export const QUICK_NAME_MAX = 14;
export const QUICK_DEFAULT_ICON = 'i-lightning-bolt';
/** Zeichen zur Wahl für einen eigenen Knopf. */
export const QUICK_ICONS: readonly string[] = [
  'i-lightning-bolt', 'i-power', 'i-lightbulb', 'i-weather-night', 'i-weather-sunny', 'i-home', 'i-door-open',
  'i-bed', 'i-sofa', 'i-silverware-fork-knife', 'i-television', 'i-movie-open', 'i-music-note', 'i-umbrella-beach',
  'i-leaf', 'i-fan', 'i-blinds', 'i-lock', 'i-star', 'i-heart',
];

const STORAGE_KEY = 'hmi:phone-quick-bar:v1';

/** Welcher eigene Knopf gerade im Bearbeitungsblatt liegt (eigenes Modul, s. dort). */
export { quickEdit } from './phone-quick-edit.svelte.ts';
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

export function quickSpan(item: Pick<QuickItem, 'kind'>): number {
  return item.kind === 'climate' ? 2 : 1;
}

export function usedFields(items: readonly QuickItem[]): number {
  return items.reduce((sum, item) => sum + quickSpan(item), 0);
}

/** Passt ein weiteres Feld dieser Art? „Alles aus" und die Temperatur gibt es
    je einmal, und die beiden Temperatur-Fassungen schließen sich aus. */
export function canAddQuick(items: readonly QuickItem[], kind: QuickKind): boolean {
  if (QUICK_FIELDS - usedFields(items) < (kind === 'climate' ? 2 : 1)) return false;
  if (kind === 'off') return !items.some((item) => item.kind === 'off');
  if (kind === 'climate' || kind === 'climateCompact') return !items.some((item) => item.kind === 'climate' || item.kind === 'climateCompact');
  return true;
}

function newId(): string {
  return `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function parseStep(value: unknown): QuickStep | null {
  const raw = value as Partial<QuickStep> | null;
  if (!raw || typeof raw !== 'object') return null;
  const mode: QuickStepMode = raw.mode === 'on' || raw.mode === 'off' ? raw.mode : 'toggle';
  if (raw.kind === 'vacation') return { kind: 'vacation', mode: 'toggle' };
  if (raw.kind === 'scene' && typeof raw.roomId === 'string' && typeof raw.sceneId === 'string') {
    return { kind: 'scene', roomId: raw.roomId, sceneId: raw.sceneId, mode: 'toggle' };
  }
  if (raw.kind === 'device' && typeof raw.entityId === 'string' && ENTITY_ID.test(raw.entityId)) {
    return { kind: 'device', entityId: raw.entityId, mode };
  }
  return null;
}

/** Liest die gespeicherte Leiste; Unlesbares fällt weg, und was nicht mehr in
    vier Felder passt, auch — die Leiste bricht nie aus ihrem Maß. */
export function parseQuickBar(raw: string | null): QuickItem[] | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return null;
    const items: QuickItem[] = [];
    const seen = new Set<string>();
    for (const value of list) {
      const entry = value as Partial<QuickItem> | null;
      if (!entry || typeof entry !== 'object') continue;
      if (entry.kind !== 'off' && entry.kind !== 'climate' && entry.kind !== 'climateCompact' && entry.kind !== 'action') continue;
      if (!canAddQuick(items, entry.kind)) continue;
      const id = typeof entry.id === 'string' && entry.id && !seen.has(entry.id) ? entry.id : newId();
      seen.add(id);
      items.push({
        id,
        kind: entry.kind,
        name: typeof entry.name === 'string' ? entry.name.slice(0, QUICK_NAME_MAX) : '',
        icon: typeof entry.icon === 'string' && isSafeIconId(entry.icon) ? entry.icon : QUICK_DEFAULT_ICON,
        steps: Array.isArray(entry.steps) ? entry.steps.map(parseStep).filter((step): step is QuickStep => step !== null) : [],
      });
    }
    return items;
  } catch {
    return null;
  }
}

/** Die Vorgabe — mit dem, was der alte rechte Knopf trug. */
export function defaultQuickBar(legacy: { entityId: string | null; icon: string | null }, vacationOn: boolean): QuickItem[] {
  const items: QuickItem[] = [
    { id: 'off', kind: 'off', name: '', icon: 'i-power', steps: [] },
    { id: 'climate', kind: 'climate', name: '', icon: 'i-thermometer', steps: [] },
  ];
  if (legacy.entityId) {
    const entry = deviceManager.catalog.find((item) => item.entityId === legacy.entityId);
    items.push({
      id: 'legacy', kind: 'action', name: (entry?.name ?? '').slice(0, QUICK_NAME_MAX),
      icon: legacy.icon ?? (entry ? defaultIconFor(categoryOf(entry.domain)) : QUICK_DEFAULT_ICON),
      steps: [{ kind: 'device', entityId: legacy.entityId, mode: 'toggle' }],
    });
  } else if (vacationOn) {
    items.push({ id: 'vacation', kind: 'action', name: '', icon: 'i-umbrella-beach', steps: [{ kind: 'vacation', mode: 'toggle' }] });
  }
  return items;
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function load(): QuickItem[] | null {
  try { return parseQuickBar(storage()?.getItem(STORAGE_KEY) ?? null); } catch { return null; }
}

/* `items` bleibt null, bis jemand die Leiste verändert: bis dahin gilt die
   Vorgabe, die den alten Knopf mitliest, sobald der Katalog da ist. */
const state = $state<{ items: QuickItem[] | null }>({ items: load() });

export function quickBarItems(): QuickItem[] {
  return state.items ?? defaultQuickBar(phoneActionConfig, vacationModeActive());
}

function commit(items: QuickItem[]): void {
  state.items = items;
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* gilt bis zum Neuladen */ }
}

export function addQuickItem(kind: QuickKind): QuickItem | null {
  const items = quickBarItems();
  if (!canAddQuick(items, kind)) return null;
  const item: QuickItem = { id: newId(), kind, name: '', icon: kind === 'action' ? QUICK_DEFAULT_ICON : 'i-thermometer', steps: [] };
  commit([...items, item]);
  return item;
}

export function removeQuickItem(id: string): void {
  commit(quickBarItems().filter((item) => item.id !== id));
}

export function moveQuickItem(id: string, targetIndex: number): void {
  const items = [...quickBarItems()];
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return;
  const [item] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, targetIndex)), 0, item);
  commit(items);
}

export function updateQuickItem(id: string, change: (item: QuickItem) => QuickItem): void {
  commit(quickBarItems().map((item) => (item.id === id ? change(structuredClone($state.snapshot(item))) : item)));
}

export function resetQuickBar(): void {
  state.items = null;
  try { storage()?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function deviceOn(entityId: string): boolean {
  return Boolean((runtime.merged(entityId) as { on?: boolean } | undefined)?.on);
}

function setDevice(entityId: string, on: boolean): void {
  const current = runtime.merged(entityId) as Record<string, unknown> | undefined;
  const domain = deviceManager.catalog.find((item) => item.entityId === entityId)?.domain ?? entityId.split('.')[0];
  runtime.dispatch(
    { entityId, domain, service: on ? 'turn_on' : 'turn_off', data: {}, queuedAt: Date.now() },
    { ...(current ?? {}), on },
  );
}

/** Was ein eigener Knopf auslöst: seine Schritte der Reihe nach. */
export function runQuickAction(item: QuickItem): void {
  for (const step of item.steps) {
    if (step.kind === 'scene' && step.roomId && step.sceneId) {
      if (sceneDefOf(step.roomId, step.sceneId)) applyScene(step.roomId, step.sceneId);
    } else if (step.kind === 'device' && step.entityId) {
      setDevice(step.entityId, step.mode === 'toggle' ? !deviceOn(step.entityId) : step.mode === 'on');
    } else if (step.kind === 'vacation') {
      toggleVacationMode();
    }
  }
}

/** Leuchtet der Knopf? Nur, wenn er genau einen schaltbaren Zustand hat. */
export function quickActionActive(item: QuickItem): boolean {
  if (item.steps.length !== 1) return false;
  const [step] = item.steps;
  if (step.kind === 'vacation') return vacationModeActive();
  if (step.kind === 'device' && step.entityId && step.mode === 'toggle') return deviceOn(step.entityId);
  return false;
}

/** Geräte der Schritte gehören ins Abo, sonst bliebe ihr Zustand unbekannt. */
export function quickBarEntityIds(): string[] {
  return quickBarItems().flatMap((item) => item.steps.map((step) => step.entityId).filter((id): id is string => !!id));
}
