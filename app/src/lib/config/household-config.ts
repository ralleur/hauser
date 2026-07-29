export const HOUSEHOLD_SCHEMA_VERSION = 2 as const;

export type ModuleId =
  | 'home'
  | 'energy'
  | 'calendar'
  | 'notes'
  | 'shopping'
  | 'reminders'
  | 'media'
  | 'songs'
  | 'library'
  | 'ablage'
  | 'system'
  | 'laundry'
  | 'vacation';
export type EntityRole =
  | 'light'
  | 'climate'
  | 'temperature'
  | 'presence'
  | 'window'
  | 'camera'
  | 'other';

export interface VisibleEntityConfig {
  id: string;
  name: string;
  entityId: string;
  role: EntityRole;
}

export interface RoomConfig {
  id: string;
  name: string;
  visibleEntities: VisibleEntityConfig[];
}

export interface NavigationTargetConfig {
  type: 'room' | 'module';
  id: string;
}

export interface NavigationItemConfig {
  id: string;
  name: string;
  order: number;
  target: NavigationTargetConfig;
}

export interface EnergyLoadConfig {
  id: string;
  name: string;
  entityId: string;
  group?: string;
}

export interface EnergyConfig {
  sensors: {
    productionPower: string | null;
    consumptionPower: EnergyLoadConfig[];
  };
  kpis: {
    producedToday: string | null;
    consumedToday: string | null;
    fedInToday: string | null;
    drawnToday: string | null;
  };
}

export interface MediaTargetConfig {
  id: string;
  name: string;
  entityId: string;
  roomId: string | null;
}

export interface GlobalEntitiesConfig {
  sun: string | null;
  vacationMode: string | null;
  homeOffScript: string | null;
  laundry: {
    washer: string | null;
    dryer: string | null;
  };
}

export interface HouseholdConfigV2 {
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  rooms: RoomConfig[];
  navigation: NavigationItemConfig[];
  enabledModules: ModuleId[];
  energy: EnergyConfig | null;
  mediaTargets: MediaTargetConfig[];
  globalEntities: GlobalEntitiesConfig;
}

export type ConfigIssueCode =
  | 'REQUIRED'
  | 'TYPE_MISMATCH'
  | 'UNKNOWN_FIELD'
  | 'UNKNOWN_SCHEMA_VERSION'
  | 'INVALID_VALUE'
  | 'INVALID_ID'
  | 'INVALID_ENTITY_ID'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_ENTITY_ID'
  | 'UNKNOWN_REFERENCE'
  | 'INCONSISTENT_MODULE';

export interface ConfigIssue {
  code: ConfigIssueCode;
  path: string;
  message: string;
}

export type HouseholdConfigParseResult =
  | { ok: true; value: HouseholdConfigV2 }
  | { ok: false; issues: ConfigIssue[] };

const LOCAL_ID = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const HA_ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const MODULE_IDS: readonly ModuleId[] = [
  'home',
  'energy',
  'calendar',
  'notes',
  'shopping',
  'reminders',
  'media',
  'songs',
  'library',
  'ablage',
  'system',
  'laundry',
  'vacation',
];
const ENTITY_ROLES: readonly EntityRole[] = [
  'light',
  'climate',
  'temperature',
  'presence',
  'window',
  'camera',
  'other',
];
type EntityDomainConstraint = string | readonly string[];
const ENTITY_ROLE_DOMAINS: Partial<Record<EntityRole, EntityDomainConstraint>> = {
  light: 'light',
  climate: 'climate',
  temperature: 'sensor',
  presence: ['binary_sensor', 'device_tracker'],
  window: 'binary_sensor',
  camera: 'camera',
};
const MISSING = Symbol('missing');
type Missing = typeof MISSING;
type JsonObject = Record<string, unknown>;

class ConfigValidator {
  readonly issues: ConfigIssue[] = [];
  readonly entityPaths = new Map<string, string>();

