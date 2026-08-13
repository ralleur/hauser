import type { LaundryAdapterConfig } from '../config/household-config.ts';

export type LaundryDevice = 'washer' | 'dryer';
export type LaundryMode = 'existing' | 'blueprint';
export type LaundryPhase = 'idle' | 'validating' | 'preview' | 'applying' | 'success' | 'error';
export type LaundryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ExistingLaundryDraft {
  entityId: string;
  runningStates: string;
  doneStates: string;
  doneOnInitial: boolean;
  cycleMarkerEntityId?: string;
}

export interface BlueprintLaundryDraft {
  powerSensorEntityId: string;
  startThreshold: number;
  endThreshold: number;
  startHoldSeconds: number;
  endHoldSeconds: number;
}

export interface LaundryDraft {
  enabled: boolean;
  mode: LaundryMode;
  existing: ExistingLaundryDraft;
  blueprint: BlueprintLaundryDraft;
}

export interface LaundryRemaining {
  automationId?: string;
  inputSelectId?: string;
  blueprintPath?: string;
}

export type LaundryUserError =
  | { kind: 'invalid'; field?: 'entityId' | 'statesRequired' | 'statesOverlap' | 'statesInvalid' | 'powerSensorEntityId' | 'thresholdNumber' | 'thresholdOrder' | 'holdRange' }
  | { kind: 'sourceChanged' }
  | { kind: 'sourceIncompatible' }
  | { kind: 'configChanged' }
  | { kind: 'haNotConfigured' }
  | { kind: 'haAuth' }
  | { kind: 'haUnreachable' }
  | { kind: 'haTimeout' }
  | { kind: 'confirmationExpired' }
  | { kind: 'targetConflict' }
  | { kind: 'verificationFailed' }
  | { kind: 'partialFailure'; remaining?: LaundryRemaining }
  | { kind: 'outcomeUnknown'; remaining?: LaundryRemaining }
  | { kind: 'generic' };

export interface ExistingLaundryPreview {
  kind: 'existing';
  device: LaundryDevice;
  expiresInSeconds: number;
  source: { entityId: string; name: string };
  adapter: LaundryAdapterConfig;
}

export interface DisableLaundryPreview {
  kind: 'disable';
  device: LaundryDevice;
  expiresInSeconds: number;
  adapter: LaundryAdapterConfig;
}

export interface BlueprintLaundryPreview {
  kind: 'blueprint';
  device: LaundryDevice;
  expiresInSeconds: number;
  blueprint: { path: string };
  helper: {
    name: string;
    entityId: null;
    options: string[];
  };
  automation: {
    id: string;
    entityId: null;
    expectedEntityId: string;
    alias: string;
  };
  inputs: {
    powerSensorEntityId: string;
    startThreshold: number;
    endThreshold: number;
    startHoldSeconds: number;
    endHoldSeconds: number;
    unitOfMeasurement: string;
  };
}

export type LaundryPreview = ExistingLaundryPreview | DisableLaundryPreview | BlueprintLaundryPreview;

export type LaundryResult =
  | { kind: 'existing'; device: LaundryDevice; entityId: string; adapter: LaundryAdapterConfig }
  | { kind: 'disabled'; device: LaundryDevice }
  | {
      kind: 'blueprint';
      device: LaundryDevice;
      helper: { id: string; entityId: string };
      automation: { id: string; entityId: string };
      blueprint: { path: string; created: boolean };
    };

export interface LaundryCardState {
  device: LaundryDevice;
  phase: LaundryPhase;
  currentAdapter: LaundryAdapterConfig | null;
  draft: LaundryDraft;
  preview: LaundryPreview | null;
  result: LaundryResult | null;
  error: LaundryUserError | null;
}

type Session = {
  kind: LaundryPreview['kind'];
  id: string;
  fingerprint: string;
};

type JsonObject = Record<string, unknown>;

