// SPDX-License-Identifier: AGPL-3.0-only
import type { Command } from './types.ts';
import type { AdapterRuntime } from './runtime.svelte.ts';

export interface SceneCheck {
  command: Command;
  optimistic: unknown;
  run: symbol;
  /** Bisherige Wiederholungen; nach MAX_SCENE_RETRIES gibt die Szene das Gerät frei. */
  retries?: number;
}

/* Ein Gerät, das den Zielwert nie meldet (Funksteckdose ohne Rückkanal, Lampe
   ohne Dimmer), darf nicht endlos nachgeschaltet werden: sonst überstimmt Hauser
   jede Fernbedienung im Haus (simon42, Cpt.Hardy, 2026-10-19). */
export const MAX_SCENE_RETRIES = 2;

/** HA rundet Helligkeit und Lampen rastern Farben/Temperaturen. */
export function sceneValueMatches(target: unknown, value: unknown): boolean {
  if (!target || !value || typeof target !== 'object' || typeof value !== 'object') return false;
  const expected = target as Record<string, unknown>;
  const actual = value as Record<string, unknown>;
  if (actual.on !== expected.on) return false;
  if (expected.on === false) return true;
  return Object.entries(expected).every(([key, wanted]) => {
    if (key === 'color' && wanted === null) return true;
    if (key === 'brightness' || key === 'colorTemp') {
      return typeof wanted === 'number' && typeof actual[key] === 'number'
        && Math.abs(wanted - actual[key]) <= (key === 'brightness' ? 2 : 60);
    }
    if (key === 'color' && typeof wanted === 'string' && typeof actual[key] === 'string') {
      return [1, 3, 5].every((at) => Math.abs(parseInt(wanted.slice(at, at + 2), 16)
        - parseInt((actual[key] as string).slice(at, at + 2), 16)) <= 8);
    }
    return Object.is(wanted, actual[key]);
  });
}


/** Nur bei Szenen geladen: bestätigen, sonst abweichende Mitglieder erneut senden. */
export async function checkSceneTargets(
  pending: Map<string, SceneCheck>,
  read: (ids: string[]) => Promise<Record<string, unknown>>,
  connected: () => boolean,
  retry: (check: SceneCheck) => void,
): Promise<void> {
  const checks = [...pending.entries()];
  if (!checks.length || !connected()) return;
  const values = await read(checks.map(([id]) => id));
  if (!connected()) return;
  const active = checks.filter(([id, check]) => pending.get(id) === check);
  // Erst fertig, wenn alle noch geltenden Ziele einer Szene gemeinsam passen.
  for (const run of new Set(active.map(([, check]) => check.run))) {
    const members = active.filter(([, check]) => check.run === run);
    if (members.every(([id, check]) => sceneValueMatches(check.optimistic, values[id]))) {
      for (const [id] of members) pending.delete(id);
    }
  }
  for (const [id, check] of active) {
    if (pending.get(id) !== check || values[id] === undefined) continue;
    if (!sceneValueMatches(check.optimistic, values[id])) {
      const retries = (check.retries ?? 0) + 1;
      if (retries > MAX_SCENE_RETRIES) { pending.delete(id); continue; }
      retry(check);
      pending.set(id, { ...check, retries });
    }
  }
}


export class SceneMonitor {
  #pending = new Map<string, SceneCheck>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #busy = false;
  #disposed = false;

  constructor(
    private read: (ids: string[]) => Promise<Record<string, unknown>>,
    private connected: () => boolean,
    private retry: (check: SceneCheck) => void,
  ) {}

  add(check: SceneCheck): void {
    this.#disposed = false;
    this.#pending.set(check.command.entityId, check);
    this.resume();
  }

  resume(): void {
    if (this.#disposed || !this.#pending.size) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.#check(); }, 1800);
  }

  cancel(entityId: string): void {
    this.#pending.delete(entityId);
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#pending.clear();
  }

  async #check(): Promise<void> {
    if (this.#disposed || this.#busy) return;
    if (!this.connected()) { this.resume(); return; }
    this.#busy = true;
    try {
      await checkSceneTargets(this.#pending, this.read,
        () => !this.#disposed && this.connected(), this.retry);
    } catch {
      // Lesefehler bestätigen die Szene nicht; nach Wiederverbindung weiter prüfen.
    } finally {
      this.#busy = false;
      this.resume();
    }
  }
}


const monitors = new WeakMap<AdapterRuntime, SceneMonitor>();

function monitorFor(runtime: AdapterRuntime): SceneMonitor {
  const existing = monitors.get(runtime);
  if (existing) return existing;
  const monitor = new SceneMonitor(
    async (ids) => {
      const values = await runtime.readStates(ids);
      // Der HA-Szenenkanal liefert einen frischen Abruf. Demo/Plattform ohne
      // diesen Kanal bestätigen über echte Backend-Echos, niemals die UI-Intents.
      if (runtime.canImportScenes) return values;
      for (const id of ids) {
        const state = runtime.store.get(id);
        if (values[id] === undefined && state && !state.stale) values[id] = state.value;
      }
      return values;
    },
    () => runtime.connectionStatus === 'connected',
    (target) => runtime.dispatch({ ...target.command, queuedAt: Date.now() }, target.optimistic),
  );
  // Diese Hooks werden erst beim ersten Szenenaufruf installiert. Jeder spätere
  // Eingriff hebt den alten Zielzustand auf, auch während ein Abruf läuft.
  const dispatch = runtime.dispatch.bind(runtime);
  const send = runtime.send.bind(runtime);
  const setBackend = runtime.setBackend.bind(runtime);
  runtime.dispatch = (command, optimistic) => {
    monitor.cancel(command.entityId);
    dispatch(command, optimistic);
  };
  runtime.send = (command) => {
    monitor.cancel(command.entityId);
    send(command);
  };
  runtime.setBackend = (backend) => {
    monitor.dispose();
    setBackend(backend);
  };
  monitors.set(runtime, monitor);
  return monitor;
}

export function dispatchScene(runtime: AdapterRuntime, command: Command, optimistic: unknown, run = Symbol('scene')): void {
  const monitor = monitorFor(runtime);
  runtime.dispatch(command, optimistic);
  if (runtime.connectionStatus !== 'disconnected') monitor.add({ command, optimistic, run });
}
