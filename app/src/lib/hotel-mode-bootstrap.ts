/* ── Hotel-Bootstrap ──
   Entscheidet vor dem autorisierten Appstart, welche Oberfläche ein Benutzer
   überhaupt zu sehen bekommt. Der Serverzustand ist maßgeblich: `inactive` lädt
   nur eine neutrale Fläche, `active` startet die Gastshell auf der
   freigegebenen Teilmenge, `admin` und ein deaktivierter Hotel Mode laufen
   exakt den bisherigen Weg.

   Diese Auswahl ist Bedienführung, keine Sicherheitsgrenze — die liegt im
   Server (Allowlist-Proxy und Adminsitzung, docs/hotel-mode-plan.md §7). */

import { mount } from 'svelte';
import type { HouseholdRuntimeModel } from './config/household-config.ts';

export type HotelSurface = 'disabled' | 'inactive' | 'active' | 'admin';

export interface HotelBootstrapState {
  surface: HotelSurface;
  /** Opake Aufenthalts-ID; nur im aktiven Gastzustand belegt. */
  stayId: string | null;
  welcomeMessage: string | null;
  /** Ob der Gast seinen Aufenthalt selbst beenden darf. */
  checkoutEnabled: boolean;
}

export interface HotelGuestRoomAccess {
  roomId: string;
  entityIds: string[];
}

export const HOTEL_STATUS_ENDPOINT = '/api/hotel-mode/status';
export const HOTEL_SESSION_ENDPOINT = '/api/hotel-mode/session';
/* Erinnert nur, DASS Hotel Mode eingerichtet ist — nie einen Aufenthalt, einen
   Namen oder eine Sitzung. Damit fällt ein abgerissener Statusabruf auf die
   engste Oberfläche zurück statt auf das volle Panel. */
export const HOTEL_ENABLED_KEY = 'hmi:hotel-mode';
const HOTEL_BOOTSTRAP_TIMEOUT_MS = 2000;

export interface HotelBootstrapDependencies {
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function neutralState(surface: HotelSurface): HotelBootstrapState {
  return { surface, stayId: null, welcomeMessage: null, checkoutEnabled: false };
}

/**
 * Reine Auswertung der beiden Serverantworten. Eine offene Adminsitzung gewinnt
 * über den Gastzustand; alles, was nicht ausdrücklich als laufender Aufenthalt
 * lesbar ist, endet neutral.
 */
export function decideHotelSurface(status: unknown, session: unknown): HotelBootstrapState {
  const document = record(status);
  if (!document || document.enabled !== true) return neutralState('disabled');

  const account = record(session);
  if (account?.unlocked === true) return neutralState('admin');
  if (document.status !== 'active') return neutralState('inactive');

  const stay = record(document.stay);
  return {
    surface: 'active',
    stayId: typeof stay?.id === 'string' ? stay.id : null,
    welcomeMessage: typeof stay?.welcomeMessage === 'string' ? stay.welcomeMessage : null,
    checkoutEnabled: document.checkoutEnabled === true,
  };
}

function readRemembered(storage: HotelBootstrapDependencies['storage']): boolean {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    return source?.getItem(HOTEL_ENABLED_KEY) === 'enabled';
  } catch {
    return false;
  }
}

function remember(storage: HotelBootstrapDependencies['storage'], enabled: boolean): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    target?.setItem(HOTEL_ENABLED_KEY, enabled ? 'enabled' : 'disabled');
  } catch { /* ein fehlender Speicher ändert nur den Rückfall, nicht die Grenze */ }
}

async function readJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(HOTEL_BOOTSTRAP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return await response.json();
}

/**
 * Fragt Aufenthalts- und Sitzungszustand parallel ab. Antwortet der Server
 * nicht, entscheidet der zuletzt bekannte Einrichtungszustand: eine bekannte
 * Hotelinstallation bleibt neutral, statt versehentlich das volle Panel zu
 * zeigen.
 */
export async function resolveHotelBootstrap(
  { fetchImpl, storage = null }: HotelBootstrapDependencies = {},
): Promise<HotelBootstrapState> {
  const request = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let status: unknown;
  try {
    status = await readJson(request, HOTEL_STATUS_ENDPOINT);
  } catch {
    return neutralState(readRemembered(storage) ? 'inactive' : 'disabled');
  }

  const enabled = record(status)?.enabled === true;
  remember(storage, enabled);
  if (!enabled) return neutralState('disabled');

  let session: unknown = null;
  try { session = await readJson(request, HOTEL_SESSION_ENDPOINT); } catch { session = null; }
  return decideHotelSurface(status, session);
}

/**
 * Verengt das Haushaltsmodell auf die Gastfreigabe: nur freigegebene Räume mit
 * ihren freigegebenen Entities, nur die Startseite als Navigationsziel und
 * keine Module, für die es im Gastzustand ohnehin keine Daten gibt. Damit
 * entstehen keine leeren Tabs und keine Abos auf gesperrte Entities.
 */