const EXISTING_ENTITY = /^(?:input_boolean|binary_sensor|sensor|input_select|select)\.[a-z0-9_]+$/;
const POWER_ENTITY = /^sensor\.[a-z0-9_]+$/;
const SAFE_ID = /^[a-z0-9_]{1,128}$/;
const SAFE_BLUEPRINT_PATH = /^[a-z0-9_/-]+\.ya?ml$/;

function object(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function device(value: unknown): LaundryDevice | null {
  return value === 'washer' || value === 'dryer' ? value : null;
}

function states(value: string): string[] {
  return value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function normalizedExisting(draft: ExistingLaundryDraft): LaundryAdapterConfig {
  return {
    type: 'entity',
    entityId: draft.entityId.trim().toLowerCase(),
    runningStates: states(draft.runningStates),
    doneStates: states(draft.doneStates),
    doneOnInitial: draft.doneOnInitial,
  };
}

function normalizedBlueprint(draft: BlueprintLaundryDraft): BlueprintLaundryDraft {
  return {
    ...draft,
    powerSensorEntityId: draft.powerSensorEntityId.trim().toLowerCase(),
  };
}

function fingerprint(state: LaundryCardState): string {
  const relevant = state.draft.enabled
    ? state.draft.mode === 'existing'
      ? { enabled: true, mode: 'existing', value: normalizedExisting(state.draft.existing) }
      : { enabled: true, mode: 'blueprint', value: normalizedBlueprint(state.draft.blueprint) }
    : { enabled: false, current: state.currentAdapter };
  return JSON.stringify(relevant);
}

function adapter(value: unknown): LaundryAdapterConfig | null {
  const candidate = object(value);
  if (!candidate || candidate.type !== 'entity' || typeof candidate.entityId !== 'string'
      || !EXISTING_ENTITY.test(candidate.entityId) || typeof candidate.doneOnInitial !== 'boolean'
      || !Array.isArray(candidate.runningStates) || !Array.isArray(candidate.doneStates)) return null;
  const runningStates = candidate.runningStates.filter((entry): entry is string => typeof entry === 'string');
  const doneStates = candidate.doneStates.filter((entry): entry is string => typeof entry === 'string');
  if (runningStates.length !== candidate.runningStates.length || doneStates.length !== candidate.doneStates.length
      || runningStates.length < 1 || doneStates.length < 1) return null;
  const cycleMarkerEntityId = typeof candidate.cycleMarkerEntityId === 'string'
    && /^automation\.[a-z0-9_]+$/.test(candidate.cycleMarkerEntityId)
    ? candidate.cycleMarkerEntityId
    : undefined;
  return {
    type: 'entity',
    entityId: candidate.entityId,
    runningStates,
    doneStates,
    doneOnInitial: candidate.doneOnInitial,
    ...(cycleMarkerEntityId ? { cycleMarkerEntityId } : {}),
  };
}

function initialDraft(current: LaundryAdapterConfig | null): LaundryDraft {
  return {
    enabled: current !== null,
    mode: 'existing',
    existing: {
      entityId: current?.entityId ?? '',
      runningStates: current?.runningStates.join(', ') ?? 'on',
      doneStates: current?.doneStates.join(', ') ?? 'off',
      doneOnInitial: current?.doneOnInitial ?? false,
    },
    blueprint: {
      powerSensorEntityId: '',
      startThreshold: 8,
      endThreshold: 3,
      startHoldSeconds: 20,
      endHoldSeconds: 60,
    },
  };
}

function initialState(deviceId: LaundryDevice, current: LaundryAdapterConfig | null): LaundryCardState {
  return {
    device: deviceId,
    phase: 'idle',
    currentAdapter: current,
    draft: initialDraft(current),
    preview: null,
    result: null,
    error: null,
  };
}

function invalid(field: Extract<LaundryUserError, { kind: 'invalid' }>['field']): LaundryUserError {
  return { kind: 'invalid', field };
}

export function validateLaundryDraft(state: LaundryCardState): LaundryUserError | null {
  if (!state.draft.enabled) return null;
  if (state.draft.mode === 'existing') {
    const value = normalizedExisting(state.draft.existing);
    if (!EXISTING_ENTITY.test(value.entityId)) return invalid('entityId');
    if (value.runningStates.length < 1 || value.doneStates.length < 1) return invalid('statesRequired');
    const all = [...value.runningStates, ...value.doneStates];
    if (all.length > 32 || all.some((entry) => entry.length > 128
        || entry === 'unknown' || entry === 'unavailable')
        || new Set(value.runningStates).size !== value.runningStates.length
        || new Set(value.doneStates).size !== value.doneStates.length) return invalid('statesInvalid');
    if (value.runningStates.length > 16 || value.doneStates.length > 16) return invalid('statesInvalid');
    if (value.doneStates.some((entry) => value.runningStates.includes(entry))) return invalid('statesOverlap');
    return null;
  }
  const value = normalizedBlueprint(state.draft.blueprint);
  if (!POWER_ENTITY.test(value.powerSensorEntityId)) return invalid('powerSensorEntityId');
  if (!finiteNumber(value.startThreshold) || !finiteNumber(value.endThreshold)
      || Math.abs(value.startThreshold) > 1_000_000 || Math.abs(value.endThreshold) > 1_000_000) {
    return invalid('thresholdNumber');
  }
  if (value.endThreshold >= value.startThreshold) return invalid('thresholdOrder');
  if (!Number.isInteger(value.startHoldSeconds) || !Number.isInteger(value.endHoldSeconds)
      || value.startHoldSeconds < 1 || value.startHoldSeconds > 3_600
      || value.endHoldSeconds < 1 || value.endHoldSeconds > 3_600) return invalid('holdRange');
  return null;
}

function safeRemaining(value: unknown): LaundryRemaining | undefined {
  const candidate = object(value);
  if (!candidate) return undefined;
  const remaining: LaundryRemaining = {};
  if (typeof candidate.automationId === 'string' && SAFE_ID.test(candidate.automationId)) {
    remaining.automationId = candidate.automationId;
  }
  if (typeof candidate.inputSelectId === 'string' && SAFE_ID.test(candidate.inputSelectId)) {
    remaining.inputSelectId = candidate.inputSelectId;
  }
  if (typeof candidate.blueprintPath === 'string' && candidate.blueprintPath.length <= 255
      && SAFE_BLUEPRINT_PATH.test(candidate.blueprintPath)) {
    remaining.blueprintPath = candidate.blueprintPath;
  }
  return Object.keys(remaining).length ? remaining : undefined;
}

export function sanitizeLaundryError(value: unknown): LaundryUserError {
  const payload = object(value);
  const code = typeof payload?.code === 'string' ? payload.code : '';
  if (['LAUNDRY_INVALID_REQUEST', 'LAUNDRY_INVALID_JSON', 'LAUNDRY_CONTENT_TYPE_REQUIRED',
    'LAUNDRY_REQUEST_TOO_LARGE', 'METHOD_NOT_ALLOWED'].includes(code)) return { kind: 'invalid' };
  if (code === 'LAUNDRY_SOURCE_CHANGED') return { kind: 'sourceChanged' };
  if (['LAUNDRY_SOURCE_MISSING', 'LAUNDRY_SOURCE_UNAVAILABLE', 'LAUNDRY_SOURCE_INCOMPATIBLE',
    'LAUNDRY_POWER_SOURCE_INCOMPATIBLE'].includes(code)) return { kind: 'sourceIncompatible' };
  if (code === 'LAUNDRY_CONFIG_CHANGED') return { kind: 'configChanged' };
  if (code === 'LAUNDRY_HOME_ASSISTANT_NOT_CONFIGURED') return { kind: 'haNotConfigured' };
  if (code === 'LAUNDRY_HOME_ASSISTANT_AUTH_FAILED') return { kind: 'haAuth' };
  if (code === 'LAUNDRY_HOME_ASSISTANT_UNREACHABLE') return { kind: 'haUnreachable' };
  if (code === 'LAUNDRY_HOME_ASSISTANT_TIMEOUT') return { kind: 'haTimeout' };
  if (['LAUNDRY_CONFIRMATION_REQUIRED', 'LAUNDRY_SESSION_INVALID', 'LAUNDRY_SESSION_EXPIRED'].includes(code)) {
    return { kind: 'confirmationExpired' };
  }
  if (code === 'LAUNDRY_TARGET_CONFLICT') return { kind: 'targetConflict' };
  if (code === 'LAUNDRY_PARTIAL_FAILURE') {
    const remaining = safeRemaining(payload?.remaining);
    return { kind: 'partialFailure', ...(remaining ? { remaining } : {}) };
  }
  if (code === 'LAUNDRY_OUTCOME_UNKNOWN') {
    const remaining = safeRemaining(payload?.remaining);
    return { kind: 'outcomeUnknown', ...(remaining ? { remaining } : {}) };
  }
  if (['LAUNDRY_VERIFICATION_FAILED', 'LAUNDRY_CONFIG_WRITE_FAILED',
    'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 'LAUNDRY_HOME_ASSISTANT_COMMAND_FAILED',
    'LAUNDRY_HOME_ASSISTANT_HTTP_ERROR'].includes(code)) return { kind: 'verificationFailed' };
  return { kind: 'generic' };
}

class LaundryRequestError extends Error {
  constructor(readonly payload: unknown) {
    super('Laundry request failed');
  }
}

async function post(fetchImpl: LaundryFetch, path: string, body: JsonObject): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LaundryRequestError({ code: 'LAUNDRY_HOME_ASSISTANT_UNREACHABLE' });
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) throw new LaundryRequestError(payload);
  return payload;
}

