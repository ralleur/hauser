import type { ClimateValue, LightValue } from '../adapter/types.ts';
import type { Room } from './app.svelte.ts';

export interface PhoneHomeReaders {
  temperature(roomId: string): number | null;
  light(roomId: string, lightId: string): LightValue | undefined;
  climate(roomId: string): ClimateValue | null | undefined;
}

export interface PhoneRoomSummary {
  id: string;
  name: string;
  temperature: number | null;
  lightsOn: number;
  lightsKnown: number;
  lightsTotal: number;
  windowOpen: boolean;
  presence: boolean;
  climateAvailable: boolean;
}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function projectPhoneRooms(
  rooms: readonly Room[],
  readers: PhoneHomeReaders,
): PhoneRoomSummary[] {
  return rooms.map((room) => {
    const lights = room.lights.filter((device) => !device.domain || device.domain === 'light');
    const values = lights.map((light) => safely(() => readers.light(room.id, light.id), undefined));
    return {
      id: room.id,
      name: room.name,
      temperature: safely(() => readers.temperature(room.id), null),
      lightsOn: values.filter((light) => light?.on).length,
      lightsKnown: values.filter((light) => light !== undefined).length,
      lightsTotal: lights.length,
      windowOpen: room.windowOpen,
      presence: room.presence,
      climateAvailable: safely(() => readers.climate(room.id), null) != null,
    };
  });
}

function temperatureLabel(value: number | null): string {
  return value === null ? 'Keine Temperaturdaten' : `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Grad`;
}

function lightLabel(summary: PhoneRoomSummary): string {
  if (summary.lightsTotal === 0) return 'Keine Lichter';
  if (summary.lightsKnown === 0) return 'Lichter nicht verfügbar';
  const unavailable = summary.lightsTotal - summary.lightsKnown;
  const known = `${summary.lightsOn} von ${summary.lightsKnown} ${summary.lightsKnown === 1 ? 'Licht' : 'Lichtern'} an`;
  return unavailable > 0 ? `${known}, ${unavailable} nicht verfügbar` : known;
}

export function accessibleRoomSummary(summary: PhoneRoomSummary): string {
  return [
    summary.name,
    temperatureLabel(summary.temperature),
    lightLabel(summary),
    summary.windowOpen ? '1 Fenster offen' : 'Fenster geschlossen',
    summary.presence ? 'Präsenz erkannt' : 'Keine Präsenz',
  ].join(', ');
}

export function validPhoneRoom(rooms: readonly Room[], roomId: string | null): Room | undefined {
  if (!roomId) return undefined;
  return rooms.find((room) => room.id === roomId);
}

export type PhoneRoomLayer = 'more' | 'room';
export type PhoneRoomReconciliationAction = 'none' | 'open-current' | 'clear-stale' | 'close-missing';

export function reconcilePhoneRoomLayer(
  rooms: readonly Room[],
  currentRoom: string | null,
  activeLayer: PhoneRoomLayer | null,
  controllerOpen: boolean,
  initialReconciled: boolean,
): PhoneRoomReconciliationAction {
  const room = validPhoneRoom(rooms, currentRoom);
  if (activeLayer === 'room' && !room) return 'close-missing';
  if (initialReconciled || !currentRoom) return 'none';
  if (!room) return 'clear-stale';
  return activeLayer === null && !controllerOpen ? 'open-current' : 'none';
}
