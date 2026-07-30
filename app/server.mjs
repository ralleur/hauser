import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  accessSync, chmodSync, constants as fsConstants, copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVER_CONTRACT_COMPILED = process.env.HMI_SERVER_CONTRACT === 'compiled';
const serverContractBase = SERVER_CONTRACT_COMPILED ? './server-contract' : './src/lib/config';
const serverContractExtension = SERVER_CONTRACT_COMPILED ? 'js' : 'ts';
const { compileHouseholdConfig, parseHouseholdConfig } = await import(
  `${serverContractBase}/household-config.${serverContractExtension}`
);
const { migrateHouseholdConfigDocument } = await import(
  `${serverContractBase}/household-config-migration.${serverContractExtension}`
);
const { projectActiveHouseholdData } = await import(
  `${serverContractBase}/household-runtime-data.${serverContractExtension}`
);

const HOST = process.env.HMI_HOST || '0.0.0.0';
const PORT = Number(process.env.HMI_PORT || 4173);
const HERMES_HOST = process.env.HMI_HERMES_HOST || '127.0.0.1';
const HERMES_PORT = Number(process.env.HMI_HERMES_PORT || 8642);
const AI_CUSTOMIZING_ENABLED = process.env.HMI_AI_CUSTOMIZING_ENABLED !== '0';
const AMBIENT_HOST = process.env.HMI_AMBIENT_HOST || '127.0.0.1';
const AMBIENT_PORT = Number(process.env.HMI_AMBIENT_PORT || 18088);
const NOTION_BRIDGE_HOST = process.env.HMI_NOTION_BRIDGE_HOST || '127.0.0.1';
const NOTION_BRIDGE_PORT = Number(process.env.HMI_NOTION_BRIDGE_PORT || 8790);

const PAPERLESS_HOST = process.env.HMI_PAPERLESS_HOST || '127.0.0.1';
const PAPERLESS_PORT = Number(process.env.HMI_PAPERLESS_PORT || 8000);
const ACESTEP_HOST = process.env.HMI_ACESTEP_HOST || '127.0.0.1';
const ACESTEP_PORT = Number(process.env.HMI_ACESTEP_PORT || 18001);
const AMBIENT_MODEL = 'gpt-5.6-luna';
const AMBIENT_BODY_MAX = 64 * 1024;
const KEYCHAIN_SERVICE = process.env.HMI_KEYCHAIN_SERVICE || 'smart-home-hmi.hermes-api';
const KEYCHAIN_ACCOUNT = process.env.HMI_KEYCHAIN_ACCOUNT || 'hmi-customizing';
const ABLAGE_KEYCHAIN_SERVICE = process.env.HMI_ABLAGE_KEYCHAIN_SERVICE || 'smart-home-hmi.ablage';
const ABLAGE_PIN_ACCOUNT = process.env.HMI_ABLAGE_PIN_ACCOUNT || 'pin';
const ABLAGE_TOKEN_ACCOUNT = process.env.HMI_ABLAGE_TOKEN_ACCOUNT || 'paperless-token';
const ABLAGE_SESSION_MS = 15 * 60 * 1000;
const ABLAGE_BODY_MAX = 1024;
const ABLAGE_UPLOAD_MAX = Math.max(1, Number(process.env.HMI_ABLAGE_UPLOAD_MAX) || 52428800);
const SONG_BODY_MAX = 4 * 1024;
const SONG_STYLES = new Set(['Pop', 'Rock', 'Disco', 'Jazz', 'Hip-Hop', 'Metal', 'Indie', 'Britpop', 'Electronic', 'House', 'Funk', 'Soul', 'Country', 'Reggae', 'Classical']);
const SONG_ERAS = new Set(['Heute', '2000er', '1990er', '1980er', '1970er', '1960er']);
const SONG_VOICES = new Set(['Weiblich', 'Männlich', 'Duett', 'Instrumental']);
const SONG_LYRICS_MODEL = 'gpt-5.6-luna';
const SONG_LIBRARY_DIR = process.env.HMI_SONG_LIBRARY_DIR || resolve(homedir(), '.local', 'share', 'smart-home-hmi', 'songs');
const SONG_LIBRARY_PATH = resolve(SONG_LIBRARY_DIR, 'library.json');
const FAMILY_DATA_PATH = process.env.HMI_FAMILY_DATA_PATH || resolve(homedir(), '.local', 'share', 'smart-home-hmi', 'family-data.json');
const FAMILY_DATA_SEED_PATH = fileURLToPath(new URL('./data/family-data.seed.json', import.meta.url));
const NOTION_SHOPPING_PATH = process.env.HMI_NOTION_SHOPPING_PATH
  || fileURLToPath(new URL('./public/notion-shopping.json', import.meta.url));
const ACESTEP_AUDIO_ROOT = process.env.HMI_ACESTEP_AUDIO_ROOT || '/path/to/ace-step-1.5/.cache/acestep/tmp/api_audio';

const ALLOWED_ORIGINS = new Set(
  (process.env.HMI_ALLOWED_ORIGINS || 'https://dashboard.example.com,https://haus.example.com,http://localhost:4173,http://127.0.0.1:4173')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
);
const DIST = resolve(fileURLToPath(new URL('./dist', import.meta.url)));
const CONFIG_PATH = process.env.HMI_CONFIG_PATH
  || resolve(homedir(), '.config', 'smart-home-hmi', 'config.json');
const CONFIG_BODY_MAX = 1024 * 1024;
const HOUSEHOLD_CONFIG_PATH = process.env.HMI_HOUSEHOLD_CONFIG_PATH || null;
const HOUSEHOLD_CONFIG_BODY_MAX = 1024 * 1024;
const HOUSEHOLD_CONFIG_MODE_HEADER = 'x-hmi-household-config-mode';
const REQUIRED_WRITABLE_DIRS = (process.env.HMI_REQUIRED_WRITABLE_DIRS || '')
  .split(',').map((path) => path.trim()).filter(Boolean);
const SHARED_CONFIG_KEYS = new Set([
  'hmi:backend', 'hmi:ha-url', 'hmi:ha-token', 'hmi:jf-url', 'hmi:jf-token',
  'hmi:jf-user', 'hmi:library', 'hmi:lock-button',
  'hmi:device-config:v1', 'hmi:scene-config:v1', 'hmi:home-layout:v1',
  'hmi:light-icon-overrides:v1', 'hmi:calendar-selected', 'hmi:reminders-selected',
  'hmi:shopping-config:v1',
]);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.woff2', 'font/woff2'], ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
]);

export function proxyTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (parsed.pathname !== '/hermes' && !parsed.pathname.startsWith('/hermes/')) return null;
  const path = parsed.pathname.slice('/hermes'.length) || '/';
  const allowed = path === '/health'
    || path === '/api/sessions'
    || path.startsWith('/api/sessions/')
    || path === '/v1/runs'
    || path.startsWith('/v1/runs/');
  return allowed ? `${path}${parsed.search}` : null;
}

export function notionBridgeTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (!parsed.pathname.startsWith('/notion-bridge/')) return null;
  const path = parsed.pathname.slice('/notion-bridge'.length);
  const allowed = path === '/health'
    || path === '/shopping/add'
    || path === '/shopping/toggle'
    || path === '/shopping/store/add'
    || path === '/shopping/store/delete';
  return allowed ? path : null;
}


export function songTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (parsed.pathname === '/api/songs/health') return { kind: 'health', path: '/health', method: 'GET' };
  if (parsed.pathname === '/api/songs/generate') return { kind: 'generate', path: '/release_task', method: 'POST' };
  if (parsed.pathname === '/api/songs/status') return { kind: 'status', path: '/query_result', method: 'POST' };
  if (parsed.pathname === '/api/songs/library') {
    if (parsed.searchParams.size) return null;
    return { kind: 'library', path: '', method: null };
  }
  const libraryMatch = parsed.pathname.match(/^\/api\/songs\/library\/([0-9a-f-]{36})(?:\/(audio))?$/i);
  if (libraryMatch && !parsed.searchParams.size) {
    return { kind: libraryMatch[2] ? 'library-audio' : 'library-item', path: '', method: null, id: libraryMatch[1] };
  }
  if (parsed.pathname === '/api/songs/audio') {
    const path = parsed.searchParams.get('path') || '';
    if (!path || path.length > 2048 || path.includes('\0')) return null;
    return { kind: 'audio', path: `/v1/audio?path=${encodeURIComponent(path)}`, method: 'GET' };
  }
  return null;
}

export function songRequestAllowed(req, target, allowedOrigins = ALLOWED_ORIGINS) {
  if (!target) return false;
  const methodAllowed = target.method
    ? req.method === target.method
    : (target.kind === 'library' && ['GET', 'POST'].includes(req.method || ''))
      || (target.kind === 'library-item' && ['PATCH', 'DELETE'].includes(req.method || ''))
      || (target.kind === 'library-audio' && ['GET', 'HEAD'].includes(req.method || ''));
  if (!methodAllowed) return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}


export function proxyRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

