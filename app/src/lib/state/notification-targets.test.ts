import { describe, expect, it, beforeEach } from 'vitest';
import { followNotification } from './notification-targets.ts';
import { settingsUi } from './settings.svelte.ts';
import { nav } from './nav.svelte.ts';

/* Paket 13: Eine Meldung, die nirgendwohin führt, ist eine halbe Meldung.
   Geprüft wird der Weg vom Schlüssel zur Bewegung durch die Oberfläche. */

describe('Meldung antippen', () => {
  beforeEach(() => {
    settingsUi.pendingRoomImageWizard = false;
    settingsUi.section = 'appearance';
    nav.screen = 'home';
    nav.entering = null;
    nav.leaving = null;
  });

  it('führt zum Raumbild-Assistenten', () => {
    followNotification({ action: 'room-image-wizard' });
    expect(nav.screen).toBe('system');
    expect(settingsUi.section).toBe('rooms-devices');
    expect(settingsUi.pendingRoomImageWizard).toBe(true);
  });

  it('lässt Meldungen ohne Ziel unberührt', () => {
    followNotification({ action: undefined });
    expect(nav.screen).toBe('home');
    expect(settingsUi.section).toBe('appearance');
    expect(settingsUi.pendingRoomImageWizard).toBe(false);
  });
});
