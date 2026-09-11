import { describe, expect, it } from 'vitest';
import {
  LIGHT_ICON_OVERRIDE_STORAGE_KEY,
  defaultIconFor,
  iconForDevice,
  iconForLightSeed,
  persistLightIconOverride,
  resetLightIconOverride,
  sensorIconFor,
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

describe('Sensor-Symbole nach Name (sensorIconFor)', () => {
  it('nimmt die device_class vor allem anderen', () => {
    expect(sensorIconFor({ name: 'Wohnzimmer Temperatur', deviceClass: 'battery' })).toBe('i-battery');
    expect(sensorIconFor({ deviceClass: 'humidity' })).toBe('i-water-percent');
    expect(sensorIconFor({ deviceClass: 'motion' })).toBe('i-motion-sensor');
  });

  it('liest die Einheit, wenn keine device_class da ist', () => {
    expect(sensorIconFor({ name: 'Sensor 1', unit: '°C' })).toBe('i-thermometer');
    expect(sensorIconFor({ name: 'Sensor 2', unit: 'kWh' })).toBe('i-lightning-bolt');
    expect(sensorIconFor({ name: 'Sensor 3', unit: 'V' })).toBe('i-sine-wave');
    expect(sensorIconFor({ name: 'Sensor 4', unit: 'W' })).toBe('i-flash');
  });

  it('erkennt deutsche und englische Wörter im Namen und in der entity_id', () => {
    expect(sensorIconFor({ name: 'Temperature/Humidity Sensor D3F1 Battery' })).toBe('i-battery');
    expect(sensorIconFor({ name: 'Batteriespannung' })).toBe('i-battery');
    expect(sensorIconFor({ name: 'Luftfeuchtigkeit Bad' })).toBe('i-water-percent');
    expect(sensorIconFor({ name: '.', entityId: 'sensor.heizung_bad_temperatur' })).toBe('i-thermometer');
    expect(sensorIconFor({ name: 'Netzspannung L1' })).toBe('i-sine-wave');
    expect(sensorIconFor({ name: 'Aktuelle Leistung' })).toBe('i-flash');
    expect(sensorIconFor({ name: 'Stromverbrauch heute' })).toBe('i-lightning-bolt');
    expect(sensorIconFor({ name: 'CO2 Büro' })).toBe('i-molecule-co2');
    expect(sensorIconFor({ name: 'WLAN Signal' })).toBe('i-signal');
  });

  it('bleibt beim Messinstrument, wenn nichts passt', () => {
    expect(sensorIconFor({ name: 'Irgendwas', entityId: 'sensor.xyz' })).toBe(defaultIconFor('info'));
  });
});
