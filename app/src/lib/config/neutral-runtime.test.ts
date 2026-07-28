import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node import for the mechanical source-graph test.
import { existsSync, readFileSync } from 'node:fs';
// @ts-expect-error Native Node import for the mechanical source-graph test.
import { dirname, resolve } from 'node:path';
import neutralStudio from '../../../config/examples/neutral-studio.json';
import { FakeBackend } from '../adapter/fake-backend.ts';
import { FAKE_DISCOVERY_CATALOG } from '../state/device-config.ts';
import { FAKE_DISCOVERY_CATALOG as CANONICAL_FAKE_DISCOVERY_CATALOG } from '../state/fake-discovery-catalog.ts';
import { legacyHouseholdRuntimeModel } from './legacy-household-config.ts';
import {
  bootstrapNeutralRuntime,
  buildNeutralCatalog,
  buildNeutralSeed,
  type NeutralRuntimeReady,
} from './neutral-runtime.ts';
import { compileHouseholdConfig, parseHouseholdConfig } from './household-config.ts';

function compileNeutralStudio() {
  const parsed = parseHouseholdConfig(neutralStudio);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return compileHouseholdConfig(parsed.value);
}

function validResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function ready(result: Awaited<ReturnType<typeof bootstrapNeutralRuntime>>): NeutralRuntimeReady {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(result.code);
  return result;
}

