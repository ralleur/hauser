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
    expect(sidebar.flatMap((s) => s.sections).length).toBe(SETTINGS_SECTIONS.length);
    for (const { sections } of sidebar) expect(sections.length).toBeGreaterThan(0);
  });
});

/* Die Umstrukturierung hat einen fachlichen Kern: Integrationen an einer
   Stelle, alles mit KI-Zugang an einer zweiten. Diese Zuordnung ist der Zweck
   der Registry und wird deshalb festgehalten. */
describe('fachliche Gliederung', () => {
  it('bündelt alle Integrationen unter Verbindungen · Dienste', () => {
    for (const id of ['ha-url', 'ha-token', 'jf-url', 'jf-session', 'icloud-setup', 'ablage-status', 'songs-status']) {
      expect(settingsEntry(id)?.section).toBe('services');
    }
    expect(settingsSection('services').group).toBe('connectivity');
  });

  it('führt öffentliche KI-Funktionen unter KI-Funktionen und Customizing nur im privaten Produkt', () => {
    for (const id of ['ambient-hero-text', 'ai-song-lyrics']) {
      expect(settingsEntry(id)?.section).toBe('ai-features');
    }
    for (const id of ['ai-access-status', 'ai-debug', 'ai-chat', 'ai-history']) {
      expect(settingsEntry(id) !== undefined).toBe(AI_CUSTOMIZING_ENABLED);
      if (id === 'ai-chat' || id === 'ai-history') {
        expect(settingsEntry(id)?.section === 'ai-features').toBe(AI_CUSTOMIZING_ENABLED);
      }
    }
    expect(settingsSection('ai-features').group).toBe('ai');
    /* Der Zugang steht vor den Funktionen, die ihn voraussetzen. */
    const aiSections = SETTINGS_SECTIONS.filter((s) => s.group === 'ai').map((s) => s.id);
    expect(aiSections).toEqual(['ai-access', 'ai-features']);
  });

  it('hält Live/Demo an einer einzigen Stelle zusammen', () => {
    expect(settingsEntry('demo-mode')?.section).toBe('operating-mode');
    expect(settingsEntry('library-mode')?.section).toBe('operating-mode');
  });

  it('führt die Haushaltsstruktur sichtbar unter Zuhause statt unter Dienste', () => {
    expect(settingsEntry('household-setup')?.section).toBe('rooms-devices');
    expect(settingsSection('rooms-devices').group).toBe('home');
    expect(searchSettings('räume verwalten')[0]?.entry.id).toBe('household-setup');
  });

  it('führt Wäsche direkt unter System · Benachrichtigungen', () => {
    expect(settingsEntry('laundry')?.section).toBe('notifications');
    expect(settingsSection('notifications').group).toBe('system');
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
    expect(first.section.id).toBe('ai-features');
  });

  /* Ein Modellname führt zuerst zur Modell-Übersicht, nicht zu einer einzelnen
     Funktion — dort steht, was das Modell überhaupt kostet und aufruft. */
  it('führt bei einem Modellnamen zuerst zum Zugang', () => {
    const [first] = searchSettings('luna');
    expect(first.section.id).toBe('ai-access');
  });
});