export function notionBridgeRequestAllowed(req, targetPath, allowedOrigins = ALLOWED_ORIGINS) {
  const methodAllowed = (targetPath === '/health' && req.method === 'GET')
    || (targetPath !== '/health' && req.method === 'POST');
  if (!methodAllowed) return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

export function ambientRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (req.method !== 'POST') return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

export function configRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (!['GET', 'PUT'].includes(req.method || '')) return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

export function householdConfigRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (req.method !== 'GET') return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

export function familyDataRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}



export function ablageRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (!['GET', 'POST'].includes(req.method || '')) return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

function readKeychainSecret(account, service, required = false) {
  try {
    const value = execFileSync('/usr/bin/security', [
      'find-generic-password', '-a', account, '-s', service, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (value) return value;
  } catch { /* Optional secrets leave the Ablage route disabled. */ }
  if (required) throw new Error(`Schlüsselbund-Eintrag ${service}/${account} fehlt.`);
  return '';
}

export function createAblageAccess(pin = '', token = '', now = () => Date.now()) {
  const sessions = new Map();
  const attempts = new Map();

  function configured() { return Boolean(pin && token); }
  function cookieToken(req) {
    const match = String(req.headers.cookie || '').match(/(?:^|;\s*)hmi_ablage=([a-f0-9]{64})(?:;|$)/);
    return match?.[1] || '';
  }
  function authenticated(req) {
    const session = cookieToken(req);
    const expiry = sessions.get(session) || 0;
    if (!session || expiry <= now()) {
      if (session) sessions.delete(session);
      return false;
    }
    sessions.set(session, now() + ABLAGE_SESSION_MS);
    return true;
  }
  function unlock(candidate, remoteAddress = '') {
    const key = remoteAddress || 'unknown';
    const attempt = attempts.get(key) || { failures: 0, blockedUntil: 0 };
    if (attempt.blockedUntil > now()) return { ok: false, limited: true };
    const expected = Buffer.from(pin);
    const supplied = Buffer.from(String(candidate || ''));
    const valid = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    if (!valid) {
      attempt.failures += 1;
      if (attempt.failures >= 5) {
        attempt.failures = 0;
        attempt.blockedUntil = now() + 60_000;
      }
      attempts.set(key, attempt);
      return { ok: false, limited: attempt.blockedUntil > now() };
    }
    attempts.delete(key);
    const session = randomBytes(32).toString('hex');
    sessions.set(session, now() + ABLAGE_SESSION_MS);
    return { ok: true, session };
  }
  function lock(req) {
    const session = cookieToken(req);
    if (session) sessions.delete(session);
  }
  return { authenticated, configured, lock, token, unlock };
}

export function createCentralConfigStore(path = CONFIG_PATH) {
  function read() {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => (
        SHARED_CONFIG_KEYS.has(key) && typeof value === 'string'
      )));
    } catch {
      return {};
    }
  }

  function update(updates) {
    const values = read();
    for (const [key, value] of Object.entries(updates)) {
      if (!SHARED_CONFIG_KEYS.has(key)) continue;
      if (value === null) delete values[key];
      else if (typeof value === 'string' && Buffer.byteLength(value) <= 256 * 1024) values[key] = value;
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return values;
  }

  return { read, update };
}

export function createHouseholdConfigReader(
  path = HOUSEHOLD_CONFIG_PATH,
  maxBytes = HOUSEHOLD_CONFIG_BODY_MAX,
) {
  function read() {
    if (!path) {
      return {
        ok: false,
        status: 503,
        code: 'HOUSEHOLD_CONFIG_NOT_CONFIGURED',
        message: 'Der Pfad zur Haushaltskonfiguration ist nicht konfiguriert.',
      };
    }

    let metadata;
    try {
      metadata = statSync(path);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return {
          ok: false,
          status: 404,
          code: 'HOUSEHOLD_CONFIG_NOT_FOUND',
          message: 'Die Haushaltskonfiguration wurde nicht gefunden.',
        };
      }
      return {
        ok: false,
        status: 500,
        code: 'HOUSEHOLD_CONFIG_NOT_READABLE',
        message: 'Die Haushaltskonfiguration konnte nicht gelesen werden.',
      };
    }

    if (!metadata.isFile()) {
      return {
        ok: false,
        status: 500,
        code: 'HOUSEHOLD_CONFIG_NOT_READABLE',
        message: 'Die Haushaltskonfiguration ist keine lesbare Datei.',
      };
    }
    if (metadata.size > maxBytes) {
      return {
        ok: false,
        status: 413,
        code: 'HOUSEHOLD_CONFIG_TOO_LARGE',
        message: 'Die Haushaltskonfiguration ist größer als 1 MiB.',
      };
    }

    try {
      const contents = readFileSync(path);
      if (contents.length > maxBytes) {
        return {
          ok: false,
          status: 413,
          code: 'HOUSEHOLD_CONFIG_TOO_LARGE',
          message: 'Die Haushaltskonfiguration ist größer als 1 MiB.',
        };
      }
      return { ok: true, body: contents.toString('utf8') };
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return {
          ok: false,
          status: 404,
          code: 'HOUSEHOLD_CONFIG_NOT_FOUND',
          message: 'Die Haushaltskonfiguration wurde nicht gefunden.',
        };
      }
      return {
        ok: false,
        status: 500,
        code: 'HOUSEHOLD_CONFIG_NOT_READABLE',
        message: 'Die Haushaltskonfiguration konnte nicht gelesen werden.',
      };
    }
  }

  return { read };
}

function migrationTimestamp(date) {
  return date.toISOString().replace(/[-:.]/g, '');
}

export function migrateHouseholdConfigFile(
  path = HOUSEHOLD_CONFIG_PATH,
  {
    now = () => new Date(),
    replaceConfig = renameSync,
  } = {},
) {
  if (!path) return { ok: true, status: 'not_configured' };

  let original;
  try {
    original = readFileSync(path);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { ok: true, status: 'missing' };
    }
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_READ_FAILED',
      message: 'Die Haushaltskonfiguration konnte für die Migration nicht gelesen werden.',
    };
  }
  if (original.length > HOUSEHOLD_CONFIG_BODY_MAX) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_TOO_LARGE',
      message: 'Die Haushaltskonfiguration ist größer als 1 MiB.',
    };
  }

  let document;
  try {
    document = JSON.parse(original.toString('utf8'));
  } catch {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_INVALID_JSON',
      message: 'Die Haushaltskonfiguration enthält kein gültiges JSON.',
    };
  }

  const migration = migrateHouseholdConfigDocument(document);
  if (!migration.ok) return migration;
  if (migration.status === 'current') {
    return { ok: true, status: 'current', version: migration.version };
  }

  const parsed = parseHouseholdConfig(migration.document);
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID',
      message: 'Das migrierte Dokument erfüllt den aktuellen Haushaltsvertrag nicht.',
      issue: parsed.issues[0] ?? null,
    };
  }
  try {
    projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
  } catch (error) {
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_INVALID',
      message: error instanceof Error
        ? error.message
        : 'Das migrierte Dokument kann nicht in die produktive Runtime projiziert werden.',
    };
  }

  const stamp = migrationTimestamp(now());
  let backupPath = `${path}.backup-v${migration.fromVersion}-${stamp}`;
  for (let suffix = 1; existsSync(backupPath); suffix += 1) {
    backupPath = `${path}.backup-v${migration.fromVersion}-${stamp}-${suffix}`;
  }
  const backupTemporary = `${backupPath}.${process.pid}.tmp`;
  try {
    writeFileSync(backupTemporary, original, { mode: 0o600, flush: true });
    chmodSync(backupTemporary, 0o600);
    renameSync(backupTemporary, backupPath);
  } catch {
    try { unlinkSync(backupTemporary); } catch { /* no incomplete backup remains */ }
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_BACKUP_FAILED',
      message: 'Die Haushaltskonfiguration konnte vor der Migration nicht gesichert werden.',
    };
  }

  const temporary = `${path}.${process.pid}.migration.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(parsed.value, null, 2)}\n`, { mode: 0o600, flush: true });
    chmodSync(temporary, 0o600);
    replaceConfig(temporary, path);
    chmodSync(path, 0o600);
  } catch {
    try { unlinkSync(temporary); } catch { /* failed activation leaves the original marker untouched */ }
    return {
      ok: false,
      code: 'HOUSEHOLD_CONFIG_MIGRATION_WRITE_FAILED',
      message: 'Die migrierte Haushaltskonfiguration konnte nicht atomar aktiviert werden.',
      backupPath,
    };
  }

  return {
    ok: true,
    status: 'migrated',
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    backupPath,
  };
}

export function normalizeHouseholdConfigMode(value) {
  if (value === undefined || value === null) return 'shadow';
  if (value === 'shadow' || value === 'active') return value;
  throw new Error('HMI_HOUSEHOLD_CONFIG_MODE muss exakt "shadow" oder "active" sein.');
}

function notReady(code, message, extra = {}) {
  return {
    ok: false,
    status: 503,
    payload: { ok: false, status: 'not_ready', code, message, ...extra },
  };
}

function setupRequired(mode) {
  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      status: 'setup_required',
      householdConfigMode: mode,
      schemaVersion: null,
    },
  };
}