function parseExistingPreview(value: unknown, expectedDevice: LaundryDevice): { preview: ExistingLaundryPreview; id: string } | null {
  const payload = object(value);
  const source = object(payload?.source);
  const parsedAdapter = adapter(payload?.adapter);
  if (payload?.ok !== true || payload.status !== 'validated' || device(payload.device) !== expectedDevice
      || typeof payload.validationId !== 'string' || payload.validationId.length < 1
      || !finiteNumber(payload.expiresInSeconds) || !source || typeof source.entityId !== 'string'
      || typeof source.name !== 'string' || !parsedAdapter || source.entityId !== parsedAdapter.entityId) return null;
  return {
    id: payload.validationId,
    preview: {
      kind: 'existing', device: expectedDevice, expiresInSeconds: payload.expiresInSeconds,
      source: { entityId: source.entityId, name: source.name }, adapter: parsedAdapter,
    },
  };
}

function parseDisablePreview(value: unknown, expectedDevice: LaundryDevice): { preview: DisableLaundryPreview; id: string } | null {
  const payload = object(value);
  const parsedAdapter = adapter(payload?.adapter);
  if (payload?.ok !== true || payload.status !== 'preview' || device(payload.device) !== expectedDevice
      || typeof payload.previewId !== 'string' || payload.previewId.length < 1
      || !finiteNumber(payload.expiresInSeconds) || !parsedAdapter) return null;
  return {
    id: payload.previewId,
    preview: {
      kind: 'disable', device: expectedDevice, expiresInSeconds: payload.expiresInSeconds,
      adapter: parsedAdapter,
    },
  };
}

