import { m } from '../../paraglide/messages.js';
import { AI_CUSTOMIZING_ENABLED, ROOM_IMAGE_WIZARD_ENABLED } from '../config/product-capabilities.ts';
import { IS_DEMO } from '../demo/demo-mode.ts';
/* ============================================
   Einstellungs-Registry — die eine Quelle für Gruppen, Sektionen (Sidebar) und
   durchsuchbare Einträge (Chrome-Settings-artige Suche). Pure Daten +
   pure Suchfunktion; der UI-Zustand lebt in settings.svelte.ts.

   Aufbau (macOS-Systemeinstellungen-Muster): die Sidebar zeigt Gruppen als
   nicht klickbare Überschriften, darunter alle Sektionen sichtbar. Die Gruppe
   ist reine Gliederung — navigiert wird immer auf Sektionsebene.

   Leitprinzip: Einsortiert wird nach dem Objekt, das die Einstellung betrifft —
   niemals nach der Technik dahinter. Wer den Tageskommentar im Standby sucht,
   sucht ihn beim Standby, nicht unter „KI“ — so wie niemand die Lautstärke
   unter „Bluetooth“ sucht. Die Gruppe `ai` ist deshalb aufgelöst: KI-Zugang
   und Modellwahl sind eine Dienstkarte neben Home Assistant und Jellyfin,
   KI-gestützte Funktionen wohnen dort, wo der Nutzer sie sieht.

   Leitfragen der Gruppen:
     home         → Wie ist mein Zuhause in Hauser strukturiert?
     appearance   → Wie sieht es aus und verhält sich?
     content      → Was zeige ich aus den Diensten an?
     connectivity → Was hängt dran und funktioniert es?
     system       → Diagnose und Notfallwerkzeuge.
   ============================================ */

export type SettingsGroupId =
  | 'home'
  | 'appearance'
  | 'content'
  | 'connectivity'
  | 'system';

export type SettingsSectionId =
  /* Zuhause */
  | 'rooms-devices'
  | 'laundry'
  | 'hotel-mode'
  | 'hotel-guest-access'
  /* Darstellung */
  | 'appearance'
  | 'layout'
  | 'ambient'
  /* Inhalte */
  | 'calendar'
  | 'shopping'
  | 'media'
  /* Verbindungen */
  | 'services'
  /* System */
  | 'status'
  | 'ai-customizing'
  | 'maintenance';

export type SettingsTint = 'success' | 'cool' | 'warm' | 'neutral';

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
}

export interface SettingsSection {
  id: SettingsSectionId;
  group: SettingsGroupId;
  label: string;
  description: string;
  icon: string;
  tint: SettingsTint;
}

