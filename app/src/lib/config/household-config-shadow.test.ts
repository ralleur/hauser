import { describe, expect, it } from 'vitest';
// @ts-expect-error Nativer Node-Test ohne @types/node.
import { readFileSync } from 'node:fs';
import currentHousehold from '../../../config/households/current-v1.json';
import neutralSmall from '../../../config/examples/neutral-small.json';
import neutralStudio from '../../../config/examples/neutral-studio.json';
import {
  compareRuntimeModels,
  compileHouseholdConfig,
  parseHouseholdConfig,
  type HouseholdRuntimeModel,
} from './household-config.ts';
import {
  legacyHouseholdRuntimeModel,
  projectLegacyHouseholdConfig,
} from './legacy-household-config.ts';
import {
  bootstrapHouseholdConfigShadow,
  HOUSEHOLD_CONFIG_CACHE_KEY,
  readCachedHouseholdConfigCandidate,
} from './household-config-shadow.ts';

function compileValid(input: unknown): HouseholdRuntimeModel {
  const parsed = parseHouseholdConfig(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return compileHouseholdConfig(parsed.value);
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function configuredIds(model: HouseholdRuntimeModel): Set<string> {
  return new Set([
    ...model.subscriptionEntityIds,
    ...model.commandContracts.map(({ entityId }) => entityId),
  ]);
}

describe('household config production parity', () => {
  it('compiles current-v1.json to an exact legacy runtime model', () => {
    const external = compileValid(currentHousehold);

    expect(compareRuntimeModels(legacyHouseholdRuntimeModel, external)).toEqual({
      equal: true,
      differences: [],
    });
    expect(external.entityIds).toEqual(external.subscriptionEntityIds);
  });

  it('reports a concrete path for one changed productive entity ID', () => {
    const changed = structuredClone(currentHousehold);
    changed.rooms[0].visibleEntities[0].entityId = 'light.intentional_parity_break';

    const comparison = compareRuntimeModels(
      legacyHouseholdRuntimeModel,
      compileValid(changed),
    );

    expect(comparison.equal).toBe(false);
    expect(comparison.differences.some(({ path }) => (
      path.startsWith('$.rooms[') && path.endsWith('.entityId')
    ))).toBe(true);
  });

  it('detects subscription and command contract drift independently', () => {
    const changedSubscription = structuredClone(legacyHouseholdRuntimeModel);
    changedSubscription.subscriptionEntityIds[0] = 'sensor.intentional_subscription_break';
    changedSubscription.entityIds = [...changedSubscription.subscriptionEntityIds];
    expect(compareRuntimeModels(legacyHouseholdRuntimeModel, changedSubscription).differences)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.subscriptionEntityIds[0]' }),
      ]));

    const changedCommand = structuredClone(legacyHouseholdRuntimeModel);
    changedCommand.commandContracts[0].services[0] = 'intentional_service_break';
    expect(compareRuntimeModels(legacyHouseholdRuntimeModel, changedCommand).differences)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.commandContracts[0].services[0]' }),
      ]));
  });

  it('preserves productive energy grouping and reports grouping drift', () => {
    const external = compileValid(currentHousehold);
    const groupedLoads = external.energy?.sensors.consumptionPower
      .filter((source) => source.group === 'Steckdosenleiste');
    expect(groupedLoads?.map(({ entityId }) => entityId)).toEqual([
      'sensor.strom_leiste_kanal_1_power',
      'sensor.strom_leiste_kanal_2_power',
    ]);

    const changed = structuredClone(external);
    changed.energy!.sensors.consumptionPower[0].group = 'Intentional drift';
    expect(compareRuntimeModels(legacyHouseholdRuntimeModel, changed).differences)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ path: '$.energy.sensors.consumptionPower[0].group' }),
      ]));
  });

  it('keeps the legacy shadow projection import graph free of runtime state modules', () => {
    const source = readFileSync(new URL('./legacy-household-config.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/state\/(?:app\.svelte|entities|nav\.svelte)\.ts/);
  });

  it('keeps neutral fixtures disjoint from productive subscriptions and commands', () => {
    const productive = configuredIds(legacyHouseholdRuntimeModel);
    for (const fixture of [neutralSmall, neutralStudio]) {
      const neutral = configuredIds(compileValid(fixture));
      expect([...neutral].filter((entityId) => productive.has(entityId))).toEqual([]);
    }
  });

  it('projects the legacy sources without mutating them', () => {
    const first = projectLegacyHouseholdConfig();
    const before = JSON.stringify(first);
    const second = projectLegacyHouseholdConfig();

    expect(JSON.stringify(first)).toBe(before);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });
});

