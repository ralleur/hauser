/* ============================================
   HaBackend (ADR-018) — Schicht-1-Implementierung des Backend-Interfaces über
   den offiziellen Client `home-assistant-js-websocket` (v9.6.0, Apache-2.0).
   Ersetzt das FakeBackend im Runtime-Singleton; UI/EntityStore/CommandQueue/
   Overlay bleiben unangetastet (reiner Schichttausch).

   - Auth: Long-Lived Token aus localStorage (Login-Screen), nie im Repo/Build.
   - Reconnect: von der Library; `ready`/`disconnected`/`reconnect-error` →
     ConnectionStatus (ADR-017 Addendum).
   - Selektives Abo (ADR-006): `subscribe_entities` NUR der gemappten Entitäten,
     nicht der All-Entities-Helfer.
   - Entity-Cache (docs/04): letzte Values in localStorage → sofortiger Render,
     auch offline/vor dem ersten `ready`.
   Die Übersetzung (Diff + State→Value) liegt rein in ha-entities.ts.
   ============================================ */

import {
  createConnection,
  createLongLivedTokenAuth,
  callService,
  getStates,
  ERR_INVALID_AUTH,
  type Connection,
} from 'home-assistant-js-websocket';
import type { AuthRequiredReason, Backend, ConnectionStatus } from './types.ts';
import {
  applyEntitiesDiff,
  haToLaundryState,
  haToValue,
  type RawEntity,
  type EntitiesDiff,
} from './ha-entities.ts';
import { catalogItemFromHaState } from './capabilities.ts';
import type { EntityCatalogItem } from '../state/device-config.ts';
import type { CalendarEvent, CalendarSource } from '../state/calendar.ts';
import { calendarEventsMessage } from '../state/calendar.ts';
import type { Reminder, ReminderSource } from '../state/reminders.ts';
import { reminderListMessage } from '../state/reminders.ts';
import { sharedStorage } from '../state/shared-config.ts';
import { LAUNDRY_ENTITIES as CONFIGURED_LAUNDRY_ENTITIES } from '../config/household-runtime-data.ts';

function markHaStartup(name: 'hmi:ha-connected' | 'hmi:fresh-data', label: string): void {
  if (!import.meta.env.DEV || typeof performance === 'undefined') return;
  if (performance.getEntriesByName(name, 'mark').length > 0) return;
  performance.mark(name);
  const startMark = performance.getEntriesByName('hmi:app-start', 'mark').at(-1);
  const mark = performance.getEntriesByName(name, 'mark').at(-1);
  if (!mark || !startMark) return;
  console.debug(`[startup] ${label}: ${(mark.startTime - startMark.startTime).toFixed(1)} ms`);
  performance.measure(`hmi:app-start->${name}`, 'hmi:app-start', name);
}

const TOKEN_KEY = 'hmi:ha-token';
const CACHE_KEY = 'hmi:ha-cache';

type Unsub = () => Promise<void>;
type RetryController = { beforeStart(): void; schedule(): void; reset(): void };
type RetryFactory = (retry: () => void) => RetryController;

let createRetryController: RetryFactory | null = null;

/** Wird vom bereits post-paint geladenen Runtime-Hintergrund installiert. */
export function installHaRetryFactory(factory: RetryFactory): void {
  createRetryController = factory;
}

export interface HaBackendOptions {
  /** HA-Basis-URL oder spät gelesener Resolver, z. B. nach Shared-Config-Sync. */
  url: string | (() => string);
  /** Volle Menge der gemappten, steuerbaren entity_ids (ADR-006-Startset). */
  entityIds: readonly string[];
  /** Konfig-Seed als Fallback, wenn kein localStorage-Cache existiert. */
  seed?: Map<string, unknown>;
  /** Configured Laundry source IDs that must bypass generic domain mapping.
   * Defaults to the active household config at backend construction time. */
  laundryEntityIds?: readonly string[];
}

export function entityRegistryRenameMessage(entityId: string, name: string) {
  return { type: 'config/entity_registry/update' as const, entity_id: entityId, name };
}

export class HaBackend implements Backend {
  #resolveUrl: () => string;
  #entityIds: string[];
  #seed: Map<string, unknown>;
  #laundryEntityIds: Set<string>;

