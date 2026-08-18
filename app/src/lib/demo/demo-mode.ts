/* ============================================
   Demo-Modus — statischer Build ohne Companion-Server (docs/12).

   Der Build mit `VITE_DEMO=1` läuft gegen den FakeBackend und wird als
   statische Seite ausgeliefert. Damit fehlen die Endpunkte aus `server.mjs`.
   Statt jedes State-Modul um einen Demo-Zweig zu erweitern, wird `fetch`
   einmalig um die `/api/*`-Pfade herum abgefangen: die Aufrufer bleiben
   unverändert, und der Produktionspfad ist nicht betroffen — bei `VITE_DEMO`
   ungleich `1` wird hier nichts installiert.

   Die Ablage (Paperless) ist bewusst NICHT Teil der Demo: ein
   PIN-geschützter Dokumentenzugriff gehört nicht in eine öffentliche
   Vorführung, auch nicht mit erfundenen Inhalten.
   ============================================ */

import { m } from '../../paraglide/messages.js';
import demoHouseholdConfig from '../../../config/households/current-v1.json';
import { HOUSEHOLD_SCHEMA_VERSION } from '../config/household-config-schema.ts';

export const IS_DEMO = import.meta.env?.VITE_DEMO === '1';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const nowIso = () => new Date().toISOString();

const demoShoppingConfig = {
  version: 1,
  stores: [
    { id: 'walmart', label: 'Walmart', categories: [] },
    { id: 'carrefour', label: 'Carrefour', categories: [] },
    { id: 'tesco', label: 'Tesco', categories: [] },
  ],
};

function publicDemoHouseholdConfig() {
  return {
    ...demoHouseholdConfig,
    navigation: demoHouseholdConfig.navigation.filter((item) => item.target.id !== 'songs'),
    enabledModules: demoHouseholdConfig.enabledModules.filter((id) => id !== 'songs'),
  };
}

function demoReminders() {
  return {
    version: 1,
    updatedAt: nowIso(),
    items: [
      { id: 'demo-1', title: 'Alex - Fahrradlicht reparieren', completed: false, due: null, description: null, priority: null, created: nowIso(), edited: nowIso(), source: 'hmi' },
      { id: 'demo-2', title: 'Sam - Ersatzfilter bestellen', completed: false, due: null, description: null, priority: null, created: nowIso(), edited: nowIso(), source: 'hmi' },
      { id: 'demo-3', title: 'Beide - Termin Autowerkstatt ausmachen', completed: false, due: null, description: null, priority: null, created: nowIso(), edited: nowIso(), source: 'hmi' },
      { id: 'demo-4', title: 'Alex - Pflanzen umtopfen', completed: false, due: null, description: null, priority: null, created: nowIso(), edited: nowIso(), source: 'hmi' },
      { id: 'demo-5', title: 'Sam - Fenstergriff nachziehen', completed: false, due: null, description: null, priority: null, created: nowIso(), edited: nowIso(), source: 'hmi' },
      { id: 'demo-6', title: 'Beide - Keller aufräumen', completed: true, due: null, description: null, priority: null, created: nowIso(), edited: nowIso(), source: 'hmi' },
    ],
  };
}

function demoShopping() {
  return {
    updated_at: nowIso(),
    source_name: 'Demo',
    /* Die Abschnitts-IDs müssen der Demo-Konfiguration aus `/api/config`
       entsprechen — sonst ordnet die UI nichts zu. */
    sections: [
      {
        id: 'walmart',
        title: 'Walmart',
        items: [
          { id: 'demo-a1', title: 'Hafermilch', checked: false },
          { id: 'demo-a2', title: 'Tomaten', checked: false },
          { id: 'demo-a3', title: 'Brot', checked: true, checkedAt: nowIso() },
        ],
      },
      {
        id: 'carrefour',
        title: 'Carrefour',
        items: [
          { id: 'demo-r1', title: 'Kaffeebohnen', checked: false },
          { id: 'demo-r2', title: 'Parmesan', checked: false },
          { id: 'demo-r3', title: 'Olivenöl', checked: false },
        ],
      },
      {
        id: 'tesco',
        title: 'Tesco',
        items: [
          { id: 'demo-d1', title: 'Zahnpasta', checked: false },
          { id: 'demo-d2', title: 'Waschmittel', checked: false },
        ],
      },
    ],
  };
}

