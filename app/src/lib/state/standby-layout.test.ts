import { describe, expect, it } from 'vitest';
import {
  STANDBY_LAYOUT_KEY,
  STANDBY_SIZE_DEFAULT,
  anchorExtents,
  anchorPoint,
  clampStandbyAxis,
  loadStandbyLayout,
  parseStandbyLayout,
  placeStandbyMenu,
  saveStandbyLayout,
  standbyScale,
} from './standby-layout.ts';
import type { LayoutStorage } from './layout-config.ts';
import { HOSTILE_STANDBY_LAYOUTS } from '../stresshaus/hostile-home.ts';

class MemoryStorage implements LayoutStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe('Ruhebild-Anordnung', () => {
  it('ohne Eintrag bleibt das CSS die Wahrheit', () => {
    expect(parseStandbyLayout(null)).toBeNull();
    expect(parseStandbyLayout('')).toBeNull();
    expect(parseStandbyLayout('{"version":1,"elements":{}}')).toBeNull();
    expect(loadStandbyLayout(new MemoryStorage())).toBeNull();
  });

  it('nimmt einen sauberen Stand und rundet ihn ins Bild', () => {
    const layout = parseStandbyLayout('{"version":1,"elements":{"clock":{"x":40.26,"y":30,"size":4},"week":{"x":50,"y":90}}}');
    expect(layout).toEqual({ clock: { x: 40.3, y: 30, size: 4 }, week: { x: 50, y: 90, size: STANDBY_SIZE_DEFAULT } });
  });

  it.each(HOSTILE_STANDBY_LAYOUTS)('Stresshaus „$name“: kein gespeicherter Stand kippt oder verlässt das Bild', ({ raw }) => {
    expect(() => parseStandbyLayout(raw)).not.toThrow();
    const layout = parseStandbyLayout(raw);
    for (const placement of Object.values(layout ?? {})) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.x).toBeLessThanOrEqual(100);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeLessThanOrEqual(100);
      expect(placement.size).toBeGreaterThanOrEqual(1);
      expect(placement.size).toBeLessThanOrEqual(5);
      expect(Number.isFinite(standbyScale(placement.size))).toBe(true);
    }
    expect(Object.keys(layout ?? {}).every((key) => ['clock', 'weather', 'week', 'shopping', 'postits'].includes(key))).toBe(true);
  });

  it('speichert bereinigt und löscht mit null', () => {
    const storage = new MemoryStorage();
    expect(saveStandbyLayout({ clock: { x: 120, y: -5, size: 9 } }, storage)).toBe(true);
    expect(loadStandbyLayout(storage)).toEqual({ clock: { x: 100, y: 0, size: 5 } });
    expect(saveStandbyLayout(null, storage)).toBe(true);
    expect(storage.data.has(STANDBY_LAYOUT_KEY)).toBe(false);
    expect(saveStandbyLayout({ clock: { x: Number.NaN, y: 1, size: 3 } }, storage)).toBe(true);
    expect(storage.data.has(STANDBY_LAYOUT_KEY)).toBe(false);
  });

  it('gesperrter Speicher blockiert die Oberfläche nicht', () => {
    const blocked: LayoutStorage = {
      getItem() { throw new Error('gesperrt'); },
      setItem() { throw new Error('gesperrt'); },
      removeItem() { throw new Error('gesperrt'); },
    };
    expect(loadStandbyLayout(blocked)).toBeNull();
    expect(saveStandbyLayout({ clock: { x: 1, y: 1, size: 3 } }, blocked)).toBe(false);
  });

  it('hält den Anker so, dass das Element im Bild bleibt', () => {
    expect(clampStandbyAxis(2, 10, 10)).toBe(10);
    expect(clampStandbyAxis(97, 10, 10)).toBe(90);
    expect(clampStandbyAxis(50, 80, 80)).toBe(50);
    expect(clampStandbyAxis(33.333, 0, 0)).toBe(33.3);
    /* Unten verankert: nur nach oben ragt etwas über den Anker hinaus. */
    expect(clampStandbyAxis(99, 20, 0)).toBe(99);
    expect(clampStandbyAxis(5, 20, 0)).toBe(20);
    /* Höher als die Fläche, oben verankert: mittig, Anker über dem Rand. */
    expect(clampStandbyAxis(30, 0, 140)).toBe(-20);
  });

  it('jedes Element hat seinen Anker: Band unten, Zettel oben, Uhr und Wetter mittig', () => {
    const box = { left: 100, top: 200, width: 200, height: 50 };
    expect(anchorPoint(box, 'center')).toEqual({ x: 200, y: 225 });
    expect(anchorPoint(box, 'top')).toEqual({ x: 200, y: 200 });
    expect(anchorPoint(box, 'bottom')).toEqual({ x: 200, y: 250 });
    expect(anchorExtents(box, 'bottom')).toEqual({ left: 100, right: 100, top: 50, bottom: 0 });
    expect(anchorExtents(box, 'top')).toEqual({ left: 100, right: 100, top: 0, bottom: 50 });
    expect(anchorExtents(box, 'center')).toEqual({ left: 100, right: 100, top: 25, bottom: 25 });
  });

  it('das Menü wechselt die Seite, sobald rechts der Platz fehlt, und kehrt zurück', () => {
    const surface = { width: 1000, height: 600 };
    const menu = { width: 56, height: 104 };
    const middle = placeStandbyMenu({ left: 400, top: 200, width: 200, height: 100 }, menu, surface);
    expect(middle).toEqual({ left: 612, top: 198, flipped: false });
    const edge = placeStandbyMenu({ left: 780, top: 200, width: 200, height: 100 }, menu, surface);
    expect(edge).toEqual({ left: 712, top: 198, flipped: true });
    const back = placeStandbyMenu({ left: 700, top: 200, width: 200, height: 100 }, menu, surface);
    expect(back.flipped).toBe(false);
    const top = placeStandbyMenu({ left: 0, top: -30, width: 100, height: 40 }, menu, surface);
    expect(top.top).toBe(8);
    const bottom = placeStandbyMenu({ left: 0, top: 590, width: 100, height: 40 }, menu, surface);
    expect(bottom.top).toBe(600 - 104 - 8);
  });
});
