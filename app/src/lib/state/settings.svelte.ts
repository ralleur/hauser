/* ============================================
   UI-Zustand des Einstellungs-Screens (System-Tab) — Sektionswahl, Suche,
   Sprung-Highlight sowie die localStorage-gebundenen Werte (Demo-Modus,
   und Suchindex; hier lebt nur, was reaktiv sein muss.
   ============================================ */

import { m } from '../../paraglide/messages.js';
import { settingsEntry, type SettingsSectionId } from './settings-registry.ts';
import { backend } from '../adapter/runtime.svelte.ts';
import { HaBackend } from '../adapter/ha-backend.ts';
import { loadAvailableCalendars } from './calendar.svelte.ts';
import { sharedStorage } from './shared-config.ts';

function lsGet(key: string): string | null {
  try { return sharedStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) sharedStorage.removeItem(key);
    else sharedStorage.setItem(key, value);
  } catch { /* Storage blockiert/voll: best-effort */ }
}

export const settingsUi = $state({
  /* Einstieg auf „Räume & Geräte“: das ist die Seite, auf der wirklich etwas
     eingerichtet wird. Wer den Screen nur kurz verlässt, kommt zurück, wo er
     war (siehe enterSettings/leaveSettings). */
  section: 'rooms-devices' as SettingsSectionId,
  query: '',
  /* Sprungziel aus der Suche: die Zeile blitzt kurz auf (Chrome-Settings-Muster).
     seq unterscheidet wiederholte Sprünge auf dieselbe Einstellung. */
  highlight: null as string | null,
  highlightSeq: 0,
  /* Änderungen, die erst ein Neuladen der App aufnimmt (Backend-Wechsel, Resets) */
  needsReload: false,
  /* Offener Ruf, den Raumbild-Assistenten zu öffnen — etwa aus einer Meldung.
     Die Sektion verbraucht ihn, sobald sie da ist; deshalb ein Wunsch, der
     liegen bleibt, und keine Zählnummer: Der Ruf kommt an, bevor die Seite
     überhaupt gemountet ist. */
  pendingRoomImageWizard: false,
  /* Sprungziel von außerhalb der Einstellungen (Kontextmenü des
     Energie-Screens): Sektion und Zeile, die beim Betreten gelten sollen,
     statt des üblichen Starts bei Räume & Geräte. Wird beim Betreten
     verbraucht. */
  pendingJump: null as { section: SettingsSectionId; highlight: string | null } | null,
});

/* Ein kurzer Abstecher (Raum nachsehen, Musik lauter) soll die geöffnete
   Sektion nicht kosten; ein späterer Aufruf ist ein neuer Vorgang und startet
   wieder bei Räume & Geräte. */
const SECTION_RESUME_MS = 30_000;
let leftSettingsAt: number | null = null;

export function enterSettings(now: number = Date.now()): void {
  if (leftSettingsAt === null || now - leftSettingsAt > SECTION_RESUME_MS) {
    settingsUi.section = 'rooms-devices';
    settingsUi.highlight = null;
    settingsUi.query = '';
  }
  leftSettingsAt = null;
  applyPendingJump();
}

/** Von außen an eine Stelle der Einstellungen springen; greift beim Betreten. */
export function jumpToSetting(section: SettingsSectionId, highlight: string | null = null): void {
  settingsUi.pendingJump = { section, highlight };
}

export function applyPendingJump(): void {
  const jump = settingsUi.pendingJump;
  if (!jump) return;
  settingsUi.pendingJump = null;
  settingsUi.section = jump.section;
  settingsUi.query = '';
  settingsUi.highlight = jump.highlight;
  if (jump.highlight) settingsUi.highlightSeq++;
}

export function leaveSettings(now: number = Date.now()): void {
  leftSettingsAt = now;
}

export function openSection(id: SettingsSectionId): void {
  settingsUi.section = id;
  settingsUi.highlight = null;
}

