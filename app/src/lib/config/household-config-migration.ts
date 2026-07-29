import { HOUSEHOLD_SCHEMA_VERSION } from './household-config.ts';

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
        | 'HOUSEHOLD_CONFIG_VERSION_TOO_NEW';
      message: string;
    };

/**
 * Pure, deterministic migration boundary. The deployed v1 and current v2
 * contracts have identical fields; v2 introduces the supported migration
 * lifecycle itself. The version-only step deliberately exercises backup,
 * validation, atomic replacement and rollback before the public beta.
 */
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
    return { ok: true, status: 'current', document, version: HOUSEHOLD_SCHEMA_VERSION };
  }
  if (version !== 1) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_VERSION_UNSUPPORTED',
      message: `No migration path exists from household schema version ${version}.`,
    };
  }

  return {
    ok: true,
    status: 'migrated',
    document: { ...document, schemaVersion: HOUSEHOLD_SCHEMA_VERSION },
    fromVersion: 1,
    toVersion: HOUSEHOLD_SCHEMA_VERSION,
  };
}
