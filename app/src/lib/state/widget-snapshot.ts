/* Widget-Schnappschuss (Plan 21, Stufe 4, §11): was Widgets, Live
   Activities und Kurzbefehle ohne die App wissen müssen. Wird nach dem Start
   und bei Änderungen entprellt an die Native-Brücke gegeben. Schema-Spiegel:
   hauser-app/ios/App/HauserWidgets/Snapshot.swift. */
import { runtime } from '../adapter/runtime.svelte.ts';
import type { ClimateValue, LightValue, SensorValue, SwitchValue } from '../adapter/types.ts';
import { HOME_OFF_SCRIPT_ENTITY, ROOM_SEED } from '../config/household-runtime-data.ts';
import { resolveRoomHero } from '../components/room-hero-assets.ts';
import { roomHeroConfig } from './room-hero-config.svelte.ts';
import { nativeBridge } from '../native/bridge.ts';
import { climateEntityId, lightEntityId, roomHasClimate, windowEntityIds } from './entities.ts';
import { energyView } from './energy.svelte.ts';
import { roomTemperature } from './commands.ts';
import { sceneDefOf, sceneMembers, scenes } from './scene-manager.svelte.ts';

export interface WidgetSnapshot {
  version: 1;
  updatedAt: number;
  rooms: Array<{
    id: string; name: string; image: string | null;
    lights: Array<{ entityId: string; name: string; on: boolean; brightness: number }>;
    lightsOn: number; lightsTotal: number; temperature: number | null;
    climate: { entityId: string; target: number; current: number | null; hvac: string } | null;
    windowsOpen: number;
    scenes: Array<{ id: string; label: string; members: Array<{ entityId: string; on: boolean; brightness: number }> }>;
  }>;
  home: { lightsOn: number; windowsOpen: number; openWindows: string[]; laundry: null; allOffEntityId: string | null; nextReminder: null };
  energy: { pv: number | null; load: number | null; grid: number | null; producedToday: number | null; consumedToday: number | null; curve: number[] } | null;
}

/** Bildpfad des Raums: eigenes Raumbild (Phone-Variante), sonst das
    mitgelieferte Motiv — beides liegt lokal im gespiegelten Bundle. */
function heroPath(roomId: string): string | null {
  const config = roomHeroConfig(roomId);
  if (config?.assetId) return `/assets/room-images/${config.assetId}/phone-light.avif`;
  const resolution = resolveRoomHero({ target: 'phone', baseUrl: '', roomId, variant: 'light', config: null });
  return resolution.userCandidate?.url ?? resolution.projectFallback?.url ?? null;
}

export function buildWidgetSnapshot(): WidgetSnapshot {
  let lightsOn = 0;
  const openWindows: string[] = [];
  const rooms = ROOM_SEED.map((room) => {
    const lights = room.lights.map((light) => {
      const entityId = lightEntityId(room.id, light.id);
      const value = runtime.merged(entityId) as LightValue | undefined;
      return { entityId, name: light.name, on: !!value?.on, brightness: Math.round(value?.brightness ?? 0) };
    });
    const on = lights.filter((l) => l.on).length;
    lightsOn += on;
    const windowsOpen = windowEntityIds(room.id).filter((id) => (runtime.merged(id) as SwitchValue | undefined)?.on).length;
    if (windowsOpen > 0) openWindows.push(room.name);
    let climate: WidgetSnapshot['rooms'][number]['climate'] = null;
    if (roomHasClimate(room.id)) {
      const value = runtime.merged(climateEntityId(room.id)) as ClimateValue | undefined;
      if (value) climate = { entityId: climateEntityId(room.id), target: value.target, current: value.current ?? null, hvac: value.hvac };
    }
    return {
      id: room.id, name: room.name, image: heroPath(room.id),
      lights, lightsOn: on, lightsTotal: lights.length,
      temperature: roomTemperature(room.id),
      climate, windowsOpen,
      scenes: scenes(room.id).map((scene) => {
        const def = sceneDefOf(room.id, scene.id);
        return {
          id: String(scene.id), label: scene.label,
          members: sceneMembers(room.id, scene.id).map((entityId) => ({ entityId, on: def.on, brightness: def.brightness })),
        };
      }),
    };
  });
  const energy = energyView();
  return {
    version: 1,
    updatedAt: Date.now(),
    rooms,
    home: { lightsOn, windowsOpen: openWindows.length, openWindows, laundry: null, allOffEntityId: HOME_OFF_SCRIPT_ENTITY || null, nextReminder: null },
    energy: energy.configured
      ? { pv: energy.pv, load: energy.load, grid: energy.grid, producedToday: energy.today.produced, consumedToday: energy.today.consumed, curve: [] }
      : null,
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let last = '';

/** Entprellt (2 s) an die App geben; unverändert wird nicht geschrieben. */
export function scheduleWidgetSnapshot(): void {
  const widgets = nativeBridge().widgets;
  if (!widgets) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const snapshot = buildWidgetSnapshot();
    const json = JSON.stringify(snapshot);
    if (json === last) return;
    last = json;
    widgets.update(json, snapshot.rooms.flatMap((room) => (room.image ? [{ roomId: room.id, path: room.image }] : [])));
  }, 2000);
}

/** Einmal beim Start anhängen: jede Zustandsänderung plant einen Schnappschuss. */
export function startWidgetSnapshots(): () => void {
  if (!nativeBridge().widgets) return () => undefined;
  scheduleWidgetSnapshot();
  const interval = setInterval(scheduleWidgetSnapshot, 60_000);
  return () => clearInterval(interval);
}