export function openSetting(entryId: string): void {
  const entry = settingsEntry(entryId);
  if (!entry) return;
  settingsUi.section = entry.section;
  settingsUi.highlight = entryId;
  settingsUi.highlightSeq++;
  settingsUi.query = '';
}

/* ── localStorage-gebundene Werte: reaktiver Spiegel + Persistenz ── */

/* Wartezeit bis zum Lockscreen. `off` schaltet den automatischen Standby ganz
   ab — dann führt nur noch der Knopf „Jetzt starten“ dorthin. Ein fehlender
   Wert heißt Standardwert, nicht „aus“. */
export const STANDBY_DEFAULT_MINUTES = 3;
export const STANDBY_MIN_MINUTES = 1;
export const STANDBY_MAX_MINUTES = 240;

export function clampStandbyMinutes(value: number): number {
  if (!Number.isFinite(value)) return STANDBY_DEFAULT_MINUTES;
  return Math.min(STANDBY_MAX_MINUTES, Math.max(STANDBY_MIN_MINUTES, Math.round(value)));
}

function loadStandbyMinutes(): number | null {
  const stored = lsGet('hmi:standby-after');
  if (stored === null) return STANDBY_DEFAULT_MINUTES;
  if (stored === 'off') return null;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampStandbyMinutes(parsed) : STANDBY_DEFAULT_MINUTES;
}

export const settingsValues = $state({
  demoMode: lsGet('hmi:backend') === 'fake',
  haUrl: lsGet('hmi:ha-url') ?? '',
  jellyfinUrl: lsGet('hmi:jf-url') ?? '',
  paperlessUrl: lsGet('hmi:paperless-url') ?? '',
  paperlessTokenSet: (lsGet('hmi:paperless-token') ?? '').length > 0,
  libraryMode: (lsGet('hmi:library') ?? 'auto') as 'auto' | 'live' | 'fake',
  classicLockButton: lsGet('hmi:lock-button') !== 'large',
  ambientHeroText: lsGet('hmi:ambient-hero-text') === 'on',
  roomOnboardHidden: lsGet('hmi:room-onboard') === 'off',
  ambientDeepNight: lsGet('hmi:ambient-deep-night') !== 'off',
  standbyAfterMinutes: loadStandbyMinutes(),
  ambientCityMap: lsGet('hmi:ambient-map') !== 'off',
  presenceWake: lsGet('hmi:presence-wake') === 'on',
  presenceAwayDark: lsGet('hmi:presence-away-dark') === 'on',
  presenceGreeting: lsGet('hmi:presence-greeting') === 'on',
  ambientWeather: lsGet('hmi:ambient-weather') !== 'off',
  ambientLightDim: lsGet('hmi:ambient-light-dim') === 'on',
  offConfirmBefore: lsGet('hmi:off-confirm-before') === 'off'
    ? null
    : (lsGet('hmi:off-confirm-before') ?? '22:00'),
});

/* Ablage · Paperless: Adresse und API-Token liegen wie die übrigen
   Dienst-Zugänge in der geteilten Konfiguration — der Server liest beides für
   den Ablage-Proxy, ein Neustart ist nicht nötig. Der Token selbst wird nie
   wieder angezeigt, nur sein Vorhandensein. */
export function setPaperlessUrl(url: string): void {
  const value = url.trim();
  settingsValues.paperlessUrl = value;
  lsSet('hmi:paperless-url', value || null);
}

export function setPaperlessToken(token: string): void {
  const value = token.trim();
  settingsValues.paperlessTokenSet = value.length > 0;
  lsSet('hmi:paperless-token', value || null);
}

/* Lock-Button-Schema: Default ist der Button oben in der Status-Bar;
   „large" blendet stattdessen den großen Standby-FAB unten rechts ein.
   Rein reaktiv — kein Neuladen nötig. */
export function setClassicLockButton(on: boolean): void {
  settingsValues.classicLockButton = on;
  lsSet('hmi:lock-button', on ? null : 'large');
}

