import { describe, expect, it, vi } from 'vitest';
import type { RoomHeroConfig } from '../config/household-config.ts';
import roomHero from './RoomHero.svelte?raw';
import {
  heroAssetUrl,
  loadRoomHero,
  normalizeHeroRoom,
  resolveRoomHero,
  selectHeroVariant,
} from './room-hero-assets.ts';

const fallbackTheme = 'light' as const;
const config: RoomHeroConfig = {
  assetId: 'family-room_42',
  focus: {
    panel: { x: 0.25, y: 0.75 },
    phone: { x: 0.6, y: 0.4 },
  },
};

describe('room hero asset selection', () => {
  it('uses the day hero variant when sun.sun is above the horizon', () => {
    expect(selectHeroVariant({ day: true }, 'dark')).toBe('light');
    expect(heroAssetUrl({ baseUrl: '/', roomId: 'wohnzimmer', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/hero/wohnzimmer-light.avif');
  });

  it('uses the evening/night hero variant when sun.sun is below the horizon', () => {
    expect(selectHeroVariant({ day: false }, 'light')).toBe('dark');
    expect(heroAssetUrl({ baseUrl: '/', roomId: 'kueche', sun: { day: false }, fallbackTheme }))
      .toBe('/hero/kueche-dark.avif');
  });

  it('uses the lights-off night asset only when assigned room lights are all off', () => {
    expect(selectHeroVariant({ day: false }, fallbackTheme, true)).toBe('dark-off');
    expect(heroAssetUrl({
      baseUrl: '/', roomId: 'wohnzimmer', sun: { day: false }, fallbackTheme, allAssignedLightsOff: true,
    })).toBe('/hero/wohnzimmer-dark-off.avif');
    expect(heroAssetUrl({
      baseUrl: '/', roomId: 'wohnzimmer', sun: { day: true }, fallbackTheme, allAssignedLightsOff: true,
    })).toBe('/hero/wohnzimmer-light.avif');
  });

  it('does not let an interface-only mode change the sun-driven hero variant', () => {
    expect(heroAssetUrl({ baseUrl: '/app/', roomId: 'bad', sun: { day: false }, fallbackTheme: 'light' }))
      .toBe('/app/hero/bad-dark.avif');
    expect(heroAssetUrl({ baseUrl: '/app/', roomId: 'bad', sun: { day: true }, fallbackTheme: 'dark' }))
      .toBe('/app/hero/bad-light.avif');
  });

  it('falls back to the UI theme until sun.sun has delivered a state', () => {
    expect(selectHeroVariant(undefined, 'light')).toBe('light');
    expect(selectHeroVariant(undefined, 'dark')).toBe('dark');
  });

  it('falls back to the all-room collage for missing or unknown panel room ids', () => {
    expect(normalizeHeroRoom(null)).toBe('all');
    expect(normalizeHeroRoom('garage')).toBe('all');
    expect(heroAssetUrl({ baseUrl: '/', roomId: 'garage', sun: { day: false }, fallbackTheme }))
      .toBe('/hero/all-dark.avif');
  });
});

describe('shared panel and phone hero resolver', () => {
  it('resolves a root-absolute panel user asset, dark-off fallback and panel focus', () => {
    expect(resolveRoomHero({
      target: 'panel', baseUrl: '/app/', roomId: 'wohnzimmer', config,
      sun: { day: false }, fallbackTheme: 'light', allAssignedLightsOff: true,
    })).toEqual({
      variant: 'dark-off',
      userCandidate: {
        source: 'user',
        url: '/assets/room-images/family-room_42/dark-off.avif',
        position: '25% 75%',
      },
      projectFallback: {
        source: 'project',
        url: '/app/hero/wohnzimmer-dark-off.avif',
        position: '50% 50%',
      },
    });
  });

  it('keeps phone light/dark semantics, device focus and neutral unknown static rooms', () => {
    expect(resolveRoomHero({
      target: 'phone', baseUrl: '/app', roomId: 'bad', config, variant: 'dark',
    })).toMatchObject({
      variant: 'dark',
      userCandidate: { url: '/assets/room-images/family-room_42/dark.avif', position: '60% 40%' },
      projectFallback: { url: '/app/hero/bad-dark.avif', position: '50% 50%' },
    });
    expect(resolveRoomHero({
      target: 'phone', baseUrl: '/', roomId: 'garage', config: null, variant: 'light',
    })).toEqual({ variant: 'light', userCandidate: null, projectFallback: null });
    expect(resolveRoomHero({
      target: 'phone', baseUrl: '/', roomId: 'garage', config, variant: 'light',
    })).toMatchObject({ userCandidate: { url: '/assets/room-images/family-room_42/light.avif' }, projectFallback: null });
  });

  it.each([
    { ...config, assetId: '../escape' },
    { ...config, focus: { ...config.focus, panel: { x: Number.NaN, y: 0.5 } } },
    { ...config, focus: { ...config.focus, panel: { x: -0.1, y: 1.1 } } },
  ])('rejects an unsafe runtime user reference defensively', (unsafeConfig) => {
    expect(resolveRoomHero({
      target: 'panel', baseUrl: '/', roomId: 'wohnzimmer', config: unsafeConfig,
      sun: { day: true }, fallbackTheme: 'light',
    }).userCandidate).toBeNull();
  });
});

describe('shared decode and fallback policy', () => {
  const resolved = () => resolveRoomHero({
    target: 'panel' as const, baseUrl: '/', roomId: 'wohnzimmer', config,
    sun: { day: true }, fallbackTheme: 'light' as const,
  });

  it('accepts a user asset only after successful decode', async () => {
    const decode = vi.fn().mockResolvedValue(undefined);
    await expect(loadRoomHero(resolved(), decode)).resolves.toMatchObject({ source: 'user' });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('decodes and returns the project fallback after a user failure', async () => {
    const decode = vi.fn()
      .mockRejectedValueOnce(new Error('missing user volume'))
      .mockResolvedValueOnce(undefined);
    await expect(loadRoomHero(resolved(), decode)).resolves.toEqual(resolved().projectFallback);
    expect(decode).toHaveBeenNthCalledWith(2, '/hero/wohnzimmer-light.avif');
  });

  it('returns no broken URL when both candidates fail', async () => {
    const decode = vi.fn().mockRejectedValue(new Error('decode failed'));
    await expect(loadRoomHero(resolved(), decode)).resolves.toBeNull();
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('abandons an obsolete target before it can expose user or fallback output', async () => {
    let current = true;
    const decode = vi.fn(async () => {
      current = false;
      throw new Error('obsolete user failed');
    });
    await expect(loadRoomHero(resolved(), decode, () => current)).resolves.toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
  });
});

describe('panel hero integration boundary', () => {
  it('uses the reactive store and shared resolver/loader with buffered focus', () => {
    expect(roomHero).toContain('roomHeroConfig(appState.currentRoom)');
    expect(roomHero).toContain('resolveRoomHero');
    expect(roomHero).toContain('loadRoomHero');
    expect(roomHero).not.toContain('heroAssetUrl');
    expect(roomHero).not.toContain('.catch(swap)');
    expect(roomHero).toContain('style:background-position');
    expect((roomHero.match(/class="hero-layer"/g) ?? [])).toHaveLength(2);
    expect(roomHero).toContain('allAssignedLightsOff');
    expect(roomHero).toContain('immersion-light-layer');
  });
});
