/* ============================================
   Ambient-Stadtplan — schmaler Client (docs/18 §6, §7.1)

   Kapselt genau drei Dinge: den Statusabruf, die Admin-Mutationen und das
   begrenzte Jobpolling. Bewusst framework-frei (keine Runes), damit er im
   node-Testenv ohne DOM läuft; der reaktive Spiegel liegt in
   `ambient-map.svelte.ts`.

   Zwei Verträge der Serverseite prägen den ganzen Client:

   1. Mutationen antworten SOFORT mit `202` — der Renderjob läuft danach. Es
      wird deshalb nie auf Fertigstellung gewartet, sondern begrenzt gepollt.
   2. `503` heißt ausschließlich „kein Home-Assistant-Zugang eingerichtet". Ein
      fehlschlagender HA-Abruf ist kein `503`, sondern erscheint als
      `state: "error"` im Status — bei weiterhin gültigem bisherigem Asset.

   Race-Schutz: eine einzige monotone Generation. Jede Operation reserviert vor
   ihrem ersten `await` die nächste Generation und schreibt danach nur noch,
   wenn sie immer noch die aktuelle ist. Eine veraltete Antwort kann damit
   keinen neueren Standort- oder Jobstand überschreiben.
   ============================================ */

export const AMBIENT_MAP_STATUS_URL = '/api/ambient-map';
export const AMBIENT_MAP_ADMIN_STATUS_URL = '/api/admin/ambient-map';
export const AMBIENT_MAP_LOCATION_URL = '/api/admin/ambient-map/location';
export const AMBIENT_MAP_REGENERATE_URL = '/api/admin/ambient-map/regenerate';

/* Nur das feste Hauser-Format wird als Asset akzeptiert — nie ein beliebiger
   Pfad aus einer Serverantwort (docs/18 §7.1). Der Pfad ist an den Basispfad
   des Builds gebunden: im Produkt ist das `/`, in der Pages-Demo
   `/hauser/demo/`. Ohne diese Bindung zeigte die Demo auf
   `/assets/ambient-maps/…` neben ihrem Basispfad und der Stadtplan blieb dort
   still ein 404. */
const ASSET_BASE_PATH = import.meta.env.BASE_URL ?? '/';
export const AMBIENT_MAP_ASSET_URL_PATTERN = new RegExp(
  `^${ASSET_BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}assets/ambient-maps/[0-9a-f]{64}\\.svg$`,
);

export const AMBIENT_MAP_POLL_INTERVAL_MS = 1_500;
/* Nominatim erlaubt hoechstens eine Anfrage pro Sekunde. Echtes
   Tippen-fuer-Tippen-Autocomplete wuerde das verletzen; deshalb wird erst
   gesucht, wenn die Eingabe kurz ruht. Der Server setzt dieselbe Grenze
   nochmal durch — die Oberflaeche ist hoeflich, der Server verbindlich. */
export const AMBIENT_MAP_SEARCH_DEBOUNCE_MS = 600;
export const AMBIENT_MAP_SEARCH_MIN_LENGTH = 3;
/* Obergrenze statt Endlosschleife: ein Job, der nach einer Minute nicht fertig
   ist, wird nicht durch weiteres Pollen fertig. Der Serverauftrag läuft
   unabhängig weiter, der nächste Statusabruf holt ihn ein. */
export const AMBIENT_MAP_POLL_MAX_ATTEMPTS = 40;
export const AMBIENT_MAP_GEOLOCATION_TIMEOUT_MS = 15_000;

export type AmbientMapState = 'empty' | 'queued' | 'running' | 'ready' | 'error';
export type AmbientMapSource = 'home_assistant' | 'browser' | 'manual';

export interface AmbientMapPlace {
  label: string;
  latitude: number;
  longitude: number;
}

/* Auch die Trefferliste kommt aus dem Netz und wird deshalb streng geprueft,
   nicht bloss durchgereicht. */