/* Der Songs-Screen erzeugt Musik über einen lokalen Generator-Dienst. In der
   Demo bleibt die Bibliothek leer — der Screen zeigt dann seinen eigenen
   Leerzustand, was ehrlicher ist als vorgetäuschte Wiedergabe. */
const demoSongs = () => ({ songs: [] });

export function demoResponse(path: string, method: string): Response | null {
  if (path === '/api/health') {
    return method === 'GET'
      ? json({ ok: true, status: 'ready', schemaVersion: HOUSEHOLD_SCHEMA_VERSION }, 200, { 'cache-control': 'no-store' })
      : json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET', 'cache-control': 'no-store' });
  }
  if (path === '/api/household-config-mode') {
    return method === 'GET'
      ? json({ mode: 'active' }, 200, { 'x-hmi-household-config-mode': 'active', 'cache-control': 'no-store' })
      : json({ code: 'METHOD_NOT_ALLOWED' }, 405, { 'x-hmi-household-config-mode': 'active', 'cache-control': 'no-store' });
  }
  if (path === '/api/household-config') {
    return method === 'GET'
      ? json(publicDemoHouseholdConfig(), 200, { 'x-hmi-household-config-mode': 'active', 'cache-control': 'no-store' })
      : json({ code: 'METHOD_NOT_ALLOWED' }, 405, { 'x-hmi-household-config-mode': 'active', 'cache-control': 'no-store' });
  }
  /* Die Ambient-Texte entstehen normalerweise über einen lokalen LLM-Dienst.
     In der Demo gibt es den nicht — hier wird bewusst der vorhandene
     Fallback-Pfad ausgelöst statt eine LLM-Antwort vorzutäuschen. Ohne diese
     Abkürzung liefe der Aufruf in wiederholte 404er. */
  if (path.startsWith('/ambient-llm')) {
    return json({ error: 'Kein LLM-Dienst in der Demo.' }, 503);
  }
  if (path.startsWith('/api/ablage')) {
    return json({ error: 'Die Ablage ist in der Demo nicht verfügbar.' }, 403);
  }
  if (path.startsWith('/api/config')) {
    return method === 'GET'
      ? json({ values: { 'hmi:shopping-config:v1': JSON.stringify(demoShoppingConfig) } })
      : json({ ok: true });
  }
  if (path.startsWith('/api/reminders')) {
    return method === 'GET' ? json(demoReminders()) : json({ ok: true });
  }
  if (path === '/notion-shopping.json') {
    return method === 'GET'
      ? json(demoShopping(), 200, { 'cache-control': 'no-store' })
      : json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET', 'cache-control': 'no-store' });
  }
  if (path.startsWith('/api/shopping')) {
    return method === 'GET' ? json(demoShopping()) : json({ ok: true });
  }
  if (path.startsWith('/api/songs')) {
    return method === 'GET' ? json(demoSongs()) : json({ ok: true });
  }
  return null;
}

/* Deep-Link in einen Screen: `#library`, `#energy`, … Erlaubt es, aus der
   Landing Page gezielt in einen Screen zu verlinken, statt Besucher selbst
   suchen zu lassen. Nur in der Demo — die Kiosk-App kennt keine URL-Navigation. */
const DEEP_LINK_SCREENS = new Set([
  'home', 'energy', 'calendar', 'notes', 'media', 'library', 'system',
]);

/* Startwerte für die Energie-Sensoren. Ohne sie zeigt der Energie-Screen in der
   Demo überall „—", obwohl die erfasste Last eine Kernfunktion ist. Erzeugung
   und Netzbezug bleiben bewusst leer: die Referenzinstallation hat weder PV noch
   Netzzähler, und genau dieser Leerzustand ist dokumentiertes Verhalten. */