  #onUpdate: ((entityId: string, value: unknown, stale?: boolean, available?: boolean) => void) | null = null;
  #connCb: ((status: ConnectionStatus) => void) | null = null;
  #onAuth: ((reason: AuthRequiredReason) => void) | null = null;
  #onCmdErr: ((entityId: string) => void) | null = null;
  #catalogCb: ((items: EntityCatalogItem[]) => void) | null = null;

  #status: ConnectionStatus = 'connecting';
  #conn: Connection | null = null;
  #unsub: Unsub | null = null;
  #startInFlight = false;
  #receivedFreshData = false;
  #retry: RetryController | null = null;

  #raw = new Map<string, RawEntity>();
  #last = new Map<string, unknown>();

  constructor(opts: HaBackendOptions) {
    const url = opts.url;
    this.#resolveUrl = typeof url === 'function' ? url : () => url;
    this.#entityIds = [...opts.entityIds];
    this.#seed = opts.seed ?? new Map();
    const laundryEntityIds = opts.laundryEntityIds
      ?? Object.values(CONFIGURED_LAUNDRY_ENTITIES)
        .flatMap((adapter) => adapter
          ? [adapter.entityId, ...(adapter.cycleMarkerEntityId ? [adapter.cycleMarkerEntityId] : [])]
          : []);
    this.#laundryEntityIds = new Set(laundryEntityIds);
  }

  /* ── Backend-Interface ── */

  start(): void {
    void this.#start();
  }

  subscribe(onUpdate: (entityId: string, value: unknown, stale?: boolean, available?: boolean) => void): void {
    this.#onUpdate = onUpdate;
    // Sofort-Render aus dem Cache (bzw. Seed) — kein Leerzustand/Spinner (docs/04).
    const cache = this.#loadCache();
    for (const id of this.#entityIds) {
      if (this.#laundryEntityIds.has(id)) continue;
      const v = cache.get(id) ?? this.#seed.get(id);
      if (v !== undefined) {
        this.#last.set(id, v);
        onUpdate(id, v, cache.has(id));
      }
    }
  }

  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.#connCb = cb;
    cb(this.#status);
  }

  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>): void {
    if (!this.#conn || this.#status !== 'connected') return; // offline (docs/02)
    // Optimistischer UI-Update ist längst passiert; hier nur der Service-Call.
    // Service-Fehler (docs/02, Funktionsumfang 6): loggen + der Runtime melden,
    // die den optimistischen Intent sofort verwirft (KEIN Retry, kein Spinner).
    void callService(this.#conn, domain, service, data, { entity_id: entityId }).catch((err) => {
      console.warn('[HaBackend] callService fehlgeschlagen:', domain, service, entityId, err);
      this.#onCmdErr?.(entityId);
    });
  }

  onCommandError(cb: (entityId: string) => void): void {
    this.#onCmdErr = cb;
  }

