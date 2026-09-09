import { describe, expect, it, vi } from 'vitest';

/* Ohne Hauser-Server (Apple-Home-Weg) darf die Einstellungsliste nichts
   zeigen, was ins Leere greift — und muss behalten, was rein lokal wirkt. */
async function registryFor(backend: string | null) {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'hmi:backend' ? backend : null),
    setItem() {}, removeItem() {},
  });
  return import('./settings-registry.ts');
}

describe('Einstellungen ohne Hauser-Server', () => {
  it('nimmt serverabhängige Sektionen samt Einträgen heraus', async () => {
    const platform = await registryFor('platform');
    const sections = new Set(platform.SETTINGS_ENTRIES.map((e) => e.section));
    for (const gone of ['notifications', 'calendar', 'shopping', 'media', 'services', 'hotel-mode']) {
      expect(sections.has(gone as never), gone).toBe(false);
    }
    const sidebar = platform.settingsSidebar(true).flatMap((g) => g.sections.map((s) => s.id));
    expect(sidebar).not.toContain('services');
    expect(sidebar).toContain('appearance');
  });

  it('behält, was ohne Server funktioniert', async () => {
    const platform = await registryFor('platform');
    const ids = new Set(platform.SETTINGS_ENTRIES.map((e) => e.id));
    for (const keep of ['theme-mode', 'ui-language', 'security-sensors', 'central-climate', 'standby-now', 'reload-app']) {
      expect(ids.has(keep), keep).toBe(true);
    }
    for (const gone of ['household-setup', 'ambient-city-map', 'update-list', 'cache-ha']) {
      expect(ids.has(gone), gone).toBe(false);
    }
  });

  it('lässt mit Server alles stehen', async () => {
    const withServer = await registryFor(null);
    const ids = new Set(withServer.SETTINGS_ENTRIES.map((e) => e.id));
    for (const keep of ['household-setup', 'ha-url', 'shopping-stores', 'update-list', 'ambient-city-map']) {
      expect(ids.has(keep), keep).toBe(true);
    }
  });
});
