import {
  HOUSEHOLD_SCHEMA_VERSION,
  parseHouseholdConfig,
  type ConfigIssue,
} from './household-config.ts';

type JsonObject = Record<string, unknown>;

export type HouseholdConfigMigrationResult =
  | {
      ok: true;
      status: 'current';
      document: JsonObject;
      version: typeof HOUSEHOLD_SCHEMA_VERSION;
    }
  | {
      ok: true;
      status: 'migrated';
      document: JsonObject;
      fromVersion: number;
      toVersion: typeof HOUSEHOLD_SCHEMA_VERSION;
    }
  | {
      ok: false;
      code:
        | 'HOUSEHOLD_CONFIG_VERSION_INVALID'
        | 'HOUSEHOLD_CONFIG_VERSION_UNSUPPORTED'
        | 'HOUSEHOLD_CONFIG_VERSION_TOO_NEW'
        | 'HOUSEHOLD_CONFIG_INVALID'
        | 'HOUSEHOLD_CONFIG_MIGRATION_INVALID';
      message: string;
      issue?: ConfigIssue;
    };

function typedLaundryAdapter(entityId: string): JsonObject {
  return {
    type: 'entity',
    entityId,
    runningStates: ['on'],
    doneStates: ['off'],
    doneOnInitial: false,
  };
}

function migrateLaundryBindings(document: JsonObject): { document: JsonObject; changed: boolean } {
  const globalEntities = document.globalEntities;
  if (typeof globalEntities !== 'object' || globalEntities === null || Array.isArray(globalEntities)) {
    return { document, changed: false };
  }
  const laundry = (globalEntities as JsonObject).laundry;
  if (typeof laundry !== 'object' || laundry === null || Array.isArray(laundry)) {
    return { document, changed: false };
  }
  const laundryObject = laundry as JsonObject;
  let changed = false;
  const migratedLaundry: JsonObject = { ...laundryObject };
  for (const device of ['washer', 'dryer']) {
    const binding = laundryObject[device];
    if (typeof binding === 'string') {
      migratedLaundry[device] = typedLaundryAdapter(binding);
      changed = true;
    }
  }
  if (!changed) return { document, changed: false };
  return {
    changed: true,
    document: {
      ...document,
      globalEntities: {
        ...(globalEntities as JsonObject),
        laundry: migratedLaundry,
      },
    },
  };
}

function invalidMigration(issue: ConfigIssue): HouseholdConfigMigrationResult {
  return {
    ok: false,
    code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID',
    message: 'The household config cannot be migrated because its legacy data is invalid.',
    issue,
  };
}

function invalidCurrent(issue: ConfigIssue): HouseholdConfigMigrationResult {
  return {
    ok: false,
    code: 'HOUSEHOLD_CONFIG_INVALID',
    message: 'The current household config is invalid.',
    issue,
  };
}

function validateCurrent(document: JsonObject): HouseholdConfigMigrationResult | null {
  const parsed = parseHouseholdConfig(document);
  return parsed.ok ? null : invalidMigration(parsed.issues[0]);
}

function migrateV1ToV2(document: JsonObject): JsonObject {
  return { ...document, schemaVersion: 2 };
}

function migrateV2ToV3(document: JsonObject): JsonObject | HouseholdConfigMigrationResult {
  const rooms = document.rooms;
  if (!Array.isArray(rooms)) {
    const candidate = { ...document, schemaVersion: 3 };
    return candidate;
  }

  for (let index = 0; index < rooms.length; index += 1) {
    const room = rooms[index];
    if (typeof room === 'object' && room !== null && !Array.isArray(room) && Object.hasOwn(room, 'hero')) {
      return invalidMigration({
        code: 'UNKNOWN_FIELD',
        path: `$.rooms[${index}].hero`,
        message: 'Legacy household rooms must not contain the v3 hero field.',
      });
    }
  }

  return {
    ...document,
    schemaVersion: 3,
    rooms: rooms.map((room) => (
      typeof room === 'object' && room !== null && !Array.isArray(room)
        ? { ...room, hero: null }
        : room
    )),
  };
}

/** Hotel mode is opt-in, so v4 stays behaviourally identical to a v3 install. */
function migrateV3ToV4(document: JsonObject): JsonObject {
  return { ...document, schemaVersion: HOUSEHOLD_SCHEMA_VERSION };
}