export interface SettingsEntry {
  id: string;
  section: SettingsSectionId;
  label: string;
  /* Synonyme/Begriffe, unter denen jemand die Einstellung sucht */
  keywords: readonly string[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'home', get label() { return m.settings_group_home_label(); } },
  { id: 'appearance', get label() { return m.settings_group_appearance_label(); } },
  { id: 'content', get label() { return m.settings_group_content_label(); } },
  { id: 'connectivity', get label() { return m.settings_group_connectivity_label(); } },
  { id: 'system', get label() { return m.settings_group_system_label(); } },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'rooms-devices', group: 'home',
    get label() { return m.settings_section_rooms_devices_label(); }, icon: 'i-home', tint: 'warm',
    get description() { return m.settings_section_rooms_devices_desc(); },
  },
  {
    id: 'laundry', group: 'home',
    get label() { return m.settings_section_laundry_label(); }, icon: 'i-washing-machine', tint: 'warm',
    get description() { return m.settings_section_laundry_desc(); },
  },
  {
    id: 'hotel-mode', group: 'home',
    get label() { return m.settings_section_hotel_mode_label(); }, icon: 'i-bed', tint: 'cool',
    get description() { return m.settings_section_hotel_mode_desc(); },
  },
  {
    id: 'hotel-guest-access', group: 'home',
    get label() { return m.settings_section_hotel_access_label(); }, icon: 'i-account-key', tint: 'warm',
    get description() { return m.settings_section_hotel_access_desc(); },
  },
  {
    id: 'appearance', group: 'appearance',
    get label() { return m.settings_section_appearance_label(); }, icon: 'i-theme-light-dark', tint: 'warm',
    get description() { return m.settings_section_appearance_desc(); },
  },
  {
    id: 'layout', group: 'appearance',
    get label() { return m.settings_section_layout_label(); }, icon: 'i-view-dashboard', tint: 'neutral',
    get description() { return m.settings_section_layout_desc(); },
  },
  {
    id: 'ambient', group: 'appearance',
    get label() { return m.settings_section_ambient_label(); }, icon: 'i-weather-night', tint: 'cool',
    get description() { return m.settings_section_ambient_desc(); },
  },
  {
    id: 'calendar', group: 'content',
    get label() { return m.settings_section_calendar_label(); }, icon: 'i-calendar', tint: 'cool',
    get description() { return m.settings_section_calendar_desc(); },
  },
  {
    id: 'shopping', group: 'content',
    get label() { return m.settings_section_shopping_label(); }, icon: 'i-cart', tint: 'success',
    get description() { return m.settings_section_shopping_desc(); },
  },
  {
    id: 'media', group: 'content',
    get label() { return m.settings_section_media_label(); }, icon: 'i-music-note', tint: 'cool',
    get description() { return m.settings_section_media_desc(); },
  },
  {
    id: 'services', group: 'connectivity',
    get label() { return m.settings_section_services_label(); }, icon: 'i-lan-connect', tint: 'success',
    get description() { return m.settings_section_services_desc(); },
  },
  {
    id: 'status', group: 'system',
    get label() { return m.settings_section_status_label(); }, icon: 'i-heart-pulse', tint: 'success',
    get description() { return m.settings_section_status_desc(); },
  },
  {
    id: 'ai-customizing', group: 'system',
    get label() { return m.settings_section_ai_customizing_label(); }, icon: 'i-creation', tint: 'cool',
    get description() { return m.settings_section_ai_customizing_desc(); },
  },
  {
    id: 'maintenance', group: 'system',
    get label() { return m.settings_section_maintenance_label(); }, icon: 'i-wrench', tint: 'neutral',
    get description() { return m.settings_section_maintenance_desc(); },
  },
];

/* Einträge behalten ihre Ids — Deep-Links über openSetting() bleiben gültig,
   auch wenn sich die Sektionszuordnung ändert. */
