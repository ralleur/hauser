/* Hotel Mode: Datenspeicher, Adminzugang, Aufenthalte, Gastzustand, Kommandos, Checkout und Session-Routen.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  ALLOWED_ORIGINS,
  CONFIG_PATH,
  HA_CONNECTION_MODE,
  HOTEL_ADMIN_ATTEMPTS_PER_BLOCK,
  HOTEL_ADMIN_BLOCK_BASE_MS,
  HOTEL_ADMIN_BLOCK_MAX_MS,
  HOTEL_ADMIN_BODY_MAX,
  HOTEL_ADMIN_PIN_PATTERN,
  HOTEL_ADMIN_SCRYPT,
  HOTEL_ADMIN_SESSION_MS,
  HOTEL_CALENDAR_BODY_MAX,
  HOTEL_CALENDAR_CACHE_MS,
  HOTEL_CALENDAR_LOOKAHEAD_MS,
  HOTEL_CALENDAR_LOOKBEHIND_MS,
  HOTEL_CALENDAR_TIMEOUT_MS,
  HOTEL_COMMAND_TIMEOUT_MS,
  HOTEL_MODE_CACHE_MAX_STAYS,
  HOTEL_MODE_DATA_PATH,
  HOTEL_MODE_DATA_VERSION,
  HOTEL_OVERRIDE_LEAD_MS,
  HOTEL_OVERRIDE_MAX_MS,
  HOTEL_SETTINGS_BODY_MAX,
  HOTEL_STATE_BODY_MAX,
  HOTEL_STATE_CACHE_MS,
  HOTEL_STATE_MAX_ENTITIES,
  HOTEL_STATE_TIMEOUT_MS,
  HOUSEHOLD_CONFIG_PATH,
  findOverlappingStays,
  guestVisibleEntityIds,
  parseHouseholdConfig,
  projectGuestAccess,
  projectGuestEntityState,
  projectStays,
  resolveGuestServiceCall,
  selectStayStatus,
} from './runtime-env.mjs';
import { flushDirectory, jsonResponse, requestOriginAllowed } from './shared.mjs';
import { createHouseholdConfigReader, readRoomImageHouseholdSnapshot, writeRoomImageHousehold } from './config-core.mjs';
import { haRestUrl, resolveServerHaAccess } from './setup.mjs';

/**
 * Private hotel-mode state next to the shared config. The document only holds
 * what the running apartment needs: the versioned admin PIN verifier, one
 * manual stay override, the current checkout marker and a short calendar cache.
 * A damaged or foreign document degrades to the empty default so the server
 * still starts; recovery then happens through local volume access.
 */
export function resolveHotelModeDataPath(configPath = CONFIG_PATH) {
  return HOTEL_MODE_DATA_PATH || join(dirname(configPath), 'hotel-mode.json');
}

function hotelHex(value, bytes) {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value) ? value : null;
}

function hotelPositiveInt(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeHotelAdminPin(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.algorithm !== 'scrypt') return null;
  const salt = hotelHex(raw.salt, 16);
  const version = hotelPositiveInt(raw.version);
  const updatedAt = hotelPositiveInt(raw.updatedAt);
  const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params) ? raw.params : null;
  const keylen = params ? hotelPositiveInt(params.keylen) : null;
  const N = params ? hotelPositiveInt(params.N) : null;
  const r = params ? hotelPositiveInt(params.r) : null;
  const p = params ? hotelPositiveInt(params.p) : null;
  if (!salt || !version || !updatedAt || !keylen || !N || !r || !p) return null;
  const hash = hotelHex(raw.hash, keylen);
  if (!hash) return null;
  return { version, algorithm: 'scrypt', salt, hash, params: { N, r, p, keylen }, updatedAt };
}

function normalizeHotelOverride(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : null;
  const startsAt = hotelPositiveInt(raw.startsAt);
  const endsAt = hotelPositiveInt(raw.endsAt);
  const createdAt = hotelPositiveInt(raw.createdAt);
  if (!id || !startsAt || !endsAt || !createdAt || endsAt <= startsAt) return null;
  return { id, startsAt, endsAt, createdAt };
}

const HOTEL_CHECKOUT_NOTICE_CODES = new Set([
  'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED',
  'HOTEL_EVENT_UNREACHABLE',
  'HOTEL_EVENT_AUTH_FAILED',
  'HOTEL_EVENT_HTTP_ERROR',
  'HOTEL_COMMAND_UNREACHABLE',
  'HOTEL_COMMAND_AUTH_FAILED',
  'HOTEL_COMMAND_HTTP_ERROR',
]);

function hotelCheckoutNoticeCode(raw) {
  return typeof raw === 'string' && HOTEL_CHECKOUT_NOTICE_CODES.has(raw) ? raw : null;
}

function normalizeHotelCheckout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const stayId = typeof raw.stayId === 'string' && raw.stayId.length > 0 && raw.stayId.length <= 128 ? raw.stayId : null;
  const checkedOutAt = hotelPositiveInt(raw.checkedOutAt);
  if (!stayId || !checkedOutAt) return null;
  // Was nach der Markierung schiefging, sieht ausschließlich der Admin.
  const notice = raw.notice && typeof raw.notice === 'object' && !Array.isArray(raw.notice)
    ? { event: hotelCheckoutNoticeCode(raw.notice.event), scene: hotelCheckoutNoticeCode(raw.notice.scene) }
    : null;
  return {
    stayId,
    checkedOutAt,
    ...(notice && (notice.event || notice.scene) ? { notice } : {}),
  };
}

function normalizeHotelCachedStay(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const uid = typeof raw.uid === 'string' && raw.uid.length > 0 && raw.uid.length <= 128 ? raw.uid : null;
  const checkIn = hotelPositiveInt(raw.checkIn);
  const checkOut = hotelPositiveInt(raw.checkOut);
  if (!uid || !checkIn || !checkOut || checkOut <= checkIn) return null;
  return {
    uid,
    allDay: raw.allDay === true,
    checkIn,
    checkOut,
    guestName: typeof raw.guestName === 'string' ? raw.guestName.slice(0, 200) : null,
    welcomeMessage: typeof raw.welcomeMessage === 'string' ? raw.welcomeMessage.slice(0, 2000) : null,
  };
}

function normalizeHotelCalendarCache(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fetchedAt = hotelPositiveInt(raw.fetchedAt);
  const validUntil = hotelPositiveInt(raw.validUntil);
  if (!fetchedAt || !validUntil || !Array.isArray(raw.stays)) return null;
  const stays = raw.stays.slice(0, HOTEL_MODE_CACHE_MAX_STAYS).map(normalizeHotelCachedStay).filter(Boolean);
  return { fetchedAt, validUntil, stays };
}

export function normalizeHotelModeDocument(raw) {
  const root = raw && typeof raw === 'object' && !Array.isArray(raw) && raw.version === HOTEL_MODE_DATA_VERSION ? raw : {};
  return {
    version: HOTEL_MODE_DATA_VERSION,
    adminPin: normalizeHotelAdminPin(root.adminPin),
    manualOverride: normalizeHotelOverride(root.manualOverride),
    checkout: normalizeHotelCheckout(root.checkout),
    calendarCache: normalizeHotelCalendarCache(root.calendarCache),
  };
}