describe('neutral household FakeBackend runtime', () => {
  it('loads only the exact no-store route and preserves semantic room/navigation order', async () => {
    const fetchImpl = vi.fn(async () => validResponse(neutralStudio));

    const result = ready(await bootstrapNeutralRuntime(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith('/api/household-config', { cache: 'no-store' });
    expect(result.backend).toBeInstanceOf(FakeBackend);
    expect(result.backendType).toBe('fake');
    expect(result.configId).toBe('household-v1:studio');
    expect(result.model.rooms.map(({ id }) => id)).toEqual(['studio', 'patio', 'utility']);
    expect(result.model.navigation.map(({ id }) => id)).toEqual(['start', 'studio', 'listen']);
  });

  it('derives every seed and injected catalog entry exclusively from the compiled neutral model', async () => {
    const model = compileNeutralStudio();
    const seed = buildNeutralSeed(model);
    const catalog = buildNeutralCatalog(model);
    const neutralIds = new Set([
      ...model.subscriptionEntityIds,
      ...model.commandContracts.map(({ entityId }) => entityId),
    ]);
    const productiveIds = new Set([
      ...legacyHouseholdRuntimeModel.subscriptionEntityIds,
      ...legacyHouseholdRuntimeModel.commandContracts.map(({ entityId }) => entityId),
    ]);

    expect([...seed.keys()].sort()).toEqual(model.subscriptionEntityIds);
    expect(catalog.map(({ entityId }) => entityId).sort()).toEqual([
      ...model.rooms.flatMap(({ visibleEntities }) => visibleEntities.map(({ entityId }) => entityId))
        .filter((entityId) => ['light', 'switch', 'sensor', 'binary_sensor', 'climate', 'media_player', 'cover', 'fan', 'input_boolean']
          .includes(entityId.slice(0, entityId.indexOf('.')))),
    ].sort());
    expect([...neutralIds].filter((entityId) => productiveIds.has(entityId))).toEqual([]);
    expect([...seed.keys()].every((entityId) => neutralIds.has(entityId))).toBe(true);
    expect(catalog.every(({ entityId }) => neutralIds.has(entityId))).toBe(true);

    const runtime = ready(await bootstrapNeutralRuntime(async () => validResponse(neutralStudio)));
    const publishedCatalog: unknown[][] = [];
    runtime.backend.subscribeCatalog((items) => publishedCatalog.push(items));
    expect(publishedCatalog).toEqual([catalog]);
    expect(publishedCatalog[0]).not.toEqual(FAKE_DISCOVERY_CATALOG);
  });

  it('keeps the existing FakeBackend default catalog unchanged when no catalog is injected', () => {
    const backend = new FakeBackend(new Map(), 0);
    let catalog: unknown[] = [];
    backend.subscribeCatalog((items) => { catalog = items; });

    expect(catalog).toEqual(FAKE_DISCOVERY_CATALOG);
  });

  it('keeps one side-effect-free source of truth for the FakeBackend default catalog', () => {
    const fakeBackendSource = readFileSync(
      new URL('../adapter/fake-backend.ts', import.meta.url),
      'utf8',
    );

    expect(FAKE_DISCOVERY_CATALOG).toBe(CANONICAL_FAKE_DISCOVERY_CATALOG);
    expect(fakeBackendSource).toMatch(
      /import\s+\{\s*FAKE_DISCOVERY_CATALOG[^}]*\}\s+from\s+['"]\.\.\/state\/fake-discovery-catalog\.ts['"];/,
    );
    for (const { entityId } of CANONICAL_FAKE_DISCOVERY_CATALOG) {
      expect(fakeBackendSource).not.toContain(entityId);
    }
  });

  it('echoes a neutral light toggle through FakeBackend from false to true', async () => {
    const runtime = ready(await bootstrapNeutralRuntime(async () => validResponse(neutralStudio), 0));
    const light = runtime.model.rooms
      .flatMap(({ visibleEntities }) => visibleEntities)
      .find(({ role }) => role === 'light');
    expect(light).toBeDefined();
    if (!light) throw new Error('Expected a configured light');
    const values: unknown[] = [];
    runtime.backend.subscribe((entityId, value) => {
      if (entityId === light.entityId) values.push(value);
    });

    expect(values.at(-1)).toMatchObject({ on: false });
    runtime.backend.callService('light', 'toggle', light.entityId, {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(values.at(-1)).toMatchObject({ on: true });
  });

  it('fails closed for invalid input without invoking the backend factory', async () => {
    const backendFactory = vi.fn(() => new FakeBackend(new Map()));

    const result = await bootstrapNeutralRuntime(
      async () => validResponse({ schemaVersion: 1, rooms: [] }),
      0,
      backendFactory,
    );

    expect(result).toMatchObject({
      status: 'error',
      code: 'HOUSEHOLD_CONFIG_INVALID',
    });
    expect(backendFactory).not.toHaveBeenCalled();
  });

  it('marks route and JSON failures with stable machine-readable error codes', async () => {
    const unavailable = await bootstrapNeutralRuntime(async () => new Response(
      JSON.stringify({ code: 'HOUSEHOLD_CONFIG_NOT_CONFIGURED' }),
      { status: 503 },
    ));
    expect(unavailable).toMatchObject({
      status: 'error',
      code: 'HOUSEHOLD_CONFIG_NOT_CONFIGURED',
    });

    const invalidJson = await bootstrapNeutralRuntime(async () => new Response('{broken', { status: 200 }));
    expect(invalidJson).toMatchObject({
      status: 'error',
      code: 'HOUSEHOLD_CONFIG_INVALID_JSON',
    });
  });

  it('keeps the neutral browser import graph free of HA, singleton, commands, PWA and storage modules', () => {
    const entry = new URL('../../neutral/main.ts', import.meta.url).pathname;
    const graph = collectRuntimeGraph(entry);
    const forbiddenSuffixes = [
      '/adapter/ha-backend.ts',
      '/adapter/runtime.svelte.ts',
      '/state/commands.ts',
      '/state/pwa-lifecycle.ts',
      '/state/shared-config.ts',
      '/state/device-config.ts',
    ];

    expect([...graph].some((path) => path.endsWith('/adapter/fake-backend.ts'))).toBe(true);
    expect([...graph].some((path) => path.endsWith('/state/fake-discovery-catalog.ts'))).toBe(true);
    expect([...graph].some((path) => path.endsWith('/config/household-config.ts'))).toBe(true);
    expect([...graph].filter((path) => forbiddenSuffixes.some((suffix) => path.endsWith(suffix))))
      .toEqual([]);
  });
});

function collectRuntimeGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    const imports = source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of imports) {
      const statement = match[0];
      const specifier = match[1] ?? match[2];
      if (/^import\s+type\b/.test(statement) || !specifier?.startsWith('.')) continue;
      const candidate = resolve(dirname(path), specifier);
      const resolved = [candidate, `${candidate}.ts`, `${candidate}.svelte`].find(existsSync);
      if (resolved && !resolved.endsWith('.css')) visit(resolved);
    }
  };
  visit(entry);
  return visited;
}