const ALL_SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  /* ── Zuhause · Räume & Geräte ── */
  { id: 'household-setup', section: 'rooms-devices', label: 'Räume verwalten',
    keywords: ['räume', 'raum', 'zimmer', 'geräte', 'sortieren', 'umbenennen', 'löschen'] },
  ...(ROOM_IMAGE_WIZARD_ENABLED && !IS_DEMO ? [{
    id: 'room-image-wizard', section: 'rooms-devices' as const, label: 'Raumbilder erstellen',
    keywords: ['raumbild', 'raumfoto', 'openai', 'hintergrund', 'bild', 'wizard', 'generieren'],
  }] : []),
  { id: 'reset-devices', section: 'rooms-devices', get label() { return m.settings_entry_reset_devices_label(); },
    keywords: ['umbenennen', 'symbole', 'lampen', 'lichter', 'reset', 'standard'] },
  { id: 'reset-scenes', section: 'rooms-devices', get label() { return m.settings_entry_reset_scenes_label(); },
    keywords: ['scenes', 'presets', 'reset', 'standard'] },

  /* ── Zuhause · Wäsche ── */
  { id: 'laundry', section: 'laundry', get label() { return m.settings_laundry_title(); },
    keywords: ['wäsche', 'waschmaschine', 'trockner', 'laundry', 'helper', 'blueprint', 'leistungssensor'] },

  /* ── Zuhause · Hotel Mode ── */
  { id: 'hotel-activation', section: 'hotel-mode', get label() { return m.settings_hotel_activation(); },
    keywords: ['hotel', 'ferienwohnung', 'apartment', 'gast', 'aktivieren', 'kiosk', 'vermietung'] },
  { id: 'hotel-pin', section: 'hotel-mode', get label() { return m.settings_hotel_pin(); },
    keywords: ['pin', 'admin', 'code', 'sperren', 'verwaltung', 'hotel'] },
  { id: 'hotel-calendar', section: 'hotel-mode', get label() { return m.settings_hotel_calendar(); },
    keywords: ['kalender', 'aufenthalt', 'anreise', 'abreise', 'zeitzone', 'buchung', 'hotel'] },
  { id: 'hotel-checkout', section: 'hotel-mode', get label() { return m.settings_hotel_checkout(); },
    keywords: ['checkout', 'abreise', 'szene', 'scene', 'benachrichtigung', 'hotel'] },
  { id: 'hotel-override', section: 'hotel-mode', get label() { return m.settings_hotel_override(); },
    keywords: ['manuell', 'override', 'aufenthalt', 'früh', 'verlängern', 'hotel'] },

  /* ── Zuhause · Gastfreigaben ── */
  { id: 'hotel-guest-access', section: 'hotel-guest-access', get label() { return m.settings_hotel_access(); },
    keywords: ['freigabe', 'gast', 'geräte', 'räume', 'allowlist', 'erlaubt', 'hotel'] },
  { id: 'hotel-scenes', section: 'hotel-guest-access', get label() { return m.settings_hotel_scenes(); },
    keywords: ['szene', 'scene', 'skript', 'script', 'freigabe', 'hotel'] },
  { id: 'hotel-preview', section: 'hotel-guest-access', get label() { return m.settings_hotel_preview(); },
    keywords: ['vorschau', 'gast', 'preview', 'freigabe', 'hotel'] },

  /* ── Darstellung ── */
  { id: 'theme-mode', section: 'appearance', get label() { return m.settings_entry_theme_mode_label(); },
    keywords: ['theme', 'dunkel', 'hell', 'dark', 'light', 'nacht', 'tag', 'automatisch', 'sonne', 'design', 'farben'] },
  { id: 'ui-language', section: 'appearance', get label() { return m.settings_entry_ui_language_label(); },
    keywords: ['sprache', 'language', 'deutsch', 'englisch', 'locale', 'übersetzung'] },
  { id: 'layout-config', section: 'layout', get label() { return m.settings_entry_layout_config_label(); },
    keywords: ['layout', 'raum', 'kontext', 'breite', 'flächen', 'panel', 'hero', 'kacheln', 'energie'] },
  { id: 'layout-reset', section: 'layout', get label() { return m.settings_entry_layout_reset_label(); },
    keywords: ['standard', 'default', 'reset', 'werkseinstellung'] },
  { id: 'off-confirm-before', section: 'layout', get label() { return m.settings_entry_off_confirm_before_label(); },
    keywords: ['mobile', 'lichter', 'fernseher', 'tv', 'uhrzeit', 'bestätigung', 'nachfrage', 'deaktivieren'] },
  { id: 'standby-now', section: 'ambient', get label() { return m.settings_entry_standby_now_label(); },
    keywords: ['ruhezustand', 'idle', 'bildschirmschoner', 'screensaver', 'schlafen', 'aus'] },
  { id: 'ambient-deep-night', section: 'ambient', get label() { return m.settings_entry_ambient_deep_night_label(); },
    keywords: ['nacht', 'nachts', 'uhr', 'rot', 'dunkel', 'standby', 'lockscreen', '22', '06', 'iphone'] },
  { id: 'ambient-hero-text', section: 'ambient', get label() { return m.settings_entry_ambient_hero_text_label(); },
    keywords: ['llm', 'ki', 'ai', 'tageskommentar', 'hero', 'lockscreen', 'standby', 'abschalten'] },

  /* ── Inhalte ── */
  { id: 'calendar-selection', section: 'calendar', get label() { return m.settings_entry_calendar_selection_label(); },
    keywords: ['auswahl', 'familie', 'termine', 'agenda', 'entität', 'anzeigen', 'ausblenden'] },
  { id: 'reminders-selection', section: 'calendar', get label() { return m.settings_entry_reminders_selection_label(); },
    keywords: ['erinnerungen', 'reminders', 'todo', 'aufgaben', 'listen', 'einkaufsliste', 'post-it', 'apple', 'icloud'] },
  { id: 'shopping-stores', section: 'shopping', get label() { return m.settings_entry_shopping_stores_label(); },
    keywords: ['einkaufsliste', 'laden', 'aldi', 'rewe', 'dm', 'anlegen', 'löschen', 'reihenfolge'] },
  { id: 'shopping-categories', section: 'shopping', get label() { return m.settings_entry_shopping_categories_label(); },
    keywords: ['sortieren', 'warengruppen', 'laufweg', 'frische', 'kühlung', 'drogerie'] },
  { id: 'library-mode', section: 'media', get label() { return m.settings_entry_library_mode_label(); },
    keywords: ['live', 'demo', 'fake', 'mock', 'automatisch', 'testdaten', 'bibliothek', 'jellyfin'] },
  ...(!IS_DEMO ? [{ id: 'ai-song-lyrics', section: 'media' as const, get label() { return m.settings_entry_ai_song_lyrics_label(); },
    keywords: ['songtexte', 'lyrics', 'songwerkstatt', 'musik', 'text', 'generieren', 'llm'] }] : []),

  /* ── Verbindungen · Dienste (eine Integrationskarte je Dienst) ── */
  { id: 'connection-status', section: 'services', get label() { return m.settings_entry_connection_status_label(); },
    keywords: ['home assistant', 'websocket', 'online', 'offline', 'getrennt', 'verbunden', 'integration', 'dienst'] },
  { id: 'ha-url', section: 'services', get label() { return m.settings_entry_ha_url_label(); },
    keywords: ['url', 'server', 'host', 'ip', 'websocket', 'adresse', 'home assistant'] },
  { id: 'ha-token', section: 'services', get label() { return m.settings_entry_ha_token_label(); },
    keywords: ['home assistant', 'login', 'anmelden', 'auth', 'schlüssel', 'access token'] },
  { id: 'jf-url', section: 'services', get label() { return m.settings_entry_jf_url_label(); },
    keywords: ['jellyfin', 'media', 'server', 'url', 'filme', 'serien', 'host', 'adresse'] },
  { id: 'jf-session', section: 'services', get label() { return m.settings_entry_jf_session_label(); },
    keywords: ['jellyfin', 'login', 'abmelden', 'logout', 'benutzer', 'passwort', 'zugangsdaten', 'konto'] },
  { id: 'jf-device', section: 'services', get label() { return m.settings_entry_jf_device_label(); },
    keywords: ['jellyfin', 'gerät', 'device', 'id', 'kennung', 'wiedergabe'] },
  { id: 'icloud-setup', section: 'services', get label() { return m.settings_entry_icloud_setup_label(); },
    keywords: ['apple', 'apple-id', 'caldav', 'app-passwort', 'account', 'einrichten', 'anmelden', 'icloud', 'kalender'] },
  { id: 'ablage-status', section: 'services', get label() { return m.settings_entry_ablage_status_label(); },
    keywords: ['paperless', 'ablage', 'dokumente', 'pin', 'privat', 'archiv', 'scan'] },
  ...(!IS_DEMO ? [{ id: 'songs-status', section: 'services' as const, get label() { return m.settings_entry_songs_status_label(); },
    keywords: ['songwerkstatt', 'ace-step', 'acestep', 'musik', 'lieder', 'generator', 'audio'] }] : []),
  ...(AI_CUSTOMIZING_ENABLED ? [{
    id: 'ai-access-status', section: 'services' as const,
    get label() { return m.settings_entry_ai_access_status_label(); },
    keywords: ['api', 'key', 'schlüssel', 'zugang', 'hermes', 'verbindung', 'kosten', 'konfiguriert'],
  }] : []),
  { id: 'ai-models', section: 'services', get label() { return m.settings_entry_ai_models_label(); },
    keywords: ['modell', 'model', 'gpt', 'luna', 'codex', 'llm', 'welches'] },

  /* ── System ── */
  { id: 'service-health', section: 'status', get label() { return m.settings_entry_service_health_label(); },
    keywords: ['zigbee', 'mqtt', 'broker', 'tunnel', 'cloudflared', 'adguard', 'services', 'gesundheit'] },
  { id: 'update-list', section: 'status', get label() { return m.settings_entry_update_list_label(); },
    keywords: ['aktualisierung', 'version', 'software', 'core', 'os', 'esphome', 'matter'] },
  { id: 'license-source', section: 'status', get label() { return m.settings_entry_license_source_label(); },
    keywords: ['lizenz', 'license', 'agpl', 'quellcode', 'source', 'open source', 'commit', 'revision', 'version', 'copyright'] },
  ...(AI_CUSTOMIZING_ENABLED ? [{
    id: 'ai-chat', section: 'ai-customizing' as const,
    get label() { return m.settings_entry_ai_chat_label(); },
    keywords: ['ki', 'ai', 'chat', 'agent', 'feature', 'anpassen', 'customizing', 'hermes', 'wunsch'],
  }, {
    id: 'ai-history', section: 'ai-customizing' as const,
    get label() { return m.settings_entry_ai_history_label(); },
    keywords: ['verlauf', 'sessions', 'historie', 'zurückrollen', 'rückgängig', 'rollback', 'features'],
  }, {
    id: 'ai-debug', section: 'ai-customizing' as const,
    get label() { return m.settings_entry_ai_debug_label(); },
    keywords: ['debug', 'diagnose', 'werkzeugschritte', 'rohtext', 'fehler', 'details'],
  }] : []),
  { id: 'cache-ha', section: 'maintenance', get label() { return m.settings_entry_cache_ha_label(); },
    keywords: ['home assistant', 'zustand', 'states', 'zwischenspeicher', 'cache'] },
  { id: 'cache-calendar', section: 'maintenance', get label() { return m.settings_entry_cache_calendar_label(); },
    keywords: ['termine', 'familie', 'events', 'zwischenspeicher', 'cache'] },
  { id: 'cache-icons', section: 'maintenance', get label() { return m.settings_entry_cache_icons_label(); },
    keywords: ['zuletzt verwendet', 'symbole', 'picker', 'zwischenspeicher', 'cache'] },
  { id: 'demo-mode', section: 'maintenance', get label() { return m.settings_entry_demo_mode_label(); },
    keywords: ['fake', 'backend', 'mock', 'simulation', 'entwicklung', 'testdaten', 'live', 'echt'] },
  { id: 'reload-app', section: 'maintenance', get label() { return m.settings_entry_reload_app_label(); },
    keywords: ['neustart', 'refresh', 'reload', 'browser', 'kiosk'] },
];

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = ALL_SETTINGS_ENTRIES;

