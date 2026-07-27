import { mount } from 'svelte';
// design-tokens/ bleibt Single Source of Truth — importiert, nicht kopiert (ADR-003/013)
import '../../design-tokens/tokens.css';
import './styles/climate-controls.css';
import { applyDemoDeepLink, applyDemoNames, installDemoApi } from './lib/demo/demo-mode.ts';
import { bootstrapSharedConfig } from './lib/state/shared-config.ts';

// Diese Literale müssen im initialen Modulgraphen liegen: Der Build-Gate misst
// Phone- und Panel-Shell als direkte, getrennte dynamische Ziele (ADR-020/B-25).
const shellLoaders = {
  phone: () => import('./lib/shells/PhoneAppShell.svelte'),
  panel: () => import('./lib/shells/PanelAppShell.svelte'),
};

// Vor bootstrapSharedConfig: der Bootstrap fragt selbst /api/config ab.
installDemoApi();

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

export default app;