export function createHotelModeStore(path = resolveHotelModeDataPath()) {
  let cached = null;

  function read() {
    if (cached) return cached;
    let raw = null;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch { /* missing or damaged private state degrades to the empty default */ }
    cached = normalizeHotelModeDocument(raw);
    return cached;
  }

  function write(document) {
    const normalized = normalizeHotelModeDocument(document);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flush: true });
      chmodSync(temporary, 0o600);
      renameSync(temporary, path);
      chmodSync(path, 0o600);
      flushDirectory(dirname(path));
    } finally {
      try { unlinkSync(temporary); } catch { /* the rename already consumed the temporary file */ }
    }
    cached = normalized;
    return normalized;
  }

  function update(mutator) {
    return write({ ...read(), ...mutator(read()) });
  }

  return { path, read, update, write };
}

function hotelPinVerifier(pin, now) {
  const salt = randomBytes(16);
  const params = { ...HOTEL_ADMIN_SCRYPT };
  const hash = scryptSync(pin, salt, params.keylen, { N: params.N, r: params.r, p: params.p });
  return {
    version: HOTEL_MODE_DATA_VERSION,
    algorithm: 'scrypt',
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    params,
    updatedAt: now,
  };
}

function hotelPinMatches(verifier, candidate) {
  if (!verifier || typeof candidate !== 'string' || candidate.length === 0) return false;
  let derived;
  try {
    derived = scryptSync(candidate, Buffer.from(verifier.salt, 'hex'), verifier.params.keylen, {
      N: verifier.params.N, r: verifier.params.r, p: verifier.params.p,
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(verifier.hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Server-side admin boundary for hotel mode. The PIN never leaves the private
 * store, sessions live in memory only, and just an explicit admin action or a
 * touch keeps a session alive — polling and background traffic do not.
 */
export function createHotelModeAdminAccess(
  store,
  { now = () => Date.now(), sessionMs = HOTEL_ADMIN_SESSION_MS } = {},
) {
  const sessions = new Map();
  const attempts = new Map();

  function verifier() { return store.read().adminPin; }
  function configured() { return verifier() !== null; }

  function cookieToken(req) {
    const match = String(req?.headers?.cookie || '').match(/(?:^|;\s*)hmi_hotel_admin=([a-f0-9]{64})(?:;|$)/);
    return match?.[1] || '';
  }

  function sessionExpiry(req) {
    const token = cookieToken(req);
    if (!token) return 0;
    const expiry = sessions.get(token) || 0;
    if (expiry <= now()) {
      if (expiry) sessions.delete(token);
      return 0;
    }
    return expiry;
  }

  /** Read-only check; polling the session status must not extend the timeout. */
  function inspect(req) { return sessionExpiry(req) > 0; }

  /** Gate for real admin work; a successful admin request resets the idle timer. */
  function authorize(req) {
    const token = cookieToken(req);
    if (sessionExpiry(req) === 0) return false;
    sessions.set(token, now() + sessionMs);
    return true;
  }

  function touch(req) { return authorize(req); }

  function status(req) {
    const expiresAt = sessionExpiry(req);
    return { configured: configured(), unlocked: expiresAt > 0, expiresAt: expiresAt || null };
  }

  function blockState(key) {
    return attempts.get(key) || { failures: 0, blocks: 0, blockedUntil: 0 };
  }

  function unlock(candidate, remoteAddress = '') {
    if (!configured()) return { ok: false, configured: false };
    const key = remoteAddress || 'unknown';
    const attempt = blockState(key);
    if (attempt.blockedUntil > now()) {
      return { ok: false, configured: true, limited: true, retryAfterMs: attempt.blockedUntil - now() };
    }
    if (!hotelPinMatches(verifier(), typeof candidate === 'string' ? candidate : '')) {
      attempt.failures += 1;
      if (attempt.failures >= HOTEL_ADMIN_ATTEMPTS_PER_BLOCK) {
        attempt.failures = 0;
        attempt.blocks += 1;
        attempt.blockedUntil = now() + Math.min(
          HOTEL_ADMIN_BLOCK_BASE_MS * 2 ** (attempt.blocks - 1),
          HOTEL_ADMIN_BLOCK_MAX_MS,
        );
      }
      attempts.set(key, attempt);
      const limited = attempt.blockedUntil > now();
      return { ok: false, configured: true, limited, retryAfterMs: limited ? attempt.blockedUntil - now() : 0 };
    }
    attempts.delete(key);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now() + sessionMs;
    sessions.set(token, expiresAt);
    return { ok: true, configured: true, session: token, expiresAt };
  }

  function lock(req) {
    const token = cookieToken(req);
    if (token) sessions.delete(token);
  }

  /**
   * Sets the first PIN or replaces an existing one. Changing an existing PIN
   * always requires the current PIN, never just an unlocked session.
   */
  function setPin({ pin, currentPin } = {}) {
    if (typeof pin !== 'string' || !HOTEL_ADMIN_PIN_PATTERN.test(pin)) {
      return { ok: false, code: 'HOTEL_PIN_INVALID' };
    }
    const current = verifier();
    if (current && !hotelPinMatches(current, typeof currentPin === 'string' ? currentPin : '')) {
      return { ok: false, code: 'HOTEL_PIN_CURRENT_MISMATCH' };
    }
    store.update(() => ({ adminPin: hotelPinVerifier(pin, now()) }));
    sessions.clear();
    attempts.clear();
    return { ok: true };
  }

  return { authorize, configured, cookieToken, inspect, lock, sessionMs, setPin, status, touch, unlock };
}

export function hotelAdminCookie(req, value, maxAge) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.socket?.encrypted || forwarded === 'https' ? '; Secure' : '';
  return `hmi_hotel_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function hotelModeRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'POST', 'PUT', 'DELETE'].includes(req.method || '')
    && requestOriginAllowed(req, allowedOrigins);
}

function readHotelJson(req, res, callback, maxBytes = HOTEL_ADMIN_BODY_MAX) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) oversized = true;
  });
  req.on('end', () => {
    if (oversized) return jsonResponse(res, 413, { code: 'HOTEL_BODY_TOO_LARGE', message: 'Anfrage zu groß.' });
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    callback(payload);
  });
}

/**
 * Calendar-driven stay resolution. The Home Assistant credentials stay on the
 * server, so a guest client never learns who booked: the public status carries
 * only the running stay's own window and welcome message, while guest names,
 * upcoming arrivals and calendar diagnostics stay behind the admin session.
 */
function hotelCalendarBoundary(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.dateTime === 'string') return value.dateTime;
    if (typeof value.date === 'string') return value.date;
  }
  // An unusable boundary stays unusable on purpose: the pure projection then
  // reports it as an issue instead of the event silently disappearing.
  return '';
}

function hotelCalendarText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : null;
}

/**
 * Opaque but stable identity of one calendar occurrence. Hashing keeps raw
 * Home Assistant UIDs out of every response and lets the checkout marker expire
 * by itself as soon as the booked window changes.
 */
function hotelCalendarUid(event, start, end, index) {
  const explicit = [event.uid, event.recurrence_id]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join('|');
  const seed = explicit || `${hotelCalendarText(event.summary, 200) ?? ''}|${index}`;
  return createHash('sha256').update(`${seed}|${start}|${end}`).digest('hex').slice(0, 32);
}

export function normalizeHotelCalendarEvents(payload) {
  return payload.map((raw, index) => {
    const event = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const start = hotelCalendarBoundary(event.start);
    const end = hotelCalendarBoundary(event.end);
    return {
      uid: hotelCalendarUid(event, start, end, index),
      summary: hotelCalendarText(event.summary, 200),
      description: hotelCalendarText(event.description, 2000),
      start,
      end,
    };
  });
}

/** Read-only Home Assistant calendar access; hotel mode needs nothing else from REST. */
export function createHotelCalendarClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = HOTEL_CALENDAR_TIMEOUT_MS,
} = {}) {
  async function events(entityId, fromMs, toMs) {
    const url = haRestUrl(baseUrl, `api/calendars/${encodeURIComponent(entityId)}`);
    url.searchParams.set('start', new Date(fromMs).toISOString());
    url.searchParams.set('end', new Date(toMs).toISOString());
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'HOTEL_CALENDAR_AUTH_FAILED' };
    if (response.status === 404) return { ok: false, code: 'HOTEL_CALENDAR_NOT_FOUND' };
    if (response.status !== 200) return { ok: false, code: 'HOTEL_CALENDAR_HTTP_ERROR' };
    let text;
    try { text = await response.text(); } catch { return { ok: false, code: 'HOTEL_CALENDAR_UNREACHABLE' }; }
    if (Buffer.byteLength(text) > HOTEL_CALENDAR_BODY_MAX) return { ok: false, code: 'HOTEL_CALENDAR_INVALID_RESPONSE' };
    let payload;
    try { payload = JSON.parse(text); } catch { return { ok: false, code: 'HOTEL_CALENDAR_INVALID_RESPONSE' }; }
    // Truncating a long calendar could hide an overlap, so too many events are
    // rejected outright instead of being cut down to the cache limit.
    if (!Array.isArray(payload) || payload.length > HOTEL_MODE_CACHE_MAX_STAYS) {
      return { ok: false, code: 'HOTEL_CALENDAR_INVALID_RESPONSE' };
    }
    return { ok: true, events: normalizeHotelCalendarEvents(payload) };
  }
  return { events };
}

/** Hotel policy straight from the household contract; anything unreadable disables the mode. */
export function readHotelModePolicy(path) {
  const result = createHouseholdConfigReader(path).read();
  if (!result.ok) return null;
  let document;
  try { document = JSON.parse(result.body); } catch { return null; }
  const parsed = parseHouseholdConfig(document);
  return parsed.ok && parsed.value.hotelMode ? parsed.value.hotelMode : null;
}

function hotelOverrideStay(override) {
  return {
    uid: override.id,
    allDay: false,
    checkIn: override.startsAt,
    checkOut: override.endsAt,
    guestName: null,
    welcomeMessage: null,
  };
}

function hotelAdminStay(stay) {
  return {
    id: stay.uid,
    allDay: stay.allDay,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    guestName: stay.guestName,
    welcomeMessage: stay.welcomeMessage,
  };
}

export function createHotelModeStayService({
  store,
  configStore = null,
  connectionMode = HA_CONNECTION_MODE,
  householdConfigPath = HOUSEHOLD_CONFIG_PATH,
  now = () => Date.now(),
  calendarClientFactory = createHotelCalendarClient,
  cacheMs = HOTEL_CALENDAR_CACHE_MS,
  policyReader = () => readHotelModePolicy(householdConfigPath),
} = {}) {
  let inFlight = null;

  function credentials() {
    return resolveServerHaAccess(configStore, connectionMode);
  }

  /**
   * A cached projection may keep a running stay alive but must never open the
   * next one, so it expires at the earliest interesting boundary.
   */
  function cacheValidUntil(fetchedAt, stays) {
    let until = fetchedAt + cacheMs;
    for (const stay of stays) {
      if (stay.checkIn <= fetchedAt && stay.checkOut > fetchedAt) until = Math.min(until, stay.checkOut);
      else if (stay.checkIn > fetchedAt) until = Math.min(until, stay.checkIn);
    }
    return Math.max(until, fetchedAt + 1);
  }

  async function calendarProjection(policy, nowMs) {
    const cached = store.read().calendarCache;
    const fromCache = (code) => ({
      stays: cached.stays,
      issues: [],
      // Cached stays may only continue, never start: everything that began
      // after the last successful fetch stays inactive until a fresh read.
      activeSince: cached.fetchedAt,
      fetchedAt: cached.fetchedAt,
      error: code,
      source: 'cache',
    });
    if (cached && nowMs < cached.validUntil) return fromCache(null);
    const failure = (code) => (cached
      ? fromCache(code)
      : { stays: [], issues: [], activeSince: 0, fetchedAt: null, error: code, source: 'none' });

    if (policy.calendar.entityId === '') return failure('HOTEL_CALENDAR_NOT_CONFIGURED');
    const access = credentials();
    if (!access) return failure('HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');

    const result = await calendarClientFactory(access).events(
      policy.calendar.entityId,
      nowMs - HOTEL_CALENDAR_LOOKBEHIND_MS,
      nowMs + HOTEL_CALENDAR_LOOKAHEAD_MS,
    );
    if (!result.ok) return failure(result.code);

    const projection = projectStays(result.events, policy.calendar);
    if (projection.issues.length > 0 || findOverlappingStays(projection.stays).length > 0) {
      // A broken calendar must not remain reusable, so the cache is dropped
      // rather than refreshed with a projection nobody may act on. Writing only
      // once keeps a permanently broken calendar from rewriting the store on
      // every status poll.
      if (cached) store.update(() => ({ calendarCache: null }));
      return { ...projection, activeSince: nowMs, fetchedAt: nowMs, error: null, source: 'calendar' };
    }
    store.update(() => ({
      calendarCache: {
        fetchedAt: nowMs,
        validUntil: cacheValidUntil(nowMs, projection.stays),
        stays: projection.stays,
      },
    }));
    return { stays: projection.stays, issues: [], activeSince: nowMs, fetchedAt: nowMs, error: null, source: 'calendar' };
  }

  const disabledState = {
    enabled: false,
    status: 'inactive',
    checkoutEnabled: false,
    source: 'disabled',
    stay: null,
    nextStay: null,
    issues: [],
    calendar: null,
    override: null,
    checkout: null,
  };

  async function resolveOnce() {
    const policy = policyReader();
    if (!policy || !policy.enabled) return disabledState;

    const nowMs = now();
    const document = store.read();
    const override = document.manualOverride && document.manualOverride.endsAt > nowMs
      ? document.manualOverride
      : null;
    const projection = await calendarProjection(policy, nowMs);
    const selection = selectStayStatus(
      { stays: projection.stays, issues: projection.issues },
      nowMs,
      { activeSince: projection.activeSince },
    );

    let status = 'inactive';
    let stay = null;
    let source = projection.source;
    if (override && nowMs >= override.startsAt) {
      // The override exists precisely for early arrivals, extensions and broken
      // calendars, so it also wins over a calendar conflict.
      status = 'active';
      stay = hotelOverrideStay(override);
      source = 'override';
    } else if (selection.status === 'active') {
      status = 'active';
      stay = selection.stay;
    }
    if (status === 'active' && document.checkout && document.checkout.stayId === stay.uid) {
      status = 'inactive';
      stay = null;
      source = 'checkout';
    }

    return {
      enabled: true,
      status,
      checkoutEnabled: policy.checkout.enabled,
      source,
      stay,
      nextStay: selection.status === 'inactive' ? selection.nextStay : null,
      issues: selection.status === 'conflict' ? selection.issues : [],
      calendar: {
        entityId: policy.calendar.entityId,
        timeZone: policy.calendar.timeZone,
        fetchedAt: projection.fetchedAt,
        error: projection.error,
      },
      override,
      checkout: document.checkout,
    };
  }

  /** Parallel status polls share one calendar read instead of hammering Home Assistant. */
  function resolve() {
    if (!inFlight) inFlight = resolveOnce().finally(() => { inFlight = null; });
    return inFlight;
  }

  /** Guest-visible truth: no name, no next arrival, no diagnostics. */
  function publicStatus(state) {
    return {
      enabled: state.enabled,
      status: state.status,
      // Ob der Checkout überhaupt angeboten wird, ist Bedienführung, kein
      // Gastdatum — die Markierung selbst und jede Diagnose bleiben im Admin.
      checkoutEnabled: state.checkoutEnabled === true,
      stay: state.stay
        ? {
          id: state.stay.uid,
          checkIn: state.stay.checkIn,
          checkOut: state.stay.checkOut,
          welcomeMessage: state.stay.welcomeMessage,
        }
        : null,
    };
  }

  function adminStatus(state) {
    return {
      enabled: state.enabled,
      status: state.status,
      source: state.source,
      stay: state.stay ? hotelAdminStay(state.stay) : null,
      nextStay: state.nextStay ? hotelAdminStay(state.nextStay) : null,
      issues: state.issues,
      calendar: state.calendar,
      override: state.override,
      checkout: state.checkout,
    };
  }

  function setOverride({ startsAt, endsAt } = {}) {
    const nowMs = now();
    const start = Number.isSafeInteger(startsAt) && startsAt > 0 ? startsAt : nowMs;
    if (!Number.isSafeInteger(endsAt)
        || endsAt <= start
        || endsAt <= nowMs
        || endsAt - start > HOTEL_OVERRIDE_MAX_MS
        || start - nowMs > HOTEL_OVERRIDE_LEAD_MS) {
      return { ok: false, code: 'HOTEL_OVERRIDE_INVALID' };
    }
    const manualOverride = {
      id: `override-${randomBytes(12).toString('hex')}`,
      startsAt: start,
      endsAt,
      createdAt: nowMs,
    };
    store.update(() => ({ manualOverride }));
    return { ok: true, override: manualOverride };
  }

  function clearOverride() {
    store.update(() => ({ manualOverride: null }));
    return { ok: true, override: null };
  }

  return { adminStatus, clearOverride, publicStatus, resolve, setOverride };
}

/**
 * Read-only Home Assistant state access for the guest projection. Every allowed
 * entity is read on its own: a guest request never pulls the whole state
 * machine, so an entity outside the allowlist never even reaches this process.
 */
export function createHotelStatesClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = HOTEL_STATE_TIMEOUT_MS,
} = {}) {
  async function state(entityId) {
    const url = haRestUrl(baseUrl, `api/states/${encodeURIComponent(entityId)}`);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, code: 'HOTEL_STATES_UNREACHABLE' };
    }
    // A freed entity that no longer exists is not an error: the guest simply
    // does not see it, which stays inside the configured allowlist.
    if (response.status === 404) return { ok: true, entity: null };
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'HOTEL_STATES_AUTH_FAILED' };
    if (response.status !== 200) return { ok: false, code: 'HOTEL_STATES_HTTP_ERROR' };
    let text;
    try { text = await response.text(); } catch { return { ok: false, code: 'HOTEL_STATES_UNREACHABLE' }; }
    if (Buffer.byteLength(text) > HOTEL_STATE_BODY_MAX) return { ok: false, code: 'HOTEL_STATES_INVALID_RESPONSE' };
    let payload;
    try { payload = JSON.parse(text); } catch { return { ok: false, code: 'HOTEL_STATES_INVALID_RESPONSE' }; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.state !== 'string') {
      return { ok: false, code: 'HOTEL_STATES_INVALID_RESPONSE' };
    }
    // Answering with a different entity would smuggle an unreleased device into
    // the guest projection, so it counts as an invalid response.
    if (typeof payload.entity_id === 'string' && payload.entity_id !== entityId) {
      return { ok: false, code: 'HOTEL_STATES_INVALID_RESPONSE' };
    }
    return {
      ok: true,
      entity: {
        state: payload.state,
        attributes: payload.attributes && typeof payload.attributes === 'object' && !Array.isArray(payload.attributes)
          ? payload.attributes
          : {},
      },
    };
  }
  return { state };
}

/**
 * The guest-visible half of hotel mode: only a running stay yields control data
 * at all, and even then the projection carries nothing but the released rooms,
 * entities and the attributes Hauser's own controls read. Home Assistant
 * credentials never leave this service.
 */
export function createHotelGuestStateService({
  stays,
  configStore = null,
  connectionMode = HA_CONNECTION_MODE,
  householdConfigPath = HOUSEHOLD_CONFIG_PATH,
  now = () => Date.now(),
  statesClientFactory = createHotelStatesClient,
  cacheMs = HOTEL_STATE_CACHE_MS,
  policyReader = () => readHotelModePolicy(householdConfigPath),
} = {}) {
  let cache = null;
  let inFlight = null;

  function credentials() {
    return resolveServerHaAccess(configStore, connectionMode);
  }

  function neutral(enabled) {
    // Inactive, checkout, calendar conflict and a missing policy all end here:
    // no rooms, no entities, nothing a guest could act on.
    cache = null;
    return { enabled, status: 'inactive', rooms: [], scenes: [], scripts: [], entities: [], fetchedAt: null, error: null };
  }

  async function readOnce() {
    const stayState = await stays.resolve();
    if (!stayState.enabled || stayState.status !== 'active') return neutral(stayState.enabled === true);

    const policy = policyReader();
    if (!policy || !policy.enabled) return neutral(false);
    const guestAccess = projectGuestAccess(policy);
    const base = {
      enabled: true,
      status: 'active',
      rooms: guestAccess.rooms,
      scenes: guestAccess.scenes,
      scripts: guestAccess.scripts,
    };
    const entityIds = guestVisibleEntityIds(policy).slice(0, HOTEL_STATE_MAX_ENTITIES);
    if (entityIds.length === 0) return { ...base, entities: [], fetchedAt: null, error: null };

    const nowMs = now();
    if (cache && nowMs - cache.fetchedAt < cacheMs) {
      return { ...base, entities: cache.entities, fetchedAt: cache.fetchedAt, error: null };
    }
    const haAccess = credentials();
    if (!haAccess) return { ...base, entities: [], fetchedAt: null, error: 'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED' };

    const client = statesClientFactory(haAccess);
    const results = await Promise.all(entityIds.map((entityId) => client.state(entityId)));
    const entities = [];
    let error = null;
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (!result.ok) {
        error = error ?? result.code;
        continue;
      }
      if (!result.entity) continue;
      const projected = projectGuestEntityState(entityIds[index], result.entity);
      if (projected) entities.push(projected);
    }
    // A partial read must not become the new truth, otherwise a single failing
    // entity would silently disappear from the panel.
    if (error === null) {
      cache = { fetchedAt: nowMs, entities };
      return { ...base, entities, fetchedAt: nowMs, error: null };
    }
    if (cache) return { ...base, entities: cache.entities, fetchedAt: cache.fetchedAt, error };
    return { ...base, entities, fetchedAt: null, error };
  }

  /** Parallel guest polls share one Home Assistant read. */
  function read() {
    if (!inFlight) inFlight = readOnce().finally(() => { inFlight = null; });
    return inFlight;
  }

  /**
   * Nach einem akzeptierten Gastbefehl darf der nächste Abruf nicht mehr aus
   * dem kurzen Sammelcache kommen: sonst widerspräche der veraltete Wert dem
   * gerade gesetzten und das Control spränge grundlos zurück.
   */
  function invalidate() {
    cache = null;
  }

  return { invalidate, read };
}

/**
 * Write access to Home Assistant for guests, deliberately narrow: exactly one
 * service call per accepted intent, with the credentials staying on this side.
 * There is no generic `call_service` forwarding and no retry — an unanswered
 * command stays failed instead of firing again later.
 */
export function createHotelCommandClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = HOTEL_COMMAND_TIMEOUT_MS,
} = {}) {
  async function call(domain, service, entityId, data) {
    const url = haRestUrl(
      baseUrl,
      `api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
    );
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ entity_id: entityId, ...data }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, code: 'HOTEL_COMMAND_UNREACHABLE' };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'HOTEL_COMMAND_AUTH_FAILED' };
    if (response.status < 200 || response.status >= 300) return { ok: false, code: 'HOTEL_COMMAND_HTTP_ERROR' };
    return { ok: true };
  }
  return { call };
}