export function assessHmiReadiness({
  staticRoot = DIST,
  householdConfigPath = HOUSEHOLD_CONFIG_PATH,
  householdConfigMode = process.env.HMI_HOUSEHOLD_CONFIG_MODE,
  requiredWritableDirs = REQUIRED_WRITABLE_DIRS,
  migrationResult = null,
} = {}) {
  const normalizedMode = normalizeHouseholdConfigMode(householdConfigMode);
  const indexPath = resolve(staticRoot, 'index.html');
  try {
    if (!statSync(indexPath).isFile()) throw new Error('not a file');
  } catch {
    return notReady(
      'APP_BUNDLE_NOT_FOUND',
      `Das gebaute Frontend fehlt unter ${indexPath}.`,
    );
  }

  for (const directory of requiredWritableDirs) {
    try {
      if (!statSync(directory).isDirectory()) throw new Error('not a directory');
      accessSync(directory, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      return notReady(
        'RUNTIME_DIRECTORY_NOT_WRITABLE',
        `Das Laufzeitverzeichnis ist nicht les- und schreibbar: ${directory}`,
      );
    }
  }

  if (migrationResult && !migrationResult.ok) {
    return notReady(
      migrationResult.code,
      migrationResult.message,
      { issue: migrationResult.issue ?? null },
    );
  }

  if (normalizedMode === 'shadow') {
    return {
      ok: true,
      status: 200,
      payload: {
        ok: true,
        status: 'ready',
        householdConfigMode: normalizedMode,
        schemaVersion: null,
      },
    };
  }

  const configResult = createHouseholdConfigReader(householdConfigPath).read();
  if (!configResult.ok) {
    if (configResult.code === 'HOUSEHOLD_CONFIG_NOT_FOUND' && householdConfigPath) {
      return setupRequired(normalizedMode);
    }
    return notReady(configResult.code, configResult.message);
  }

  let document;
  try {
    document = JSON.parse(configResult.body);
  } catch {
    return notReady(
      'HOUSEHOLD_CONFIG_INVALID_JSON',
      'Die Haushaltskonfiguration enthält kein gültiges JSON.',
    );
  }
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) {
    const issue = parsed.issues[0];
    return notReady(
      'HOUSEHOLD_CONFIG_INVALID',
      `Die Haushaltskonfiguration ist ungültig (${parsed.issues.length} Problem${parsed.issues.length === 1 ? '' : 'e'}).`,
      { issue: issue ? { code: issue.code, path: issue.path, message: issue.message } : null },
    );
  }
  try {
    projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
  } catch (error) {
    const code = error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : 'HOUSEHOLD_CONFIG_PROJECTION_FAILED';
    const message = error instanceof Error
      ? error.message
      : 'Die Haushaltskonfiguration kann nicht in die produktive Runtime projiziert werden.';
    return notReady(code, message);
  }

  return {
    ok: true,
    status: 200,
    payload: {
      ok: true,
      status: 'ready',
      householdConfigMode: normalizedMode,
      schemaVersion: parsed.value.schemaVersion,
    },
  };
}

export function serveHmiHealth(req, res, options = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    jsonResponse(res, 405, {
      ok: false,
      status: 'not_ready',
      code: 'METHOD_NOT_ALLOWED',
      message: 'Der Health-Endpunkt unterstützt ausschließlich GET und HEAD.',
    }, { allow: 'GET, HEAD' });
    return;
  }
  const readiness = assessHmiReadiness(options);
  if (req.method === 'HEAD') {
    res.writeHead(readiness.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }
  jsonResponse(res, readiness.status, readiness.payload);
}

export function serveHouseholdConfigMode(req, res, mode = 'shadow') {
  const normalizedMode = normalizeHouseholdConfigMode(mode);
  const headers = { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedMode };
  if (req.method !== 'GET') {
    jsonResponse(res, 405, {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Der Haushaltsmodus ist ausschließlich per GET lesbar.',
    }, { allow: 'GET', ...headers });
    return;
  }
  jsonResponse(res, 200, { mode: normalizedMode }, headers);
}

export function serveHouseholdConfig(req, res, reader, mode = 'shadow') {
  const normalizedMode = normalizeHouseholdConfigMode(mode);
  const modeHeader = { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedMode };
  if (req.method !== 'GET') {
    res.writeHead(405, {
      allow: 'GET',
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...modeHeader,
    });
    res.end(JSON.stringify({
      code: 'METHOD_NOT_ALLOWED',
      message: 'Die Haushaltskonfiguration ist ausschließlich per GET lesbar.',
    }));
    return;
  }

  const result = reader.read();
  if (!result.ok) {
    res.writeHead(result.status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...modeHeader,
    });
    res.end(JSON.stringify({ code: result.code, message: result.message }));
    return;
  }

  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...modeHeader,
  });
  res.end(result.body);
}

export function createFamilyDataStore(
  path = FAMILY_DATA_PATH,
  seedPath = FAMILY_DATA_SEED_PATH,
) {
  function seed() {
    try {
      const data = JSON.parse(readFileSync(seedPath, 'utf8'));
      if (data?.version === 1 && Array.isArray(data.reminders) && Array.isArray(data.shopping)) return data;
    } catch { /* defaults below */ }
    return { version: 1, updatedAt: new Date().toISOString(), reminders: [], shopping: [
      { id: 'aldi', title: 'Aldi', items: [] },
      { id: 'rewe', title: 'Rewe', items: [] },
      { id: 'dm', title: 'dm', items: [] },
    ] };
  }

  function write(data) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return data;
  }

  function read() {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data?.version === 1 && Array.isArray(data.reminders) && Array.isArray(data.shopping)) return data;
    } catch { /* first start: migrate the bundled snapshots */ }
    return write(seed());
  }

  function update(mutator) {
    const data = read();
    mutator(data);
    data.updatedAt = new Date().toISOString();
    return write(data);
  }

  function reminders() {
    const data = read();
    return {
      updated_at: data.updatedAt,
      source_name: 'HMI Erinnerungen',
      source_color: '#ffffff',
      items: data.reminders,
    };
  }

  function reminderDue(rawDue) {
    if (rawDue === null || rawDue === undefined || rawDue === '') return null;
    const due = String(rawDue);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== due) {
      throw new Error('Ungültiges Erinnerungsdatum');
    }
    return due;
  }

  function addReminder(who, rawTitle, rawDue = null) {
    const labels = { alex: 'Alex', sam: 'Sam', beide: 'Beide' };
    const title = String(rawTitle || '').trim();
    if (!labels[who]) throw new Error('Unbekannte Person');
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const fullTitle = new RegExp(`^${who}\\s*[-–:]`, 'i').test(title) ? title : `${labels[who]} - ${title}`;
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(), title: fullTitle, completed: false, due: reminderDue(rawDue),
      description: null, priority: null, created: now, edited: now, source: 'hmi',
    };
    update((data) => data.reminders.push(item));
    return item;
  }

  function completeReminder(id) {
    let found = false;
    update((data) => {
      const item = data.reminders.find((entry) => entry.id === id);
      if (!item) return;
      item.completed = true;
      item.edited = new Date().toISOString();
      found = true;
    });
    if (!found) throw new Error('Erinnerung nicht gefunden');
  }

  function updateReminder(id, rawTitle, rawDue) {
    const title = String(rawTitle || '').trim();
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const due = reminderDue(rawDue);
    let found = false;
    update((data) => {
      const item = data.reminders.find((entry) => entry.id === id);
      if (!item) return;
      item.title = title;
      item.due = due;
      item.edited = new Date().toISOString();
      found = true;
    });
    if (!found) throw new Error('Erinnerung nicht gefunden');
  }

  function shopping() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let changed = false;
    const data = read();
    for (const section of data.shopping) {
      const retained = section.items.filter((item) => !item.checked || !item.checkedAt
        || new Date(item.checkedAt).getTime() > cutoff);
      changed ||= retained.length !== section.items.length;
      section.items = retained;
    }
    if (changed) {
      data.updatedAt = new Date().toISOString();
      write(data);
    }
    return { updated_at: data.updatedAt, source_name: 'HMI Einkaufsliste', sections: data.shopping };
  }

  function addShoppingItem(store, rawTitle) {
    const title = String(rawTitle || '').trim();
    if (!store) throw new Error('Unbekannter Laden');
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const item = { id: randomUUID(), title, checked: false, checkedAt: null };
    let found = false;
    update((data) => {
      const section = data.shopping.find((entry) => entry.id === store);
      if (!section) return;
      section.items.push(item);
      found = true;
    });
    if (!found) throw new Error('Laden nicht gefunden');
    return item;
  }

  function toggleShoppingItem(id, checked) {
    let found = false;
    update((data) => {
      const item = data.shopping.flatMap((section) => section.items).find((entry) => entry.id === id);
      if (!item) return;
      item.checked = Boolean(checked);
      item.checkedAt = item.checked ? new Date().toISOString() : null;
      found = true;
    });
    if (!found) throw new Error('Einkaufsartikel nicht gefunden');
  }

  function addShoppingStore(id, rawLabel) {
    const label = String(rawLabel || '').trim();
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !label) throw new Error('Ungültiger Laden');
    update((data) => {
      if (data.shopping.some((entry) => entry.id === id)) throw new Error('Laden existiert bereits');
      data.shopping.push({ id, title: label, items: [] });
    });
  }

  function deleteShoppingStore(id) {
    let found = false;
    update((data) => {
      const index = data.shopping.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      data.shopping.splice(index, 1);
      found = true;
    });
    if (!found) throw new Error('Laden nicht gefunden');
  }

  return {
    addReminder, addShoppingItem, addShoppingStore, completeReminder,
    deleteShoppingStore, reminders, shopping, toggleShoppingItem, updateReminder,
  };
}