function parseBlueprintPreview(value: unknown, expectedDevice: LaundryDevice): { preview: BlueprintLaundryPreview; id: string } | null {
  const payload = object(value);
  const blueprint = object(payload?.blueprint);
  const helper = object(payload?.helper);
  const automation = object(payload?.automation);
  const inputs = object(payload?.inputs);
  if (payload?.ok !== true || payload.status !== 'preview' || device(payload.device) !== expectedDevice
      || typeof payload.previewId !== 'string' || payload.previewId.length < 1
      || !finiteNumber(payload.expiresInSeconds) || typeof blueprint?.path !== 'string'
      || typeof helper?.name !== 'string' || helper.entityId !== null
      || helper.idAssignedBy !== 'home_assistant_during_apply' || !Array.isArray(helper.options)
      || !helper.options.every((entry) => typeof entry === 'string')
      || typeof automation?.id !== 'string' || automation.entityId !== null
      || typeof automation.expectedEntityId !== 'string' || typeof automation.alias !== 'string'
      || automation.entityIdStatus !== 'expected_not_confirmed'
      || typeof inputs?.powerSensorEntityId !== 'string' || typeof inputs.unitOfMeasurement !== 'string'
      || !inputs.unitOfMeasurement.trim() || !finiteNumber(inputs.startThreshold)
      || !finiteNumber(inputs.endThreshold) || !finiteNumber(inputs.startHoldSeconds)
      || !finiteNumber(inputs.endHoldSeconds)) return null;
  return {
    id: payload.previewId,
    preview: {
      kind: 'blueprint', device: expectedDevice, expiresInSeconds: payload.expiresInSeconds,
      blueprint: { path: blueprint.path },
      helper: { name: helper.name, entityId: null, options: [...helper.options] as string[] },
      automation: {
        id: automation.id, entityId: null,
        expectedEntityId: automation.expectedEntityId, alias: automation.alias,
      },
      inputs: {
        powerSensorEntityId: inputs.powerSensorEntityId,
        startThreshold: inputs.startThreshold,
        endThreshold: inputs.endThreshold,
        startHoldSeconds: inputs.startHoldSeconds,
        endHoldSeconds: inputs.endHoldSeconds,
        unitOfMeasurement: inputs.unitOfMeasurement,
      },
    },
  };
}