/**
 * The guest write path. A command only exists while a stay is really running,
 * and even then entity, action and payload are rebuilt from the v4 allowlist
 * before Home Assistant sees anything. A rejected or unreachable command is
 * reported as a failure — never as a silent success.
 */
export function createHotelCommandService({
  stays,
  guests = null,
  configStore = null,
  connectionMode = HA_CONNECTION_MODE,
  householdConfigPath = HOUSEHOLD_CONFIG_PATH,
  commandClientFactory = createHotelCommandClient,
  policyReader = () => readHotelModePolicy(householdConfigPath),
} = {}) {
  function credentials() {
    return resolveServerHaAccess(configStore, connectionMode);
  }

  async function execute(request) {
    const stayState = await stays.resolve();
    if (!stayState.enabled || stayState.status !== 'active') {
      return { ok: false, status: 403, code: 'HOTEL_STAY_INACTIVE' };
    }

    const policy = policyReader();
    const decision = resolveGuestServiceCall(policy || undefined, request);
    if (!decision.allowed) return { ok: false, status: 403, code: `HOTEL_COMMAND_${decision.reason}` };

    const access = credentials();
    if (!access) return { ok: false, status: 503, code: 'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED' };

    const { domain, service, entityId, data } = decision.call;
    const result = await commandClientFactory(access).call(domain, service, entityId, data);
    if (!result.ok) return { ok: false, status: 502, code: result.code };
    // Home Assistant has applied the call by now, so the next guest poll should
    // read the real new state instead of the cached one from before.
    guests?.invalidate?.();
    return { ok: true };
  }

  return { execute };
}

