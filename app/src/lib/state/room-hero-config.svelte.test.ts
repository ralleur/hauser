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
  pickRoomHeroSet,
  replaceRoomHeroConfigs,
  roomHeroConfig,
  roomHeroSets,
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

const focus = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };
const set = (assetId: string) => ({ assetId, focus: structuredClone(focus) });

describe('pickRoomHeroSet', () => {
  const sets = [set('a'), set('b'), set('c')];

  it('maps the random value onto the sets, including the edges', () => {
    expect(pickRoomHeroSet(sets, undefined, () => 0).assetId).toBe('a');
    expect(pickRoomHeroSet(sets, undefined, () => 0.34).assetId).toBe('b');
    expect(pickRoomHeroSet(sets, undefined, () => 0.99).assetId).toBe('c');
    expect(pickRoomHeroSet(sets, undefined, () => 1).assetId).toBe('c');
  });

  it('keeps the previous set while it still belongs to the room', () => {
    const random = () => { throw new Error('must not draw again'); };
    expect(pickRoomHeroSet(sets, 'b', random).assetId).toBe('b');
  });

  it('draws again when the previous set left the room', () => {
    expect(pickRoomHeroSet(sets, 'gone', () => 0).assetId).toBe('a');
  });

  it('returns the only set', () => {
    expect(pickRoomHeroSet([set('only')], undefined, () => 0.7).assetId).toBe('only');
  });
});

describe('room hero config with several picture sets', () => {
  const room = { ...set('a'), alternates: [set('b'), set('c')] };

  it('shows one of the sets and sticks to it for the session', () => {
    replaceRoomHeroConfigs({ studio: room });
    const first = roomHeroConfig('studio');
    expect(['a', 'b', 'c']).toContain(first?.assetId);
    for (let read = 0; read < 25; read += 1) expect(roomHeroConfig('studio')).toEqual(first);
    expect(first).not.toHaveProperty('alternates');
  });

  it('is a plain read for rooms with a single set', () => {
    replaceRoomHeroConfigs({ studio: set('only') });
    expect(roomHeroConfig('studio')).toEqual(set('only'));
  });

  it('uses every set across sessions', () => {
    const seen = new Set<string>();
    const draw = vi.spyOn(Math, 'random');
    for (const value of [0, 0.5, 0.99]) {
      draw.mockReturnValue(value);
      replaceRoomHeroConfigs({ [`room_${value}`]: room });
      seen.add(roomHeroConfig(`room_${value}`)?.assetId ?? '');
    }
    draw.mockRestore();
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps showing the current picture when a set is added to a single-set room', () => {
    replaceRoomHeroConfigs({ den: set('a') });
    expect(roomHeroConfig('den')?.assetId).toBe('a');
    const draw = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    setRoomHeroConfig('den', { ...set('a'), alternates: [set('b'), set('c')] });
    expect(roomHeroConfig('den')?.assetId).toBe('a');
    draw.mockRestore();
  });

  it('chooses again when the shown set is removed from the room', () => {
    replaceRoomHeroConfigs({ loft: room });
    const draw = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const shown = roomHeroConfig('loft')?.assetId;
    const remaining = ['a', 'b', 'c'].filter((id) => id !== shown);
    setRoomHeroConfig('loft', { ...set(remaining[0]), alternates: [set(remaining[1])] });
    expect(remaining).toContain(roomHeroConfig('loft')?.assetId);
    draw.mockRestore();
  });

  it('lists all sets, primary first, without exposing aliases', () => {
    replaceRoomHeroConfigs({ studio: room });
    expect(roomHeroSets('studio').map((entry) => entry.assetId)).toEqual(['a', 'b', 'c']);
    roomHeroSets('studio')[1].focus.panel.x = 0;
    expect(roomHeroSets('studio')[1]).toEqual(set('b'));
    expect(roomHeroSets('unknown')).toEqual([]);
    replaceRoomHeroConfigs({ studio: set('only') });
    expect(roomHeroSets('studio')).toEqual([set('only')]);
  });
});
