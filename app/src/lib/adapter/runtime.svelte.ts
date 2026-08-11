/* ============================================
   AdapterRuntime (ADR-015/017) — komponiert die vier Schichten zu einer
   laufenden Einheit: EntityStore (Server-Wahrheit) + Overlay (pending
   Intents) + CommandQueue (Dedup) hinter einem Backend. Die UI ruft nur
   `merged()` (lesen) und `dispatch()` (schreiben) — nie das Backend direkt.
   ============================================ */

import { SvelteMap } from 'svelte/reactivity';
import { EntityStore } from './entity-store.svelte.ts';
import { FakeBackend } from './fake-backend.ts';
import { demoEnergySeed } from '../demo/demo-mode.ts';
import { HaBackend } from './ha-backend.ts';
import { reconcile, subsetMatch, mergePatch, COMMAND_TIMEOUT_MS } from './overlay.ts';
import { enqueue } from './command-queue.ts';
import type { Backend, Command, Intent, IntentStatus, ReconcileEvent, ConnectionStatus, SunValue } from './types.ts';
import { ROOM_SEED, MEDIA_SEED, SUN_ENTITY } from '../state/app.svelte.ts';
import { buildEntitySeed, buildMediaSeed, LAUNDRY_ENTITIES } from '../state/entities.ts';
import { HOUSEHOLD_RUNTIME_MODEL } from '../config/household-runtime-data.ts';
import { FAKE_DISCOVERY_CATALOG } from '../state/device-config.ts';
import type { CalendarEvent, CalendarSource } from '../state/calendar.ts';
import type { Reminder, ReminderSource } from '../state/reminders.ts';

export class AdapterRuntime {
  readonly store = new EntityStore();
  #intents = new SvelteMap<string, Intent>();
  #reconciled = new SvelteMap<string, ReconcileEvent>();
  #reconcileSeq = 0;
  #queue: Command[] = [];
  #flushScheduled = false;
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #backend!: Backend;
  #visible: string[] | null = null;
  #catalogSubscriber: ((items: unknown[]) => void) | null = null;
  #equals: (a: unknown, b: unknown) => boolean;
  #connection = $state<ConnectionStatus>('connected');

  // Subset-Match (ADR-017 Addendum): Teil-Patches (Media) und volle Werte
  // (Licht/Klima) reconcilen durch dieselbe Logik.
  constructor(backend: Backend, equals = subsetMatch) {
    this.#equals = equals;
    this.#bindBackend(backend);
  }

