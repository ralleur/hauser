import { describe, expect, it } from 'vitest';
import { AI_CUSTOMIZING_ENABLED } from '../config/product-capabilities.ts';
import { isKnownIcon } from './icon-catalog.ts';
import {
  SETTINGS_ENTRIES,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  searchSettings,
  settingsEntry,
  settingsGroup,
  settingsSection,
  settingsSidebar,
} from './settings-registry.ts';

describe('settings registry', () => {
  it('jeder Eintrag verweist auf eine existierende Sektion', () => {
    const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    for (const entry of SETTINGS_ENTRIES) expect(ids.has(entry.section)).toBe(true);
  });

  it('jede Sektion verweist auf eine existierende Gruppe', () => {
    const ids = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const section of SETTINGS_SECTIONS) expect(ids.has(section.group)).toBe(true);
  });

  it('jede Sektion verwendet ein vorhandenes lokales MDI-Icon', () => {
    for (const section of SETTINGS_SECTIONS) expect(isKnownIcon(section.icon)).toBe(true);
  });

  it('Eintrags-Ids sind eindeutig (Sprungziel der Suche)', () => {
    const ids = SETTINGS_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('settingsSection/settingsGroup/settingsEntry lösen Ids auf', () => {
    expect(settingsSection('ambient').label).toBe('Ambient & Standby');
    expect(settingsGroup('connectivity').label).toBe('Verbindungen');
    expect(settingsEntry('theme-mode')?.section).toBe('appearance');
    expect(settingsEntry('gibt-es-nicht')).toBeUndefined();
  });

  it('jede Sektion ist genau einer Gruppe zugeordnet und keine Gruppe bleibt leer', () => {
    const sidebar = settingsSidebar();
    expect(sidebar.map((s) => s.group.id)).toEqual(SETTINGS_GROUPS.map((g) => g.id));
    /* Nicht gegen SETTINGS_SECTIONS.length prüfen: im öffentlichen Produkt
       fallen Sektionen weg, deren Einträge alle hinter einem Feature-Flag
       liegen (ai-customizing). Erwartet wird genau die Menge mit Einträgen. */
    const withEntries = SETTINGS_SECTIONS.filter((s) => SETTINGS_ENTRIES.some((e) => e.section === s.id));
    expect(sidebar.flatMap((s) => s.sections).length).toBe(withEntries.length);
    for (const { sections } of sidebar) expect(sections.length).toBeGreaterThan(0);
  });

  it('blendet leere Sektionen aus der Sidebar aus (Feature-Flag-Fall)', () => {
    const sidebarSectionIds = new Set(settingsSidebar().flatMap((s) => s.sections.map((sec) => sec.id)));
    for (const section of SETTINGS_SECTIONS) {
      const hasEntries = SETTINGS_ENTRIES.some((e) => e.section === section.id);
      expect(sidebarSectionIds.has(section.id)).toBe(hasEntries);
    }
  });
});

/* Die Umstrukturierung hat einen fachlichen Kern: Einsortiert wird nach dem
   Objekt, das die Einstellung betrifft — niemals nach der Technik dahinter.
   Diese Zuordnung ist der Zweck der Registry und wird deshalb festgehalten. */
describe('fachliche Gliederung', () => {
  it('bündelt alle Integrationen inklusive KI-Zugang unter Verbindungen · Dienste', () => {
    for (const id of ['connection-status', 'ha-url', 'ha-token', 'jf-url', 'jf-session', 'jf-device', 'icloud-setup', 'ablage-status', 'ai-models']) {
      expect(settingsEntry(id)?.section).toBe('services');
    }
    /* Flag-abhängige Integrationen: wenn vorhanden, dann hier — im
       öffentlichen Produkt entfallen sie ganz. */
    for (const id of ['songs-status', 'ai-access-status']) {
      const entry = settingsEntry(id);
      if (entry) expect(entry.section).toBe('services');
    }
    expect(settingsSection('services').group).toBe('connectivity');
  });

  it('führt KI-Customizing-Einträge nur im privaten Produkt', () => {
    for (const id of ['ai-access-status', 'ai-debug', 'ai-chat', 'ai-history']) {
      expect(settingsEntry(id) !== undefined).toBe(AI_CUSTOMIZING_ENABLED);
    }
  });

  it('hält alle Standby-Einstellungen zusammen unter Ambient & Standby', () => {
    for (const id of ['standby-now', 'ambient-deep-night', 'ambient-hero-text', 'ambient-city-map']) {
      expect(settingsEntry(id)?.section).toBe('ambient');
    }
    expect(settingsSection('ambient').group).toBe('appearance');
  });

  it('führt Geräte-Resets mit der Geräteverwaltung zusammen', () => {
    for (const id of ['household-setup', 'reset-devices', 'reset-scenes']) {
      expect(settingsEntry(id)?.section).toBe('rooms-devices');
    }
    expect(settingsSection('rooms-devices').group).toBe('home');
  });

  it('hat keine Gruppen-Id ai mehr', () => {
    expect(SETTINGS_GROUPS.map((g) => g.id)).not.toContain('ai');
    expect(SETTINGS_SECTIONS.map((s) => s.id)).not.toContain('ai-access');
    expect(SETTINGS_SECTIONS.map((s) => s.id)).not.toContain('ai-features');
  });

  it('hält Wäsche unter Zuhause statt unter System', () => {
    expect(settingsEntry('laundry')?.section).toBe('laundry');
    expect(settingsSection('laundry').group).toBe('home');
    expect(searchSettings('wäsche')[0]?.entry.id).toBe('laundry');
  });

  it('trennt Inhaltsauswahl von der Kontoeinrichtung', () => {
    /* Welche Kalender angezeigt werden, ist Inhalt … */
    expect(settingsSection(settingsEntry('calendar-selection')!.section).group).toBe('content');
    /* … das iCloud-Konto anzulegen bleibt eine Integrationsaufgabe. */
    expect(settingsSection(settingsEntry('icloud-setup')!.section).group).toBe('connectivity');
  });
});

describe('searchSettings', () => {
  it('leere/blanke Anfrage liefert nichts', () => {
    expect(searchSettings('')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });

  it('findet über Label, case-insensitiv', () => {
    const matches = searchSettings('DEMO');
    expect(matches.map((m) => m.entry.id)).toContain('demo-mode');
  });

  it('findet über Keywords (Synonyme)', () => {
    expect(searchSettings('dunkel').map((m) => m.entry.id)).toContain('theme-mode');
    expect(searchSettings('bildschirmschoner').map((m) => m.entry.id)).toContain('standby-now');
  });

  it('findet die neu sichtbaren Dienste', () => {
    expect(searchSettings('paperless').map((m) => m.entry.id)).toContain('ablage-status');
    expect(searchSettings('ace-step').map((m) => m.entry.id)).toContain('songs-status');
  });

  it('mehrere Wörter sind UND-verknüpft', () => {
    const matches = searchSettings('cache kalender');
    expect(matches.map((m) => m.entry.id)).toEqual(['cache-calendar']);
  });

  it('Label-Treffer ranken vor reinen Keyword-Treffern', () => {
    const matches = searchSettings('update');
    expect(matches[0].entry.id).toBe('update-list');
  });

  it('liefert die Sektion zum Eintrag mit (Brotkrume der Trefferliste)', () => {
    const [first] = searchSettings('tageskommentar');
    expect(first.entry.id).toBe('ambient-hero-text');
    expect(first.section.id).toBe('ambient');
  });

  /* docs/18 §7.2: der Stadtplan wird unter deutschen Alltagsbegriffen gesucht,
     nicht unter „Overpass" oder „Renderer". */
  it('findet den Stadtplan-Hintergrund über seine Alltagsbegriffe', () => {
    for (const query of ['stadtplan', 'karte', 'standort', 'openstreetmap', 'hintergrund standby']) {
      expect(searchSettings(query).map((match) => match.entry.id)).toContain('ambient-city-map');
    }
    expect(searchSettings('stadtplan')[0]?.section.id).toBe('ambient');
  });

  /* Ein Modellname führt zuerst zur Dienstkarte, wo das Modell steht. */
  it('führt bei einem Modellnamen zuerst zur Dienstkarte', () => {
    const [first] = searchSettings('luna');
    expect(first.section.id).toBe('services');
  });
});
