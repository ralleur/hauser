import { describe, expect, it } from 'vitest';
import {
  assignedRoomIds,
  heroFromAssets,
  normalizeRoomImageAssignment,
  replaceHeroAsset,
  // @ts-expect-error The production server intentionally remains native Node ESM without declarations.
} from '../../../server/room-images.mjs';

/* Mehrere Bildsets je Raum: die Zuweisungs-Hilfen des Servers. Der Weg über
   HTTP steht in room-image-server-b4.test.ts. */

const focus = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.4, y: 0.6 } };
const set = (assetId: string) => ({ assetId, focus: structuredClone(focus) });

describe('normalizeRoomImageAssignment', () => {
  it('keeps accepting the single-set and the removal form', () => {
    expect(normalizeRoomImageAssignment({ asset: set('a') })).toEqual({ assets: [set('a')] });
    expect(normalizeRoomImageAssignment({ asset: null })).toEqual({ assets: [] });
  });

  it('accepts a list, primary first', () => {
    expect(normalizeRoomImageAssignment({ assets: [set('a'), set('b')] })).toEqual({ assets: [set('a'), set('b')] });
  });

  it.each([
    ['both forms', { asset: set('a'), assets: [set('a')] }],
    ['empty list', { assets: [] }],
    ['not a list', { assets: set('a') }],
    ['duplicate set', { assets: [set('a'), set('a')] }],
    ['too many sets', { assets: Array.from({ length: 9 }, (_, index) => set(`set_${index}`)) }],
    ['open entry', { assets: [{ ...set('a'), path: '/tmp/leak' }] }],
    ['unsafe asset id', { assets: [set('A b')] }],
    ['focus outside the picture', { assets: [{ assetId: 'a', focus: { ...focus, panel: { x: 2, y: 0 } } }] }],
    ['open body', { assets: [set('a')], extra: true }],
    ['null entry', { assets: [null] }],
  ])('rejects %s', (_label, payload) => {
    expect(normalizeRoomImageAssignment(payload)).toBeNull();
  });

  it('accepts exactly the maximum number of sets', () => {
    const assets = Array.from({ length: 8 }, (_, index) => set(`set_${index}`));
    expect(normalizeRoomImageAssignment({ assets })).toEqual({ assets });
  });
});

describe('heroFromAssets', () => {
  it('builds the legacy shape for a single set and null for none', () => {
    expect(heroFromAssets([set('a')])).toEqual(set('a'));
    expect(heroFromAssets([set('a')])).not.toHaveProperty('alternates');
    expect(heroFromAssets([])).toBeNull();
  });

  it('stores the rest as alternates', () => {
    expect(heroFromAssets([set('a'), set('b'), set('c')])).toEqual({ ...set('a'), alternates: [set('b'), set('c')] });
  });
});

describe('assignedRoomIds', () => {
  const document = {
    rooms: [
      { id: 'den', hero: { ...set('a'), alternates: [set('b')] } },
      { id: 'kitchen', hero: set('b') },
      { id: 'hall', hero: null },
    ],
    exterior: { hero: set('c') },
  };

  it('counts alternates as assigned, so a set in use is never treated as orphaned', () => {
    expect(assignedRoomIds(document, 'a')).toEqual(['den']);
    expect(assignedRoomIds(document, 'b')).toEqual(['den', 'kitchen']);
    expect(assignedRoomIds(document, 'c')).toEqual(['exterior']);
    expect(assignedRoomIds(document, 'unused')).toEqual([]);
  });

  it('copes with a missing exterior', () => {
    expect(assignedRoomIds({ rooms: document.rooms }, 'a')).toEqual(['den']);
  });
});

describe('replaceHeroAsset', () => {
  it('swaps a primary set and keeps the alternates', () => {
    const hero = { ...set('a'), alternates: [set('b')] };
    expect(replaceHeroAsset(hero, 'a', 'a2')).toEqual({ ...set('a2'), alternates: [set('b')] });
  });

  it('swaps an alternate and leaves the primary alone', () => {
    const hero = { ...set('a'), alternates: [set('b'), set('c')] };
    expect(replaceHeroAsset(hero, 'c', 'c2')).toEqual({ ...set('a'), alternates: [set('b'), set('c2')] });
  });

  it('keeps the legacy shape for a single set', () => {
    const result = replaceHeroAsset(set('a'), 'a', 'a2');
    expect(result).toEqual(set('a2'));
    expect(result).not.toHaveProperty('alternates');
  });
});