  issue(code: ConfigIssueCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  object(value: unknown, path: string): JsonObject | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      this.issue('TYPE_MISMATCH', path, 'Expected an object.');
      return undefined;
    }
    return value as JsonObject;
  }

  array(value: unknown, path: string): unknown[] | undefined {
    if (!Array.isArray(value)) {
      this.issue('TYPE_MISMATCH', path, 'Expected an array.');
      return undefined;
    }
    const items = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        this.issue('REQUIRED', `${path}[${index}]`, 'Required array item is missing.');
        items[index] = undefined;
      } else {
        items[index] = value[index];
      }
    }
    return items;
  }

  exactKeys(object: JsonObject, allowed: readonly string[], path: string): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(object)) {
      if (!allowedSet.has(key)) {
        this.issue('UNKNOWN_FIELD', propertyPath(path, key), `Unknown field "${key}".`);
      }
    }
  }

  required(object: JsonObject, key: string, path: string): unknown | Missing {
    if (!Object.hasOwn(object, key)) {
      this.issue('REQUIRED', propertyPath(path, key), 'Required field is missing.');
      return MISSING;
    }
    return object[key];
  }

  string(value: unknown | Missing, path: string, label: string): string {
    if (value === MISSING) return '';
    if (typeof value !== 'string') {
      this.issue('TYPE_MISMATCH', path, `Expected ${label} to be a string.`);
      return '';
    }
    if (value.trim().length === 0) {
      this.issue('INVALID_VALUE', path, `${label} must not be empty.`);
    }
    return value;
  }

  localId(value: unknown | Missing, path: string): string {
    if (value === MISSING) return '';
    if (typeof value !== 'string') {
      this.issue('TYPE_MISMATCH', path, 'Expected an ID string.');
      return '';
    }
    if (!LOCAL_ID.test(value)) {
      this.issue('INVALID_ID', path, 'ID must use lower-case letters, digits, underscores or hyphens.');
    }
    return value;
  }

  entityId(
    value: unknown | Missing,
    path: string,
    expectedDomains?: EntityDomainConstraint,
  ): string {
    if (value === MISSING) return '';
    if (typeof value !== 'string') {
      this.issue('TYPE_MISMATCH', path, 'Expected a Home Assistant entity ID string.');
      return '';
    }
    if (!HA_ENTITY_ID.test(value)) {
      this.issue('INVALID_ENTITY_ID', path, 'Expected a lower-case Home Assistant entity ID in domain.object form.');
      return value;
    }
    const allowedDomains = typeof expectedDomains === 'string'
      ? [expectedDomains]
      : expectedDomains;
    const actualDomain = value.slice(0, value.indexOf('.'));
    if (allowedDomains !== undefined && !allowedDomains.includes(actualDomain)) {
      this.issue(
        'INVALID_ENTITY_ID',
        path,
        `Expected a Home Assistant ${allowedDomains.join(' or ')} entity ID.`,
      );
    }
    const firstPath = this.entityPaths.get(value);
    if (firstPath !== undefined) {
      this.issue('DUPLICATE_ENTITY_ID', path, `Entity ID "${value}" is already configured at ${firstPath}.`);
    } else {
      this.entityPaths.set(value, path);
    }
    return value;
  }

  nullableEntityId(value: unknown | Missing, path: string, expectedDomain?: string): string | null {
    if (value === MISSING) return null;
    if (value === null) return null;
    return this.entityId(value, path, expectedDomain);
  }
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function duplicateIds(
  validator: ConfigValidator,
  values: readonly { id: string; path: string }[],
): void {
  const seen = new Map<string, string>();
  for (const value of values) {
    if (!LOCAL_ID.test(value.id)) continue;
    const firstPath = seen.get(value.id);
    if (firstPath !== undefined) {
      validator.issue('DUPLICATE_ID', value.path, `ID "${value.id}" is already used at ${firstPath}.`);
    } else {
      seen.set(value.id, value.path);
    }
  }
}

