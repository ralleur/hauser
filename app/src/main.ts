import { mount } from 'svelte';
// design-tokens/ bleibt Single Source of Truth — importiert, nicht kopiert (ADR-003/013)
import '../../design-tokens/tokens.css';
import './styles/climate-controls.css';
import { applyDemoDeepLink, applyDemoNames, installDemoApi } from './lib/demo/demo-mode.ts';
import { bootstrapHouseholdConfigRuntime } from './lib/config/household-config-runtime.ts';

// Diese Literale müssen im initialen Modulgraphen liegen: Der Build-Gate misst
// Phone- und Panel-Shell als direkte, getrennte dynamische Ziele (ADR-020/B-25).
const shellLoaders = {
  phone: () => import('./lib/shells/PhoneAppShell.svelte'),
  panel: () => import('./lib/shells/PanelAppShell.svelte'),
};

// Vor den Bootstrap-Fetches: die Demo stellt ihre isolierten API-Antworten bereit.
installDemoApi();

function renderHouseholdConfigError(code: string): void {
  const main = document.createElement('main');
  main.setAttribute('role', 'alert');
  main.setAttribute('aria-live', 'assertive');
  const heading = document.createElement('h1');
  heading.textContent = 'Konfiguration nicht verfügbar';
  const message = document.createElement('p');
  message.textContent = 'Die Smart-Home-Oberfläche wurde aus Sicherheitsgründen nicht gestartet.';
  const reference = document.createElement('p');
  reference.textContent = `Fehlercode: ${code}`;
  main.append(heading, message, reference);
  document.body.replaceChildren(main);
}

const householdConfigRuntime = await bootstrapHouseholdConfigRuntime({
  startProductiveApp: async () => {
    // Zentrale Browser-Konfiguration ebenfalls vor State-/Runtime-Singletons laden.
    const { bootstrapSharedConfig } = await import('./lib/state/shared-config.ts');
    await bootstrapSharedConfig();
    const [{ standalone }, { default: App }] = await Promise.all([
      import('./lib/state/standalone.svelte.ts'),
      import('./App.svelte'),
    ]);

    document.documentElement.setAttribute('data-standalone', String(standalone.active));

    /* Demo-Deep-Link (#library, #energy …) vor dem Mount: der Startscreen soll
       ohne Übergang direkt stehen, damit die Landing Page gezielt verlinken kann. */
    const [{ nav }, { appState }] = await Promise.all([
      import('./lib/state/nav.svelte.ts'),
      import('./lib/state/app.svelte.ts'),
    ]);
    applyDemoDeepLink((screen) => { nav.screen = screen as typeof nav.screen; });

    const app = mount(App, { target: document.body, props: { shellLoaders } });

    // Registrierung erst nach dem ersten Render. Ein wartendes Update wird nur im
    // Ambient-Zustand oder bei verdeckter App aktiviert (ADR-016/B-15C1).
    void import('./lib/state/pwa-lifecycle.ts').then(({ startPwaLifecycle }) => startPwaLifecycle());

    /* Nach dem Mount: initDeviceManager() baut die Räume beim Start aus Seed und
       gespeicherter Konfiguration neu auf und würde frühere Namen überschreiben. */
    applyDemoNames(appState.rooms);
    return app;
  },
});

if (householdConfigRuntime.status === 'error') {
  renderHouseholdConfigError(householdConfigRuntime.code);
}

export default householdConfigRuntime.status === 'error'
  ? null
  : householdConfigRuntime.app;
