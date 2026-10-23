import { pressRemoteKey, remoteEntityFor } from './remote-keys.ts';
import { describe, expect, it, vi } from 'vitest';
import { runtime } from '../adapter/runtime.svelte.ts';
import { mergePatch } from '../adapter/overlay.ts';
import type { Light } from './app.svelte.ts';
import { HOSTILE_LIGHT_TAPS } from '../stresshaus/hostile-home.ts';
import {
  mergedLight,
  setColor,
  setColorTemp,
  hexToRgb,
  shouldConfirmHomeOff,
  toggleVacationMode,
  vacationModeActive,
  toggleDevice,
} from './commands.ts';

describe('Stresshaus #44/#45: Lampenkachel während einer neuen Raumzuordnung', () => {
  it.each(HOSTILE_LIGHT_TAPS)('$roomId: schaltet das HA-Ziel der noch sichtbaren Kachel', ({ id, entityId }) => {
    const before = { on: false, brightness: 63, colorTemp: 3000, color: null };
    const merged = vi.spyOn(runtime, 'merged').mockReturnValue(before);
    const dispatch = vi.spyOn(runtime, 'dispatch').mockImplementation(() => {});
    try {
      toggleDevice({ id, entityId, domain: 'light' } as Light);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ entityId, domain: 'light', service: 'turn_on' }),
        expect.objectContaining({ on: true }),
      );
      expect(mergePatch(before, dispatch.mock.calls[0][1])).toEqual({ ...before, on: true });
    } finally { dispatch.mockRestore(); merged.mockRestore(); }
  });
});

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

describe('Fernbedienung eines Fernsehers', () => {
  it('findet das remote-Geschwister eines Medienspielers und sonst nichts', () => {
    const known = [{ entityId: 'media_player.apple_tv' }, { entityId: 'remote.apple_tv' }, { entityId: 'remote.soundbar_x' }];
    expect(remoteEntityFor('media_player.apple_tv', known)).toBe('remote.apple_tv');
    expect(remoteEntityFor('media_player.soundbar', known)).toBeNull();
    expect(remoteEntityFor('remote.apple_tv', known)).toBeNull();
  });

  it('schickt „Zurück" als menu, alles andere unverändert', () => {
    const dispatch = vi.spyOn(runtime, 'dispatch').mockImplementation(() => {});
    pressRemoteKey('remote.apple_tv', 'back');
    pressRemoteKey('remote.apple_tv', 'select');
    expect(dispatch.mock.calls.map(([cmd]) => [cmd.domain, cmd.service, cmd.data])).toEqual([
      ['remote', 'send_command', { command: 'menu' }],
      ['remote', 'send_command', { command: 'select' }],
    ]);
    dispatch.mockRestore();
  });
});
