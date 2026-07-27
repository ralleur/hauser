import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ICONS_BY_CATEGORY,
  isKnownIcon,
  searchIcons,
} from './icon-catalog.ts';
import { iconAssetNameFromId } from './icon-path.ts';
import {
  ICON_RECENT_STORAGE_KEY,
  loadRecentIcons,
  rememberRecentIcon,
} from './icon-recents.ts';

class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length(): number { return this.#data.size; }
  clear(): void { this.#data.clear(); }
  getItem(key: string): string | null { return this.#data.get(key) ?? null; }
  key(index: number): string | null { return [...this.#data.keys()][index] ?? null; }
  removeItem(key: string): void { this.#data.delete(key); }
  setItem(key: string, value: string): void { this.#data.set(key, value); }
}

describe('MDI icon catalog', () => {
  it('enthält den vollständigen MDI-Katalog und alle Kategorie-Defaults', () => {
    expect(searchIcons('', 'all', 10_000).length).toBeGreaterThan(7_000);
    for (const id of Object.values(DEFAULT_ICONS_BY_CATEGORY)) expect(isKnownIcon(id)).toBe(true);
  });

  it('findet englische Namen und kuratierte deutsche Smart-Home-Begriffe', () => {
    expect(searchIcons('router', 'all', 20).map((icon) => icon.id)).toContain('i-router');
    expect(searchIcons('tür', 'all', 30).some((icon) => icon.name.includes('door'))).toBe(true);
    expect(searchIcons('heizung', 'climate', 30).some((icon) => icon.name.includes('radiator') || icon.name.includes('thermometer'))).toBe(true);
  });

  it('filtert Kategorien und erhält historische Icon-IDs über Aliase', () => {
    const lights = searchIcons('', 'light', 100);
    expect(lights.some((icon) => icon.id === 'i-lightbulb')).toBe(true);
    expect(lights.every((icon) => icon.categories.includes('light'))).toBe(true);
    expect(iconAssetNameFromId('i-lamp-floor')).toBe('floor-lamp');
    expect(iconAssetNameFromId('i-led-strip')).toBe('led-strip');
  });
});

describe('zuletzt verwendete Icons', () => {
  it('speichert maximal zehn gültige IDs in MRU-Reihenfolge', () => {
    const storage = new MemoryStorage();
    for (const id of ['i-lightbulb', 'i-router', 'i-door-closed', 'i-window-closed', 'i-fire', 'i-fan', 'i-power-plug', 'i-television', 'i-speaker', 'i-gauge', 'i-home']) {
      rememberRecentIcon(id, storage);
    }
    expect(loadRecentIcons(storage)).toEqual(['i-home', 'i-gauge', 'i-speaker', 'i-television', 'i-power-plug', 'i-fan', 'i-fire', 'i-window-closed', 'i-door-closed', 'i-router']);
    expect(storage.getItem(ICON_RECENT_STORAGE_KEY)).not.toBeNull();
  });

  it('ignoriert kaputte und unbekannte gespeicherte IDs defensiv', () => {
    const storage = new MemoryStorage();
    storage.setItem(ICON_RECENT_STORAGE_KEY, JSON.stringify(['i-router', 'i-unbekannt', 42]));
    expect(loadRecentIcons(storage)).toEqual(['i-router']);
    storage.setItem(ICON_RECENT_STORAGE_KEY, '{kaputt');
    expect(loadRecentIcons(storage)).toEqual([]);
  });
});
