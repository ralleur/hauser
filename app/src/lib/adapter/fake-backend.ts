/* ============================================
   FakeBackend (ADR-017) — Schicht-1-Attrappe hinter dem Backend-Interface.
   Hält die Fake-Wahrheit intern und echot Commands als State-Updates zurück,
   nach kurzer Verzögerung (Latenz-Simulation). Test-Hooks erzwingen pro
   Entität Widerspruch oder Drop — erst damit werden die Reconciliation-Zweige
   aus docs/02 im Browser sichtbar (nicht nur im Unit-Test).
   Später ersetzt HaBackend genau diese Klasse; das Interface bleibt.
   ============================================ */

import type { Backend, ConnectionStatus, LightValue, ClimateValue, MediaValue, SwitchValue } from './types.ts';
import {
  FAKE_DISCOVERY_CATALOG,
  type EntityCatalogItem,
} from '../state/fake-discovery-catalog.ts';
import { rgbToHex } from './ha-entities.ts';
import type { CalendarEvent, CalendarSource } from '../state/calendar.ts';
import type { Reminder, ReminderSource } from '../state/reminders.ts';

type ForceMode = 'contradict' | 'drop';

export type FakeBackendCatalogItem = EntityCatalogItem;

function cloneCatalog(items: readonly EntityCatalogItem[]): EntityCatalogItem[] {
  return items.map((item) => ({
    ...item,
    ...(item.capabilities ? { capabilities: { ...item.capabilities } } : {}),
  }));
}

export class FakeBackend implements Backend {
  #truth: Map<string, unknown>;
  #push: ((entityId: string, value: unknown) => void) | null = null;
  #latencyMs: number;
  #forced = new Map<string, ForceMode>();
  #status: ConnectionStatus = 'connected';
  #connCb: ((status: ConnectionStatus) => void) | null = null;
  #catalogCb: ((items: EntityCatalogItem[]) => void) | null = null;
  #catalog: EntityCatalogItem[];

  constructor(
    seed: Map<string, unknown>,
    latencyMs = 40,
    catalog: readonly EntityCatalogItem[] = FAKE_DISCOVERY_CATALOG,
  ) {
    this.#truth = new Map(seed);
    this.#latencyMs = latencyMs;
    this.#catalog = cloneCatalog(catalog);
  }