function serveConfig(req, res, store) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ values: store.read() }));
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > CONFIG_BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfiguration zu groß"}');
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    if (!payload?.updates || typeof payload.updates !== 'object' || Array.isArray(payload.updates)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ungültige Konfiguration"}');
      return;
    }
    try {
      const values = store.update(payload.updates);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ values }));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfiguration konnte nicht gespeichert werden"}');
    }
  });
}

function setupRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (req.method !== 'POST') return false;
  const origin = req.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

function normalizeSetupServiceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)
        || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeSetupHaUrl(value) {
  return normalizeSetupServiceUrl(value);
}

function normalizeSetupJellyfin(payload) {
  if (!payload || typeof payload.enabled !== 'boolean') return null;
  if (!payload.enabled) return { enabled: false };
  const url = normalizeSetupServiceUrl(payload.url);
  if (!url
      || typeof payload.accessToken !== 'string' || !payload.accessToken.trim()
      || Buffer.byteLength(payload.accessToken) > 16 * 1024
      || typeof payload.userId !== 'string' || !payload.userId.trim()
      || Buffer.byteLength(payload.userId) > 1024) return null;
  return {
    enabled: true,
    url,
    accessToken: payload.accessToken.trim(),
    userId: payload.userId.trim(),
  };
}

function setupPayloadError(payload) {
  const haUrl = normalizeSetupHaUrl(payload?.haUrl);
  if (!haUrl) {
    return {
      code: 'SETUP_INVALID_HOME_ASSISTANT_URL',
      message: 'Die Home-Assistant-URL muss eine gültige HTTP- oder HTTPS-Adresse sein.',
    };
  }
  if (typeof payload?.haToken !== 'string' || !payload.haToken.trim()
      || Buffer.byteLength(payload.haToken) > 16 * 1024) {
    return {
      code: 'SETUP_INVALID_HOME_ASSISTANT_TOKEN',
      message: 'Der Home-Assistant-Token fehlt oder ist zu groß.',
    };
  }
  const jellyfin = normalizeSetupJellyfin(payload?.jellyfin);
  if (!jellyfin) {
    return {
      code: 'SETUP_INVALID_JELLYFIN_CONFIG',
      message: 'Jellyfin muss vollständig konfiguriert oder ausdrücklich deaktiviert werden.',
    };
  }
  const parsed = parseHouseholdConfig(payload?.householdConfig);
  if (!parsed.ok) {
    return {
      code: 'SETUP_INVALID_HOUSEHOLD_CONFIG',
      message: `Die Haushaltskonfiguration ist ungültig (${parsed.issues.length} Probleme).`,
      issue: parsed.issues[0] ?? null,
    };
  }
  try {
    projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
  } catch (error) {
    return {
      code: error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'HOUSEHOLD_CONFIG_PROJECTION_FAILED',
      message: error instanceof Error
        ? error.message
        : 'Die Haushaltskonfiguration kann nicht aktiviert werden.',
    };
  }
  return {
    haUrl,
    haToken: payload.haToken.trim(),
    householdConfig: parsed.value,
    jellyfin,
  };
}

