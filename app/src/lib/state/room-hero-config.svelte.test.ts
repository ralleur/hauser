import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomHeroConfig } from '../config/household-config.ts';

const projected = vi.hoisted(() => ({
  studio: {
    assetId: 'initial-asset',
    focus: {
      panel: { x: 0.25, y: 0.75 },
      phone: { x: 0.6, y: 0.4 },
    },
  },
  empty: null,
}));

vi.mock('../config/household-runtime-data.ts', () => ({ ROOM_HERO_CONFIGS: projected }));

import {
  clearRoomHeroConfig,
  replaceRoomHeroConfigs,
  roomHeroConfig,
  setRoomHeroConfig,
} from './room-hero-config.svelte.ts';

const replacement: RoomHeroConfig = {
  assetId: 'replacement-asset',
  focus: {
    panel: { x: 0.1, y: 0.2 },
    phone: { x: 0.8, y: 0.9 },
  },
};

afterEach(() => replaceRoomHeroConfigs(projected));

describe('reactive room hero config store', () => {
  it('starts from the runtime hero projection without involving room objects', () => {
    expect(roomHeroConfig('studio')).toEqual(projected.studio);
    expect(roomHeroConfig('empty')).toBeNull();
    expect(roomHeroConfig('unknown')).toBeNull();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'treats inherited Object prototype key %s as an unknown room',
    (roomId) => {
      expect(roomHeroConfig(roomId)).toBeNull();
    },
  );

  it('atomically replaces the complete projection without retaining input aliases', () => {
    const input: Record<string, RoomHeroConfig> = {
      studio: {
        assetId: 'replacement-asset',
        focus: {
          panel: { x: 0.1, y: 0.2 },
          phone: { x: 0.8, y: 0.9 },
        },
      },
    };
    replaceRoomHeroConfigs(input);
    input.studio.assetId = 'mutated-outside';
    input.studio.focus.panel.x = 1;

    expect(roomHeroConfig('studio')).toEqual({
      assetId: 'replacement-asset',
      focus: {
        panel: { x: 0.1, y: 0.2 },
        phone: { x: 0.8, y: 0.9 },
      },
    });
    expect(roomHeroConfig('empty')).toBeNull();
  });

  it('sets and clears one assignment immediately while preserving exact values', () => {
    replaceRoomHeroConfigs({});
    setRoomHeroConfig('studio', replacement);
    expect(roomHeroConfig('studio')).toEqual(replacement);

    clearRoomHeroConfig('studio');
    expect(roomHeroConfig('studio')).toBeNull();
  });

  it('does not expose a mutable output alias', () => {
    replaceRoomHeroConfigs({ studio: replacement });
    const read = roomHeroConfig('studio');
    if (!read) throw new Error('expected hero assignment');
    read.assetId = 'mutated-read';
    read.focus.phone.y = 0;

    expect(roomHeroConfig('studio')).toEqual(replacement);
  });
});
