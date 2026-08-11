/* ============================================
   Adapter-Layer (ADR-015): Interfaces der vier Schichten.
   Framework-arm (plain TS) — die UI kennt ausschließlich die gemergte
   Sicht aus Schicht 4; kein Direktzugriff auf die WebSocket-Verbindung
   aus Komponenten. Implementierung folgt in der HA-Anbindungs-Session.
   ============================================ */

/* ── Schicht 1: Connection ──
   Wrapper um home-assistant-js-websocket (docs/09): Auth per Long-Lived
   Token, Reconnect mit Backoff (1s, 2s, 4s, 8s, max 30s — docs/02),
   subscribeEntities-Collections. Das WS-Protokoll wird NICHT selbst
   implementiert. */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type AuthRequiredReason = 'missing-token' | 'invalid-auth';

export interface ConnectionLayer {
  readonly status: ConnectionStatus;
  connect(): Promise<void>;
  disconnect(): void;
  /** Statuswechsel → UI-Banner „Verbindung unterbrochen" (docs/02 Offline) */
  onStatusChange(cb: (status: ConnectionStatus) => void): () => void;
}

/* ── Schicht 2: EntityStore ──
   Server-Wahrheit als Signale (entity_id → Signal), selektiv abonniert
   nach sichtbarem Screen (ADR-006); dahinter der Entity-Cache (letzter
   bekannter State, localStorage) für Screen-Wechsel und Offline. */
export interface EntityState<V = unknown> {
  entityId: string;
  value: V;
  /** Millisekunden-Timestamp des letzten Server-Updates (Cache-Alter) */
  updatedAt: number;
  /** true, wenn der Wert aus dem Cache stammt und noch nicht live bestätigt ist */
  stale: boolean;
  /** false, wenn HA die konfigurierte Entität explizit als fehlend/unavailable meldet */
  available?: boolean;
}

export interface EntityStoreLayer {
  /** Letzter bekannter State — live oder aus dem Cache (nie ein Spinner) */
  get(entityId: string): EntityState | undefined;
  /** ADR-006: Subscriptions folgen dem sichtbaren Screen */
  setVisible(entityIds: readonly string[]): void;
}

/* ── Schicht 3: CommandQueue ──
   Dedup pro Entität (docs/02: neuer Command überschreibt den pending
   Command derselben Entität — kein Doppelklick-Bug), Timeout 5 s,
   KEIN automatischer Retry. */
export interface Command<D = Record<string, unknown>> {
  entityId: string;
  domain: string;   // z. B. 'light'
  service: string;  // z. B. 'turn_on'
  data: D;
  queuedAt: number;
}

export interface CommandQueueLayer {
  /** Optimistischer UI-Update ist zu diesem Zeitpunkt bereits passiert (ADR-005) */
  dispatch(cmd: Command): void;
}

/* ── Schicht 4: Optimistic Overlay ──
   Pending Intents überlagern den Server-State; die UI liest ausschließlich
   die gemergte Sicht. Reine Merge-/Reconciliation-Logik: overlay.ts. */
export type IntentStatus =
  | 'inflight'  // Command raus, Antwort steht aus (< 5 s)
  | 'pending';  // Timeout (5 s) — State bleibt optimistisch, „pending"-Dot (docs/02)

export interface Intent<V = unknown> {
  entityId: string;
  value: V;        // optimistisch angenommener Zielwert
  sentAt: number;
  status: IntentStatus;
}

/* Ergebnis eines Server-Updates gegen die Intent-Liste (docs/02 Konflikt-Typen) */
export type ReconcileOutcome =
  | 'confirmed'     // HA bestätigt → Intent weg, keine Aktion
  | 'contradicted'  // HA widerspricht → Intent weg, Zurückspringen + Wobble (200 ms)
  | 'external';     // Änderung ohne eigenen Intent → übernehmen ohne Animation

/* ── Backend (ADR-017): die swappbare Schicht-1-Abstraktion ──
   `FakeBackend` (jetzt) und `HaBackend` (HA-Session, home-assistant-js-websocket)
   implementieren dasselbe Interface. Zuschnitt nach docs/04: State-Updates
   werden gepusht, Commands als Service-Calls abgesetzt. Runtime und UI kennen
   nur dieses Interface, nie die konkrete Verbindung. */
