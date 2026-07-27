import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_CONFIG,
  LAYOUT_CONFIG_KEY,
  WIDTH_PRESETS,
  addLayoutSlot,
  cloneLayoutConfig,
  loadLayoutConfig,
  parseLayoutConfig,
  reconcileLayoutRooms,
  removeSecondLayoutSlot,
  saveLayoutConfig,
  setSlotRoom,
  setWidthPreset,
  type LayoutStorage,
} from './layout-config.ts';

class MemoryStorage implements LayoutStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe('layout config persistence', () => {
  it('liefert unabhängige sichere Defaults für leere, kaputte und unbekannte Daten', () => {
    const a = parseLayoutConfig(null);
    const b = parseLayoutConfig('{kaputt');
    const c = parseLayoutConfig(JSON.stringify({ version: 99, slots: [] }));
    expect(a).toEqual(DEFAULT_LAYOUT_CONFIG);
    expect(b).toEqual(DEFAULT_LAYOUT_CONFIG);
    expect(c).toEqual(DEFAULT_LAYOUT_CONFIG);
    a.slots[0].roomId = 'mutiert';
    expect(b).toEqual(DEFAULT_LAYOUT_CONFIG);
  });

  it('bereinigt Slots, IDs, Raumkontexte und nicht unterstützte Breitenpresets defensiv', () => {
    expect(parseLayoutConfig(JSON.stringify({
      version: 1,
      widthPreset: 'pixels-723',
      slots: [
        { id: 'falsch', roomId: 'wohnzimmer' },
        { id: 'slot-2', roomId: 42 },
        { id: 'slot-3', roomId: 'extra' },
      ],
    }))).toEqual(DEFAULT_LAYOUT_CONFIG);

    expect(parseLayoutConfig(JSON.stringify({
      version: 1,
      widthPreset: 'wide',
      slots: [{ id: 'slot-1', roomId: 'wohnzimmer' }, { id: 'slot-2', roomId: 'buero' }],
    }))).toEqual({
      version: 1,
      widthPreset: 'wide',
      slots: [{ id: 'slot-1', roomId: 'wohnzimmer' }, { id: 'slot-2', roomId: 'buero' }],
    });
  });

  it('fängt blockiertes Lesen und Schreiben ab und persistiert nur auf explizites Speichern', () => {
    const storage = new MemoryStorage();
    const draft = setWidthPreset(addLayoutSlot(DEFAULT_LAYOUT_CONFIG, 'buero'), 'wide');
    expect(storage.getItem(LAYOUT_CONFIG_KEY)).toBeNull();
    expect(saveLayoutConfig(draft, storage)).toBe(true);
    expect(loadLayoutConfig(storage)).toEqual(draft);

    const blocked: LayoutStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('full'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(loadLayoutConfig(blocked)).toEqual(DEFAULT_LAYOUT_CONFIG);
    expect(saveLayoutConfig(draft, blocked)).toBe(false);
  });
});

describe('layout config updates', () => {
  it('starts with the compact panel width', () => {
    expect(DEFAULT_LAYOUT_CONFIG.widthPreset).toBe('compact');
  });

  it('modelliert genau ein oder zwei Slots mit unabhängigem Raumkontext', () => {
    let config = setSlotRoom(DEFAULT_LAYOUT_CONFIG, 'slot-1', 'wohnzimmer');
    config = addLayoutSlot(config, 'buero');
    config = setSlotRoom(config, 'slot-2', 'schlafzimmer');
    expect(config.slots).toEqual([
      { id: 'slot-1', roomId: 'wohnzimmer' },
      { id: 'slot-2', roomId: 'schlafzimmer' },
    ]);
    expect(addLayoutSlot(config, 'bad')).toEqual(config);
    expect(removeSecondLayoutSlot(config).slots).toEqual([{ id: 'slot-1', roomId: 'wohnzimmer' }]);
  });

  it('nutzt nur robuste Presets mit dokumentierten Mindestbreiten und Hero-Mindestfläche', () => {
    expect(WIDTH_PRESETS.map((preset) => preset.id)).toEqual(['compact', 'balanced', 'wide']);
    for (const preset of WIDTH_PRESETS) {
      expect(preset.slotMinPx).toBeGreaterThanOrEqual(360);
      expect(preset.heroMinPx).toBeGreaterThanOrEqual(420);
      expect(preset.totalPercent).toBeGreaterThan(0);
      expect(preset.totalPercent).toBeLessThan(70);
    }
    expect(setWidthPreset(DEFAULT_LAYOUT_CONFIG, 'wide').widthPreset).toBe('wide');
  });

  it('migriert fehlende Raumkontexte auf den ersten aktuell gültigen Raum', () => {
    const stale = {
      version: 1 as const,
      widthPreset: 'balanced' as const,
      slots: [
        { id: 'slot-1' as const, roomId: 'geloescht' },
        { id: 'slot-2' as const, roomId: null },
      ],
    };
    expect(reconcileLayoutRooms(stale, ['wohnzimmer', 'bad']).slots).toEqual([
      { id: 'slot-1', roomId: 'wohnzimmer' },
      { id: 'slot-2', roomId: 'wohnzimmer' },
    ]);
  });

  it('Updates und Clones mutieren die Eingabe nicht', () => {
    const original = cloneLayoutConfig(DEFAULT_LAYOUT_CONFIG);
    const next = addLayoutSlot(original, 'buero');
    expect(original).toEqual(DEFAULT_LAYOUT_CONFIG);
    expect(next).not.toBe(original);
    expect(next.slots[0]).not.toBe(original.slots[0]);
  });
});
