import type { SunValue } from '../adapter/types.ts';
import type { UiTheme } from './room-hero-assets.ts';

export type EnergyVariant = 'day' | 'night';

export interface EnergyAssetInput {
  baseUrl: string;
  sun: SunValue | undefined;
  fallbackTheme: UiTheme;
}

/**
 * Energy-Eyecatcher folgt wie RoomHero der realen Tageszeit (`sun.sun`), nicht
 * dem manuellen UI-Theme. Der Theme-Toggle darf Lesbarkeit/Surfaces ändern,
 * aber nicht den Energie-Motivzustand verfälschen.
 */
export function selectEnergyVariant(sun: SunValue | undefined, fallbackTheme: UiTheme): EnergyVariant {
  if (sun) return sun.day ? 'day' : 'night';
  return fallbackTheme === 'light' ? 'day' : 'night';
}

export function energyAssetUrl({ baseUrl, sun, fallbackTheme }: EnergyAssetInput): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const variant = selectEnergyVariant(sun, fallbackTheme);
  return `${base}energy/${variant}.avif`;
}

/* Wo die Zahlen im Bild sitzen (R4, docs/23): Sonne, Haus und Netz sind Orte
   im Motiv, keine Kacheln daneben. Jede Marke hat zwei Punkte — `point` ist
   die Stelle im Motiv (Sonne, Wechselrichter, Strommast), `note` der Platz des
   Zettels auf einer ruhigen Fläche. Eine Haarlinie verbindet beide, damit der
   Zettel angeheftet wirkt statt zu schweben. Alle Werte sind Prozent *im
   Bild*; die Bühne rechnet daraus über `ratio` das Cover-Rechteck, damit
   Zettel und Linie beim Zuschnitt am Motiv bleiben.

   Seit R14a liegen die Anker nicht mehr im Code, sondern als Datei neben dem
   Bild (`day.avif` → `day.json`): Ein Motiv bringt seine Anker mit, und ein
   eigenes Haus aus dem Assistenten kann dieselbe Form liefern. */
export interface EnergyMarkAnchor {
  /** Stelle im Motiv, auf die die Marke zeigt. */
  point: { x: number; y: number };
  /** Platz des Zettels. */
  note: { x: number; y: number };
  tilt: number;
}

export interface EnergyHeroFrame {
  ratio: number;
  sun: EnergyMarkAnchor;
  house: EnergyMarkAnchor;
  grid: EnergyMarkAnchor;
}

/** Seitenverhältnis, bis die Ankerdatei da ist — die Bühne darf nie leer sein. */
export const ENERGY_HERO_DEFAULT_RATIO = 3 / 2;

export function energyFrameUrl(imageUrl: string): string {
  return imageUrl.replace(/\.(avif|png|webp|jpe?g)$/i, '.json');
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isPoint(value: unknown): value is { x: number; y: number } {
  const candidate = value as { x?: unknown; y?: unknown } | null;
  return Boolean(candidate) && isPercent(candidate?.x) && isPercent(candidate?.y);
}

function isAnchor(value: unknown): value is EnergyMarkAnchor {
  const candidate = value as Partial<EnergyMarkAnchor> | null;
  return Boolean(candidate) && isPoint(candidate?.point) && isPoint(candidate?.note)
    && typeof candidate?.tilt === 'number' && Number.isFinite(candidate.tilt);
}

/** Prüft die Ankerdatei; alles andere als die genaue Form ist kein Frame. */
export function parseEnergyHeroFrame(value: unknown): EnergyHeroFrame | null {
  const candidate = value as Partial<EnergyHeroFrame> | null;
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof candidate.ratio !== 'number' || !Number.isFinite(candidate.ratio) || candidate.ratio <= 0) return null;
  if (!isAnchor(candidate.sun) || !isAnchor(candidate.house) || !isAnchor(candidate.grid)) return null;
  return { ratio: candidate.ratio, sun: candidate.sun, house: candidate.house, grid: candidate.grid };
}

const frames = new Map<string, Promise<EnergyHeroFrame | null>>();

/** Lädt die Anker eines Motivs einmal je URL; ohne Datei gibt es keine Marken,
    das Bild bleibt (R3: was nicht verortet ist, wird nicht behauptet). */
export function loadEnergyHeroFrame(url: string, fetchImpl: typeof fetch = fetch): Promise<EnergyHeroFrame | null> {
  let pending = frames.get(url);
  if (!pending) {
    pending = fetchImpl(url)
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => parseEnergyHeroFrame(json))
      .catch(() => null);
    frames.set(url, pending);
  }
  return pending;
}

/* ── Das eigene Haus (R14b, docs/23) ──
   Hat der Haushalt dem Ziel „Draußen" ein Bildset zugewiesen, ist es die
   Bühne des Energie-Screens: `light` am Tag, `dark` in der Nacht — dieselben
   Dateien wie bei einem Raum. Die Anker kommen dann nicht aus einer Datei,
   sondern aus der Vorlage (docs/energy-hero-safe-area-template.svg) und den
   erkannten Flächen: die Erzeugung hängt an den Modulen, die Last an einem
   Fenster, das Netz zeigt zum rechten Bildrand — das Netz liegt außerhalb
   des Bildes, das ist keine Ausrede, sondern die Wahrheit. */

export interface RegionLike {
  kind: string;
  points: ReadonlyArray<{ x: number; y: number }>;
}