export async function verifySetupHomeAssistant(haUrl, haToken, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${haUrl}/api/config`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${haToken}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'SETUP_HOME_ASSISTANT_AUTH_FAILED',
        message: 'Home Assistant hat den Token abgelehnt.',
      };
    }
    return {
      ok: false,
      code: 'SETUP_HOME_ASSISTANT_HTTP_ERROR',
      message: `Home Assistant antwortet mit HTTP ${response.status}.`,
    };
  } catch {
    return {
      ok: false,
      code: 'SETUP_HOME_ASSISTANT_UNREACHABLE',
      message: 'Home Assistant ist vom Hauser-Server aus nicht erreichbar.',
    };
  }
}

export async function verifySetupJellyfin(url, accessToken, userId, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${url}/Users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-emby-token': accessToken,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        code: 'SETUP_JELLYFIN_AUTH_FAILED',
        message: 'Jellyfin hat die geprüfte Anmeldung abgelehnt.',
      };
    }
    return {
      ok: false,
      code: 'SETUP_JELLYFIN_HTTP_ERROR',
      message: `Jellyfin antwortet mit HTTP ${response.status}.`,
    };
  } catch {
    return {
      ok: false,
      code: 'SETUP_JELLYFIN_UNREACHABLE',
      message: 'Jellyfin ist vom Hauser-Server aus nicht erreichbar.',
    };
  }
}

function serveSetupActivation(
  req,
  res,
  {
    configStore,
    householdConfigPath,
    setupConnectionVerifier,
    setupJellyfinVerifier,
    reconfigure = false,
  },
) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > HOUSEHOLD_CONFIG_BODY_MAX) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      jsonResponse(res, 413, {
        ok: false,
        code: 'SETUP_REQUEST_TOO_LARGE',
        message: 'Die Setup-Anfrage ist größer als 1 MiB.',
      });
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const result = setupPayloadError(payload);
    if (!('householdConfig' in result)) {
      jsonResponse(res, 400, { ok: false, ...result });
      return;
    }
    if (!householdConfigPath) {
      jsonResponse(res, 500, {
        ok: false,
        code: 'SETUP_CONFIG_PATH_NOT_CONFIGURED',
        message: 'Der Zielpfad für die Haushaltskonfiguration fehlt.',
      });
      return;
    }
    const connection = await setupConnectionVerifier(result.haUrl, result.haToken);
    if (!connection.ok) {
      jsonResponse(res, 502, connection);
      return;
    }
    if (result.jellyfin.enabled) {
      const jellyfinConnection = await setupJellyfinVerifier(
        result.jellyfin.url,
        result.jellyfin.accessToken,
        result.jellyfin.userId,
      );
      if (!jellyfinConnection.ok) {
        jsonResponse(res, 502, jellyfinConnection);
        return;
      }
    }
    let temporary = null;
    let previousSharedConfig = null;
    const sharedConfigUpdates = {
      'hmi:backend': 'ha',
      'hmi:ha-url': result.haUrl,
      'hmi:ha-token': result.haToken,
      'hmi:jf-url': result.jellyfin.enabled ? result.jellyfin.url : null,
      'hmi:jf-token': result.jellyfin.enabled ? result.jellyfin.accessToken : null,
      'hmi:jf-user': result.jellyfin.enabled ? result.jellyfin.userId : null,
      'hmi:library': result.jellyfin.enabled ? 'live' : 'fake',
    };
    try {
      mkdirSync(dirname(householdConfigPath), { recursive: true, mode: 0o700 });
      temporary = `${householdConfigPath}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(result.householdConfig, null, 2)}\n`, { mode: 0o600 });
      chmodSync(temporary, 0o600);

      if (reconfigure) {
        // Die aktive Haushaltsdatei bleibt bis zur letzten atomaren Umbenennung
        // unverändert. Schlägt vorher etwas fehl, wird auch die zentrale
        // Verbindungsconfig auf ihren exakten vorherigen Stand zurückgesetzt.
        previousSharedConfig = configStore.read();
        configStore.update(sharedConfigUpdates);
        renameSync(temporary, householdConfigPath);
        temporary = null;
      } else {
        // Beim First Run bleiben Zugangsdaten vor dem letzten Aktivierungsmarker.
        configStore.update(sharedConfigUpdates);
        renameSync(temporary, householdConfigPath);
        temporary = null;
      }
      jsonResponse(res, reconfigure ? 200 : 201, {
        ok: true,
        status: reconfigure ? 'reconfigured' : 'activated',
        schemaVersion: result.householdConfig.schemaVersion,
      });
    } catch {
      if (temporary) {
        try { unlinkSync(temporary); } catch { /* best effort */ }
      }
      if (reconfigure && previousSharedConfig) {
        try {
          configStore.update({
            'hmi:backend': previousSharedConfig['hmi:backend'] ?? null,
            'hmi:ha-url': previousSharedConfig['hmi:ha-url'] ?? null,
            'hmi:ha-token': previousSharedConfig['hmi:ha-token'] ?? null,
            'hmi:jf-url': previousSharedConfig['hmi:jf-url'] ?? null,
            'hmi:jf-token': previousSharedConfig['hmi:jf-token'] ?? null,
            'hmi:jf-user': previousSharedConfig['hmi:jf-user'] ?? null,
            'hmi:library': previousSharedConfig['hmi:library'] ?? null,
          });
        } catch { /* best effort; household config remains unchanged */ }
      }
      jsonResponse(res, 500, {
        ok: false,
        code: reconfigure ? 'SETUP_RECONFIGURATION_FAILED' : 'SETUP_ACTIVATION_FAILED',
        message: reconfigure
          ? 'Die bestehende Konfiguration blieb aktiv; die Änderungen konnten nicht gespeichert werden.'
          : 'Die Konfiguration konnte nicht atomar aktiviert werden.',
      });
    }
  });
}

export function staticPathFor(url, staticRoot = DIST) {
  const root = resolve(staticRoot);
  const pathname = decodeURIComponent(new URL(url, 'http://hmi.local').pathname);
  const candidate = resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}

function readHermesKey() {
  if (!AI_CUSTOMIZING_ENABLED) return '';
  if (process.platform !== 'darwin') return '';
  try {
    const key = execFileSync('/usr/bin/security', [
      'find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return key;
  } catch {
    return '';
  }
}

function proxy(req, res, key, targetPath, upstreamHost, upstreamPort) {
  const headers = {
    accept: req.headers.accept || '*/*',
    authorization: `Bearer ${key}`,
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['last-event-id']) headers['last-event-id'] = req.headers['last-event-id'];
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: req.method,
    path: targetPath,
    headers,
  }, (upstreamResponse) => {
    const responseHeaders = {};
    for (const name of ['content-type', 'cache-control', 'content-length']) {
      if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
    }
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"error":"Hermes nicht erreichbar"}');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function proxyNotionBridge(req, res, targetPath, upstreamHost, upstreamPort) {
  const headers = { accept: req.headers.accept || '*/*' };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: req.method,
    path: targetPath,
    headers,
  }, (upstreamResponse) => {
    const responseHeaders = {};
    for (const name of ['content-type', 'cache-control', 'content-length']) {
      if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
    }
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end('{"ok":false,"error":"Notion-Einkaufslisten-Bridge nicht erreichbar"}');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function jsonResponse(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function serveNotionShopping(res, path = NOTION_SHOPPING_PATH) {
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(payload?.sections)) throw new Error('Ungültiger Notion-Snapshot');
    jsonResponse(res, 200, payload);
  } catch {
    jsonResponse(res, 503, { error: 'Notion-Einkaufsliste ist noch nicht synchronisiert' });
  }
}

function readSmallJson(req, res, callback) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > ABLAGE_BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) return jsonResponse(res, 413, { error: 'Anfrage zu groß' });
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    callback(payload);
  });
}

function serveFamilyData(req, res, store) {
  const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;
  try {
    if (pathname === '/api/reminders' && req.method === 'GET') {
      return jsonResponse(res, 200, store.reminders());
    }
    if (pathname === '/api/shopping' && req.method === 'GET') {
      return jsonResponse(res, 200, store.shopping());
    }
    const reminderComplete = pathname.match(/^\/api\/reminders\/([0-9a-f-]{36})\/complete$/i);
    if (reminderComplete && req.method === 'POST') {
      store.completeReminder(reminderComplete[1]);
      return jsonResponse(res, 200, { ok: true });
    }
    const reminderItem = pathname.match(/^\/api\/reminders\/([0-9a-f-]{36})$/i);
    if (reminderItem && req.method === 'PATCH') {
      return readSmallJson(req, res, (payload) => {
        try {
          store.updateReminder(reminderItem[1], payload?.title, payload?.due);
          jsonResponse(res, 200, { ok: true });
        } catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    const shoppingItem = pathname.match(/^\/api\/shopping\/items\/([0-9a-f-]{36})$/i);
    if (shoppingItem && req.method === 'PATCH') {
      return readSmallJson(req, res, (payload) => {
        try {
          if (typeof payload?.checked !== 'boolean') throw new Error('Ungültiger Status');
          store.toggleShoppingItem(shoppingItem[1], payload.checked);
          jsonResponse(res, 200, { ok: true });
        } catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    const shoppingStore = pathname.match(/^\/api\/shopping\/stores\/([a-z0-9-]{1,64})$/);
    if (shoppingStore && req.method === 'DELETE') {
      store.deleteShoppingStore(shoppingStore[1]);
      return jsonResponse(res, 200, { ok: true });
    }
    if (pathname === '/api/reminders' && req.method === 'POST') {
      return readSmallJson(req, res, (payload) => {
        try { jsonResponse(res, 201, { ok: true, item: store.addReminder(payload?.who, payload?.title, payload?.due) }); }
        catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    if (pathname === '/api/shopping/items' && req.method === 'POST') {
      return readSmallJson(req, res, (payload) => {
        try { jsonResponse(res, 201, { ok: true, item: store.addShoppingItem(payload?.store, payload?.title) }); }
        catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    if (pathname === '/api/shopping/stores' && req.method === 'POST') {
      return readSmallJson(req, res, (payload) => {
        try {
          store.addShoppingStore(payload?.id, payload?.label);
          jsonResponse(res, 201, { ok: true });
        } catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    jsonResponse(res, 404, { error: 'Route nicht gefunden' });
  } catch (error) {
    jsonResponse(res, 422, { error: error instanceof Error ? error.message : 'Daten konnten nicht gespeichert werden' });
  }
}

function proxyAce(req, res, path, upstreamHost, upstreamPort, body = null) {
  const headers = { accept: req.headers.accept || '*/*' };
  if (body !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(body);
  }
  const upstream = http.request({
    hostname: upstreamHost, port: upstreamPort, method: req.method, path, headers,
  }, (upstreamResponse) => {
    const responseHeaders = { 'cache-control': 'no-store' };
    for (const name of ['content-type', 'content-length', 'content-disposition', 'accept-ranges']) {
      if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
    }
    res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(res);
  });
  upstream.on('error', () => jsonResponse(res, 502, { error: 'ACE-Step ist nicht erreichbar' }));
  req.on('aborted', () => upstream.destroy());
  upstream.end(body ?? undefined);
}

function readSongJson(req, res, callback) {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > SONG_BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) return jsonResponse(res, 413, { error: 'Songidee ist zu groß' });
    try { callback(JSON.parse(body)); }
    catch { jsonResponse(res, 400, { error: 'Ungültige Song-Anfrage' }); }
  });
}

export function buildSongPlanMessages({ idea, style, era, voice, experimental }) {
  return [
    {
      role: 'system',
      content: [
        'Du schreibst Liedtexte für eine deutsche Songgenerierung.',
        'Antworte ausschließlich als valides JSON mit den Schlüsseln caption und lyrics.',
        'caption ist eine präzise englische Produktionsbeschreibung für ein Musikmodell.',
        'lyrics ist ein vollständig ausformulierter, verständlicher deutscher Liedtext.',
        'Verwende mindestens [Verse 1], [Chorus] und [Verse 2].',
        'Keine Fantasiesprache, keine Lautmalerei außer wenn sie ausdrücklich gewünscht wurde.',
        'Der Refrain muss die zentrale Idee des Nutzers klar und wiedererkennbar aufgreifen.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Thema: ${idea}\nStil: ${style}\nEpoche: ${era}\nStimme: ${voice}\nExperimentiergrad: ${experimental}%`,
    },
  ];
}

export function parseSongPlan(content) {
  const normalized = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let plan;
  try { plan = JSON.parse(normalized); } catch { return null; }
  const caption = typeof plan?.caption === 'string' ? plan.caption.trim() : '';
  const lyrics = typeof plan?.lyrics === 'string' ? plan.lyrics.trim() : '';
  if (caption.length < 20 || caption.length > 2_000 || lyrics.length < 80 || lyrics.length > 8_000) return null;
  if (!/\[Verse 1\]/i.test(lyrics) || !/\[Chorus\]/i.test(lyrics) || !/\[Verse 2\]/i.test(lyrics)) return null;
  return { caption, lyrics };
}

export function buildAceSongRequest({ idea, style, era, voice, experimental }, plan = null) {
  const instrumental = voice === 'Instrumental';
  const intensity = experimental < 34 ? 'accessible' : experimental < 67 ? 'creative' : 'experimental';
  return {
    prompt: instrumental
      ? `${style}, ${era}, instrumental, no vocals, ${intensity} arrangement. ${idea}`
      : plan.caption,
    lyrics: instrumental ? '[Instrumental]' : plan.lyrics,
    thinking: true,
    vocal_language: instrumental ? 'unknown' : 'de',
    audio_format: 'mp3',
    batch_size: 1,
    inference_steps: 8,
    lm_temperature: 0.55 + experimental * 0.004,
    use_cot_caption: false,
    use_cot_language: false,
  };
}

function requestSongPlan(payload, upstreamHost, upstreamPort, callback) {
  const upstreamBody = JSON.stringify({
    model: SONG_LYRICS_MODEL,
    messages: buildSongPlanMessages(payload),
    stream: false,
    temperature: 0.4,
    max_tokens: 1_600,
    reasoning_effort: 'none',
  });
  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(upstreamBody) },
  }, (upstreamResponse) => {
    let body = '';
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024) upstreamResponse.destroy();
    });
    upstreamResponse.on('end', () => {
      let response;
      try { response = JSON.parse(body); } catch { response = null; }
      const plan = parseSongPlan(response?.choices?.[0]?.message?.content);
      callback(plan, plan ? null : 'Der deutsche Liedtext konnte nicht erstellt werden.');
    });
  });
  upstream.setTimeout(90_000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => callback(null, 'Der Liedtext-Dienst ist nicht erreichbar.'));
  upstream.end(upstreamBody);
}

