import { describe, expect, it } from 'vitest';
import neutralSmall from '../../../config/examples/neutral-small.json';
import {
  migrateHouseholdConfigDocument,
  type HouseholdConfigMigrationResult,
} from './household-config-migration.ts';

function expectMigrated(result: HouseholdConfigMigrationResult) {
  expect(result.ok).toBe(true);
  if (!result.ok || result.status !== 'migrated') throw new Error('Expected migrated config');
  return result;
}

function legacyFixture(version: 1 | 2 | 3): Record<string, any> {
  const source = structuredClone(neutralSmall) as Record<string, any>;
  source.schemaVersion = version;
  if (version !== 3) for (const room of source.rooms) delete room.hero;
  return source;
}

const typedWasher = {
  type: 'entity',
  entityId: 'sensor.fixture_washer_status',
  runningStates: ['running'],
  doneStates: ['done'],
  doneOnInitial: true,
  cycleMarkerEntityId: 'automation.fixture_washer_cycle',
};

const typedDryer = {
  type: 'entity',
  entityId: 'binary_sensor.fixture_dryer_running',
  runningStates: ['on'],
  doneStates: ['off'],
  doneOnInitial: false,
};

describe('household config document migration', () => {
  it.each([1, 2] as const)('migrates deployed scalar v%s data to typed Laundry plus Hero v4 without mutation', (version) => {
    const source = legacyFixture(version);
    const before = JSON.stringify(source);

    const result = expectMigrated(migrateHouseholdConfigDocument(source));

    expect(result.fromVersion).toBe(version);
    expect(result.toVersion).toBe(4);
    expect(result.document).toMatchObject({
      schemaVersion: 4,
      rooms: (source.rooms as Array<Record<string, unknown>>).map((room) => ({ ...room, hero: null })),
      globalEntities: {
        laundry: {
          washer: {
            type: 'entity',
            entityId: 'input_boolean.washer_running',
            runningStates: ['on'],
            doneStates: ['off'],
            doneOnInitial: false,
          },
          dryer: {
            type: 'entity',
            entityId: 'input_boolean.dryer_running',
            runningStates: ['on'],
            doneStates: ['off'],
            doneOnInitial: false,
          },
        },
      },
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('adds only hero null on the way to v4 and preserves rich typed Laundry data exactly', () => {
    const source = legacyFixture(2);
    source.globalEntities.laundry = {
      washer: structuredClone(typedWasher),
      dryer: structuredClone(typedDryer),
    };
    const before = JSON.stringify(source);

    const result = expectMigrated(migrateHouseholdConfigDocument(source));

    expect(result.document).toEqual({
      ...source,
      schemaVersion: 4,
      rooms: source.rooms.map((room: Record<string, unknown>) => ({ ...room, hero: null })),
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('lifts a v3 document to v4 without touching anything else', () => {
    const source = legacyFixture(3);
    const before = JSON.stringify(source);

    const result = expectMigrated(migrateHouseholdConfigDocument(source));

    expect(result.fromVersion).toBe(3);
    expect(result.document).toEqual({ ...source, schemaVersion: 4 });
    expect(Object.hasOwn(result.document, 'hotelMode')).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects an invalid current v4 document without reporting a migration failure', () => {
    const source = structuredClone(neutralSmall) as Record<string, any>;
    source.globalEntities.laundry.washer = 'input_boolean.washer_running';

    expect(migrateHouseholdConfigDocument(source)).toMatchObject({
      ok: false,
      code: 'HOUSEHOLD_CONFIG_INVALID',
      issue: {
        code: 'TYPE_MISMATCH',
        path: '$.globalEntities.laundry.washer',
      },
    });
  });

  it('is deterministic and idempotent for the current contract', () => {
    const source = legacyFixture(1);
    const first = expectMigrated(migrateHouseholdConfigDocument(source));
    const second = migrateHouseholdConfigDocument(first.document);

    expect(expectMigrated(migrateHouseholdConfigDocument(source)).document).toEqual(first.document);
    expect(second).toEqual({ ok: true, status: 'current', document: first.document, version: 4 });
  });

  it.each([
    [{ ...neutralSmall, schemaVersion: 5 }, 'HOUSEHOLD_CONFIG_VERSION_TOO_NEW'],
    [{ ...neutralSmall, schemaVersion: 0 }, 'HOUSEHOLD_CONFIG_VERSION_UNSUPPORTED'],
    [{ ...neutralSmall, schemaVersion: '1' }, 'HOUSEHOLD_CONFIG_VERSION_INVALID'],
    [Object.fromEntries(Object.entries(neutralSmall).filter(([key]) => key !== 'schemaVersion')), 'HOUSEHOLD_CONFIG_VERSION_INVALID'],
    [null, 'HOUSEHOLD_CONFIG_VERSION_INVALID'],
  ])('fails closed for unsupported or malformed versions', (source, code) => {
    expect(migrateHouseholdConfigDocument(source)).toMatchObject({ ok: false, code });
  });
});
