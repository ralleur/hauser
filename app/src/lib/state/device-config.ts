import { iconForDevice } from './light-icons.ts';
import type { LightSeed, RoomSeed, Room } from './app.svelte.ts';
import { sharedStorage } from './shared-config.ts';
import {
  MANAGED_DOMAINS,
  type EntityCatalogItem,
  type ManagedDomain,
} from './fake-discovery-catalog.ts';

export {
  FAKE_DISCOVERY_CATALOG,
  MANAGED_DOMAINS,
  type EntityCatalogItem,
  type ManagedDomain,
} from './fake-discovery-catalog.ts';

/* Verwaltbare HA-Domänen: alles, was über die RoomEdit-Suche in einen Raum
   gelegt werden kann. Die Overlay-/Kachel-Semantik hängt an der KATEGORIE
   (categoryOf), nicht an der Domäne — neue Domänen brauchen hier nur einen
   Eintrag + eine Kategorie-Zuordnung. */
/* Overlay-/Kachel-Kategorien: light = volles Licht-Detail, switch = Ein/Aus
   (auch fan/cover, bis eigene Overlays existieren), temp = Solltemp+Modus,
   info = read-only Wert/Zustand, media = Play/Pause+Lautstärke (Stufe 1). */
export type DeviceCategory = 'light' | 'switch' | 'temp' | 'info' | 'media';

/* Anzeige-Label je Kategorie (RoomEdit-Vorschläge, a11y). */
export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  light: 'Licht',
  switch: 'Schalter',
  temp: 'Klima',
  info: 'Sensor',
  media: 'Media',
};

export function categoryOf(domain: ManagedDomain): DeviceCategory {
  switch (domain) {
    case 'light': return 'light';
    case 'switch': case 'fan': case 'cover': case 'input_boolean': case 'vacuum': return 'switch';
    case 'climate': return 'temp';
    case 'sensor': case 'binary_sensor': return 'info';
    case 'media_player': return 'media';
  }
}

export interface ManagedDevice {
  id: string;
  entityId: string;
  domain: ManagedDomain;
  category: DeviceCategory;
  name: string;
  dimmable: boolean;
  colorTemp?: boolean;
  color?: boolean;
  colorTempMin?: number;
  colorTempMax?: number;
  /** Anzeige-Metadaten der info-Kategorie (sensor/binary_sensor) */
  unit?: string | null;
  deviceClass?: string | null;
  icon?: string;
}

export interface DeviceOverride {
  visible?: boolean;
  roomId?: string;
  /** Lokaler Anzeigename; ändert nicht den friendly_name in Home Assistant. */
  name?: string;
}

export interface DeviceConfig {
  version: 1;
  devices: Record<string, DeviceOverride>;
  order: Record<string, string[]>;
}

export interface DeviceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEVICE_CONFIG_KEY = 'hmi:device-config:v1';

export const EMPTY_DEVICE_CONFIG: DeviceConfig = { version: 1, devices: {}, order: {} };

export function cloneDeviceConfig(config: DeviceConfig): DeviceConfig {
  return {
    version: 1,
    devices: Object.fromEntries(Object.entries(config.devices).map(([id, v]) => [id, { ...v }])),
    order: Object.fromEntries(Object.entries(config.order).map(([room, ids]) => [room, [...ids]])),
  };
}

export function parseDeviceConfig(raw: string | null): DeviceConfig {
  if (!raw) return cloneDeviceConfig(EMPTY_DEVICE_CONFIG);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return cloneDeviceConfig(EMPTY_DEVICE_CONFIG);
    const obj = parsed as { version?: unknown; devices?: unknown; order?: unknown };
    if (obj.version !== 1) return cloneDeviceConfig(EMPTY_DEVICE_CONFIG);
    const devices: Record<string, DeviceOverride> = {};
    if (obj.devices && typeof obj.devices === 'object' && !Array.isArray(obj.devices)) {
      for (const [entityId, value] of Object.entries(obj.devices as Record<string, unknown>)) {
        if (!isManagedEntityId(entityId) || !value || typeof value !== 'object') continue;
        const v = value as Record<string, unknown>;
        const o: DeviceOverride = {};
        if (typeof v.visible === 'boolean') o.visible = v.visible;
        if (typeof v.roomId === 'string') o.roomId = v.roomId;
        const name = typeof v.name === 'string' ? normalizeDeviceName(v.name) : null;
        if (name) o.name = name;
        devices[entityId] = o;
      }
    }
    const order: Record<string, string[]> = {};
    if (obj.order && typeof obj.order === 'object' && !Array.isArray(obj.order)) {
      for (const [roomId, ids] of Object.entries(obj.order as Record<string, unknown>)) {
        if (typeof roomId !== 'string' || !Array.isArray(ids)) continue;
        order[roomId] = ids.filter((id): id is string => typeof id === 'string' && isManagedEntityId(id));
      }
    }
    return { version: 1, devices, order };
  } catch {
    return cloneDeviceConfig(EMPTY_DEVICE_CONFIG);
  }
}

