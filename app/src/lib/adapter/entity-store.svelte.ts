/* ============================================
   EntityStore (ADR-015 Schicht 2) — Server-Wahrheit als reaktive Signale.
   Flach (entity_id → EntityState), damit der HA-Anschluss ein reiner
   Schichttausch bleibt (ADR-017). SvelteMap macht get()/set() feingranular
   reaktiv: die UI liest über die gemergte Sicht und re-rendert nur die
   Knoten der geänderten Entität — kein Screen-weites Re-Render.
   ============================================ */

import { SvelteMap } from 'svelte/reactivity';
import type { EntityState } from './types.ts';

export class EntityStore {
  #entities = new SvelteMap<string, EntityState>();

  get(entityId: string): EntityState | undefined {
    return this.#entities.get(entityId);
  }

  /** Push aus der Backend-Subscription (bzw. Fake-Echo). */
  set(entityId: string, value: unknown, stale = false, available = true): void {
    const previous = this.#entities.get(entityId);
    this.#entities.set(entityId, !available && previous
      ? { ...previous, available: false }
      : { entityId, value, updatedAt: Date.now(), stale, available });
  }

  has(entityId: string): boolean {
    return this.#entities.has(entityId);
  }
}