function parseExistingResult(value: unknown, expectedDevice: LaundryDevice): LaundryResult | null {
  const payload = object(value);
  const parsedAdapter = adapter(payload?.adapter);
  return payload?.ok === true && payload.status === 'configured' && device(payload.device) === expectedDevice
      && typeof payload.entityId === 'string' && EXISTING_ENTITY.test(payload.entityId)
      && parsedAdapter?.entityId === payload.entityId
    ? { kind: 'existing', device: expectedDevice, entityId: payload.entityId, adapter: parsedAdapter }
    : null;
}

function parseDisableResult(value: unknown, expectedDevice: LaundryDevice): LaundryResult | null {
  const payload = object(value);
  return payload?.ok === true && payload.status === 'disabled' && device(payload.device) === expectedDevice
      && payload.adapter === null
    ? { kind: 'disabled', device: expectedDevice }
    : null;
}

function parseBlueprintResult(value: unknown, expectedDevice: LaundryDevice): LaundryResult | null {
  const payload = object(value);
  const helper = object(payload?.helper);
  const automation = object(payload?.automation);
  const blueprint = object(payload?.blueprint);
  if (payload?.ok !== true || payload.status !== 'configured' || device(payload.device) !== expectedDevice
      || typeof helper?.id !== 'string' || typeof helper.entityId !== 'string'
      || !SAFE_ID.test(helper.id) || !/^input_select\.[a-z0-9_]+$/.test(helper.entityId)
      || typeof automation?.id !== 'string' || typeof automation.entityId !== 'string'
      || !SAFE_ID.test(automation.id) || !/^automation\.[a-z0-9_]+$/.test(automation.entityId)
      || typeof blueprint?.path !== 'string' || typeof blueprint.created !== 'boolean') return null;
  return {
    kind: 'blueprint', device: expectedDevice,
    helper: { id: helper.id, entityId: helper.entityId },
    automation: { id: automation.id, entityId: automation.entityId },
    blueprint: { path: blueprint.path, created: blueprint.created },
  };
}