  subscribeCatalog(cb: (items: EntityCatalogItem[]) => void): void {
    this.#catalogCb = cb;
    if (this.#conn && this.#status === 'connected') void this.#refreshCatalog();
  }

  async renameEntity(entityId: string, name: string): Promise<void> {
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (!normalized) throw new Error('Der Gerätename darf nicht leer sein.');
    if (!this.#conn || this.#status !== 'connected') throw new Error('Home Assistant ist nicht verbunden.');
    await this.#conn.sendMessagePromise(entityRegistryRenameMessage(entityId, normalized));
    await this.#refreshCatalog();
  }

  async listCalendarSources(): Promise<CalendarSource[]> {
    if (!this.#conn || this.#status !== 'connected') return [];
    const states = await getStates(this.#conn);
    return states
      .filter((state) => state.entity_id.startsWith('calendar.'))
      .map((state) => ({
        entityId: state.entity_id,
        name: String(state.attributes.friendly_name ?? state.entity_id),
        color: typeof state.attributes.color === 'string' ? state.attributes.color : null,
      }));
  }

  async getCalendarEvents(entityId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    if (!this.#conn || this.#status !== 'connected') throw new Error('Home Assistant ist nicht verbunden.');
    const result = await this.#conn.sendMessagePromise<{ response?: Record<string, { events?: HaCalendarEvent[] }> }>(
      calendarEventsMessage(entityId, start, end),
    );
    return (result.response?.[entityId]?.events ?? []).map((item, index) => calendarEventFromHa(item, index));
  }

  /* ── iCloud-Erinnerungen (Einstellungen → Kalender → Erinnerungen) ──
     Reminder-Listen desselben CalDAV/iCloud-Kontos erscheinen in HA als
     `todo.*`-Entitäten; die Einträge liest der offizielle WS-Befehl
     `todo/item/list`. Read-only wie der Kalender-Seam. */
  async listReminderSources(): Promise<ReminderSource[]> {
    if (!this.#conn || this.#status !== 'connected') return [];
    const states = await getStates(this.#conn);
    return states
      .filter((state) => state.entity_id.startsWith('todo.'))
      .map((state) => ({
        entityId: state.entity_id,
        name: String(state.attributes.friendly_name ?? state.entity_id),
        color: typeof state.attributes.color === 'string' ? state.attributes.color : null,
      }));
  }

  async getReminders(entityId: string): Promise<Reminder[]> {
    if (!this.#conn || this.#status !== 'connected') throw new Error('Home Assistant ist nicht verbunden.');
    const result = await this.#conn.sendMessagePromise<{ items?: HaTodoItem[] }>(
      reminderListMessage(entityId),
    );
    return (result.items ?? []).map((item, index) => reminderFromHa(item, index));
  }

  /* ── iCloud-Kalender einrichten (Einstellungen → Kalender) ──
     Treibt den HA-Config-Flow der CalDAV-Integration über die REST-API an —
     das Panel bleibt ohne eigenen CalDAV-Client (B-10: HA ist der Single
     Backend). Das App-Passwort wird nur durchgereicht, nie gespeichert.
     Voraussetzungen: Admin-Token und (bei fremdem Origin) ein Eintrag in
     `http.cors_allowed_origins` der HA-Konfiguration. */
  async setupICloudCalendar(username: string, appPassword: string): Promise<{ ok: boolean; message: string }> {
    const token = readToken();
    if (!token) return { ok: false, message: 'Kein Home-Assistant-Token hinterlegt.' };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    let res: Response;
    try {
      res = await fetch(`${this.#resolveUrl()}/api/config/config_entries/flow`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ handler: 'caldav', show_advanced_options: false }),
      });
    } catch {
      return {
        ok: false,
        message: 'Home Assistant nicht erreichbar oder Anfrage blockiert (CORS). '
          + 'In configuration.yaml muss `http: cors_allowed_origins` den Panel-Origin erlauben.',
      };
    }
    if (res.status === 401) return { ok: false, message: 'Token ungültig oder ohne Admin-Rechte.' };
    if (res.status === 404) return { ok: false, message: 'CalDAV-Integration in dieser HA-Version nicht verfügbar.' };
    if (!res.ok) return { ok: false, message: `Einrichtung fehlgeschlagen (HTTP ${res.status}).` };
    const flow = (await res.json()) as { flow_id: string };

    const stepRes = await fetch(`${this.#resolveUrl()}/api/config/config_entries/flow/${flow.flow_id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url: 'https://caldav.icloud.com',
        username,
        password: appPassword,
        verify_ssl: true,
      }),
    }).catch(() => null);
    if (!stepRes) return { ok: false, message: 'Verbindung zu Home Assistant abgerissen.' };
    if (!stepRes.ok) return { ok: false, message: `Einrichtung fehlgeschlagen (HTTP ${stepRes.status}).` };
    const result = (await stepRes.json()) as {
      type: string;
      errors?: Record<string, string> | null;
      reason?: string;
    };

    if (result.type === 'create_entry') {
      return { ok: true, message: 'iCloud-Kalender in Home Assistant eingerichtet. Die Kalender-Entitäten erscheinen in wenigen Augenblicken.' };
    }
    if (result.type === 'abort') {
      return result.reason === 'already_configured'
        ? { ok: false, message: 'Dieser iCloud-Account ist in Home Assistant bereits eingerichtet.' }
        : { ok: false, message: `Einrichtung abgebrochen (${result.reason ?? 'unbekannt'}).` };
    }
    const error = result.errors?.base;
    if (error === 'invalid_auth') return { ok: false, message: 'Apple-ID oder App-Passwort falsch. Hinweis: App-spezifisches Passwort unter appleid.apple.com erzeugen.' };
    if (error === 'cannot_connect') return { ok: false, message: 'Home Assistant erreicht caldav.icloud.com nicht.' };
    return { ok: false, message: `iCloud hat die Anmeldung nicht akzeptiert (${error ?? result.type}).` };
  }

  /* ADR-006: screengenaues Verengen des Abos. Union-Default kommt aus dem
     Konstruktor; state/subscriptions treibt die Verengung über nav. */
  setVisible(entityIds: readonly string[]): void {
    const next = [...entityIds];
    if (sameSet(next, this.#entityIds)) return;
    this.#entityIds = next;
    if (this.#status === 'connected') void this.#resubscribe();
  }

  /* ── Auth-Anbindung für den Login-Screen (state/auth) ── */

  onAuthError(cb: (reason: AuthRequiredReason) => void): void {
    this.#onAuth = cb;
  }

  hasToken(): boolean {
    return !!readToken();
  }

  setToken(token: string): void {
    try { sharedStorage.setItem(TOKEN_KEY, token.trim()); } catch { /* ignore */ }
    this.#resetRetry();
    void this.#start();
  }

  /* Dev-/Verifikations-Seam (Parallele zu FakeBackend.goOffline): schließt den
     laufenden WebSocket, damit die Library-Reconnect-Kette live prüfbar ist
     (disconnected → reconnecting → ready, ohne Page-Reload). Kein Produktionspfad. */
  devForceDisconnect(): boolean {
    const socket = (this.#conn as unknown as { socket?: WebSocket } | null)?.socket;
    if (!socket) return false;
    socket.close();
    return true;
  }

  /* ── Verbindungsaufbau + Auth ── */

  async #start(): Promise<void> {
    if (this.#startInFlight || this.#conn) return;
    this.#retry?.beforeStart();
    this.#startInFlight = true;
    const token = readToken();
    if (!token) {
      this.#resetRetry();
      this.#setStatus('disconnected');
      this.#onAuth?.('missing-token');
      this.#startInFlight = false;
      return;
    }
    this.#setStatus('connecting');
    try {
      const auth = createLongLivedTokenAuth(this.#resolveUrl(), token);
      const conn = await createConnection({ auth });
      this.#conn = conn;
      // Library-Reconnect → ConnectionStatus (ADR-018 §2). Die Library
      // resubscribed die laufende subscribe_entities-Nachricht selbst. Raw-State
      // beim Disconnect leeren, nicht erst bei `ready`: die Library kann den
      // initialen Reconnect-Diff vor dem ready-Event liefern.
      conn.addEventListener('ready', () => {
        if (this.#conn === conn && this.#unsub) this.#setStatus('connected');
      });
      conn.addEventListener('disconnected', () => {
        if (this.#conn !== conn) return;
        this.#raw.clear();
        this.#setStatus('reconnecting');
      });
      conn.addEventListener('reconnect-error', () => {
        if (this.#conn === conn) this.#setStatus('reconnecting');
      });

      await this.#resubscribe();
      this.#setStatus('connected');
      this.#resetRetry();
      void this.#refreshCatalog();
    } catch (err) {
      const failedConnection = this.#conn;
      this.#conn = null;
      if (this.#unsub) {
        await this.#unsub().catch(() => {});
        this.#unsub = null;
      }
      failedConnection?.close();
      if (err === ERR_INVALID_AUTH) {
        // Token abgelaufen/ungültig → verwerfen, Login zeigen (docs/04).
        this.#resetRetry();
        try { sharedStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        this.#setStatus('disconnected');
        this.#onAuth?.('invalid-auth');
      } else {
        // Host nicht erreichbar o. Ä.: Banner, letzter Cache bleibt sichtbar.
        this.#setStatus('disconnected');
        console.warn('[HaBackend] Verbindungsaufbau fehlgeschlagen:', err);
        this.#scheduleRetry();
      }
    } finally {
      this.#startInFlight = false;
    }
  }

  #scheduleRetry(): void {
    if (this.#conn) return;
    this.#retry ??= createRetryController?.(() => { void this.#start(); }) ?? null;
    this.#retry?.schedule();
  }

  #resetRetry(): void {
    this.#retry?.reset();
    this.#retry = null;
  }

  async #resubscribe(): Promise<void> {
    if (!this.#conn) return;
    if (this.#unsub) { await this.#unsub().catch(() => {}); this.#unsub = null; }
    this.#unsub = await this.#conn.subscribeMessage<EntitiesDiff>(
      (diff) => this.#onDiff(diff),
      { type: 'subscribe_entities', entity_ids: this.#entityIds },
      { resubscribe: true },
    );
  }

  async #refreshCatalog(): Promise<void> {
    if (!this.#conn || !this.#catalogCb) return;
    try {
      const states = await getStates(this.#conn);
      this.#catalogCb(states.map(catalogItemFromHaState).filter((x): x is EntityCatalogItem => x !== null));
    } catch (err) {
      console.warn('[HaBackend] Entity-Katalog konnte nicht geladen werden:', err);
    }
  }

  #onDiff(diff: EntitiesDiff): void {
    const initialSnapshot = this.#raw.size === 0;
    const changed = applyEntitiesDiff(this.#raw, diff);
    for (const id of changed) {
      const raw = this.#raw.get(id);
      if (!raw) {
        this.#last.delete(id);
        this.#onUpdate?.(id, undefined);
        continue;
      }
      if (raw.state === 'unavailable' && !this.#laundryEntityIds.has(id)) {
        this.#onUpdate?.(id, this.#last.get(id), false, false);
        continue;
      }
      const value = this.#laundryEntityIds.has(id)
        ? haToLaundryState(raw)
        : haToValue(id, raw, this.#last.get(id));
      if (value === undefined) continue; // nicht steuerbare Domäne
      this.#last.set(id, value);
      this.#onUpdate?.(id, value);
    }
    if (initialSnapshot) {
      for (const id of this.#entityIds) {
        if (!this.#raw.has(id)) this.#onUpdate?.(id, this.#last.get(id), false, false);
      }
    }
    if (!this.#receivedFreshData && changed.length > 0) {
      this.#receivedFreshData = true;
      markHaStartup('hmi:fresh-data', 'Aktuelle Daten eingetroffen');
    }
    this.#saveCache();
  }

  /* ── Entity-Cache (localStorage) ── */

  #loadCache(): Map<string, unknown> {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return new Map();
      return new Map(Object.entries(JSON.parse(raw) as Record<string, unknown>));
    } catch {
      return new Map();
    }
  }

  #saveCache(): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(this.#last)));
    } catch { /* Quota/Serialisierung: Cache ist best-effort */ }
  }

  #setStatus(status: ConnectionStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    this.#connCb?.(status);
    if (status === 'connected') markHaStartup('hmi:ha-connected', 'Home Assistant verbunden');
  }
}

interface HaCalendarEvent {
  start: string | { date?: string; dateTime?: string };
  end: string | { date?: string; dateTime?: string };
  summary?: string;
  location?: string;
  description?: string;
  uid?: string;
}

function calendarEventFromHa(item: HaCalendarEvent, index: number): CalendarEvent {
  const start = calendarDateValue(item.start);
  const end = calendarDateValue(item.end);
  const allDay = typeof item.start === 'object'
    ? !!item.start.date && !item.start.dateTime
    : /^\d{4}-\d{2}-\d{2}$/.test(start);
  return {
    id: item.uid ?? `${start}-${end}-${item.summary ?? index}`,
    title: item.summary?.trim() || 'Ohne Titel',
    start,
    end,
    allDay,
    location: item.location?.trim() || null,
    description: item.description?.trim() || null,
  };
}

function calendarDateValue(value: HaCalendarEvent['start']): string {
  if (typeof value === 'string') return value;
  return value.dateTime ?? value.date ?? '';
}

interface HaTodoItem {
  uid?: string;
  summary?: string;
  status?: 'needs_action' | 'completed';
  due?: string; // Datum `YYYY-MM-DD` oder ISO-Zeitpunkt
  description?: string;
}

function reminderFromHa(item: HaTodoItem, index: number): Reminder {
  return {
    id: item.uid ?? `${item.summary ?? 'reminder'}-${index}`,
    title: item.summary?.trim() || 'Ohne Titel',
    due: item.due?.trim() || null,
    completed: item.status === 'completed',
    description: item.description?.trim() || null,
  };
}

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every((x) => s.has(x));
}