export interface Backend {
  /** Startet externe Verbindungen erst nach dem ersten Paint. Backends ohne
      externen Start (FakeBackend) lassen den Hook weg. */
  start?(): void;
  /** Push-Kanal: der EntityStore abonniert hier alle State-Updates
      (subscribe_entities bzw. Fake-Echo). Liefert initial den Seed-State. */
  subscribe(onUpdate: (entityId: string, value: unknown, stale?: boolean, available?: boolean) => void): void;
  /** call_service (docs/04): der optimistische UI-Update ist bereits passiert. */
  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>): void;
  /** Verbindungszustand (ADR-017 Addendum, Schicht 1): FakeBackend treibt ihn
      über Dev-Hooks, HaBackend über den echten Reconnect. Emittiert initial den
      aktuellen Status. */
  onConnectionChange(cb: (status: ConnectionStatus) => void): void;
  /** Selektives Abo (ADR-006): das Backend abonniert nur die sichtbaren
      Entitäten und resubscribed bei Screen-Wechsel. Optional — das FakeBackend
      pusht ohnehin nur den Seed und implementiert es als No-op. */
  setVisible?(entityIds: readonly string[]): void;
  /** Service-Call-Fehler (docs/02, Funktionsumfang 6): der Server hat den
      Command abgelehnt (Service-Error/Netzwerk). Die Runtime verwirft den
      optimistischen Intent sofort, statt 5 s aufs Timeout zu warten. Optional —
      das FakeBackend echot immer und meldet nie einen Fehler. */
  onCommandError?(cb: (entityId: string) => void): void;
  /** Geräteverwaltung: steuerbare HA-Entities für den Editor (light/switch). */
  subscribeCatalog?(cb: (items: unknown[]) => void): void;
  /** Gemeinsamer Anzeigename. Live schreibt das in die HA Entity Registry. */
  renameEntity?(entityId: string, name: string): Promise<void>;
  /** Read-only Kalender-Seam (B-10): Discovery + offizieller HA-Agenda-Abruf. */
  listCalendarSources?(): Promise<import('../state/calendar.ts').CalendarSource[]>;
  getCalendarEvents?(
    entityId: string,
    start: Date,
    end: Date,
  ): Promise<import('../state/calendar.ts').CalendarEvent[]>;
  /** Read-only Erinnerungs-Seam (B-10): iCloud-Reminder-Listen erscheinen in HA
      als `todo.*`-Entitäten; Discovery + Item-Abruf über `todo/item/list`. */
  listReminderSources?(): Promise<import('../state/reminders.ts').ReminderSource[]>;
  getReminders?(entityId: string): Promise<import('../state/reminders.ts').Reminder[]>;
}

/* ── Entity-Value-Shapes der steuerbaren Domänen (ADR-017) ──
   Nur diese laufen durchs Overlay; read-only-Domänen bleiben plain-reaktiv.
   colorTemp/color sind optional: Teil-Intents ({ colorTemp } / { color })
   überlagern via subsetMatch+mergePatch (runtime) nur ihr Feld. `color` und
   `colorTemp` schließen sich gegenseitig aus (HA-color_mode) — die Wahl einer
   Farbe setzt colorTemp implizit außer Kraft und umgekehrt (color=null). */
export interface LightValue {
  on: boolean;
  brightness: number;   // 0–100 %
  colorTemp?: number;   // Kelvin (2000–6500), wenn das Gerät Farbtemperatur kann
  color?: string | null; // '#rrggbb' im Farbmodus, null = Weiß-/Temp-Modus
}
export interface SwitchValue {
  on: boolean;
  /** HA `last_changed` in Millisekunden; fehlt nur bei Seed-/Legacy-Cache-Werten. */
  changedAt?: number;
}
/* `current` = gemessene Ist-Temperatur (HA-Attribut `current_temperature`,
   read-only). Optional: nicht jede climate-Entität meldet sie. Dient als
   Fallback-Quelle der Raum-Temperaturanzeige, wenn KEIN dedizierter Raum-
   Sensor gemappt ist (roomTemperature(), state/commands.ts). */
export interface ClimateValue { target: number; hvac: 'heat' | 'cool' | 'off'; current?: number }

/* ── Read-only-Value-Shapes (ADR-018): kein Overlay, keine optimistische
   Überlagerung. Sie fließen durch denselben `subscribe_entities`-Kanal, landen
   im EntityStore und werden plain-reaktiv gelesen (nie über mergePatch/
   Reconciliation — sie haben nie einen Intent).
   - SunValue treibt die Day/Night-Automatik (docs/07 Screen 9).
   - SensorValue ist die generische Zahl+Einheit für Energie-/Sensor-Werte
     (docs/07 Screen 10); `value === null` = unavailable/unknown/nicht-numerisch. */
export interface SunValue { day: boolean }
export interface SensorValue { value: number | null; unit: string | null }
export interface CameraValue {
  available: boolean;
  /** Von HA signierter Proxy-Pfad; enthält den kurzlebigen Kamera-Zugriffstoken. */
  entityPicture: string | null;
}

/* MediaValue (ADR-017 Addendum): ein media_player-Entity trägt zwei Konzerne,
   im Shape klar getrennt. Optimistische Felder werden per Intent-Patch überlagert
   (playing/volume/source); Server-Metadaten (available/track/artist/duration)
   fließen durch den Merge unverändert durch und werden NIE optimistisch geraten.
   `position` ist bewusst NICHT hier — sie ist lokale Simulation (state/media),
   kein Entity-Feld (sonst tickte sie in die Reconciliation hinein). */
export interface MediaValue {
  /* optimistisch (überlagert) */
  playing: boolean;
  volume: number;         // 0–100
  source: string | null;
  /* Server-Metadaten (read-only) */
  available: boolean;
  track: string | null;
  artist: string | null;
  duration: number;       // Sekunden, 0 = Live-Stream / nichts
}

/* Contradiction-Event (docs/02): die Runtime meldet einen Widerspruch reaktiv
   an das Control, das daraufhin Wobble (Toggle) bzw. Interpolation (Slider)
   auslöst. `seq` steigt bei jedem Widerspruch, damit der Reader auch einen
   Widerspruch auf denselben Wert erkennt. */
export interface ReconcileEvent {
  seq: number;
  optimistic: unknown; // der verworfene Intent-Wert (Vorher)
  server: unknown;     // die durchgesetzte Server-Wahrheit (Nachher)
}
