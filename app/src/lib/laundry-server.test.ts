import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import neutralSmall from '../../config/examples/neutral-small.json';
// @ts-expect-error native .mjs runtime contract
import { createConfigMutationCoordinator, createHmiServer, createLaundryHomeAssistantClient } from '../../server.mjs';

const servers: any[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hauser-laundry-'));
  roots.push(root);
  const staticRoot = join(root, 'dist');
  mkdirSync(staticRoot);
  writeFileSync(join(staticRoot, 'index.html'), '<!doctype html><title>fixture</title>');
  const configPath = join(root, 'config.json');
  const householdConfigPath = join(root, 'household.json');
  writeFileSync(configPath, JSON.stringify({
    'hmi:ha-url': 'http://ha.fixture',
    'hmi:ha-token': 'fixture-token',
  }));
  writeFileSync(householdConfigPath, JSON.stringify(neutralSmall));
  return { root, configPath, householdConfigPath, staticRoot };
}

type Call = { transport: 'rest' | 'ws'; method?: string; path?: string; type?: string; body?: unknown };

class StrictHa {
  calls: Call[] = [];
  writes: string[] = [];
  sourceVersion = 'source-v1';
  failAutomationVerification = false;
  failCleanup = false;
  blueprintPreexisting = false;
  substitutionChanged = false;
  helperCreateResponseLost = false;
  ambiguousHelperReadback = false;
  automationPostResponseLost = false;
  helperVisibleAfterReads = 0;
  helperReadAttempts = 0;
  automationVisibleAfterReads = 0;
  automationReadAttempts = 0;
  powerUnit = 'W';
  automationDeletePolls = 0;
  foreignBlueprintUser = false;
  automationBody: any = null;
  substitutedAutomationBody: any = null;
  loadedAutomationBody: any = null;
  automationConfigId: string | null = null;
  automationEntityId: string | null = null;
  helperCreated = false;
  helperId = 'ha_assigned_helper';
  helperEntityId = 'input_select.ha_assigned_helper';
  helperName: string | null = null;
  helperListOverride: any[] | null = null;
  registryEntries: any[] = [];
  blueprintCreated = false;
  blueprintYaml: string | null = null;
  automationDeleting = false;

  source(entityId: string) {
    if (entityId === 'binary_sensor.fixture_washer') {
      return {
        entity_id: entityId,
        state: 'off',
        attributes: { friendly_name: 'Fixture washer', device_class: 'running' },
      };
    }
    if (entityId === 'sensor.fixture_enum') {
      return {
        entity_id: entityId,
        state: 'idle',
        attributes: { friendly_name: 'Fixture enum', device_class: 'enum', options: ['idle', 'running', 'done'] },
      };
    }
    if (entityId === 'select.fixture_laundry' || entityId === 'input_select.yaml_laundry') {
      return {
        entity_id: entityId,
        state: 'running',
        attributes: { friendly_name: 'Fixture laundry enum', options: ['idle', 'running', 'done'] },
      };
    }
    if (entityId === 'sensor.fixture_dryer_power') {
      return {
        entity_id: entityId,
        state: '1.2',
        attributes: { friendly_name: 'Fixture dryer power', device_class: 'power', unit_of_measurement: this.powerUnit },
      };
    }
    return null;
  }

  clientFactory = (credentials: { baseUrl: string; token: string }) => {
    expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
    return { rest: this.rest, ws: this.ws, close: () => undefined };
  };

  rest = async (method: string, path: string, body?: unknown) => {
    this.calls.push({ transport: 'rest', method, path, body });
    const stateMatch = path.match(/^\/api\/states\/(.+)$/);
    if (method === 'GET' && stateMatch) {
      const entityId = decodeURIComponent(stateMatch[1]);
      const source = this.source(entityId);
      if (source) return { status: 200, body: source };
      if (entityId === this.helperEntityId && this.helperCreated
          && this.helperReadAttempts > this.helperVisibleAfterReads) {
        return { status: 200, body: {
          entity_id: entityId, state: 'idle', attributes: { options: ['idle', 'running', 'done'], editable: true },
        } };
      }
      if (entityId === this.automationEntityId && this.automationBody) {
        return { status: 200, body: { entity_id: entityId, state: 'on', attributes: {} } };
      }
      if (entityId === 'automation.foreign_blueprint_user' && this.foreignBlueprintUser) {
        return { status: 200, body: { entity_id: entityId, state: 'on', attributes: {} } };
      }
      return { status: 404, body: { message: 'not found' } };
    }
    const automationMatch = path.match(/^\/api\/config\/automation\/config\/([a-z0-9_]+)$/);
    if (automationMatch && method === 'GET') {
      this.automationReadAttempts += 1;
      if (this.automationDeleting && this.automationDeletePolls > 0) {
        this.automationDeletePolls -= 1;
      } else if (this.automationDeleting) {
        this.automationBody = null;
        this.automationEntityId = null;
        this.automationConfigId = null;
        this.automationDeleting = false;
      }
      return this.automationBody && this.automationReadAttempts > this.automationVisibleAfterReads
        ? { status: 200, body: this.automationBody }
        : { status: 404, body: { message: 'not found' } };
    }
    if (automationMatch && method === 'POST') {
      this.writes.push(`automation:create:${automationMatch[1]}`);
      this.automationReadAttempts = 0;
      this.automationBody = body;
      this.loadedAutomationBody = {
        ...this.substitutedAutomationBody,
        id: automationMatch[1],
        alias: (body as any).alias,
        description: (body as any).description,
      };
      this.automationConfigId = automationMatch[1];
      this.automationEntityId ??= `automation.${automationMatch[1]}`;
      if (this.automationPostResponseLost) throw new Error('response lost after automation write');
      return { status: 200, body: { result: 'ok' } };
    }
    if (automationMatch && method === 'DELETE') {
      this.writes.push(`automation:delete:${automationMatch[1]}`);
      if (this.failCleanup) throw new Error('cleanup failed');
      this.automationDeleting = true;
      if (this.automationDeletePolls === 0) {
        this.automationBody = null;
        this.automationEntityId = null;
        this.automationConfigId = null;
        this.automationDeleting = false;
      }
      return { status: 200, body: { result: 'ok' } };
    }
    throw new Error(`unexpected REST ${method} ${path}`);
  };

  ws = async (type: string, body: any = {}) => {
    this.calls.push({ transport: 'ws', type, body });
    if (type === 'config/entity_registry/get') {
      if (body.entity_id === 'input_select.yaml_laundry') {
        throw new Error('entity is not registered');
      }
      const source = this.source(body.entity_id);
      if (!source) throw new Error(`unknown registry entity ${body.entity_id}`);
      return {
        entity_id: body.entity_id,
        unique_id: `${this.sourceVersion}:${body.entity_id}`,
        platform: 'fixture',
        config_entry_id: 'fixture-entry',
        device_id: 'fixture-device',
        disabled_by: null,
      };
    }
    if (type === 'blueprint/list' && body.domain === 'automation') {
      return this.blueprintPreexisting || this.blueprintYaml !== null
        ? { 'hauser/laundry-power-cycle-v1.yaml': { name: 'existing' } } : {};
    }
    if (type === 'input_select/list' && Object.keys(body).length === 0) {
      this.helperReadAttempts += 1;
      if (this.helperListOverride) return this.helperListOverride;
      if (this.ambiguousHelperReadback && this.helperCreated) return [{
        id: 'foreign_helper', name: this.helperName, options: ['foreign'], initial: 'foreign',
      }];
      return this.helperCreated && this.helperReadAttempts > this.helperVisibleAfterReads ? [{
        id: this.helperId,
        name: this.helperName,
        options: ['idle', 'running', 'done'],
        initial: null,
      }] : [];
    }
    if (type === 'blueprint/save' && body.domain === 'automation'
        && body.path === 'hauser/laundry-power-cycle-v1.yaml' && body.allow_override === false
        && typeof body.yaml === 'string' && body.yaml.includes('SPDX-License-Identifier: MIT')) {
      this.blueprintCreated = true;
      this.blueprintYaml = body.yaml;
      this.writes.push('blueprint:create');
      return null;
    }
    if (type === 'blueprint/substitute' && body.domain === 'automation'
        && body.path === 'hauser/laundry-power-cycle-v1.yaml') {
      this.substitutedAutomationBody = {
        triggers: [
          { trigger: 'numeric_state', entity_id: body.input.power_sensor, above: body.input.start_threshold,
            for: { seconds: body.input.start_hold_seconds }, id: 'running' },
          { trigger: 'numeric_state', entity_id: body.input.power_sensor, below: body.input.end_threshold,
            for: { seconds: body.input.end_hold_seconds }, id: 'done' },
        ],
        actions: [{ choose: [
          {
            conditions: [{ condition: 'trigger', id: ['running'] }],
            sequence: [{
              action: 'input_select.select_option',
              target: { entity_id: body.input.state_helper },
              data: { option: 'running' },
            }],
          },
          {
            conditions: [
              { condition: 'trigger', id: ['done'] },
              { condition: 'state', entity_id: body.input.state_helper, state: 'running' },
            ],
            sequence: [{
              action: 'input_select.select_option',
              target: { entity_id: body.input.state_helper },
              data: { option: this.substitutionChanged ? 'idle' : 'done' },
            }],
          },
        ] }],
        mode: 'restart',
      };
      return { substituted_config: this.substitutedAutomationBody };
    }
    if (type === 'input_select/create' && !Object.hasOwn(body, 'id') && !Object.hasOwn(body, 'entity_id')
        && !Object.hasOwn(body, 'initial') && body.options?.join(',') === 'idle,running,done') {
      this.helperCreated = true;
      this.helperReadAttempts = 0;
      this.helperName = body.name;
      this.writes.push('helper:create');
      if (this.helperCreateResponseLost) throw new Error('response lost after helper write');
      return { id: this.helperId };
    }
    if (type === 'config/entity_registry/list' && Object.keys(body).length === 0) {
      return [
        ...this.registryEntries,
        ...(this.helperCreated && this.helperReadAttempts > this.helperVisibleAfterReads ? [{
          entity_id: this.helperEntityId,
          unique_id: this.helperId,
          platform: 'input_select',
          disabled_by: null,
        }] : []),
        ...(this.automationBody && this.automationConfigId && this.automationEntityId
          && this.automationReadAttempts > this.automationVisibleAfterReads ? [{
          entity_id: this.automationEntityId,
          unique_id: this.automationConfigId,
          platform: 'automation',
          disabled_by: null,
        }] : []),
        ...(this.foreignBlueprintUser ? [{
          entity_id: 'automation.foreign_blueprint_user',
          unique_id: 'foreign_blueprint_user',
          platform: 'automation',
          disabled_by: null,
        }] : []),
      ];
    }
    if (type === 'input_select/delete' && body.input_select_id === this.helperId) {
      this.writes.push('helper:delete');
      if (this.failCleanup) throw new Error('cleanup failed');
      this.helperCreated = false;
      return null;
    }
    if (type === 'automation/config') {
      if (body.entity_id === this.automationEntityId && this.automationBody) {
        return { config: this.failAutomationVerification ? { alias: 'wrong' } : this.loadedAutomationBody };
      }
      if (body.entity_id === 'automation.foreign_blueprint_user' && this.foreignBlueprintUser) {
        return { config: { alias: 'Foreign blueprint user', use_blueprint: {
          path: 'hauser/laundry-power-cycle-v1.yaml', input: {},
        } } };
      }
      throw new Error(`unknown automation ${body.entity_id}`);
    }
    if (type === 'blueprint/delete' && body.domain === 'automation'
        && body.path === 'hauser/laundry-power-cycle-v1.yaml') {
      this.writes.push('blueprint:delete');
      if (this.failCleanup) throw new Error('cleanup failed');
      this.blueprintCreated = false;
      this.blueprintYaml = null;
      return null;
    }
    throw new Error(`unexpected WS ${type} ${JSON.stringify(body)}`);
  };
}