function isGeneratedSetupNavigationItem(
  value: unknown,
  id: 'home' | 'system',
  order: number,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as JsonObject;
  const target = item.target;
  return item.id === id
    && item.name === (id === 'home' ? 'Home' : 'System')
    && item.order === order
    && typeof target === 'object'
    && target !== null
    && !Array.isArray(target)
    && (target as JsonObject).type === 'module'
    && (target as JsonObject).id === id;
}

/** Adds the screens that beta onboarding omitted, without touching custom nav. */
function migrateGeneratedSetupNavigation(document: JsonObject): { document: JsonObject; changed: boolean } {
  const navigation = document.navigation;
  const enabledModules = document.enabledModules;
  if (!Array.isArray(navigation) || !Array.isArray(enabledModules)) return { document, changed: false };
  if (navigation.length !== 2
    || !isGeneratedSetupNavigationItem(navigation[0], 'home', 0)
    || !isGeneratedSetupNavigationItem(navigation[1], 'system', 1)) {
    return { document, changed: false };
  }

  const enabled = new Set(enabledModules);
  const hasMedia = enabled.has('media');
  const expected = hasMedia ? new Set(['home', 'media', 'system']) : new Set(['home', 'system']);
  if (enabled.size !== expected.size || [...enabled].some((id) => !expected.has(String(id)))) {
    return { document, changed: false };
  }

  return {
    changed: true,
    document: {
      ...document,
      navigation: [
        navigation[0],
        { id: 'calendar', name: 'Calendar', order: 1, target: { type: 'module', id: 'calendar' } },
        { id: 'notes', name: 'Notes', order: 2, target: { type: 'module', id: 'notes' } },
        ...(hasMedia
          ? [{ id: 'media', name: 'Media', order: 3, target: { type: 'module', id: 'media' } }]
          : []),
        { ...(navigation[1] as JsonObject), order: hasMedia ? 4 : 3 },
      ],
      enabledModules: hasMedia
        ? ['home', 'calendar', 'notes', 'media', 'system']
        : ['home', 'calendar', 'notes', 'system'],
    },
  };
}

function isMigrationFailure(
  value: JsonObject | HouseholdConfigMigrationResult,
): value is Extract<HouseholdConfigMigrationResult, { ok: false }> {
  return Object.hasOwn(value, 'ok') && value.ok === false;
}

/** Pure, deterministic and non-mutating schema and beta-onboarding migration boundary. */
export function migrateHouseholdConfigDocument(input: unknown): HouseholdConfigMigrationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_VERSION_INVALID',
      message: 'Household config must be an object with a numeric schemaVersion.',
    };
  }

  const document = input as JsonObject;
  const version = document.schemaVersion;
  if (!Number.isSafeInteger(version)) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_VERSION_INVALID',
      message: 'Household config schemaVersion must be a safe integer.',
    };
  }
  if ((version as number) > HOUSEHOLD_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_VERSION_TOO_NEW',
      message: `Household config schema version ${version} is newer than supported version ${HOUSEHOLD_SCHEMA_VERSION}.`,
    };
  }
  if (version === HOUSEHOLD_SCHEMA_VERSION) {
    const parsed = parseHouseholdConfig(document);
    if (!parsed.ok) return invalidCurrent(parsed.issues[0]);
    const setupNavigation = migrateGeneratedSetupNavigation(document);
    if (!setupNavigation.changed) return {
      ok: true,
      status: 'current',
      document,
      version: HOUSEHOLD_SCHEMA_VERSION,
    };
    const invalid = validateCurrent(setupNavigation.document);
    if (invalid) return invalid;
    return {
      ok: true,
      status: 'migrated',
      document: setupNavigation.document,
      fromVersion: HOUSEHOLD_SCHEMA_VERSION,
      toVersion: HOUSEHOLD_SCHEMA_VERSION,
    };
  }
  if (version !== 1 && version !== 2 && version !== 3) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_VERSION_UNSUPPORTED',
      message: `No migration path exists from household schema version ${version}.`,
    };
  }

  const fromVersion = version;
  let v3: JsonObject;
  if (version === 3) {
    v3 = document;
  } else {
    const v2 = version === 1 ? migrateV1ToV2(document) : document;
    const typedV2 = migrateLaundryBindings(v2).document;
    const stepped = migrateV2ToV3(typedV2);
    if (isMigrationFailure(stepped)) return stepped;
    v3 = stepped;
  }
  const migrated = migrateGeneratedSetupNavigation(migrateV3ToV4(v3)).document;
  const invalid = validateCurrent(migrated);
  if (invalid) return invalid;

  return {
    ok: true,
    status: 'migrated',
    document: migrated,
    fromVersion,
    toVersion: HOUSEHOLD_SCHEMA_VERSION,
  };
}
