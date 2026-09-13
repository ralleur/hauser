import { describe, expect, it } from 'vitest';
import { AdapterRuntime, mergeGroupValues } from './runtime.svelte.ts';
import type { Backend } from './types.ts';

/* Gerätegruppen (2026-09-13): eine `group.*`-Entität liest gemischt aus
   ihren Mitgliedern und schreibt denselben Befehl an alle. */
function harness() {
  const calls: Array<[string, string, string, unknown]> = [];
  let push: (id: string, value: unknown) => void = () => {};
  const backend: Backend = {
    subscribe(cb) { push = cb; },
    callService(domain, service, entityId, data) { calls.push([domain, service, entityId, data]); },
    onConnectionChange(cb) { cb('connected'); },
  };
  const runtime = new AdapterRuntime(backend);
  runtime.setGroupResolver((id) => (id === 'group.hauser_1' ? ['light.a', 'light.b'] : null));
  return { runtime, calls, push: (id: string, value: unknown) => push(id, value) };
}

describe('Gerätegruppen in der Laufzeit', () => {
  it('mischt die Mitglieder: an, sobald eines an ist, Helligkeit als Maximum', () => {
    expect(mergeGroupValues([{ on: false, brightness: 0 }, { on: true, brightness: 40 }])).toEqual({ on: true, brightness: 40 });
    expect(mergeGroupValues([{ on: true, brightness: 20 }, { on: true, brightness: 70 }])).toEqual({ on: true, brightness: 70 });
    expect(mergeGroupValues([{ on: false, brightness: 30 }, { on: false, brightness: 10 }])).toEqual({ on: false, brightness: 30 });
    expect(mergeGroupValues([undefined, undefined])).toBeUndefined();
  });

  it('liest die Gruppe aus dem Store der Mitglieder', () => {
    const { runtime, push } = harness();
    push('light.a', { on: false, brightness: 0 });
    push('light.b', { on: true, brightness: 55 });
    expect(runtime.merged('group.hauser_1')).toEqual({ on: true, brightness: 55 });
  });

  it('verteilt einen Griff an alle Mitglieder mit demselben Wert', async () => {
    const { runtime, calls } = harness();
    runtime.dispatch(
      { entityId: 'group.hauser_1', domain: 'light', service: 'turn_on', data: { brightness_pct: 60 }, queuedAt: 0 },
      { on: true, brightness: 60 },
    );
    expect(runtime.intentStatus('group.hauser_1')).toBe('inflight');
    expect(runtime.merged('group.hauser_1')).toEqual({ on: true, brightness: 60 });
    await Promise.resolve();
    expect(calls).toEqual([
      ['light', 'turn_on', 'light.a', { brightness_pct: 60 }],
      ['light', 'turn_on', 'light.b', { brightness_pct: 60 }],
    ]);
  });
});