function parseVisibleEntity(
  validator: ConfigValidator,
  value: unknown,
  path: string,
): VisibleEntityConfig {
  const object = validator.object(value, path);
  if (!object) return { id: '', name: '', entityId: '', role: 'other' };
  validator.exactKeys(object, ['id', 'name', 'entityId', 'role'], path);

  const id = validator.localId(validator.required(object, 'id', path), `${path}.id`);
  const name = validator.string(validator.required(object, 'name', path), `${path}.name`, 'entity name');
  const roleValue = validator.required(object, 'role', path);
  let role: EntityRole = 'other';
  if (roleValue !== MISSING) {
    if (typeof roleValue !== 'string') {
      validator.issue('TYPE_MISMATCH', `${path}.role`, 'Expected entity role to be a string.');
    } else if (!ENTITY_ROLES.includes(roleValue as EntityRole)) {
      validator.issue('INVALID_VALUE', `${path}.role`, `Unsupported entity role "${roleValue}".`);
    } else {
      role = roleValue as EntityRole;
    }
  }
  const expectedDomain = ENTITY_ROLE_DOMAINS[role];
  const entityId = validator.entityId(
    validator.required(object, 'entityId', path),
    `${path}.entityId`,
    expectedDomain,
  );
  return { id, name, entityId, role };
}

function parseRoom(validator: ConfigValidator, value: unknown, path: string): RoomConfig {
  const object = validator.object(value, path);
  if (!object) return { id: '', name: '', visibleEntities: [] };
  validator.exactKeys(object, ['id', 'name', 'visibleEntities'], path);

  const id = validator.localId(validator.required(object, 'id', path), `${path}.id`);
  const name = validator.string(validator.required(object, 'name', path), `${path}.name`, 'room name');
  const entitiesValue = validator.required(object, 'visibleEntities', path);
  const entityValues = entitiesValue === MISSING ? undefined : validator.array(entitiesValue, `${path}.visibleEntities`);
  const visibleEntities = (entityValues ?? []).map((entity, index) =>
    parseVisibleEntity(validator, entity, `${path}.visibleEntities[${index}]`));
  duplicateIds(validator, visibleEntities.map((entity, index) => ({
    id: entity.id,
    path: `${path}.visibleEntities[${index}].id`,
  })));

  return { id, name, visibleEntities };
}

function parseNavigationTarget(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): NavigationTargetConfig {
  if (value === MISSING) return { type: 'room', id: '' };
  const object = validator.object(value, path);
  if (!object) return { type: 'room', id: '' };
  validator.exactKeys(object, ['type', 'id'], path);

  const typeValue = validator.required(object, 'type', path);
  let type: NavigationTargetConfig['type'] = 'room';
  if (typeValue !== MISSING) {
    if (typeof typeValue !== 'string') {
      validator.issue('TYPE_MISMATCH', `${path}.type`, 'Expected navigation target type to be a string.');
    } else if (typeValue !== 'room' && typeValue !== 'module') {
      validator.issue('INVALID_VALUE', `${path}.type`, `Unsupported navigation target type "${typeValue}".`);
    } else {
      type = typeValue;
    }
  }
  const id = validator.localId(validator.required(object, 'id', path), `${path}.id`);
  return { type, id };
}

function parseNavigationItem(
  validator: ConfigValidator,
  value: unknown,
  path: string,
): NavigationItemConfig {
  const object = validator.object(value, path);
  if (!object) return { id: '', name: '', order: 0, target: { type: 'room', id: '' } };
  validator.exactKeys(object, ['id', 'name', 'order', 'target'], path);

  const id = validator.localId(validator.required(object, 'id', path), `${path}.id`);
  const name = validator.string(validator.required(object, 'name', path), `${path}.name`, 'navigation name');
  const orderValue = validator.required(object, 'order', path);
  let order = 0;
  if (orderValue !== MISSING) {
    if (typeof orderValue !== 'number') {
      validator.issue('TYPE_MISMATCH', `${path}.order`, 'Expected navigation order to be a number.');
    } else if (!Number.isSafeInteger(orderValue) || orderValue < 0) {
      validator.issue('INVALID_VALUE', `${path}.order`, 'Navigation order must be a non-negative safe integer.');
    } else {
      order = orderValue;
    }
  }
  const target = parseNavigationTarget(validator, validator.required(object, 'target', path), `${path}.target`);
  return { id, name, order, target };
}

