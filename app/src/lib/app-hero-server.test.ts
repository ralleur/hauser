import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createAppHeroService } from '../../server/app-hero.mjs';
import { sharp } from './room-images/sharp-runtime.ts';

const household = {
  ok: true,
  body: JSON.stringify({
    rooms: [
      { id: 'wohnzimmer', name: 'Wohnzimmer', hero: null },
      { id: 'buero', name: 'Büro', hero: null },
      { id: 'bad', name: 'Bad', hero: { assetId: 'set-1', focus: {} } },
    ],
  }),
};

describe('Raumbild für Geräte ohne AVIF', () => {
  it('löst eigenes Set, mitgeliefertes Bild und Wohnzimmer-Rückfall auf', () => {
    const service = createAppHeroService({ readHousehold: () => household, assetStore: { variantBytes: () => null } });
    expect(service.resolve('bad', 'dark-off')).toMatchObject({ kind: 'asset', assetId: 'set-1', variant: 'darkOff' });
    expect(service.resolve('wohnzimmer', 'light')).toMatchObject({ kind: 'project', room: 'wohnzimmer', variant: 'light' });
    expect(service.resolve('buero', 'dark')).toMatchObject({ kind: 'project', room: 'wohnzimmer', variant: 'dark' });
    expect(service.resolve('keller', 'light')).toBeNull();
    expect(service.resolve('bad', 'sepia')).toBeNull();
    expect(service.resolve('../etc', 'light')).toBeNull();
  });

  it('liefert ein JPEG in Wunschbreite, danach aus dem Speicher', async () => {
    const source = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#f5b03c' } }).png().toBuffer();
    /* Das Set hat nur ein Tagbild; die trübe Fassung fällt darauf zurück. */
    const assetStore = { variantBytes: (assetId: string, variant: string) => (assetId === 'set-1' && variant === 'light' ? source : null) };
    const service = createAppHeroService({ readHousehold: () => household, assetStore, staticRoots: [], sharp });
    const entry = await service.render('bad', 'light', 120);
    expect(Array.from(entry.bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(entry.width).toBe(120);
    expect(entry.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect((await sharp(entry.bytes).metadata()).width).toBe(120);
    expect(await service.render('bad', 'light', 120)).toBe(entry);
    expect(await service.render('bad', 'overcast', 120)).not.toBeNull();
    expect(await service.render('bad', 'dark', 120)).toBeNull();
    expect(await service.render('wohnzimmer', 'light', 120)).toBeNull();
  });
});