  /** Darf nur im Bootstrap vor start() genutzt werden: nach dem zentralen
      Config-Sync kann der provisorische Cache-Backendtyp ohne zweiten Runtime-
      Singleton ersetzt werden. */
  setBackend(backend: Backend): void {
    if (backend === this.#backend) return;
    this.#bindBackend(backend);
  }

  #bindBackend(backend: Backend): void {
    this.#backend = backend;
    // Subscription füllt den Store und treibt die Reconciliation (docs/02)
    backend.subscribe((id, value, stale, available) => {
      if (backend === this.#backend) this.#onUpdate(id, value, stale, available);
    });
    // Verbindungszustand aus dem Seam (ADR-017 Addendum): reaktiv für Banner,
    // Status-Dot und Command-Sperre.
    backend.onConnectionChange((status) => {
      if (backend === this.#backend) this.#connection = status;
    });
    // Service-Error (docs/02, Funktionsumfang 6): der Command wurde abgelehnt —
    // Intent sofort verwerfen statt 5 s aufs Timeout zu warten.
    backend.onCommandError?.((id) => {
      if (backend === this.#backend) this.#onCommandFailed(id);
    });
    if (this.#visible !== null) backend.setVisible?.(this.#visible);
    this.#bindCatalog(backend);
  }

  #bindCatalog(backend: Backend): void {
    const subscriber = this.#catalogSubscriber;
    if (!subscriber) return;
    backend.subscribeCatalog?.((items) => {
      if (backend === this.#backend) subscriber(items);
    });
  }

  /* Verbindungszustand (docs/02): die UI liest ihn über state/connection. */
  get connectionStatus(): ConnectionStatus {
    return this.#connection;
  }

  /** Externe Verbindungen bewusst erst nach dem ersten Paint starten. Der
      lokale Entity-Cache wurde bereits synchron im Konstruktor eingespielt. */
  start(): void {
    this.#backend.start?.();
  }

  /* Selektives Abo (ADR-006): reicht die sichtbaren entity_ids an das Backend
     durch. FakeBackend ignoriert das (No-op), HaBackend resubscribed. */
  setVisible(entityIds: readonly string[]): void {
    this.#visible = [...entityIds];
    this.#backend.setVisible?.(this.#visible);
  }

  subscribeCatalog(cb: (items: unknown[]) => void): void {
    this.#catalogSubscriber = cb;
    this.#bindCatalog(this.#backend);
  }

  async renameEntity(entityId: string, name: string): Promise<void> {
    if (this.#connection !== 'connected') throw new Error('Home Assistant ist nicht verbunden.');
    if (!this.isEntityAvailable(entityId)) throw new Error('Die Entität ist nicht verfügbar.');
    if (!this.#backend.renameEntity) throw new Error('Das aktive Backend unterstützt keine gemeinsamen Gerätenamen.');
    await this.#backend.renameEntity(entityId, name);
  }

  async listCalendarSources(): Promise<CalendarSource[]> {
    return this.#backend.listCalendarSources?.() ?? [];
  }

  async getCalendarEvents(entityId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    return this.#backend.getCalendarEvents?.(entityId, start, end) ?? [];
  }

  async listReminderSources(): Promise<ReminderSource[]> {
    return this.#backend.listReminderSources?.() ?? [];
  }

  async getReminders(entityId: string): Promise<Reminder[]> {
    return this.#backend.getReminders?.(entityId) ?? [];
  }

  /* ── Gemergte Sicht (Schicht 4): das Einzige, was die UI liest ──
     Der pending Intent überlagert NUR seine Felder (Patch-Merge); Server-
     Metadaten (media track/artist/…) fließen unverändert durch. */
  merged(entityId: string): unknown {
    const server = this.store.get(entityId)?.value;
    const intent = this.#intents.get(entityId);
    return intent ? mergePatch(server, intent.value) : server;
  }

  /** Read-only Availability-Seam: fehlender Store-State und Legacy-Updates
      bleiben standardmäßig verfügbar; nur ein explizites false sperrt. */
  isEntityAvailable(entityId: string): boolean {
    return this.store.get(entityId)?.available ?? true;
  }

  /* „pending"-Dot am Control, sobald der Command ins Timeout läuft (docs/02) */
  intentStatus(entityId: string): IntentStatus | null {
    return this.#intents.get(entityId)?.status ?? null;
  }

  /* Contradiction-Event (docs/02): das Control liest dies reaktiv und löst
     Wobble (Toggle) bzw. Interpolation (Slider) aus. `null`, solange kein
     Widerspruch aufgetreten ist. */
  reconcileEvent(entityId: string): ReconcileEvent | null {
    return this.#reconciled.get(entityId) ?? null;
  }

  /* Fire-and-forget (ADR-017 Addendum): Command ohne optimistisches Feld und
     ohne Intent — media_next/prev, analog scene.turn_on. Läuft durch dieselbe
     Sende-Dedup, reconciled aber nichts. */
  send(cmd: Command): void {
    if (this.#connection !== 'connected') return; // offline (docs/02)
    if (!this.isEntityAvailable(cmd.entityId)) return;
    this.#queue = enqueue(this.#queue, cmd);
    this.#scheduleFlush();
  }

  /* ── Dispatch: optimistischer Intent sofort, Command via Queue ──
     Der optimistische UI-Update ist mit dem gesetzten Intent bereits sichtbar
     (ADR-005). `optimistic` ist der erwartete Zielwert für die Reconciliation. */
  dispatch(cmd: Command, optimistic: unknown): void {
    // Offline (docs/02): keine Commands möglich — kein optimistischer Intent, der
    // nie bestätigt würde. Die UI deaktiviert die Controls zusätzlich sichtbar.
    if (this.#connection !== 'connected') return;
    if (!this.isEntityAvailable(cmd.entityId)) return;
    this.#intents.set(cmd.entityId, {
      entityId: cmd.entityId, value: optimistic, sentAt: Date.now(), status: 'inflight',
    });
    // Dedup pro Entität (docs/02): der letzte Command überschreibt den pending
    this.#queue = enqueue(this.#queue, cmd);
    this.#scheduleFlush();

    const prev = this.#timers.get(cmd.entityId);
    if (prev) clearTimeout(prev);
    this.#timers.set(cmd.entityId, setTimeout(() => this.#onTimeout(cmd.entityId), COMMAND_TIMEOUT_MS));
  }

  /* Sende-Dedup: rapide Doppelklicks innerhalb eines Ticks kollabieren zu
     einem Service-Call (kein Doppelklick-Bug, docs/02). */
  #scheduleFlush(): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    queueMicrotask(() => {
      this.#flushScheduled = false;
      const batch = this.#queue;
      this.#queue = [];
      for (const cmd of batch) {
        if (this.isEntityAvailable(cmd.entityId)) {
          this.#backend.callService(cmd.domain, cmd.service, cmd.entityId, cmd.data);
        }
      }
    });
  }

  #onUpdate(entityId: string, value: unknown, stale = false, available = true): void {
    this.store.set(entityId, value, stale, available);
    if (!available) {
      // Ein bereits offener optimistischer Zustand darf die Last-known-
      // Darstellung einer inzwischen verschwundenen Entität nicht überlagern.
      this.#intents.delete(entityId);
      clearTimeout(this.#timers.get(entityId));
      this.#timers.delete(entityId);
      return;
    }
    const { outcome } = reconcile([...this.#intents.values()], { entityId, value }, this.#equals);
    if (outcome === 'external') return; // fremde Änderung: nur übernehmen
    // confirmed | contradicted → Intent auflösen; bei Widerspruch springt die
    // gemergte Sicht damit auf den Server-Wert zurück (docs/02).
    if (outcome === 'contradicted') {
      const optimistic = this.#intents.get(entityId)?.value;
      this.#reconciled.set(entityId, { seq: ++this.#reconcileSeq, optimistic, server: value });
    }
    this.#intents.delete(entityId);
    const t = this.#timers.get(entityId);
    if (t) { clearTimeout(t); this.#timers.delete(entityId); }
  }

  /* Service-Error (docs/02): der Server hat den Command abgelehnt. Wie ein
     Widerspruch behandeln — den optimistischen Intent verwerfen (die gemergte
     Sicht springt auf den Server-Wert zurück) und das Control wackeln lassen.
     Anders als beim Widerspruch kommt kein Server-Echo; der bekannte Store-Wert
     ist die Wahrheit, auf die zurückgesprungen wird. */
  #onCommandFailed(entityId: string): void {
    const intent = this.#intents.get(entityId);
    if (!intent) return; // kein offener Intent (schon bestätigt/verworfen)
    const server = this.store.get(entityId)?.value;
    this.#reconciled.set(entityId, { seq: ++this.#reconcileSeq, optimistic: intent.value, server });
    this.#intents.delete(entityId);
    const t = this.#timers.get(entityId);
    if (t) { clearTimeout(t); this.#timers.delete(entityId); }
  }

  #onTimeout(entityId: string): void {
    // Kein Auto-Retry: State bleibt optimistisch, Status wird „pending" (docs/02).
    // In-place setzen (nicht Map ersetzen), sonst verpassen die reaktiven Leser
    // den Wechsel. Die pure Variante markTimeouts() bleibt für die Unit-Tests.
    const intent = this.#intents.get(entityId);
    if (intent && intent.status === 'inflight') {
      this.#intents.set(entityId, { ...intent, status: 'pending' });
    }
  }
}

/* ── Singleton (ADR-018: HaBackend live, FakeBackend per Flag) ──
   Seed = reale entity_ids + Fallback-Startwerte (buildEntitySeed/buildMediaSeed).
   Schichttausch nur hier: FakeBackend ↔ HaBackend hinter demselben Interface. */
export const seed = new Map<string, unknown>([
  ...buildEntitySeed(ROOM_SEED),
  ...FAKE_DISCOVERY_CATALOG.map((item) => [item.entityId, { on: false }] as const),
  ...buildMediaSeed(MEDIA_SEED),
  // Read-only-Ambient: sun.sun-Fallback (Nacht) bis zum ersten echten Push —
  // deckt sich mit dem Default-Theme 'dark'. Energie-Sensoren haben keinen
  // Seed (installationsspezifisch, null bis konfiguriert).
  ...(SUN_ENTITY ? [[SUN_ENTITY, { day: false } satisfies SunValue] as const] : []),
  ...(LAUNDRY_ENTITIES.washer ? [[LAUNDRY_ENTITIES.washer, { on: true, changedAt: Date.now() - 42 * 60_000 }] as const] : []),
  ...(LAUNDRY_ENTITIES.dryer ? [[LAUNDRY_ENTITIES.dryer, { on: true, changedAt: Date.now() - 8 * 60_000 }] as const] : []),
  // Demo-Build: Energie-Sensoren bekommen Startwerte, sonst zeigt der Screen
  // nur „—" (leer außerhalb der Demo).
  ...demoEnergySeed(),
]);

/* Basis-URL: Geräte-Override (Einstellungen → Verbindungen, localStorage) vor
   Env vor Default. Analog zu Jellyfin (jellyfin.ts) — keine Secrets hier, nur der
   Endpunkt. Ein Override greift wie der Backend-Wechsel erst nach dem Neuladen
   (Singleton entsteht beim App-Start). */
const HA_URL_KEY = 'hmi:ha-url';

export function defaultHaUrl(protocol: string = typeof location === 'undefined' ? 'http:' : location.protocol): string {
  /* Eine HTTPS-PWA darf den lokalen HTTP-/WS-Endpunkt nicht laden (Mixed
     Content). Über die Cloudflare-Domain spricht der Browser HA per HTTPS/WSS
     an; im LAN bleibt der direkte Endpunkt ohne Tunnel-Umweg erhalten. */
  return protocol === 'https:' ? 'https://homeassistant.example.com' : 'http://homeassistant.local:8123';
}

export const HA_URL_DEFAULT: string =
  (import.meta.env?.VITE_HA_URL as string | undefined) ?? defaultHaUrl();

export function configuredHaUrl(storage?: Pick<Storage, 'getItem'>): string {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    return source?.getItem(HA_URL_KEY) ?? HA_URL_DEFAULT;
  } catch {
    return HA_URL_DEFAULT;
  }
}

/* FakeBackend für Tests/Dev: ohne `window` (Vitest), per Env `VITE_BACKEND=fake`
   oder localStorage-Flag `hmi:backend=fake` (ADR-018 §7). Sonst echtes HA. */
function useFake(): boolean {
  if (typeof window === 'undefined') return true;
  if ((import.meta.env?.VITE_BACKEND as string | undefined) === 'fake') return true;
  try { if (localStorage.getItem('hmi:backend') === 'fake') return true; } catch { /* ignore */ }
  return false;
}

export let backend: Backend = useFake()
  ? new FakeBackend(seed)
  : new HaBackend({
      // Erst in start() nach dem Shared-Config-Sync auflösen; der Modulimport
      // darf noch mit dem lokalen letzten Stand die Shell erzeugen.
      url: () => configuredHaUrl(),
      entityIds: HOUSEHOLD_RUNTIME_MODEL.subscriptionEntityIds,
      seed: seed,
    });

export const runtime = new AdapterRuntime(backend);

/** Zentraler Config-Sync darf den beim Cache-Render provisorisch gewählten Typ
 * genau einmal vor runtime.start() korrigieren. */
export function setBackend(next: Backend): void {
  backend = next;
  runtime.setBackend(next);
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __hmi?: Record<string, unknown> };
    if (w.__hmi) w.__hmi.backend = next;
  }
}

// Dev-Handle für den Smoke-Test im Preview-Browser:
//   FakeBackend: window.__hmi.backend.force(id, 'contradict'|'drop') / goOffline() / goOnline()
//   HaBackend:   window.__hmi.backend.setToken('...')  (sonst Login-Screen)
//                window.__hmi.backend.devForceDisconnect()  (Reconnect-Kette live prüfen)
if (typeof window !== 'undefined') {
  const w = window as unknown as { __hmi?: Record<string, unknown> };
  w.__hmi = { ...(w.__hmi ?? {}), runtime, backend };
}