function isSongId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

export function createSongLibrary(
  directory = SONG_LIBRARY_DIR,
  catalogPath = SONG_LIBRARY_PATH,
  sourceRoot = ACESTEP_AUDIO_ROOT,
) {
  function read() {
    try {
      const parsed = JSON.parse(readFileSync(catalogPath, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((song) => song && isSongId(song.id)) : [];
    } catch { return []; }
  }
  function write(songs) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${catalogPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(songs, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, catalogPath);
    chmodSync(catalogPath, 0o600);
  }
  function publicSong(song) {
    return { ...song, audioUrl: `/api/songs/library/${song.id}/audio` };
  }
  function list() {
    return read().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicSong);
  }
  function register(payload) {
    const id = typeof payload?.id === 'string' ? payload.id : '';
    const sourceAudioUrl = typeof payload?.sourceAudioUrl === 'string' ? payload.sourceAudioUrl : '';
    if (!isSongId(id)) return { error: 'Ungültige Song-ID' };
    let sourcePath = '';
    try {
      const parsed = new URL(sourceAudioUrl, 'http://hmi.local');
      if (parsed.pathname !== '/api/songs/audio') return { error: 'Ungültige Audioquelle' };
      sourcePath = resolve(parsed.searchParams.get('path') || '');
    } catch { return { error: 'Ungültige Audioquelle' }; }
    const root = resolve(sourceRoot);
    if (!sourcePath.startsWith(`${root}${sep}`) || !sourcePath.toLowerCase().endsWith('.mp3') || !existsSync(sourcePath)) {
      return { error: 'Audiodatei wurde nicht gefunden' };
    }
    const fields = ['title', 'idea', 'style', 'era', 'voice', 'createdAt'];
    if (fields.some((field) => typeof payload?.[field] !== 'string' || payload[field].length > 800)) {
      return { error: 'Ungültige Song-Metadaten' };
    }
    const duration = Number(payload?.duration);
    if (!Number.isFinite(duration) || duration < 0 || duration > 3_600) return { error: 'Ungültige Songdauer' };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const targetPath = resolve(directory, `${id}.mp3`);
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, 0o600);
    const song = {
      id,
      title: payload.title.trim() || 'Unbenannter Song',
      idea: payload.idea.trim(),
      style: payload.style,
      era: payload.era,
      voice: payload.voice,
      duration,
      createdAt: payload.createdAt,
    };
    write([song, ...read().filter((entry) => entry.id !== id)]);
    return { song: publicSong(song) };
  }
  function remove(id) {
    if (!isSongId(id)) return false;
    const songs = read();
    if (!songs.some((song) => song.id === id)) return false;
    write(songs.filter((song) => song.id !== id));
    const audioPath = resolve(directory, `${id}.mp3`);
    if (existsSync(audioPath)) unlinkSync(audioPath);
    return true;
  }
  function rename(id, title) {
    if (!isSongId(id)) return { error: 'Ungültige Song-ID' };
    const normalizedTitle = typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
    if (!normalizedTitle || normalizedTitle.length > 120) return { error: 'Ungültiger Songtitel' };
    const songs = read();
    const index = songs.findIndex((song) => song.id === id);
    if (index < 0) return { error: 'Song wurde nicht gefunden', notFound: true };
    songs[index] = { ...songs[index], title: normalizedTitle };
    write(songs);
    return { song: publicSong(songs[index]) };
  }
  function audioPath(id) {
    if (!isSongId(id) || !read().some((song) => song.id === id)) return null;
    const path = resolve(directory, `${id}.mp3`);
    return existsSync(path) ? path : null;
  }
  return { audioPath, list, register, remove, rename };
}

function serveLibraryAudio(req, res, path) {
  const size = statSync(path).size;
  const range = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Number(range[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    'content-type': 'audio/mpeg',
    'content-length': end - start + 1,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400',
    ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path, { start, end }).pipe(res);
}

function serveSongs(req, res, target, upstreamHost, upstreamPort, lyricsHost, lyricsPort, library) {
  if (target.kind === 'health' || target.kind === 'audio') {
    proxyAce(req, res, target.path, upstreamHost, upstreamPort);
    return;
  }
  if (target.kind === 'library' && req.method === 'GET') {
    jsonResponse(res, 200, { songs: library.list() });
    return;
  }
  if (target.kind === 'library-audio') {
    const path = library.audioPath(target.id);
    if (!path) jsonResponse(res, 404, { error: 'Song wurde nicht gefunden' });
    else serveLibraryAudio(req, res, path);
    return;
  }
  if (target.kind === 'library-item' && req.method === 'DELETE') {
    if (!library.remove(target.id)) jsonResponse(res, 404, { error: 'Song wurde nicht gefunden' });
    else jsonResponse(res, 200, { ok: true });
    return;
  }
  readSongJson(req, res, (payload) => {
    if (target.kind === 'library-item') {
      const result = library.rename(target.id, payload?.title);
      if (result.error) jsonResponse(res, result.notFound ? 404 : 400, { error: result.error });
      else jsonResponse(res, 200, result);
      return;
    }
    if (target.kind === 'library') {
      const result = library.register(payload);
      if (result.error) jsonResponse(res, 400, { error: result.error });
      else jsonResponse(res, 201, result);
      return;
    }
    if (target.kind === 'status') {
      const taskId = typeof payload?.taskId === 'string' ? payload.taskId : '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
        jsonResponse(res, 400, { error: 'Ungültige Song-ID' });
        return;
      }
      proxyAce(req, res, target.path, upstreamHost, upstreamPort, JSON.stringify({ task_id_list: [taskId] }));
      return;
    }

    const idea = typeof payload?.idea === 'string' ? payload.idea.trim() : '';
    const style = SONG_STYLES.has(payload?.style) ? payload.style : null;
    const era = SONG_ERAS.has(payload?.era) ? payload.era : null;
    const voice = SONG_VOICES.has(payload?.voice) ? payload.voice : null;
    const experimental = Number(payload?.experimental);
    if (!idea || idea.length > 800 || !style || !era || !voice || !Number.isFinite(experimental) || experimental < 0 || experimental > 100) {
      jsonResponse(res, 400, { error: 'Songparameter sind ungültig' });
      return;
    }
    const song = { idea, style, era, voice, experimental };
    if (voice === 'Instrumental') {
      proxyAce(req, res, target.path, upstreamHost, upstreamPort, JSON.stringify(buildAceSongRequest(song)));
      return;
    }
    requestSongPlan(song, lyricsHost, lyricsPort, (plan, planError) => {
      if (!plan) {
        jsonResponse(res, 502, { error: planError });
        return;
      }
      proxyAce(req, res, target.path, upstreamHost, upstreamPort, JSON.stringify(buildAceSongRequest(song, plan)));
    });
  });
}