const DEMO_LOAD_WATTS: Readonly<Record<string, number>> = {
  'sensor.strom_leiste_kanal_1_power': 34,
  'sensor.strom_leiste_kanal_2_power': 12,
  'sensor.waschmaschine_strom_power': 412,
  'sensor.strom_schreibtisch_links_power': 87,
  'sensor.strom_bad_klein_power': 3,
  'sensor.strom_schlafzimmer_tuer_power': 6,
  'sensor.strom_wohnzimmer_regal_power': 19,
  'sensor.strom_couch_lang_power': 41,
  'sensor.strom_glastuer_power': 8,
  'sensor.strom_spuele_power': 15,
  'sensor.strom_kinderzimmer_tuer_power': 5,
  'sensor.strom_zigbee_steckdose_power': 63,
  'sensor.strom_trockner_power': 268,
  'sensor.strom_kaffeemaschine_power': 2,
  'sensor.strom_server_power': 24,
};

const DEMO_CONSUMED_TODAY_KWH = 4.7;

export function demoEnergySeed(): [string, unknown][] {
  if (!IS_DEMO) return [];
  const entries: [string, unknown][] = Object.entries(DEMO_LOAD_WATTS)
    .map(([id, value]) => [id, { value, unit: 'W' }]);
  entries.push(['sensor.hmi_erfasste_last_taeglich', { value: DEMO_CONSUMED_TODAY_KWH, unit: 'kWh' }]);
  return entries;
}

/* Wird vor dem Mount ausgeführt, deshalb wird der Startscreen direkt gesetzt
   statt über showScreen() — ein Übergang beim allerersten Rendern wäre falsch. */
export function applyDemoDeepLink(setScreen: (screen: string) => void): void {
  if (!IS_DEMO || typeof location === 'undefined') return;
  const target = location.hash.replace(/^#/, '').trim().toLowerCase();
  if (DEEP_LINK_SCREENS.has(target)) setScreen(target);
}

/** Installiert den Demo-Shim. No-op außerhalb des Demo-Builds. */
export function installDemoApi(): void {
  if (!IS_DEMO || typeof globalThis.fetch !== 'function') return;

  const original = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    let path: string;
    try {
      path = new URL(url, globalThis.location?.href ?? 'http://localhost').pathname;
    } catch {
      return original(input as RequestInfo, init);
    }

    const response = demoResponse(path, method);
    return response ?? original(input as RequestInfo, init);
  };

  resetDemoState();
  document.documentElement.setAttribute('data-demo', 'true');
  addDemoBadge();
}

/* Jeder Demo-Besuch startet gleich: gespeicherter Zustand aus einer früheren
   Sitzung würde sich sonst mit dem frischen Fake-Zustand überlagern (z. B.
   Benachrichtigungen zu weiterhin laufenden Geräten). */
function resetDemoState(): void {
  try {
    localStorage.removeItem('hmi:notifications:v1');
    localStorage.removeItem('hmi:shopping-cache');
    localStorage.removeItem('hmi:shopping-done-log.v1');
  } catch { /* Storage nicht verfügbar — dann gibt es auch nichts zu räumen */ }
}

/* Räume werden nach dem ersten Paint und bei jeder Geräteänderung neu aus dem
   Seed projiziert — dabei tragen sie wieder die deutschen Seed-Namen. Ohne
   erneutes Anwenden bleibt die Demo in jeder Sprache deutsch beschriftet.
   Der dynamische Import hält demo-names.ts aus dem Produktions-Bundle heraus. */
export function reapplyDemoNames(rooms: Parameters<typeof import('./demo-names.ts').applyDemoNames>[0]): void {
  if (!IS_DEMO) return;
  void import('./demo-names.ts').then(({ applyDemoNames }) => applyDemoNames(rooms));
}

/* Dauerhafte Kennzeichnung: simulierte Daten, kein echtes Zuhause. */
function addDemoBadge(): void {
  if (typeof document === 'undefined' || document.querySelector('.demo-badge')) return;
  const badge = document.createElement('div');
  badge.className = 'demo-badge';
  badge.textContent = m.demo_badge();
  document.body.append(badge);
}