const HOTEL_COMMAND_MESSAGES = {
  HOTEL_STAY_INACTIVE: 'Ohne laufenden Aufenthalt sind keine Befehle möglich.',
  HOTEL_COMMAND_DISABLED: 'Hotel Mode ist nicht aktiv.',
  HOTEL_COMMAND_ENTITY_NOT_ALLOWED: 'Dieses Gerät ist nicht freigegeben.',
  HOTEL_COMMAND_ACTION_NOT_ALLOWED: 'Diese Aktion ist nicht freigegeben.',
  HOTEL_COMMAND_VALUE_NOT_ALLOWED: 'Dieser Wert ist nicht freigegeben.',
  HOTEL_HOME_ASSISTANT_NOT_CONFIGURED: 'Home Assistant ist nicht eingerichtet.',
};

function hotelCommandMessage(code) {
  return HOTEL_COMMAND_MESSAGES[code] || 'Der Befehl konnte nicht ausgeführt werden.';
}

/**
 * Sensitive Routen hinter der Adminsitzung, sobald Hotel Mode eingerichtet ist.
 * Ein Gast bekommt weder Credentials noch Einstellungen, Ablage, Wartung,
 * Setup, Upload oder AI — auch nicht durch direkten Aufruf am Panel vorbei.
 * Ausdrücklich nicht gelistet: Health, Build-Info, der Lizenztext und die
 * Haushaltsstruktur, die die Gastoberfläche selbst zum Rendern braucht.
 */
