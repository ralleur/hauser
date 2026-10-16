import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Die Zuweisung aus Assistent und Bibliothek muss die laufende Projektion
   nachziehen. Ohne das blieb die Bühne bis zum nächsten Neuladen beim alten
   Bild — und das Lampen-Overlay zeigte weiter die Projektfassung. */

const projected = vi.hoisted(() => ({ wohnzimmer: null }));
vi.mock('../config/household-runtime-data.ts', () => ({ ROOM_HERO_CONFIGS: projected }));

import { roomHeroConfig, roomHeroSets } from './room-hero-config.svelte.ts';
import { assignRoomImage, assignRoomImages } from './room-image-library-client.ts';

const focus = {
  panel: { x: 0.4, y: 0.6 },
  phone: { x: 0.5, y: 0.5 },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assignRoomImage', () => {
  it('setzt die Zuweisung sofort in die Projektion', async () => {
    await assignRoomImage('wohnzimmer', { assetId: 'neues-set', focus }, 'W/"1"');

    expect(roomHeroConfig('wohnzimmer')).toEqual({ assetId: 'neues-set', focus });
  });

  it('entfernt sie ebenso sofort wieder', async () => {
    await assignRoomImage('wohnzimmer', { assetId: 'neues-set', focus }, 'W/"1"');
    await assignRoomImage('wohnzimmer', null, 'W/"2"');

    expect(roomHeroConfig('wohnzimmer')).toBeNull();
  });

  it('lässt die Projektion unberührt, wenn der Server ablehnt', async () => {
    await assignRoomImage('wohnzimmer', { assetId: 'bestand', focus }, 'W/"1"');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 412 })));

    await expect(assignRoomImage('wohnzimmer', { assetId: 'anderes', focus }, 'W/"alt"'))
      .rejects.toThrow();
    expect(roomHeroConfig('wohnzimmer')?.assetId).toBe('bestand');
  });
});

describe('assignRoomImages', () => {
  const sets = ['a', 'b', 'c'].map((assetId) => ({ assetId, focus: structuredClone(focus) }));
  const lastCall = (mock: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] =>
    mock.mock.calls[index] as unknown as [string, RequestInit];

  it('keeps the single-set request body of assignRoomImage', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await assignRoomImage('wohnzimmer', sets[0], 'W/"1"');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/room-image-assignments/wohnzimmer');
    expect(JSON.parse(init.body as string)).toEqual({ asset: sets[0] });
    await assignRoomImage('wohnzimmer', null, 'W/"2"');
    expect(JSON.parse(lastCall(fetchMock, 1)[1].body as string)).toEqual({ asset: null });
  });

  it('sends a list for several sets and mirrors it in the projection', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await assignRoomImages('wohnzimmer', sets, 'W/"1"');
    const [, init] = lastCall(fetchMock);
    expect((init.headers as Record<string, string>)['If-Match']).toBe('W/"1"');
    expect(JSON.parse(init.body as string)).toEqual({ assets: sets });
    expect(roomHeroSets('wohnzimmer').map((entry) => entry.assetId)).toEqual(['a', 'b', 'c']);
    expect(['a', 'b', 'c']).toContain(roomHeroConfig('wohnzimmer')?.assetId);
  });

  it('removes the assignment for an empty list', async () => {
    await assignRoomImages('wohnzimmer', sets, 'W/"1"');
    await assignRoomImages('wohnzimmer', [], 'W/"2"');
    expect(roomHeroConfig('wohnzimmer')).toBeNull();
    expect(roomHeroSets('wohnzimmer')).toEqual([]);
  });

  it('leaves the projection alone when the server rejects the list', async () => {
    await assignRoomImages('wohnzimmer', [sets[0]], 'W/"1"');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 412 })));
    await expect(assignRoomImages('wohnzimmer', sets, 'W/"alt"')).rejects.toThrow();
    expect(roomHeroSets('wohnzimmer').map((entry) => entry.assetId)).toEqual(['a']);
  });
});
