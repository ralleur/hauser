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
