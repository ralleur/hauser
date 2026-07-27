import { describe, expect, it, vi } from 'vitest';
import { runtime } from '../adapter/runtime.svelte.ts';
import {
  mergedLight,
  setColor,
  setColorTemp,
  hexToRgb,
  shouldConfirmHomeOff,
  toggleVacationMode,
  vacationModeActive,
} from './commands.ts';

describe('Light detail commands', () => {
  it('hexToRgb wandelt #rrggbb in HA rgb_color um', () => {
    expect(hexToRgb('#1a2b3c')).toEqual([26, 43, 60]);
    expect(hexToRgb('ff8000')).toEqual([255, 128, 0]);
  });

  it('setColorTemp dispatcht Kelvin und wechselt zurück in den Weißmodus', () => {
    setColor('wohnzimmer', 'kugellampen', '#ff0000');
    setColorTemp('wohnzimmer', 'kugellampen', 4200);

    expect(mergedLight('wohnzimmer', 'kugellampen')).toMatchObject({
      on: true,
      colorTemp: 4200,
      color: null,
    });
  });

  it('setColor dispatcht rgb_color als Farbmodus und schaltet das Licht ein', () => {
    setColor('wohnzimmer', 'kugellampen', '#1a2b3c');

    expect(mergedLight('wohnzimmer', 'kugellampen')).toMatchObject({
      on: true,
      color: '#1a2b3c',
    });
  });
});

describe('Mobiler Aus-Button', () => {
  it('fragt nur vor der konfigurierten lokalen Uhrzeit nach', () => {
    expect(shouldConfirmHomeOff(new Date(2026, 0, 1, 21, 59), '22:00')).toBe(true);
    expect(shouldConfirmHomeOff(new Date(2026, 0, 1, 22, 0), '22:00')).toBe(false);
    expect(shouldConfirmHomeOff(new Date(2026, 0, 1, 12, 0), null)).toBe(false);
  });
});

describe('Mobiler Urlaubsmodus', () => {
  it('schaltet den zentralen Modus in beide Richtungen', () => {
    const dispatch = vi.spyOn(runtime, 'dispatch');

    expect(vacationModeActive()).toBe(false);
    toggleVacationMode();
    expect(vacationModeActive()).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ domain: 'switch', service: 'turn_on' }),
      { on: true },
    );

    toggleVacationMode();
    expect(vacationModeActive()).toBe(false);
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ domain: 'switch', service: 'turn_off' }),
      { on: false },
    );

    dispatch.mockRestore();
  });
});
