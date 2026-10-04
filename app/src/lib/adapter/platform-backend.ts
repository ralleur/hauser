/* Plattform-Backend (Plan 21, Stufe 3): Apple Home / Google Home als
   Zuhause-Quelle — ohne Server. Die App reicht über `window.HauserNative.home`
   einen Schnappschuss und Merkmal-Änderungen herein; dieses Backend
   übersetzt beides in Hausers Entity-Modell und schreibt Befehle zurück. */
import type { HomeBridge, HomeSnapshot } from '../native/bridge.ts';
import type { EntityCatalogItem } from '../state/fake-discovery-catalog.ts';
import { platformEntities, platformValue, platformWrites, type PlatformEntity } from './platform-entities.ts';
import type { Backend, ConnectionStatus } from './types.ts';

/* Die HomeKit-Rampe bleibt beim nachgeladenen Backend. Die Dauer gilt für
   schnelle Antworten; langsamere Geräte behalten jede Stufe. */
const HOMEKIT_DIMMING_SECONDS = 0.42;
const HOMEKIT_DIMMING_STEPS = 16;

export class PlatformBackend implements Backend {
  #home: HomeBridge;
  #entities = new Map<string, PlatformEntity>();
  #byCharacteristic = new Map<string, PlatformEntity>();
  #push: ((entityId: string, value: unknown, stale?: boolean) => void) | null = null;
  #status: ConnectionStatus = 'connecting';
  #statusListeners = new Set<(status: ConnectionStatus) => void>();
  #errorListeners = new Set<(entityId: string, commandId?: number) => void>();
  #catalogListeners = new Set<(items: unknown[]) => void>();
  #unsubscribe: (() => void) | null = null;
  #lightCommands = new Map<string, { controller: AbortController; done: Promise<void> }>();

  constructor(home: HomeBridge) {
    this.#home = home;
  }

