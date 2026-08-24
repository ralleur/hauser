import { HOUSEHOLD_SCHEMA_VERSION } from './household-config-schema.ts';
export { HOUSEHOLD_SCHEMA_VERSION } from './household-config-schema.ts';

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
  | 'switch'
  | 'vacuum'
  | 'other';

export interface VisibleEntityConfig {
  id: string;
  name: string;
  entityId: string;
  role: EntityRole;
}

export interface RoomHeroFocus {
  x: number;
  y: number;
}

export interface RoomHeroConfig {
  assetId: string;
  focus: {
    panel: RoomHeroFocus;
    phone: RoomHeroFocus;
  };
}

export interface RoomConfig {
  id: string;
  name: string;
  visibleEntities: VisibleEntityConfig[];
  hero: RoomHeroConfig | null;
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

export interface LaundryAdapterConfig {
  type: 'entity';
  entityId: string;
  runningStates: string[];
  doneStates: string[];
  /** Explicit enum-style done may be surfaced after a client restart. Binary
   * off-states require an observed running transition to avoid false notices. */
  doneOnInitial: boolean;
  /** Optional HA-side transition marker. Generated adapters bind the owning
   * automation because its restored `last_triggered` distinguishes cycles even
   * when Hauser was closed for the complete running → done transition. */
  cycleMarkerEntityId?: string;
}

export interface GlobalEntitiesConfig {
  sun: string | null;
  vacationMode: string | null;
  homeOffScript: string | null;
  laundry: {
    washer: LaundryAdapterConfig | null;
    dryer: LaundryAdapterConfig | null;
  };
}

export type HotelGuestAction =
  | 'turn_on'
  | 'turn_off'
  | 'set_temperature'
  | 'set_hvac_mode'
  | 'start'
  | 'return_to_base';

export interface HotelTemperatureRange {
  min: number;
  max: number;
}

export interface HotelGuestEntityConfig {
  entityId: string;
  actions: HotelGuestAction[];
  /** Required whenever set_temperature is allowed; guests never get an open range. */
  temperatureRange: HotelTemperatureRange | null;
}

export interface HotelGuestRoomConfig {
  roomId: string;
  entities: HotelGuestEntityConfig[];
}

export interface HotelCalendarConfig {
  entityId: string;
  timeZone: string;
  /** Local wall-clock "HH:MM" applied to all-day calendar events. */
  allDayCheckIn: string;
  allDayCheckOut: string;
  useDescriptionAsWelcome: boolean;
}

export interface HotelGuestAccessConfig {
  rooms: HotelGuestRoomConfig[];
  scenes: string[];
  scripts: string[];
}

export interface HotelCheckoutConfig {
  enabled: boolean;
  sceneEntityId: string | null;
}

export interface HotelModeConfig {
  enabled: boolean;
  calendar: HotelCalendarConfig;
  guestAccess: HotelGuestAccessConfig;
  checkout: HotelCheckoutConfig;
  adminIdleTimeoutMinutes: number;
  kioskAcknowledged: boolean;
}

export interface HouseholdConfigV4 {
  schemaVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
  rooms: RoomConfig[];
  navigation: NavigationItemConfig[];
  enabledModules: ModuleId[];
  energy: EnergyConfig | null;
  mediaTargets: MediaTargetConfig[];
  globalEntities: GlobalEntitiesConfig;
  /** Absent on every installation that never opted into hotel mode. */
  hotelMode?: HotelModeConfig;
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
  | { ok: true; value: HouseholdConfigV4 }
  | { ok: false; issues: ConfigIssue[] };

const LOCAL_ID = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const ROOM_HERO_ASSET_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
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
  'switch',
  'vacuum',
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
  switch: 'switch',
  vacuum: 'vacuum',
};
const HOTEL_TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Guest actions are limited to what Hauser's existing room controls really send. */
export const HOTEL_GUEST_ROLE_ACTIONS: Partial<Record<EntityRole, readonly HotelGuestAction[]>> = {
  light: ['turn_on', 'turn_off'],
  climate: ['set_temperature', 'set_hvac_mode'],
  switch: ['turn_on', 'turn_off'],
  vacuum: ['start', 'return_to_base'],
};
export const HOTEL_HVAC_MODES: readonly ['heat', 'cool', 'off'] = ['heat', 'cool', 'off'];
const HOTEL_ADMIN_IDLE_MIN_MINUTES = 1;
const HOTEL_ADMIN_IDLE_MAX_MINUTES = 120;

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

