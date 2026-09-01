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

/* Die Haushaltskonfiguration ist Referenzdaten und deshalb deutsch benannt.
   Der Einstellungs-Screen liest die Räume und Geräte direkt daraus — in der
   Demo werden die Namen darum hier übersetzt, damit sie zur restlichen
   Oberfläche passen. Räume und Lichter teilen ihre Katalogschlüssel mit
   demo-names.ts, das dieselben Namen im Runtime-Raummodell setzt. */
const DEMO_ROOM_NAMES: Readonly<Record<string, () => string>> = {
  wohnzimmer: m.demo_room_wohnzimmer,
  kinderzimmer: m.demo_room_kinderzimmer,
  schlafzimmer: m.demo_room_schlafzimmer,
  bad: m.demo_room_bad,
  kueche: m.demo_room_kueche,
  flur: m.demo_room_flur,
};

const DEMO_ENTITY_NAMES: Readonly<Record<string, () => string>> = {
  'light.wohnzimmer_kugellampen': m.demo_device_kugellampen,
  'light.wohnzimmer_esstisch': m.demo_device_esstisch,
  'light.wohnzimmer_tv': m.demo_device_kugel_tv,
  'light.wohnzimmer_fensterlampe': m.demo_device_kugel_fenster,
  'light.schlafzimmer_bett': m.demo_device_bett,
  'light.schlafzimmer_schreibtisch': m.demo_device_schreibtisch,
  'light.bad_spiegel': m.demo_device_spiegel,
  'light.kueche_ledleiste': m.demo_device_ledfridge,
};

/* Klima, Temperatur und Kamera heißen in jedem Raum gleich — über die Rolle
   statt über je eine Entity-ID. */
const DEMO_ROLE_NAMES: Readonly<Record<string, () => string>> = {
  climate: m.demo_device_climate,
  temperature: m.demo_device_temperature,
  camera: m.demo_device_camera,
};

function publicDemoHouseholdConfig() {
  return {
    ...demoHouseholdConfig,
    rooms: demoHouseholdConfig.rooms.map((room) => ({
      ...room,
      name: DEMO_ROOM_NAMES[room.id]?.() ?? room.name,
      visibleEntities: room.visibleEntities.map((entity) => ({
        ...entity,
        name: (DEMO_ENTITY_NAMES[entity.entityId] ?? DEMO_ROLE_NAMES[entity.role])?.() ?? entity.name,
      })),
    })),
    navigation: demoHouseholdConfig.navigation.filter((item) => item.target.id !== 'songs'),
    enabledModules: demoHouseholdConfig.enabledModules.filter((id) => id !== 'songs'),
  };
}

/* Das Personen-Präfix ist Zuordnung, kein Text: es steuert Sektion und
   Post-it-Farbe und wird vor der Anzeige entfernt (reminders.ts). Deshalb
   steht es hier und nicht im Katalog. */
function demoReminder(id: string, title: string, completed: boolean) {
  return {
    id, title, completed,
    due: null, description: null, priority: null,
    created: nowIso(), edited: nowIso(), source: 'hmi',
  };
}

