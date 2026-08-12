import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { readFileSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { relative } from 'node:path';
import currentHousehold from '../../../config/households/current-v1.json';
import neutralSmall from '../../../config/examples/neutral-small.json';
import neutralStudio from '../../../config/examples/neutral-studio.json';
import {
  compileHouseholdConfig,
  parseHouseholdConfig,
  type HouseholdConfigV2,
  type HouseholdRuntimeModel,
} from './household-config.ts';
import { legacyHouseholdRuntimeModel } from './legacy-household-config.ts';
import {
  ENERGY_SENSORS,
  ENABLED_MODULES,
  HOUSEHOLD_RUNTIME_MODEL,
  MEDIA_SEED,
  NAV_SCREENS,
  NAV_TABS,
  ROOM_CAMERA_ENTITIES,
  ROOM_SEED,
  SONG_MEDIA_TARGETS,
  SUN_ENTITY,
  installActiveHouseholdData,
  projectActiveHouseholdData,
  resetHouseholdDataToLegacy,
} from './household-runtime-data.ts';
import {
  bootstrapCachedHouseholdConfigRuntime,
  bootstrapHouseholdConfigFirstPaint,
  bootstrapHouseholdConfigRuntime,
} from './household-config-runtime.ts';
import { HOUSEHOLD_CONFIG_CACHE_KEY } from './household-config-shadow.ts';
import { normalizePhoneNavOrder, projectPhoneNavOrder } from '../state/phone-nav-order.svelte.ts';
import { initialMediaTarget } from '../state/phone-navigation.svelte.ts';
import { demoResponse } from '../demo/demo-mode.ts';
import { MINIMAL_SHELL_VIEWS } from '../shells/minimal-shell-navigation.ts';
import { collectProductivePrePaintSourceGraph } from './pre-paint-source-graph.test-utils.ts';

function compileValid(input: unknown): HouseholdRuntimeModel {
  const parsed = parseHouseholdConfig(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return compileHouseholdConfig(parsed.value);
}

function response(input: unknown, mode: string, status = 200): Response {
  return new Response(typeof input === 'string' ? input : JSON.stringify(input), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-hmi-household-config-mode': mode,
    },
  });
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  cache(mode: 'active' | 'shadow', config: unknown) {
    this.setItem(HOUSEHOLD_CONFIG_CACHE_KEY, JSON.stringify({ version: 1, mode, config, savedAt: Date.now() }));
  }
}

function syntheticActiveConfig(): HouseholdConfigV2 {
  const config = structuredClone(neutralStudio) as HouseholdConfigV2;
  config.navigation = [
    { id: 'start', name: 'Startseite', order: 0, target: { type: 'module', id: 'home' } },
    { id: 'listen', name: 'Audio', order: 1, target: { type: 'module', id: 'media' } },
  ];
  return config;
}

function configuredIds(model: HouseholdRuntimeModel): Set<string> {
  return new Set([
    ...model.subscriptionEntityIds,
    ...model.commandContracts.map(({ entityId }) => entityId),
  ]);
}

afterEach(() => {
  resetHouseholdDataToLegacy();
  vi.unstubAllGlobals();
});

