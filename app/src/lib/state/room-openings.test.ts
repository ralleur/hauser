/* Offene Fenster und Türen getrennt: die device_class aus dem Katalog
   entscheidet, ein unbekannter Kontakt bleibt ein Fenster (wie vor der
   Unterscheidung). Der Katalog und die Rollen der Haushalts-Config sind hier
   gestellt, die Zustände kommen aus der Runtime. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const catalog = vi.hoisted(() => [
  { entityId: 'binary_sensor.bath_window', domain: 'binary_sensor', name: 'Fenster Bad', area: 'Bad', deviceClass: 'window' },
  { entityId: 'binary_sensor.bath_door', domain: 'binary_sensor', name: 'Tür Bad', area: 'Bad', deviceClass: 'door' },
  { entityId: 'binary_sensor.garage_door', domain: 'binary_sensor', name: 'Garagentor', area: 'Garage', deviceClass: 'garage_door' },
  { entityId: 'binary_sensor.skylight', domain: 'binary_sensor', name: 'Dachluke', area: 'Garage', deviceClass: 'opening' },
]);

vi.mock('./device-manager.svelte.ts', () => ({ deviceManager: { catalog } }));
vi.mock('./entities.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entities.ts')>()),
  windowEntityIds: (roomId: string) => ({
    bad: ['binary_sensor.bath_window', 'binary_sensor.bath_door'],
    garage: ['binary_sensor.garage_door', 'binary_sensor.skylight'],
    // Nicht im Katalog (HA noch nicht geladen): zählt als Fenster.
    flur: ['binary_sensor.unknown_contact'],
  } as Record<string, string[]>)[roomId] ?? [],
  presenceEntityIds: () => [],
}));

import { runtime } from '../adapter/runtime.svelte.ts';
import { roomOpenings, roomWindowOpen } from './commands.ts';
import './room-display-config.svelte.ts';
import { openingsLabel } from './open-label.ts';
import { overwriteGetLocale } from '../../paraglide/runtime.js';

function open(...entityIds: string[]): void {
  vi.spyOn(runtime, 'merged').mockImplementation((entityId) => ({ on: entityIds.includes(entityId) }));
}

afterEach(() => vi.restoreAllMocks());

describe('room openings by device class', () => {
  it('reports an open window and an open door separately', () => {
    open('binary_sensor.bath_window');
    expect(roomOpenings('bad')).toEqual({ window: true, door: false });
    open('binary_sensor.bath_door');
    expect(roomOpenings('bad')).toEqual({ window: false, door: true });
    open('binary_sensor.bath_window', 'binary_sensor.bath_door');
    expect(roomOpenings('bad')).toEqual({ window: true, door: true });
    open();
    expect(roomOpenings('bad')).toEqual({ window: false, door: false });
  });

  it('treats garage doors as doors and the opening class as a window', () => {
    open('binary_sensor.garage_door');
    expect(roomOpenings('garage')).toEqual({ window: false, door: true });
    open('binary_sensor.skylight');
    expect(roomOpenings('garage')).toEqual({ window: true, door: false });
  });

  it('keeps a contact without catalog entry a window', () => {
    open('binary_sensor.unknown_contact');
    expect(roomOpenings('flur')).toEqual({ window: true, door: false });
  });

  it('uses the seed value as a window when the room has no contact', () => {
    open();
    expect(roomOpenings('wohnzimmer', true)).toEqual({ window: true, door: false });
    expect(roomOpenings('wohnzimmer')).toEqual({ window: false, door: false });
  });

  it('still counts any open contact in roomWindowOpen (icon, heating warning)', () => {
    open('binary_sensor.bath_door');
    expect(roomWindowOpen('bad')).toBe(true);
  });
});

describe('open wording', () => {
  beforeAll(() => overwriteGetLocale(() => 'en'));

  it('names windows and doors on their own', () => {
    expect(openingsLabel(1, 0)).toBe('1 window open');
    expect(openingsLabel(3, 0)).toBe('3 windows open');
    expect(openingsLabel(0, 1)).toBe('1 door open');
    expect(openingsLabel(0, 2)).toBe('2 doors open');
  });

  it('shows both kinds side by side and nothing when all is closed', () => {
    expect(openingsLabel(1, 1)).toBe('1 window open, 1 door open');
    expect(openingsLabel(2, 3)).toBe('2 windows open, 3 doors open');
    expect(openingsLabel(0, 0)).toBe('');
  });

  it('picks the plural form of the active language', () => {
    overwriteGetLocale(() => 'pl');
    try {
      expect(openingsLabel(0, 1)).toBe('1 otwarte drzwi');
      expect(openingsLabel(0, 3)).toBe('3 otwarte drzwi');
      expect(openingsLabel(0, 5)).toBe('5 otwartych drzwi');
    } finally {
      overwriteGetLocale(() => 'en');
    }
  });
});