export function parseAmbientMapPlaces(value: unknown): AmbientMapPlace[] {
  const list = isRecord(value) && Array.isArray(value.results) ? value.results : null;
  if (!list) return [];
  const places: AmbientMapPlace[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const { label, latitude, longitude } = entry;
    if (typeof label !== 'string' || !label.trim() || label.length > 200) continue;
    if (typeof latitude !== 'number' || !isValidAmbientMapCoordinates(latitude, 0)) continue;
    if (typeof longitude !== 'number' || !isValidAmbientMapCoordinates(0, longitude)) continue;
    places.push({ label: label.trim(), latitude, longitude });
    if (places.length >= 5) break;
  }
  return places;
}

export type AmbientMapProblem =
  | 'status_unavailable'
  | 'unavailable'
  | 'request_failed'
  | 'admin_required'
  | 'home_assistant_unavailable'
  | 'invalid_coordinates'
  | 'search_failed'
  | 'search_rate_limited'
  | 'geolocation_denied'
  | 'geolocation_unavailable'
  | 'geolocation_timeout'
  | 'geolocation_insecure';

export interface AmbientMapClientState {
  /** Serverseitiger Jobzustand; `empty` heißt „noch nie eingerichtet". */
  state: AmbientMapState;
  radiusMetres: number | null;
  assetUrl: string | null;
  source: AmbientMapSource | null;
  label: string | null;
  /** Ursache des letzten gescheiterten Auftrags, rein diagnostisch. */
  errorCode: string | null;
  /** Treffer der Ortssuche; leer heisst „nichts gesucht" oder „nichts gefunden". */
  searchResults: AmbientMapPlace[];
  searching: boolean;
  /** Mindestens eine Statusantwort wurde verarbeitet. */
  loaded: boolean;
  /** Eine Mutation ist unterwegs (der Job selbst wird nicht abgewartet). */
  busy: boolean;
  /** Die Browserortung läuft. */
  locating: boolean;
  polling: boolean;
  problem: AmbientMapProblem | null;
}

export interface AmbientMapPositionLike {
  coords: { latitude: number; longitude: number };
}