describe('active household runtime projection', () => {
  it('projects rooms, order, roles, media, energy, globals, subscriptions and navigation from config', () => {
    const model = compileValid(syntheticActiveConfig());
    const projected = projectActiveHouseholdData(model);

    expect(projected.ROOM_SEED.map(({ id }) => id)).toEqual(['studio', 'patio', 'utility']);
    expect(projected.ROOM_SEED[0]).toMatchObject({
      id: 'studio',
      name: 'Studio',
      climateEntityId: 'climate.studio',
      lights: [{ id: 'ceiling', name: 'Ceiling', entityId: 'light.studio_ceiling' }],
    });
    expect(projected.ROOM_CAMERA_ENTITIES).toEqual({ patio: 'camera.patio' });
    expect(projected.MEDIA_SEED.map(({ id, entityId }) => ({ id, entityId }))).toEqual([
      { id: 'patio_audio', entityId: 'media_player.patio_audio' },
      { id: 'studio_audio', entityId: 'media_player.studio_audio' },
    ]);
    expect(projected.ENERGY_SENSORS).toEqual({
      pv: null, load: [], producedToday: null, consumedToday: null, fedInToday: null, drawnToday: null,
    });
    expect(projected.SUN_ENTITY).toBe('sun.fixture_neutral_studio');
    expect(projected.ENABLED_MODULES).toEqual(['home', 'media']);
    expect(projected.NAV_TABS.map(({ id, configName }) => ({ id, configName }))).toEqual([
      { id: 'home', configName: 'Startseite' },
      { id: 'media', configName: 'Audio' },
    ]);
    expect(projected.NAV_SCREENS.map(({ id }) => id)).toEqual(['home', 'media']);
    expect(projected.runtimeModel.subscriptionEntityIds).toEqual(model.subscriptionEntityIds);
    expect(projected.runtimeModel.commandContracts).toEqual(model.commandContracts);
  });

  it('never supplements a synthetic valid config with a legacy entity ID', () => {
    const model = compileValid(syntheticActiveConfig());
    const projected = projectActiveHouseholdData(model);
    const legacyIds = configuredIds(legacyHouseholdRuntimeModel);

    expect([...configuredIds(projected.runtimeModel)].filter((id) => legacyIds.has(id))).toEqual([]);
    const projectedSeedIds = [
      ...projected.ROOM_SEED.flatMap((room) => [
        ...room.lights.map(({ entityId }) => entityId),
        room.climateEntityId,
        room.tempSensorId,
      ]),
      ...projected.MEDIA_SEED.map(({ entityId }) => entityId),
      ...Object.values(projected.ROOM_CAMERA_ENTITIES),
      projected.SUN_ENTITY,
      projected.VACATION_MODE_ENTITY,
      projected.HOME_OFF_SCRIPT_ENTITY,
      ...Object.values(projected.LAUNDRY_ENTITIES),
    ].filter((id): id is string => Boolean(id));
    expect(projectedSeedIds.filter((id) => legacyIds.has(id))).toEqual([]);
  });

  it('projects both shipped neutral household examples without application-code changes', () => {
    const small = projectActiveHouseholdData(compileValid(neutralSmall));
    const studio = projectActiveHouseholdData(compileValid(neutralStudio));

    expect(small.ROOM_SEED.map(({ id }) => id)).toEqual(['den', 'entry']);
    expect(small.NAV_TABS.map(({ id }) => id)).toEqual(['home', 'energy']);
    expect(studio.ROOM_SEED.map(({ id }) => id)).toEqual(['studio', 'patio', 'utility']);
    expect(studio.NAV_TABS.map(({ id }) => id)).toEqual(['home', 'media']);
  });

  it('selects the first configured media target and rejects an enabled media module without targets', () => {
    const projected = projectActiveHouseholdData(compileValid(syntheticActiveConfig()));
    expect(projected.MEDIA_SEED[0]?.id).toBe('patio_audio');

    const withoutTargets = syntheticActiveConfig();
    withoutTargets.mediaTargets = [];
    expect(() => projectActiveHouseholdData(compileValid(withoutTargets))).toThrowError(
      expect.objectContaining({ code: 'HOUSEHOLD_CONFIG_MEDIA_TARGET_REQUIRED' }),
    );

    const appSource = readFileSync(new URL('../state/app.svelte.ts', import.meta.url), 'utf8');
    const entitySource = readFileSync(new URL('../state/entities.ts', import.meta.url), 'utf8');
    expect(appSource).toContain("current: MEDIA_SEED[0]?.id ?? ''");
    expect(appSource).not.toContain("current: 'wohnzimmer'");
    expect(entitySource).not.toContain('`media_player.${playerId}`');
  });

  it('uses exact-ID legacy presentation metadata only and gives new lights on/off-only capabilities', () => {
    const current = projectActiveHouseholdData(compileValid(currentHousehold));
    const known = current.ROOM_SEED[0].lights.find(({ entityId }) => entityId === 'light.wohnzimmer_esstisch');
    expect(known).toMatchObject({ dimmable: true, colorTemp: true, color: true, icon: 'i-lamp-pendant' });

    const synthetic = projectActiveHouseholdData(compileValid(syntheticActiveConfig()));
    expect(synthetic.ROOM_SEED[0].lights[0]).toMatchObject({
      entityId: 'light.studio_ceiling', dimmable: false, colorTemp: false, color: false,
    });
  });

  it('projects current-v1 to the same semantic rooms, nav and complete target contracts as legacy', () => {
    const projected = projectActiveHouseholdData(compileValid(currentHousehold));
    expect(projected.runtimeModel).toEqual(legacyHouseholdRuntimeModel);
    expect(projected.ROOM_SEED.map(({ id, name }) => ({ id, name }))).toEqual(
      legacyHouseholdRuntimeModel.rooms.map(({ id, name }) => ({ id, name })),
    );
    expect(projected.NAV_TABS.map(({ id }) => id)).toEqual(
      legacyHouseholdRuntimeModel.navigation.map(({ target }) => target.id),
    );
  });

  it('fails closed for navigation the productive shell cannot represent and incomplete song targets', () => {
    const unsupportedNavigation = structuredClone(neutralStudio) as HouseholdConfigV2;
    unsupportedNavigation.navigation.splice(1, 0, {
      id: 'studio-room', name: 'Studio room', order: 5, target: { type: 'room', id: 'studio' },
    });
    expect(() => projectActiveHouseholdData(compileValid(unsupportedNavigation))).toThrowError(
      expect.objectContaining({ code: 'HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION' }),
    );

    const songs = syntheticActiveConfig();
    songs.enabledModules.push('songs');
    expect(() => projectActiveHouseholdData(compileValid(songs))).toThrowError(
      expect.objectContaining({ code: 'HOUSEHOLD_CONFIG_SONG_TARGETS_MISSING' }),
    );
  });

  it('keeps shadow exports on the exact legacy references and installs active values before consumers import', () => {
    const legacyRooms = ROOM_SEED;
    resetHouseholdDataToLegacy();
    expect(ROOM_SEED).toBe(legacyRooms);

    const model = compileValid(syntheticActiveConfig());
    installActiveHouseholdData(model);
    expect(HOUSEHOLD_RUNTIME_MODEL).toBe(model);
    expect(ROOM_SEED.map(({ id }) => id)).toEqual(['studio', 'patio', 'utility']);
    expect(MEDIA_SEED.map(({ id }) => id)).toEqual(['patio_audio', 'studio_audio']);
    expect(ENERGY_SENSORS.load).toEqual([]);
    expect(SUN_ENTITY).toBe('sun.fixture_neutral_studio');
    expect(ROOM_CAMERA_ENTITIES).toEqual({ patio: 'camera.patio' });
    expect(NAV_TABS.map(({ id }) => id)).toEqual(['home', 'media']);
    expect(NAV_SCREENS.map(({ id }) => id)).toEqual(['home', 'media']);
    expect(ENABLED_MODULES).toEqual(['home', 'media']);
    expect(SONG_MEDIA_TARGETS).toEqual({});
  });
});

