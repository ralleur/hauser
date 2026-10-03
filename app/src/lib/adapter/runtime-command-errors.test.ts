import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterRuntime } from './runtime.svelte.ts';
import type { Backend, Command, ConnectionStatus } from './types.ts';

const command: Command = { domain: 'light', service: 'turn_on', entityId: 'light.review', data: { brightness_pct: 20 }, queuedAt: 0 };

function harness() {
  let reject: (entityId: string, commandId?: number) => void = () => {};
  let setStatus: (status: ConnectionStatus) => void = () => {};
  const calls: { brightness: unknown; commandId?: number }[] = [];
  const backend: Backend = {
    subscribe() {},
    onConnectionChange(cb) { setStatus = cb; cb('connected'); },
    onCommandError(cb) { reject = cb; },
    callService(_domain, _service, _id, data, commandId) { calls.push({ brightness: data.brightness_pct, commandId }); },
  };
  const runtime = new AdapterRuntime(backend);
  runtime.store.set(command.entityId, { on: true, brightness: 10 });
  const dispatch = (brightness: number) => runtime.dispatch({ ...command, data: { brightness_pct: brightness } }, { on: true, brightness });
  return { runtime, calls, dispatch, reject: (id?: number) => reject(command.entityId, id), setStatus: (status: ConnectionStatus) => setStatus(status) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Befehlsfehler gehören zum jeweiligen Wunschwert', () => {
  it.each(['gesendet', 'in der Queue', 'wartet auf Verbindung'])('ignoriert den alten Fehler, wenn der neue Wunsch %s ist', async (state) => {
    const { runtime, calls, dispatch, reject, setStatus } = harness();
    dispatch(20);
    await Promise.resolve();
    if (state === 'wartet auf Verbindung') setStatus('reconnecting');
    dispatch(80);
    if (state === 'gesendet') await Promise.resolve();
    reject(calls[0].commandId);
    expect(runtime.merged(command.entityId)).toEqual({ on: true, brightness: 80 });
    expect(runtime.intentStatus(command.entityId)).toBe('inflight');
    expect(runtime.reconcileEvent(command.entityId)).toBeNull();
    if (state === 'wartet auf Verbindung') setStatus('connected');
    await Promise.resolve();
    expect(calls.map((call) => call.brightness)).toEqual([20, 80]);
    expect(calls[0].commandId).not.toBe(calls[1].commandId);
    vi.advanceTimersByTime(1_100);
    expect(runtime.intentStatus(command.entityId)).toBe('unconfirmed');
    reject(calls[1].commandId);
    expect(runtime.merged(command.entityId)).toEqual({ on: true, brightness: 10 });
    expect(runtime.intentStatus(command.entityId)).toBeNull();
    expect(runtime.reconcileEvent(command.entityId)?.optimistic).toEqual({ on: true, brightness: 80 });
  });

  it('lässt den deduplizierten aktuellen Befehl weiterhin zurückrollen', async () => {
    const { runtime, calls, dispatch, reject } = harness();
    dispatch(20);
    dispatch(80);
    await Promise.resolve();
    expect(calls.map((call) => call.brightness)).toEqual([80]);
    reject(calls[0].commandId);
    expect(runtime.intentStatus(command.entityId)).toBeNull();
    expect(runtime.merged(command.entityId)).toEqual({ on: true, brightness: 10 });
  });

  it('verwirft keinen Wunsch wegen eines Befehls ohne optimistischen Wert', async () => {
    const { runtime, calls, dispatch, reject } = harness();
    runtime.send(command);
    await Promise.resolve();
    dispatch(80);
    await Promise.resolve();
    reject(calls[0].commandId);
    expect(runtime.merged(command.entityId)).toEqual({ on: true, brightness: 80 });
    expect(runtime.intentStatus(command.entityId)).toBe('inflight');
  });
});
