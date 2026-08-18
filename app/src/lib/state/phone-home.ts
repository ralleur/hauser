import { m } from '../../paraglide/messages.js';
import { intlLocale, pluralCategory } from './locale.svelte.ts';
import type { ClimateValue, LightValue } from '../adapter/types.ts';
import type { RoomHeroConfig } from '../config/household-config.ts';
import type {
  PhoneHeroVariant as SharedPhoneHeroVariant,
  RoomHeroResolution,
} from '../components/room-hero-assets.ts';
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

export type PhoneHeroVariant = SharedPhoneHeroVariant;

export function currentClimateTemperature(rooms: readonly PhoneRoomSummary[]): number | null {
  const temperatures = rooms.flatMap((room) => (
    room.climateAvailable && room.temperature !== null ? [room.temperature] : []
  ));
  if (temperatures.length === 0) return null;
  return temperatures.reduce((sum, temperature) => sum + temperature, 0) / temperatures.length;
}

/** Phone Home keeps its sun-driven light/dark input while delegating all URL,
 * focus and fallback policy to the shared resolver. */
export async function resolvePhoneHero(
  baseUrl: string,
  roomId: string,
  variant: PhoneHeroVariant,
  config: RoomHeroConfig | null = null,
): Promise<RoomHeroResolution> {
  const { resolveRoomHero } = await import('../components/room-hero-assets.ts');
  return resolveRoomHero({ target: 'phone', baseUrl, roomId, variant, config });
}

/** Compatibility projection for callers that only need the static fallback URL. */
export async function phoneHeroUrl(
  baseUrl: string,
  roomId: string,
  variant: PhoneHeroVariant,
): Promise<string | null> {
  return (await resolvePhoneHero(baseUrl, roomId, variant)).projectFallback?.url ?? null;
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
  if (value === null) return m.phone_temp_none();
  return m.phone_temp_degrees({
    value: value.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }),
  });
}

/* Plural nach der aktiven Sprache, nicht nach der deutschen Zweiform. */
const LIGHTS_SUMMARY = {
  one: m.phone_lights_summary_one, two: m.phone_lights_summary_other,
  few: m.phone_lights_summary_other, many: m.phone_lights_summary_other,
  other: m.phone_lights_summary_other,
};

function lightLabel(summary: PhoneRoomSummary): string {
  if (summary.lightsTotal === 0) return m.phone_lights_none();
  if (summary.lightsKnown === 0) return m.phone_lights_unavailable();
  const unavailable = summary.lightsTotal - summary.lightsKnown;
  const known = LIGHTS_SUMMARY[pluralCategory(summary.lightsKnown)]({
    on: summary.lightsOn, known: summary.lightsKnown,
  });
  return unavailable > 0
    ? m.phone_lights_unknown_extra({ summary: known, count: unavailable })
    : known;
}

export function accessibleRoomSummary(summary: PhoneRoomSummary): string {
  return [
    summary.name,
    temperatureLabel(summary.temperature),
    lightLabel(summary),
    summary.windowOpen ? m.status_window_open_one() : m.phone_window_closed(),
    summary.presence ? m.phone_presence_yes() : m.phone_presence_no(),
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