/* Experimenteller Tageskommentar im Lockscreen. Default ist aus — die Zeile
   ruft einen LLM-Dienst auf, das bleibt eine bewusste Entscheidung. Ein
   explizites „on" blendet sie reaktiv ein. */
export function setAmbientHeroText(on: boolean): void {
  settingsValues.ambientHeroText = on;
  lsSet('hmi:ambient-hero-text', on ? 'on' : null);
}

/* Die Onboarding-Karte für Raumbilder erklärt den Assistenten so lange, bis
   ein Raum ein Bild hat. Wer sie nicht mehr sehen will, schaltet sie hier
   dauerhaft ab — lokal für dieses Gerät, wie die übrigen Anzeigeschalter. */
export function setRoomOnboardHidden(hidden: boolean): void {
  settingsValues.roomOnboardHidden = hidden;
  lsSet('hmi:room-onboard', hidden ? 'off' : null);
}

/* Deep Night reduziert den Lockscreen zwischen 22:00 und 06:00 auf eine rote
   Uhr. Default aktiv; das Opt-out gilt lokal für das jeweilige Panel. */
export function setAmbientDeepNight(on: boolean): void {
  settingsValues.ambientDeepNight = on;
  lsSet('hmi:ambient-deep-night', on ? null : 'off');
}

/* Wartezeit bis zum Lockscreen, gerätelokal wie die übrigen Standby-Schalter.
   `null` schaltet den automatischen Standby ab; der manuelle Weg über
   „Jetzt starten“ bleibt davon unberührt. */
export function setStandbyAfterMinutes(minutes: number | null): void {
  const value = minutes === null ? null : clampStandbyMinutes(minutes);
  settingsValues.standbyAfterMinutes = value;
  lsSet('hmi:standby-after', value === null ? 'off' : String(value));
}

/* Stadtplan-Hintergrund im Standby (docs/18 §3.2). Standort und Asset sind
   zentral, die Sichtbarkeit ist gerätelokal: `hmi:ambient-map` steht nicht in
   SHARED_CONFIG_KEYS und wandert deshalb nicht in die Household Config.

   Default an (Owner-Entscheidung 2026-09-07, ersetzt „Default aus"): Der
   Standby zeigt die Karte ohnehin nur, wenn der Haushalt einen Ort gesetzt
   hat und der Server das Asset gerendert hat (`ambientMap.assetUrl`). Wer den
   Ort einträgt, will die Karte sehen und soll dafür nicht noch einen zweiten
   Schalter suchen; ohne Ort ändert der Default nichts. Ein neues Gerät zeigt
   damit dieselbe Wand wie das erste. Gespeichert wird deshalb nur noch das
   Abschalten — ein alter Wert `on` bleibt gültig. */
export function setAmbientCityMap(on: boolean): void {
  settingsValues.ambientCityMap = on;
  lsSet('hmi:ambient-map', on ? null : 'off');
}

/* ── Präsenz und Person (Paket 8) ──
   Alle drei Schalter sind gerätelokal und standardmäßig aus: ein Panel, das
   von selbst aufwacht oder Namen nennt, ist eine bewusste Entscheidung. */
export function setPresenceWake(on: boolean): void {
  settingsValues.presenceWake = on;
  lsSet('hmi:presence-wake', on ? 'on' : null);
}

export function setPresenceAwayDark(on: boolean): void {
  settingsValues.presenceAwayDark = on;
  lsSet('hmi:presence-away-dark', on ? 'on' : null);
}

export function setPresenceGreeting(on: boolean): void {
  settingsValues.presenceGreeting = on;
  lsSet('hmi:presence-greeting', on ? 'on' : null);
}

/* ── Wetter und Helligkeit (Paket 9) ──
   Das Wetter zieht über den Lockscreen und ist deshalb an — dort ist es eine
   Wandtafel, kein Innenraum. Das Mitdimmen mit dem Raumlicht braucht einen
   Sensor und bleibt aus, bis es jemand einschaltet. Beides gerätelokal. */
