import { registerSW } from 'virtual:pwa-register';
import { createPwaUpdateCoordinator } from './pwa-update.ts';
import { offerPwaUpdate } from './pwa-update-prompt.svelte.ts';

let started = false;

export function startPwaLifecycle(): void {
  if (started || typeof document === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;

  let ambientActive = false;
  /* B-27 C: Das frühere `startupSafe`-Fenster hielt 15 s nach dem Start jede
     Aktivierung für unbedenklich und lud die Seite deshalb mitten in der
     sichtbaren Nutzung neu — genau der Reload, den der Plan beseitigt. Es
     bleibt allein das Ambient-/Hidden-Gate: der Kiosk aktualisiert unverändert
     von selbst, die sichtbare App fragt. */
  const safeToActivate = () => ambientActive || document.visibilityState === 'hidden';
  let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => undefined;
  const coordinator = createPwaUpdateCoordinator(
    () => updateServiceWorker(true),
    safeToActivate(),
  );

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      coordinator.requestActivation();
      /* Konnte der Coordinator sofort aktivieren, ist hier nichts mehr offen.
         Bleibt das Update wartend, entscheidet der Benutzer per Tap. */
      if (coordinator.pending) offerPwaUpdate(() => { void updateServiceWorker(true); });
    },
    onOfflineReady: () => {
      document.documentElement.dataset.offlineReady = 'true';
    },
    onRegisterError: () => {
      document.documentElement.dataset.offlineReady = 'false';
    },
  });

  document.addEventListener('hmi:ambient-change', (event) => {
    ambientActive = (event as CustomEvent<{ active?: boolean }>).detail?.active === true;
    coordinator.setSafeToActivate(safeToActivate());
  });
  document.addEventListener('visibilitychange', () => {
    coordinator.setSafeToActivate(safeToActivate());
  });
}