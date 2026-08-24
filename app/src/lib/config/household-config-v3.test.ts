import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node source-contract read without @types/node.
import { readFileSync } from 'node:fs';
import neutralStudio from '../../../config/examples/neutral-studio.json';
import {
  compareRuntimeModels,
  compileHouseholdConfig,
  parseHouseholdConfig,
  type ConfigIssue,
} from './household-config.ts';
import { migrateHouseholdConfigDocument } from './household-config-migration.ts';
import { projectLegacyHouseholdConfig } from './legacy-household-config.ts';
import { projectActiveHouseholdData } from './household-runtime-data.ts';

function v2Fixture(): Record<string, any> {
  const source = structuredClone(neutralStudio) as Record<string, any>;
  source.schemaVersion = 2;
  for (const room of source.rooms) delete room.hero;
  return source;
}

function v3Fixture(): Record<string, any> {
  return structuredClone(neutralStudio) as Record<string, any>;
}

function issues(input: unknown): ConfigIssue[] {
  const result = parseHouseholdConfig(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected invalid household config');
  return result.issues;
}

function expectIssue(input: unknown, code: ConfigIssue['code'], path: string): void {
  expect(issues(input)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code, path }),
  ]));
}

describe('canonical household schema v4 hero contract', () => {
  it('accepts the closed nullable hero shape and preserves it through compile and compare', () => {
    const input = v3Fixture();
    input.rooms[0].hero = {
      assetId: 'asset_01hzy2x9',
      focus: {
        panel: { x: 0.25, y: 0.75 },
        phone: { x: 0.6, y: 0.4 },
      },
    };
    input.globalEntities.laundry.washer = {
      type: 'entity',
      entityId: 'sensor.fixture_washer_status',
      runningStates: ['running'],
      doneStates: ['done'],
      doneOnInitial: true,
      cycleMarkerEntityId: 'automation.fixture_washer_cycle',
    };
    const before = JSON.stringify(input);

    const parsed = parseHouseholdConfig(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const compiled = compileHouseholdConfig(parsed.value);

    expect(parsed.value.schemaVersion).toBe(4);
    expect(compiled.rooms[0].hero).toEqual(input.rooms[0].hero);
    expect(compiled.rooms[0].hero).not.toBe(input.rooms[0].hero);
    const projected = projectActiveHouseholdData(compiled);
    expect(projected.ROOM_HERO_CONFIGS.studio).toEqual(input.rooms[0].hero);
    expect(projected.LAUNDRY_ENTITIES.washer).toEqual(input.globalEntities.laundry.washer);
    expect(compiled.subscriptionEntityIds).toEqual(expect.arrayContaining([
      'sensor.fixture_washer_status',
      'automation.fixture_washer_cycle',
    ]));
    expect(JSON.stringify(input)).toBe(before);

    const changedInput = structuredClone(input);
    changedInput.rooms[0].hero.focus.phone.x = 0.61;
    const changed = parseHouseholdConfig(changedInput);
    expect(changed.ok).toBe(true);
    if (!changed.ok) throw new Error(JSON.stringify(changed.issues));
    const changedCompiled = compileHouseholdConfig(changed.value);
    expect(changedCompiled.subscriptionEntityIds).toEqual(compiled.subscriptionEntityIds);
    expect(compareRuntimeModels(compiled, changedCompiled).differences)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.rooms[0].hero.focus.phone.x' }),
      ]));
  });

  it('deep-copies active Laundry adapters and state arrays without losing cycle markers', () => {
    const input = v3Fixture();
    input.globalEntities.laundry = {
      washer: {
        type: 'entity',
        entityId: 'sensor.fixture_washer_status',
        runningStates: ['running'],
        doneStates: ['done'],
        doneOnInitial: true,
      },
      dryer: {
        type: 'entity',
        entityId: 'binary_sensor.fixture_dryer_running',
        runningStates: ['on'],
        doneStates: ['off'],
        doneOnInitial: false,
      },
    };
    input.globalEntities.laundry.washer.cycleMarkerEntityId = 'automation.fixture_washer_cycle';
    input.globalEntities.laundry.dryer.cycleMarkerEntityId = 'automation.fixture_dryer_cycle';
    const parsed = parseHouseholdConfig(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const model = compileHouseholdConfig(parsed.value);
    const source = model.globalEntities.laundry;
    const projected = projectActiveHouseholdData(model).LAUNDRY_ENTITIES;
    const washer = projected.washer;
    const dryer = projected.dryer;
    const sourceWasher = source.washer;
    const sourceDryer = source.dryer;
    if (!washer || !dryer || !sourceWasher || !sourceDryer) throw new Error('Expected typed Laundry adapters');
    const sourceBefore = structuredClone(source);

    washer.entityId = 'sensor.mutated_washer';
    washer.runningStates.push('mutated-running');
    washer.doneStates.push('mutated-done');
    dryer.entityId = 'sensor.mutated_dryer';
    dryer.runningStates.push('mutated-running');
    dryer.doneStates.push('mutated-done');
    const sourceAfterMutation = structuredClone(source);

    expect(projected).not.toBe(source);
    expect(washer).not.toBe(sourceWasher);
    expect(washer.runningStates).not.toBe(sourceWasher.runningStates);
    expect(washer.doneStates).not.toBe(sourceWasher.doneStates);
    expect(dryer).not.toBe(sourceDryer);
    expect(dryer.runningStates).not.toBe(sourceDryer.runningStates);
    expect(dryer.doneStates).not.toBe(sourceDryer.doneStates);
    expect(sourceAfterMutation).toEqual(sourceBefore);
    expect(washer.cycleMarkerEntityId).toBe('automation.fixture_washer_cycle');
    expect(dryer.cycleMarkerEntityId).toBe('automation.fixture_dryer_cycle');
  });

  it('projects every legacy room as schema-v4 project fallback without changing subscriptions', () => {
    const legacy = projectLegacyHouseholdConfig();
    const compiled = compileHouseholdConfig(legacy);

    expect(legacy.schemaVersion).toBe(4);
    expect(legacy.rooms.every(({ hero }) => hero === null)).toBe(true);
    expect(compiled.rooms.every(({ hero }) => hero === null)).toBe(true);
    expect(compiled.entityIds).toBe(compiled.subscriptionEntityIds);
  });

  it('keeps SetupWizard on v3 preservation and sends the reconfigure ETag preconditions', () => {
    const source = readFileSync(new URL('../components/SetupWizard.svelte', import.meta.url), 'utf8');

    expect(source).toContain('type HouseholdConfigV4');
    expect(source).toContain('preserveSetupRoomHeroes(previousSuggestion.config, discovered.config)');
    expect(source).not.toContain('HouseholdConfigV2');
    expect(source).toContain("headers['If-Match'] = householdEtag");
    expect(source).toContain("headers['X-Hauser-Shared-Config-If-Match'] = sharedEtag");
  });

  it.each(['washer', 'dryer'] as const)('rejects scalar v3 Laundry binding for %s fail-closed', (device) => {
    const input = v3Fixture();
    input.globalEntities.laundry[device] = `input_boolean.${device}_running`;

    expectIssue(input, 'TYPE_MISMATCH', `$.globalEntities.laundry.${device}`);
  });

  it('requires hero on every room and rejects unknown keys, unsafe asset IDs and invalid focus values', () => {
    const missing = v3Fixture();
    delete missing.rooms[0].hero;
    expectIssue(missing, 'REQUIRED', '$.rooms[0].hero');

    const extra = v3Fixture();
    extra.rooms[0].hero = {
      assetId: 'asset_01hzy2x9',
      focus: {
        panel: { x: 0.5, y: 0.5, crop: 'forbidden' },
        phone: { x: 0.5, y: 0.5 },
      },
      provider: 'forbidden',
    };
    expectIssue(extra, 'UNKNOWN_FIELD', '$.rooms[0].hero.provider');
    expectIssue(extra, 'UNKNOWN_FIELD', '$.rooms[0].hero.focus.panel.crop');

    for (const assetId of ['', '../secret', '/assets/room.avif', 'https://example.invalid/image']) {
      const invalidId = v3Fixture();
      invalidId.rooms[0].hero = {
        assetId,
        focus: { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
      };
      expectIssue(invalidId, 'INVALID_ID', '$.rooms[0].hero.assetId');
    }

    for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalidFocus = v3Fixture();
      invalidFocus.rooms[0].hero = {
        assetId: 'asset_01hzy2x9',
        focus: { panel: { x: value, y: 0.5 }, phone: { x: 0.5, y: 0.5 } },
      };
      expectIssue(invalidFocus, 'INVALID_VALUE', '$.rooms[0].hero.focus.panel.x');
    }
  });
});