function parseEnergyLoad(
  validator: ConfigValidator,
  value: unknown,
  path: string,
): EnergyLoadConfig {
  const object = validator.object(value, path);
  if (!object) return { id: '', name: '', entityId: '' };
  validator.exactKeys(object, ['id', 'name', 'entityId', 'group'], path);
  const group = Object.hasOwn(object, 'group')
    ? validator.string(object.group, `${path}.group`, 'energy source group')
    : undefined;
  return {
    id: validator.localId(validator.required(object, 'id', path), `${path}.id`),
    name: validator.string(validator.required(object, 'name', path), `${path}.name`, 'energy source name'),
    entityId: validator.entityId(
      validator.required(object, 'entityId', path),
      `${path}.entityId`,
      'sensor',
    ),
    ...(group === undefined ? {} : { group }),
  };
}

function parseEnergy(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): EnergyConfig | null {
  if (value === MISSING || value === null) return null;
  const object = validator.object(value, path);
  if (!object) return null;
  validator.exactKeys(object, ['sensors', 'kpis'], path);

  const sensorsValue = validator.required(object, 'sensors', path);
  const sensors = sensorsValue === MISSING ? undefined : validator.object(sensorsValue, `${path}.sensors`);
  let productionPower: string | null = null;
  let consumptionPower: EnergyLoadConfig[] = [];
  if (sensors) {
    validator.exactKeys(sensors, ['productionPower', 'consumptionPower'], `${path}.sensors`);
    productionPower = validator.nullableEntityId(
      validator.required(sensors, 'productionPower', `${path}.sensors`),
      `${path}.sensors.productionPower`,
      'sensor',
    );
    const loadValue = validator.required(sensors, 'consumptionPower', `${path}.sensors`);
    const loads = loadValue === MISSING ? undefined : validator.array(loadValue, `${path}.sensors.consumptionPower`);
    consumptionPower = (loads ?? []).map((load, index) =>
      parseEnergyLoad(validator, load, `${path}.sensors.consumptionPower[${index}]`));
    duplicateIds(validator, consumptionPower.map((load, index) => ({
      id: load.id,
      path: `${path}.sensors.consumptionPower[${index}].id`,
    })));
  }

  const kpisValue = validator.required(object, 'kpis', path);
  const kpis = kpisValue === MISSING ? undefined : validator.object(kpisValue, `${path}.kpis`);
  let producedToday: string | null = null;
  let consumedToday: string | null = null;
  let fedInToday: string | null = null;
  let drawnToday: string | null = null;
  if (kpis) {
    validator.exactKeys(kpis, ['producedToday', 'consumedToday', 'fedInToday', 'drawnToday'], `${path}.kpis`);
    producedToday = validator.nullableEntityId(
      validator.required(kpis, 'producedToday', `${path}.kpis`), `${path}.kpis.producedToday`, 'sensor');
    consumedToday = validator.nullableEntityId(
      validator.required(kpis, 'consumedToday', `${path}.kpis`), `${path}.kpis.consumedToday`, 'sensor');
    fedInToday = validator.nullableEntityId(
      validator.required(kpis, 'fedInToday', `${path}.kpis`), `${path}.kpis.fedInToday`, 'sensor');
    drawnToday = validator.nullableEntityId(
      validator.required(kpis, 'drawnToday', `${path}.kpis`), `${path}.kpis.drawnToday`, 'sensor');
  }

  return {
    sensors: { productionPower, consumptionPower },
    kpis: { producedToday, consumedToday, fedInToday, drawnToday },
  };
}