export function setAmbientWeather(on: boolean): void {
  settingsValues.ambientWeather = on;
  lsSet('hmi:ambient-weather', on ? null : 'off');
}

export function setAmbientLightDim(on: boolean): void {
  settingsValues.ambientLightDim = on;
  lsSet('hmi:ambient-light-dim', on ? 'on' : null);
}

/* Sicherheitsabfrage für den mobilen „Aus“-Button. null deaktiviert sie;
   ansonsten gilt die lokale Uhrzeit dieses Geräts. */
export function setOffConfirmBefore(value: string | null): void {
  settingsValues.offConfirmBefore = value;
  lsSet('hmi:off-confirm-before', value ?? 'off');
}

/* Backend-Wahl wird beim App-Start gelesen (runtime.svelte.ts) — die
   Umschaltung greift deshalb erst nach einem Neuladen. */
export function setDemoMode(on: boolean): void {
  settingsValues.demoMode = on;
  lsSet('hmi:backend', on ? 'fake' : null);
  settingsUi.needsReload = true;
}

/* HA-Basis-URL: backend/runtime-Singleton entsteht beim App-Start → Neuladen nötig.
   Leerer Wert = Override entfernen, Env/Default (HA_URL_DEFAULT) gilt wieder. */
export function setHaUrl(value: string): void {
  const v = value.trim().replace(/\/+$/, '');
  settingsValues.haUrl = v;
  lsSet('hmi:ha-url', v || null);
  settingsUi.needsReload = true;
}

/* Jellyfin-Basis-URL: Singleton entsteht beim App-Start → Neuladen nötig. */
export function setJellyfinUrl(value: string): void {
  const v = value.trim().replace(/\/+$/, '');
  settingsValues.jellyfinUrl = v;
  lsSet('hmi:jf-url', v || null);
  settingsUi.needsReload = true;
}

/* Bibliotheks-Modus (hmi:library, docs/08): auto folgt dem HA-Backend,
   live/fake übersteuern. Wird beim App-Start gelesen → Neuladen nötig. */
export function setLibraryMode(mode: 'auto' | 'live' | 'fake'): void {
  settingsValues.libraryMode = mode;
  lsSet('hmi:library', mode === 'auto' ? null : mode);
  settingsUi.needsReload = true;
}

/* ── iCloud-Kalender: HA-Config-Flow (CalDAV) aus dem Panel anstoßen ──
   Das App-Passwort wird ausschließlich an Home Assistant durchgereicht —
   nie in localStorage, nie im State über den Request hinaus. */

export const icloudSetup = $state({
  running: false,
  result: null as { ok: boolean; message: string } | null,
});

export async function setupICloudCalendar(username: string, appPassword: string): Promise<void> {
  const user = username.trim();
  if (!user || !appPassword || icloudSetup.running) return;
  icloudSetup.running = true;
  icloudSetup.result = null;
  try {
    if (!(backend instanceof HaBackend)) {
      icloudSetup.result = { ok: false, message: m.sys_icloud_demo_disabled() };
      return;
    }
    icloudSetup.result = await backend.setupICloudCalendar(user, appPassword);
    if (icloudSetup.result.ok) {
      /* HA legt die calendar.*-Entitäten asynchron an — nach kurzer Wartezeit
         die Auswahl-Liste auffrischen, damit die neuen Kalender erscheinen. */
      setTimeout(() => { void loadAvailableCalendars(); }, 4000);
    }
  } finally {
    icloudSetup.running = false;
  }
}

/* ── Wartung: Caches und gespeicherte Konfiguration entfernen ── */

export function clearStoredKeys(keys: readonly string[]): void {
  for (const key of keys) lsSet(key, null);
}

export function hasStoredKey(key: string): boolean {
  return lsGet(key) !== null;
}
