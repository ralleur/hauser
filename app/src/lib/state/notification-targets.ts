/* Wohin eine Meldung führt, wenn man sie antippt.

   Getrennt vom Benachrichtigungszentrum, weil dieses nur Daten hält und
   nichts über Screens weiß. Hier steht die eine Stelle, an der aus einem
   Schlüssel eine Bewegung durch die Oberfläche wird. */

import { showScreen } from './nav.svelte.ts';
import { settingsUi } from './settings.svelte.ts';
import type { HmiNotification } from './notifications.ts';

export function followNotification(item: Pick<HmiNotification, 'action'>): void {
  if (item.action !== 'room-image-wizard') return;
  /* Der Assistent wohnt in „Räume & Geräte". Der Wunsch bleibt liegen, bis
     die Seite da ist und ihn aufnimmt. */
  settingsUi.section = 'rooms-devices';
  settingsUi.pendingRoomImageWizard = true;
  showScreen('system');
}
