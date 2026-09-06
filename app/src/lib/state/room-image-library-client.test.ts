import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Die Zuweisung aus Assistent und Bibliothek muss die laufende Projektion
   nachziehen. Ohne das blieb die Bühne bis zum nächsten Neuladen beim alten
   Bild — und das Lampen-Overlay zeigte weiter die Projektfassung. */

const projected = vi.hoisted(() => ({ wohnzimmer: null }));
vi.mock('../config/household-runtime-data.ts', () => ({ ROOM_HERO_CONFIGS: projected }));

import { roomHeroConfig } from './room-hero-config.svelte.ts';
import { assignRoomImage } from './room-image-library-client.ts';

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