const HOTEL_ADMIN_ONLY_PREFIXES = [
  '/api/config',
  '/api/setup',
  '/api/ha/caldav-flow',
  '/api/room-images',
  '/api/room-image-assets',
  '/api/ablage',
  '/api/laundry',
  '/api/notifications',
  '/api/reminders',
  '/api/songs',
  '/api/shopping/notion',
  '/api/shopping/ha-list',
  '/hermes',
  '/ambient-llm',
  '/shopping-llm',
  /* AMBIENT-MAP S3: Standortwahl und Kartenerzeugung sind Adminsache. Der
     öffentliche Lesepfad `/api/ambient-map` und das Asset bleiben bewusst
     ungelistet — der Gast sieht den Ambient-Screen, aber keine Koordinaten. */
  '/api/admin/ambient-map',
];

export function hotelAdminOnlyRoute(url) {
  const pathname = new URL(url || '/', 'http://hmi.local').pathname;
  return HOTEL_ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Ob Hotel Mode überhaupt eingerichtet ist, entscheidet jede Anfrage neu — aber
 * ohne die Haushaltskonfiguration jedes Mal zu parsen: Änderungszeit und Größe
 * der Datei reichen als Schlüssel.
 */
export function createHotelModeAdminGate(householdConfigPath, {
  access,
  policyReader = readHotelModePolicy,
} = {}) {
  let cachedKey = null;
  let cachedEnabled = false;

  function enabled() {
    let key;
    try {
      const metadata = statSync(householdConfigPath);
      key = `${metadata.mtimeMs}:${metadata.size}`;
    } catch {
      key = 'missing';
    }
    if (key !== cachedKey) {
      cachedKey = key;
      cachedEnabled = policyReader(householdConfigPath)?.enabled === true;
    }
    return cachedEnabled;
  }

  function blocked(req) {
    if (!hotelAdminOnlyRoute(req.url)) return false;
    if (!enabled()) return false;
    // Ein echter Adminrequest verlängert die Sitzung; genau dafür ist sie da.
    return !access.authorize(req);
  }

  return { blocked, enabled };
}

/**
 * Betriebs- und Aufenthaltseinstellungen aus der Admin-GUI. Geschrieben wird
 * über denselben ETag-/atomaren Household-Mutationspfad wie Raumbilder und
 * Wäsche: gelesen, verglichen, geprüft, atomar ersetzt. Ein Entwurf, den der
 * v4-Parser ablehnt, erreicht die Datei nie.
 */
export function createHotelModeSettingsService({
  householdConfigPath = HOUSEHOLD_CONFIG_PATH,
  configMutations,
  publishStep = () => undefined,
  latchSetupRecoveryFailure = () => undefined,
  assertSetupRecoveryHealthy = () => undefined,
  preflight = null,
} = {}) {
  const activationReady = preflight !== null;
  function snapshot() {
    return readRoomImageHouseholdSnapshot(householdConfigPath);
  }

  function read() {
    try {
      const current = snapshot();
      return {
        ok: true,
        etag: current.etag,
        hotelMode: current.document.hotelMode ?? null,
        activationReady,
      };
    } catch {
      return { ok: false, status: 503, code: 'HOTEL_SETTINGS_UNAVAILABLE' };
    }
  }

  async function save({ etag, hotelMode } = {}) {
    if (typeof etag !== 'string' || etag === '') {
      return { ok: false, status: 428, code: 'HOTEL_SETTINGS_PRECONDITION_REQUIRED' };
    }
    const removing = hotelMode === null;
    if (!removing && (!hotelMode || typeof hotelMode !== 'object' || Array.isArray(hotelMode))) {
      return { ok: false, status: 400, code: 'HOTEL_SETTINGS_INVALID' };
    }
    // Nie halb aktivieren: der Preflight prüft Kiosk, PIN, Freigabe, Gerätepfad
    // und Kalender mit echten Abrufen, bevor `enabled` wahr werden darf.
    if (!removing && hotelMode.enabled === true) {
      if (!preflight) return { ok: false, status: 409, code: 'HOTEL_ACTIVATION_LOCKED' };
      const result = await preflight.inspect(hotelMode);
      if (!result.ok) {
        return { ok: false, status: 409, code: 'HOTEL_ACTIVATION_BLOCKED', checks: result.checks };
      }
    }

    return configMutations.run(() => {
      let current;
      try { current = snapshot(); } catch { return { ok: false, status: 503, code: 'HOTEL_SETTINGS_UNAVAILABLE' }; }
      if (current.etag !== etag) return { ok: false, status: 412, code: 'HOTEL_SETTINGS_STALE' };

      const next = { ...current.document };
      if (removing) delete next.hotelMode;
      else next.hotelMode = hotelMode;

      const parsed = parseHouseholdConfig(next);
      if (!parsed.ok) {
        return {
          ok: false,
          status: 422,
          code: 'HOTEL_SETTINGS_REJECTED',
          issues: parsed.issues.slice(0, 10),
        };
      }
      let written;
      try {
        written = writeRoomImageHousehold(
          householdConfigPath,
          parsed.value,
          publishStep,
          latchSetupRecoveryFailure,
          assertSetupRecoveryHealthy,
        );
      } catch {
        return { ok: false, status: 500, code: 'HOTEL_SETTINGS_NOT_WRITTEN' };
      }
      return {
        ok: true,
        etag: written.etag,
        hotelMode: parsed.value.hotelMode ?? null,
        activationReady,
      };
    });
  }

  /** Der reine Bericht ohne zu schreiben — die GUI zeigt damit, was noch fehlt. */
  async function inspect(hotelMode) {
    if (!preflight) return { ok: false, checks: [] };
    return await preflight.inspect(hotelMode);
  }

  return { inspect, read, save };
}

const HOTEL_SETTINGS_MESSAGES = {
  HOTEL_SETTINGS_UNAVAILABLE: 'Die Haushaltskonfiguration ist gerade nicht bearbeitbar.',
  HOTEL_SETTINGS_PRECONDITION_REQUIRED: 'Der Household-ETag fehlt.',
  HOTEL_SETTINGS_STALE: 'Die Haushaltskonfiguration wurde zwischenzeitlich geändert.',
  HOTEL_SETTINGS_INVALID: 'Die Hotel-Mode-Einstellungen sind unlesbar.',
  HOTEL_SETTINGS_REJECTED: 'Die Hotel-Mode-Einstellungen sind ungültig.',
  HOTEL_SETTINGS_NOT_WRITTEN: 'Die Einstellungen konnten nicht gespeichert werden.',
  HOTEL_ACTIVATION_LOCKED: 'Hotel Mode kann noch nicht produktiv aktiviert werden.',
  HOTEL_ACTIVATION_BLOCKED: 'Der Aktivierungscheck ist noch nicht vollständig bestanden.',
};

function hotelSettingsMessage(code) {
  return HOTEL_SETTINGS_MESSAGES[code] || 'Die Einstellungen konnten nicht gespeichert werden.';
}

/**
 * Ereignisse an Home Assistant. Bewusst nur der eine Weg, den der Checkout
 * braucht — kein allgemeines Event-Gateway.
 */
export function createHotelEventClient({
  baseUrl,
  token,
  fetchImpl = fetch,
  timeoutMs = HOTEL_COMMAND_TIMEOUT_MS,
} = {}) {
  async function fire(eventType, data) {
    const url = haRestUrl(baseUrl, `api/events/${encodeURIComponent(eventType)}`);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, code: 'HOTEL_EVENT_UNREACHABLE' };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'HOTEL_EVENT_AUTH_FAILED' };
    if (response.status < 200 || response.status >= 300) return { ok: false, code: 'HOTEL_EVENT_HTTP_ERROR' };
    return { ok: true };
  }
  return { fire };
}

