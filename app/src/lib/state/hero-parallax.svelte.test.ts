import { beforeEach, describe, expect, it } from 'vitest';
import {
  HERO_PARALLAX_PX,
  heroParallax,
  resetHeroParallax,
  setHeroParallaxFraction,
} from './hero-parallax.svelte.ts';

beforeEach(() => resetHeroParallax());

describe('setHeroParallaxFraction', () => {
  it('eingerastet bleibt das Bild an seinem Platz', () => {
    setHeroParallaxFraction(0);
    expect(heroParallax.offsetPx).toBe(0);
  });

  it('halb gewischt gibt den vollen Versatz, gegen die Wischrichtung', () => {
    setHeroParallaxFraction(0.5);
    expect(heroParallax.offsetPx).toBe(-HERO_PARALLAX_PX);

    setHeroParallaxFraction(-0.5);
    expect(heroParallax.offsetPx).toBe(HERO_PARALLAX_PX);
  });

  it('begrenzt überschießende Werte und verträgt Unsinn', () => {
    setHeroParallaxFraction(4);
    expect(heroParallax.offsetPx).toBe(-HERO_PARALLAX_PX);

    setHeroParallaxFraction(Number.NaN);
    expect(heroParallax.offsetPx).toBe(0);
  });

  it('zurücksetzen räumt den Versatz weg', () => {
    setHeroParallaxFraction(0.25);
    expect(heroParallax.offsetPx).not.toBe(0);

    resetHeroParallax();
    expect(heroParallax.offsetPx).toBe(0);
  });
});
