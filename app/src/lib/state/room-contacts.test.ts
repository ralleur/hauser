/* Kontakte und Melder: erkannt heißt aktiv, jeder einzeln abwählbar.
   Der Katalog und die Rollen der Haushalts-Config sind hier gestellt — geprüft
   wird die Auswahl-Logik, die Einstellungen und Raum-Konfig teilen. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => [
  { entityId: 'binary_sensor.living_window', domain: 'binary_sensor', name: 'Fenster Süd',
    area: 'Wohnzimmer', deviceClass: 'window' },
  { entityId: 'binary_sensor.living_door', domain: 'binary_sensor', name: 'Balkontür',
    area: 'Wohnzimmer', deviceClass: 'door' },
  { entityId: 'binary_sensor.living_motion', domain: 'binary_sensor', name: 'Bewegung',
    area: 'Wohnzimmer', deviceClass: 'motion' },
  { entityId: 'binary_sensor.hall_window', domain: 'binary_sensor', name: 'Fenster Flur',
    area: 'Flur', deviceClass: 'window' },
  // Kein Kontakt: falsche device_class, darf nirgends auftauchen.
  { entityId: 'binary_sensor.living_power', domain: 'binary_sensor', name: 'Strom',
    area: 'Wohnzimmer', deviceClass: 'power' },
]);

vi.mock('./device-manager.svelte.ts', () => ({ deviceManager: { catalog } }));
vi.mock('./entities.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entities.ts')>()),
  // Aus der Haushalts-Config: ein Kontakt, den der HA-Bereich nicht kennt.
  windowEntityIds: (roomId: string) => (roomId === 'wohnzimmer' ? ['binary_sensor.config_window'] : []),
  presenceEntityIds: () => [],
}));

import {
  contactEnabled,
  contactIdsFor,
  contactsAreAutomatic,
  roomContactOptions,
  setContactEnabled,
  setContactIds,
} from './room-display-config.svelte.ts';

afterEach(() => {
  setContactIds('wohnzimmer', 'window', undefined);
  setContactIds('wohnzimmer', 'presence', undefined);
});

describe('room contact selection', () => {
  it('offers config roles first, then everything Home Assistant knows for the room', () => {
    expect(roomContactOptions('wohnzimmer', 'window')).toEqual([
      { entityId: 'binary_sensor.config_window', name: 'binary_sensor.config_window', fromConfig: true },
      { entityId: 'binary_sensor.living_window', name: 'Fenster Süd', fromConfig: false },
      { entityId: 'binary_sensor.living_door', name: 'Balkontür', fromConfig: false },
    ]);
    expect(roomContactOptions('wohnzimmer', 'presence').map((o) => o.entityId))
      .toEqual(['binary_sensor.living_motion']);
    expect(roomContactOptions('flur', 'window').map((o) => o.entityId))
      .toEqual(['binary_sensor.hall_window']);
  });

  it('activates everything detected until a sensor is deselected', () => {
    expect(contactsAreAutomatic('wohnzimmer', 'window')).toBe(true);
    expect(contactEnabled('wohnzimmer', 'window', 'binary_sensor.living_door')).toBe(true);

    setContactEnabled('wohnzimmer', 'window', 'binary_sensor.living_door', false);

    expect(contactsAreAutomatic('wohnzimmer', 'window')).toBe(false);
    expect(contactEnabled('wohnzimmer', 'window', 'binary_sensor.living_door')).toBe(false);
    expect(contactIdsFor('wohnzimmer', 'window'))
      .toEqual(['binary_sensor.config_window', 'binary_sensor.living_window']);
    // Andere Räume und Arten bleiben unberührt.
    expect(contactsAreAutomatic('wohnzimmer', 'presence')).toBe(true);
    expect(contactsAreAutomatic('flur', 'window')).toBe(true);
  });

  it('lets a config role be switched off and the automatic assignment be restored', () => {
    setContactEnabled('wohnzimmer', 'window', 'binary_sensor.config_window', false);
    expect(contactIdsFor('wohnzimmer', 'window')).not.toContain('binary_sensor.config_window');

    setContactIds('wohnzimmer', 'window', undefined);
    expect(contactsAreAutomatic('wohnzimmer', 'window')).toBe(true);
    expect(contactIdsFor('wohnzimmer', 'window')).toContain('binary_sensor.config_window');
  });
});