function parseMediaTarget(
  validator: ConfigValidator,
  value: unknown,
  path: string,
): MediaTargetConfig {
  const object = validator.object(value, path);
  if (!object) return { id: '', name: '', entityId: '', roomId: null };
  validator.exactKeys(object, ['id', 'name', 'entityId', 'roomId'], path);

  const roomValue = validator.required(object, 'roomId', path);
  let roomId: string | null = null;
  if (roomValue !== MISSING && roomValue !== null) {
    roomId = validator.localId(roomValue, `${path}.roomId`);
  }
  return {
    id: validator.localId(validator.required(object, 'id', path), `${path}.id`),
    name: validator.string(validator.required(object, 'name', path), `${path}.name`, 'media target name'),
    entityId: validator.entityId(
      validator.required(object, 'entityId', path),
      `${path}.entityId`,
      'media_player',
    ),
    roomId,
  };
}

function parseGlobalEntities(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): GlobalEntitiesConfig {
  if (value === MISSING) {
    return { sun: null, vacationMode: null, homeOffScript: null, laundry: { washer: null, dryer: null } };
  }
  const object = validator.object(value, path);
  if (!object) return { sun: null, vacationMode: null, homeOffScript: null, laundry: { washer: null, dryer: null } };
  validator.exactKeys(object, ['sun', 'vacationMode', 'homeOffScript', 'laundry'], path);

  const laundryValue = validator.required(object, 'laundry', path);
  const laundry = laundryValue === MISSING ? undefined : validator.object(laundryValue, `${path}.laundry`);
  let washer: string | null = null;
  let dryer: string | null = null;
  if (laundry) {
    validator.exactKeys(laundry, ['washer', 'dryer'], `${path}.laundry`);
    washer = validator.nullableEntityId(
      validator.required(laundry, 'washer', `${path}.laundry`),
      `${path}.laundry.washer`,
      'input_boolean',
    );
    dryer = validator.nullableEntityId(
      validator.required(laundry, 'dryer', `${path}.laundry`),
      `${path}.laundry.dryer`,
      'input_boolean',
    );
  }
  return {
    sun: validator.nullableEntityId(validator.required(object, 'sun', path), `${path}.sun`, 'sun'),
    vacationMode: validator.nullableEntityId(
      validator.required(object, 'vacationMode', path),
      `${path}.vacationMode`,
      'switch',
    ),
    homeOffScript: validator.nullableEntityId(
      validator.required(object, 'homeOffScript', path),
      `${path}.homeOffScript`,
      'script',
    ),
    laundry: { washer, dryer },
  };
}

/**
 * Validates an unknown value without mutating it. No installation-specific value
 * is defaulted: every required field must be present, and disabled optional
 * subsystems are represented explicitly with null/empty arrays.
 */