  roomHeroAssetId(value: unknown | Missing, path: string): string {
    if (value === MISSING) return '';
    if (typeof value !== 'string') {
      this.issue('TYPE_MISMATCH', path, 'Expected a room hero asset ID string.');
      return '';
    }
    if (!ROOM_HERO_ASSET_ID.test(value)) {
      this.issue(
        'INVALID_ID',
        path,
        'Room hero asset ID must be 1-128 lower-case letters, digits, underscores or hyphens.',
      );
    }
    return value;
  }

  unitNumber(value: unknown | Missing, path: string): number {
    if (value === MISSING) return 0;
    if (typeof value !== 'number') {
      this.issue('TYPE_MISMATCH', path, 'Expected a number.');
      return 0;
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      this.issue('INVALID_VALUE', path, 'Expected a finite number between 0 and 1.');
      return 0;
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

  /** Entity references point at entities declared elsewhere, so they never
   * participate in the single-declaration duplicate inventory. */
  entityIdRef(value: unknown | Missing, path: string, expectedDomains?: EntityDomainConstraint): string {
    if (value === MISSING) return '';
    if (typeof value !== 'string') {
      this.issue('TYPE_MISMATCH', path, 'Expected a Home Assistant entity ID string.');
      return '';
    }
    if (!HA_ENTITY_ID.test(value)) {
      this.issue('INVALID_ENTITY_ID', path, 'Expected a lower-case Home Assistant entity ID in domain.object form.');
      return value;
    }
    const allowedDomains = typeof expectedDomains === 'string' ? [expectedDomains] : expectedDomains;
    const actualDomain = value.slice(0, value.indexOf('.'));
    if (allowedDomains !== undefined && !allowedDomains.includes(actualDomain)) {
      this.issue('INVALID_ENTITY_ID', path, `Expected a Home Assistant ${allowedDomains.join(' or ')} entity ID.`);
    }
    return value;
  }

  boolean(value: unknown | Missing, path: string): boolean {
    if (value === MISSING) return false;
    if (typeof value !== 'boolean') {
      this.issue('TYPE_MISMATCH', path, 'Expected a boolean.');
      return false;
    }
    return value;
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

function parseRoomHeroFocus(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): RoomHeroFocus {
  if (value === MISSING) return { x: 0, y: 0 };
  const object = validator.object(value, path);
  if (!object) return { x: 0, y: 0 };
  validator.exactKeys(object, ['x', 'y'], path);
  return {
    x: validator.unitNumber(validator.required(object, 'x', path), `${path}.x`),
    y: validator.unitNumber(validator.required(object, 'y', path), `${path}.y`),
  };
}

function parseRoomHero(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): RoomHeroConfig | null {
  if (value === MISSING || value === null) return null;
  const object = validator.object(value, path);
  if (!object) return null;
  validator.exactKeys(object, ['assetId', 'focus'], path);

  const focusValue = validator.required(object, 'focus', path);
  const focus = focusValue === MISSING ? undefined : validator.object(focusValue, `${path}.focus`);
  if (focus) validator.exactKeys(focus, ['panel', 'phone'], `${path}.focus`);
  return {
    assetId: validator.roomHeroAssetId(
      validator.required(object, 'assetId', path),
      `${path}.assetId`,
    ),
    focus: {
      panel: parseRoomHeroFocus(
        validator,
        focus ? validator.required(focus, 'panel', `${path}.focus`) : MISSING,
        `${path}.focus.panel`,
      ),
      phone: parseRoomHeroFocus(
        validator,
        focus ? validator.required(focus, 'phone', `${path}.focus`) : MISSING,
        `${path}.focus.phone`,
      ),
    },
  };
}

function parseRoom(validator: ConfigValidator, value: unknown, path: string): RoomConfig {
  const object = validator.object(value, path);
  if (!object) return { id: '', name: '', visibleEntities: [], hero: null };
  validator.exactKeys(object, ['id', 'name', 'visibleEntities', 'hero'], path);

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
  const hero = parseRoomHero(
    validator,
    validator.required(object, 'hero', path),
    `${path}.hero`,
  );

  return { id, name, visibleEntities, hero };
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

function parseLaundryStates(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): string[] {
  if (value === MISSING) return [];
  const items = validator.array(value, path) ?? [];
  const states: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== 'string') {
      validator.issue('TYPE_MISMATCH', itemPath, 'Expected a Home Assistant state string.');
      continue;
    }
    const state = item.trim().toLowerCase();
    if (!state || state.length > 128) {
      validator.issue('INVALID_VALUE', itemPath, 'State must contain 1 to 128 characters.');
    } else if (seen.has(state)) {
      validator.issue('INVALID_VALUE', itemPath, `Duplicate state "${state}".`);
    } else {
      seen.add(state);
      states.push(state);
    }
  }
  if (items.length === 0) validator.issue('INVALID_VALUE', path, 'At least one state is required.');
  return states;
}

function parseLaundryAdapter(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): LaundryAdapterConfig | null {
  if (value === MISSING || value === null) return null;
  const object = validator.object(value, path);
  if (!object) return null;
  validator.exactKeys(object, [
    'type', 'entityId', 'runningStates', 'doneStates', 'doneOnInitial', 'cycleMarkerEntityId',
  ], path);
  const type = validator.required(object, 'type', path);
  if (type !== MISSING && type !== 'entity') {
    validator.issue('INVALID_VALUE', `${path}.type`, 'Laundry adapter type must be "entity".');
  }
  const entityId = validator.entityId(
    validator.required(object, 'entityId', path),
    `${path}.entityId`,
    ['input_boolean', 'binary_sensor', 'sensor', 'input_select', 'select'],
  );
  const runningStates = parseLaundryStates(
    validator,
    validator.required(object, 'runningStates', path),
    `${path}.runningStates`,
  );
  const doneStates = parseLaundryStates(
    validator,
    validator.required(object, 'doneStates', path),
    `${path}.doneStates`,
  );
  const running = new Set(runningStates);
  for (const [index, state] of doneStates.entries()) {
    if (running.has(state)) {
      validator.issue('INVALID_VALUE', `${path}.doneStates[${index}]`, 'Running and done states must not overlap.');
    }
  }
  const cycleMarkerEntityId = Object.hasOwn(object, 'cycleMarkerEntityId')
    ? validator.entityId(object.cycleMarkerEntityId, `${path}.cycleMarkerEntityId`, 'automation')
    : undefined;
  return {
    type: 'entity',
    entityId,
    runningStates,
    doneStates,
    doneOnInitial: validator.boolean(
      validator.required(object, 'doneOnInitial', path),
      `${path}.doneOnInitial`,
    ),
    ...(cycleMarkerEntityId === undefined ? {} : { cycleMarkerEntityId }),
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
  let washer: LaundryAdapterConfig | null = null;
  let dryer: LaundryAdapterConfig | null = null;
  if (laundry) {
    validator.exactKeys(laundry, ['washer', 'dryer'], `${path}.laundry`);
    washer = parseLaundryAdapter(
      validator,
      validator.required(laundry, 'washer', `${path}.laundry`),
      `${path}.laundry.washer`,
    );
    dryer = parseLaundryAdapter(
      validator,
      validator.required(laundry, 'dryer', `${path}.laundry`),
      `${path}.laundry.dryer`,
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

type RoomEntityRoles = ReadonlyMap<string, ReadonlyMap<string, EntityRole>>;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseHotelCalendar(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): HotelCalendarConfig {
  const fallback: HotelCalendarConfig = {
    entityId: '',
    timeZone: '',
    allDayCheckIn: '',
    allDayCheckOut: '',
    useDescriptionAsWelcome: false,
  };
  if (value === MISSING) return fallback;
  const object = validator.object(value, path);
  if (!object) return fallback;
  validator.exactKeys(
    object,
    ['entityId', 'timeZone', 'allDayCheckIn', 'allDayCheckOut', 'useDescriptionAsWelcome'],
    path,
  );

  const timeZoneValue = validator.required(object, 'timeZone', path);
  let timeZone = '';
  if (timeZoneValue !== MISSING) {
    if (typeof timeZoneValue !== 'string') {
      validator.issue('TYPE_MISMATCH', `${path}.timeZone`, 'Expected an IANA time zone string.');
    } else if (!isValidTimeZone(timeZoneValue)) {
      validator.issue('INVALID_VALUE', `${path}.timeZone`, `Unknown IANA time zone "${timeZoneValue}".`);
    } else {
      timeZone = timeZoneValue;
    }
  }

  const timeOfDay = (key: 'allDayCheckIn' | 'allDayCheckOut'): string => {
    const raw = validator.required(object, key, path);
    if (raw === MISSING) return '';
    if (typeof raw !== 'string') {
      validator.issue('TYPE_MISMATCH', `${path}.${key}`, 'Expected a "HH:MM" time string.');
      return '';
    }
    if (!HOTEL_TIME_OF_DAY.test(raw)) {
      validator.issue('INVALID_VALUE', `${path}.${key}`, 'Expected a 24-hour "HH:MM" time string.');
      return '';
    }
    return raw;
  };

  return {
    entityId: validator.entityIdRef(
      validator.required(object, 'entityId', path),
      `${path}.entityId`,
      'calendar',
    ),
    timeZone,
    allDayCheckIn: timeOfDay('allDayCheckIn'),
    allDayCheckOut: timeOfDay('allDayCheckOut'),
    useDescriptionAsWelcome: validator.boolean(
      validator.required(object, 'useDescriptionAsWelcome', path),
      `${path}.useDescriptionAsWelcome`,
    ),
  };
}

function parseHotelTemperatureRange(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): HotelTemperatureRange | null {
  if (value === MISSING || value === null) return null;
  const object = validator.object(value, path);
  if (!object) return null;
  validator.exactKeys(object, ['min', 'max'], path);
  const bound = (key: 'min' | 'max'): number => {
    const raw = validator.required(object, key, path);
    if (raw === MISSING) return Number.NaN;
    if (typeof raw !== 'number') {
      validator.issue('TYPE_MISMATCH', `${path}.${key}`, 'Expected a number.');
      return Number.NaN;
    }
    if (!Number.isFinite(raw)) {
      validator.issue('INVALID_VALUE', `${path}.${key}`, 'Expected a finite number.');
      return Number.NaN;
    }
    return raw;
  };
  const min = bound('min');
  const max = bound('max');
  if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
    validator.issue('INVALID_VALUE', `${path}.min`, 'The allowed range minimum must be lower than its maximum.');
  }
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}

function parseHotelGuestEntity(
  validator: ConfigValidator,
  value: unknown,
  path: string,
  role: EntityRole | undefined,
): HotelGuestEntityConfig {
  const object = validator.object(value, path);
  if (!object) return { entityId: '', actions: [], temperatureRange: null };
  validator.exactKeys(object, ['entityId', 'actions', 'temperatureRange'], path);

  const entityId = validator.entityIdRef(validator.required(object, 'entityId', path), `${path}.entityId`);
  const supported = role === undefined ? undefined : HOTEL_GUEST_ROLE_ACTIONS[role];
  if (role !== undefined && supported === undefined) {
    validator.issue(
      'INVALID_VALUE',
      `${path}.entityId`,
      `Entity role "${role}" has no guest-controllable actions in Hauser.`,
    );
  }

  const actionsValue = validator.required(object, 'actions', path);
  const actionItems = actionsValue === MISSING ? undefined : validator.array(actionsValue, `${path}.actions`);
  const actions: HotelGuestAction[] = [];
  const seenActions = new Set<string>();
  for (const [index, item] of (actionItems ?? []).entries()) {
    const itemPath = `${path}.actions[${index}]`;
    if (typeof item !== 'string') {
      validator.issue('TYPE_MISMATCH', itemPath, 'Expected a guest action string.');
      continue;
    }
    if (seenActions.has(item)) {
      validator.issue('INVALID_VALUE', itemPath, `Duplicate guest action "${item}".`);
      continue;
    }
    seenActions.add(item);
    if (supported === undefined || !supported.includes(item as HotelGuestAction)) {
      validator.issue('INVALID_VALUE', itemPath, `Guest action "${item}" is not supported by this control.`);
      continue;
    }
    actions.push(item as HotelGuestAction);
  }
  if (actionItems !== undefined && actionItems.length === 0) {
    validator.issue('INVALID_VALUE', `${path}.actions`, 'At least one guest action is required.');
  }

  const temperatureRange = parseHotelTemperatureRange(
    validator,
    validator.required(object, 'temperatureRange', path),
    `${path}.temperatureRange`,
  );
  if (actions.includes('set_temperature') && temperatureRange === null) {
    validator.issue(
      'INVALID_VALUE',
      `${path}.temperatureRange`,
      'A temperature range is required whenever guests may set a temperature.',
    );
  }
  if (!actions.includes('set_temperature') && temperatureRange !== null) {
    validator.issue(
      'INVALID_VALUE',
      `${path}.temperatureRange`,
      'A temperature range is only allowed together with the set_temperature action.',
    );
  }
  return { entityId, actions, temperatureRange };
}

function parseHotelGuestRoom(
  validator: ConfigValidator,
  value: unknown,
  path: string,
  roomEntityRoles: RoomEntityRoles,
): HotelGuestRoomConfig {
  const object = validator.object(value, path);
  if (!object) return { roomId: '', entities: [] };
  validator.exactKeys(object, ['roomId', 'entities'], path);

  const roomId = validator.localId(validator.required(object, 'roomId', path), `${path}.roomId`);
  const roomEntities = roomEntityRoles.get(roomId);
  if (LOCAL_ID.test(roomId) && roomEntities === undefined) {
    validator.issue('UNKNOWN_REFERENCE', `${path}.roomId`, `Guest room "${roomId}" does not exist.`);
  }

  const entitiesValue = validator.required(object, 'entities', path);
  const entityItems = entitiesValue === MISSING ? undefined : validator.array(entitiesValue, `${path}.entities`);
  const entities: HotelGuestEntityConfig[] = [];
  const seenEntityIds = new Map<string, string>();
  for (const [index, item] of (entityItems ?? []).entries()) {
    const itemPath = `${path}.entities[${index}]`;
    const declaredEntityId = typeof item === 'object' && item !== null && !Array.isArray(item)
      ? (item as JsonObject).entityId
      : undefined;
    const role = typeof declaredEntityId === 'string' ? roomEntities?.get(declaredEntityId) : undefined;
    const entity = parseHotelGuestEntity(validator, item, itemPath, role);
    if (roomEntities !== undefined && entity.entityId !== '' && role === undefined) {
      validator.issue(
        'UNKNOWN_REFERENCE',
        `${itemPath}.entityId`,
        `Entity "${entity.entityId}" is not a visible entity of room "${roomId}".`,
      );
    }
    const firstPath = seenEntityIds.get(entity.entityId);
    if (entity.entityId !== '' && firstPath !== undefined) {
      validator.issue(
        'DUPLICATE_ENTITY_ID',
        `${itemPath}.entityId`,
        `Entity ID "${entity.entityId}" is already released at ${firstPath}.`,
      );
    } else if (entity.entityId !== '') {
      seenEntityIds.set(entity.entityId, `${itemPath}.entityId`);
    }
    entities.push(entity);
  }
  return { roomId, entities };
}

function parseHotelEntityList(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
  domain: string,
): string[] {
  if (value === MISSING) return [];
  const items = validator.array(value, path) ?? [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}[${index}]`;
    const entityId = validator.entityIdRef(item, itemPath, domain);
    if (entityId === '') continue;
    if (seen.has(entityId)) {
      validator.issue('DUPLICATE_ENTITY_ID', itemPath, `Entity ID "${entityId}" is already released at ${path}.`);
      continue;
    }
    seen.add(entityId);
    result.push(entityId);
  }
  return result;
}

function parseHotelGuestAccess(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
  roomEntityRoles: RoomEntityRoles,
): HotelGuestAccessConfig {
  if (value === MISSING) return { rooms: [], scenes: [], scripts: [] };
  const object = validator.object(value, path);
  if (!object) return { rooms: [], scenes: [], scripts: [] };
  validator.exactKeys(object, ['rooms', 'scenes', 'scripts'], path);

  const roomsValue = validator.required(object, 'rooms', path);
  const roomItems = roomsValue === MISSING ? undefined : validator.array(roomsValue, `${path}.rooms`);
  const rooms = (roomItems ?? []).map((room, index) =>
    parseHotelGuestRoom(validator, room, `${path}.rooms[${index}]`, roomEntityRoles));
  duplicateIds(validator, rooms.map((room, index) => ({
    id: room.roomId,
    path: `${path}.rooms[${index}].roomId`,
  })));

  return {
    rooms,
    scenes: parseHotelEntityList(
      validator,
      validator.required(object, 'scenes', path),
      `${path}.scenes`,
      'scene',
    ),
    scripts: parseHotelEntityList(
      validator,
      validator.required(object, 'scripts', path),
      `${path}.scripts`,
      'script',
    ),
  };
}

function parseHotelCheckout(
  validator: ConfigValidator,
  value: unknown | Missing,
  path: string,
): HotelCheckoutConfig {
  if (value === MISSING) return { enabled: false, sceneEntityId: null };
  const object = validator.object(value, path);
  if (!object) return { enabled: false, sceneEntityId: null };
  validator.exactKeys(object, ['enabled', 'sceneEntityId'], path);
  const sceneValue = validator.required(object, 'sceneEntityId', path);
  return {
    enabled: validator.boolean(validator.required(object, 'enabled', path), `${path}.enabled`),
    sceneEntityId: sceneValue === MISSING || sceneValue === null
      ? null
      : validator.entityIdRef(sceneValue, `${path}.sceneEntityId`, 'scene'),
  };
}

function parseHotelMode(
  validator: ConfigValidator,
  value: unknown,
  path: string,
  roomEntityRoles: RoomEntityRoles,
): HotelModeConfig | undefined {
  const object = validator.object(value, path);
  if (!object) return undefined;
  validator.exactKeys(
    object,
    ['enabled', 'calendar', 'guestAccess', 'checkout', 'adminIdleTimeoutMinutes', 'kioskAcknowledged'],
    path,
  );

  const idleValue = validator.required(object, 'adminIdleTimeoutMinutes', path);
  let adminIdleTimeoutMinutes = 15;
  if (idleValue !== MISSING) {
    if (typeof idleValue !== 'number') {
      validator.issue('TYPE_MISMATCH', `${path}.adminIdleTimeoutMinutes`, 'Expected a number.');
    } else if (
      !Number.isSafeInteger(idleValue)
      || idleValue < HOTEL_ADMIN_IDLE_MIN_MINUTES
      || idleValue > HOTEL_ADMIN_IDLE_MAX_MINUTES
    ) {
      validator.issue(
        'INVALID_VALUE',
        `${path}.adminIdleTimeoutMinutes`,
        `The admin idle timeout must be an integer between ${HOTEL_ADMIN_IDLE_MIN_MINUTES} and ${HOTEL_ADMIN_IDLE_MAX_MINUTES} minutes.`,
      );
    } else {
      adminIdleTimeoutMinutes = idleValue;
    }
  }

  const enabled = validator.boolean(validator.required(object, 'enabled', path), `${path}.enabled`);
  const kioskAcknowledged = validator.boolean(
    validator.required(object, 'kioskAcknowledged', path),
    `${path}.kioskAcknowledged`,
  );
  if (enabled && !kioskAcknowledged) {
    validator.issue(
      'INCONSISTENT_MODULE',
      `${path}.kioskAcknowledged`,
      'Hotel mode must not be enabled before the kiosk checklist is confirmed.',
    );
  }

  return {
    enabled,
    calendar: parseHotelCalendar(validator, validator.required(object, 'calendar', path), `${path}.calendar`),
    guestAccess: parseHotelGuestAccess(
      validator,
      validator.required(object, 'guestAccess', path),
      `${path}.guestAccess`,
      roomEntityRoles,
    ),
    checkout: parseHotelCheckout(validator, validator.required(object, 'checkout', path), `${path}.checkout`),
    adminIdleTimeoutMinutes,
    kioskAcknowledged,
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
    [
      'schemaVersion', 'rooms', 'navigation', 'enabledModules', 'energy', 'mediaTargets',
      'globalEntities', 'hotelMode',
    ],
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

  const roomEntityRoles = new Map<string, Map<string, EntityRole>>();
  for (const room of rooms) {
    const entityRoles = new Map<string, EntityRole>();
    for (const entity of room.visibleEntities) entityRoles.set(entity.entityId, entity.role);
    roomEntityRoles.set(room.id, entityRoles);
  }
  const hotelMode = Object.hasOwn(root, 'hotelMode')
    ? parseHotelMode(validator, root.hotelMode, '$.hotelMode', roomEntityRoles)
    : undefined;

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
      ...(hotelMode === undefined ? {} : { hotelMode }),
    },
  };
}

export interface CommandContract {
  entityId: string;
  domain: 'light' | 'climate' | 'media_player' | 'switch' | 'script' | 'vacuum';
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

export { compileHouseholdConfig } from './household-config-compiler.ts';

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