describe('sequential household v1/v2/v3 to v4 migration', () => {
  it.each([1, 2])('migrates v%s without mutation and adds exactly hero null in room order', (version) => {
    const input = v2Fixture();
    input.schemaVersion = version;
    const before = JSON.stringify(input);

    const result = migrateHouseholdConfigDocument(input);

    expect(result.ok).toBe(true);
    if (!result.ok || result.status !== 'migrated') throw new Error('Expected migrated config');
    expect(result.fromVersion).toBe(version);
    expect(result.toVersion).toBe(4);
    expect(result.document.schemaVersion).toBe(4);
    expect((result.document.rooms as Array<Record<string, unknown>>).map((room) => ({
      id: room.id,
      hero: room.hero,
    }))).toEqual([
      { id: 'studio', hero: null },
      { id: 'patio', hero: null },
      { id: 'utility', hero: null },
    ]);
    expect(JSON.stringify(input)).toBe(before);

    expect(migrateHouseholdConfigDocument(result.document)).toEqual({
      ok: true,
      status: 'current',
      document: result.document,
      version: 4,
    });
  });

  it('fails closed for malformed legacy and future documents', () => {
    const malformed = v2Fixture();
    malformed.rooms[0].unexpected = true;
    expect(migrateHouseholdConfigDocument(malformed)).toMatchObject({
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID',
    });
    expect(migrateHouseholdConfigDocument({ ...v3Fixture(), schemaVersion: 5 })).toMatchObject({
      ok: false,
      code: 'HOUSEHOLD_CONFIG_VERSION_TOO_NEW',
    });
  });
});
