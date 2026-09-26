import { describe, expect, it } from 'vitest';
import { parseRoomDisplayConfig } from './room-display-config.svelte.ts';

describe('Raumanzeige: Kameras im geteilten Bild', () => {
  it('liest den Schalter, den auch die iOS-App schreibt, und verwirft alles andere', () => {
    const parsed = parseRoomDisplayConfig(JSON.stringify({
      version: 1,
      rooms: { flur: { cameraSplit: false }, garten: { cameraSplit: true }, keller: { cameraSplit: 'nein' } },
    }));
    expect(parsed.rooms.flur).toEqual({ cameraSplit: false });
    expect(parsed.rooms.garten).toEqual({ cameraSplit: true });
    expect(parsed.rooms.keller).toBeUndefined();
  });
});

describe('Klimagerät ausblenden', () => {
  it('liest den Schalter und verwirft fremde Werte', () => {
    const parsed = parseRoomDisplayConfig(JSON.stringify({
      version: 1,
      rooms: { hwr: { hideClimate: true }, flur: { hideClimate: 'ja' } },
    }));
    expect(parsed.rooms).toEqual({ hwr: { hideClimate: true } });
  });

  it('blendet das Klimagerät des Raums aus, die Config bleibt unberührt', async () => {
    const { setClimateHidden } = await import('./room-display-config.svelte.ts');
    const { buildEntitySeed, climateEntityId, configuredClimateEntityId, roomHasClimate } = await import('./entities.ts');
    buildEntitySeed([{ id: 'hwr', name: 'HWR', presence: false, windowOpen: false, lights: [], climateEntityId: 'climate.waermepumpe', target: 20, hvac: 'off' }]);
    setClimateHidden('hwr', true);
    expect(climateEntityId('hwr')).toBe('');
    expect(roomHasClimate('hwr')).toBe(false);
    expect(configuredClimateEntityId('hwr')).toBe('climate.waermepumpe');
    setClimateHidden('hwr', false);
    expect(climateEntityId('hwr')).toBe('climate.waermepumpe');
  });
});
