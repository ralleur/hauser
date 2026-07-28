import type {
  EntityRole,
  HouseholdConfigV1,
  RoomConfig,
  VisibleEntityConfig,
} from './household-config.ts';

export interface SetupArea {
  area_id: string;
  name: string;
}

export interface SetupDevice {
  id: string;
  area_id: string | null;
}

export interface SetupEntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  name?: string | null;
  original_name?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
}

export interface SetupState {
  entity_id: string;
  attributes?: Record<string, unknown>;
}

export interface SetupDiscoverySnapshot {
  areas: SetupArea[];
  devices: SetupDevice[];
  entities: SetupEntityRegistryEntry[];
  states: SetupState[];
}

export interface SetupHouseholdSuggestion {
  config: HouseholdConfigV1;
  ignoredEntityIds: string[];
  inferredRooms: boolean;
}

function cloneHouseholdConfig(config: HouseholdConfigV1): HouseholdConfigV1 {
  return {
    ...config,
    rooms: config.rooms.map((room) => ({
      ...room,
      visibleEntities: room.visibleEntities.map((entity) => ({ ...entity })),
    })),
  };
}

export function canMoveSetupEntity(
  config: HouseholdConfigV1,
  entityId: string,
  targetRoomId: string,
): boolean {
  const source = config.rooms.find((room) => room.visibleEntities.some((entity) => entity.entityId === entityId));
  const entity = source?.visibleEntities.find((candidate) => candidate.entityId === entityId);
  const target = config.rooms.find((room) => room.id === targetRoomId);
  if (!source || !entity || !target) return false;
  if (source.id === target.id || entity.role === 'light') return true;
  return !target.visibleEntities.some((candidate) => candidate.role === entity.role);
}

export function moveSetupEntity(
  config: HouseholdConfigV1,
  entityId: string,
  targetRoomId: string,
): HouseholdConfigV1 {
  if (!canMoveSetupEntity(config, entityId, targetRoomId)) return config;
  const next = cloneHouseholdConfig(config);
  const source = next.rooms.find((room) => room.visibleEntities.some((entity) => entity.entityId === entityId));
  const target = next.rooms.find((room) => room.id === targetRoomId);
  if (!source || !target || source.id === target.id) return config;
  const index = source.visibleEntities.findIndex((entity) => entity.entityId === entityId);
  const [entity] = source.visibleEntities.splice(index, 1);
  const usedIds = new Set(target.visibleEntities.map((candidate) => candidate.id));
  entity.id = uniqueSlug(entity.id, entity.role, usedIds);
  target.visibleEntities.push(entity);
  target.visibleEntities.sort((left, right) => left.entityId.localeCompare(right.entityId));
  return next;
}

export function omitSetupEntity(
  config: HouseholdConfigV1,
  entityId: string,
): HouseholdConfigV1 {
  if (!config.rooms.some((room) => room.visibleEntities.some((entity) => entity.entityId === entityId))) {
    return config;
  }
  const next = cloneHouseholdConfig(config);
  for (const room of next.rooms) {
    room.visibleEntities = room.visibleEntities.filter((entity) => entity.entityId !== entityId);
  }
  return next;
}

