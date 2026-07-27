import { registerSW } from 'virtual:pwa-register';
import { createPwaUpdateCoordinator } from './pwa-update.ts';

let started = false;

export function startPwaLifecycle(): void {
  if (started || typeof document === 'undefined' || !('serviceWorker' in navigator)) return;
  started = true;

  let ambientActive = false;
  let startupSafe = true;
  const safeToActivate = () => startupSafe || ambientActive || document.visibilityState === 'hidden';
  let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => undefined;
  const coordinator = createPwaUpdateCoordinator(
    () => updateServiceWorker(true),
    safeToActivate(),
  );

  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => coordinator.requestActivation(),
    onOfflineReady: () => {
      document.documentElement.dataset.offlineReady = 'true';
    },
    onRegisterError: () => {
      document.documentElement.dataset.offlineReady = 'false';
    },
  });

  // Eine installierte iOS-PWA startet zunächst aus dem alten Precache. Während
  // eines kurzen, begrenzten Kaltstartfensters darf ein bereits wartendes Update
  // übernehmen, auch wenn der erste Tap vor Safaris Updateprüfung erfolgt.
  // Danach gilt wieder das Ambient-/Hidden-Gate gegen Reloads während der Nutzung.
  const startupSafetyTimer = window.setTimeout(() => {
    startupSafe = false;
    coordinator.setSafeToActivate(safeToActivate());
  }, 15_000);
  window.addEventListener('pagehide', () => window.clearTimeout(startupSafetyTimer), { once: true });

  document.addEventListener('hmi:ambient-change', (event) => {
    ambientActive = (event as CustomEvent<{ active?: boolean }>).detail?.active === true;
    coordinator.setSafeToActivate(safeToActivate());
  });
  document.addEventListener('visibilitychange', () => {
    coordinator.setSafeToActivate(safeToActivate());
  });
}