export function parseHouseholdConfig(input: unknown): HouseholdConfigParseResult {
  const validator = new ConfigValidator();
  const root = validator.object(input, '$');
  if (!root) return { ok: false, issues: validator.issues };
  validator.exactKeys(
    root,
    ['schemaVersion', 'rooms', 'navigation', 'enabledModules', 'energy', 'mediaTargets', 'globalEntities'],
    '$',
  );

  const schemaVersionValue = validator.required(root, 'schemaVersion', '$');
  if (schemaVersionValue !== MISSING) {
    if (typeof schemaVersionValue !== 'number') {
      validator.issue('TYPE_MISMATCH', '$.schemaVersion', 'Expected schemaVersion to be a number.');
    } else if (schemaVersionValue !== HOUSEHOLD_SCHEMA_VERSION) {
      validator.issue(
        'UNKNOWN_SCHEMA_VERSION',
        '$.schemaVersion',
        `Unsupported household schema version ${schemaVersionValue}.`,
      );
    }
  }

  const roomsValue = validator.required(root, 'rooms', '$');
  const roomItems = roomsValue === MISSING ? undefined : validator.array(roomsValue, '$.rooms');
  const rooms = (roomItems ?? []).map((room, index) => parseRoom(validator, room, `$.rooms[${index}]`));
  duplicateIds(validator, rooms.map((room, index) => ({ id: room.id, path: `$.rooms[${index}].id` })));

  const navigationValue = validator.required(root, 'navigation', '$');
  const navigationItems = navigationValue === MISSING
    ? undefined
    : validator.array(navigationValue, '$.navigation');
  const navigation = (navigationItems ?? []).map((item, index) =>
    parseNavigationItem(validator, item, `$.navigation[${index}]`));
  duplicateIds(validator, navigation.map((item, index) => ({
    id: item.id,
    path: `$.navigation[${index}].id`,
  })));

  const modulesValue = validator.required(root, 'enabledModules', '$');
  const moduleItems = modulesValue === MISSING ? undefined : validator.array(modulesValue, '$.enabledModules');
  const enabledModules: ModuleId[] = [];
  const moduleIdPaths: { id: string; path: string }[] = [];
  for (const [index, moduleValue] of (moduleItems ?? []).entries()) {
    const path = `$.enabledModules[${index}]`;
    if (typeof moduleValue !== 'string') {
      validator.issue('TYPE_MISMATCH', path, 'Expected a module ID string.');
      continue;
    }
    if (!MODULE_IDS.includes(moduleValue as ModuleId)) {
      validator.issue('INVALID_ID', path, `Unsupported module ID "${moduleValue}".`);
      continue;
    }
    enabledModules.push(moduleValue as ModuleId);
    moduleIdPaths.push({ id: moduleValue, path });
  }
  duplicateIds(validator, moduleIdPaths);

  const energy = parseEnergy(validator, validator.required(root, 'energy', '$'), '$.energy');

  const mediaValue = validator.required(root, 'mediaTargets', '$');
  const mediaItems = mediaValue === MISSING ? undefined : validator.array(mediaValue, '$.mediaTargets');
  const mediaTargets = (mediaItems ?? []).map((target, index) =>
    parseMediaTarget(validator, target, `$.mediaTargets[${index}]`));
  duplicateIds(validator, mediaTargets.map((target, index) => ({
    id: target.id,
    path: `$.mediaTargets[${index}].id`,
  })));

  const globalEntities = parseGlobalEntities(
    validator,
    validator.required(root, 'globalEntities', '$'),
    '$.globalEntities',
  );

  const roomIds = new Set(rooms.map((room) => room.id));
  const moduleIds = new Set(enabledModules);
  for (const [index, item] of navigation.entries()) {
    if (!LOCAL_ID.test(item.target.id)) continue;
    const exists = item.target.type === 'room'
      ? roomIds.has(item.target.id)
      : moduleIds.has(item.target.id as ModuleId);
    if (!exists) {
      validator.issue(
        'UNKNOWN_REFERENCE',
        `$.navigation[${index}].target.id`,
        `Navigation target "${item.target.id}" does not exist or is not enabled.`,
      );
    }
  }
  for (const [index, target] of mediaTargets.entries()) {
    if (target.roomId !== null && LOCAL_ID.test(target.roomId) && !roomIds.has(target.roomId)) {
      validator.issue(
        'UNKNOWN_REFERENCE',
        `$.mediaTargets[${index}].roomId`,
        `Media target room "${target.roomId}" does not exist.`,
      );
    }
  }

  const energyEnabled = moduleIds.has('energy');
  if (energyEnabled && energy === null) {
    validator.issue('INCONSISTENT_MODULE', '$.energy', 'The energy module is enabled but energy configuration is null.');
  } else if (!energyEnabled && energy !== null) {
    validator.issue('INCONSISTENT_MODULE', '$.energy', 'Energy configuration is present but the energy module is disabled.');
  }
  if (!moduleIds.has('media') && mediaTargets.length > 0) {
    validator.issue(
      'INCONSISTENT_MODULE',
      '$.mediaTargets',
      'Media targets are configured but the media module is disabled.',
    );
  }

  if (validator.issues.length > 0) return { ok: false, issues: validator.issues };
  return {
    ok: true,
    value: {
      schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
      rooms,
      navigation,
      enabledModules,
      energy,
      mediaTargets,
      globalEntities,
    },
  };
}

