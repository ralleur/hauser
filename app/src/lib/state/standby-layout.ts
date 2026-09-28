/* ── Ruhebild anpassen (R63) ──
   Uhr, Wetter, Wochenband, Einkaufsliste und Zettel haben am Panel feste
   Plätze aus dem CSS. Wer sie verschiebt oder vergrößert, legt je Element
   einen Platz ab: Mittelpunkt in Prozent der Fläche und eine Größenstufe.
   Ohne Eintrag bleibt das CSS die Wahrheit — alte Stände sehen nichts anders.

   Gerätelokal wie die übrigen Standby-Schalter: das Wandpanel und das iPad
   haben verschiedene Formate, ihr Ruhebild ist je Gerät eingerichtet. Die
   iOS-App liest und schreibt dieselbe Form (StandbyLayout.swift). */

import type { LayoutStorage } from './layout-config.ts';

export const STANDBY_LAYOUT_KEY = 'hmi:standby-layout:v1';

export const STANDBY_ELEMENTS = ['clock', 'weather', 'week', 'shopping', 'postits'] as const;
export type StandbyElement = (typeof STANDBY_ELEMENTS)[number];

export interface StandbyPlacement {
  /** Ankerpunkt in Prozent der Ruhebild-Fläche, 0 bis 100 (siehe STANDBY_ANCHORS). */
  x: number;
  y: number;
  /** Größenstufe 1 bis 5; 3 ist die gewohnte Größe. */
  size: number;
}

/** Wo der gespeicherte Punkt am Element sitzt — und von wo aus es wächst:
 *  das Wochenband hängt am unteren Rand und wächst nach oben, Zettel und
 *  Einkaufsliste hängen oben und wachsen nach unten, Uhr und Wetter stehen um
 *  ihre Mitte. So bleibt ein Element an seinem Rand, wenn Termine oder Artikel
 *  dazukommen. Dieselbe Regel gilt in der iOS-App. */
export type StandbyAnchor = 'center' | 'top' | 'bottom';
export const STANDBY_ANCHORS: Record<StandbyElement, StandbyAnchor> = {
  clock: 'center', weather: 'center', week: 'bottom', shopping: 'top', postits: 'top',
};

/** Ankerpunkt eines gemessenen Kastens. */
export function anchorPoint(box: { left: number; top: number; width: number; height: number }, anchor: StandbyAnchor): { x: number; y: number } {
  const y = anchor === 'top' ? box.top : anchor === 'bottom' ? box.top + box.height : box.top + box.height / 2;
  return { x: box.left + box.width / 2, y };
}

/** Ausdehnung des Kastens vom Anker aus (vor/nach dem Anker je Achse). */
export function anchorExtents(size: { width: number; height: number }, anchor: StandbyAnchor): { left: number; right: number; top: number; bottom: number } {
  const top = anchor === 'top' ? 0 : anchor === 'bottom' ? size.height : size.height / 2;
  return { left: size.width / 2, right: size.width / 2, top, bottom: size.height - top };
}

export type StandbyLayout = Partial<Record<StandbyElement, StandbyPlacement>>;

export const STANDBY_SIZE_MIN = 1;
export const STANDBY_SIZE_MAX = 5;
export const STANDBY_SIZE_DEFAULT = 3;
/* Stufen als Faktor: zwei kleiner, zwei größer als gewohnt. */
const SIZE_SCALE: readonly number[] = [0.6, 0.8, 1, 1.25, 1.5];

export function standbyScale(size: number): number {
  return SIZE_SCALE[clampSize(size) - 1];
}

export function clampSize(size: unknown): number {
  const value = typeof size === 'number' && Number.isFinite(size) ? Math.round(size) : STANDBY_SIZE_DEFAULT;
  return Math.min(STANDBY_SIZE_MAX, Math.max(STANDBY_SIZE_MIN, value));
}

function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

export function isStandbyElement(value: unknown): value is StandbyElement {
  return typeof value === 'string' && (STANDBY_ELEMENTS as readonly string[]).includes(value);
}

/** Ein Platz aus fremder Hand: unlesbare Koordinaten machen ihn ungültig,
 *  eine unlesbare Größe fällt auf die gewohnte zurück. */
export function parseStandbyPlacement(value: unknown): StandbyPlacement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const x = clampPercent(candidate.x);
  const y = clampPercent(candidate.y);
  if (x === null || y === null) return null;
  return { x, y, size: clampSize(candidate.size) };
}

/** `null` heißt: kein eigenes Layout, das CSS bestimmt die Plätze. Unbekannte
 *  Elemente und kaputte Einträge fallen still heraus. */
export function parseStandbyLayout(raw: string | null): StandbyLayout | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  const elements = candidate.elements;
  if (!elements || typeof elements !== 'object' || Array.isArray(elements)) return null;
  const layout: StandbyLayout = {};
  for (const [key, entry] of Object.entries(elements as Record<string, unknown>)) {
    if (!isStandbyElement(key)) continue;
    const placement = parseStandbyPlacement(entry);
    if (placement) layout[key] = placement;
  }
  return Object.keys(layout).length ? layout : null;
}

export function serializeStandbyLayout(layout: StandbyLayout): string {
  return JSON.stringify({ version: 1, elements: layout });
}

function browserStorage(): LayoutStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; }
  catch { return undefined; }
}

export function loadStandbyLayout(storage: LayoutStorage | undefined = browserStorage()): StandbyLayout | null {
  if (!storage) return null;
  try { return parseStandbyLayout(storage.getItem(STANDBY_LAYOUT_KEY)); }
  catch { return null; }
}

/** `null` löscht das Layout — das Ruhebild kehrt zu seinen gewohnten Plätzen zurück. */
export function saveStandbyLayout(layout: StandbyLayout | null, storage: LayoutStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    const clean = layout ? parseStandbyLayout(serializeStandbyLayout(layout)) : null;
    if (clean) storage.setItem(STANDBY_LAYOUT_KEY, serializeStandbyLayout(clean));
    else storage.removeItem(STANDBY_LAYOUT_KEY);
    return true;
  } catch { return false; }
}

/** Hält den Anker so, dass das Element ganz im Bild bleibt: `before` und
 *  `after` sind seine Ausdehnung vor und hinter dem Anker in Prozent der
 *  Fläche. Ist das Element größer als die Fläche, steht es mittig. */
export function clampStandbyAxis(value: number, before: number, after: number): number {
  const min = Math.max(0, before);
  const max = 100 - Math.max(0, after);
  const rounded = Math.round(value * 10) / 10;
  if (min > max) return Math.round(((min + max) / 2) * 10) / 10;
  return Math.min(max, Math.max(min, rounded));
}

export interface StandbyMenuBox { left: number; top: number; flipped: boolean }

/** Das Kontextmenü steht rechts neben dem Element; fehlt dort der Platz,
 *  wandert es nach links — und zurück, sobald rechts wieder Platz ist.
 *  Senkrecht bleibt es innerhalb der Fläche. */
export function placeStandbyMenu(
  element: { left: number; top: number; width: number; height: number },
  menu: { width: number; height: number },
  surface: { width: number; height: number },
  gap = 12,
  inset = 8,
): StandbyMenuBox {
  let left = element.left + element.width + gap;
  let flipped = false;
  if (left + menu.width > surface.width - inset) {
    left = element.left - gap - menu.width;
    flipped = true;
  }
  left = Math.max(inset, Math.min(surface.width - menu.width - inset, left));
  const centered = element.top + element.height / 2 - menu.height / 2;
  const top = Math.max(inset, Math.min(surface.height - menu.height - inset, centered));
  return { left, top, flipped };
}
