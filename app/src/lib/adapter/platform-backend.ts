/* Plattform-Backend (Plan 21, Stufe 3): Apple Home / Google Home als
   Zuhause-Quelle — ohne Server. Die App reicht über `window.HauserNative.home`
   einen Schnappschuss und Merkmal-Änderungen herein; dieses Backend
   übersetzt beides in Hausers Entity-Modell und schreibt Befehle zurück. */
import type { HomeBridge, HomeSnapshot } from '../native/bridge.ts';
import type { EntityCatalogItem } from '../state/fake-discovery-catalog.ts';
import { platformEntities, platformValue, platformWrites, type PlatformEntity } from './platform-entities.ts';
import type { Backend, ConnectionStatus } from './types.ts';

export class PlatformBackend implements Backend {
  #home: HomeBridge;
  #entities = new Map<string, PlatformEntity>();
  #byCharacteristic = new Map<string, PlatformEntity>();
  #push: ((entityId: string, value: unknown, stale?: boolean) => void) | null = null;
  #status: ConnectionStatus = 'connecting';
  #statusListeners = new Set<(status: ConnectionStatus) => void>();
  #errorListeners = new Set<(entityId: string) => void>();
  #catalogListeners = new Set<(items: unknown[]) => void>();
  #unsubscribe: (() => void) | null = null;

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
      this.#push?.(entity.entityId, platformValue(entity));
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

  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>): void {
    const entity = this.#entities.get(entityId);
    if (!entity) return;
    const writes = platformWrites(entity, domain, service, data);
    if (writes.length === 0) return;
    void Promise.all(writes.map((w) => this.#home.write(w.characteristicId, w.value)))
      .then(() => {
        for (const w of writes) {
          const c = entity.service.characteristics.find((x) => x.id === w.characteristicId);
          if (c) c.value = w.value;
        }
        this.#push?.(entityId, platformValue(entity));
      })
      .catch(() => { for (const cb of this.#errorListeners) cb(entityId); });
  }

  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.#statusListeners.add(cb);
    cb(this.#status);
  }

  retry(): void {
    void this.#load();
  }

  onCommandError(cb: (entityId: string) => void): void {
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