function demoReminders() {
  return {
    version: 1,
    updatedAt: nowIso(),
    items: [
      demoReminder('demo-1', `Alex - ${m.demo_todo_bike_light()}`, false),
      demoReminder('demo-2', `Sam - ${m.demo_todo_filter()}`, false),
      demoReminder('demo-3', `Beide - ${m.demo_todo_garage()}`, false),
      demoReminder('demo-4', `Alex - ${m.demo_todo_plants()}`, false),
      demoReminder('demo-5', `Sam - ${m.demo_todo_window()}`, false),
      demoReminder('demo-6', `Beide - ${m.demo_todo_cellar()}`, true),
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
          { id: 'demo-a1', title: m.demo_shop_oat_milk(), checked: false },
          { id: 'demo-a2', title: m.demo_shop_tomatoes(), checked: false },
          { id: 'demo-a3', title: m.demo_shop_bread(), checked: true, checkedAt: nowIso() },
        ],
      },
      {
        id: 'carrefour',
        title: 'Carrefour',
        items: [
          { id: 'demo-r1', title: m.demo_shop_coffee(), checked: false },
          { id: 'demo-r2', title: m.demo_shop_parmesan(), checked: false },
          { id: 'demo-r3', title: m.demo_shop_olive_oil(), checked: false },
        ],
      },
      {
        id: 'tesco',
        title: 'Tesco',
        items: [
          { id: 'demo-d1', title: m.demo_shop_toothpaste(), checked: false },
          { id: 'demo-d2', title: m.demo_shop_detergent(), checked: false },
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
  /* Betriebsart: im Add-on entfaellt die Zugangsdatenfrage. Genau diesen Weg
     zeigt die Demo, weil ihn die meisten Nutzer gehen werden. */
  if (path === '/api/ha/connection') {
    return json({
      ok: true, mode: 'supervisor', credentialsRequired: false,
      available: true, gatewayPath: '/api/websocket',
    }, 200, { 'cache-control': 'no-store' });
  }
  if (path === '/api/setup/discovery') {
    return json(demoDiscoverySnapshot(), 200, { 'cache-control': 'no-store' });
  }
  /* Der Abschluss bestaetigt, schreibt aber nichts: die Demo hat keinen
     Server, und ein vorgetaeuschter Erfolg mit echtem Schreibversuch waere
     schlimmer als gar keiner. */
  if (path === '/api/setup/activate') {
    return method === 'POST'
      ? json({ ok: true }, 200, { 'cache-control': 'no-store' })
      : json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST', 'cache-control': 'no-store' });
  }
  /* Ortssuche mit festen Treffern: die Demo hat keinen Server und darf
     Nominatim nicht belasten. Gezeigt wird, wie die Auswahl sich anfuehlt. */
  if (path === '/api/admin/ambient-map/search') {
    return json({
      results: [
        { label: 'Dortmund, Nordrhein-Westfalen, Deutschland', latitude: 51.5142, longitude: 7.4653 },
        { label: 'Marseille, Bouches-du-Rhône, France', latitude: 43.2965, longitude: 5.3698 },
        { label: 'Köln, Nordrhein-Westfalen, Deutschland', latitude: 50.9375, longitude: 6.9603 },
      ],
    }, 200, { 'cache-control': 'no-store' });
  }
  if (path === '/api/admin/ambient-map/location' || path === '/api/admin/ambient-map/regenerate') {
    return method === 'POST'
      ? json({ state: 'queued' }, 202, { 'cache-control': 'no-store' })
      : json({ code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST', 'cache-control': 'no-store' });
  }
  /* Der Stadtplan der Demo ist genau das Beispielbild aus dem Assistenten —
     dasselbe, das der Schritt ankuendigt. */
  if (path === '/api/ambient-map' || path === '/api/admin/ambient-map') {
    return json({
      version: 1, state: 'ready', radiusMetres: 5000,
      asset: {
        /* Dieselbe Datei, die der Assistent als Beispiel zeigt — unter ihrem
           echten Inhalts-Hash und unter dem Basispfad des Builds, damit sie die
           Allowlist des Clients passiert. Ein Beispiel unter einem
           Fantasiepfad wuerde stillschweigend verworfen und die Vorschau
           bliebe leer; ein root-relativer Pfad liefe auf GitHub Pages neben
           `/hauser/demo/` ins Leere. */
        url: `${import.meta.env.BASE_URL}assets/ambient-maps/a7de47116390b2ef4e0ba1ca5f5fcfe0cb904ac82d0bc753b12a8b24da44d98a.svg`,
        etag: '"a7de47116390b2ef4e0ba1ca5f5fcfe0cb904ac82d0bc753b12a8b24da44d98a"',
        byteLength: 128091,
      },
      ...(path === '/api/admin/ambient-map' ? { source: 'home_assistant' } : {}),
    }, 200, { 'cache-control': 'no-store' });
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

/* ── Einrichtungsassistent in der Demo ──
   Der Assistent ist die erste Minute, die ein Nutzer mit Hauser verbringt —
   und bisher liess er sich nirgends ansehen, ohne eine echte Anlage
   umzukonfigurieren. Hier antwortet die Demo auf genau die Aufrufe des
   Assistenten, sodass der Weg vollstaendig begehbar ist, ohne dass ein Byte
   den Browser verlaesst.

   Die Momentaufnahme wird NICHT erfunden, sondern aus derselben
   Haushaltskonfiguration abgeleitet, die die Demo ohnehin zeigt: jeder Raum
   wird ein Bereich, jede sichtbare Entitaet ein Registrierungseintrag samt
   Zustand. Der Scan findet damit genau das wieder, was die Demo danach
   darstellt — kein Auseinanderlaufen zwischen Versprechen und Ergebnis.

   Bewusst `supervisor`: so sehen Nutzer des Home-Assistant-Add-ons den
   Assistenten, also ohne Zugangsdatenfrage. */
function demoDiscoverySnapshot() {
  const config = publicDemoHouseholdConfig();
  const areas = config.rooms.map((room) => ({ area_id: room.id, name: room.name }));
  const entities: Array<Record<string, unknown>> = [];
  const states: Array<Record<string, unknown>> = [];
  for (const room of config.rooms) {
    for (const entity of room.visibleEntities) {
      entities.push({
        entity_id: entity.entityId,
        area_id: room.id,
        device_id: null,
        original_name: entity.name,
        disabled_by: null,
        hidden_by: null,
      });
      states.push({ entity_id: entity.entityId, attributes: { friendly_name: entity.name } });
    }
  }
  return { areas, devices: [], entities, states };
}

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
  applyDemoDefaultLocale();
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

/* Die Demo richtet sich an ein internationales Publikum und startet deshalb
   auf Englisch, nicht auf der Basissprache des Katalogs. Gesetzt wird nur, wenn
   noch keine Wahl vorliegt — die Sprachumschaltung im Betrieb bleibt gültig.
   Läuft vor dem Mount, damit der erste Aufbau schon englisch ist. */
function applyDemoDefaultLocale(): void {
  try {
    if (localStorage.getItem('PARAGLIDE_LOCALE') === null) {
      localStorage.setItem('PARAGLIDE_LOCALE', 'en');
    }
  } catch { /* Storage blockiert — dann greift die Browsersprache */ }
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