export interface AmbientMapGeolocationLike {
  getCurrentPosition(
    success: (position: AmbientMapPositionLike) => void,
    error?: (reason: unknown) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
}

export interface AmbientMapClientOptions {
  fetcher?: typeof fetch;
  /** `null` schaltet die Browserortung ab (kein Adapter vorhanden). */
  geolocation?: AmbientMapGeolocationLike | null;
  secureContext?: () => boolean;
  scheduleTimer?: (run: () => void, delayMs: number) => unknown;
  cancelTimer?: (handle: unknown) => void;
  pollIntervalMs?: number;
  pollMaxAttempts?: number;
  searchDebounceMs?: number;
  onChange?: () => void;
}

export function initialAmbientMapState(): AmbientMapClientState {
  return {
    state: 'empty',
    radiusMetres: null,
    assetUrl: null,
    source: null,
    label: null,
    errorCode: null,
    searchResults: [],
    searching: false,
    loaded: false,
    busy: false,
    locating: false,
    polling: false,
    problem: null,
  };
}

const STATES = new Set<AmbientMapState>(['empty', 'queued', 'running', 'ready', 'error']);
const SOURCES = new Set<AmbientMapSource>(['home_assistant', 'browser', 'manual']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Übernimmt aus einer Serverantwort ausschließlich die bekannten Felder. */
export function parseAmbientMapStatus(value: unknown): {
  state: AmbientMapState;
  radiusMetres: number | null;
  assetUrl: string | null;
  source: AmbientMapSource | null;
  label: string | null;
  /* Warum der letzte Auftrag scheiterte. Nur im Adminstatus vorhanden, rein
     diagnostisch — sonst bliebe der Benutzer bei „Erzeugung fehlgeschlagen"
     ohne jeden Hinweis auf die Ursache. */
  errorCode: string | null;
} | null {
  if (!isRecord(value) || typeof value.state !== 'string' || !STATES.has(value.state as AmbientMapState)) {
    return null;
  }
  const asset = isRecord(value.asset) ? value.asset : null;
  const url = typeof asset?.url === 'string' && AMBIENT_MAP_ASSET_URL_PATTERN.test(asset.url)
    ? asset.url
    : null;
  const radius = typeof value.radiusMetres === 'number'
    && Number.isSafeInteger(value.radiusMetres)
    && value.radiusMetres > 0 && value.radiusMetres <= 5_000
    ? value.radiusMetres
    : null;
  const label = typeof value.label === 'string' && value.label.trim() && value.label.length <= 120
    ? value.label.trim()
    : null;
  /* Enge Form: nur Großbuchstaben-Codes, längenbegrenzt. Der Server sendet
     ausschließlich eigene Codes; alles andere wird verworfen statt angezeigt. */
  const errorCode = typeof value.errorCode === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(value.errorCode)
    ? value.errorCode
    : null;
  return {
    errorCode,
    state: value.state as AmbientMapState,
    /* Radius und Quelle gehören zum aktiven Asset; ohne gültiges Asset sind sie
       bedeutungslos und werden verworfen. */
    radiusMetres: url ? radius : null,
    assetUrl: url,
    source: url && typeof value.source === 'string' && SOURCES.has(value.source as AmbientMapSource)
      ? value.source as AmbientMapSource
      : null,
    label: url ? label : null,
  };
}

/** Akzeptiert Dezimalgrad mit Punkt oder Komma; alles andere ist ungültig. */
export function parseAmbientMapCoordinate(value: string): number | null {
  const text = value.trim().replace(',', '.');
  if (!/^[+-]?\d{1,3}(\.\d{1,10})?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isValidAmbientMapCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function defaultGeolocation(): AmbientMapGeolocationLike | null {
  try {
    const candidate = (globalThis as { navigator?: { geolocation?: unknown } }).navigator?.geolocation;
    return candidate && typeof (candidate as AmbientMapGeolocationLike).getCurrentPosition === 'function'
      ? candidate as AmbientMapGeolocationLike
      : null;
  } catch { return null; }
}

function defaultSecureContext(): boolean {
  return (globalThis as { isSecureContext?: boolean }).isSecureContext === true;
}

/* `503` ist zweideutig: der Server meldet damit sowohl den fehlenden
   Home-Assistant-Zugang als auch eine gar nicht verfügbare Kartenfähigkeit
   (fehlende Laufzeitverzeichnisse). Nur der Fehlercode im Body trennt beides. */
const UNAVAILABLE_CODE = 'AMBIENT_MAP_UNAVAILABLE';

async function readProblemCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.code === 'string' ? body.code : null;
  } catch { return null; }
}

function geolocationProblem(reason: unknown): AmbientMapProblem {
  const code = isRecord(reason) && typeof reason.code === 'number' ? reason.code : 0;
  if (code === 1) return 'geolocation_denied';
  if (code === 3) return 'geolocation_timeout';
  return 'geolocation_unavailable';
}

export function createAmbientMapClient(options: AmbientMapClientOptions = {}) {
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const geolocation = options.geolocation === undefined ? defaultGeolocation() : options.geolocation;
  const secureContext = options.secureContext ?? defaultSecureContext;
  const scheduleTimer = options.scheduleTimer
    ?? ((run: () => void, delayMs: number) => setTimeout(run, delayMs));
  const cancelTimer = options.cancelTimer
    ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pollIntervalMs = options.pollIntervalMs ?? AMBIENT_MAP_POLL_INTERVAL_MS;
  const pollMaxAttempts = options.pollMaxAttempts ?? AMBIENT_MAP_POLL_MAX_ATTEMPTS;
  const searchDebounceMs = options.searchDebounceMs ?? AMBIENT_MAP_SEARCH_DEBOUNCE_MS;
  const onChange = options.onChange ?? (() => {});

  const state = initialAmbientMapState();

  let generation = 0;
  let pollHandle: unknown = null;
  let pollAttempts = 0;
  let pollAdmin = false;

  function patch(next: Partial<AmbientMapClientState>): void {
    Object.assign(state, next);
    onChange();
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      cancelTimer(pollHandle);
      pollHandle = null;
    }
    if (state.polling) patch({ polling: false });
  }

  /* Gepollt wird ausschließlich, solange der Server einen Auftrag meldet — und
     nur bis zur Obergrenze. Höchstens ein Timer ist gleichzeitig offen. */
  function syncPolling(): void {
    const running = state.state === 'queued' || state.state === 'running';
    if (!running || pollAttempts >= pollMaxAttempts) {
      stopPolling();
      return;
    }
    if (pollHandle !== null) return;
    if (!state.polling) patch({ polling: true });
    pollHandle = scheduleTimer(() => {
      pollHandle = null;
      pollAttempts += 1;
      void refresh({ admin: pollAdmin });
    }, pollIntervalMs);
  }

  async function readStatus(admin: boolean): Promise<Response> {
    const response = await fetcher(admin ? AMBIENT_MAP_ADMIN_STATUS_URL : AMBIENT_MAP_STATUS_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    /* Im Hotel Mode ohne Adminsitzung bleibt wenigstens der sanitisierte
       öffentliche Status erreichbar — er trägt Zustand, Radius und Asset. */
    if (admin && (response.status === 401 || response.status === 403)) {
      return await fetcher(AMBIENT_MAP_STATUS_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
    }
    return response;
  }

  async function refresh({ admin = false }: { admin?: boolean } = {}): Promise<void> {
    if (admin) pollAdmin = true;
    const reserved = ++generation;
    let parsed: ReturnType<typeof parseAmbientMapStatus> = null;
    let problem: AmbientMapProblem = 'status_unavailable';
    try {
      const response = await readStatus(admin);
      if (response.ok) parsed = parseAmbientMapStatus(await response.json());
      else if (response.status === 503 && await readProblemCode(response) === UNAVAILABLE_CODE) {
        problem = 'unavailable';
      }
    } catch {
      parsed = null;
    }
    if (reserved !== generation) return;
    if (!parsed) {
      /* Ein fehlgeschlagener Statusabruf lässt Zustand und Asset unangetastet
         (docs/18 §7.1) — es wird nur der Hinweis gesetzt. */
      patch({ problem });
      syncPolling();
      return;
    }
    patch({ ...parsed, loaded: true, problem: null });
    syncPolling();
  }

  async function mutate(url: string, body: unknown): Promise<void> {
    if (state.busy) return;
    const reserved = ++generation;
    stopPolling();
    patch({ busy: true, problem: null });
    let problem: AmbientMapProblem | null = null;
    let queued = false;
    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      /* `202` heißt nur „angenommen". Auf den Renderjob wird nicht gewartet. */
      if (reserved === generation && response.status === 202) {
        queued = true;
      } else if (reserved === generation) {
        const code = await readProblemCode(response);
        if (response.status === 503) {
          problem = code === UNAVAILABLE_CODE ? 'unavailable' : 'home_assistant_unavailable';
        } else if (response.status === 401 || response.status === 403) problem = 'admin_required';
        else problem = 'request_failed';
      }
    } catch {
      problem = 'request_failed';
    }
    /* Veraltet: ein neuerer Stand hat übernommen. Zurückgegeben wird ausschließlich
       `busy` — dieses Flag gehört allein dieser Mutation (die Eingangsschranke
       lässt keine zweite zu), während Zustand, Asset und Hinweis dem neueren
       Stand gehören.
       Ohne diese Rückgabe bliebe die Sektion bis zum Reload gesperrt. */
    if (reserved !== generation) {
      patch({ busy: false });
      return;
    }
    if (queued) {
      pollAttempts = 0;
      patch({ busy: false, problem: null, state: 'queued', loaded: true });
      syncPolling();
      return;
    }
    patch({ busy: false, problem });
  }

  async function useHomeAssistant(): Promise<void> {
    await mutate(AMBIENT_MAP_LOCATION_URL, { source: 'home_assistant' });
  }

  async function selectCoordinates(
    source: 'browser' | 'manual',
    latitude: number,
    longitude: number,
  ): Promise<void> {
    if (!isValidAmbientMapCoordinates(latitude, longitude)) {
      patch({ problem: 'invalid_coordinates' });
      return;
    }
    await mutate(AMBIENT_MAP_LOCATION_URL, { source, latitude, longitude });
  }

  let searchHandle: unknown = null;
  let searchGeneration = 0;

  function clearSearchTimer(): void {
    if (searchHandle !== null) {
      cancelTimer(searchHandle);
      searchHandle = null;
    }
  }

  /* Entprellt: gesucht wird erst, wenn die Eingabe ruht. Jede neue Eingabe
     verwirft die vorherige Anfrage ueber die Generation — eine langsame
     Antwort darf keine neuere Trefferliste ueberschreiben. */
  function search(term: string): void {
    clearSearchTimer();
    const query = term.trim();
    if (query.length < AMBIENT_MAP_SEARCH_MIN_LENGTH) {
      searchGeneration += 1;
      patch({ searchResults: [], searching: false });
      return;
    }
    patch({ searching: true });
    searchHandle = scheduleTimer(() => {
      searchHandle = null;
      void runSearch(query);
    }, searchDebounceMs);
  }

  async function runSearch(query: string): Promise<void> {
    const reserved = ++searchGeneration;
    let results: AmbientMapPlace[] = [];
    let problem: AmbientMapProblem | null = null;
    try {
      const response = await fetcher(
        `/api/admin/ambient-map/search?q=${encodeURIComponent(query)}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (response.ok) results = parseAmbientMapPlaces(await response.json());
      else if (response.status === 429) problem = 'search_rate_limited';
      else if (response.status !== 400) problem = 'search_failed';
    } catch {
      problem = 'search_failed';
    }
    if (reserved !== searchGeneration) return;
    patch({ searchResults: results, searching: false, ...(problem ? { problem } : {}) });
  }

  /** Treffer uebernehmen: derselbe Weg wie eine manuelle Eingabe. */
  async function selectPlace(place: AmbientMapPlace): Promise<void> {
    clearSearchTimer();
    searchGeneration += 1;
    patch({ searchResults: [], searching: false });
    await selectCoordinates('manual', place.latitude, place.longitude);
  }

  async function submitManual(latitude: string, longitude: string): Promise<void> {
    const lat = parseAmbientMapCoordinate(latitude);
    const lon = parseAmbientMapCoordinate(longitude);
    if (lat === null || lon === null) {
      patch({ problem: 'invalid_coordinates' });
      return;
    }
    await selectCoordinates('manual', lat, lon);
  }

  /* Ausschließlich aus einem Button-Tap heraus aufzurufen: eine einmalige
     Abfrage, kein Watcher, kein GPS-Zwang. Jeder Fehlschlag endet hier — es
     folgt keine Mutation und kein stiller Rückfall auf eine andere Quelle. */
  async function locateDevice(): Promise<void> {
    if (state.busy || state.locating) return;
    if (!geolocation) {
      patch({ problem: 'geolocation_unavailable' });
      return;
    }
    if (!secureContext()) {
      patch({ problem: 'geolocation_insecure' });
      return;
    }
    patch({ locating: true, problem: null });
    let position: { latitude: number; longitude: number };
    try {
      position = await new Promise((resolve, reject) => {
        geolocation.getCurrentPosition(
          (result) => resolve({
            latitude: result?.coords?.latitude as number,
            longitude: result?.coords?.longitude as number,
          }),
          reject,
          {
            enableHighAccuracy: false,
            timeout: AMBIENT_MAP_GEOLOCATION_TIMEOUT_MS,
            maximumAge: AMBIENT_MAP_GEOLOCATION_TIMEOUT_MS,
          },
        );
      });
    } catch (reason) {
      patch({ locating: false, problem: geolocationProblem(reason) });
      return;
    }
    patch({ locating: false });
    await selectCoordinates('browser', position.latitude, position.longitude);
  }

  async function regenerate(): Promise<void> {
    await mutate(AMBIENT_MAP_REGENERATE_URL, {});
  }

  return {
    state,
    refresh,
    useHomeAssistant,
    locateDevice,
    submitManual,
    search,
    selectPlace,
    regenerate,
    stop: () => { clearSearchTimer(); stopPolling(); },
    /** Nur für Tests: verbleibende Pollversuche dieses Auftrags. */
    pollAttemptsLeft: () => Math.max(0, pollMaxAttempts - pollAttempts),
  };
}

export type AmbientMapClient = ReturnType<typeof createAmbientMapClient>;