/**
 * Gast-Checkout. Reihenfolge ist die Zusage: die Markierung wird atomar
 * persistiert, bevor irgendetwas anderes passiert — der Aufenthalt gilt danach
 * auch dann als beendet, wenn Ereignis und Szene scheitern. Ein wiederholter
 * Request verdoppelt nichts; Fehler danach sieht nur der Admin.
 */
export function createHotelCheckoutService({
  stays,
  store,
  guests = null,
  configStore = null,
  connectionMode = HA_CONNECTION_MODE,
  householdConfigPath = HOUSEHOLD_CONFIG_PATH,
  now = () => Date.now(),
  policyReader = () => readHotelModePolicy(householdConfigPath),
  eventClientFactory = createHotelEventClient,
  commandClientFactory = createHotelCommandClient,
} = {}) {
  function credentials() {
    return resolveServerHaAccess(configStore, connectionMode);
  }

  async function announce(policy, stayId, checkedOutAt) {
    const notice = { event: null, scene: null };
    const access = credentials();
    if (!access) {
      notice.event = 'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED';
      return notice;
    }
    const event = await eventClientFactory(access).fire('hauser_guest_checkout', {
      stay_id: stayId,
      checked_out_at: new Date(checkedOutAt).toISOString(),
    });
    if (!event.ok) notice.event = event.code;
    // Ohne ausdrücklich konfigurierte Szene verändert Hauser kein Gerät.
    const sceneEntityId = policy.checkout.sceneEntityId;
    if (sceneEntityId) {
      const scene = await commandClientFactory(access).call('scene', 'turn_on', sceneEntityId, {});
      if (!scene.ok) notice.scene = scene.code;
    }
    return notice;
  }

  async function checkout() {
    const stayState = await stays.resolve();
    // Ein zweiter Request auf denselben beendeten Aufenthalt ist erfolgreich,
    // löst aber weder Ereignis noch Szene erneut aus.
    if (stayState.source === 'checkout') return { ok: true, status: 200, repeated: true };
    if (!stayState.enabled || stayState.status !== 'active') {
      return { ok: false, status: 403, code: 'HOTEL_STAY_INACTIVE' };
    }
    const policy = policyReader();
    if (!policy || !policy.checkout.enabled) {
      return { ok: false, status: 403, code: 'HOTEL_CHECKOUT_DISABLED' };
    }

    const stayId = stayState.stay.uid;
    const checkedOutAt = now();
    store.update(() => ({ checkout: { stayId, checkedOutAt } }));
    // Der laufende Sammelcache darf keine Steuerdaten mehr ausliefern.
    guests?.invalidate?.();

    const notice = await announce(policy, stayId, checkedOutAt);
    if (notice.event || notice.scene) {
      store.update(() => ({ checkout: { stayId, checkedOutAt, notice } }));
    }
    return { ok: true, status: 200, repeated: false };
  }

  /** Nur der Admin darf die Markierung zurücknehmen. */
  function reset() {
    store.update(() => ({ checkout: null }));
    guests?.invalidate?.();
    return { ok: true, status: 200 };
  }

  return { checkout, reset };
}

