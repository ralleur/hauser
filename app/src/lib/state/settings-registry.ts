import { m } from '../../paraglide/messages.js';
/* ============================================
   Einstellungs-Registry — die eine Quelle für Gruppen, Sektionen (Sidebar) und
   durchsuchbare Einträge (Chrome-Settings-artige Suche). Pure Daten +
   pure Suchfunktion; der UI-Zustand lebt in settings.svelte.ts.

   Aufbau (macOS-Systemeinstellungen-Muster): die Sidebar zeigt Gruppen als
   nicht klickbare Überschriften, darunter alle Sektionen sichtbar. Die Gruppe
   ist reine Gliederung — navigiert wird immer auf Sektionsebene.

   Leitfragen der Gruppen:
     connectivity → Was hängt dran und funktioniert es?
     ai           → Was nutzt die KI und was kostet das?
     appearance   → Wie sieht es aus und verhält sich?
     content      → Was zeige ich aus den Diensten an?
     system       → Diagnose und Notfallwerkzeuge.
   ============================================ */

export type SettingsGroupId =
  | 'connectivity'
  | 'ai'
  | 'appearance'
  | 'content'
  | 'system';

export type SettingsSectionId =
  /* Verbindungen */
  | 'services'
  | 'operating-mode'
  /* KI-Funktionen */
  | 'ai-access'
  | 'ai-features'
  /* Darstellung */
  | 'appearance'
  | 'home-layout'
  | 'ambient'
  /* Inhalte */
  | 'calendar'
  | 'shopping'
  /* System */
  | 'status'
  | 'updates'
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
  { id: 'connectivity', get label() { return m.settings_group_connectivity_label(); } },
  { id: 'ai', get label() { return m.settings_group_ai_label(); } },
  { id: 'appearance', get label() { return m.settings_group_appearance_label(); } },
  { id: 'content', get label() { return m.settings_group_content_label(); } },
  { id: 'system', get label() { return m.settings_group_system_label(); } },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'services', group: 'connectivity',
    get label() { return m.settings_section_services_label(); }, icon: 'i-lan-connect', tint: 'success',
    get description() { return m.settings_section_services_desc(); },
  },
  {
    id: 'operating-mode', group: 'connectivity',
    get label() { return m.settings_section_operating_mode_label(); }, icon: 'i-television-play', tint: 'neutral',
    get description() { return m.settings_section_operating_mode_desc(); },
  },
  {
    id: 'ai-access', group: 'ai',
    get label() { return m.settings_section_ai_access_label(); }, icon: 'i-key-variant', tint: 'cool',
    get description() { return m.settings_section_ai_access_desc(); },
  },
  {
    id: 'ai-features', group: 'ai',
    get label() { return m.settings_section_ai_features_label(); }, icon: 'i-creation', tint: 'cool',
    get description() { return m.settings_section_ai_features_desc(); },
  },
  {
    id: 'appearance', group: 'appearance',
    get label() { return m.settings_section_appearance_label(); }, icon: 'i-theme-light-dark', tint: 'warm',
    get description() { return m.settings_section_appearance_desc(); },
  },
  {
    id: 'home-layout', group: 'appearance',
    get label() { return m.settings_section_home_layout_label(); }, icon: 'i-view-dashboard', tint: 'neutral',
    get description() { return m.settings_section_home_layout_desc(); },
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
    get label() { return m.settings_section_shopping_label(); }, icon: 'i-shopping-cart', tint: 'success',
    get description() { return m.settings_section_shopping_desc(); },
  },
  {
    id: 'status', group: 'system',
    get label() { return m.settings_section_status_label(); }, icon: 'i-heart-pulse', tint: 'success',
    get description() { return m.settings_section_status_desc(); },
  },
  {
    id: 'updates', group: 'system',
    get label() { return m.settings_section_updates_label(); }, icon: 'i-update', tint: 'cool',
    get description() { return m.settings_section_updates_desc(); },
  },
  {
    id: 'maintenance', group: 'system',
    get label() { return m.settings_section_maintenance_label(); }, icon: 'i-wrench', tint: 'neutral',
    get description() { return m.settings_section_maintenance_desc(); },
  },
];

