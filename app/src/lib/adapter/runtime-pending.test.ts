import { describe, expect, it, vi } from 'vitest';
import { AdapterRuntime } from './runtime.svelte.ts';
import type { Backend, Command, ConnectionStatus } from './types.ts';

/* B-27 E1: Nach dem App-Start greift der Nutzer zu, bevor der Kanal steht.
   `connecting`/`reconnecting` nimmt deshalb an und stellt beim Verbindungs-
   aufbau zu; nur endgültig `disconnected` sperrt wie bisher (docs/02). */
function harness(initial: ConnectionStatus) {
  const calls: Array<[string, string, string]> = [];
  let emit: (status: ConnectionStatus) => void = () => {};
  const backend: Backend = {
    subscribe() { /* kein Seed nötig */ },
    callService(domain, service, entityId) { calls.push([domain, service, entityId]); },
    onConnectionChange(cb) { emit = cb; cb(initial); },
  };
  return { runtime: new AdapterRuntime(backend), calls, setStatus: (s: ConnectionStatus) => emit(s) };
}

const cmd: Command = { domain: 'light', service: 'turn_on', entityId: 'light.flur', data: {}, queuedAt: 0 };

describe('Befehle vor dem Verbindungsaufbau', () => {
  it('nimmt den Griff an und stellt ihn beim Verbinden zu', async () => {
    const { runtime, calls, setStatus } = harness('connecting');
    runtime.dispatch(cmd, { on: true });
    expect(calls).toEqual([]);
    /* Der optimistische Zustand ist sofort sichtbar — darum geht es. */
    expect(runtime.intentStatus('light.flur')).toBe('inflight');

    setStatus('connected');
    await Promise.resolve();
    expect(calls).toEqual([['light', 'turn_on', 'light.flur']]);
  });

  it('lässt den letzten Griff gewinnen, statt beide zu senden', async () => {
    const { runtime, calls, setStatus } = harness('connecting');
    runtime.dispatch(cmd, { on: true });
    runtime.dispatch({ ...cmd, service: 'turn_off' }, { on: false });
    setStatus('connected');
    await Promise.resolve();
    expect(calls).toEqual([['light', 'turn_off', 'light.flur']]);
  });

  it('startet die Uhren erst beim Absenden, nicht beim Warten', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, setStatus } = harness('connecting');
      runtime.dispatch(cmd, { on: true });
      /* Weit über beide Schwellen hinaus warten, ohne Verbindung. */
      vi.advanceTimersByTime(30_000);
      expect(runtime.intentStatus('light.flur')).toBe('inflight');
      setStatus('connected');
      await Promise.resolve();
      vi.advanceTimersByTime(1_100);
      expect(runtime.intentStatus('light.flur')).toBe('unconfirmed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('verwirft Wartende und den optimistischen Zustand bei endgültiger Trennung', async () => {
    const { runtime, calls, setStatus } = harness('connecting');
    runtime.dispatch(cmd, { on: true });
    setStatus('disconnected');
    expect(runtime.intentStatus('light.flur')).toBe(null);
    setStatus('connected');
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('sperrt einen Griff, der im getrennten Zustand beginnt', async () => {
    const { runtime, calls } = harness('disconnected');
    runtime.dispatch(cmd, { on: true });
    runtime.send(cmd);
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(runtime.intentStatus('light.flur')).toBe(null);
  });
});