  start(): void {
    void this.#load();
    this.#unsubscribe?.();
    this.#unsubscribe = this.#home.onChange((characteristicId, value) => {
      const entity = this.#byCharacteristic.get(characteristicId);
      if (!entity) return;
      const characteristic = entity.service.characteristics.find((c) => c.id === characteristicId);
      if (characteristic) characteristic.value = value;
      // Zwischenwerte einer Dimmfahrt sind kein Widerspruch zum UI-Zielwert.
      if (!this.#lightCommands.has(entity.entityId)) this.#push?.(entity.entityId, platformValue(entity));
    });
  }

  async #load(): Promise<void> {
    let snapshot: HomeSnapshot;
    try {
      snapshot = await this.#home.snapshot();
    } catch {
      this.#setStatus('disconnected');
      return;
    }
    this.#entities.clear();
    this.#byCharacteristic.clear();
    for (const home of snapshot.homes) {
      for (const entity of platformEntities(home.accessories)) {
        this.#entities.set(entity.entityId, entity);
        for (const c of entity.service.characteristics) this.#byCharacteristic.set(c.id, entity);
      }
    }
    for (const entity of this.#entities.values()) this.#push?.(entity.entityId, platformValue(entity));
    this.#setStatus(snapshot.authorized ? 'connected' : 'disconnected');
    this.#emitCatalog();
  }

  subscribe(onUpdate: (entityId: string, value: unknown, stale?: boolean) => void): void {
    this.#push = onUpdate;
    for (const entity of this.#entities.values()) onUpdate(entity.entityId, platformValue(entity));
  }

  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>, commandId?: number): void {
    const entity = this.#entities.get(entityId);
    if (!entity) return;
    const writes = platformWrites(entity, domain, service, data);
    if (writes.length === 0) return;
    if (domain === 'light' && (service === 'turn_on' || service === 'turn_off')) {
      const previous = this.#lightCommands.get(entityId);
      previous?.controller.abort();
      const controller = new AbortController();
      const command = { controller, done: Promise.resolve() };
      this.#lightCommands.set(entityId, command);
      command.done = (async () => {
        await previous?.done;
        if (controller.signal.aborted) return;
        try {
          for (const w of writes) {
            if (controller.signal.aborted) return;
            const c = entity.service.characteristics.find((x) => x.id === w.characteristicId);
            // Eine bereits leuchtende Lampe nach dem Dimmen nicht erneut einschalten.
            if (c?.type === 'power' && c.value === true && w.value === true) continue;
            const send = async (value: unknown) => {
              await this.#home.write(w.characteristicId, value);
              if (c) c.value = value;
            };
            if (c?.type === 'brightness' && typeof c.value === 'number' && typeof w.value === 'number'
              && entity.service.characteristics.some((x) => x.type === 'power' && x.value === true)) {
              await dimBrightness(c.value, w.value, controller.signal, send);
            } else await send(w.value);
          }
          if (!controller.signal.aborted) this.#push?.(entityId, platformValue(entity));
        } catch {
          if (!controller.signal.aborted) for (const cb of this.#errorListeners) cb(entityId, commandId);
        } finally {
          if (this.#lightCommands.get(entityId) === command) this.#lightCommands.delete(entityId);
        }
      })();
      return;
    }
    void Promise.all(writes.map((w) => this.#home.write(w.characteristicId, w.value)))
      .then(() => {
        for (const w of writes) {
          const c = entity.service.characteristics.find((x) => x.id === w.characteristicId);
          if (c) c.value = w.value;
        }
        this.#push?.(entityId, platformValue(entity));
      })
      .catch(() => { for (const cb of this.#errorListeners) cb(entityId, commandId); });
  }

  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.#statusListeners.add(cb);
    cb(this.#status);
  }

  retry(): void {
    void this.#load();
  }

  onCommandError(cb: (entityId: string, commandId?: number) => void): void {
    this.#errorListeners.add(cb);
  }

  subscribeCatalog(cb: (items: unknown[]) => void): void {
    this.#catalogListeners.add(cb);
    cb(this.#catalog());
  }

  #catalog(): EntityCatalogItem[] {
    const items: EntityCatalogItem[] = [];
    for (const entity of this.#entities.values()) {
      if (entity.domain !== 'light' && entity.domain !== 'switch' && entity.domain !== 'fan' && entity.domain !== 'cover' && entity.domain !== 'lock' && entity.domain !== 'climate') continue;
      const has = (type: string) => entity.service.characteristics.some((c) => c.type === type);
      items.push({
        entityId: entity.entityId,
        domain: entity.domain as EntityCatalogItem['domain'],
        name: entity.service.name || entity.accessory.name,
        area: null,
        capabilities: entity.domain === 'light'
          ? { dimmable: has('brightness'), colorTemp: has('colorTemperature'), color: has('hue') }
          : undefined,
      });
    }
    return items;
  }

  #emitCatalog(): void {
    const items = this.#catalog();
    for (const cb of this.#catalogListeners) cb(items);
  }

  #setStatus(status: ConnectionStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const cb of this.#statusListeners) cb(status);
  }
}

/* Apple-Home-Bridges schreiben Helligkeit direkt, ohne HA-Transition. Ein
   neuer Befehl bricht die Zwischenwerte ab und wartet nur den laufenden Write ab. */
async function dimBrightness(from: number, target: number, signal: AbortSignal, write: (value: number) => Promise<void>): Promise<void> {
  const steps = Math.min(HOMEKIT_DIMMING_STEPS, Math.ceil(Math.abs(target - from)));
  if (steps === 0) return;
  const interval = HOMEKIT_DIMMING_SECONDS * 1000 / steps;
  let sent = from;
  for (let step = 1; step <= steps; step += 1) {
    if (signal.aborted) return;
    const tick = performance.now();
    const progress = step / steps;
    const eased = progress * progress * (3 - 2 * progress);
    const value = Math.round(from + (target - from) * eased);
    if (value !== sent) { await write(value); sent = value; }
    if (sent === target || signal.aborted) return;
    const pause = Math.max(0, interval - (performance.now() - tick));
    if (pause > 0) await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, pause);
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