function busy(state: LaundryCardState): boolean {
  return state.phase === 'validating' || state.phase === 'applying';
}

export class LaundrySettingsController {
  readonly #fetch: LaundryFetch;
  readonly #notify?: (device: LaundryDevice, state: LaundryCardState) => void;
  readonly #states: Record<LaundryDevice, LaundryCardState>;
  readonly #sessions = new Map<LaundryDevice, Session>();

  constructor(
    initial: Record<LaundryDevice, LaundryAdapterConfig | null>,
    fetchImpl: LaundryFetch = fetch,
    notify?: (device: LaundryDevice, state: LaundryCardState) => void,
  ) {
    this.#fetch = fetchImpl;
    this.#notify = notify;
    this.#states = {
      washer: initialState('washer', initial.washer),
      dryer: initialState('dryer', initial.dryer),
    };
  }

  state(deviceId: LaundryDevice): LaundryCardState {
    return this.#states[deviceId];
  }

  #set(deviceId: LaundryDevice, state: LaundryCardState): void {
    this.#states[deviceId] = state;
    this.#notify?.(deviceId, state);
  }

  #discardPreview(deviceId: LaundryDevice, update: (state: LaundryCardState) => LaundryCardState): void {
    const current = this.state(deviceId);
    if (busy(current)) return;
    this.#sessions.delete(deviceId);
    this.#set(deviceId, update({ ...current, phase: 'idle', preview: null, result: null, error: null }));
  }

  setEnabled(deviceId: LaundryDevice, enabled: boolean): void {
    this.#discardPreview(deviceId, (state) => ({
      ...state,
      draft: {
        ...state.draft,
        enabled,
        mode: enabled && state.currentAdapter === null ? 'existing' : state.draft.mode,
      },
    }));
  }

  setMode(deviceId: LaundryDevice, mode: LaundryMode): void {
    this.#discardPreview(deviceId, (state) => ({ ...state, draft: { ...state.draft, mode } }));
  }

  editExisting(deviceId: LaundryDevice, patch: Partial<ExistingLaundryDraft>): void {
    this.#discardPreview(deviceId, (state) => ({
      ...state,
      draft: { ...state.draft, existing: { ...state.draft.existing, ...patch } },
    }));
  }

  editBlueprint(deviceId: LaundryDevice, patch: Partial<BlueprintLaundryDraft>): void {
    this.#discardPreview(deviceId, (state) => ({
      ...state,
      draft: { ...state.draft, blueprint: { ...state.draft.blueprint, ...patch } },
    }));
  }

  cancel(deviceId: LaundryDevice): void {
    this.#discardPreview(deviceId, (state) => state);
  }

  async preview(deviceId: LaundryDevice): Promise<void> {
    const current = this.state(deviceId);
    if (busy(current)) return;
    if (!current.draft.enabled && current.currentAdapter === null) {
      this.#sessions.delete(deviceId);
      this.#set(deviceId, { ...current, phase: 'idle', preview: null, result: null, error: null });
      return;
    }
    const validationError = validateLaundryDraft(current);
    if (validationError) {
      this.#sessions.delete(deviceId);
      this.#set(deviceId, { ...current, phase: 'error', preview: null, result: null, error: validationError });
      return;
    }
    const requestFingerprint = fingerprint(current);
    this.#sessions.delete(deviceId);
    this.#set(deviceId, { ...current, phase: 'validating', preview: null, result: null, error: null });
    try {
      let path: string;
      let body: JsonObject;
      if (!current.draft.enabled) {
        path = '/api/laundry/disable/preview';
        body = { device: deviceId };
      } else if (current.draft.mode === 'existing') {
        path = '/api/laundry/existing/validate';
        body = { device: deviceId, ...normalizedExisting(current.draft.existing) };
        delete body.type;
      } else {
        path = '/api/laundry/blueprint/preview';
        body = { device: deviceId, ...normalizedBlueprint(current.draft.blueprint) };
      }
      const payload = await post(this.#fetch, path, body);
      const parsed = !current.draft.enabled
        ? parseDisablePreview(payload, deviceId)
        : current.draft.mode === 'existing'
          ? parseExistingPreview(payload, deviceId)
          : parseBlueprintPreview(payload, deviceId);
      if (!parsed) throw new LaundryRequestError({ code: 'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE' });
      this.#sessions.set(deviceId, { kind: parsed.preview.kind, id: parsed.id, fingerprint: requestFingerprint });
      this.#set(deviceId, { ...this.state(deviceId), phase: 'preview', preview: parsed.preview, error: null });
    } catch (error) {
      const safe = sanitizeLaundryError(error instanceof LaundryRequestError ? error.payload : error);
      this.#sessions.delete(deviceId);
      this.#set(deviceId, { ...this.state(deviceId), phase: 'error', preview: null, error: safe });
    }
  }

  async apply(deviceId: LaundryDevice): Promise<void> {
    const current = this.state(deviceId);
    const session = this.#sessions.get(deviceId);
    if (current.phase !== 'preview' || !current.preview || !session
        || session.kind !== current.preview.kind || session.fingerprint !== fingerprint(current)) {
      this.#sessions.delete(deviceId);
      if (current.phase === 'preview') {
        this.#set(deviceId, { ...current, phase: 'idle', preview: null, error: null });
      }
      return;
    }
    this.#sessions.delete(deviceId);
    this.#set(deviceId, { ...current, phase: 'applying', error: null });
    try {
      const idKey = session.kind === 'existing' ? 'validationId' : 'previewId';
      const path = session.kind === 'existing'
        ? '/api/laundry/existing/apply'
        : session.kind === 'disable'
          ? '/api/laundry/disable/apply'
          : '/api/laundry/blueprint/apply';
      const payload = await post(this.#fetch, path, {
        [idKey]: session.id,
        confirmed: true,
      });
      const result = session.kind === 'existing'
        ? parseExistingResult(payload, deviceId)
        : session.kind === 'disable'
          ? parseDisableResult(payload, deviceId)
          : parseBlueprintResult(payload, deviceId);
      if (!result) throw new LaundryRequestError({ code: 'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE' });
      const previous = this.state(deviceId);
      const nextAdapter = result.kind === 'disabled'
        ? null
        : result.kind === 'existing'
          ? result.adapter
          : {
              type: 'entity' as const,
              entityId: result.helper.entityId,
              runningStates: ['running'],
              doneStates: ['done'],
              doneOnInitial: false,
            };
      this.#set(deviceId, {
        ...previous,
        phase: 'success',
        currentAdapter: nextAdapter,
        draft: {
          ...previous.draft,
          enabled: nextAdapter !== null,
          existing: nextAdapter ? {
            entityId: nextAdapter.entityId,
            runningStates: nextAdapter.runningStates.join(', '),
            doneStates: nextAdapter.doneStates.join(', '),
            doneOnInitial: nextAdapter.doneOnInitial,
          } : previous.draft.existing,
        },
        preview: null,
        result,
        error: null,
      });
    } catch (error) {
      const safe = sanitizeLaundryError(error instanceof LaundryRequestError ? error.payload : error);
      this.#set(deviceId, { ...this.state(deviceId), phase: 'error', preview: null, result: null, error: safe });
    }
  }

  async retry(deviceId: LaundryDevice): Promise<void> {
    const current = this.state(deviceId);
    if (current.phase !== 'error' || busy(current)) return;
    this.#set(deviceId, { ...current, phase: 'idle', preview: null, result: null, error: null });
    await this.preview(deviceId);
  }
}
