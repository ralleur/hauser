/* Schlanke Hülle für den Startpfad: das eigentliche Plattform-Backend samt
   Übersetzung wird erst beim Start nachgeladen. Bis dahin puffert die Hülle
   Abonnements und Befehle. */
import type { HomeBridge } from '../native/bridge.ts';
import type { Backend, ConnectionStatus } from './types.ts';

export class LazyPlatformBackend implements Backend {
  #home: HomeBridge;
  #inner: Backend | null = null;
  #queue: Array<(backend: Backend) => void> = [];

  constructor(home: HomeBridge) {
    this.#home = home;
  }

  #run(action: (backend: Backend) => void): void {
    if (this.#inner) action(this.#inner);
    else this.#queue.push(action);
  }

  start(): void {
    void import('./platform-backend.ts').then(({ PlatformBackend }) => {
      const inner = new PlatformBackend(this.#home);
      this.#inner = inner;
      for (const action of this.#queue.splice(0)) action(inner);
      inner.start();
    });
  }

  subscribe(onUpdate: (entityId: string, value: unknown, stale?: boolean) => void): void {
    this.#run((b) => b.subscribe(onUpdate));
  }

  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>): void {
    this.#run((b) => b.callService(domain, service, entityId, data));
  }

  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    cb('connecting');
    this.#run((b) => b.onConnectionChange(cb));
  }

  retry(): void {
    this.#run((b) => b.retry?.());
  }

  onCommandError(cb: (entityId: string) => void): void {
    this.#run((b) => b.onCommandError?.(cb));
  }

  subscribeCatalog(cb: (items: unknown[]) => void): void {
    this.#run((b) => b.subscribeCatalog?.(cb));
  }
}
