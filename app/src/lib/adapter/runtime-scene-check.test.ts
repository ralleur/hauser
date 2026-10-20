// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdapterRuntime } from './runtime.svelte.ts';
import { dispatchScene, sceneValueMatches } from './scene-check.ts';
import type { Backend, Command, ConnectionStatus } from './types.ts';

function harness() {
  const calls: string[] = [];
  let status: (value: ConnectionStatus) => void = () => {};
  const readStates = vi.fn(async (_ids: readonly string[]): Promise<Record<string, unknown>> => ({
    'light.a': { on: true }, 'light.b': { on: false },
  }));
  const backend: Backend = {
    subscribe() {},
    onConnectionChange(cb) { status = cb; cb('connected'); },
    callService(_domain, service, id) { calls.push(`${id}:${service}`); },
    readStates,
    async listScenes() { return []; },
  };
  const runtime = new AdapterRuntime(backend);
  const command = (id: string, on = false): Command => ({
    domain: 'light', service: on ? 'turn_on' : 'turn_off', entityId: id, data: {}, queuedAt: Date.now(),
  });
  return { runtime, calls, readStates, command, status: (value: ConnectionStatus) => status(value) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('Szenen bleiben bis zur tatsächlichen Umsetzung überwacht', () => {
  it('sendet nur abweichende Mitglieder erneut bis alle zusammen bestätigt sind', async () => {
    const { runtime, calls, readStates, command } = harness();
    const run = Symbol('scene');
    readStates.mockResolvedValueOnce({ 'light.a': { on: true }, 'light.b': { on: false } })
      .mockResolvedValueOnce({ 'light.a': { on: false }, 'light.b': { on: true } })
      .mockResolvedValue({ 'light.a': { on: false }, 'light.b': { on: false } });
    dispatchScene(runtime, command('light.a'), { on: false }, run);
    dispatchScene(runtime, command('light.b'), { on: false }, run);
    expect(runtime.merged('light.a')).toEqual({ on: false });
    await vi.advanceTimersByTimeAsync(1800);
    expect(readStates).toHaveBeenCalledExactlyOnceWith(['light.a', 'light.b']);
    expect(calls).toEqual(['light.a:turn_off', 'light.b:turn_off', 'light.a:turn_off']);
    await vi.advanceTimersByTimeAsync(1800);
    expect(calls).toEqual(['light.a:turn_off', 'light.b:turn_off', 'light.a:turn_off', 'light.b:turn_off']);
    await vi.advanceTimersByTimeAsync(1800);
    expect(readStates).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(4);
    expect(readStates).toHaveBeenCalledTimes(3);
  });

  it.each(['dispatch', 'send'] as const)('lässt spätere Eingriffe über %s gewinnen', async (method) => {
    const { runtime, calls, command } = harness();
    dispatchScene(runtime, command('light.a'), { on: false });
    await Promise.resolve();
    if (method === 'send') runtime.send(command('light.a', true));
    else runtime.dispatch(command('light.a', true), { on: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toEqual(['light.a:turn_off', 'light.a:turn_on']);
  });

  it('verwirft eine alte Nachprüfung auch während des Zustandsabrufs', async () => {
    const { runtime, calls, readStates, command } = harness();
    let resolve!: (values: Record<string, unknown>) => void;
    readStates.mockImplementation(() => new Promise((done) => { resolve = done; }));
    dispatchScene(runtime, command('light.a'), { on: false });
    await vi.advanceTimersByTimeAsync(1800);
    runtime.dispatch(command('light.a', true), { on: true });
    resolve({ 'light.a': { on: true } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toEqual(['light.a:turn_off', 'light.a:turn_on']);
  });

  it('beginnt die Wartezeit erst nach dem Versand bei Wiederverbindung', async () => {
    const { runtime, calls, command, status } = harness();
    status('reconnecting');
    dispatchScene(runtime, command('light.a'), { on: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([]);
    status('connected');
    await vi.advanceTimersByTimeAsync(1800);
    expect(calls).toEqual(['light.a:turn_off', 'light.a:turn_off']);
  });

  it('überwacht fehlende Zustände und Lesefehler weiter, bis das Gerät bestätigt ist', async () => {
    const { runtime, calls, readStates, command } = harness();
    readStates.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ 'light.a': { on: true } })
      .mockResolvedValue({ 'light.a': { on: false } });
    dispatchScene(runtime, command('light.a'), { on: false });
    await vi.advanceTimersByTimeAsync(3600);
    expect(calls).toEqual(['light.a:turn_off']);
    await vi.advanceTimersByTimeAsync(3600);
    expect(calls).toEqual(['light.a:turn_off', 'light.a:turn_off']);
    expect(readStates).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(readStates).toHaveBeenCalledTimes(4);
  });

  it('setzt eine laufende Überwachung nach einer Verbindungsunterbrechung fort', async () => {
    const { runtime, calls, readStates, command, status } = harness();
    dispatchScene(runtime, command('light.a'), { on: false });
    await vi.advanceTimersByTimeAsync(1800);
    status('reconnecting');
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    readStates.mockResolvedValue({ 'light.a': { on: false } });
    status('connected');
    await vi.advanceTimersByTimeAsync(1800);
    expect(readStates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(readStates).toHaveBeenCalledTimes(2);
  });

  it('gibt ein Gerät frei, das den Zielwert nie meldet, statt die Fernbedienung zu überstimmen', async () => {
    const { runtime, calls, readStates, command } = harness();
    // Funksteckdose als Template-Licht: kennt keine Helligkeit, die Fernbedienung schaltet aus.
    readStates.mockResolvedValue({ 'light.funk': { on: false, brightness: 0 } });
    dispatchScene(runtime, command('light.funk', true), { on: true, brightness: 40 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(['light.funk:turn_on', 'light.funk:turn_on', 'light.funk:turn_on']);
    expect(readStates).toHaveBeenCalledTimes(3);
  });

  it('akzeptiert Rundung und prüft Helligkeit, Temperatur und Farbe', () => {
    expect(sceneValueMatches({ on: true, brightness: 50, colorTemp: 2700, color: null },
      { on: true, brightness: 51, colorTemp: 2740, color: '#ffccaa' })).toBe(true);
    expect(sceneValueMatches({ on: true, brightness: 50 }, { on: true, brightness: 40 })).toBe(false);
    expect(sceneValueMatches({ on: true, colorTemp: 2700 }, { on: true, colorTemp: 3000 })).toBe(false);
    expect(sceneValueMatches({ on: true, color: '#ffccaa' }, { on: true, color: '#00ccaa' })).toBe(false);
  });
});