export interface SettingsMatch {
  entry: SettingsEntry;
  section: SettingsSection;
}

const sectionById = new Map(SETTINGS_SECTIONS.map((s) => [s.id, s]));
const groupById = new Map(SETTINGS_GROUPS.map((g) => [g.id, g]));

export function settingsSection(id: SettingsSectionId): SettingsSection {
  return sectionById.get(id)!;
}

export function settingsGroup(id: SettingsGroupId): SettingsGroup {
  return groupById.get(id)!;
}

export function settingsEntry(id: string): SettingsEntry | undefined {
  return SETTINGS_ENTRIES.find((e) => e.id === id);
}

/* Sidebar-Reihenfolge: Gruppen in der Reihenfolge von SETTINGS_GROUPS, je
   Gruppe ihre Sektionen in der Reihenfolge von SETTINGS_SECTIONS. Sektionen,
   deren Einträge alle durch abgeschaltete Feature-Flags entfallen sind, werden
   ausgeblendet, damit die Sidebar nie eine leere Überschrift zeigt — genauso
   wie Gruppen ohne Sektionen herausfallen. */
export function settingsSidebar(): readonly { group: SettingsGroup; sections: readonly SettingsSection[] }[] {
  const entriesBySection = new Map<SettingsSectionId, number>();
  for (const entry of SETTINGS_ENTRIES) {
    entriesBySection.set(entry.section, (entriesBySection.get(entry.section) ?? 0) + 1);
  }
  return SETTINGS_GROUPS
    .map((group) => ({ group, sections: SETTINGS_SECTIONS.filter((s) => s.group === group.id && (entriesBySection.get(s.id) ?? 0) > 0) }))
    .filter((entry) => entry.sections.length > 0);
}

/* Suche wie in den Chrome-Settings: alle Wörter der Anfrage müssen irgendwo
   in Label, Keywords, Sektions- oder Gruppenname vorkommen (UND-Verknüpfung).
   Label-Treffer ranken vor reinen Keyword-Treffern. */
export function searchSettings(query: string): SettingsMatch[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: { match: SettingsMatch; score: number }[] = [];
  for (const entry of SETTINGS_ENTRIES) {
    const section = sectionById.get(entry.section)!;
    const group = groupById.get(section.group)!;
    const label = entry.label.toLowerCase();
    const haystack = `${label} ${entry.keywords.join(' ')} ${section.label.toLowerCase()} ${group.label.toLowerCase()}`;
    if (!tokens.every((t) => haystack.includes(t))) continue;
    const score = tokens.every((t) => label.includes(t)) ? (label.startsWith(tokens[0]) ? 0 : 1) : 2;
    scored.push({ match: { entry, section }, score });
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.match);
}
