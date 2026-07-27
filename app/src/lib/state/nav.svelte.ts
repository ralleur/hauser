/* ── Navigation mit Transition (transform/opacity only, docs/01) ──
   Portiert aus prototype showScreen(): Tab-Crossfade über die Klassen
   is-active/is-entering/is-leaving + anim-fade-in/-out. Das Screen-Set
   bleibt statisch gemountet (wie im Clickdummy: alle <section> im DOM);
   App.svelte setzt die Klassen und beendet die Transition. */

import { m } from '../../paraglide/messages.js';

export type ScreenId = 'home' | 'energy' | 'calendar' | 'notes' | 'shopping' | 'reminders' | 'media' | 'songs' | 'library' | 'library-detail' | 'ablage' | 'system';

/* `phoneOnly`: Ziele, die nur die Phone-Shell rendert (Notizen ist dort in
   Einkaufsliste und Erinnerungen aufgeteilt) — das Panel mountet sie nicht. */
export const SCREENS: { id: ScreenId; tab: string; phoneOnly?: boolean }[] = [
  { id: 'home', tab: 'home' },
  { id: 'energy', tab: 'energy' },
  { id: 'calendar', tab: 'calendar' },
  { id: 'notes', tab: 'notes' },
  { id: 'shopping', tab: 'notes', phoneOnly: true },
  { id: 'reminders', tab: 'notes', phoneOnly: true },
  { id: 'media', tab: 'media' },
  { id: 'songs', tab: 'songs' },
  { id: 'library', tab: 'library' },
  { id: 'library-detail', tab: 'library' },
  { id: 'ablage', tab: 'ablage' },
  { id: 'system', tab: 'system' },
];

/* `label` als Getter (ADR-021): Die Beschriftung wird beim Lesen aufgelöst,
   nicht beim Laden des Moduls. Damit bleibt `tab.label` für alle Aufrufer ein
   String, trägt aber die aktuelle Sprache. */
export const TABS = [
  { id: 'home', get label() { return m.nav_home(); }, icon: 'i-home' },
  { id: 'energy', get label() { return m.nav_energy(); }, icon: 'i-bolt' },
  { id: 'calendar', get label() { return m.nav_calendar(); }, icon: 'i-calendar' },
  { id: 'notes', get label() { return m.nav_notes(); }, icon: 'i-note-text-outline' },
  { id: 'media', get label() { return m.nav_media(); }, icon: 'i-media' },
  { id: 'songs', get label() { return m.nav_songs(); }, icon: 'i-music-note-plus' },
  { id: 'library', get label() { return m.nav_library(); }, icon: 'i-library' },
  { id: 'ablage', get label() { return m.nav_files(); }, icon: 'i-archive-outline' },
  { id: 'system', get label() { return m.nav_system(); }, icon: 'i-system' },
];

export const nav = $state({
  screen: 'home' as ScreenId,
  entering: null as ScreenId | null, // Screen mit anim-fade-in
  leaving: null as ScreenId | null,  // Screen mit anim-fade-out (bleibt is-active)
});

export type PhoneTarget =
  | { area: 'home' | 'calendar' }
  | { area: 'media'; subtarget: 'audio' | 'library' }
  | { area: 'more'; subtarget: 'energy' | 'shopping' | 'reminders' | 'songs' | 'ablage' | 'system' };

export function normalizeScreen(value: unknown): ScreenId {
  return SCREENS.some(({ id }) => id === value) ? value as ScreenId : 'home';
}

/** Pure presentation projection. It never mutates the canonical panel target. */
export function projectPhoneTarget(value: unknown): PhoneTarget {
  const screen = normalizeScreen(value);
  if (screen === 'calendar') return { area: 'calendar' };
  if (screen === 'media') return { area: 'media', subtarget: 'audio' };
  if (screen === 'library' || screen === 'library-detail') return { area: 'media', subtarget: 'library' };
  if (screen === 'energy' || screen === 'system' || screen === 'shopping' || screen === 'reminders' || screen === 'songs' || screen === 'ablage') {
    return { area: 'more', subtarget: screen };
  }
  // Die Tablet-Notizen-Seite existiert auf dem Phone als zwei Einzelseiten;
  // ein geteilter 'notes'-Zustand landet auf der Einkaufsliste.
  if (screen === 'notes') return { area: 'more', subtarget: 'shopping' };
  return { area: 'home' };
}

/* Aktiver Tab folgt dem Screen (library-detail markiert weiterhin "library") */
export function activeTab(): string {
  return SCREENS.find((s) => s.id === nav.screen)!.tab;
}

export function showScreen(next: ScreenId) {
  if (nav.leaving !== null || next === nav.screen) return; // navigating-Guard
  nav.leaving = nav.screen;
  nav.entering = next;
  nav.screen = next;
}

/* animationend + Fallback (deckt prefers-reduced-motion: 0ms ab) — App.svelte */
export function endTransition() {
  nav.leaving = null;
  nav.entering = null;
}
