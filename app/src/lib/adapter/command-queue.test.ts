/* Command-Dedup (docs/02): kein Doppelklick-Bug — nur der letzte Command
   pro Entität wird ausgeführt. */

import { describe, it, expect } from 'vitest';
import { enqueue, dequeue } from './command-queue.ts';
import type { Command } from './types.ts';

const T0 = 1_000_000;

function cmd(entityId: string, service: string, queuedAt: number): Command {
  return { entityId, domain: 'light', service, data: {}, queuedAt };
}

describe('CommandQueue — Dedup pro Entität', () => {
  it('Doppelklick: zweiter Command ersetzt den pending der Entität', () => {
    let q = enqueue([], cmd('light.a', 'turn_on', T0));
    q = enqueue(q, cmd('light.a', 'turn_off', T0 + 120));
    expect(q).toHaveLength(1);
    expect(q[0].service).toBe('turn_off'); // nur der letzte wird ausgeführt
  });

  it('Commands verschiedener Entitäten bleiben beide erhalten', () => {
    let q = enqueue([], cmd('light.a', 'turn_on', T0));
    q = enqueue(q, cmd('light.b', 'turn_on', T0 + 50));
    expect(q).toHaveLength(2);
  });

  it('dequeue entfernt nur die versendete Entität', () => {
    let q = enqueue([], cmd('light.a', 'turn_on', T0));
    q = enqueue(q, cmd('light.b', 'turn_on', T0 + 50));
    q = dequeue(q, 'light.a');
    expect(q.map((c) => c.entityId)).toEqual(['light.b']);
  });
});
