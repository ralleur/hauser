import { describe, expect, it } from 'vitest';
import { AdapterRuntime } from './runtime.svelte.ts';
import type { Backend } from './types.ts';

/* Stresshaus, Unruhe (2026-09-24): Ein Gerät verschwindet, während sein
   Befehl unterwegs ist — Home Assistant lädt eine Integration neu. Ohne
   Server-Wert darf kein Widerspruch entstehen; Kachel, Detail und Klimakarte
   lasen sonst `.on` von nichts und stürzten ab. */
describe('Gerät verschwindet während eines Befehls', () => {
  it('verwirft den Intent, meldet aber keinen Widerspruch ohne Server-Wert', async () => {
    let push: (entityId: string, value: unknown) => void = () => {};
    const backend: Backend = {
      subscribe(cb) { push = cb; },
      callService() { /* HA antwortet nicht */ },
      onConnectionChange(cb) { cb('connected'); },
    };
    const runtime = new AdapterRuntime(backend);
    push('light.flur', { on: false, brightness: 0 });
    runtime.dispatch({ domain: 'light', service: 'turn_on', entityId: 'light.flur', data: {}, queuedAt: 0 }, { on: true });
    await Promise.resolve();
    push('light.flur', undefined);
    expect(runtime.reconcileEvent('light.flur')).toBeNull();
    expect(runtime.intentStatus('light.flur')).not.toBe('inflight');
  });
});
