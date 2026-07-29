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

describe('household config document migration', () => {
  it('migrates the deployed v1 contract to v2 without mutating the source', () => {
    const source = structuredClone(neutralSmall) as Record<string, unknown>;
    source.schemaVersion = 1;
    const before = JSON.stringify(source);

    const result = expectMigrated(migrateHouseholdConfigDocument(source));

    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);
    expect(result.document).toEqual({ ...source, schemaVersion: 2 });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('is deterministic and idempotent for the current contract', () => {
    const source = structuredClone(neutralSmall) as Record<string, unknown>;
    source.schemaVersion = 1;
    const first = expectMigrated(migrateHouseholdConfigDocument(source));
    const second = migrateHouseholdConfigDocument(first.document);

    expect(expectMigrated(migrateHouseholdConfigDocument(source)).document).toEqual(first.document);
    expect(second).toEqual({ ok: true, status: 'current', document: first.document, version: 2 });
  });

  it.each([
    [{ ...neutralSmall, schemaVersion: 3 }, 'HOUSEHOLD_CONFIG_VERSION_TOO_NEW'],
    [{ ...neutralSmall, schemaVersion: 0 }, 'HOUSEHOLD_CONFIG_VERSION_UNSUPPORTED'],
    [{ ...neutralSmall, schemaVersion: '1' }, 'HOUSEHOLD_CONFIG_VERSION_INVALID'],
    [Object.fromEntries(Object.entries(neutralSmall).filter(([key]) => key !== 'schemaVersion')), 'HOUSEHOLD_CONFIG_VERSION_INVALID'],
    [null, 'HOUSEHOLD_CONFIG_VERSION_INVALID'],
  ])('fails closed for unsupported or malformed versions', (source, code) => {
    expect(migrateHouseholdConfigDocument(source)).toMatchObject({ ok: false, code });
  });
});
