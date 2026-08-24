/* ── HotelBackend (ADR-017 Schichttausch) ──
   Der Gastpfad hinter demselben `Backend`-Interface wie FakeBackend und
   HaBackend: die Raumcontrols, die Command-Queue und das optimistische Overlay
   bleiben unverändert, nur die Schicht darunter wechselt.

   Anders als HaBackend hält dieses Backend keine Verbindung und kein Token. Es
   liest die Serverprojektion über den Gast-Store (state/hotel-entities) und
   schickt jede Bedienung als Absicht — Entity plus Aktion — an den Proxy, der
   sie gegen die v4-Allowlist prüft. Eine abgelehnte oder unbeantwortete
   Bedienung wird als Fehler gemeldet und nie nachgesendet. */

import type { Backend, ConnectionStatus } from './types.ts';
import {
  onHotelGuestConnection,
  onHotelGuestEntity,
  refreshHotelGuestEntities,
  startHotelGuestEntities,
} from '../state/hotel-entities.svelte.ts';

export const HOTEL_COMMAND_ENDPOINT = '/api/hotel-mode/command';
const HOTEL_COMMAND_TIMEOUT_MS = 4000;

export interface HotelBackendOptions {
  /** Seam für Tests; produktiv immer das globale `fetch`. */
  fetchImpl?: typeof fetch;
  /** Seam für Tests; produktiv das Polling des Gast-Stores. */
  startPolling?: () => () => void;
  /** Seam für Tests; produktiv der sofortige Nachabruf nach einem Befehl. */
  refresh?: () => void;
}

export class HotelBackend implements Backend {
  #onCmdErr: ((entityId: string) => void) | null = null;
  #unsubscribeEntities: (() => void) | null = null;
  #unsubscribeConnection: (() => void) | null = null;
  #stopPolling: (() => void) | null = null;
  #fetchImpl: typeof fetch;
  #startPolling: () => () => void;
  #refresh: () => void;

  constructor({ fetchImpl, startPolling, refresh }: HotelBackendOptions = {}) {
    this.#fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
    this.#startPolling = startPolling ?? (() => startHotelGuestEntities());
    this.#refresh = refresh ?? (() => { void refreshHotelGuestEntities(); });
  }

  /** Erst nach dem ersten Paint, wie beim HaBackend. */
  start(): void {
    this.#stopPolling ??= this.#startPolling();
  }

  stop(): void {
    this.#stopPolling?.();
    this.#stopPolling = null;
    this.#unsubscribeEntities?.();
    this.#unsubscribeEntities = null;
    this.#unsubscribeConnection?.();
    this.#unsubscribeConnection = null;
  }

  subscribe(onUpdate: (entityId: string, value: unknown, stale?: boolean) => void): void {
    this.#unsubscribeEntities?.();
    this.#unsubscribeEntities = onHotelGuestEntity((entityId, value) => onUpdate(entityId, value, false));
  }

  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.#unsubscribeConnection?.();
    this.#unsubscribeConnection = onHotelGuestConnection(
      (online) => cb(online ? 'connected' : 'disconnected'),
    );
  }

  onCommandError(cb: (entityId: string) => void): void {
    this.#onCmdErr = cb;
  }

  /** Der Server liefert ohnehin nur die freigegebenen Entities. */
  setVisible(): void {}

  /* Die Domain kommt bewusst nicht mit: der Proxy leitet sie aus der Entity-ID
     ab, damit ein manipulierter Client sie nicht verschieben kann. */
  callService(_domain: string, service: string, entityId: string, data: Record<string, unknown>): void {
    void this.#send(service, entityId, data);
  }

  async #send(action: string, entityId: string, data: Record<string, unknown>): Promise<void> {
    try {
      const response = await this.#fetchImpl(HOTEL_COMMAND_ENDPOINT, {
        method: 'POST',
        cache: 'no-store',
        // Gastpfad: keine Adminsitzung, kein Cookie, kein Token.
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, action, data }),
        signal: AbortSignal.timeout(HOTEL_COMMAND_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`hotel command ${response.status}`);
    } catch {
      // Kein Retry und keine Warteschlange: der optimistische Intent wird sofort
      // verworfen, statt eine nicht ausgeführte Bedienung als Erfolg zu zeigen.
      this.#onCmdErr?.(entityId);
      return;
    }
    // Home Assistant hat den Aufruf ausgeführt; der Server hat seinen kurzen
    // Cache verworfen, also holt der Nachabruf die echte Bestätigung.
    this.#refresh();
  }
}
