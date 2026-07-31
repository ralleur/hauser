import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_IMMERSION_LIGHT_CONFIG,
  IMMERSION_LIGHT_CONFIG_KEY,
  loadImmersionLightConfig,
  parseImmersionLightConfig,
  saveImmersionLightConfig,
} from './immersion-light.ts';
import { immersionLight, rehydrateImmersionLight } from './immersion-light.svelte.ts';

afterEach(() => vi.unstubAllGlobals());

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('immersion light config', () => {
  it('rehydriert die vor Bootstrap erzeugte Immersion-Konfiguration aus dem neuen Storage-Stand', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const oldConfig = {
      version: 1 as const,
      rooms: { kueche: { 'light.old': { x: 0.2, y: 0.3, radius: 0.1 } } },
    };
    const centralConfig = {
      version: 1 as const,
      rooms: { wohnzimmer: { 'light.central': { x: 0.7, y: 0.4, radius: 0.2 } } },
    };
    storage.setItem(IMMERSION_LIGHT_CONFIG_KEY, JSON.stringify(oldConfig));
    rehydrateImmersionLight();
    expect(immersionLight.config).toEqual(oldConfig);

    storage.setItem(IMMERSION_LIGHT_CONFIG_KEY, JSON.stringify(centralConfig));
    rehydrateImmersionLight();

    expect(immersionLight.config).toEqual(centralConfig);
  });

  it('round-trips valid room placements', () => {
    const storage = new MemoryStorage();
    const config = {
      version: 1 as const,
      rooms: { wohnzimmer: { 'light.floor': { x: 0.75, y: 0.4, radius: 0.18 } } },
    };
    saveImmersionLightConfig(config, storage);
    expect(storage.data.has(IMMERSION_LIGHT_CONFIG_KEY)).toBe(true);
    expect(loadImmersionLightConfig(storage)).toEqual(config);
  });

  it('drops invalid entities and coordinates', () => {
    const parsed = parseImmersionLightConfig(JSON.stringify({
      version: 1,
      rooms: {
        bad: {
          'switch.no_light': { x: 0.2, y: 0.2, radius: 0.1 },
          'light.outside': { x: 2, y: 0.2, radius: 0.1 },
        },
      },
    }));
    expect(parsed).toEqual(EMPTY_IMMERSION_LIGHT_CONFIG);
  });

  it('uses the default radius for an otherwise valid placement', () => {
    expect(parseImmersionLightConfig(JSON.stringify({
      version: 1,
      rooms: { bad: { 'light.ceiling': { x: 0.5, y: 0.25 } } },
    })).rooms.bad['light.ceiling'].radius).toBe(0.16);
  });
});