export interface CommandContract {
  entityId: string;
  domain: 'light' | 'climate' | 'media_player' | 'switch' | 'script';
  services: string[];
}

export interface HouseholdRuntimeModel {
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  rooms: RoomConfig[];
  navigation: NavigationItemConfig[];
  enabledModules: ModuleId[];
  energy: EnergyConfig | null;
  mediaTargets: MediaTargetConfig[];
  globalEntities: GlobalEntitiesConfig;
  /** Complete, duplicate-free and lexicographically sorted HA subscription set. */
  subscriptionEntityIds: string[];
  /** Compatibility alias. It is always the same array as subscriptionEntityIds. */
  entityIds: string[];
  /** Static command capabilities, separate from the subscription inventory. */
  commandContracts: CommandContract[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return compareText(left.id, right.id);
}

function commandKey(contract: Pick<CommandContract, 'entityId' | 'domain'>): string {
  return `${contract.entityId}\u0000${contract.domain}`;
}

/** Compiles a validated v2 configuration into a canonical runtime representation. */
export function compileHouseholdConfig(config: HouseholdConfigV2): HouseholdRuntimeModel {
  // Room order is installation semantics. Entities inside a room are keyed and
  // canonicalized so object/fixture construction order cannot create noise.
  const rooms = config.rooms.map((room) => ({
    id: room.id,
    name: room.name,
    visibleEntities: room.visibleEntities.map((entity) => ({ ...entity })).sort(byId),
  }));
  const navigation = config.navigation
    .map((item) => ({ ...item, target: { ...item.target } }))
    .sort((left, right) => left.order - right.order || compareText(left.id, right.id));
  const enabledModules = [...config.enabledModules].sort();
  const mediaTargets = config.mediaTargets.map((target) => ({ ...target })).sort(byId);
  const energy = config.energy === null
    ? null
    : {
        sensors: {
          productionPower: config.energy.sensors.productionPower,
          consumptionPower: config.energy.sensors.consumptionPower
            .map((source) => ({ ...source }))
            .sort(byId),
        },
        kpis: { ...config.energy.kpis },
      };
  const globalEntities = {
    sun: config.globalEntities.sun,
    vacationMode: config.globalEntities.vacationMode,
    homeOffScript: config.globalEntities.homeOffScript,
    laundry: { ...config.globalEntities.laundry },
  };

  const subscriptionEntityIds = new Set<string>();
  const commands = new Map<string, CommandContract>();
  const addCommand = (
    entityId: string,
    domain: CommandContract['domain'],
    services: readonly string[],
  ): void => {
    const contract = { entityId, domain, services: [...new Set(services)].sort() };
    commands.set(commandKey(contract), contract);
  };

  for (const room of rooms) {
    for (const entity of room.visibleEntities) {
      subscriptionEntityIds.add(entity.entityId);
      if (entity.role === 'light') {
        addCommand(entity.entityId, 'light', ['turn_on', 'turn_off']);
      } else if (entity.role === 'climate') {
        addCommand(entity.entityId, 'climate', ['set_temperature', 'set_hvac_mode']);
      }
    }
  }
  for (const target of mediaTargets) {
    subscriptionEntityIds.add(target.entityId);
    addCommand(target.entityId, 'media_player', [
      'media_play_pause',
      'media_next_track',
      'media_previous_track',
      'volume_set',
      'play_media',
      'media_stop',
    ]);
  }
  if (globalEntities.sun) subscriptionEntityIds.add(globalEntities.sun);
  if (globalEntities.vacationMode) {
    subscriptionEntityIds.add(globalEntities.vacationMode);
    addCommand(globalEntities.vacationMode, 'switch', ['turn_on', 'turn_off']);
  }
  if (globalEntities.laundry.washer) subscriptionEntityIds.add(globalEntities.laundry.washer);
  if (globalEntities.laundry.dryer) subscriptionEntityIds.add(globalEntities.laundry.dryer);
  if (globalEntities.homeOffScript) addCommand(globalEntities.homeOffScript, 'script', ['turn_on']);
  if (energy) {
    if (energy.sensors.productionPower) subscriptionEntityIds.add(energy.sensors.productionPower);
    for (const source of energy.sensors.consumptionPower) subscriptionEntityIds.add(source.entityId);
    for (const entityId of Object.values(energy.kpis)) {
      if (entityId) subscriptionEntityIds.add(entityId);
    }
  }

  const sortedSubscriptionEntityIds = [...subscriptionEntityIds].sort();
  const commandContracts = [...commands.values()].sort((left, right) => (
    compareText(left.entityId, right.entityId) || compareText(left.domain, right.domain)
  ));

  return {
    schemaVersion: HOUSEHOLD_SCHEMA_VERSION,
    rooms,
    navigation,
    enabledModules,
    energy,
    mediaTargets,
    globalEntities,
    subscriptionEntityIds: sortedSubscriptionEntityIds,
    entityIds: sortedSubscriptionEntityIds,
    commandContracts,
  };
}

export type RuntimeDifferenceCode =
  | 'TYPE_MISMATCH'
  | 'VALUE_MISMATCH'
  | 'MISSING_LEFT'
  | 'MISSING_RIGHT';

export interface RuntimeDifference {
  code: RuntimeDifferenceCode;
  path: string;
  left: unknown;
  right: unknown;
}

export interface RuntimeComparison {
  equal: boolean;
  differences: RuntimeDifference[];
}

function valueKind(value: unknown): 'null' | 'array' | 'object' | 'value' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return 'value';
}