/* Einträge behalten ihre Ids — Deep-Links über openSetting() bleiben gültig,
   auch wenn sich die Sektionszuordnung ändert. */
export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
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
  { id: 'songs-status', section: 'services', get label() { return m.settings_entry_songs_status_label(); },
    keywords: ['songwerkstatt', 'ace-step', 'acestep', 'musik', 'lieder', 'generator', 'audio'] },

  /* ── Verbindungen · Betriebsmodus (die eine Wahrheit für Live/Demo) ── */
  { id: 'demo-mode', section: 'operating-mode', get label() { return m.settings_entry_demo_mode_label(); },
    keywords: ['fake', 'backend', 'mock', 'simulation', 'entwicklung', 'testdaten', 'live', 'echt'] },
  { id: 'library-mode', section: 'operating-mode', get label() { return m.settings_entry_library_mode_label(); },
    keywords: ['live', 'demo', 'fake', 'mock', 'automatisch', 'testdaten', 'bibliothek', 'jellyfin'] },

  /* ── KI · Zugang & Modelle ── */
  { id: 'ai-access-status', section: 'ai-access', get label() { return m.settings_entry_ai_access_status_label(); },
    keywords: ['api', 'key', 'schlüssel', 'zugang', 'hermes', 'verbindung', 'kosten', 'konfiguriert'] },
  { id: 'ai-models', section: 'ai-access', get label() { return m.settings_entry_ai_models_label(); },
    keywords: ['modell', 'model', 'gpt', 'luna', 'codex', 'llm', 'welches'] },
  { id: 'ai-debug', section: 'ai-access', get label() { return m.settings_entry_ai_debug_label(); },
    keywords: ['debug', 'diagnose', 'werkzeugschritte', 'rohtext', 'fehler', 'details'] },

  /* ── KI · Funktionen (alles, was einen KI-Zugang voraussetzt) ── */
  { id: 'ai-chat', section: 'ai-features', get label() { return m.settings_entry_ai_chat_label(); },
    keywords: ['ki', 'ai', 'chat', 'agent', 'feature', 'anpassen', 'customizing', 'hermes', 'wunsch'] },
  { id: 'ai-history', section: 'ai-features', get label() { return m.settings_entry_ai_history_label(); },
    keywords: ['verlauf', 'sessions', 'historie', 'zurückrollen', 'rückgängig', 'rollback', 'features'] },
  { id: 'ambient-hero-text', section: 'ai-features', get label() { return m.settings_entry_ambient_hero_text_label(); },
    keywords: ['llm', 'ki', 'ai', 'gpt', 'luna', 'codex', 'tageskommentar', 'hero', 'lockscreen', 'standby', 'abschalten'] },
  { id: 'ai-song-lyrics', section: 'ai-features', get label() { return m.settings_entry_ai_song_lyrics_label(); },
    keywords: ['songtexte', 'lyrics', 'songwerkstatt', 'musik', 'text', 'generieren', 'llm'] },

  /* ── Darstellung ── */
  { id: 'theme-mode', section: 'appearance', get label() { return m.settings_entry_theme_mode_label(); },
    keywords: ['theme', 'dunkel', 'hell', 'dark', 'light', 'nacht', 'tag', 'automatisch', 'sonne', 'design', 'farben'] },
  { id: 'ui-language', section: 'appearance', get label() { return m.settings_entry_ui_language_label(); },
    keywords: ['sprache', 'language', 'deutsch', 'englisch', 'locale', 'übersetzung'] },
  { id: 'layout-config', section: 'home-layout', get label() { return m.settings_entry_layout_config_label(); },
    keywords: ['layout', 'raum', 'kontext', 'breite', 'flächen', 'panel', 'hero', 'kacheln', 'energie'] },
  { id: 'layout-reset', section: 'home-layout', get label() { return m.settings_entry_layout_reset_label(); },
    keywords: ['standard', 'default', 'reset', 'werkseinstellung'] },
  { id: 'off-confirm-before', section: 'home-layout', get label() { return m.settings_entry_off_confirm_before_label(); },
    keywords: ['mobile', 'lichter', 'fernseher', 'tv', 'uhrzeit', 'bestätigung', 'nachfrage', 'deaktivieren'] },
  { id: 'standby-now', section: 'ambient', get label() { return m.settings_entry_standby_now_label(); },
    keywords: ['ruhezustand', 'idle', 'bildschirmschoner', 'screensaver', 'schlafen', 'aus'] },
  { id: 'ambient-deep-night', section: 'ambient', get label() { return m.settings_entry_ambient_deep_night_label(); },
    keywords: ['nacht', 'nachts', 'uhr', 'rot', 'dunkel', 'standby', 'lockscreen', '22', '06', 'iphone'] },

  /* ── Inhalte ── */
  { id: 'calendar-selection', section: 'calendar', get label() { return m.settings_entry_calendar_selection_label(); },
    keywords: ['auswahl', 'familie', 'termine', 'agenda', 'entität', 'anzeigen', 'ausblenden'] },
  { id: 'reminders-selection', section: 'calendar', get label() { return m.settings_entry_reminders_selection_label(); },
    keywords: ['erinnerungen', 'reminders', 'todo', 'aufgaben', 'listen', 'einkaufsliste', 'post-it', 'apple', 'icloud'] },
  { id: 'shopping-stores', section: 'shopping', get label() { return m.settings_entry_shopping_stores_label(); },
    keywords: ['einkaufsliste', 'laden', 'aldi', 'rewe', 'dm', 'anlegen', 'löschen', 'reihenfolge'] },
  { id: 'shopping-categories', section: 'shopping', get label() { return m.settings_entry_shopping_categories_label(); },
    keywords: ['sortieren', 'warengruppen', 'laufweg', 'frische', 'kühlung', 'drogerie'] },

  /* ── System ── */
  { id: 'service-health', section: 'status', get label() { return m.settings_entry_service_health_label(); },
    keywords: ['zigbee', 'mqtt', 'broker', 'tunnel', 'cloudflared', 'adguard', 'services', 'gesundheit'] },
  { id: 'update-list', section: 'updates', get label() { return m.settings_entry_update_list_label(); },
    keywords: ['aktualisierung', 'version', 'software', 'core', 'os', 'esphome', 'matter'] },
  { id: 'cache-ha', section: 'maintenance', get label() { return m.settings_entry_cache_ha_label(); },
    keywords: ['home assistant', 'zustand', 'states', 'zwischenspeicher', 'cache'] },
  { id: 'cache-calendar', section: 'maintenance', get label() { return m.settings_entry_cache_calendar_label(); },
    keywords: ['termine', 'familie', 'events', 'zwischenspeicher', 'cache'] },
  { id: 'cache-icons', section: 'maintenance', get label() { return m.settings_entry_cache_icons_label(); },
    keywords: ['zuletzt verwendet', 'symbole', 'picker', 'zwischenspeicher', 'cache'] },
  { id: 'reset-devices', section: 'maintenance', get label() { return m.settings_entry_reset_devices_label(); },
    keywords: ['umbenennen', 'symbole', 'lampen', 'lichter', 'reset', 'standard'] },
  { id: 'reset-scenes', section: 'maintenance', get label() { return m.settings_entry_reset_scenes_label(); },
    keywords: ['scenes', 'presets', 'reset', 'standard'] },
  { id: 'reload-app', section: 'maintenance', get label() { return m.settings_entry_reload_app_label(); },
    keywords: ['neustart', 'refresh', 'reload', 'browser', 'kiosk'] },
];

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
   Gruppe ihre Sektionen in der Reihenfolge von SETTINGS_SECTIONS. Gruppen ohne
   Sektionen fallen heraus, damit die Sidebar nie eine leere Überschrift zeigt. */
export function settingsSidebar(): readonly { group: SettingsGroup; sections: readonly SettingsSection[] }[] {
  return SETTINGS_GROUPS
    .map((group) => ({ group, sections: SETTINGS_SECTIONS.filter((s) => s.group === group.id) }))
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
