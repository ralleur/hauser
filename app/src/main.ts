import { mount, unmount } from 'svelte';
// design-tokens/ bleibt Single Source of Truth — importiert, nicht kopiert (ADR-003/013)
import '../../design-tokens/tokens.css';
import './styles/climate-controls.css';
import { applyDemoDeepLink, installDemoApi } from './lib/demo/demo-mode.ts';

const STARTUP_LABELS: Record<string, string> = {
  'hmi:app-start': 'App-Start',
  'hmi:svelte-mount': 'Svelte-Mount',
  'hmi:first-render': 'Erste Darstellung',
  'hmi:interactive': 'Erste Interaktion möglich',
};

function markStartup(name: string): void {
  if (!import.meta.env.DEV) return;
  if (performance.getEntriesByName(name, 'mark').length === 0) performance.mark(name);
  const mark = performance.getEntriesByName(name, 'mark').at(-1);
  const start = performance.getEntriesByName('hmi:app-start', 'mark').at(-1)?.startTime ?? 0;
  if (!mark) return;
  console.debug(`[startup] ${STARTUP_LABELS[name]}: ${(mark.startTime - start).toFixed(1)} ms`);
  if (name !== 'hmi:app-start') {
    performance.measure(`hmi:app-start->${name}`, 'hmi:app-start', name);
  }
}

markStartup('hmi:app-start');

// Diese Literale müssen im initialen Modulgraphen liegen: Der Build-Gate misst
// Phone- und Panel-Shell als direkte, getrennte dynamische Ziele (ADR-020/B-25).
const shellLoaders = {
  phone: () => import('./lib/shells/PhoneAppShell.svelte'),
  panel: () => import('./lib/shells/PanelAppShell.svelte'),
};
type ShellModule = Awaited<ReturnType<(typeof shellLoaders)[keyof typeof shellLoaders]>>;

// Vor den Bootstrap-Fetches: die Demo stellt ihre isolierten API-Antworten bereit.
installDemoApi();

async function healthStatus(): Promise<'ready' | 'setup_required' | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { status?: unknown };
    return payload.status === 'ready' || payload.status === 'setup_required'
      ? payload.status
      : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function afterFirstPaint(task: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(task, 0)));
}

async function mountSetup(mode: 'first-run' | 'reconfigure'): Promise<unknown> {
  const { default: SetupWizard } = await import('./lib/components/SetupWizard.svelte');
  const app = mount(SetupWizard, { target: document.body, props: { mode } });
  markStartup('hmi:svelte-mount');
  if (import.meta.env.DEV) {
    requestAnimationFrame(() => {
      markStartup('hmi:first-render');
      markStartup('hmi:interactive');
    });
  }
  return app;
}

let mountedApp: Record<string, any> | null = null;
const reconfigureRequested = new URL(location.href).searchParams.get('setup') === 'reconfigure';

if (reconfigureRequested) {
  mountedApp = await mountSetup('reconfigure') as Record<string, any>;
} else {
  const householdRuntime = await import('./lib/config/household-config-runtime.ts');

  let initialShell!: ShellModule;
  const startLocalShell = async () => {
    const { mountMinimalShell } = await import('./lib/shells/minimal-shell-loader.ts');
    const app = await mountMinimalShell(document.body);
    markStartup('hmi:svelte-mount');
    if (import.meta.env.DEV) {
      requestAnimationFrame(() => {
        markStartup('hmi:first-render');
        if (document.querySelector('[data-shell="minimal"] button:not([disabled])')) {
          markStartup('hmi:interactive');
        }
      });
    }
    return app;
  };

  const startHotelNeutralShell = async () => {
    const { default: HotelNeutralScreen } = await import('./lib/components/HotelNeutralScreen.svelte');
    if (mountedApp) await unmount(mountedApp);
    return mountedApp = mount(HotelNeutralScreen, { target: document.body });
  };

  const startAuthorizedApp = async () => {
    // Hotel Mode entscheidet vor den produktiven Modulen, welche Oberfläche
    // überhaupt entsteht: außerhalb eines Aufenthalts wird gar keine Steuerung
    // geladen, während eines Aufenthalts stehen Gastmodell und Hotel-Runtime
    // danach bereits. Ohne Hotel Mode ist das ein reiner Statusabruf.
    const { applyHotelBootstrap, mountHotelAdminLayer, mountHotelGuestLayer } =
      await import('./lib/hotel-mode-bootstrap.ts');
    const hotel = await applyHotelBootstrap();
    if (hotel.surface === 'inactive') {
      const neutral = await startHotelNeutralShell();
      await mountHotelAdminLayer(hotel.surface);
      return neutral;
    }

    // Erst die validierte Projektion darf produktive State-/Shell-Module laden.
    // App.svelte initialisiert Theme und DeviceManager genau einmal und startet
    // den Backendpfad weiterhin erst post-paint in onMount.
    const [
      appModule,
      { standalone },
      uiModeModule,
      { nav },
      { appState },
    ] = await Promise.all([
      import('./App.svelte'),
      import('./lib/state/standalone.svelte.ts'),
      import('./lib/state/ui-mode.svelte.ts'),
      import('./lib/state/nav.svelte.ts'),
      import('./lib/state/app.svelte.ts'),
    ]);
    uiModeModule.initUiMode();
    initialShell = await shellLoaders[uiModeModule.uiMode.effective]();
    document.documentElement.setAttribute('data-standalone', String(standalone.active));
    applyDemoDeepLink((screen) => { nav.screen = screen as typeof nav.screen; });
    if (import.meta.env.VITE_DEMO === '1') {
      const { applyDemoNames } = await import('./lib/demo/demo-names.ts');
      applyDemoNames(appState.rooms);
    }

    if (mountedApp) await unmount(mountedApp);
    mountedApp = mount(appModule.default, {
      target: document.body,
      props: { shellLoaders, initialShell },
    });
    await mountHotelGuestLayer(hotel);
    await mountHotelAdminLayer(hotel.surface);
    return mountedApp;
  };

  const firstPaint = await householdRuntime.bootstrapHouseholdConfigFirstPaint({
    startLocalShell,
    startAuthorizedApp,
    healthStatus,
    scheduleValidation: afterFirstPaint,
  });
  mountedApp = firstPaint.app;

  afterFirstPaint(() => {
    void import('./lib/state/pwa-lifecycle.ts')
      .then(({ startPwaLifecycle }) => startPwaLifecycle());
  });

  void firstPaint.validation.then(async (result) => {
    if (result.status === 'setup_required') {
      if (mountedApp) await unmount(mountedApp);
      mountedApp = await mountSetup('first-run') as Record<string, any>;
    } else if (result.status === 'reload_required') {
      // Modul-Singletons wurden bereits für den First Paint erzeugt. Ein Reload
      // ist der kleinste sichere Cutover auf den ersetzten/gelöschten Snapshot.
      location.reload();
    } else if (result.status === 'blocked') {
      (await import('./lib/shells/minimal-shell-cache.ts')).publishMinimalShellConfigStatus(result.code);
    }
  });
}

export default mountedApp;
