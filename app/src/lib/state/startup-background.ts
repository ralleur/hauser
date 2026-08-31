import { installHaRetryFactory } from '../adapter/ha-backend.ts';
import { runtime } from '../adapter/runtime.svelte.ts';
import { reapplyDemoNames } from '../demo/demo-mode.ts';
import { appState, ROOM_SEED } from './app.svelte.ts';
import { syncAuthState } from './auth.svelte.ts';
import { initFamilyCalendar } from './calendar.svelte.ts';
import { buildRuntimeRooms, loadDeviceConfig } from './device-config.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { rehydrateLayoutManager } from './layout-manager.svelte.ts';
import { rehydrateImmersionLight } from './immersion-light.svelte.ts';
import { notifications } from './notifications.svelte.ts';
import { rehydrateReminderPersons } from './reminder-persons.svelte.ts';
import { initReminders } from './reminders.svelte.ts';
import { configuredRoomSensorIds } from './room-display-config.svelte.ts';
import {
  haCredentialsAvailableLocally,
  syncConfiguredBackend,
  syncHaTransport,
} from './runtime-backend-sync.ts';
import { createHaRetryController } from './runtime-background.ts';
import { loadSceneConfig } from './scene-config.ts';
import { sceneManager } from './scene-manager.svelte.ts';
import { settingsUi, settingsValues } from './settings.svelte.ts';
import { sharedStorage, type StorageLike } from './shared-config.ts';
import { initShopping } from './shopping.svelte.ts';
import { rehydrateShoppingConfig } from './shopping-settings.svelte.ts';

type ScheduleTimeout = (callback: () => void, timeoutMs: number) => () => void;

export const SHARED_CONFIG_BOOTSTRAP_TIMEOUT_MS = 1_000;

installHaRetryFactory(createHaRetryController);

function defaultScheduleTimeout(callback: () => void, timeoutMs: number): () => void {
  const handle = setTimeout(callback, timeoutMs);
  return () => clearTimeout(handle);
}

function readShared(key: string): string | null {
  try { return sharedStorage.getItem(key); } catch { return null; }
}

/** Bleibt mit allen Rehydrate-Imports hinter App.sveltes Post-Paint-Boundary. */
export function rehydrateSharedConfigConsumers(): void {
  deviceManager.config = loadDeviceConfig();
  appState.rooms = buildRuntimeRooms(ROOM_SEED, deviceManager.catalog, deviceManager.config);
  reapplyDemoNames(appState.rooms);
  rehydrateLayoutManager();
  rehydrateImmersionLight();
  sceneManager.config = loadSceneConfig();
  rehydrateShoppingConfig();
  rehydrateReminderPersons();
  settingsValues.demoMode = readShared('hmi:backend') === 'fake';
  settingsValues.haUrl = readShared('hmi:ha-url') ?? '';
  settingsValues.jellyfinUrl = readShared('hmi:jf-url') ?? '';
  settingsValues.libraryMode = (readShared('hmi:library') ?? 'auto') as 'auto' | 'live' | 'fake';
  settingsValues.classicLockButton = readShared('hmi:lock-button') !== 'large';
  settingsUi.needsReload = false;
}

/** Garantiert nach dem ersten Paint die Reihenfolge Shared Config →
 * Auth-Sync/Backend-Start. Der Timeout verhindert, dass eine hängende lokale
 * API die HA-Verbindung dauerhaft sperrt. */
export async function bootstrapSharedConfigBeforeRuntime(
  startRuntime: () => void,
  {
    fetcher = fetch,
    storage,
    timeoutMs = SHARED_CONFIG_BOOTSTRAP_TIMEOUT_MS,
    scheduleTimeout = defaultScheduleTimeout,
  }: {
    fetcher?: typeof fetch;
    storage?: StorageLike | null;
    timeoutMs?: number;
    scheduleTimeout?: ScheduleTimeout;
  } = {},
): Promise<void> {
  const { bootstrapSharedConfig } = await import('./shared-config-bootstrap.ts');
  const controller = new AbortController();
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : SHARED_CONFIG_BOOTSTRAP_TIMEOUT_MS;
  let cancelTimeout = () => {};
  const timeout = new Promise<void>((resolve) => {
    cancelTimeout = scheduleTimeout(() => {
      controller.abort();
      resolve();
    }, boundedTimeoutMs);
  });
  try {
    await Promise.race([
      bootstrapSharedConfig(fetcher, storage, controller.signal),
      timeout,
    ]);
  } finally {
    cancelTimeout();
  }
  await rehydrateSharedConfigConsumers();
  startRuntime();
}

export async function startBackgroundRuntime(isCancelled: () => boolean) {
  /* B-08E11: Die Betriebsart des Live-Kanals läuft parallel zur Shared Config
     und muss wie sie vor dem Verbindungsaufbau feststehen. Bewusst neben dem
     Shared-Config-Bootstrap statt in ihm: dessen Vertrag ist genau ein GET. */
  const transportReady = syncHaTransport();
  const sharedConfigReady = bootstrapSharedConfigBeforeRuntime(() => {});

  /* B-27 A2: Stehen die Zugangsdaten schon lokal, hängt der Verbindungsaufbau
     nur noch an der Betriebsart — die Shared Config läuft daneben weiter. Sonst
     bleibt die bisherige Reihenfolge Shared Config → Backend-Start. */
  const startHaEarly = haCredentialsAvailableLocally();
  if (!startHaEarly) await sharedConfigReady;
  await transportReady;
  if (!isCancelled()) {
    syncConfiguredBackend();
    syncAuthState();
    runtime.start();
  }
  if (startHaEarly) await sharedConfigReady;
  if (isCancelled()) return null;

  initFamilyCalendar();
  initReminders();
  initShopping();
  notifications.init();

  const [notificationLayer, playerLayer] = await Promise.all([
    import('../components/NotificationLayer.svelte'),
    import('../components/PlayerLayer.svelte'),
  ]);
  if (isCancelled()) return null;
  return {
    notificationLayer: notificationLayer.default,
    playerLayer: playerLayer.default,
    configuredRoomSensorIds,
  };
}
