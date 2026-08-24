import { describe, expect, it } from 'vitest';
import {
  HOTEL_COACH_CONTROL_SELECTOR,
  isHotelControlTarget,
  nextCoachVisibility,
} from './hotel-coach.ts';

/* Das Overlay entscheidet zentral an der interaktiven Semantik — kein Control
   bekommt dafür Sonderlogik. Geprüft wird genau diese Regel. */

/** Minimales DOM-Double: `closest` trifft, wenn ein Vorfahre gelistet ist. */
function target(matches: readonly string[]) {
  return {
    closest(selectors: string) {
      const wanted = selectors.split(', ');
      return matches.some((entry) => wanted.includes(entry)) ? { tagName: 'DIV' } : null;
    },
  };
}

describe('Erkennung von Bedienelementen', () => {
  it('erkennt die üblichen Rollen und Elemente', () => {
    for (const selector of [
      'button', 'a[href]', 'input', 'select', 'textarea', 'summary',
      '[role="button"]', '[role="switch"]', '[role="slider"]', '[role="checkbox"]',
      '[role="tab"]', '[role="link"]', '[role="menuitem"]',
    ]) {
      expect(isHotelControlTarget(target([selector])), selector).toBe(true);
    }
  });

  it('erkennt den ausdrücklichen Marker und echte Fokusziele', () => {
    expect(isHotelControlTarget(target(['[data-control]']))).toBe(true);
    expect(isHotelControlTarget(target(['[tabindex]:not([tabindex="-1"])']))).toBe(true);
  });

  it('behandelt nicht interaktiven Hintergrund als Hintergrund', () => {
    expect(isHotelControlTarget(target([]))).toBe(false);
    expect(isHotelControlTarget(target(['div', 'span', 'h1']))).toBe(false);
  });

  it('bleibt bei einem unbrauchbaren Ziel fail-safe beim Hintergrund', () => {
    for (const value of [null, undefined, 'button', 42, {}, { closest: 'nope' }]) {
      expect(isHotelControlTarget(value)).toBe(false);
    }
  });

  it('nennt jede Regel genau einmal', () => {
    const parts = HOTEL_COACH_CONTROL_SELECTOR.split(', ');
    expect(new Set(parts).size).toBe(parts.length);
  });
});

describe('Sichtbarkeit nach einem Tipp', () => {
  it('blendet an einem Control aus und am Hintergrund wieder ein', () => {
    expect(nextCoachVisibility(target(['button']))).toBe(false);
    expect(nextCoachVisibility(target([]))).toBe(true);
  });

  it('blendet auch nach korrekter Benutzung wieder ein', () => {
    // Control, Hintergrund, Control, Hintergrund — der Zustand hängt nur am
    // letzten Tipp, es gibt keinen dauerhaften Onboarding-Status.
    const sequence = [target(['[role="switch"]']), target([]), target(['button']), target([])];

    expect(sequence.map((item) => nextCoachVisibility(item))).toEqual([false, true, false, true]);
  });
});