/**
 * Aktivierungs-Preflight. Hotel Mode wird nie halb aktiviert: erst wenn
 * Kioskbestätigung, Admin-PIN, Gastfreigabe, der Gerätepfad und der Kalender
 * nachweislich tragen, darf `enabled` wahr werden. Geprüft wird mit echten
 * Abrufen — eine Konfiguration, die nur auf dem Papier stimmt, genügt nicht.
 */
export function createHotelActivationPreflight({
  configStore = null,
  connectionMode = HA_CONNECTION_MODE,
  access = null,
  statesClientFactory = createHotelStatesClient,
  calendarClientFactory = createHotelCalendarClient,
  now = () => Date.now(),
} = {}) {
  function credentials() {
    return resolveServerHaAccess(configStore, connectionMode);
  }

  async function inspect(hotelMode) {
    const checks = [];
    const add = (id, ok, code) => checks.push({ id, ok, code: ok ? null : code });

    add('kiosk', hotelMode?.kioskAcknowledged === true, 'HOTEL_KIOSK_UNCONFIRMED');
    add('pin', access?.configured() === true, 'HOTEL_PIN_NOT_CONFIGURED');

    // Die Freigabe wird immer als aktiv ausgewertet: geprüft wird der Entwurf,
    // nicht der aktuell gespeicherte Schalterzustand.
    const entityIds = hotelMode ? guestVisibleEntityIds({ ...hotelMode, enabled: true }) : [];
    add('policy', entityIds.length > 0, 'HOTEL_GUEST_ACCESS_EMPTY');

    const haAccess = credentials();
    if (!haAccess) {
      add('proxy', false, 'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
      add('calendar', false, 'HOTEL_HOME_ASSISTANT_NOT_CONFIGURED');
      return { ok: checks.every((check) => check.ok), checks };
    }

    if (entityIds.length === 0) add('proxy', false, 'HOTEL_GUEST_ACCESS_EMPTY');
    else {
      const state = await statesClientFactory(haAccess).state(entityIds[0]);
      add('proxy', state.ok === true, state.code || 'HOTEL_PROXY_UNAVAILABLE');
    }

    const calendarEntityId = hotelMode?.calendar?.entityId || '';
    if (calendarEntityId === '') add('calendar', false, 'HOTEL_CALENDAR_NOT_CONFIGURED');
    else {
      const nowMs = now();
      const events = await calendarClientFactory(haAccess).events(
        calendarEntityId,
        nowMs,
        nowMs + HOTEL_CALENDAR_LOOKAHEAD_MS,
      );
      add('calendar', events.ok === true, events.code || 'HOTEL_CALENDAR_UNAVAILABLE');
    }

    return { ok: checks.every((check) => check.ok), checks };
  }

  return { inspect };
}

function hotelAdminRequired(res) {
  return jsonResponse(res, 401, { code: 'HOTEL_ADMIN_REQUIRED', message: 'Adminsitzung erforderlich.' });
}

function hotelStayResponse(res, stays, project) {
  return stays.resolve().then(
    (state) => jsonResponse(res, 200, project(state)),
    () => jsonResponse(res, 503, {
      code: 'HOTEL_STAY_UNAVAILABLE',
      message: 'Der Aufenthaltsstatus ist nicht verfügbar.',
    }),
  );
}

export function serveHotelModeSession(req, res, access, stays, guests, commands, settings, checkouts) {
  const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;

  if (pathname === '/api/hotel-mode/session' && req.method === 'GET') {
    return jsonResponse(res, 200, access.status(req));
  }
  if (pathname === '/api/hotel-mode/status' && req.method === 'GET') {
    return hotelStayResponse(res, stays, stays.publicStatus);
  }
  if (pathname === '/api/hotel-mode/entities' && req.method === 'GET') {
    // Guest route: no admin session, no cookie, and no data at all unless a
    // stay is really running.
    return guests.read().then(
      (state) => jsonResponse(res, 200, state),
      () => jsonResponse(res, 503, {
        code: 'HOTEL_ENTITIES_UNAVAILABLE',
        message: 'Die Gerätezustände sind nicht verfügbar.',
      }),
    );
  }
  if (pathname === '/api/hotel-mode/command' && req.method === 'POST') {
    // Guest route as well: the stay itself is the permission, so there is no
    // admin session here — but nothing passes that the v4 allowlist rejects.
    return readHotelJson(req, res, (payload) => {
      commands.execute({ entityId: payload?.entityId, action: payload?.action, data: payload?.data }).then(
        (result) => (result.ok
          ? jsonResponse(res, 200, { ok: true })
          : jsonResponse(res, result.status, { code: result.code, message: hotelCommandMessage(result.code) })),
        () => jsonResponse(res, 502, {
          code: 'HOTEL_COMMAND_FAILED',
          message: hotelCommandMessage('HOTEL_COMMAND_FAILED'),
        }),
      );
    });
  }
  if (pathname === '/api/hotel-mode/checkout') {
    // Gastpfad: der laufende Aufenthalt ist die Berechtigung. Das Zurücknehmen
    // der Markierung bleibt ausdrücklich dem Admin vorbehalten.
    if (req.method === 'POST') {
      return checkouts.checkout().then(
        (result) => (result.ok
          ? jsonResponse(res, 200, { ok: true })
          : jsonResponse(res, result.status, {
            code: result.code,
            message: result.code === 'HOTEL_CHECKOUT_DISABLED'
              ? 'Der Checkout ist nicht freigegeben.'
              : 'Ohne laufenden Aufenthalt ist kein Checkout möglich.',
          })),
        () => jsonResponse(res, 500, {
          code: 'HOTEL_CHECKOUT_FAILED',
          message: 'Der Checkout konnte nicht abgeschlossen werden.',
        }),
      );
    }
    if (req.method === 'DELETE') {
      if (!access.authorize(req)) return hotelAdminRequired(res);
      checkouts.reset();
      return jsonResponse(res, 200, { ok: true });
    }
    return jsonResponse(res, 405, {
      code: 'HOTEL_METHOD_NOT_ALLOWED',
      message: 'Der Checkout erlaubt POST und DELETE.',
    }, { allow: 'POST, DELETE' });
  }
  if (pathname === '/api/hotel-mode/activation' && req.method === 'GET') {
    if (!access.authorize(req)) return hotelAdminRequired(res);
    const current = settings.read();
    if (!current.ok) {
      return jsonResponse(res, current.status, {
        code: current.code,
        message: hotelSettingsMessage(current.code),
      });
    }
    return settings.inspect(current.hotelMode).then(
      (result) => jsonResponse(res, 200, result),
      () => jsonResponse(res, 503, {
        code: 'HOTEL_ACTIVATION_UNAVAILABLE',
        message: 'Der Aktivierungscheck ist gerade nicht möglich.',
      }),
    );
  }
  if (pathname === '/api/hotel-mode/settings') {
    if (!['GET', 'PUT'].includes(req.method || '')) {
      return jsonResponse(res, 405, {
        code: 'HOTEL_METHOD_NOT_ALLOWED',
        message: 'Die Hotel-Mode-Einstellungen erlauben GET und PUT.',
      }, { allow: 'GET, PUT' });
    }
    if (!access.authorize(req)) return hotelAdminRequired(res);
    if (req.method === 'GET') {
      const result = settings.read();
      return result.ok
        ? jsonResponse(res, 200, result)
        : jsonResponse(res, result.status, { code: result.code, message: hotelSettingsMessage(result.code) });
    }
    return readHotelJson(req, res, (payload) => {
      settings.save({ etag: payload?.etag, hotelMode: payload?.hotelMode }).then(
        (result) => (result.ok
          ? jsonResponse(res, 200, result)
          : jsonResponse(res, result.status, {
            code: result.code,
            message: hotelSettingsMessage(result.code),
            ...(result.issues ? { issues: result.issues } : {}),
            ...(result.checks ? { checks: result.checks } : {}),
          })),
        () => jsonResponse(res, 500, {
          code: 'HOTEL_SETTINGS_NOT_WRITTEN',
          message: hotelSettingsMessage('HOTEL_SETTINGS_NOT_WRITTEN'),
        }),
      );
    }, HOTEL_SETTINGS_BODY_MAX);
  }
  if (pathname === '/api/hotel-mode/stay' && req.method === 'GET') {
    // Read-only diagnostics, so an open admin GUI must not keep polling the
    // session alive; only real admin actions and an explicit touch do that.
    if (!access.inspect(req)) return hotelAdminRequired(res);
    return hotelStayResponse(res, stays, stays.adminStatus);
  }
  if (pathname === '/api/hotel-mode/override' && req.method === 'POST') {
    if (!access.authorize(req)) return hotelAdminRequired(res);
    return readHotelJson(req, res, (payload) => {
      const result = payload?.clear === true
        ? stays.clearOverride()
        : stays.setOverride({ startsAt: payload?.startsAt, endsAt: payload?.endsAt });
      if (!result.ok) {
        return jsonResponse(res, 400, {
          code: result.code,
          message: 'Der manuelle Aufenthalt ist ungültig.',
        });
      }
      jsonResponse(res, 200, { override: result.override });
    });
  }
  if (pathname === '/api/hotel-mode/pin' && req.method === 'POST') {
    return readHotelJson(req, res, (payload) => {
      const result = access.setPin({ pin: payload?.pin, currentPin: payload?.currentPin });
      if (!result.ok) {
        const invalid = result.code === 'HOTEL_PIN_INVALID';
        return jsonResponse(res, invalid ? 400 : 401, {
          code: result.code,
          message: invalid
            ? 'Die PIN muss aus mindestens sechs Ziffern bestehen.'
            : 'Die bisherige PIN ist nicht korrekt.',
        });
      }
      jsonResponse(res, 200, { configured: true, unlocked: false }, { 'set-cookie': hotelAdminCookie(req, '', 0) });
    });
  }
  if (pathname === '/api/hotel-mode/unlock' && req.method === 'POST') {
    return readHotelJson(req, res, (payload) => {
      const result = access.unlock(payload?.pin, req.socket?.remoteAddress || '');
      if (!result.ok) {
        if (!result.configured) {
          return jsonResponse(res, 503, { code: 'HOTEL_PIN_NOT_CONFIGURED', message: 'Es ist noch keine Admin-PIN gesetzt.' });
        }
        return jsonResponse(res, result.limited ? 429 : 401, {
          code: result.limited ? 'HOTEL_PIN_RATE_LIMITED' : 'HOTEL_PIN_MISMATCH',
          message: result.limited ? 'Zu viele Versuche. Bitte kurz warten.' : 'PIN ist nicht korrekt.',
        }, result.limited ? { 'retry-after': String(Math.ceil(result.retryAfterMs / 1000)) } : {});
      }
      jsonResponse(
        res,
        200,
        { configured: true, unlocked: true, expiresAt: result.expiresAt },
        { 'set-cookie': hotelAdminCookie(req, result.session, Math.ceil(access.sessionMs / 1000)) },
      );
    });
  }
  if (pathname === '/api/hotel-mode/lock' && req.method === 'POST') {
    access.lock(req);
    return jsonResponse(
      res,
      200,
      { configured: access.configured(), unlocked: false, expiresAt: null },
      { 'set-cookie': hotelAdminCookie(req, '', 0) },
    );
  }
  if (pathname === '/api/hotel-mode/touch' && req.method === 'POST') {
    if (!access.touch(req)) return hotelAdminRequired(res);
    return jsonResponse(res, 200, access.status(req));
  }
  return jsonResponse(res, 404, { code: 'HOTEL_ROUTE_NOT_FOUND', message: 'Hotel-Mode-Route nicht gefunden.' });
}