function collectDifferences(
  left: unknown,
  right: unknown,
  path: string,
  differences: RuntimeDifference[],
): void {
  if (Object.is(left, right)) return;
  const leftKind = valueKind(left);
  const rightKind = valueKind(right);
  if (leftKind !== rightKind) {
    differences.push({ code: 'TYPE_MISMATCH', path, left, right });
    return;
  }
  if (leftKind === 'array') {
    const leftArray = left as unknown[];
    const rightArray = right as unknown[];
    const length = Math.max(leftArray.length, rightArray.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= leftArray.length) {
        differences.push({ code: 'MISSING_LEFT', path: `${path}[${index}]`, left: undefined, right: rightArray[index] });
      } else if (index >= rightArray.length) {
        differences.push({ code: 'MISSING_RIGHT', path: `${path}[${index}]`, left: leftArray[index], right: undefined });
      } else {
        collectDifferences(leftArray[index], rightArray[index], `${path}[${index}]`, differences);
      }
    }
    return;
  }
  if (leftKind === 'object') {
    const leftObject = left as JsonObject;
    const rightObject = right as JsonObject;
    const keys = [...new Set([...Object.keys(leftObject), ...Object.keys(rightObject)])].sort();
    for (const key of keys) {
      const childPath = propertyPath(path, key);
      if (!Object.hasOwn(leftObject, key)) {
        differences.push({ code: 'MISSING_LEFT', path: childPath, left: undefined, right: rightObject[key] });
      } else if (!Object.hasOwn(rightObject, key)) {
        differences.push({ code: 'MISSING_RIGHT', path: childPath, left: leftObject[key], right: undefined });
      } else {
        collectDifferences(leftObject[key], rightObject[key], childPath, differences);
      }
    }
    return;
  }
  differences.push({ code: 'VALUE_MISMATCH', path, left, right });
}

/** Structurally compares canonical runtime models and reports stable JSON paths. */
export function compareRuntimeModels(
  left: HouseholdRuntimeModel,
  right: HouseholdRuntimeModel,
): RuntimeComparison {
  const differences: RuntimeDifference[] = [];
  collectDifferences(left, right, '$', differences);
  return { equal: differences.length === 0, differences };
}
