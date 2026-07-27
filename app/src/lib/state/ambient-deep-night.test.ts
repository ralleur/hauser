import { describe, expect, it } from 'vitest';
import { isDeepNightHour } from './ambient-deep-night.ts';

describe('isDeepNightHour', () => {
  it.each([
    [21, false],
    [22, true],
    [23, true],
    [0, true],
    [5, true],
    [6, false],
  ])('ordnet Stunde %i korrekt zu', (hour, expected) => {
    expect(isDeepNightHour(hour)).toBe(expected);
  });
});