describe('household config shadow bootstrap', () => {
  it('persists and synchronously restores the last validated config without a network request', async () => {
    const storage = memoryStorage();
    await bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse(JSON.stringify(currentHousehold)),
      legacyModel: legacyHouseholdRuntimeModel,
      storage,
    });

    const cached = readCachedHouseholdConfigCandidate({
      storage,
      legacyModel: legacyHouseholdRuntimeModel,
    });
    expect(cached).toMatchObject({ mode: 'shadow', shadow: { status: 'match' } });
    expect(cached?.model?.subscriptionEntityIds).toEqual(legacyHouseholdRuntimeModel.subscriptionEntityIds);
  });

  it('drops a malformed local config snapshot instead of starting from it', () => {
    const storage = memoryStorage({ [HOUSEHOLD_CONFIG_CACHE_KEY]: '{not-json' });
    expect(readCachedHouseholdConfigCandidate({ storage })).toBeNull();
    expect(storage.getItem(HOUSEHOLD_CONFIG_CACHE_KEY)).toBeNull();
  });

  it('returns match without changing the injected legacy model', async () => {
    const before = JSON.stringify(legacyHouseholdRuntimeModel);
    const result = await bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse(JSON.stringify(currentHousehold)),
      legacyModel: legacyHouseholdRuntimeModel,
    });

    expect(result).toEqual({ status: 'match', differences: [] });
    expect(JSON.stringify(legacyHouseholdRuntimeModel)).toBe(before);
  });

  it('returns mismatch with concrete paths', async () => {
    const changed = structuredClone(currentHousehold);
    changed.globalEntities.homeOffScript = 'script.intentional_shadow_break';

    const result = await bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse(JSON.stringify(changed)),
      legacyModel: legacyHouseholdRuntimeModel,
    });

    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') throw new Error('Expected mismatch');
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.commandContracts[13].entityId' }),
    ]));
  });

  it('returns structured invalid states for JSON syntax and schema issues', async () => {
    const syntax = await bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse('{not-json'),
      legacyModel: legacyHouseholdRuntimeModel,
    });
    expect(syntax).toMatchObject({ status: 'invalid', kind: 'json' });

    const schema = await bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse(JSON.stringify({ schemaVersion: 2 })),
      legacyModel: legacyHouseholdRuntimeModel,
    });
    expect(schema).toMatchObject({ status: 'invalid', kind: 'schema' });
    if (schema.status !== 'invalid' || schema.kind !== 'schema') {
      throw new Error('Expected invalid schema');
    }
    expect(schema.issues.length).toBeGreaterThan(0);
  });

  it('returns unavailable for a missing route or failed fetch without throwing', async () => {
    await expect(bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse('{"code":"HOUSEHOLD_CONFIG_NOT_FOUND"}', 404),
      legacyModel: legacyHouseholdRuntimeModel,
    })).resolves.toMatchObject({
      status: 'unavailable',
      httpStatus: 404,
      code: 'HOUSEHOLD_CONFIG_NOT_FOUND',
    });

    await expect(bootstrapHouseholdConfigShadow({
      fetcher: async () => { throw new Error('offline'); },
      legacyModel: legacyHouseholdRuntimeModel,
    })).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('turns unexpected parser/compiler/compare failures into a stable unavailable result', async () => {
    const explodingModel = new Proxy(legacyHouseholdRuntimeModel, {
      ownKeys() { throw new Error('unexpected comparison failure'); },
    });

    await expect(bootstrapHouseholdConfigShadow({
      fetcher: async () => jsonResponse(JSON.stringify(currentHousehold)),
      legacyModel: explodingModel,
    })).resolves.toEqual({
      status: 'unavailable',
      code: 'HOUSEHOLD_CONFIG_SHADOW_UNEXPECTED',
      message: 'Household config shadow failed unexpectedly.',
    });
  });

  it('bounds the shadow fetch with an injectable abort timeout', async () => {
    let observedAbort = false;
    let delay = 0;
    const result = await bootstrapHouseholdConfigShadow({
      fetcher: (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        observedAbort = signal.aborted;
        signal.addEventListener('abort', () => { observedAbort = true; });
        return new Promise<Response>(() => {});
      },
      legacyModel: legacyHouseholdRuntimeModel,
      scheduleTimeout: (callback: () => void, timeoutMs: number) => {
        delay = timeoutMs;
        callback();
        return () => {};
      },
    });

    expect(delay).toBe(1_000);
    expect(observedAbort).toBe(true);
    expect(result).toMatchObject({
      status: 'unavailable',
      code: 'HOUSEHOLD_CONFIG_TIMEOUT',
    });
  });
});
