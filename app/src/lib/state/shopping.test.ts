import { afterEach, describe, expect, it, vi } from 'vitest';
import { DONE_RETENTION_MS, projectPhoneShoppingSections, projectShoppingSections, totalOpenItems, type ShoppingSection } from './shopping.ts';
import { reminderPerson, reminderDisplayTitle } from './reminders.ts';
import { SHOPPING_CONFIG_KEY } from './shopping-config.ts';
import { rehydrateShoppingConfig, shoppingConfig } from './shopping-settings.svelte.ts';

afterEach(() => vi.unstubAllGlobals());

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const sections: ShoppingSection[] = [
  { id: 'rewe', title: 'Rewe', items: [
    { id: 'r1', title: 'Cornichons', checked: false },
    { id: 'r2', title: 'Milch', checked: true },
    { id: 'r3', title: '   ', checked: false },
  ] },
  { id: 'aldi', title: 'Aldi', items: [] },
  { id: 'dm', title: 'Dm', items: [{ id: 'd1', title: 'Bodylotion', checked: false }] },
];

describe('projectShoppingSections', () => {
  it('rehydriert die vor Bootstrap erzeugte Shopping-Konfiguration aus dem neuen Storage-Stand', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(SHOPPING_CONFIG_KEY, JSON.stringify({
      version: 1,
      stores: [{ id: 'altmarkt', label: 'Altmarkt', categories: [] }],
    }));
    rehydrateShoppingConfig();
    expect(shoppingConfig.stores.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'altmarkt', label: 'Altmarkt' },
    ]);

    storage.setItem(SHOPPING_CONFIG_KEY, JSON.stringify({
      version: 1,
      stores: [{ id: 'zentralmarkt', label: 'Zentralmarkt', categories: ['frische'] }],
    }));
    rehydrateShoppingConfig();

    expect(shoppingConfig.stores.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'zentralmarkt', label: 'Zentralmarkt' },
    ]);
  });

  it('filtert abgehakte und leere Items, sortiert in Laden-Reihenfolge', () => {
    const projected = projectShoppingSections(sections);
    expect(projected.map((s) => s.id)).toEqual(['rewe', 'dm']); // Aldi leer → weg
    expect(projected[0].items.map((i) => i.title)).toEqual(['Cornichons']);
  });

  it('behält leere Läden mit keepEmpty (Notizen-Seite) und kanonischem Label', () => {
    const projected = projectShoppingSections(sections, { keepEmpty: true });
    expect(projected.map((s) => s.id)).toEqual(['aldi', 'rewe', 'dm']);
    expect(projected[2].title).toBe('dm');
  });

  it('ordnet abgehakte Items in der bearbeitbaren Liste ans Ende', () => {
    const projected = projectShoppingSections(sections, { keepEmpty: true, includeChecked: true });
    expect(projected[1].items.map((item) => [item.title, item.checked])).toEqual([
      ['Cornichons', false], ['Milch', true],
    ]);
  });

  it('zeigt abgehakte Items einen Tag und entfernt sie danach aus der Projektion', () => {
    const now = Date.parse('2026-07-20T12:00:00Z');
    const withChecked: ShoppingSection[] = [{
      id: 'rewe', title: 'Rewe', items: [
        { id: 'fresh', title: 'Frisch erledigt', checked: true, checkedAt: new Date(now - DONE_RETENTION_MS + 1).toISOString() },
        { id: 'old', title: 'Alt erledigt', checked: true, checkedAt: new Date(now - DONE_RETENTION_MS).toISOString() },
      ],
    }];
    const projected = projectPhoneShoppingSections(withChecked, [], now);
    expect(projected.find((section) => section.id === 'rewe')?.done.map((item) => item.id)).toEqual(['fresh']);
  });

  it('zählt offene Items über alle Läden', () => {
    expect(totalOpenItems(sections)).toBe(2);
  });
});

describe('reminderPerson / reminderDisplayTitle', () => {
  it('liest das Personen-Präfix (case-insensitiv, -/–/:)', () => {
    expect(reminderPerson('Sam - Frisörtermin machen')).toBe('sam');
    expect(reminderPerson('alex: Steuer ergänzen')).toBe('alex');
    expect(reminderPerson('Beide – Keller aufräumen')).toBe('beide');
  });

  it('ohne Präfix gilt die Aufgabe als gemeinsam', () => {
    expect(reminderPerson('Veröffentliche Versionshinweis')).toBe('beide');
  });

  it('entfernt das Präfix für die Anzeige, lässt andere Titel unangetastet', () => {
    expect(reminderDisplayTitle('Sam - Frisörtermin machen')).toBe('Frisörtermin machen');
    expect(reminderDisplayTitle('Impfung auffrischen')).toBe('Impfung auffrischen');
  });
});