describe('productive household bootstrap cutover', () => {
  it('keeps the provisional shell navigation local and bounded', () => {
    expect(MINIMAL_SHELL_VIEWS.map(({ id }) => id)).toEqual(['home', 'rooms', 'system']);
    expect(MINIMAL_SHELL_VIEWS.map(({ label }) => label)).toEqual(['Zuhause', 'Räume', 'System']);
  });

  it('mounts the complete local shell before a no-cache validation may start or hang', async () => {
    const storage = new MemoryStorage();
    const events: string[] = [];
    const startLocalShell = vi.fn(async () => {
      events.push('mount');
      expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
      return 'local-shell';
    });
    const startAuthorizedApp = vi.fn(async () => 'must-not-start');
    const fetcher = vi.fn(() => {
      events.push('fetch');
      return new Promise<Response>(() => {});
    });

    const bootstrap = await bootstrapHouseholdConfigFirstPaint({
      storage,
      fetcher: fetcher as typeof fetch,
      healthStatus: async () => null,
      startLocalShell,
      startAuthorizedApp,
      scheduleValidation: (task) => task(),
      scheduleTimeout: () => () => undefined,
    });

    expect(bootstrap).toMatchObject({ app: 'local-shell', source: 'legacy' });
    expect(startLocalShell).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(events).toEqual(['mount', 'fetch']);
    expect(startAuthorizedApp).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'missing storage', storage: null },
    {
      name: 'throwing cache write',
      storage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota denied'); },
        removeItem: () => undefined,
      },
    },
  ])('cuts over a validated active config without reload loops for $name', async ({ storage }) => {
    const startAuthorizedApp = vi.fn(async () => 'authorized-app');
    let validate: (() => void) | undefined;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ mode: 'active' }, 'active'))
      .mockResolvedValueOnce(response(syntheticActiveConfig(), 'active'));

    const bootstrap = await bootstrapHouseholdConfigFirstPaint({
      storage,
      fetcher,
      healthStatus: async () => 'ready',
      startLocalShell: async () => 'local-shell',
      startAuthorizedApp,
      scheduleValidation: (task) => { validate = task; },
    });
    validate?.();

    await expect(bootstrap.validation).resolves.toMatchObject({
      status: 'authorized',
      mode: 'active',
      app: 'authorized-app',
    });
    expect(startAuthorizedApp).toHaveBeenCalledOnce();
  });

  it('authorizes confirmed shadow as legacy when active-cache deletion throws', async () => {
    const values = new MemoryStorage();
    values.cache('active', syntheticActiveConfig());
    const storage = {
      getItem: (key: string) => values.getItem(key),
      setItem: (key: string, value: string) => values.setItem(key, value),
      removeItem: () => { throw new Error('storage is read-only'); },
    };
    const startAuthorizedApp = vi.fn(async () => {
      expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
      expect(ROOM_SEED.map(({ id }) => id)).toEqual(
        legacyHouseholdRuntimeModel.rooms.map(({ id }) => id),
      );
      expect(HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds).not.toContain('light.studio_ceiling');
      return 'legacy-app';
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ mode: 'shadow' }, 'shadow'))
      .mockResolvedValueOnce(response({ code: 'HOUSEHOLD_CONFIG_NOT_FOUND' }, 'shadow', 404));
    let validate: (() => void) | undefined;

    const bootstrap = await bootstrapHouseholdConfigFirstPaint({
      storage,
      fetcher,
      healthStatus: async () => 'ready',
      startLocalShell: async () => 'local-shell',
      startAuthorizedApp,
      scheduleValidation: (task) => { validate = task; },
    });
    validate?.();

    await expect(bootstrap.validation).resolves.toMatchObject({
      status: 'authorized',
      mode: 'shadow',
      app: 'legacy-app',
    });
    expect(startAuthorizedApp).toHaveBeenCalledOnce();
    expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
    expect(storage.getItem(HOUSEHOLD_CONFIG_CACHE_KEY)).not.toBeNull();
  });

  it('reloads a successfully persisted active cutover at most once', async () => {
    const storage = new MemoryStorage();
    const validateRun = async (startAuthorizedApp: () => Promise<string>) => {
      let validate: (() => void) | undefined;
      const fetcher = vi.fn()
        .mockResolvedValueOnce(response({ mode: 'active' }, 'active'))
        .mockResolvedValueOnce(response(syntheticActiveConfig(), 'active'));
      const bootstrap = await bootstrapHouseholdConfigFirstPaint({
        storage,
        fetcher,
        healthStatus: async () => 'ready',
        startLocalShell: async () => 'local-shell',
        startAuthorizedApp,
        scheduleValidation: (task) => { validate = task; },
      });
      validate?.();
      return bootstrap.validation;
    };

    const firstStart = vi.fn(async () => 'must-not-start');
    await expect(validateRun(firstStart)).resolves.toMatchObject({
      status: 'reload_required',
      mode: 'active',
      code: 'HOUSEHOLD_CONFIG_CACHE_REFRESHED',
    });
    expect(firstStart).not.toHaveBeenCalled();

    resetHouseholdDataToLegacy();
    const secondStart = vi.fn(async () => 'authorized-app');
    await expect(validateRun(secondStart)).resolves.toMatchObject({
      status: 'authorized',
      mode: 'active',
      app: 'authorized-app',
    });
    expect(secondStart).toHaveBeenCalledOnce();
  });

  it('authorizes legacy after a confirmed shadow rollback and clears an active cache when possible', async () => {
    const storage = new MemoryStorage();
    storage.cache('active', syntheticActiveConfig());
    const startLocalShell = vi.fn(async () => 'cached-shell');
    const startAuthorizedApp = vi.fn(async () => {
      expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
      return 'legacy-app';
    });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ mode: 'shadow' }, 'shadow'))
      .mockResolvedValueOnce(response({ code: 'HOUSEHOLD_CONFIG_NOT_FOUND' }, 'shadow', 404));
    let validate: (() => void) | undefined;

    const bootstrap = await bootstrapHouseholdConfigFirstPaint({
      storage,
      fetcher,
      healthStatus: async () => 'ready',
      startLocalShell,
      startAuthorizedApp,
      scheduleValidation: (task) => { validate = task; },
    });
    expect(bootstrap.source).toBe('active-cache');
    expect(HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds).toContain('light.studio_ceiling');

    validate?.();
    await expect(bootstrap.validation).resolves.toMatchObject({
      status: 'authorized',
      mode: 'shadow',
      app: 'legacy-app',
    });
    expect(storage.getItem(HOUSEHOLD_CONFIG_CACHE_KEY)).toBeNull();
    expect(startAuthorizedApp).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: 'setup_required',
      healthStatus: async () => 'setup_required' as const,
      responses: [] as Response[],
      expectedStatus: 'setup_required',
    },
    {
      name: 'unknown mode',
      healthStatus: async () => 'ready' as const,
      responses: [response(syntheticActiveConfig(), 'enabled')],
      expectedStatus: 'reload_required',
    },
    {
      name: 'active-invalid config',
      healthStatus: async () => 'ready' as const,
      responses: [
        response({ mode: 'active' }, 'active'),
        response({ schemaVersion: 2 }, 'active'),
      ],
      expectedStatus: 'reload_required',
    },
  ])('clears an active cache and authorizes no backend for $name', async ({
    healthStatus,
    responses,
    expectedStatus,
  }) => {
    const storage = new MemoryStorage();
    storage.cache('active', syntheticActiveConfig());
    const startAuthorizedApp = vi.fn(async () => 'must-not-start');
    const fetcher = vi.fn();
    for (const candidate of responses) fetcher.mockResolvedValueOnce(candidate);
    let validate: (() => void) | undefined;

    const bootstrap = await bootstrapHouseholdConfigFirstPaint({
      storage,
      fetcher,
      healthStatus,
      startLocalShell: async () => 'cached-shell',
      startAuthorizedApp,
      scheduleValidation: (task) => { validate = task; },
    });
    validate?.();

    await expect(bootstrap.validation).resolves.toMatchObject({ status: expectedStatus });
    expect(storage.getItem(HOUSEHOLD_CONFIG_CACHE_KEY)).toBeNull();
    expect(startAuthorizedApp).not.toHaveBeenCalled();
  });

  it('installs a validated active snapshot before mounting without any network dependency', async () => {
    const storage = new MemoryStorage();
    storage.cache('active', syntheticActiveConfig());
    const start = vi.fn(async () => {
      expect(ROOM_SEED.map(({ id }) => id)).toEqual(['studio', 'patio', 'utility']);
      expect(HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds).toContain('light.studio_ceiling');
      return 'cached-mounted';
    });

    const result = await bootstrapCachedHouseholdConfigRuntime({ storage, startProductiveApp: start });

    expect(start).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mode: 'active', status: 'active', app: 'cached-mounted' });
  });

  it('deletes a valid-schema snapshot whose active UI projection is unsafe', async () => {
    const storage = new MemoryStorage();
    const unsupported = structuredClone(neutralStudio) as HouseholdConfigV2;
    unsupported.navigation.splice(1, 0, {
      id: 'studio-room', name: 'Studio room', order: 5, target: { type: 'room', id: 'studio' },
    });
    storage.cache('active', unsupported);
    const start = vi.fn(async () => 'must-not-mount');

    const result = await bootstrapCachedHouseholdConfigRuntime({ storage, startProductiveApp: start });

    expect(result).toBeNull();
    expect(start).not.toHaveBeenCalled();
    expect(storage.getItem(HOUSEHOLD_CONFIG_CACHE_KEY)).toBeNull();
    expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
  });

  it('mounts legacy in shadow despite invalid or unavailable candidates', async () => {
    for (const candidate of [
      response('{not-json', 'shadow'),
      response({ code: 'HOUSEHOLD_CONFIG_NOT_FOUND' }, 'shadow', 404),
    ]) {
      const start = vi.fn(async () => 'mounted');
      const fetcher = vi.fn()
        .mockResolvedValueOnce(response({ mode: 'shadow' }, 'shadow'))
        .mockResolvedValueOnce(candidate);
      const result = await bootstrapHouseholdConfigRuntime({
        fetcher,
        startProductiveApp: start,
      });
      expect(start).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ mode: 'shadow', status: 'legacy' });
      expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
    }
  });

  it('installs a valid active config before productive dynamic imports and fetches exactly once', async () => {
    const fetcher = vi.fn(async () => response(syntheticActiveConfig(), '  ACTIVE  '));
    const start = vi.fn(async () => {
      expect(ROOM_SEED.map(({ id }) => id)).toEqual(['studio', 'patio', 'utility']);
      expect(HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds).toContain('light.studio_ceiling');
      return 'mounted';
    });

    const result = await bootstrapHouseholdConfigRuntime({ fetcher, startProductiveApp: start });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/household-config-mode', expect.objectContaining({
      method: 'GET', cache: 'no-store',
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/household-config', expect.objectContaining({
      method: 'GET', cache: 'no-store',
    }));
    expect(start).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mode: 'active', status: 'active', parity: 'mismatch' });
  });

  it('does not import App, runtime or backend for active invalid, unavailable or projection errors', async () => {
    const projectionError = structuredClone(neutralStudio) as HouseholdConfigV2;
    projectionError.navigation.splice(1, 0, {
      id: 'studio-room', name: 'Studio room', order: 5, target: { type: 'room', id: 'studio' },
    });
    const candidates = [
      response('{not-json', 'active'),
      response({ code: 'HOUSEHOLD_CONFIG_NOT_READABLE' }, 'active', 500),
      response(projectionError, 'active'),
    ];

    for (const candidate of candidates) {
      const start = vi.fn(async () => 'must-not-mount');
      const fetcher = vi.fn()
        .mockResolvedValueOnce(response({ mode: 'active' }, 'active'))
        .mockResolvedValueOnce(candidate);
      const result = await bootstrapHouseholdConfigRuntime({
        fetcher,
        startProductiveApp: start,
      });
      expect(start).not.toHaveBeenCalled();
      expect(result).toMatchObject({ mode: 'active', status: 'error' });
      expect(result.code).toMatch(/^HOUSEHOLD_CONFIG_/);
      resetHouseholdDataToLegacy();
    }
  });

  it('normalizes known mode headers and fails closed for an unknown value', async () => {
    const activeStart = vi.fn(async () => undefined);
    await bootstrapHouseholdConfigRuntime({
      fetcher: async () => response(syntheticActiveConfig(), '\tActive\n'),
      startProductiveApp: activeStart,
    });
    expect(activeStart).toHaveBeenCalledOnce();
    expect(ROOM_SEED[0].id).toBe('studio');

    resetHouseholdDataToLegacy();
    const unknownStart = vi.fn(async () => undefined);
    const unknown = await bootstrapHouseholdConfigRuntime({
      fetcher: async () => response(syntheticActiveConfig(), 'enabled'),
      startProductiveApp: unknownStart,
    });
    expect(unknownStart).not.toHaveBeenCalled();
    expect(unknown).toMatchObject({ mode: 'unknown', status: 'error', code: 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE' });
    expect(HOUSEHOLD_RUNTIME_MODEL).toBe(legacyHouseholdRuntimeModel);
  });

  it('fails closed when mode is unknown, but preserves legacy after confirmed shadow', async () => {
    const unknownStart = vi.fn(async () => 'must-not-mount');
    const unknown = await bootstrapHouseholdConfigRuntime({
      fetcher: vi.fn(async () => { throw new Error('offline'); }),
      startProductiveApp: unknownStart,
    });
    expect(unknownStart).not.toHaveBeenCalled();
    expect(unknown).toMatchObject({ mode: 'unknown', status: 'error', code: 'HOUSEHOLD_CONFIG_MODE_UNAVAILABLE' });

    const shadowStart = vi.fn(async () => 'mounted');
    const shadowFetcher = vi.fn()
      .mockResolvedValueOnce(response({ mode: 'shadow' }, 'shadow'))
      .mockRejectedValueOnce(new Error('config offline'));
    const shadow = await bootstrapHouseholdConfigRuntime({ fetcher: shadowFetcher, startProductiveApp: shadowStart });
    expect(shadowStart).toHaveBeenCalledOnce();
    expect(shadow).toMatchObject({ mode: 'shadow', status: 'legacy', parity: 'unavailable' });

    const activeStart = vi.fn(async () => 'must-not-mount');
    const activeFetcher = vi.fn()
      .mockResolvedValueOnce(response({ mode: 'active' }, 'active'))
      .mockRejectedValueOnce(new Error('config offline'));
    const active = await bootstrapHouseholdConfigRuntime({ fetcher: activeFetcher, startProductiveApp: activeStart });
    expect(activeStart).not.toHaveBeenCalled();
    expect(active).toMatchObject({ mode: 'active', status: 'error' });
  });

  it('boots the static demo through the same active config path without a companion server', async () => {
    const start = vi.fn(async () => 'demo-mounted');
    const result = await bootstrapHouseholdConfigRuntime({
      fetcher: async (input, init) => {
        const response = demoResponse(String(input), (init?.method ?? 'GET').toUpperCase());
        if (!response) throw new Error(`Unexpected demo route: ${String(input)}`);
        return response;
      },
      startProductiveApp: start,
    });
    expect(start).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mode: 'active', status: 'active', parity: 'mismatch' });
    const mode = demoResponse('/api/household-config-mode', 'GET');
    expect(mode?.headers.get('cache-control')).toBe('no-store');
    expect(mode?.headers.get('x-hmi-household-config-mode')).toBe('active');
    const config = demoResponse('/api/household-config', 'GET');
    expect(config?.headers.get('x-hmi-household-config-mode')).toBe('active');
    await expect(config?.json()).resolves.toMatchObject({ schemaVersion: 2 });
    const health = demoResponse('/api/health', 'GET');
    expect(health?.headers.get('cache-control')).toBe('no-store');
    await expect(health?.json()).resolves.toMatchObject({ ok: true, status: 'ready', schemaVersion: 2 });
    expect(demoResponse('/api/health', 'POST')?.status).toBe(405);
    const shopping = demoResponse('/notion-shopping.json', 'GET');
    expect(shopping?.headers.get('cache-control')).toBe('no-store');
    await expect(shopping?.json()).resolves.toMatchObject({ source_name: 'Demo' });
  });

  it('projects configured active Phone targets while preserving a valid device-local order', () => {
    const projected = projectActiveHouseholdData(compileValid(syntheticActiveConfig()));
    expect(projectPhoneNavOrder('active', projected.NAV_TABS, false)).toEqual(['home', 'media']);
    expect(normalizePhoneNavOrder(
      ['songs', 'system', 'energy', 'media', 'home'],
      'active',
      projected.NAV_TABS,
      false,
    )).toEqual(['media', 'home']);

    const libraryOnly = syntheticActiveConfig();
    libraryOnly.enabledModules = ['home', 'library'];
    libraryOnly.mediaTargets = [];
    libraryOnly.navigation = [
      { id: 'start', name: 'Startseite', order: 0, target: { type: 'module', id: 'home' } },
      { id: 'library', name: 'Bibliothek', order: 1, target: { type: 'module', id: 'library' } },
    ];
    const libraryProjection = projectActiveHouseholdData(compileValid(libraryOnly));
    expect(projectPhoneNavOrder('active', libraryProjection.NAV_TABS, false)).toEqual(['home', 'media']);
    expect(initialMediaTarget(libraryProjection.NAV_SCREENS)).toBe('library');

    const phoneSource = readFileSync(new URL('../state/phone-nav-order.svelte.ts', import.meta.url), 'utf8');
    const moreSource = readFileSync(new URL('../components/phone/MoreSheet.svelte', import.meta.url), 'utf8');
    const bottomSource = readFileSync(new URL('../components/phone/PhoneBottomNav.svelte', import.meta.url), 'utf8');
    expect(phoneSource).not.toContain("if (source === 'active') return configured");
    expect(phoneSource).toContain('PHONE_NAV_REORDERABLE = configuredOrder().length > 1');
    expect(moreSource).toContain('{#if PHONE_NAV_REORDERABLE}');
    expect(bottomSource).toContain('{#if phoneNavOrder.order.length > 3}');
  });

  it('publishes concise runtime and shadow diagnostics without blocking an active mismatch', async () => {
    vi.stubGlobal('window', {});
    const start = vi.fn(async () => undefined);
    const result = await bootstrapHouseholdConfigRuntime({
      fetcher: async () => response(syntheticActiveConfig(), 'active'),
      startProductiveApp: start,
    });
    const hmi = (window as unknown as { __hmi: Record<string, any> }).__hmi;

    expect(start).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ mode: 'active', status: 'active', parity: 'mismatch' });
    expect(hmi.householdConfigRuntime).toMatchObject({ mode: 'active', status: 'active', parity: 'mismatch' });
    expect(hmi.householdConfigShadow.status).toBe('mismatch');
    expect(JSON.stringify(hmi.householdConfigRuntime)).not.toContain('light.studio_ceiling');
  });

  it('keeps the complete productive pre-paint source graph minimal and locally navigable', () => {
    const mainUrl = new URL('../../main.ts', import.meta.url);
    const source = readFileSync(mainUrl, 'utf8');
    const appSource = readFileSync(new URL('../../App.svelte', import.meta.url), 'utf8');
    const startupSource = readFileSync(new URL('../state/startup-background.ts', import.meta.url), 'utf8');
    const appRoot = new URL('../../../', import.meta.url).pathname;
    const prePaintGraph = collectProductivePrePaintSourceGraph(mainUrl.pathname);
    const relativeGraph = [...prePaintGraph]
      .map((path) => relative(appRoot, path).replaceAll('\\', '/'))
      .sort();
    const expectedGraph = [
      'config/households/current-v1.json',
      'src/lib/config/household-config-compiler.ts',
      'src/lib/config/household-config-runtime.ts',
      'src/lib/config/household-config-schema.ts',
      'src/lib/config/household-config-shadow.ts',
      'src/lib/config/household-config.ts',
      'src/lib/config/household-runtime-data.ts',
      'src/lib/config/legacy-household-config.ts',
      'src/lib/config/legacy-household-data.ts',
      'src/lib/demo/demo-mode.ts',
      'src/lib/shells/MinimalAppShell.svelte',
      'src/lib/shells/minimal-shell-loader.ts',
      'src/lib/shells/minimal-shell-navigation.ts',
      'src/main.ts',
    ];

    expect(relativeGraph).toEqual(expectedGraph);
    expect(relativeGraph.filter((path) => (
      path === 'src/App.svelte'
      || path === 'src/lib/adapter/runtime.svelte.ts'
      || path === 'src/lib/adapter/ha-backend.ts'
      || path.startsWith('src/lib/state/')
    ))).toEqual([]);
    expect(source).not.toMatch(/^import .*App\.svelte/m);
    expect(source).not.toMatch(/^import .*adapter\/runtime/m);
    expect(source).not.toMatch(/^import .*lib\/state\//m);
    expect(source).not.toContain('initTheme()');
    expect(appSource.match(/\binitTheme\(\)/g)).toHaveLength(1);
    expect(source).not.toContain('bootstrapSharedConfig()');
    expect(source).toContain("import('./App.svelte')");
    expect(source).toContain('bootstrapHouseholdConfigFirstPaint');
    expect(source).toMatch(/scheduleValidation:\s*afterFirstPaint/);
    expect(source).toContain('mountMinimalShell(document.body)');
    expect(source).toMatch(/result\.status === 'blocked'[\s\S]*?import\('\.\/lib\/shells\/minimal-shell-cache\.ts'\)[\s\S]*?publishMinimalShellConfigStatus\(result\.code\)/);
    expect(source).not.toContain('const initialHealthStatus = await healthStatus()');
    expect(appSource).toContain("import('./lib/state/startup-background.ts')");
    expect(startupSource).toMatch(
      /bootstrapSharedConfigBeforeRuntime\(\(\) => \{[\s\S]*?syncConfiguredBackend\(\);[\s\S]*?syncAuthState\(\);[\s\S]*?runtime\.start\(\);/,
    );
    expect(source).not.toContain('renderHouseholdConfigError');
  });

  it('detects a forbidden productive import from another real pre-paint module', () => {
    const mainUrl = new URL('../../main.ts', import.meta.url);
    const demoUrl = new URL('../demo/demo-mode.ts', import.meta.url);
    const demoSource = readFileSync(demoUrl, 'utf8');
    const poisonedGraph = collectProductivePrePaintSourceGraph(mainUrl.pathname, {
      sourceOverrides: new Map([[
        demoUrl.pathname,
        `${demoSource}\nimport '../adapter/runtime.svelte.ts';\n`,
      ]]),
    });

    expect([...poisonedGraph].some((path) => path.endsWith('/lib/adapter/runtime.svelte.ts'))).toBe(true);
  });

  it('wires productive state consumers to the preinstalled household data source', () => {
    for (const relativePath of [
      '../state/app.svelte.ts',
      '../state/entities.ts',
      '../state/nav.svelte.ts',
      '../state/songs.ts',
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      expect(source).toContain("from '../config/household-runtime-data.ts'");
    }
    const runtimeSource = readFileSync(new URL('../adapter/runtime.svelte.ts', import.meta.url), 'utf8');
    const entitySource = readFileSync(new URL('../state/entities.ts', import.meta.url), 'utf8');
    expect(runtimeSource).toContain('HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds');
    expect(entitySource).not.toContain('`light.${roomId}_${lightId}`');
  });
});
