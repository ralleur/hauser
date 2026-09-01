import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* setHaUrl/Override-Lesen (B-17): der HA-Endpunkt wird — wie die Jellyfin-URL —
   als localStorage-Override vor dem Env-Default gehalten. Der Test läuft im
   node-Env (keine echte Storage), daher ein minimaler In-Memory-Stub. */

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

async function freshSettings() {
  vi.resetModules();
  return await import('./settings.svelte.ts');
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setHaUrl', () => {
  it('persistiert getrimmte URL ohne Endslash und meldet Neuladen-Bedarf', async () => {
    const { settingsValues, setHaUrl, settingsUi } = await freshSettings();
    settingsUi.needsReload = false;

    setHaUrl('  http://homeassistant.local:8123/  ');

    expect(settingsValues.haUrl).toBe('http://homeassistant.local:8123');
    expect(localStorage.getItem('hmi:ha-url')).toBe('http://homeassistant.local:8123');
    expect(settingsUi.needsReload).toBe(true);
  });

  it('leerer Wert entfernt den Override (zurück auf Env-Default)', async () => {
    const { settingsValues, setHaUrl } = await freshSettings();
    setHaUrl('http://host:8123');
    expect(localStorage.getItem('hmi:ha-url')).not.toBeNull();

    setHaUrl('   ');

    expect(settingsValues.haUrl).toBe('');
    expect(localStorage.getItem('hmi:ha-url')).toBeNull();
  });

  it('initialer haUrl-Wert spiegelt den gespeicherten Override', async () => {
    localStorage.setItem('hmi:ha-url', 'http://gespeichert:8123');

    const { settingsValues } = await freshSettings();

    expect(settingsValues.haUrl).toBe('http://gespeichert:8123');
  });
});

describe('setAmbientHeroText', () => {
  it('ist standardmäßig aus und persistiert nur das Einschalten', async () => {
    const { settingsValues, setAmbientHeroText } = await freshSettings();
    expect(settingsValues.ambientHeroText).toBe(false);

    setAmbientHeroText(true);
    expect(settingsValues.ambientHeroText).toBe(true);
    expect(localStorage.getItem('hmi:ambient-hero-text')).toBe('on');

    setAmbientHeroText(false);
    expect(settingsValues.ambientHeroText).toBe(false);
    expect(localStorage.getItem('hmi:ambient-hero-text')).toBeNull();
  });

  it('übernimmt einen gespeicherten eingeschalteten Zustand', async () => {
    localStorage.setItem('hmi:ambient-hero-text', 'on');
    const { settingsValues } = await freshSettings();
    expect(settingsValues.ambientHeroText).toBe(true);
  });
});

describe('setAmbientCityMap', () => {
  it('ist standardmäßig aus und persistiert nur das Einschalten', async () => {
    const { settingsValues, setAmbientCityMap } = await freshSettings();
    expect(settingsValues.ambientCityMap).toBe(false);

    setAmbientCityMap(true);
    expect(settingsValues.ambientCityMap).toBe(true);
    expect(localStorage.getItem('hmi:ambient-map')).toBe('on');

    setAmbientCityMap(false);
    expect(settingsValues.ambientCityMap).toBe(false);
    expect(localStorage.getItem('hmi:ambient-map')).toBeNull();
  });

  it('übernimmt einen gespeicherten eingeschalteten Zustand', async () => {
    localStorage.setItem('hmi:ambient-map', 'on');
    const { settingsValues } = await freshSettings();
    expect(settingsValues.ambientCityMap).toBe(true);
  });

  /* docs/18 §3.2: Standort und Asset sind zentral, die Sichtbarkeit ist
     gerätelokal — der Schlüssel darf nicht in die Household Config wandern. */
  it('bleibt gerätelokal und steht nicht in SHARED_CONFIG_KEYS', async () => {
    const { SHARED_CONFIG_KEYS } = await import('./shared-config-bootstrap.ts');
    expect([...SHARED_CONFIG_KEYS]).not.toContain('hmi:ambient-map');
  });
});

describe('setAmbientDeepNight', () => {
  it('ist standardmäßig aktiv und persistiert nur das Ausschalten', async () => {
    const { settingsValues, setAmbientDeepNight } = await freshSettings();
    expect(settingsValues.ambientDeepNight).toBe(true);

    setAmbientDeepNight(false);
    expect(settingsValues.ambientDeepNight).toBe(false);
    expect(localStorage.getItem('hmi:ambient-deep-night')).toBe('off');

    setAmbientDeepNight(true);
    expect(settingsValues.ambientDeepNight).toBe(true);
    expect(localStorage.getItem('hmi:ambient-deep-night')).toBeNull();
  });

  it('übernimmt einen gespeicherten ausgeschalteten Zustand', async () => {
    localStorage.setItem('hmi:ambient-deep-night', 'off');
    const { settingsValues } = await freshSettings();
    expect(settingsValues.ambientDeepNight).toBe(false);
  });
});
