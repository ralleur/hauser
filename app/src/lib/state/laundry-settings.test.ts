import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error native Node source-contract read without @types/node
import { readFileSync } from 'node:fs';
import type { LaundryAdapterConfig } from '../config/household-config.ts';
import {
  LaundrySettingsController,
  sanitizeLaundryError,
  type LaundryFetch,
} from './laundry-settings.ts';

const washerAdapter: LaundryAdapterConfig = {
  type: 'entity',
  entityId: 'input_boolean.washer_running',
  runningStates: ['on'],
  doneStates: ['off'],
  doneOnInitial: false,
};

const markedWasherAdapter: LaundryAdapterConfig = {
  ...washerAdapter,
  entityId: 'select.washer_cycle',
  runningStates: ['washing'],
  doneStates: ['complete'],
  doneOnInitial: true,
  cycleMarkerEntityId: 'automation.hauser_washer_owned_cycle',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body));
}

describe('laundry settings client', () => {
  it('validates and explicitly applies an existing source using the normalized server preview', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const phases: string[] = [];
    const fetchImpl: LaundryFetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: requestBody(init) });
      if (url.endsWith('/existing/validate')) return response({
        ok: true,
        status: 'validated',
        validationId: 'validation-one-shot',
        expiresInSeconds: 120,
        device: 'washer',
        source: { entityId: 'select.washer_cycle', name: 'Washer cycle' },
        adapter: {
          type: 'entity',
          entityId: 'select.washer_cycle',
          runningStates: ['washing'],
          doneStates: ['complete'],
          doneOnInitial: true,
        },
      });
      return response({
        ok: true,
        status: 'configured',
        device: 'washer',
        entityId: 'select.washer_cycle',
        adapter: {
          type: 'entity',
          entityId: 'select.washer_cycle',
          runningStates: ['washing'],
          doneStates: ['complete'],
          doneOnInitial: true,
        },
      });
    });
    const controller = new LaundrySettingsController(
      { washer: washerAdapter, dryer: null },
      fetchImpl,
      (_device, state) => phases.push(state.phase),
    );

    controller.editExisting('washer', {
      entityId: ' SELECT.WASHER_CYCLE ',
      runningStates: ' Washing ',
      doneStates: ' Complete ',
      doneOnInitial: true,
    });
    await controller.preview('washer');

    expect(controller.state('washer')).toMatchObject({
      phase: 'preview',
      preview: {
        kind: 'existing',
        source: { entityId: 'select.washer_cycle', name: 'Washer cycle' },
        adapter: { entityId: 'select.washer_cycle', runningStates: ['washing'], doneStates: ['complete'] },
      },
    });
    expect(JSON.stringify(controller.state('washer'))).not.toContain('validation-one-shot');
    expect(calls[0]).toEqual({
      url: '/api/laundry/existing/validate',
      body: {
        device: 'washer',
        entityId: 'select.washer_cycle',
        runningStates: ['washing'],
        doneStates: ['complete'],
        doneOnInitial: true,
      },
    });

    await controller.apply('washer');

    expect(calls[1]).toEqual({
      url: '/api/laundry/existing/apply',
      body: { validationId: 'validation-one-shot', confirmed: true },
    });
    expect(controller.state('washer')).toMatchObject({
      phase: 'success',
      currentAdapter: { entityId: 'select.washer_cycle' },
      result: { kind: 'existing', entityId: 'select.washer_cycle' },
    });
    expect(phases).toContain('validating');
    expect(phases).toContain('applying');
  });

  it('keeps a server-returned marker in preview, apply state and result without sending it from the browser', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl: LaundryFetch = vi.fn(async (input, init) => {
      calls.push(requestBody(init));
      return String(input).endsWith('/validate')
        ? response({
            ok: true, status: 'validated', validationId: 'marked-existing', expiresInSeconds: 120,
            device: 'washer', source: { entityId: markedWasherAdapter.entityId, name: 'Washer cycle' },
            adapter: markedWasherAdapter,
          })
        : response({
            ok: true, status: 'configured', device: 'washer',
            entityId: markedWasherAdapter.entityId, adapter: markedWasherAdapter,
          });
    });
    const controller = new LaundrySettingsController({ washer: markedWasherAdapter, dryer: null }, fetchImpl);

    await controller.preview('washer');
    expect(controller.state('washer').preview).toMatchObject({
      kind: 'existing', adapter: { cycleMarkerEntityId: markedWasherAdapter.cycleMarkerEntityId },
    });
    expect(calls[0]).not.toHaveProperty('cycleMarkerEntityId');
    await controller.apply('washer');

    expect(controller.state('washer')).toMatchObject({
      phase: 'success',
      currentAdapter: { cycleMarkerEntityId: markedWasherAdapter.cycleMarkerEntityId },
      result: {
        kind: 'existing',
        adapter: { cycleMarkerEntityId: markedWasherAdapter.cycleMarkerEntityId },
      },
    });
    expect(calls[1]).toEqual({ validationId: 'marked-existing', confirmed: true });
  });

  it('invalidates a preview on draft change and blocks stale apply', async () => {
    const fetchImpl: LaundryFetch = vi.fn(async (input) => response(String(input).endsWith('/validate') ? {
      ok: true,
      status: 'validated',
      validationId: 'stale-id',
      expiresInSeconds: 120,
      device: 'washer',
      source: { entityId: 'sensor.washer_state', name: 'Washer' },
      adapter: {
        type: 'entity', entityId: 'sensor.washer_state',
        runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
      },
    } : { ok: true }));
    const controller = new LaundrySettingsController({ washer: washerAdapter, dryer: null }, fetchImpl);
    controller.editExisting('washer', {
      entityId: 'sensor.washer_state', runningStates: 'running', doneStates: 'done', doneOnInitial: true,
    });
    await controller.preview('washer');
    controller.editExisting('washer', { doneStates: 'finished' });

    expect(controller.state('washer').phase).toBe('idle');
    expect(controller.state('washer').preview).toBeNull();
    await controller.apply('washer');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('previews and applies disable with device-only payload and skips calls when already disabled', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: LaundryFetch = vi.fn(async (input, init) => {
      const url = String(input);
      const body = requestBody(init);
      calls.push({ url, body });
      return url.endsWith('/preview')
        ? response({ ok: true, status: 'preview', previewId: 'disable-id', expiresInSeconds: 120, device: 'washer', adapter: washerAdapter })
        : response({ ok: true, status: 'disabled', device: 'washer', adapter: null });
    });
    const controller = new LaundrySettingsController({ washer: washerAdapter, dryer: null }, fetchImpl);
    controller.setEnabled('washer', false);

    await controller.preview('washer');
    expect(calls[0]).toEqual({ url: '/api/laundry/disable/preview', body: { device: 'washer' } });
    expect(controller.state('washer').preview).toMatchObject({ kind: 'disable', adapter: washerAdapter });
    await controller.apply('washer');
    expect(calls[1]).toEqual({
      url: '/api/laundry/disable/apply',
      body: { previewId: 'disable-id', confirmed: true },
    });
    expect(JSON.stringify(calls.map((call) => call.body))).not.toMatch(/token|haUrl/i);
    expect(controller.state('washer')).toMatchObject({ phase: 'success', currentAdapter: null, result: { kind: 'disabled' } });

    controller.setEnabled('dryer', false);
    await controller.preview('dryer');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(controller.state('dryer').phase).toBe('idle');
  });

  it('previews blueprint details and only reports HA-assigned IDs after apply', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: LaundryFetch = vi.fn(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: requestBody(init) });
      if (url.endsWith('/preview')) return response({
        ok: true,
        status: 'preview',
        previewId: 'blueprint-id',
        expiresInSeconds: 120,
        device: 'dryer',
        blueprint: { path: 'hauser/laundry-power-cycle-v1.yaml' },
        helper: { name: 'Hauser dryer laundry abc', entityId: null, idAssignedBy: 'home_assistant_during_apply', options: ['idle', 'running', 'done'] },
        automation: { id: 'hauser_dryer_laundry_abc', entityId: null, expectedEntityId: 'automation.hauser_dryer_laundry_abc', entityIdStatus: 'expected_not_confirmed', alias: 'Hauser dryer laundry abc' },
        inputs: {
          powerSensorEntityId: 'sensor.dryer_power', unitOfMeasurement: 'W',
          startThreshold: 8, endThreshold: 3, startHoldSeconds: 20, endHoldSeconds: 60,
        },
      });
      return response({
        ok: true,
        status: 'configured',
        device: 'dryer',
        helper: { id: 'ha_assigned_helper', entityId: 'input_select.ha_assigned_helper' },
        automation: { id: 'hauser_dryer_laundry_abc', entityId: 'automation.hauser_dryer_laundry_abc_2' },
        blueprint: { path: 'hauser/laundry-power-cycle-v1.yaml', created: true },
      });
    });
    const controller = new LaundrySettingsController({ washer: washerAdapter, dryer: null }, fetchImpl);
    controller.setEnabled('dryer', true);
    controller.setMode('dryer', 'blueprint');
    controller.editBlueprint('dryer', {
      powerSensorEntityId: 'sensor.dryer_power', startThreshold: 8, endThreshold: 3,
      startHoldSeconds: 20, endHoldSeconds: 60,
    });

    await controller.preview('dryer');
    const preview = controller.state('dryer').preview;
    expect(preview).toMatchObject({
      kind: 'blueprint',
      helper: { entityId: null, options: ['idle', 'running', 'done'] },
      automation: { entityId: null, expectedEntityId: 'automation.hauser_dryer_laundry_abc' },
    });
    await controller.apply('dryer');
    expect(calls[1]).toEqual({
      url: '/api/laundry/blueprint/apply',
      body: { previewId: 'blueprint-id', confirmed: true },
    });
    expect(controller.state('dryer')).toMatchObject({
      phase: 'success',
      currentAdapter: { entityId: 'input_select.ha_assigned_helper' },
      result: {
        kind: 'blueprint',
        helper: { entityId: 'input_select.ha_assigned_helper' },
        automation: { entityId: 'automation.hauser_dryer_laundry_abc_2' },
      },
    });
  });

  it('treats an expired one-shot as requiring a fresh preview before retrying apply', async () => {
    let previews = 0;
    let applies = 0;
    const fetchImpl: LaundryFetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/validate')) {
        previews += 1;
        return response({
          ok: true, status: 'validated', validationId: `id-${previews}`, expiresInSeconds: 120,
          device: 'washer', source: { entityId: 'input_boolean.washer_running', name: 'Washer' }, adapter: washerAdapter,
        });
      }
      applies += 1;
      return applies === 1
        ? response({ ok: false, code: 'LAUNDRY_SESSION_EXPIRED', message: 'raw server text' }, 409)
        : response({
            ok: true, status: 'configured', device: 'washer',
            entityId: washerAdapter.entityId, adapter: washerAdapter,
          });
    });
    const controller = new LaundrySettingsController({ washer: washerAdapter, dryer: null }, fetchImpl);
    await controller.preview('washer');
    await controller.apply('washer');
    expect(controller.state('washer')).toMatchObject({ phase: 'error', error: { kind: 'confirmationExpired' } });

    await controller.retry('washer');
    expect(previews).toBe(2);
    expect(applies).toBe(1);
    expect(controller.state('washer').phase).toBe('preview');
    await controller.apply('washer');
    expect(applies).toBe(2);
    expect(controller.state('washer').phase).toBe('success');
  });

  it('maps server failures to a closed user-safe vocabulary and filters remaining IDs', () => {
    expect(sanitizeLaundryError({ code: 'LAUNDRY_SOURCE_CHANGED', message: 'secret stack' })).toEqual({ kind: 'sourceChanged' });
    expect(sanitizeLaundryError({ code: 'LAUNDRY_HOME_ASSISTANT_AUTH_FAILED', message: 'Bearer secret' })).toEqual({ kind: 'haAuth' });
    expect(sanitizeLaundryError({ code: 'LAUNDRY_PARTIAL_FAILURE', message: 'secret', remaining: {
      automationId: 'safe_automation',
      inputSelectId: 'safe_helper',
      blueprintPath: 'hauser/laundry-power-cycle-v1.yaml',
      token: 'must-not-pass',
    } })).toEqual({
      kind: 'partialFailure',
      remaining: {
        automationId: 'safe_automation',
        inputSelectId: 'safe_helper',
        blueprintPath: 'hauser/laundry-power-cycle-v1.yaml',
      },
    });
    expect(sanitizeLaundryError({ code: 'UNKNOWN', message: 'secret stack' })).toEqual({ kind: 'generic' });
    expect(JSON.stringify(sanitizeLaundryError(new Error('token secret stack')))).not.toContain('secret');

    const knownCodes: Array<[string, string]> = [
      ['LAUNDRY_INVALID_REQUEST', 'invalid'],
      ['LAUNDRY_SOURCE_INCOMPATIBLE', 'sourceIncompatible'],
      ['LAUNDRY_CONFIG_CHANGED', 'configChanged'],
      ['LAUNDRY_HOME_ASSISTANT_NOT_CONFIGURED', 'haNotConfigured'],
      ['LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 'haUnreachable'],
      ['LAUNDRY_HOME_ASSISTANT_TIMEOUT', 'haTimeout'],
      ['LAUNDRY_SESSION_INVALID', 'confirmationExpired'],
      ['LAUNDRY_TARGET_CONFLICT', 'targetConflict'],
      ['LAUNDRY_VERIFICATION_FAILED', 'verificationFailed'],
      ['LAUNDRY_OUTCOME_UNKNOWN', 'outcomeUnknown'],
    ];
    for (const [code, kind] of knownCodes) {
      expect(sanitizeLaundryError({ code, message: 'must not escape' }).kind).toBe(kind);
    }
  });

  it('keeps washer and dryer requests independent', async () => {
    let resolveWasher!: (value: Response) => void;
    const washerPending = new Promise<Response>((resolve) => { resolveWasher = resolve; });
    const fetchImpl: LaundryFetch = vi.fn(async (_input, init) => {
      const body = requestBody(init);
      if (body.device === 'washer') return washerPending;
      return response({
        ok: true, status: 'validated', validationId: 'dryer-id', expiresInSeconds: 120,
        device: 'dryer', source: { entityId: 'sensor.dryer_state', name: 'Dryer' },
        adapter: { type: 'entity', entityId: 'sensor.dryer_state', runningStates: ['running'], doneStates: ['done'], doneOnInitial: true },
      });
    });
    const controller = new LaundrySettingsController({ washer: washerAdapter, dryer: null }, fetchImpl);
    controller.setEnabled('dryer', true);
    controller.editExisting('dryer', {
      entityId: 'sensor.dryer_state', runningStates: 'running', doneStates: 'done', doneOnInitial: true,
    });

    const washer = controller.preview('washer');
    expect(controller.state('washer').phase).toBe('validating');
    await controller.preview('dryer');
    expect(controller.state('dryer').phase).toBe('preview');
    expect(controller.state('washer').phase).toBe('validating');

    resolveWasher(response({
      ok: true, status: 'validated', validationId: 'washer-id', expiresInSeconds: 120,
      device: 'washer', source: { entityId: washerAdapter.entityId, name: 'Washer' }, adapter: washerAdapter,
    }));
    await washer;
    expect(controller.state('washer').phase).toBe('preview');
  });

  it('validates entity domains, closed states and blueprint bounds before fetch', async () => {
    const fetchImpl: LaundryFetch = vi.fn();
    const controller = new LaundrySettingsController({ washer: null, dryer: null }, fetchImpl);
    controller.setEnabled('washer', true);
    controller.editExisting('washer', { entityId: 'switch.invalid', runningStates: 'on', doneStates: 'off' });
    await controller.preview('washer');
    expect(controller.state('washer')).toMatchObject({ phase: 'error', error: { kind: 'invalid', field: 'entityId' } });

    controller.setMode('washer', 'blueprint');
    controller.editBlueprint('washer', {
      powerSensorEntityId: 'sensor.washer_power', startThreshold: 3, endThreshold: 3,
      startHoldSeconds: 0, endHoldSeconds: 3601,
    });
    await controller.preview('washer');
    expect(controller.state('washer')).toMatchObject({ phase: 'error', error: { kind: 'invalid', field: 'thresholdOrder' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the productive UI wired to all preview/apply routes and the global reload marker', () => {
    const clientSource = readFileSync(new URL('./laundry-settings.ts', import.meta.url), 'utf8');
    const uiSource = readFileSync(new URL('../components/settings/NotificationsSection.svelte', import.meta.url), 'utf8');
    for (const route of [
      '/api/laundry/existing/validate', '/api/laundry/existing/apply',
      '/api/laundry/disable/preview', '/api/laundry/disable/apply',
      '/api/laundry/blueprint/preview', '/api/laundry/blueprint/apply',
    ]) expect(clientSource).toContain(route);
    expect(uiSource).toContain("controller.setMode(kind, 'existing')");
    expect(uiSource).toContain("controller.setMode(kind, 'blueprint')");
    expect(uiSource).toContain('settingsUi.needsReload = true');
    expect(uiSource).not.toContain('settings_laundry_save_unavailable');
    expect(uiSource).not.toContain('settings_laundry_blueprint_next');
  });
});
