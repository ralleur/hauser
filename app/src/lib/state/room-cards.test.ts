import { describe, expect, it } from 'vitest';
import { cardsAroundTiles } from './room-cards.ts';

const ids = (...list: string[]) => list.map((entityId) => ({ entityId }));

describe('Karten vor oder hinter dem Kachelraster (wie die iOS-App)', () => {
  it('stellt eine Kamera vor das Raster, wenn sie vor der ersten Kachel liegt', () => {
    const order = ids('camera.tuer', 'light.a', 'camera.garten', 'light.b');
    const split = cardsAroundTiles(order, ids('camera.tuer', 'camera.garten'), ids('light.a', 'light.b'));
    expect(split.before.map((card) => card.entityId)).toEqual(['camera.tuer']);
    expect(split.after.map((card) => card.entityId)).toEqual(['camera.garten']);
  });

  it('lässt eine unbekannte Kamera hinten stehen', () => {
    const split = cardsAroundTiles(ids('light.a'), ids('camera.neu'), ids('light.a'));
    expect(split.after.map((card) => card.entityId)).toEqual(['camera.neu']);
  });
});
