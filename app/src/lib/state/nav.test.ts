import { describe, expect, it } from 'vitest';
import { endTransition, nav, normalizeScreen, projectPhoneTarget, type ScreenId } from './nav.svelte.ts';

describe('canonical navigation projection', () => {
  it.each([
    ['home', { area: 'home' }],
    ['calendar', { area: 'calendar' }],
    ['media', { area: 'media', subtarget: 'audio' }],
    ['library', { area: 'media', subtarget: 'library' }],
    ['library-detail', { area: 'media', subtarget: 'library' }],
    ['energy', { area: 'more', subtarget: 'energy' }],
    ['shopping', { area: 'more', subtarget: 'shopping' }],
    ['reminders', { area: 'more', subtarget: 'reminders' }],
    ['ablage', { area: 'more', subtarget: 'ablage' }],
    // Die Tablet-Notizen-Seite landet auf dem Phone auf der Einkaufsliste.
    ['notes', { area: 'more', subtarget: 'shopping' }],
    ['system', { area: 'more', subtarget: 'system' }],
  ] as const)('projects %s without changing the canonical target', (screen, expected) => {
    expect(projectPhoneTarget(screen)).toEqual(expected);
  });

  it('falls unknown targets back to home', () => {
    expect(normalizeScreen('unknown')).toBe('home');
    expect(projectPhoneTarget('unknown')).toEqual({ area: 'home' });
  });

  it('keeps canonical target while a presentation transition is ended', () => {
    nav.screen = 'library-detail';
    nav.entering = 'library-detail';
    nav.leaving = 'library';
    endTransition();
    expect(nav.screen).toBe('library-detail');
    expect(nav.entering).toBeNull();
    expect(nav.leaving).toBeNull();
    nav.screen = 'home' as ScreenId;
  });
});
