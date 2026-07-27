import { describe, expect, it } from 'vitest';
import {
  LIGHT_ICON_OVERRIDE_STORAGE_KEY,
  defaultIconFor,
  iconForDevice,
  iconForLightSeed,
  persistLightIconOverride,
  resetLightIconOverride,
  storedLightIconOverrides,
} from './light-icons.ts';

class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length(): number { return this.#data.size; }
  clear(): void { this.#data.clear(); }
  getItem(key: string): string | null { return this.#data.get(key) ?? null; }
  key(index: number): string | null { return [...this.#data.keys()][index] ?? null; }
  removeItem(key: string): void { this.#data.delete(key); }
  setItem(key: string, value: string): void { this.#data.set(key, value); }
}

const seed = { entityId: 'light.test', icon: 'i-lamp-pendant' };

describe('light icon persistence', () => {
  it('liest gespeicherte Overrides pro realer entity_id und lässt den Seed unverändert', () => {
    const storage = new MemoryStorage();
    storage.setItem(LIGHT_ICON_OVERRIDE_STORAGE_KEY, JSON.stringify({ 'light.test': 'i-led-strip' }));

    expect(iconForLightSeed(seed, storage)).toBe('i-led-strip');
    expect(iconForLightSeed({ entityId: 'light.other', icon: 'i-lamp-floor' }, storage)).toBe('i-lamp-floor');
  });

  it('persistiert und resetet Overrides ohne HA-Adapter-Schreibaktion', () => {
    const storage = new MemoryStorage();

    persistLightIconOverride('light.test', 'i-lamp-table', storage);
    expect(storedLightIconOverrides(storage)).toEqual({ 'light.test': 'i-lamp-table' });
    expect(iconForLightSeed(seed, storage)).toBe('i-lamp-table');

    resetLightIconOverride('light.test', storage);
    expect(storedLightIconOverrides(storage)).toEqual({});
    expect(iconForLightSeed(seed, storage)).toBe('i-lamp-pendant');
  });

  it('ignoriert unbekannte Icons und kaputte Storage-Werte defensiv', () => {
    const storage = new MemoryStorage();
    storage.setItem(LIGHT_ICON_OVERRIDE_STORAGE_KEY, '{not-json');
    expect(iconForLightSeed(seed, storage)).toBe('i-lamp-pendant');

    storage.setItem(LIGHT_ICON_OVERRIDE_STORAGE_KEY, JSON.stringify({ 'light.test': 'does-not-exist' }));
    expect(iconForLightSeed(seed, storage)).toBe('i-lamp-pendant');
  });
});

describe('kategoriebewusste Symbol-Auflösung (iconForDevice)', () => {
  it('Kategorie-Default, wenn weder Override noch Seed-Symbol existiert', () => {
    const storage = new MemoryStorage();
    expect(iconForDevice('sensor.aussen', 'info', undefined, storage)).toBe(defaultIconFor('info'));
    expect(iconForDevice('switch.regal', 'switch', undefined, storage)).toBe('i-bolt');
    expect(iconForDevice('climate.buero', 'temp', undefined, storage)).toBe('i-thermometer');
    expect(iconForDevice('media_player.tv', 'media', undefined, storage)).toBe('i-playlist-music');
  });

  it('Override gewinnt über Seed, ungültiges Seed-Symbol fällt auf den Default', () => {
    const storage = new MemoryStorage();
    persistLightIconOverride('sensor.aussen', 'i-droplet', storage);
    expect(iconForDevice('sensor.aussen', 'info', undefined, storage)).toBe('i-droplet');
    expect(iconForDevice('light.test', 'light', 'i-lamp-floor', storage)).toBe('i-lamp-floor');
    expect(iconForDevice('light.test', 'light', 'kaputt', storage)).toBe('i-bulb');
  });

  it('Overrides aus fremden Kategorie-Sets bleiben gültig (Union-Valid-Set)', () => {
    const storage = new MemoryStorage();
    persistLightIconOverride('switch.ventilator', 'i-fan', storage);
    expect(storedLightIconOverrides(storage)).toEqual({ 'switch.ventilator': 'i-fan' });
  });

});