async function start(ha: StrictHa, options: Record<string, unknown> = {}) {
  const paths = fixture();
  const server = createHmiServer('', {
    ...paths,
    householdConfigMode: 'active',
    householdConfigMigrationResult: { ok: true, status: 'current' },
    allowedOrigins: new Set(['http://client.fixture']),
    paperlessPin: '',
    paperlessToken: '',
    laundryClientFactory: ha.clientFactory,
    laundrySleep: async () => undefined,
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { ...paths, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

function post(base: string, path: string, body: unknown, origin = 'http://client.fixture', contentType = 'application/json') {
  return fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': contentType, origin }, body: JSON.stringify(body),
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function reconfigurePreconditionHeaders(base: string) {
  const [household, shared] = await Promise.all([
    fetch(`${base}/api/household-config`),
    fetch(`${base}/api/config`),
  ]);
  expect(household.status).toBe(200);
  expect(shared.status).toBe(200);
  await Promise.all([household.arrayBuffer(), shared.arrayBuffer()]);
  const householdEtag = household.headers.get('etag');
  const sharedEtag = shared.headers.get('etag');
  expect(householdEtag).toMatch(/^"[0-9a-f]{64}"$/);
  expect(sharedEtag).toMatch(/^"[0-9a-f]{64}"$/);
  if (householdEtag === null || sharedEtag === null) throw new Error('strong config ETags missing');
  return {
    'if-match': householdEtag,
    'x-hauser-shared-config-if-match': sharedEtag,
  };
}

const existingBody = {
  device: 'washer', entityId: 'binary_sensor.fixture_washer',
  runningStates: ['on'], doneStates: ['off'], doneOnInitial: false,
};
const blueprintBody = {
  device: 'dryer', powerSensorEntityId: 'sensor.fixture_dryer_power',
  startThreshold: 8, endThreshold: 3, startHoldSeconds: 20, endHoldSeconds: 60,
};

async function preview(app: { base: string }) {
  const response = await post(app.base, '/api/laundry/blueprint/preview', blueprintBody);
  expect(response.status).toBe(200);
  return response.json();
}

function typedHousehold() {
  const document = structuredClone(neutralSmall) as any;
  document.globalEntities.laundry = {
    washer: {
      type: 'entity', entityId: 'input_boolean.washer_running',
      runningStates: ['on'], doneStates: ['off'], doneOnInitial: false,
    },
    dryer: {
      type: 'entity', entityId: 'input_boolean.dryer_running',
      runningStates: ['on'], doneStates: ['off'], doneOnInitial: false,
    },
  };
  return document;
}

function parseBlueprintChooseConditions(source: string) {
  const lines = source.split(/\r?\n/).map((raw) => ({
    indent: raw.match(/^ */)?.[0].length ?? 0,
    text: raw.trim(),
  })).filter((line) => line.text && !line.text.startsWith('#'));
  const actions = lines.findIndex((line) => line.indent === 0 && line.text === 'actions:');
  if (actions < 0) throw new Error('actions mapping missing');
  const branches: Array<Array<Record<string, string | string[]>>> = [];
  for (let index = actions + 1; index < lines.length && lines[index].indent > 0; index += 1) {
    if (lines[index].indent !== 6 || lines[index].text !== '- conditions:') continue;
    const conditions: Array<Record<string, string | string[]>> = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.indent <= 6 || (line.indent === 8 && line.text === 'sequence:')) {
        index -= 1;
        break;
      }
      const condition = line.indent === 10 ? line.text.match(/^- condition: (.+)$/)?.[1] : null;
      if (!condition) continue;
      const entry: Record<string, string | string[]> = { condition };
      for (index += 1; index < lines.length; index += 1) {
        const field = lines[index];
        if (field.indent <= 10) {
          index -= 1;
          break;
        }
        const scalar = field.indent === 12 ? field.text.match(/^([a-z_]+):(?: (.+))?$/) : null;
        if (!scalar) {
          const item = field.indent === 14 ? field.text.match(/^- (.+)$/)?.[1] : null;
          if (item && Array.isArray(entry.id)) entry.id.push(item);
          continue;
        }
        if (scalar[1] === 'id' && scalar[2] === undefined) entry.id = [];
        else if (scalar[2] !== undefined) entry[scalar[1]] = scalar[2];
      }
      conditions.push(entry);
    }
    branches.push(conditions);
  }
  return branches;
}

function controlledMutationCoordinator() {
  let tail = Promise.resolve<unknown>(undefined);
  let calls = 0;
  let releaseFirst!: () => void;
  let firstEntered!: () => void;
  let secondQueued!: () => void;
  const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const entered = new Promise<void>((resolve) => { firstEntered = resolve; });
  const queued = new Promise<void>((resolve) => { secondQueued = resolve; });
  return {
    entered,
    queued,
    release: releaseFirst,
    coordinator: {
      run<T>(operation: () => T | Promise<T>) {
        calls += 1;
        const position = calls;
        if (position === 2) secondQueued();
        const turn = tail.then(async () => {
          if (position === 1) {
            firstEntered();
            await release;
          }
          return operation();
        });
        tail = turn.catch(() => undefined);
        return turn;
      },
      runSync<T>(operation: () => T) { return operation(); },
    },
  };
}

describe('portable laundry server boundary', () => {
  it('requires a structured running helper state before the done action can run', () => {
    const yaml = readFileSync(new URL('../../public/blueprints/automation/laundry-power-cycle-v1.yaml', import.meta.url), 'utf8');
    const branches = parseBlueprintChooseConditions(yaml);
    expect(branches).toEqual([
      [{ condition: 'trigger', id: ['running'] }],
      [
        { condition: 'trigger', id: ['done'] },
        { condition: 'state', entity_id: '!input state_helper', state: 'running' },
      ],
    ]);
    const doneBranch = branches[1];
    const mayComplete = (trigger: string, helperState: string) => doneBranch.every((condition) => (
      condition.condition === 'trigger' ? condition.id?.includes(trigger) : condition.state === helperState
    ));
    expect(mayComplete('done', 'idle')).toBe(false);
    expect(mayComplete('done', 'running')).toBe(true);
  });

  it('runs queued config mutations in fair FIFO order without overlap', async () => {
    const coordinator = createConfigMutationCoordinator();
    const order: string[] = [];
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const firstEntered = new Promise<void>((resolve) => { entered = resolve; });
    const first = coordinator.run(async () => {
      order.push('first:start');
      entered();
      await barrier;
      order.push('first:end');
    });
    const second = coordinator.run(() => { order.push('second'); });
    await firstEntered;
    expect(order).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('closes origin, method, media type, body size and object schemas', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    expect((await fetch(`${app.base}/api/laundry/existing/validate`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.fixture' }, body: '{}',
    })).status).toBe(403);
    expect((await fetch(`${app.base}/api/laundry/existing/validate`, {
      method: 'GET', headers: { origin: 'http://client.fixture' },
    })).status).toBe(405);
    expect((await post(app.base, '/api/laundry/existing/validate', existingBody, 'http://client.fixture', 'text/plain')).status).toBe(415);
    expect((await fetch(`${app.base}/api/laundry/existing/validate`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://client.fixture' }, body: `{"padding":"${'x'.repeat(17_000)}"}`,
    })).status).toBe(413);
    expect((await post(app.base, '/api/laundry/existing/validate', { ...existingBody, haToken: 'browser-secret' })).status).toBe(400);
    expect((await post(app.base, '/api/laundry/disable/preview', { device: 'washer', extra: true })).status).toBe(400);
    expect((await post(app.base, '/api/laundry/disable/apply', { previewId: 'x'.repeat(43), confirmed: false })).status).toBe(400);
    expect(ha.calls).toHaveLength(0);
  });

  it('validates then applies an existing binary source using HA reads only and an atomic final rename', async () => {
    const ha = new StrictHa();
    const activation: string[] = [];
    const app = await start(ha, { laundryReplaceConfig: (source: string, target: string) => {
      activation.push('rename');
      renameSync(source, target);
    } });
    const before = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    const validatedResponse = await post(app.base, '/api/laundry/existing/validate', existingBody);
    expect(validatedResponse.status).toBe(200);
    const validated = await validatedResponse.json();
    expect(validated.validationId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(validated)).not.toMatch(/fixture-token|http:\/\/ha\.fixture|credential|haIdentity/i);
    expect(readFileSync(app.householdConfigPath, 'utf8')).toBe(JSON.stringify(neutralSmall));

    const applied = await post(app.base, '/api/laundry/existing/apply', { validationId: validated.validationId, confirmed: true });
    expect(applied.status).toBe(200);
    expect(activation).toEqual(['rename']);
    expect(ha.writes).toEqual([]);
    expect(ha.calls.map((call) => call.transport === 'rest' ? `${call.method} ${call.path}` : call.type)).toEqual([
      'GET /api/states/binary_sensor.fixture_washer', 'config/entity_registry/get',
      'GET /api/states/binary_sensor.fixture_washer', 'config/entity_registry/get',
    ]);
    const stored = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    expect(stored.globalEntities.laundry.washer).toEqual({
      type: 'entity', entityId: 'binary_sensor.fixture_washer',
      runningStates: ['on'], doneStates: ['off'], doneOnInitial: false,
    });
    expect(stored.globalEntities.laundry.dryer).toEqual(before.globalEntities.laundry.dryer);
    expect(statSync(app.householdConfigPath).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(stored)).not.toContain('fixture-token');
    const replay = await post(app.base, '/api/laundry/existing/apply', { validationId: validated.validationId, confirmed: true });
    expect(replay.status).toBe(409);
  });

  it('releases the global coordinator during slow Existing HA I/O, reserves the target and rejects final commit after Shared drift', async () => {
    const ha = new StrictHa();
    const entered = deferred();
    const release = deferred();
    let sourceReads = 0;
    const originalRest = ha.rest;
    ha.rest = async (...args: Parameters<typeof originalRest>) => {
      if (args[0] === 'GET' && args[1] === '/api/states/binary_sensor.fixture_washer') {
        sourceReads += 1;
        if (sourceReads === 3) {
          entered.resolve();
          await release.promise;
        }
      }
      return originalRest(...args);
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const app = await start(ha);
    const first = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const second = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const householdBefore = readFileSync(app.householdConfigPath);
    const apply = post(app.base, '/api/laundry/existing/apply', { validationId: first.validationId, confirmed: true });
    await entered.promise;

    const competingLaundry = await post(app.base, '/api/laundry/existing/apply', {
      validationId: second.validationId, confirmed: true,
    });
    expect(competingLaundry.status).toBe(409);
    expect((await competingLaundry.json()).code).toBe('LAUNDRY_TARGET_RESERVED');

    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    await shared.arrayBuffer();
    const sharedWinner = await fetch(`${app.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://client.fixture', 'if-match': sharedEtag },
      body: JSON.stringify({ updates: { 'hmi:lock-button': 'visible' } }),
    });
    expect(sharedWinner.status).toBe(200);
    release.resolve();

    const response = await apply;
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('LAUNDRY_CONFIG_CHANGED');
    expect(readFileSync(app.householdConfigPath)).toEqual(householdBefore);
    expect(JSON.parse(readFileSync(app.configPath, 'utf8'))['hmi:lock-button']).toBe('visible');

    const retry = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    expect((await post(app.base, '/api/laundry/existing/apply', {
      validationId: retry.validationId, confirmed: true,
    })).status).toBe(200);
  });

  it('lets a Dryer apply reach external HA I/O while a Washer target reservation is blocked', async () => {
    const ha = new StrictHa();
    const washerEntered = deferred();
    const releaseWasher = deferred();
    const dryerEntered = deferred();
    const releaseDryer = deferred();
    const sourceReads = new Map<string, number>();
    const originalRest = ha.rest;
    ha.rest = async (...args: Parameters<typeof originalRest>) => {
      if (args[0] === 'GET' && ['/api/states/binary_sensor.fixture_washer', '/api/states/select.fixture_laundry'].includes(args[1])) {
        const reads = (sourceReads.get(args[1]) ?? 0) + 1;
        sourceReads.set(args[1], reads);
        if (args[1] === '/api/states/binary_sensor.fixture_washer' && reads === 2) {
          washerEntered.resolve();
          await releaseWasher.promise;
        }
        if (args[1] === '/api/states/select.fixture_laundry' && reads === 2) {
          dryerEntered.resolve();
          await releaseDryer.promise;
        }
      }
      return originalRest(...args);
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const commits: Array<{ washer: string | null; dryer: string | null }> = [];
    const app = await start(ha, { laundryReplaceConfig: (source: string, target: string) => {
      const laundry = JSON.parse(readFileSync(source, 'utf8')).globalEntities.laundry;
      commits.push({
        washer: laundry.washer?.entityId ?? null,
        dryer: laundry.dryer?.entityId ?? null,
      });
      renameSync(source, target);
    } });
    const dryerBody = {
      device: 'dryer', entityId: 'select.fixture_laundry',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
    };
    const washerValidation = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const dryerValidation = await (await post(app.base, '/api/laundry/existing/validate', dryerBody)).json();

    const washerApply = post(app.base, '/api/laundry/existing/apply', {
      validationId: washerValidation.validationId, confirmed: true,
    });
    await washerEntered.promise;
    const dryerApply = post(app.base, '/api/laundry/existing/apply', {
      validationId: dryerValidation.validationId, confirmed: true,
    });
    await dryerEntered.promise;
    expect(commits).toEqual([]);

    releaseDryer.resolve();
    const dryerResponse = await dryerApply;
    expect(dryerResponse.status).toBe(200);
    expect((await dryerResponse.json()).device).toBe('dryer');
    expect(commits).toEqual([{
      washer: 'input_boolean.washer_running', dryer: 'select.fixture_laundry',
    }]);

    releaseWasher.resolve();
    const washerResponse = await washerApply;
    expect(washerResponse.status).toBe(409);
    expect((await washerResponse.json()).code).toBe('LAUNDRY_CONFIG_CHANGED');
    expect(commits).toEqual([{
      washer: 'input_boolean.washer_running', dryer: 'select.fixture_laundry',
    }]);

    const retry = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    expect((await post(app.base, '/api/laundry/existing/apply', {
      validationId: retry.validationId, confirmed: true,
    })).status).toBe(200);
    expect(commits).toEqual([
      { washer: 'input_boolean.washer_running', dryer: 'select.fixture_laundry' },
      { washer: 'binary_sensor.fixture_washer', dryer: 'select.fixture_laundry' },
    ]);

    const dryerCleanupProbe = await (await post(app.base, '/api/laundry/existing/validate', dryerBody)).json();
    ha.sourceVersion = 'source-v2';
    const dryerCleanupResponse = await post(app.base, '/api/laundry/existing/apply', {
      validationId: dryerCleanupProbe.validationId, confirmed: true,
    });
    expect(dryerCleanupResponse.status).toBe(409);
    expect((await dryerCleanupResponse.json()).code).toBe('LAUNDRY_SOURCE_CHANGED');
    expect(commits).toHaveLength(2);
    expect(ha.writes).toEqual([]);
  });

  it('releases the global coordinator and target reservation after a blocked HA failure so local mutation and retry complete', async () => {
    const ha = new StrictHa();
    const entered = deferred();
    const release = deferred();
    let sourceReads = 0;
    let failBlockedRead = true;
    const originalRest = ha.rest;
    ha.rest = async (...args: Parameters<typeof originalRest>) => {
      if (args[0] === 'GET' && args[1] === '/api/states/binary_sensor.fixture_washer') {
        sourceReads += 1;
        if (sourceReads === 3) {
          entered.resolve();
          await release.promise;
          if (failBlockedRead) {
            throw Object.assign(new Error('Home Assistant ist nicht erreichbar.'), {
              code: 'LAUNDRY_HOME_ASSISTANT_UNREACHABLE', status: 502,
            });
          }
        }
      }
      return originalRest(...args);
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const app = await start(ha);
    const first = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const competing = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const apply = post(app.base, '/api/laundry/existing/apply', {
      validationId: first.validationId, confirmed: true,
    });
    await entered.promise;

    const rejected = await post(app.base, '/api/laundry/existing/apply', {
      validationId: competing.validationId, confirmed: true,
    });
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).code).toBe('LAUNDRY_TARGET_RESERVED');

    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    await shared.arrayBuffer();
    const sharedMutation = await fetch(`${app.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://client.fixture', 'if-match': sharedEtag },
      body: JSON.stringify({ updates: { 'hmi:lock-button': 'visible' } }),
    });
    expect(sharedMutation.status).toBe(200);
    release.resolve();

    const failed = await apply;
    expect(failed.status).toBe(502);
    expect((await failed.json()).code).toBe('LAUNDRY_HOME_ASSISTANT_UNREACHABLE');
    failBlockedRead = false;
    const retry = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    expect((await post(app.base, '/api/laundry/existing/apply', {
      validationId: retry.validationId, confirmed: true,
    })).status).toBe(200);
  });

  it('preserves a server-authoritative cycle marker only for an unchanged existing source entity', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const configured = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    configured.globalEntities.laundry.dryer = {
      type: 'entity', entityId: 'input_select.yaml_laundry',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
      cycleMarkerEntityId: 'automation.hauser_dryer_owned_cycle',
    };
    writeFileSync(app.householdConfigPath, JSON.stringify(configured));

    const unchangedResponse = await post(app.base, '/api/laundry/existing/validate', {
      device: 'dryer', entityId: 'input_select.yaml_laundry',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
    });
    expect(unchangedResponse.status).toBe(200);
    const unchanged = await unchangedResponse.json();
    expect(unchanged.adapter.cycleMarkerEntityId).toBe('automation.hauser_dryer_owned_cycle');
    const unchangedApply = await post(app.base, '/api/laundry/existing/apply', {
      validationId: unchanged.validationId, confirmed: true,
    });
    expect(unchangedApply.status).toBe(200);
    expect((await unchangedApply.json()).adapter.cycleMarkerEntityId)
      .toBe('automation.hauser_dryer_owned_cycle');
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).globalEntities.laundry.dryer.cycleMarkerEntityId)
      .toBe('automation.hauser_dryer_owned_cycle');

    const changedResponse = await post(app.base, '/api/laundry/existing/validate', {
      device: 'dryer', entityId: 'select.fixture_laundry',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
    });
    expect(changedResponse.status).toBe(200);
    const changed = await changedResponse.json();
    expect(changed.adapter).not.toHaveProperty('cycleMarkerEntityId');
    const changedApply = await post(app.base, '/api/laundry/existing/apply', {
      validationId: changed.validationId, confirmed: true,
    });
    expect(changedApply.status).toBe(200);
    expect(await changedApply.json()).toMatchObject({ adapter: { entityId: 'select.fixture_laundry' } });
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).globalEntities.laundry.dryer)
      .not.toHaveProperty('cycleMarkerEntityId');
  });

  it('accepts select and live YAML entities without requiring an entity-registry row', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const selected = await post(app.base, '/api/laundry/existing/validate', {
      device: 'washer', entityId: 'select.fixture_laundry',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
    });
    expect(selected.status).toBe(200);

    const yaml = await post(app.base, '/api/laundry/existing/validate', {
      device: 'dryer', entityId: 'input_select.yaml_laundry',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
    });
    expect(yaml.status).toBe(200);
    const validation = await yaml.json();
    expect((await post(app.base, '/api/laundry/existing/apply', {
      validationId: validation.validationId, confirmed: true,
    })).status).toBe(200);
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).globalEntities.laundry.dryer.entityId)
      .toBe('input_select.yaml_laundry');
  });

  it('preserves independent config changes and the other laundry adapter while CAS patches one target leaf', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const validation = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const latest = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    latest.rooms[0].name = 'Changed independently';
    latest.globalEntities.laundry.dryer = {
      type: 'entity', entityId: 'sensor.fixture_enum',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
    };
    writeFileSync(app.householdConfigPath, `${JSON.stringify(latest, null, 2)}\n`);

    const applied = await post(app.base, '/api/laundry/existing/apply', {
      validationId: validation.validationId, confirmed: true,
    });
    expect(applied.status).toBe(200);
    const stored = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    expect(stored.rooms[0].name).toBe('Changed independently');
    expect(stored.globalEntities.laundry.dryer).toEqual(latest.globalEntities.laundry.dryer);
    expect(stored.globalEntities.laundry.washer.entityId).toBe('binary_sensor.fixture_washer');
  });

  it('fails closed for source/config/origin changes, expiry and incompatible enum mappings', async () => {
    let clock = 1_000;
    const ha = new StrictHa();
    const app = await start(ha, { laundryNow: () => clock });
    const first = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    ha.sourceVersion = 'source-v2';
    expect((await post(app.base, '/api/laundry/existing/apply', { validationId: first.validationId, confirmed: true })).status).toBe(409);

    ha.sourceVersion = 'source-v1';
    const second = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const changedTarget = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    changedTarget.globalEntities.laundry.washer = null;
    writeFileSync(app.householdConfigPath, JSON.stringify(changedTarget));
    expect((await post(app.base, '/api/laundry/existing/apply', { validationId: second.validationId, confirmed: true })).status).toBe(409);

    writeFileSync(app.householdConfigPath, JSON.stringify(neutralSmall));
    const third = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    expect((await post(app.base, '/api/laundry/existing/apply', { validationId: third.validationId, confirmed: true }, 'http://other.fixture')).status).toBe(403);
    clock += 121_000;
    const expired = await post(app.base, '/api/laundry/existing/apply', { validationId: third.validationId, confirmed: true });
    expect((await expired.json()).code).toBe('LAUNDRY_SESSION_EXPIRED');

    const badEnum = await post(app.base, '/api/laundry/existing/validate', {
      device: 'washer', entityId: 'sensor.fixture_enum', runningStates: ['active'], doneStates: ['done'], doneOnInitial: true,
    });
    expect(badEnum.status).toBe(422);

    const conflict = await post(app.base, '/api/laundry/existing/validate', {
      ...existingBody, entityId: 'input_boolean.dryer_running',
    });
    expect(conflict.status).toBe(409);

    const missing = await post(app.base, '/api/laundry/existing/validate', {
      ...existingBody, entityId: 'binary_sensor.missing_fixture',
    });
    expect(missing.status).toBe(422);
    const originalSource = ha.source.bind(ha);
    ha.source = (entityId: string) => {
      const source = originalSource(entityId);
      return source ? { ...source, state: 'unavailable' } : null;
    };
    const unavailable = await post(app.base, '/api/laundry/existing/validate', existingBody);
    expect(unavailable.status).toBe(422);
  });

  it('previews and applies a one-shot origin-bound disable with target-only CAS and no HA access', async () => {
    let clock = 10_000;
    const ha = new StrictHa();
    const app = await start(ha, {
      laundryNow: () => clock,
      allowedOrigins: new Set(['http://client.fixture', 'http://other.fixture']),
    });
    const originBound = await (await post(app.base, '/api/laundry/disable/preview', { device: 'washer' })).json();
    expect((await post(app.base, '/api/laundry/disable/apply', {
      previewId: originBound.previewId, confirmed: true,
    }, 'http://other.fixture')).status).toBe(409);
    expect((await post(app.base, '/api/laundry/disable/apply', {
      previewId: originBound.previewId, confirmed: true,
    })).status).toBe(409);

    const response = await post(app.base, '/api/laundry/disable/preview', { device: 'washer' });
    expect(response.status).toBe(200);
    const disable = await response.json();
    expect(disable).toMatchObject({
      ok: true, status: 'preview', device: 'washer',
      adapter: { entityId: 'input_boolean.washer_running' },
    });
    expect(disable.previewId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(ha.calls).toEqual([]);

    const latest = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    latest.rooms[0].name = 'Disable preserves this';
    const dryer = latest.globalEntities.laundry.dryer;
    writeFileSync(app.householdConfigPath, JSON.stringify(latest));
    const applied = await post(app.base, '/api/laundry/disable/apply', {
      previewId: disable.previewId, confirmed: true,
    });
    expect(applied.status).toBe(200);
    const stored = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    expect(stored.rooms[0].name).toBe('Disable preserves this');
    expect(stored.globalEntities.laundry).toEqual({ washer: null, dryer });
    expect(ha.calls).toEqual([]);
    expect((await post(app.base, '/api/laundry/disable/apply', {
      previewId: disable.previewId, confirmed: true,
    })).status).toBe(409);

    const alreadyNull = await (await post(app.base, '/api/laundry/disable/preview', { device: 'washer' })).json();
    expect(alreadyNull.adapter).toBeNull();
    clock += 121_000;
    const expired = await post(app.base, '/api/laundry/disable/apply', {
      previewId: alreadyNull.previewId, confirmed: true,
    });
    expect(expired.status).toBe(409);
    expect((await expired.json()).code).toBe('LAUNDRY_SESSION_EXPIRED');
  });

  it('rejects disable when its target adapter changed but allows idempotent already-null confirmation', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const previewed = await (await post(app.base, '/api/laundry/disable/preview', { device: 'washer' })).json();
    const changed = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    changed.globalEntities.laundry.washer = null;
    writeFileSync(app.householdConfigPath, JSON.stringify(changed));
    const conflict = await post(app.base, '/api/laundry/disable/apply', {
      previewId: previewed.previewId, confirmed: true,
    });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('LAUNDRY_CONFIG_CHANGED');

    const alreadyNull = await (await post(app.base, '/api/laundry/disable/preview', { device: 'washer' })).json();
    expect((await post(app.base, '/api/laundry/disable/apply', {
      previewId: alreadyNull.previewId, confirmed: true,
    })).status).toBe(200);
    expect(JSON.parse(readFileSync(app.householdConfigPath, 'utf8')).globalEntities.laundry.washer).toBeNull();
  });

  it('rejects Existing without touching the replacement HA instance when setup wins the coordinator', async () => {
    const ha = new StrictHa();
    const barrier = controlledMutationCoordinator();
    const app = await start(ha, {
      configMutationCoordinator: barrier.coordinator,
      setupConnectionVerifier: async () => ({ ok: true }),
      setupJellyfinVerifier: async () => ({ ok: true }),
    });
    const initial = typedHousehold();
    writeFileSync(app.householdConfigPath, JSON.stringify(initial));
    const validation = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const preconditionHeaders = await reconfigurePreconditionHeaders(app.base);
    const replacement = structuredClone(initial);
    replacement.rooms[0].name = 'Updated by setup';

    const setupRequest = fetch(`${app.base}/api/setup/activate`, {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://client.fixture', ...preconditionHeaders,
      },
      body: JSON.stringify({
        haUrl: 'http://new-ha.fixture', haToken: 'new-token',
        householdConfig: replacement, jellyfin: { enabled: false },
      }),
    });
    expect(await Promise.race([
      barrier.entered.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ])).toBe(true);
    const laundryRequest = post(app.base, '/api/laundry/existing/apply', {
      validationId: validation.validationId, confirmed: true,
    });
    await barrier.queued;
    expect(ha.calls).toHaveLength(2);
    barrier.release();

    expect((await setupRequest).status).toBe(200);
    const laundryResponse = await laundryRequest;
    expect(laundryResponse.status).toBe(409);
    expect(await laundryResponse.json()).toMatchObject({ code: 'LAUNDRY_CONFIG_CHANGED' });
    const stored = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    expect(stored.rooms[0].name).toBe('Updated by setup');
    expect(stored.globalEntities.laundry.washer).toEqual(initial.globalEntities.laundry.washer);
    expect(stored.globalEntities.laundry.dryer).toEqual(initial.globalEntities.laundry.dryer);
    expect(ha.calls).toHaveLength(2);
  });

  it('lets reconfigure win during slow Existing HA I/O and rejects the stale Laundry CAS without a partial commit', async () => {
    const ha = new StrictHa();
    const entered = deferred();
    const release = deferred();
    let sourceReads = 0;
    const originalRest = ha.rest;
    ha.rest = async (...args: Parameters<typeof originalRest>) => {
      if (args[0] === 'GET' && args[1] === '/api/states/binary_sensor.fixture_washer') {
        sourceReads += 1;
        if (sourceReads === 2) {
          entered.resolve();
          await release.promise;
        }
      }
      return originalRest(...args);
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const app = await start(ha, {
      setupConnectionVerifier: async () => ({ ok: true }),
      setupJellyfinVerifier: async () => ({ ok: true }),
    });
    const initial = typedHousehold();
    writeFileSync(app.householdConfigPath, JSON.stringify(initial));
    const validation = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    const preconditionHeaders = await reconfigurePreconditionHeaders(app.base);
    const replacement = structuredClone(initial);
    replacement.rooms[0].name = 'Reconfigure winner during Existing I/O';
    const laundryRequest = post(app.base, '/api/laundry/existing/apply', {
      validationId: validation.validationId, confirmed: true,
    });
    await entered.promise;

    const setupResponse = await fetch(`${app.base}/api/setup/activate`, {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://client.fixture', ...preconditionHeaders,
      },
      body: JSON.stringify({
        haUrl: 'http://ha.fixture', haToken: 'fixture-token',
        householdConfig: replacement, jellyfin: { enabled: false },
      }),
    });
    expect(setupResponse.status).toBe(200);
    await setupResponse.arrayBuffer();
    const setupHouseholdWinner = readFileSync(app.householdConfigPath);
    const setupSharedWinner = readFileSync(app.configPath);
    expect(JSON.parse(setupHouseholdWinner.toString()).rooms[0].name)
      .toBe('Reconfigure winner during Existing I/O');
    expect(JSON.parse(setupHouseholdWinner.toString()).globalEntities.laundry)
      .toEqual(initial.globalEntities.laundry);

    release.resolve();
    const laundryResponse = await laundryRequest;
    expect(laundryResponse.status).toBe(409);
    expect(await laundryResponse.json()).toMatchObject({ code: 'LAUNDRY_CONFIG_CHANGED' });
    expect(readFileSync(app.householdConfigPath)).toEqual(setupHouseholdWinner);
    expect(readFileSync(app.configPath)).toEqual(setupSharedWinner);

    const retry = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    expect((await post(app.base, '/api/laundry/existing/apply', {
      validationId: retry.validationId, confirmed: true,
    })).status).toBe(200);
  });

  it.each([
    ['URL', { 'hmi:ha-url': 'http://replacement-ha.fixture', 'hmi:ha-token': 'fixture-token' }],
    ['Token', { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'replacement-token' }],
  ])('rejects Existing when the server-side HA %s changed after validation', async (_kind, credentials) => {
    const ha = new StrictHa();
    const app = await start(ha);
    const original = readFileSync(app.householdConfigPath);
    const validation = await (await post(app.base, '/api/laundry/existing/validate', existingBody)).json();
    expect(ha.calls).toHaveLength(2);
    writeFileSync(app.configPath, JSON.stringify(credentials));

    const response = await post(app.base, '/api/laundry/existing/apply', {
      validationId: validation.validationId, confirmed: true,
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({ code: 'LAUNDRY_CONFIG_CHANGED' });
    expect(JSON.stringify(payload)).not.toContain(credentials['hmi:ha-url']);
    expect(JSON.stringify(payload)).not.toContain(credentials['hmi:ha-token']);
    expect(ha.calls).toHaveLength(2);
    expect(ha.writes).toEqual([]);
    expect(readFileSync(app.householdConfigPath)).toEqual(original);
  });

  it('previews without writes and truthfully defers the helper ID to Home Assistant', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const result = await preview(app);
    expect(result).toMatchObject({
      status: 'preview', device: 'dryer',
      blueprint: { path: 'hauser/laundry-power-cycle-v1.yaml' },
      helper: { entityId: null, idAssignedBy: 'home_assistant_during_apply', options: ['idle', 'running', 'done'] },
      inputs: {
        powerSensorEntityId: blueprintBody.powerSensorEntityId,
        startThreshold: blueprintBody.startThreshold,
        endThreshold: blueprintBody.endThreshold,
        startHoldSeconds: blueprintBody.startHoldSeconds,
        endHoldSeconds: blueprintBody.endHoldSeconds,
      },
    });
    expect(result.automation).toMatchObject({
      entityId: null,
      expectedEntityId: `automation.${result.automation.id}`,
      entityIdStatus: 'expected_not_confirmed',
    });
    expect(result.inputs.unitOfMeasurement).toBe('W');
    expect(JSON.stringify(result)).not.toMatch(/fixture-token|http:\/\/ha\.fixture|credential|haIdentity/i);
    expect(ha.writes).toEqual([]);
  });

  it('binds the normalized power unit into preview CAS and blocks a unit change before writes', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const result = await preview(app);
    expect(result.inputs.unitOfMeasurement).toBe('W');
    ha.powerUnit = 'kW';
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('LAUNDRY_SOURCE_CHANGED');
    expect(ha.writes).toEqual([]);
  });

  it.each([
    ['URL', { 'hmi:ha-url': 'http://replacement-ha.fixture', 'hmi:ha-token': 'fixture-token' }],
    ['Token', { 'hmi:ha-url': 'http://ha.fixture', 'hmi:ha-token': 'replacement-token' }],
  ])('rejects Blueprint before the first HA write when the server-side HA %s changed after preview', async (_kind, credentials) => {
    const ha = new StrictHa();
    const app = await start(ha);
    const original = readFileSync(app.householdConfigPath);
    const result = await preview(app);
    const callsAfterPreview = ha.calls.length;
    writeFileSync(app.configPath, JSON.stringify(credentials));

    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toMatchObject({ code: 'LAUNDRY_CONFIG_CHANGED' });
    expect(JSON.stringify(payload)).not.toContain(credentials['hmi:ha-url']);
    expect(JSON.stringify(payload)).not.toContain(credentials['hmi:ha-token']);
    expect(ha.calls).toHaveLength(callsAfterPreview);
    expect(ha.writes).toEqual([]);
    expect(ha.helperCreated).toBe(false);
    expect(ha.automationBody).toBeNull();
    expect(ha.blueprintCreated).toBe(false);
    expect(readFileSync(app.householdConfigPath)).toEqual(original);
  });

  it('lets setup win during slow Blueprint HA I/O, rejects stale local commit and compensates without the global lock', async () => {
    const ha = new StrictHa();
    const helperEntered = deferred();
    const releaseHelper = deferred();
    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    const originalWs = ha.ws;
    const originalRest = ha.rest;
    ha.ws = async (...args: Parameters<typeof originalWs>) => {
      if (args[0] === 'input_select/create') {
        helperEntered.resolve();
        await releaseHelper.promise;
      }
      return originalWs(...args);
    };
    ha.rest = async (...args: Parameters<typeof originalRest>) => {
      if (args[0] === 'DELETE' && args[1].startsWith('/api/config/automation/config/')) {
        cleanupEntered.resolve();
        await releaseCleanup.promise;
      }
      return originalRest(...args);
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const app = await start(ha, {
      setupConnectionVerifier: async () => ({ ok: true }),
      setupJellyfinVerifier: async () => ({ ok: true }),
    });
    const initial = typedHousehold();
    writeFileSync(app.householdConfigPath, JSON.stringify(initial));
    const result = await preview(app);
    const competingResult = await preview(app);
    const preconditionHeaders = await reconfigurePreconditionHeaders(app.base);
    const replacement = structuredClone(initial);
    replacement.rooms[0].name = 'Setup winner during Blueprint I/O';
    const applyRequest = post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    await helperEntered.promise;

    const setupResponse = await fetch(`${app.base}/api/setup/activate`, {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://client.fixture', ...preconditionHeaders,
      },
      body: JSON.stringify({
        haUrl: 'http://ha.fixture', haToken: 'fixture-token',
        householdConfig: replacement, jellyfin: { enabled: false },
      }),
    });
    expect(setupResponse.status).toBe(200);
    await setupResponse.arrayBuffer();
    const setupHouseholdWinner = readFileSync(app.householdConfigPath);
    expect(JSON.parse(setupHouseholdWinner.toString()).rooms[0].name)
      .toBe('Setup winner during Blueprint I/O');
    expect(JSON.parse(setupHouseholdWinner.toString()).globalEntities.laundry)
      .toEqual(initial.globalEntities.laundry);

    releaseHelper.resolve();
    await cleanupEntered.promise;
    expect(ha.writes).toEqual([
      'blueprint:create', 'helper:create', `automation:create:${result.automation.id}`,
    ]);
    const competingApply = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: competingResult.previewId, confirmed: true,
    });
    expect(competingApply.status).toBe(409);
    expect((await competingApply.json()).code).toBe('LAUNDRY_TARGET_RESERVED');
    expect(ha.writes).toEqual([
      'blueprint:create', 'helper:create', `automation:create:${result.automation.id}`,
    ]);

    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    await shared.arrayBuffer();
    const sharedWinnerResponse = await fetch(`${app.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://client.fixture', 'if-match': sharedEtag },
      body: JSON.stringify({ updates: { 'hmi:lock-button': 'visible' } }),
    });
    expect(sharedWinnerResponse.status).toBe(200);
    await sharedWinnerResponse.arrayBuffer();
    const sharedWinner = readFileSync(app.configPath);
    releaseCleanup.resolve();

    const applyResponse = await applyRequest;
    expect(applyResponse.status).toBe(409);
    expect(await applyResponse.json()).toMatchObject({ code: 'LAUNDRY_CONFIG_CHANGED' });
    expect(readFileSync(app.householdConfigPath)).toEqual(setupHouseholdWinner);
    expect(readFileSync(app.configPath)).toEqual(sharedWinner);
    expect(ha.helperCreated).toBe(false);
    expect(ha.automationBody).toBeNull();
    expect(ha.blueprintCreated).toBe(false);
    expect(ha.writes.slice(-3)).toEqual([
      `automation:delete:${result.automation.id}`, 'helper:delete', 'blueprint:delete',
    ]);

    const retry = await preview(app);
    expect((await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: retry.previewId, confirmed: true,
    })).status).toBe(200);
  });

  it('lets reconfigure finish during a failing Blueprint operation and preserves its bytes through rollback', async () => {
    const ha = new StrictHa();
    ha.failAutomationVerification = true;
    const helperEntered = deferred();
    const releaseHelper = deferred();
    const originalWs = ha.ws;
    ha.ws = async (...args: Parameters<typeof originalWs>) => {
      if (args[0] === 'input_select/create') {
        helperEntered.resolve();
        await releaseHelper.promise;
      }
      return originalWs(...args);
    };
    const app = await start(ha, {
      setupConnectionVerifier: async () => ({ ok: true }),
      setupJellyfinVerifier: async () => ({ ok: true }),
    });
    const initial = typedHousehold();
    writeFileSync(app.householdConfigPath, JSON.stringify(initial));
    const result = await preview(app);
    const preconditionHeaders = await reconfigurePreconditionHeaders(app.base);
    const replacement = structuredClone(initial);
    replacement.rooms[0].name = 'Reconfigured before rollback';
    const applyRequest = post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    await helperEntered.promise;

    const setupResponse = await fetch(`${app.base}/api/setup/activate`, {
      method: 'POST', headers: {
        'content-type': 'application/json', origin: 'http://client.fixture', ...preconditionHeaders,
      },
      body: JSON.stringify({
        haUrl: 'http://ha.fixture', haToken: 'fixture-token',
        householdConfig: replacement, jellyfin: { enabled: false },
      }),
    });
    expect(setupResponse.status).toBe(200);
    await setupResponse.arrayBuffer();
    const setupHouseholdWinner = readFileSync(app.householdConfigPath);
    const setupSharedWinner = readFileSync(app.configPath);
    releaseHelper.resolve();

    expect((await applyRequest).status).toBe(502);
    expect(readFileSync(app.householdConfigPath)).toEqual(setupHouseholdWinner);
    expect(readFileSync(app.configPath)).toEqual(setupSharedWinner);
    const stored = JSON.parse(setupHouseholdWinner.toString());
    expect(stored.rooms[0].name).toBe('Reconfigured before rollback');
    expect(stored.globalEntities.laundry).toEqual(initial.globalEntities.laundry);
    expect(ha.helperCreated).toBe(false);
    expect(ha.automationBody).toBeNull();
    expect(ha.blueprintCreated).toBe(false);
    expect(ha.writes.slice(-3)).toEqual([
      `automation:delete:${result.automation.id}`, 'helper:delete', 'blueprint:delete',
    ]);
  });

  it('blocks a foreign expected automation entity or registry collision before the first mutation', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const result = await preview(app);
    ha.registryEntries = [{
      entity_id: result.automation.expectedEntityId,
      unique_id: 'foreign-automation',
      platform: 'automation',
      disabled_by: null,
    }];
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('LAUNDRY_TARGET_CONFLICT');
    expect(ha.writes).toEqual([]);
  });

  it('resolves and returns an owned HA-suffixed automation entity instead of accepting the expected ID', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const result = await preview(app);
    ha.automationEntityId = `${result.automation.expectedEntityId}_2`;
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).automation).toEqual({
      id: result.automation.id,
      entityId: `${result.automation.expectedEntityId}_2`,
    });
  });

  it('recovers a response-lost helper by name, options and registry, then cleans it after a later failure', async () => {
    const ha = new StrictHa();
    ha.helperCreateResponseLost = true;
    ha.failAutomationVerification = true;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(502);
    expect(ha.writes).toContain('helper:delete');
    expect(ha.writes).toContain(`automation:delete:${result.automation.id}`);
  });

  it('continues after a response-lost automation POST when config and registry prove ownership', async () => {
    const ha = new StrictHa();
    ha.automationPostResponseLost = true;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).automation.entityId).toBe(result.automation.expectedEntityId);
    expect(ha.writes).not.toContain(`automation:delete:${result.automation.id}`);
  });

  it('polls initially absent response-lost writes until delayed HA readback proves ownership', async () => {
    const ha = new StrictHa();
    ha.helperCreateResponseLost = true;
    ha.helperVisibleAfterReads = 2;
    ha.automationPostResponseLost = true;
    ha.automationVisibleAfterReads = 2;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(200);
    expect(ha.helperReadAttempts).toBeGreaterThan(2);
    expect(ha.automationReadAttempts).toBeGreaterThan(2);
    expect(ha.writes).not.toContain('helper:delete');
    expect(ha.writes).not.toContain(`automation:delete:${result.automation.id}`);
  });

  it('does not delete an ambiguous or foreign helper readback after a response-lost create', async () => {
    const ha = new StrictHa();
    ha.helperCreateResponseLost = true;
    ha.ambiguousHelperReadback = true;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'LAUNDRY_OUTCOME_UNKNOWN', status: 'outcome_unknown',
    });
    expect(ha.writes).not.toContain('helper:delete');
  });

  it('applies via official 2026.6 WS/REST APIs, uses HA returned helper ID, verifies async and renames household last', async () => {
    const ha = new StrictHa();
    const order: string[] = [];
    const originalRest = ha.rest;
    const originalWs = ha.ws;
    ha.rest = async (...args: Parameters<typeof originalRest>) => {
      const result = await originalRest(...args);
      if (args[0] === 'POST') order.push('automation');
      return result;
    };
    ha.ws = async (...args: Parameters<typeof originalWs>) => {
      const result = await originalWs(...args);
      if (args[0] === 'blueprint/save') order.push('blueprint');
      if (args[0] === 'input_select/create') order.push('helper');
      return result;
    };
    ha.clientFactory = (credentials) => {
      expect(credentials.token).toBe('fixture-token');
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const app = await start(ha, { laundryReplaceConfig: (source: string, target: string) => {
      order.push('rename');
      renameSync(source, target);
    } });
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', { previewId: result.previewId, confirmed: true });
    expect(response.status).toBe(200);
    const applied = await response.json();
    expect(applied.helper).toEqual({ id: 'ha_assigned_helper', entityId: 'input_select.ha_assigned_helper' });
    expect(order).toEqual(['blueprint', 'helper', 'automation', 'rename']);
    expect(ha.calls.filter((call) => call.transport === 'ws').map((call) => call.type)).toEqual([
      'config/entity_registry/get',
      'config/entity_registry/get',
      'blueprint/list', 'input_select/list', 'config/entity_registry/list',
      'blueprint/save', 'blueprint/substitute', 'input_select/create', 'input_select/list',
      'config/entity_registry/list', 'blueprint/substitute',
      'config/entity_registry/list', 'automation/config',
    ]);
    expect(ha.calls.slice(2).map((call) => call.transport === 'rest'
      ? `${call.method} ${call.path}` : `WS ${call.type}`)).toEqual([
      'GET /api/states/sensor.fixture_dryer_power',
      'WS config/entity_registry/get',
      'WS blueprint/list',
      'WS input_select/list',
      'WS config/entity_registry/list',
      `GET /api/config/automation/config/${result.automation.id}`,
      `GET /api/states/${result.automation.expectedEntityId}`,
      `GET /api/states/input_select.${result.automation.id}`,
      'WS blueprint/save',
      'WS blueprint/substitute',
      'WS input_select/create',
      'WS input_select/list',
      'WS config/entity_registry/list',
      'GET /api/states/input_select.ha_assigned_helper',
      'WS blueprint/substitute',
      `POST /api/config/automation/config/${result.automation.id}`,
      `GET /api/config/automation/config/${result.automation.id}`,
      'WS config/entity_registry/list',
      `GET /api/states/${result.automation.expectedEntityId}`,
      'WS automation/config',
    ]);
    expect(ha.calls.some((call) => call.path?.startsWith('/api/config/blueprint/import'))).toBe(false);
    expect(ha.calls.some((call) => call.path === '/api/config/input_select/config')).toBe(false);
    expect(ha.automationBody.use_blueprint.input.state_helper).toBe('input_select.ha_assigned_helper');
    const helperCreate = ha.calls.find((call) => call.transport === 'ws' && call.type === 'input_select/create');
    expect(helperCreate?.body).not.toHaveProperty('initial');
    const stored = JSON.parse(readFileSync(app.householdConfigPath, 'utf8'));
    expect(stored.globalEntities.laundry.dryer).toEqual({
      type: 'entity', entityId: 'input_select.ha_assigned_helper',
      runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
      cycleMarkerEntityId: applied.automation.entityId,
    });
    expect(statSync(app.householdConfigPath).mode & 0o777).toBe(0o600);
  });

  it('rejects false confirmation without consuming the preview or writing', async () => {
    const ha = new StrictHa();
    const app = await start(ha);
    const result = await preview(app);
    const cancelled = await post(app.base, '/api/laundry/blueprint/apply', { previewId: result.previewId, confirmed: false });
    expect(cancelled.status).toBe(400);
    expect(ha.writes).toEqual([]);
    expect((await post(app.base, '/api/laundry/blueprint/apply', { previewId: result.previewId, confirmed: true })).status).toBe(200);
  });

  it('rolls automation, helper and newly saved blueprint back in reverse order on verification failure', async () => {
    const ha = new StrictHa();
    ha.failAutomationVerification = true;
    const app = await start(ha);
    const original = readFileSync(app.householdConfigPath);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', { previewId: result.previewId, confirmed: true });
    expect(response.status).toBe(502);
    expect(ha.writes.slice(-3)).toEqual([
      `automation:delete:${result.automation.id}`, 'helper:delete', 'blueprint:delete',
    ]);
    expect(readFileSync(app.householdConfigPath)).toEqual(original);
  });

  it('polls automation absence before helper cleanup and retains a newly saved blueprint while another automation uses it', async () => {
    const ha = new StrictHa();
    ha.failAutomationVerification = true;
    ha.automationDeletePolls = 1;
    ha.foreignBlueprintUser = true;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'LAUNDRY_PARTIAL_FAILURE',
      remaining: { blueprintPath: 'hauser/laundry-power-cycle-v1.yaml' },
    });
    const automationDelete = ha.calls.findIndex((call) => call.transport === 'rest'
      && call.method === 'DELETE' && call.path?.endsWith(`/${result.automation.id}`));
    const helperDelete = ha.calls.findIndex((call) => call.transport === 'ws' && call.type === 'input_select/delete');
    expect(automationDelete).toBeGreaterThan(-1);
    expect(helperDelete).toBeGreaterThan(automationDelete);
    expect(ha.calls.slice(automationDelete + 1, helperDelete).some((call) => call.transport === 'rest'
      && call.method === 'GET' && call.path?.endsWith(`/${result.automation.id}`))).toBe(true);
    expect(ha.writes).not.toContain('blueprint:delete');
  });

  it('does not delete a newer foreign automation winner during CAS-drift compensation', async () => {
    const ha = new StrictHa();
    const verificationEntered = deferred();
    const releaseVerification = deferred();
    const app = await start(ha);
    const result = await preview(app);
    const originalWs = ha.ws;
    let replaced = false;
    ha.ws = async (...args: Parameters<typeof originalWs>) => {
      const response = await originalWs(...args);
      if (args[0] === 'automation/config' && !replaced) {
        verificationEntered.resolve();
        await releaseVerification.promise;
        const foreign = {
          alias: 'Foreign newer automation winner',
          description: 'not owned by this Laundry apply',
          use_blueprint: {
            path: 'hauser/laundry-power-cycle-v1.yaml',
            input: { state_helper: ha.helperEntityId },
          },
          mode: 'single',
        };
        ha.automationBody = foreign;
        ha.loadedAutomationBody = foreign;
        replaced = true;
      }
      return response;
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const householdBefore = readFileSync(app.householdConfigPath);
    const apply = post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    await verificationEntered.promise;

    const shared = await fetch(`${app.base}/api/config`);
    const sharedEtag = shared.headers.get('etag')!;
    await shared.arrayBuffer();
    const sharedWinner = await fetch(`${app.base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://client.fixture', 'if-match': sharedEtag },
      body: JSON.stringify({ updates: { 'hmi:lock-button': 'visible' } }),
    });
    expect(sharedWinner.status).toBe(200);
    releaseVerification.resolve();

    const response = await apply;
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: 'LAUNDRY_PARTIAL_FAILURE',
      remaining: {
        automationId: result.automation.id,
        inputSelectId: 'ha_assigned_helper',
        blueprintPath: 'hauser/laundry-power-cycle-v1.yaml',
      },
    });
    expect(ha.writes).not.toContain(`automation:delete:${result.automation.id}`);
    expect(ha.writes).not.toContain('helper:delete');
    expect(ha.writes).not.toContain('blueprint:delete');
    expect(ha.automationBody?.alias).toBe('Foreign newer automation winner');
    expect(ha.helperCreated).toBe(true);
    expect(ha.blueprintCreated).toBe(true);
    expect(readFileSync(app.householdConfigPath)).toEqual(householdBefore);
  });

  it('rechecks the saved Blueprint generation immediately before compensation delete', async () => {
    const ha = new StrictHa();
    ha.failAutomationVerification = true;
    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    const originalWs = ha.ws;
    let blocked = false;
    ha.ws = async (...args: Parameters<typeof originalWs>) => {
      if (args[0] === 'config/entity_registry/list' && !blocked
          && ha.blueprintYaml !== null && !ha.helperCreated && ha.automationBody === null) {
        blocked = true;
        cleanupEntered.resolve();
        await releaseCleanup.promise;
      }
      return originalWs(...args);
    };
    ha.clientFactory = (credentials) => {
      expect(credentials).toEqual({ baseUrl: 'http://ha.fixture', token: 'fixture-token' });
      return { rest: ha.rest, ws: ha.ws, close: () => undefined };
    };
    const app = await start(ha);
    const result = await preview(app);
    const apply = post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    await cleanupEntered.promise;

    const foreignWinnerBytes = '# foreign winner generation\nblueprint:\n  name: Foreign winner\n';
    ha.blueprintYaml = foreignWinnerBytes;
    ha.substitutionChanged = true;
    releaseCleanup.resolve();

    const response = await apply;
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      code: 'LAUNDRY_PARTIAL_FAILURE',
      status: 'partial_failure',
      remaining: { blueprintPath: 'hauser/laundry-power-cycle-v1.yaml' },
    });
    expect(JSON.stringify(payload)).not.toMatch(/fixture-token|http:\/\/ha\.fixture/);
    expect(ha.writes).not.toContain('blueprint:delete');
    expect(ha.blueprintYaml).toBe(foreignWinnerBytes);
    expect(ha.automationBody).toBeNull();
    expect(ha.helperCreated).toBe(false);
    expect(ha.registryEntries).toEqual([]);

    ha.failAutomationVerification = false;
    ha.substitutionChanged = false;
    const retry = await preview(app);
    const retried = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: retry.previewId, confirmed: true,
    });
    expect(retried.status).toBe(200);
    expect(ha.blueprintYaml).toBe(foreignWinnerBytes);
  });

  it('reuses but never overwrites or removes a pre-existing bundled blueprint path', async () => {
    const ha = new StrictHa();
    ha.blueprintPreexisting = true;
    ha.failAutomationVerification = true;
    const app = await start(ha);
    const result = await preview(app);
    expect((await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    })).status).toBe(502);
    expect(ha.writes).not.toContain('blueprint:create');
    expect(ha.writes).not.toContain('blueprint:delete');
    expect(ha.writes.slice(-2)).toEqual([`automation:delete:${result.automation.id}`, 'helper:delete']);
  });

  it('accepts a pre-existing blueprint only when substitution matches the bundled canonical contract', async () => {
    const ha = new StrictHa();
    ha.blueprintPreexisting = true;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });
    expect(response.status).toBe(200);
    expect(ha.writes).not.toContain('blueprint:create');
    expect(ha.writes).not.toContain('blueprint:delete');
  });

  it('rejects a changed pre-existing blueprint substitution and rolls back only objects from this apply', async () => {
    const ha = new StrictHa();
    ha.blueprintPreexisting = true;
    ha.substitutionChanged = true;
    const app = await start(ha);
    const original = readFileSync(app.householdConfigPath);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: result.previewId, confirmed: true,
    });

    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('LAUNDRY_VERIFICATION_FAILED');
    expect(readFileSync(app.householdConfigPath)).toEqual(original);
    expect(ha.automationBody).toBeNull();
    expect(ha.helperCreated).toBe(false);
    expect(ha.writes).toEqual(['helper:create', 'helper:delete']);
    expect(ha.writes).not.toContain('blueprint:create');
    expect(ha.writes).not.toContain('blueprint:delete');
  });

  it('reports only non-secret created IDs when reverse cleanup itself fails', async () => {
    const ha = new StrictHa();
    ha.failAutomationVerification = true;
    ha.failCleanup = true;
    const app = await start(ha);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', { previewId: result.previewId, confirmed: true });
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: 'partial_failure',
      code: 'LAUNDRY_PARTIAL_FAILURE',
      remaining: {
        automationId: result.automation.id,
        inputSelectId: 'ha_assigned_helper',
        blueprintPath: 'hauser/laundry-power-cycle-v1.yaml',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('fixture-token');
    expect(JSON.stringify(payload)).not.toContain('http://ha.fixture');

    ha.failCleanup = false;
    ha.failAutomationVerification = false;
    ha.automationBody = null;
    ha.automationEntityId = null;
    ha.automationConfigId = null;
    ha.helperCreated = false;
    ha.blueprintCreated = false;
    const retry = await preview(app);
    const retried = await post(app.base, '/api/laundry/blueprint/apply', {
      previewId: retry.previewId, confirmed: true,
    });
    expect(retried.status).toBe(200);
  });

  it('cleans HA and temp files when the final atomic rename fails, preserving exact old bytes', async () => {
    const ha = new StrictHa();
    const app = await start(ha, { laundryReplaceConfig: () => { throw new Error('rename failed'); } });
    const original = readFileSync(app.householdConfigPath);
    const result = await preview(app);
    const response = await post(app.base, '/api/laundry/blueprint/apply', { previewId: result.previewId, confirmed: true });
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('LAUNDRY_CONFIG_WRITE_FAILED');
    expect(readFileSync(app.householdConfigPath)).toEqual(original);
    expect(readdirSync(app.root).filter((name: string) => name.includes('.laundry.tmp'))).toEqual([]);
    expect(ha.writes.slice(-3)).toEqual([
      `automation:delete:${result.automation.id}`, 'helper:delete', 'blueprint:delete',
    ]);
  });

  it('uses bearer and WS auth internally and sanitizes REST auth, network and invalid-response failures', async () => {
    const websocketFrames: any[] = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 1;
      listeners = new Map<string, Set<(event: any) => void>>();
      constructor(public url: URL) {
        queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'auth_required' }) }));
      }
      addEventListener(type: string, listener: (event: any) => void) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type: string, listener: (event: any) => void) {
        this.listeners.get(type)?.delete(listener);
      }
      emit(type: string, event: any) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
      send(value: string) {
        const frame = JSON.parse(value);
        websocketFrames.push(frame);
        if (frame.type === 'auth') {
          queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'auth_ok' }) }));
        } else {
          queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: frame.id, type: 'result', success: true, result: [] }) }));
        }
      }
      close() { this.readyState = 3; }
    }
    const wsClient = createLaundryHomeAssistantClient({
      baseUrl: 'http://ha.fixture', token: 'fixture-token', WebSocketImpl: FakeWebSocket,
      fetchImpl: async () => new Response('{}'),
    });
    await expect(wsClient.ws('config/entity_registry/list')).resolves.toEqual([]);
    expect(websocketFrames).toEqual([
      { type: 'auth', access_token: 'fixture-token' },
      { id: 1, type: 'config/entity_registry/list' },
    ]);
    wsClient.close();

    const captured: any[] = [];
    const authClient = createLaundryHomeAssistantClient({
      baseUrl: 'http://ha.fixture', token: 'fixture-token',
      fetchImpl: async (url: URL, init: RequestInit) => {
        captured.push({ url: String(url), init });
        return new Response('{"message":"unauthorized secret fixture-token"}', { status: 401, headers: { 'content-type': 'application/json' } });
      },
    });
    await expect(authClient.rest('GET', '/api/states/sensor.fixture')).rejects.toMatchObject({
      code: 'LAUNDRY_HOME_ASSISTANT_AUTH_FAILED',
    });
    expect(captured[0].init.headers.authorization).toBe('Bearer fixture-token');
    authClient.close();

    const networkClient = createLaundryHomeAssistantClient({
      baseUrl: 'http://ha.fixture', token: 'fixture-token', fetchImpl: async () => { throw new Error('fixture-token leak'); },
    });
    await expect(networkClient.rest('GET', '/api/states/sensor.fixture')).rejects.toMatchObject({
      code: 'LAUNDRY_HOME_ASSISTANT_UNREACHABLE',
    });

    const invalidClient = createLaundryHomeAssistantClient({
      baseUrl: 'http://ha.fixture', token: 'fixture-token', fetchImpl: async () => new Response('not-json', { status: 200 }),
    });
    await expect(invalidClient.rest('GET', '/api/states/sensor.fixture')).rejects.toMatchObject({
      code: 'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE',
    });
  });

  it('closes auth-invalid, timeout and error handshake candidates and makes repeated close idempotent', async () => {
    type Mode = 'auth_invalid' | 'timeout' | 'error';
    class HandshakeWebSocket {
      static OPEN = 1;
      static modes: Mode[] = [];
      static instances: HandshakeWebSocket[] = [];
      readyState = 0;
      closeCount = 0;
      mode: Mode;
      listeners = new Map<string, Set<(event: any) => void>>();
      constructor() {
        this.mode = HandshakeWebSocket.modes.shift()!;
        HandshakeWebSocket.instances.push(this);
        if (this.mode !== 'timeout') {
          queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'auth_required' }) }));
        }
      }
      addEventListener(type: string, listener: (event: any) => void) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }
      removeEventListener(type: string, listener: (event: any) => void) {
        this.listeners.get(type)?.delete(listener);
      }
      emit(type: string, event: any) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
      }
      send(value: string) {
        const frame = JSON.parse(value);
        if (frame.type !== 'auth') return;
        if (this.mode === 'auth_invalid') {
          queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'auth_invalid' }) }));
        } else if (this.mode === 'error') {
          queueMicrotask(() => this.emit('error', {}));
        }
      }
      close() {
        this.closeCount += 1;
        this.readyState = 3;
        this.emit('close', {});
      }
    }

    for (const mode of ['auth_invalid', 'timeout', 'error'] as const) {
      HandshakeWebSocket.modes.push(mode);
      const client = createLaundryHomeAssistantClient({
        baseUrl: 'http://ha.fixture', token: 'fixture-token',
        WebSocketImpl: HandshakeWebSocket, timeoutMs: 5,
      });
      await expect(client.ws('config/entity_registry/list')).rejects.toMatchObject({
        code: mode === 'auth_invalid'
          ? 'LAUNDRY_HOME_ASSISTANT_AUTH_FAILED'
          : mode === 'timeout'
            ? 'LAUNDRY_HOME_ASSISTANT_TIMEOUT'
            : 'LAUNDRY_HOME_ASSISTANT_UNREACHABLE',
      });
      client.close();
      client.close();
      const candidate = HandshakeWebSocket.instances.at(-1)!;
      expect(candidate.closeCount).toBe(1);
      expect([...candidate.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    }

    HandshakeWebSocket.modes.push('timeout');
    const connectingClient = createLaundryHomeAssistantClient({
      baseUrl: 'http://ha.fixture', token: 'fixture-token',
      WebSocketImpl: HandshakeWebSocket, timeoutMs: 50,
    });
    const connecting = connectingClient.ws('config/entity_registry/list');
    connectingClient.close();
    connectingClient.close();
    await expect(connecting).rejects.toMatchObject({ code: 'LAUNDRY_HOME_ASSISTANT_UNREACHABLE' });
    expect(HandshakeWebSocket.instances.at(-1)!.closeCount).toBe(1);
  });
});