/** Bildset des Assistenten: 1536×1024. */
export const EXTERIOR_HERO_RATIO = 1536 / 1024;

export function exteriorAssetUrl(assetId: string, variant: EnergyVariant): string {
  return `/assets/room-images/${assetId}/${variant === 'day' ? 'light' : 'dark'}.avif`;
}

function polygonArea(points: RegionLike['points']): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function largestCentroid(regions: readonly RegionLike[], kind: string): { x: number; y: number } | null {
  let best: RegionLike | null = null;
  let bestArea = 0;
  for (const region of regions) {
    if (region.kind !== kind || region.points.length < 3) continue;
    const area = polygonArea(region.points);
    if (area > bestArea) { best = region; bestArea = area; }
  }
  if (!best) return null;
  const n = best.points.length;
  const sum = best.points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: Math.round((sum.x / n) * 1000) / 10, y: Math.round((sum.y / n) * 1000) / 10 };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Zettel links oberhalb seines Punktes, auf dem Bild gehalten. */
function noteBeside(point: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  return { x: clamp(point.x + dx, 8, 92), y: clamp(point.y + dy, 8, 90) };
}

/* Die Vorlage: Sonne oben rechts, Haustür rechts der Mitte, Netz am Rand. */
/* Die Sonne sitzt beim Zuschnitt auf 16:9 sonst unter der Statusleiste:
   ein 3:2-Set verliert oben rund acht Prozent. */
const EXTERIOR_TEMPLATE = {
  sun: { point: { x: 88, y: 18 }, note: { x: 70, y: 26 } },
  house: { point: { x: 60, y: 62 }, note: { x: 30, y: 60 } },
  grid: { point: { x: 97, y: 52 }, note: { x: 78, y: 78 } },
};

export function exteriorHeroFrame(regions: readonly RegionLike[]): EnergyHeroFrame {
  const solar = largestCentroid(regions, 'solar');
  const window = largestCentroid(regions, 'window');
  return {
    ratio: EXTERIOR_HERO_RATIO,
    sun: solar
      ? { point: solar, note: noteBeside(solar, -22, -10), tilt: -1.1 }
      : { ...EXTERIOR_TEMPLATE.sun, tilt: -1.1 },
    house: window
      ? { point: window, note: noteBeside(window, -26, 2), tilt: 0.7 }
      : { ...EXTERIOR_TEMPLATE.house, tilt: 0.7 },
    grid: { ...EXTERIOR_TEMPLATE.grid, tilt: -0.6 },
  };
}

/* ── Zettel bleiben im Bild (R21, Owner-Wunsch) ──
   Das Cover-Rechteck ragt über den Bildschirm hinaus, und oben links liegt
   die Zusammenfassung. Ein Zettel darf weder aus dem Sichtbaren wandern noch
   die Zusammenfassung verdecken — egal ob aus Vorlage, Erkennung oder Hand.
   Alle Maße in Bildprozent, wie die Anker selbst. */
export interface PlacementRect { x0: number; y0: number; x1: number; y1: number }
export interface PlacementBounds {
  /** Sichtbarer Ausschnitt des Bildes. */
  visible: PlacementRect;
  /** Flächen, die kein Zettel verdecken darf (Zusammenfassung, Leiste). */
  blocked: PlacementRect[];
  /** Größe eines Zettels in Bildprozent. */
  note: { w: number; h: number };
}

const clampTo = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value)));

function intersects(a: PlacementRect, b: PlacementRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function placeNote(note: { x: number; y: number }, bounds: PlacementBounds): { x: number; y: number } {
  const { visible, note: size } = bounds;
  const hw = size.w / 2;
  const hh = size.h / 2;
  const gap = 1.5;
  let x = clampTo(note.x, visible.x0 + hw + gap, visible.x1 - hw - gap);
  let y = clampTo(note.y, visible.y0 + hh + gap, visible.y1 - hh - gap);
  for (const block of bounds.blocked) {
    const box = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
    if (!intersects(box, block)) continue;
    /* Vier Auswege, der kürzeste gewinnt — solange er im Sichtbaren bleibt. */
    const candidates = [
      { x, y: block.y1 + gap + hh },
      { x: block.x1 + gap + hw, y },
      { x, y: block.y0 - gap - hh },
      { x: block.x0 - gap - hw, y },
    ].filter((c) => c.x - hw >= visible.x0 && c.x + hw <= visible.x1 && c.y - hh >= visible.y0 && c.y + hh <= visible.y1);
    if (!candidates.length) continue;
    const best = candidates.reduce((a, b) => (Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b));
    x = best.x;
    y = best.y;
  }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function placePoint(point: { x: number; y: number }, visible: PlacementRect): { x: number; y: number } {
  return {
    x: Math.round(clampTo(point.x, visible.x0 + 1, visible.x1 - 1) * 10) / 10,
    y: Math.round(clampTo(point.y, visible.y0 + 1, visible.y1 - 1) * 10) / 10,
  };
}

export function placeFrame(frame: EnergyHeroFrame, bounds: PlacementBounds | null): EnergyHeroFrame {
  if (!bounds) return frame;
  const place = (anchor: EnergyMarkAnchor): EnergyMarkAnchor => ({
    point: placePoint(anchor.point, bounds.visible),
    note: placeNote(anchor.note, bounds),
    tilt: anchor.tilt,
  });
  return { ratio: frame.ratio, sun: place(frame.sun), house: place(frame.house), grid: place(frame.grid) };
}