  subscribe(onUpdate: (entityId: string, value: unknown) => void): void {
    this.#push = onUpdate;
    // Initial-State (Entity-Cache-Äquivalent): der Store startet gefüllt,
    // kein Stale-Moment beim ersten Screen (ADR-006).
    for (const [id, value] of this.#truth) onUpdate(id, structuredClone(value));
  }

  subscribeCatalog(cb: (items: EntityCatalogItem[]) => void): void {
    this.#catalogCb = cb;
    cb(cloneCatalog(this.#catalog));
  }

  async renameEntity(entityId: string, name: string): Promise<void> {
    const normalized = name.trim().replace(/\s+/g, ' ');
    if (!normalized) throw new Error('Der Gerätename darf nicht leer sein.');
    const item = this.#catalog.find((entry) => entry.entityId === entityId);
    if (item) item.name = normalized;
    this.#catalogCb?.(cloneCatalog(this.#catalog));
  }

  async listCalendarSources(): Promise<CalendarSource[]> {
    return [{ entityId: 'calendar.familie', name: 'Familie', color: '#67a4ff' }];
  }

  async getCalendarEvents(entityId: string, start: Date, end: Date): Promise<CalendarEvent[]> {
    if (entityId !== 'calendar.familie') return [];
    // An „heute" verankert (nicht am Fenster-Start), damit der aktuelle Tag im
    // Monatsraster und in der Ambient-Zeile stets belegt ist — offset in Tagen.
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const at = (offset: number, hour: number, minute = 0) => {
      const value = new Date(day);
      value.setDate(value.getDate() + offset);
      value.setHours(hour, minute, 0, 0);
      return value.toISOString();
    };
    return [
      { id: 'fake-family-1', title: 'Familienfrühstück', start: at(0, 9), end: at(0, 10, 30), allDay: false, location: 'Zuhause', description: null },
      // Laufender + anstehender Termin heute, damit die Ambient-Hero-Zeile
      // („Jetzt …") im Dev tagsüber sichtbar ist
      { id: 'fake-family-4', title: 'Oma & Opa zu Besuch', start: at(0, 11), end: at(0, 21), allDay: false, location: null, description: null },
      { id: 'fake-family-5', title: 'Wasserball', start: at(0, 19, 30), end: at(0, 21), allDay: false, location: 'Schwimmhalle', description: null },
      { id: 'fake-family-2', title: 'Kita geschlossen', start: at(1, 0), end: at(2, 0), allDay: true, location: null, description: null },
      { id: 'fake-family-3', title: 'Spielplatz', start: at(2, 15, 30), end: at(2, 17), allDay: false, location: 'Blücherpark', description: null },
      // Über mehrere Wochen gestreut, damit sich das Monatsraster hoch- und
      // runterscrollen lässt und dabei Termine trägt.
      { id: 'fake-family-6', title: 'Elternabend', start: at(-4, 19), end: at(-4, 20, 30), allDay: false, location: 'Kita', description: null },
      { id: 'fake-family-7', title: 'Geburtstag Mia', start: at(-9, 0), end: at(-8, 0), allDay: true, location: null, description: null },
      { id: 'fake-family-8', title: 'Zahnarzt', start: at(5, 8, 30), end: at(5, 9, 15), allDay: false, location: null, description: null },
      { id: 'fake-family-9', title: 'Schwimmkurs', start: at(7, 16), end: at(7, 17), allDay: false, location: 'Schwimmhalle', description: null },
      { id: 'fake-family-10', title: 'Wochenendausflug', start: at(11, 0), end: at(13, 0), allDay: true, location: 'Harz', description: null },
      { id: 'fake-family-11', title: 'Konzert', start: at(16, 20), end: at(16, 22, 30), allDay: false, location: 'Philharmonie', description: null },
      { id: 'fake-family-12', title: 'Sommerferien', start: at(23, 0), end: at(38, 0), allDay: true, location: null, description: null },
    ].filter((item) => new Date(item.start) < end && new Date(item.end) > start);
  }

  async listReminderSources(): Promise<ReminderSource[]> {
    return [
      { entityId: 'todo.einkaufsliste', name: 'Einkaufsliste', color: '#f6c945' },
      { entityId: 'todo.haushalt', name: 'Haushalt', color: '#7ec98f' },
    ];
  }

  async getReminders(entityId: string): Promise<Reminder[]> {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const due = (offset: number, hour = 0, minute = 0) => {
      const value = new Date(day);
      value.setDate(value.getDate() + offset);
      value.setHours(hour, minute, 0, 0);
      return value.toISOString();
    };
    if (entityId === 'todo.einkaufsliste') {
      return [
        { id: 'fake-r-1', title: 'Milch & Butter', due: null, completed: false, description: null },
        { id: 'fake-r-2', title: 'Geschenk für Mia', due: due(2, 18), completed: false, description: null },
        { id: 'fake-r-3', title: 'Batterien AA', due: null, completed: true, description: null },
      ];
    }
    if (entityId === 'todo.haushalt') {
      return [
        { id: 'fake-r-4', title: 'Rechnung Stadtwerke', due: due(-1, 12), completed: false, description: null },
        { id: 'fake-r-5', title: 'Blumen gießen', due: due(0, 19), completed: false, description: null },
      ];
    }
    return [];
  }

  onConnectionChange(cb: (status: ConnectionStatus) => void): void {
    this.#connCb = cb;
    cb(this.#status); // initial
  }

  callService(domain: string, service: string, entityId: string, data: Record<string, unknown>): void {
    if (this.#status !== 'connected') return; // offline: Server unerreichbar (docs/02)
    const forced = this.#forced.get(entityId);
    if (forced === 'drop') return; // kein Echo → 5-s-Timeout → „pending" (docs/02)

    const next = this.#apply(domain, service, entityId, data, forced === 'contradict');
    if (next === undefined) return;
    this.#truth.set(entityId, next);
    // Asynchrones Echo: die UI hat den optimistischen State längst gezeigt
    setTimeout(() => this.#push?.(entityId, structuredClone(next)), this.#latencyMs);
  }

  /* ── Test-Hooks (nur Dev; window.__hmi.backend) ── */
  force(entityId: string, mode: ForceMode): void { this.#forced.set(entityId, mode); }
  clearForce(entityId: string): void { this.#forced.delete(entityId); }

  /* Verbindungsabriss/-aufbau simulieren (docs/02 Offline/Reconnect). goOnline
     spielt reconnecting → connected und pusht die Wahrheit erneut (Re-Subscribe +
     Abgleich); der Backoff selbst ist Sache des HaBackend. */
  goOffline(): void { this.#setStatus('disconnected'); }
  goOnline(): void {
    if (this.#status === 'connected') return;
    this.#setStatus('reconnecting');
    setTimeout(() => {
      this.#setStatus('connected');
      for (const [id, value] of this.#truth) this.#push?.(id, structuredClone(value));
    }, 600);
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    this.#connCb?.(status);
  }

  /* Standard-HA-Semantik: der Server berechnet den Folgezustand aus dem
     Service-Call (docs/04 „Wichtige Services"). */
  #apply(domain: string, service: string, entityId: string, data: Record<string, unknown>, contradict: boolean): unknown {
    const cur = this.#truth.get(entityId);
    if (domain === 'light') {
      const v = { ...(cur as LightValue) };
      if (service === 'turn_off') v.on = false;
      else if (service === 'turn_on') {
        v.on = true;
        if (typeof data.brightness_pct === 'number') v.brightness = data.brightness_pct;
        // Farbtemperatur ↔ Farbe schließen sich aus (HA-color_mode).
        if (typeof data.color_temp_kelvin === 'number') { v.colorTemp = data.color_temp_kelvin; v.color = null; }
        if (Array.isArray(data.rgb_color)) v.color = rgbToHex(data.rgb_color as number[]);
      } else if (service === 'toggle') v.on = !v.on;
      // Widerspruch am zum Command passenden Feld (docs/02): Dimm-/Temp-/Farb-
      // Commands widersprechen ihrem Wert (Korrektur), ein Schalt-Command dem
      // on-Zustand (Toggle-Wobble).
      if (contradict) {
        if (typeof data.brightness_pct === 'number') v.brightness = Math.max(0, Math.min(100, v.brightness - 15));
        else if (typeof data.color_temp_kelvin === 'number') v.colorTemp = Math.max(2000, (v.colorTemp ?? 4000) - 800);
        else if (Array.isArray(data.rgb_color)) v.color = '#888888';
        else v.on = !v.on;
      }
      return v;
    }
    if (domain === 'switch' || domain === 'fan' || domain === 'input_boolean') {
      const v = { ...(cur as SwitchValue) };
      const wasOn = v.on;
      if (service === 'turn_off') v.on = false;
      else if (service === 'turn_on') v.on = true;
      else if (service === 'toggle') v.on = !v.on;
      if (contradict) v.on = !v.on;
      if (v.on !== wasOn) v.changedAt = Date.now();
      return v;
    }
    if (domain === 'cover') {
      const v = { ...(cur as SwitchValue) };
      if (service === 'open_cover') v.on = true;
      else if (service === 'close_cover') v.on = false;
      else if (service === 'toggle') v.on = !v.on;
      if (contradict) v.on = !v.on;
      return v;
    }
    if (domain === 'climate') {
      const v = { ...(cur as ClimateValue) };
      if (service === 'set_temperature' && typeof data.temperature === 'number') v.target = data.temperature;
      if (service === 'set_hvac_mode' && typeof data.hvac_mode === 'string') v.hvac = data.hvac_mode as ClimateValue['hvac'];
      if (contradict) v.target = Math.min(26, v.target + 1);
      return v;
    }
    if (domain === 'media_player') {
      const v = { ...(cur as MediaValue) };
      if (service === 'media_play_pause') v.playing = !v.playing;
      else if (service === 'media_play') v.playing = true;
      else if (service === 'media_pause') v.playing = false;
      else if (service === 'volume_set' && typeof data.volume_level === 'number') {
        v.volume = Math.round(data.volume_level * 100);
      } else if (service === 'play_media') {
        // Der „Server" löst media_id auf die Metadaten auf (docs/04): der Client
        // rät nur die optimistischen Felder (playing/source), Titel kommt von hier.
        const isRadio = data.label === 'Radio';
        v.playing = true;
        v.source = isRadio ? 'Radio' : 'Spotify';
        v.track = String(data.media_id ?? '');
        v.artist = isRadio ? 'Internetradio' : 'Playlist';
        v.duration = isRadio ? 0 : 2760; // Radio: Live-Stream ohne Fortschritt
      }
      // media_next_track/media_previous_track: fire-and-forget, kein State-Change.
      if (contradict) {
        if (service === 'volume_set') v.volume = v.volume > 50 ? v.volume - 20 : v.volume + 20;
        else v.playing = !v.playing; // Play/Pause bzw. play_media: Server meldet Gegenteil
      }
      return v;
    }
    return cur;
  }
}