export function restrictHouseholdModelForGuest(
  model: HouseholdRuntimeModel,
  rooms: readonly HotelGuestRoomAccess[],
): HouseholdRuntimeModel {
  const allowed = new Map(rooms.map((room) => [room.roomId, new Set(room.entityIds)]));
  const guestRooms = model.rooms
    .filter((room) => allowed.has(room.id))
    .map((room) => ({
      ...room,
      visibleEntities: room.visibleEntities
        .filter((entity) => allowed.get(room.id)?.has(entity.entityId) === true),
    }))
    .filter((room) => room.visibleEntities.length > 0);
  const entityIds = [...new Set(guestRooms.flatMap(
    (room) => room.visibleEntities.map((entity) => entity.entityId),
  ))].sort();

  const home = model.navigation.find(
    (item) => item.target.type === 'module' && item.target.id === 'home',
  );
  return {
    ...model,
    rooms: guestRooms,
    navigation: [home
      ? { ...home, order: 0 }
      : { id: 'home', name: 'Home', order: 0, target: { type: 'module' as const, id: 'home' } }],
    enabledModules: ['home'],
    energy: null,
    mediaTargets: [],
    // Sonnenstand, Urlaubsschalter, Home-Off-Skript und Wäsche gehören dem
    // Betreiber, nicht dem Gast — und der Gastproxy liefert sie ohnehin nicht.
    globalEntities: {
      sun: null,
      vacationMode: null,
      homeOffScript: null,
      laundry: { washer: null, dryer: null },
    },
    subscriptionEntityIds: entityIds,
    entityIds,
  };
}

/** Die tatsächlich freigegebene Raum-/Entity-Struktur, direkt vom Gastproxy. */
export async function loadHotelGuestAccess(): Promise<HotelGuestRoomAccess[]> {
  const store = await import('./state/hotel-entities.svelte.ts');
  await store.refreshHotelGuestEntities();
  return store.hotelGuest.rooms.map((room) => ({
    roomId: room.roomId,
    entityIds: room.entities.map((entity) => entity.entityId),
  }));
}

/**
 * Ermittelt die Oberfläche und schaltet für einen laufenden Aufenthalt bereits
 * auf Gastmodell und Hotel-Runtime um — beides muss stehen, bevor App.svelte
 * und der Runtime-Singleton importiert werden.
 */
export async function applyHotelBootstrap(
  dependencies: HotelBootstrapDependencies = {},
): Promise<HotelBootstrapState> {
  const state = await resolveHotelBootstrap(dependencies);

  // Credential-Cutover: sobald dieses Panel eine Gastoberfläche zeigt, dürfen
  // die lokalen Reste eines früheren Adminbetriebs nicht liegen bleiben.
  const { hotelSurfaceNeedsPurge, purgeHotelSensitiveValues } = await import('./hotel-mode-activation.ts');
  if (hotelSurfaceNeedsPurge(state.surface)) {
    purgeHotelSensitiveValues(typeof localStorage === 'undefined' ? null : localStorage);
  }

  if (state.surface !== 'active') return state;

  const data = await import('./config/household-runtime-data.ts');
  const access = await loadHotelGuestAccess();
  data.installActiveHouseholdData(
    restrictHouseholdModelForGuest(data.HOUSEHOLD_RUNTIME_MODEL, access),
  );

  const [{ setBackend }, { HotelBackend }] = await Promise.all([
    import('./adapter/runtime.svelte.ts'),
    import('./adapter/hotel-backend.ts'),
  ]);
  setBackend(new HotelBackend());
  return state;
}

/**
 * Der Admin-Einstieg liegt bewusst in einer eigenen, dünnen Ebene über der
 * Oberfläche: die neutrale Fläche lädt die App-Shell gar nicht, und die
 * Gastshell soll den Adminweg nicht kennen müssen.
 */
export async function mountHotelAdminLayer(surface: HotelSurface): Promise<void> {
  if (surface === 'disabled' || typeof document === 'undefined') return;
  const { default: HotelAdminLayer } = await import('./components/HotelAdminLayer.svelte');
  const container = document.createElement('div');
  container.dataset.hotelLayer = surface;
  document.body.appendChild(container);
  mount(HotelAdminLayer, { target: container, props: { unlocked: surface === 'admin' } });
}

/**
 * Die Gastebene (Welcome Screen und Lern-Overlay) liegt wie der Admin-Einstieg
 * über der unveränderten Oberfläche; kein Control und keine Shell muss dafür
 * angepasst werden. Außerhalb eines laufenden Aufenthalts entsteht sie nicht.
 */
export async function mountHotelGuestLayer(state: HotelBootstrapState): Promise<void> {
  if (typeof document === 'undefined') return;
  const { hotelWelcomeView } = await import('./components/hotel-welcome.ts');
  const view = hotelWelcomeView(state);
  if (!view) return;
  const { default: HotelGuestLayer } = await import('./components/HotelGuestLayer.svelte');
  const container = document.createElement('div');
  container.dataset.hotelLayer = 'guest';
  document.body.appendChild(container);
  mount(HotelGuestLayer, { target: container, props: { view, checkoutEnabled: state.checkoutEnabled } });
}