function slug(value: string, fallback: string): string {
  const normalized = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function uniqueSlug(value: string, fallback: string, used: Set<string>): string {
  const base = slug(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function entityRole(state: SetupState): EntityRole | null {
  const domain = state.entity_id.slice(0, state.entity_id.indexOf('.'));
  const deviceClass = typeof state.attributes?.device_class === 'string'
    ? state.attributes.device_class
    : '';
  if (domain === 'light') return 'light';
  if (domain === 'climate') return 'climate';
  if (domain === 'camera') return 'camera';
  if (domain === 'sensor' && deviceClass === 'temperature') return 'temperature';
  if (domain === 'binary_sensor' && ['occupancy', 'presence', 'motion'].includes(deviceClass)) return 'presence';
  if (domain === 'binary_sensor' && ['door', 'garage_door', 'opening', 'window'].includes(deviceClass)) return 'window';
  return null;
}

function inferredRoomName(entityId: string): string {
  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  const prefix = objectId.includes('_') ? objectId.slice(0, objectId.indexOf('_')) : 'home';
  return prefix === 'home' ? 'Home' : `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;
}

function displayName(entry: SetupEntityRegistryEntry, state: SetupState): string {
  const friendly = state.attributes?.friendly_name;
  if (typeof entry.name === 'string' && entry.name.trim()) return entry.name.trim();
  if (typeof friendly === 'string' && friendly.trim()) return friendly.trim();
  if (typeof entry.original_name === 'string' && entry.original_name.trim()) return entry.original_name.trim();
  return state.entity_id.slice(state.entity_id.indexOf('.') + 1).replaceAll('_', ' ');
}

export function buildSetupHouseholdSuggestion(
  snapshot: SetupDiscoverySnapshot,
): SetupHouseholdSuggestion {
  const stateById = new Map(snapshot.states.map((state) => [state.entity_id, state] as const));
  const deviceArea = new Map(snapshot.devices.map((device) => [device.id, device.area_id] as const));
  const areaById = new Map(snapshot.areas.map((area) => [area.area_id, area] as const));
  const inferredRooms = snapshot.areas.length === 0;
  const grouped = new Map<string, Array<{ entry: SetupEntityRegistryEntry; state: SetupState; role: EntityRole }>>();
  const ignored = new Set<string>();

  for (const entry of [...snapshot.entities].sort((left, right) => left.entity_id.localeCompare(right.entity_id))) {
    const state = stateById.get(entry.entity_id);
    if (!state || entry.disabled_by || entry.hidden_by) {
      ignored.add(entry.entity_id);
      continue;
    }
    const role = entityRole(state);
    if (!role) continue;
    const explicitAreaId = entry.area_id ?? (entry.device_id ? deviceArea.get(entry.device_id) ?? null : null);
    const areaKey = explicitAreaId && areaById.has(explicitAreaId)
      ? explicitAreaId
      : inferredRooms
        ? `inferred:${inferredRoomName(entry.entity_id)}`
        : null;
    if (!areaKey) {
      ignored.add(entry.entity_id);
      continue;
    }
    const values = grouped.get(areaKey) ?? [];
    values.push({ entry, state, role });
    grouped.set(areaKey, values);
  }

  for (const area of snapshot.areas) if (!grouped.has(area.area_id)) grouped.set(area.area_id, []);

  const usedRoomIds = new Set<string>();
  const rooms: RoomConfig[] = [...grouped.entries()]
    .map(([areaKey, items]) => {
      const configuredArea = areaById.get(areaKey);
      const roomName = configuredArea?.name ?? areaKey.slice('inferred:'.length);
      const usedEntityIds = new Set<string>();
      const singletonRoles = new Set<EntityRole>();
      const visibleEntities: VisibleEntityConfig[] = [];
      for (const item of items) {
        if (item.role !== 'light' && singletonRoles.has(item.role)) {
          ignored.add(item.entry.entity_id);
          continue;
        }
        if (item.role !== 'light') singletonRoles.add(item.role);
        visibleEntities.push({
          id: uniqueSlug(item.entry.entity_id.slice(item.entry.entity_id.indexOf('.') + 1), item.role, usedEntityIds),
          name: displayName(item.entry, item.state),
          entityId: item.entry.entity_id,
          role: item.role,
        });
      }
      return {
        id: uniqueSlug(roomName, 'room', usedRoomIds),
        name: roomName,
        visibleEntities,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

  const sun = [...snapshot.states]
    .map((state) => state.entity_id)
    .filter((entityId) => entityId.startsWith('sun.'))
    .sort()[0] ?? null;

  return {
    config: {
      schemaVersion: 1,
      rooms,
      navigation: [
        { id: 'home', name: 'Home', order: 0, target: { type: 'module', id: 'home' } },
        { id: 'system', name: 'System', order: 1, target: { type: 'module', id: 'system' } },
      ],
      enabledModules: ['home', 'system'],
      energy: null,
      mediaTargets: [],
      globalEntities: {
        sun,
        vacationMode: null,
        homeOffScript: null,
        laundry: { washer: null, dryer: null },
      },
    },
    ignoredEntityIds: [...ignored].sort(),
    inferredRooms,
  };
}