function ablageCookie(req, value, maxAge) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.socket.encrypted || forwarded === 'https' ? '; Secure' : '';
  return `hmi_ablage=${value}; Path=/api/ablage; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function paperlessTargetPath(url) {
  const parsed = new URL(url, 'http://hmi.local');
  if (parsed.pathname === '/api/ablage/documents/import' && !parsed.search) {
    return { kind: 'upload', path: '/api/documents/post_document/' };
  }
  if (parsed.pathname === '/api/ablage/tasks' && !parsed.search) {
    return { kind: 'tasks', path: '/api/tasks/?page=1&page_size=100&ordering=-date_created&task_name=consume_file' };
  }
  if (parsed.pathname === '/api/ablage/documents') {
    const query = (parsed.searchParams.get('query') || '').trim().slice(0, 200);
    const page = Math.max(1, Math.min(1000, Number(parsed.searchParams.get('page')) || 1));
    const search = new URLSearchParams({ page: String(page), page_size: '30', ordering: '-created' });
    if (query) search.set('query', query);
    for (const [source, target] of [['from', 'created__date__gte'], ['to', 'created__date__lte']]) {
      const value = parsed.searchParams.get(source) || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) search.set(target, value);
    }
    return { kind: 'documents', path: `/api/documents/?${search}` };
  }
  const match = parsed.pathname.match(/^\/api\/ablage\/documents\/(\d+)\/(thumb|preview|download)$/);
  if (!match) return null;
  return { kind: match[2], path: `/api/documents/${match[1]}/${match[2]}/` };
}

function proxyPaperless(req, res, target, access, upstreamHost, upstreamPort) {
  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: 'GET',
    path: target.path,
    headers: { accept: req.headers.accept || '*/*', authorization: `Token ${access.token}` },
  }, (upstreamResponse) => {
    if (!['documents', 'tasks'].includes(target.kind)) {
      const responseHeaders = { 'cache-control': 'private, no-store' };
      for (const name of ['content-type', 'content-length', 'content-disposition']) {
        if (upstreamResponse.headers[name] !== undefined) responseHeaders[name] = upstreamResponse.headers[name];
      }
      res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(res);
      return;
    }
    let body = '';
    upstreamResponse.setEncoding('utf8');
    upstreamResponse.on('data', (chunk) => { body += chunk; });
    upstreamResponse.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch { payload = null; }
      if (!payload || !Array.isArray(payload.results)) {
        jsonResponse(res, upstreamResponse.statusCode || 502, { error: 'Paperless-Antwort ungültig' });
        return;
      }
      if (target.kind === 'tasks') {
        const activeStates = new Set(['PENDING', 'RECEIVED', 'STARTED', 'RETRY']);
        jsonResponse(res, upstreamResponse.statusCode || 200, {
          processing: payload.results
            .filter((task) => task.task_name === 'consume_file' && activeStates.has(task.status))
            .map((task) => ({
              id: String(task.task_id || task.id),
              fileName: task.task_file_name || null,
              status: task.status,
            })),
        });
        return;
      }
      jsonResponse(res, upstreamResponse.statusCode || 200, {
        count: Number(payload.count) || payload.results.length,
        next: Boolean(payload.next),
        previous: Boolean(payload.previous),
        results: payload.results.map((document) => ({
          id: document.id,
          title: document.title || document.original_file_name || `Dokument ${document.id}`,
          created: document.created || null,
          added: document.added || null,
          archiveSerialNumber: document.archive_serial_number ?? null,
          originalFileName: document.original_file_name || null,
        })),
      });
    });
  });
  upstream.on('error', () => jsonResponse(res, 502, { error: 'Paperless nicht erreichbar' }));
  req.on('aborted', () => upstream.destroy());
  upstream.end();
}

function proxyPaperlessUpload(req, res, target, access, upstreamHost, upstreamPort) {
  const contentType = String(req.headers['content-type'] || '');
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (!contentType.toLowerCase().startsWith('multipart/form-data; boundary=')) {
    jsonResponse(res, 415, { error: 'Datei-Upload muss multipart/form-data verwenden' });
    return;
  }
  if (declaredLength > ABLAGE_UPLOAD_MAX) {
    jsonResponse(res, 413, { error: 'Datei ist größer als 50 MiB' });
    return;
  }

  let received = 0;
  let settled = false;
  const upstream = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    method: 'POST',
    path: target.path,
    headers: {
      accept: 'application/json',
      authorization: `Token ${access.token}`,
      'content-type': contentType,
      ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}),
    },
  }, (upstreamResponse) => {
    upstreamResponse.resume();
    upstreamResponse.on('end', () => {
      if (settled) return;
      settled = true;
      const status = upstreamResponse.statusCode || 502;
      if (status >= 200 && status < 300) {
        jsonResponse(res, 202, { imported: true });
      } else {
        jsonResponse(res, status, { error: 'Paperless hat die Datei abgelehnt' });
      }
    });
  });
  upstream.on('error', () => {
    if (settled) return;
    settled = true;
    jsonResponse(res, 502, { error: 'Paperless nicht erreichbar' });
  });
  req.on('data', (chunk) => {
    received += chunk.length;
    if (received <= ABLAGE_UPLOAD_MAX || settled) return;
    settled = true;
    req.unpipe(upstream);
    upstream.destroy();
    req.resume();
    jsonResponse(res, 413, { error: 'Datei ist größer als 50 MiB' });
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function serveAblage(req, res, access, upstreamHost, upstreamPort) {
  const parsed = new URL(req.url || '/', 'http://hmi.local');
  if (parsed.pathname === '/api/ablage/status' && req.method === 'GET') {
    jsonResponse(res, 200, { configured: access.configured(), unlocked: access.authenticated(req) });
    return;
  }
  if (parsed.pathname === '/api/ablage/unlock' && req.method === 'POST') {
    if (!access.configured()) return jsonResponse(res, 503, { error: 'Ablage ist noch nicht konfiguriert' });
    readSmallJson(req, res, (payload) => {
      const result = access.unlock(payload?.pin, req.socket.remoteAddress || '');
      if (!result.ok) {
        jsonResponse(res, result.limited ? 429 : 401, {
          error: result.limited ? 'Zu viele Versuche. Bitte kurz warten.' : 'PIN ist nicht korrekt',
        });
        return;
      }
      jsonResponse(res, 200, { unlocked: true }, { 'set-cookie': ablageCookie(req, result.session, ABLAGE_SESSION_MS / 1000) });
    });
    return;
  }
  if (parsed.pathname === '/api/ablage/lock' && req.method === 'POST') {
    access.lock(req);
    jsonResponse(res, 200, { unlocked: false }, { 'set-cookie': ablageCookie(req, '', 0) });
    return;
  }
  const target = paperlessTargetPath(req.url || '/');
  if (target?.kind === 'upload' && req.method === 'POST') {
    if (!access.configured()) return jsonResponse(res, 503, { error: 'Ablage ist noch nicht konfiguriert' });
    if (!access.authenticated(req)) return jsonResponse(res, 401, { error: 'PIN erforderlich' });
    proxyPaperlessUpload(req, res, target, access, upstreamHost, upstreamPort);
    return;
  }
  if (target && req.method === 'GET') {
    if (!access.configured()) return jsonResponse(res, 503, { error: 'Ablage ist noch nicht konfiguriert' });
    if (!access.authenticated(req)) return jsonResponse(res, 401, { error: 'PIN erforderlich' });
    proxyPaperless(req, res, target, access, upstreamHost, upstreamPort);
    return;
  }
  jsonResponse(res, 404, { error: 'Ablage-Route nicht gefunden' });
}

function proxyAmbient(req, res, upstreamHost, upstreamPort, mode = 'ambient') {
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > AMBIENT_BODY_MAX) oversized = true;
  });
  req.on('end', () => {
    if (oversized) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ambient-Anfrage zu groß"}');
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const messages = Array.isArray(payload?.messages) ? payload.messages : null;
    const valid = messages && messages.length >= 1 && messages.length <= 4
      && messages.every((message) => message && ['system', 'user'].includes(message.role)
        && typeof message.content === 'string' && message.content.length <= 16_000);
    if (!valid) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ungültiger Ambient-Kontext"}');
      return;
    }
    const upstreamBody = JSON.stringify({
      model: AMBIENT_MODEL,
      messages,
      stream: false,
      temperature: mode === 'shopping' ? 0.1 : 0.85,
      top_p: mode === 'shopping' ? 1 : 0.9,
      max_tokens: mode === 'shopping' ? 2_000 : 80,
      ...(mode === 'shopping' ? { reasoning_effort: 'none' } : {}),
    });
    const upstream = http.request({
      hostname: upstreamHost,
      port: upstreamPort,
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(upstreamBody) },
    }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, {
        'content-type': upstreamResponse.headers['content-type'] || 'application/json; charset=utf-8',
      });
      upstreamResponse.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ambient-Modell nicht erreichbar"}');
    });
    upstream.end(upstreamBody);
  });
}

export function staticCacheControl(path) {
  const extension = extname(path).toLowerCase();
  const mutablePwaResource = extension === '.html'
    || extension === '.webmanifest'
    || path.endsWith(`${sep}sw.js`);
  return mutablePwaResource ? 'no-cache' : 'public, max-age=31536000, immutable';
}

function serveStatic(req, res, staticRoot = DIST) {
  const root = resolve(staticRoot);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let path;
  try { path = staticPathFor(req.url || '/', root); } catch { path = null; }
  if (!path) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = resolve(path, 'index.html');
  if (!existsSync(path) || !statSync(path).isFile()) path = resolve(root, 'index.html');
  const extension = extname(path).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME.get(extension) || 'application/octet-stream',
    'cache-control': staticCacheControl(path),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path).pipe(res);
}

export function createHmiServer(
  key = readHermesKey(),
  {
    upstreamHost = HERMES_HOST,
    upstreamPort = HERMES_PORT,
    aiCustomizingEnabled = AI_CUSTOMIZING_ENABLED,
    ambientHost = AMBIENT_HOST,
    ambientPort = AMBIENT_PORT,
    notionBridgeHost = NOTION_BRIDGE_HOST,
    notionBridgePort = NOTION_BRIDGE_PORT,

    paperlessHost = PAPERLESS_HOST,
    paperlessPort = PAPERLESS_PORT,
    aceStepHost = ACESTEP_HOST,
    aceStepPort = ACESTEP_PORT,
    songLibrary = null,
    paperlessPin = readKeychainSecret(ABLAGE_PIN_ACCOUNT, ABLAGE_KEYCHAIN_SERVICE),
    paperlessToken = readKeychainSecret(ABLAGE_TOKEN_ACCOUNT, ABLAGE_KEYCHAIN_SERVICE),
    allowedOrigins = ALLOWED_ORIGINS,
    configPath = CONFIG_PATH,
    householdConfigPath = HOUSEHOLD_CONFIG_PATH,
    householdConfigMode = process.env.HMI_HOUSEHOLD_CONFIG_MODE,
    householdConfigMigrationResult = null,
    staticRoot = DIST,
    requiredWritableDirs = REQUIRED_WRITABLE_DIRS,
    notionShoppingPath = NOTION_SHOPPING_PATH,
    familyDataPath = FAMILY_DATA_PATH,
    familyData = null,
    setupConnectionVerifier = verifySetupHomeAssistant,
    setupJellyfinVerifier = verifySetupJellyfin,
  } = {},
) {
  const normalizedHouseholdConfigMode = normalizeHouseholdConfigMode(householdConfigMode);
  const migrationResult = householdConfigMigrationResult ?? (
    normalizedHouseholdConfigMode === 'active'
      ? migrateHouseholdConfigFile(householdConfigPath)
      : { ok: true, status: 'shadow' }
  );
  const configStore = createCentralConfigStore(configPath);
  const householdConfigReader = createHouseholdConfigReader(householdConfigPath);
  const familyStore = familyData || createFamilyDataStore(familyDataPath);
  const ablageAccess = createAblageAccess(paperlessPin, paperlessToken);
  const library = songLibrary || createSongLibrary();
  return http.createServer((req, res) => {
    const readinessOptions = {
      staticRoot,
      householdConfigPath,
      householdConfigMode: normalizedHouseholdConfigMode,
      requiredWritableDirs,
      migrationResult,
    };
    const readiness = assessHmiReadiness(readinessOptions);
    const setupIsRequired = readiness.payload.status === 'setup_required';
    const targetPath = aiCustomizingEnabled ? proxyTargetPath(req.url || '/') : null;
    const notionTargetPath = notionBridgeTargetPath(req.url || '/');

    const songTarget = songTargetPath(req.url || '/');
    const familyDataRoute = (req.url || '').startsWith('/api/reminders');
    if ((req.url || '') === '/api/health') {
      serveHmiHealth(req, res, readinessOptions);
    } else if (!aiCustomizingEnabled && (req.url || '').startsWith('/hermes')) {
      jsonResponse(res, 404, { error: 'Route nicht gefunden' });
    } else if (!migrationResult.ok && ((req.url || '').startsWith('/api/')
        || (req.url || '').startsWith('/hermes')
        || (req.url || '').startsWith('/ambient-llm')
        || (req.url || '').startsWith('/shopping-llm')
        || (req.url || '').startsWith('/notion-bridge'))) {
      jsonResponse(res, 503, {
        ok: false,
        status: 'not_ready',
        code: readiness.payload.code,
        message: readiness.payload.message,
      }, { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedHouseholdConfigMode });
    } else if (setupIsRequired && (req.url || '') === '/api/setup/activate'
        && setupRequestAllowed(req, allowedOrigins)) {
      serveSetupActivation(req, res, {
        configStore,
        householdConfigPath,
        setupConnectionVerifier,
        setupJellyfinVerifier,
      });
    } else if (!setupIsRequired && readiness.ok
        && normalizedHouseholdConfigMode === 'active'
        && (req.url || '') === '/api/setup/activate'
        && setupRequestAllowed(req, allowedOrigins)) {
      serveSetupActivation(req, res, {
        configStore,
        householdConfigPath,
        setupConnectionVerifier,
        setupJellyfinVerifier,
        reconfigure: true,
      });
    } else if ((req.url || '') === '/api/setup/activate') {
      jsonResponse(res, 403, {
        ok: false,
        code: 'SETUP_REQUEST_FORBIDDEN',
        message: 'Die Setup-Anfrage ist nicht freigegeben.',
      });
    } else if (setupIsRequired && ((req.url || '').startsWith('/api/')
        || (req.url || '').startsWith('/hermes')
        || (req.url || '').startsWith('/ambient-llm')
        || (req.url || '').startsWith('/shopping-llm')
        || (req.url || '').startsWith('/notion-bridge'))) {
      jsonResponse(res, 503, {
        ok: false,
        code: 'SETUP_REQUIRED',
        message: 'Die Ersteinrichtung muss zuerst abgeschlossen werden.',
      });
    } else if (familyDataRoute && familyDataRequestAllowed(req, allowedOrigins)) {
      serveFamilyData(req, res, familyStore);
    } else if (familyDataRoute) {
      jsonResponse(res, 403, { error: 'Familiendaten-Route nicht freigegeben' });
    } else if (notionTargetPath !== null
        && notionBridgeRequestAllowed(req, notionTargetPath, allowedOrigins)) {
      proxyNotionBridge(req, res, notionTargetPath, notionBridgeHost, notionBridgePort);
    } else if ((req.url || '').startsWith('/notion-bridge')) {
      jsonResponse(res, 403, { error: 'Notion-Bridge-Route nicht freigegeben' });
    } else if ((req.url || '') === '/notion-shopping.json' && req.method === 'GET') {
      serveNotionShopping(res, notionShoppingPath);
    } else if ((req.url || '').startsWith('/notion-shopping.json')) {
      jsonResponse(res, 405, { error: 'Notion-Snapshot ist ausschließlich per GET lesbar' }, { allow: 'GET' });
    } else if ((req.url || '').startsWith('/api/shopping')) {
      jsonResponse(res, 410, { error: 'Einkaufsliste wird über die Notion-Bridge synchronisiert' });
    } else if (songTarget && songRequestAllowed(req, songTarget, allowedOrigins)) {
      serveSongs(req, res, songTarget, aceStepHost, aceStepPort, ambientHost, ambientPort, library);
    } else if ((req.url || '').startsWith('/api/songs')) {
      jsonResponse(res, 403, { error: 'Song-Route nicht freigegeben' });
    } else if ((req.url || '').startsWith('/api/ablage/') && ablageRequestAllowed(req, allowedOrigins)) {
      serveAblage(req, res, ablageAccess, paperlessHost, paperlessPort);
    } else if ((req.url || '').startsWith('/api/ablage')) {
      jsonResponse(res, 403, { error: 'Ablage-Route nicht freigegeben' });
    } else if ((req.url || '') === '/api/household-config-mode'
        && householdConfigRequestAllowed(req, allowedOrigins)) {
      serveHouseholdConfigMode(req, res, normalizedHouseholdConfigMode);
    } else if ((req.url || '') === '/api/household-config-mode') {
      jsonResponse(
        res,
        403,
        { code: 'HOUSEHOLD_CONFIG_MODE_FORBIDDEN', message: 'Haushaltsmodusroute nicht freigegeben.' },
        { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedHouseholdConfigMode },
      );
    } else if ((req.url || '') === '/api/household-config'
        && householdConfigRequestAllowed(req, allowedOrigins)) {
      serveHouseholdConfig(req, res, householdConfigReader, normalizedHouseholdConfigMode);
    } else if ((req.url || '') === '/api/household-config') {
      const origin = req.headers.origin;
      if (!origin || allowedOrigins.has(origin)) {
        serveHouseholdConfig(req, res, householdConfigReader, normalizedHouseholdConfigMode);
      } else {
        jsonResponse(
          res,
          403,
          { code: 'HOUSEHOLD_CONFIG_FORBIDDEN', message: 'Haushaltskonfigurationsroute nicht freigegeben.' },
          { [HOUSEHOLD_CONFIG_MODE_HEADER]: normalizedHouseholdConfigMode },
        );
      }
    } else if ((req.url || '') === '/api/config' && configRequestAllowed(req, allowedOrigins)) {
      serveConfig(req, res, configStore);
    } else if ((req.url || '').startsWith('/api/config')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfigurationsroute nicht freigegeben"}');
    } else if ((req.url || '') === '/shopping-llm/v1/chat/completions'
        && ambientRequestAllowed(req, allowedOrigins)) {
      proxyAmbient(req, res, ambientHost, ambientPort, 'shopping');
    } else if ((req.url || '').startsWith('/shopping-llm')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Shopping-Route nicht freigegeben"}');
    } else if ((req.url || '') === '/ambient-llm/v1/chat/completions'
        && ambientRequestAllowed(req, allowedOrigins)) {
      proxyAmbient(req, res, ambientHost, ambientPort);
    } else if ((req.url || '').startsWith('/ambient-llm')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Ambient-Route nicht freigegeben"}');
    } else if (targetPath !== null && proxyRequestAllowed(req, allowedOrigins)) {
      if (!key) {
        jsonResponse(res, 503, { error: 'Hermes-Integration ist nicht konfiguriert' });
      } else {
        proxy(req, res, key, targetPath, upstreamHost, upstreamPort);
      }
    } else if ((req.url || '').startsWith('/hermes')) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Hermes-Route nicht freigegeben"}');
    } else {
      serveStatic(req, res, staticRoot);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let server;
  try {
    const householdConfigMode = normalizeHouseholdConfigMode(process.env.HMI_HOUSEHOLD_CONFIG_MODE);
    const migrationResult = householdConfigMode === 'active'
      ? migrateHouseholdConfigFile(HOUSEHOLD_CONFIG_PATH)
      : { ok: true, status: 'shadow' };
    const readiness = assessHmiReadiness({ householdConfigMode, migrationResult });
    if (!readiness.ok) {
      const issue = readiness.payload.issue;
      const issueText = issue ? ` ${issue.path}: ${issue.message}` : '';
      throw new Error(`[${readiness.payload.code}] ${readiness.payload.message}${issueText}`);
    }
    server = createHmiServer(undefined, {
      householdConfigMode,
      householdConfigMigrationResult: migrationResult,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'HMI-Server konnte nicht starten.');
    process.exit(1);
  }
  server.listen(PORT, HOST, () => console.log(`Smart Home HMI hört auf ${HOST}:${PORT}`));
}