export function loadDeviceConfig(storage: DeviceStorage | undefined = browserStorage()): DeviceConfig {
  if (!storage) return cloneDeviceConfig(EMPTY_DEVICE_CONFIG);
  return parseDeviceConfig(storage.getItem(DEVICE_CONFIG_KEY));
}

export function saveDeviceConfig(config: DeviceConfig, storage: DeviceStorage | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function resetDeviceConfig(storage: DeviceStorage | undefined = browserStorage()): DeviceConfig {
  if (storage) {
    try { storage.removeItem(DEVICE_CONFIG_KEY); } catch { /* ignore */ }
  }
  return cloneDeviceConfig(EMPTY_DEVICE_CONFIG);
}

export function seedCatalog(rooms: readonly RoomSeed[]): EntityCatalogItem[] {
  return rooms.flatMap((room) => room.lights.map((light) => ({
    entityId: light.entityId,
    domain: 'light' as const,
    name: light.name,
    area: room.id,
    capabilities: seedCapabilities(light),
  })));
}

export function mergeCatalog(seed: readonly EntityCatalogItem[], discovered: readonly EntityCatalogItem[]): EntityCatalogItem[] {
  const map = new Map<string, EntityCatalogItem>();
  // Demo-Geräte NICHT hart einspeisen: sie kommen ausschließlich über
  // FakeBackend.subscribeCatalog (fake-only). Sonst leckten sie in den
  // echten HA-Katalog und „Anzeigen" erzeugte Kacheln für nicht existierende
  // Entities, die sich nicht schalten lassen.
  for (const item of [...seed, ...discovered]) {
    if (!isManagedEntityId(item.entityId)) continue;
    const prev = map.get(item.entityId);
    map.set(item.entityId, {
      ...prev,
      ...item,
      capabilities: { ...(prev?.capabilities ?? {}), ...(item.capabilities ?? {}) },
    });
  }
  return [...map.values()];
}

export function buildRuntimeRooms(
  rooms: readonly RoomSeed[],
  catalog: readonly EntityCatalogItem[],
  config: DeviceConfig,
): Room[] {
  const roomIds = new Set(rooms.map((r) => r.id));
  const seedByEntity = new Map<string, { roomId: string; light: LightSeed }>();
  for (const room of rooms) for (const light of room.lights) seedByEntity.set(light.entityId, { roomId: room.id, light });
  const catalogById = new Map(catalog.map((item) => [item.entityId, item]));

  const byRoom = new Map<string, ManagedDevice[]>();
  for (const room of rooms) byRoom.set(room.id, []);

  for (const item of catalog) {
    const seed = seedByEntity.get(item.entityId);
    const override = config.devices[item.entityId];
    const seedVisible = !!seed;
    const visible = override?.visible ?? seedVisible;
    if (!visible) continue;
    const suggestedRoom = seed?.roomId ?? normalizeRoomId(item.area, roomIds) ?? rooms[0]?.id;
    const roomId = override?.roomId && roomIds.has(override.roomId) ? override.roomId : suggestedRoom;
    if (!roomId) continue;
    byRoom.get(roomId)?.push(toManagedDevice(item, seed?.light, override?.name));
  }

  return rooms.map((room) => {
    const devices = byRoom.get(room.id) ?? [];
    return {
      id: room.id,
      name: room.name,
      presence: room.presence,
      windowOpen: room.windowOpen,
      lights: sortDevices(devices, config.order[room.id], catalogById),
    };
  });
}

export function setDeviceVisibility(config: DeviceConfig, entityId: string, visible: boolean, roomId?: string): DeviceConfig {
  const next = cloneDeviceConfig(config);
  next.devices[entityId] = { ...(next.devices[entityId] ?? {}), visible };
  if (roomId) next.devices[entityId].roomId = roomId;
  if (!visible) {
    for (const ids of Object.values(next.order)) removeFromArray(ids, entityId);
  }
  return next;
}

export function setDeviceName(config: DeviceConfig, entityId: string, name: string | null): DeviceConfig {
  const next = cloneDeviceConfig(config);
  if (!isManagedEntityId(entityId)) return next;
  const normalized = normalizeDeviceName(name);
  const override = { ...(next.devices[entityId] ?? {}) };
  if (normalized) override.name = normalized;
  else delete override.name;
  if (Object.keys(override).length) next.devices[entityId] = override;
  else delete next.devices[entityId];
  return next;
}

export function assignDeviceRoom(config: DeviceConfig, entityId: string, roomId: string): DeviceConfig {
  const next = cloneDeviceConfig(config);
  next.devices[entityId] = { ...(next.devices[entityId] ?? {}), visible: true, roomId };
  for (const [rid, ids] of Object.entries(next.order)) {
    if (rid !== roomId) removeFromArray(ids, entityId);
  }
  if (!next.order[roomId]) next.order[roomId] = [];
  if (!next.order[roomId].includes(entityId)) next.order[roomId].push(entityId);
  return next;
}

/* Ersetzt die Order eines Raums komplett durch die angezeigte Reihenfolge.
   Nötig, weil config.order oft nur ein Teil-Ranking ist (Seed-Geräte ohne
   Override fehlen darin) — punktuelle Moves auf einem Teil-Ranking würden
   das Gerät sonst an den Anfang/das Ende springen lassen statt eine Position. */
export function setRoomOrder(config: DeviceConfig, roomId: string, entityIds: readonly string[]): DeviceConfig {
  const next = cloneDeviceConfig(config);
  next.order[roomId] = entityIds.filter(isManagedEntityId);
  return next;
}

export function reorderDevice(config: DeviceConfig, roomId: string, entityId: string, beforeEntityId: string | null): DeviceConfig {
  const next = cloneDeviceConfig(config);
  const ids = [...(next.order[roomId] ?? [])];
  removeFromArray(ids, entityId);
  if (beforeEntityId && ids.includes(beforeEntityId)) ids.splice(ids.indexOf(beforeEntityId), 0, entityId);
  else ids.push(entityId);
  next.order[roomId] = ids;
  return next;
}

export function isManagedEntityId(entityId: string): boolean {
  return domainOf(entityId) !== null;
}

export function domainOf(entityId: string): ManagedDomain | null {
  const dot = entityId.indexOf('.');
  if (dot <= 0) return null;
  const domain = entityId.slice(0, dot);
  return (MANAGED_DOMAINS as readonly string[]).includes(domain) ? (domain as ManagedDomain) : null;
}

function toManagedDevice(item: EntityCatalogItem, seed?: LightSeed, nameOverride?: string): ManagedDevice {
  const domain = item.domain;
  const category = categoryOf(domain);
  const capabilities = item.capabilities ?? {};
  return {
    id: stableDeviceId(item.entityId),
    entityId: item.entityId,
    domain,
    category,
    name: nameOverride ?? item.name,
    dimmable: domain === 'light' ? (capabilities.dimmable ?? seed?.dimmable ?? false) : false,
    colorTemp: domain === 'light' ? (capabilities.colorTemp ?? seed?.colorTemp) : false,
    color: domain === 'light' ? (capabilities.color ?? seed?.color) : false,
    colorTempMin: capabilities.colorTempMin,
    colorTempMax: capabilities.colorTempMax,
    unit: item.unit,
    deviceClass: item.deviceClass,
    icon: iconForDevice(item.entityId, category, seed?.icon),
  };
}

function seedCapabilities(light: LightSeed): EntityCatalogItem['capabilities'] {
  return {
    dimmable: light.dimmable,
    colorTemp: !!light.colorTemp,
    color: !!light.color,
  };
}

function sortDevices(devices: ManagedDevice[], order: readonly string[] | undefined, catalogById: Map<string, EntityCatalogItem>): ManagedDevice[] {
  void catalogById;
  const rank = new Map((order ?? []).map((id, i) => [id, i]));
  return devices.map((device, index) => ({ device, index })).sort((a, b) => {
    const ar = rank.get(a.device.entityId);
    const br = rank.get(b.device.entityId);
    if (ar !== undefined || br !== undefined) return (ar ?? 9999) - (br ?? 9999) || a.index - b.index;
    return a.index - b.index;
  }).map((entry) => entry.device);
}

function stableDeviceId(entityId: string): string {
  return entityId.replace(/^[^.]+\./, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function normalizeRoomId(area: string | null | undefined, roomIds: Set<string>): string | null {
  if (!area) return null;
  const normalized = area.toLowerCase().replace('ü', 'ue').replace(/[^a-z0-9_-]+/g, '_');
  if (roomIds.has(normalized)) return normalized;
  return [...roomIds].find((id) => id === area || id.toLowerCase() === area.toLowerCase()) ?? null;
}

function normalizeDeviceName(name: string | null): string | null {
  if (name === null) return null;
  const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 80).trim();
  return normalized || null;
}

function removeFromArray(values: string[], value: string): void {
  const idx = values.indexOf(value);
  if (idx >= 0) values.splice(idx, 1);
}

function browserStorage(): DeviceStorage | undefined {
  try { if (typeof localStorage === 'undefined') return undefined; } catch { return undefined; }
  const candidate = sharedStorage as Partial<DeviceStorage>;
  if (typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function' || typeof candidate.removeItem !== 'function') {
    return undefined;
  }
  return candidate as DeviceStorage;
}
