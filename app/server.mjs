import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  accessSync, chmodSync, closeSync, constants as fsConstants, copyFileSync, createReadStream, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { isIP } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HA_SUPERVISOR_CORE_URL,
  HA_SUPERVISOR_WEBSOCKET_URL,
  createHaSupervisorClient,
  parseHaConnectionMode,
  readHaDiscoverySnapshot,
  readSupervisorToken,
  redactSupervisorToken,
} from './server/ha-supervisor.mjs';
import { HA_GATEWAY_PATH, createHaWebSocketGateway } from './server/ha-gateway.mjs';

const SERVER_CONTRACT_COMPILED = process.env.HMI_SERVER_CONTRACT === 'compiled';
const serverContractBase = SERVER_CONTRACT_COMPILED ? './server-contract' : './src/lib/config';
const serverContractExtension = SERVER_CONTRACT_COMPILED ? 'js' : 'ts';
const roomImageContractBase = SERVER_CONTRACT_COMPILED ? './room-image-contract' : './src/lib/room-images';
const roomImageContractExtension = SERVER_CONTRACT_COMPILED ? 'js' : 'ts';
const { compileHouseholdConfig, parseHouseholdConfig } = await import(
  `${serverContractBase}/household-config.${serverContractExtension}`
);
const { migrateHouseholdConfigDocument } = await import(
  `${serverContractBase}/household-config-migration.${serverContractExtension}`
);
const { projectActiveHouseholdData } = await import(
  `${serverContractBase}/household-runtime-data.${serverContractExtension}`
);
const { resolveBuildInfo } = await import(
  `${serverContractBase}/build-info.${serverContractExtension}`
);
const {
  findOverlappingStays,
  guestVisibleEntityIds,
  projectGuestAccess,
  projectGuestEntityState,
  projectStays,
  resolveGuestServiceCall,
  selectStayStatus,
} = await import(
  `${serverContractBase}/hotel-mode-policy.${serverContractExtension}`
);
const {
  ROOM_IMAGE_TRANSFORM_POLICY_V1,
  RoomImageTransformError,
  assertProviderInputSize,
  normalizeUploadedRoomImage,
  providerPngToFinalAvif,
  providerPngToProviderJpeg,
  snapRoomImageCrop,
  sourceCropToProviderJpeg,
  sourceFullToProviderJpeg,
} = await import(`${roomImageContractBase}/room-image-transform-policy-v1.${roomImageContractExtension}`);
const {
  ROOM_IMAGE_PROMPT_POLICY_V1,
  buildRoomImagePrompt,
  validateRoomImagePromptSpec,
} = await import(`${roomImageContractBase}/room-image-prompt-policy-v1.${roomImageContractExtension}`);
const { default: sharp } = await import('sharp');

/* B-08E11: Betriebsart des Home-Assistant-Zugangs. `direct` ist der heutige
   Browser-zu-HA-Pfad mit Long-Lived Access Token und bleibt der Default für
   Compose und Entwicklung. `supervisor` ist der interne HA-Core-Zugang der
   Home-Assistant-App. Ein ungültiger Wert bricht den Start ab, statt still auf
   `direct` zurückzufallen. */
export const HA_CONNECTION_MODE = parseHaConnectionMode(process.env.HMI_HA_CONNECTION_MODE);
export { createHaSupervisorClient, createHaWebSocketGateway, parseHaConnectionMode, readHaDiscoverySnapshot, redactSupervisorToken };

const HOST = process.env.HMI_HOST || '0.0.0.0';
const PORT = Number(process.env.HMI_PORT || 4173);
/* Herkunft der laufenden Fassung (AGPL §13). Version aus dem mitgelieferten
   Paketmanifest, Revision und Source-URL aus der Deployment-Umgebung — ein
   Fork muss auf seinen eigenen Corresponding Source zeigen können. */
const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '';
  }
})();
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
const HOTEL_MODE_DATA_PATH = process.env.HMI_HOTEL_MODE_DATA_PATH || null;
const HOTEL_MODE_DATA_VERSION = 1;
const HOTEL_ADMIN_SESSION_MS = 15 * 60 * 1000;
const HOTEL_ADMIN_BODY_MAX = 1024;
const HOTEL_ADMIN_PIN_PATTERN = /^\d{6,12}$/;
const HOTEL_ADMIN_ATTEMPTS_PER_BLOCK = 5;
const HOTEL_ADMIN_BLOCK_BASE_MS = 60 * 1000;
const HOTEL_ADMIN_BLOCK_MAX_MS = 15 * 60 * 1000;
const HOTEL_ADMIN_SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const HOTEL_MODE_CACHE_MAX_STAYS = 32;
const HOTEL_CALENDAR_CACHE_MS = 10 * 60 * 1000;
const HOTEL_CALENDAR_LOOKBEHIND_MS = 2 * 24 * 60 * 60 * 1000;
const HOTEL_CALENDAR_LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const HOTEL_CALENDAR_TIMEOUT_MS = 5 * 1000;
const HOTEL_CALENDAR_BODY_MAX = 512 * 1024;
const HOTEL_STATE_TIMEOUT_MS = 5 * 1000;
const HOTEL_COMMAND_TIMEOUT_MS = 5 * 1000;
const HOTEL_SETTINGS_BODY_MAX = 64 * 1024;
const HOTEL_STATE_BODY_MAX = 64 * 1024;
/* Ein Gastpanel pollt; die kurze Serversammlung hält Home Assistant aus dem
   Takt der Clients heraus, ohne dass sich eine Bedienung spürbar verzögert. */
const HOTEL_STATE_CACHE_MS = 2 * 1000;
const HOTEL_STATE_MAX_ENTITIES = 64;
const HOTEL_OVERRIDE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
const HOTEL_OVERRIDE_LEAD_MS = 30 * 24 * 60 * 60 * 1000;
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
const SETUP_TRANSACTION_VERSION = 1;
const SETUP_TRANSACTION_DIRECTORY = '.hauser-setup-transactions';
const SETUP_TRANSACTION_JOURNAL_PATTERN = /^setup-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.journal$/;
const SETUP_TRANSACTION_MAX_BYTES = (CONFIG_BODY_MAX + HOUSEHOLD_CONFIG_BODY_MAX) * 4 + 64 * 1024;
const LAUNDRY_BODY_MAX = 16 * 1024;
const LAUNDRY_SESSION_TTL_MS = 2 * 60 * 1000;
const LAUNDRY_BLUEPRINT_PATH = 'hauser/laundry-power-cycle-v1.yaml';
const LAUNDRY_BLUEPRINT_FILE = fileURLToPath(new URL('./public/blueprints/automation/laundry-power-cycle-v1.yaml', import.meta.url));
const REQUIRED_WRITABLE_DIRS = (process.env.HMI_REQUIRED_WRITABLE_DIRS || '')
  .split(',').map((path) => path.trim()).filter(Boolean);
const ROOM_IMAGE_WIZARD_ENABLED = true;
const ROOM_IMAGE_UPLOAD_MAX_BYTES = 12_582_912;
const ROOM_IMAGE_UPLOAD_TTL_MS = 30 * 60 * 1000;
const ROOM_IMAGE_TEST_ROOT_OVERRIDE = process.env.NODE_ENV === 'test'
  && process.env.HMI_ROOM_IMAGE_TEST_ROOT_OVERRIDE === '1';
const ROOM_IMAGE_UPLOAD_ROOT = ROOM_IMAGE_TEST_ROOT_OVERRIDE
  ? process.env.HMI_ROOM_IMAGE_UPLOAD_ROOT || '/tmp/hauser-room-images/uploads'
  : '/tmp/hauser-room-images/uploads';
const ROOM_IMAGE_PROVIDER_MODEL = 'gpt-image-2-2026-04-21';
const ROOM_IMAGE_PROVIDER_MODELS_URL = `https://api.openai.com/v1/models/${ROOM_IMAGE_PROVIDER_MODEL}`;
const ROOM_IMAGE_PROVIDER_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const ROOM_IMAGE_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const ROOM_IMAGE_CODEX_AUTH_URL = 'https://auth.openai.com';
const ROOM_IMAGE_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ROOM_IMAGE_CODEX_TOKEN_URL = `${ROOM_IMAGE_CODEX_AUTH_URL}/oauth/token`;
const ROOM_IMAGE_CODEX_IMAGE_MODEL = 'gpt-image-2';
const ROOM_IMAGE_CREDENTIAL_PATH = process.env.HMI_ROOM_IMAGE_CREDENTIAL_PATH
  || resolve(dirname(CONFIG_PATH), 'room-image-auth.json');
const ROOM_IMAGE_PROVIDER_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ROOM_IMAGE_PROVIDER_MAX_JSON_RESPONSE_BYTES = 100 * 1024 * 1024;
const ROOM_IMAGE_PROVIDER_MAX_BASE64_BYTES = 96 * 1024 * 1024;
const ROOM_IMAGE_PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const ROOM_IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROOM_IMAGE_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_IMAGE_EDIT_DEADLINE_MS = 300_000;
const ROOM_IMAGE_PROBE_DEADLINE_MS = 10_000;
const ROOM_IMAGE_TEMP_ROOT = ROOM_IMAGE_TEST_ROOT_OVERRIDE
  ? process.env.HMI_ROOM_IMAGE_TEMP_ROOT || '/tmp/hauser-room-images'
  : '/tmp/hauser-room-images';
const ROOM_IMAGE_ASSET_ROOT = process.env.HMI_ROOM_IMAGE_ASSET_ROOT || '/assets';
const ROOM_IMAGE_ASSET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
const ROOM_IMAGE_ROOM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const ROOM_IMAGE_VARIANT_FILES = Object.freeze({
  light: 'light.avif', dark: 'dark.avif', darkOff: 'dark-off.avif',
});
const SHARED_CONFIG_KEYS = new Set([
  'hmi:backend', 'hmi:ha-url', 'hmi:ha-token', 'hmi:jf-url', 'hmi:jf-token',
  'hmi:jf-user', 'hmi:library', 'hmi:lock-button',
  'hmi:device-config:v1', 'hmi:scene-config:v1', 'hmi:home-layout:v1',
  'hmi:light-icon-overrides:v1', 'hmi:calendar-selected', 'hmi:reminders-selected',
  'hmi:shopping-config:v1', 'hmi:reminder-persons:v1',
]);
const SHARED_CONFIG_VALUE_MAX = 256 * 1024;

function validSharedConfigValue(value) {
  return typeof value === 'string' && Buffer.byteLength(value) <= SHARED_CONFIG_VALUE_MAX;
}

function validSharedConfigDocument(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => (
      SHARED_CONFIG_KEYS.has(key) && validSharedConfigValue(entry)
    ));
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.woff2', 'font/woff2'], ['.mp4', 'video/mp4'], ['.webm', 'video/webm'],
  /* Der mitgelieferte AGPL-Text soll im Browser lesbar sein, nicht als Download
     landen (AGPL §13-Hinweis unter /legal/). */
  ['.txt', 'text/plain; charset=utf-8'],
]);

function parseStrictIpv4(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part))) {
    throw new Error('Invalid IPv4 address');
  }
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) throw new Error('Invalid IPv4 address');
  return octets.reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
}

function ipv4Text(value) {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.');
}

function expandIpv6(value) {
  let normalized = String(value).toLowerCase();
  if (normalized.includes('.')) {
    const split = normalized.lastIndexOf(':');
    if (split < 0) throw new Error('Invalid IPv6 address');
    const ipv4 = parseStrictIpv4(normalized.slice(split + 1));
    normalized = `${normalized.slice(0, split)}:${((ipv4 >> 16n) & 0xffffn).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }
  if (isIP(normalized) !== 6) throw new Error('Invalid IPv6 address');
  const halves = normalized.split('::');
  if (halves.length > 2) throw new Error('Invalid IPv6 address');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    throw new Error('Invalid IPv6 address');
  }
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    throw new Error('Invalid IPv6 address');
  }
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6Text(value) {
  const groups = Array.from({ length: 8 }, (_, index) => (
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn).toString(16)
  ));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== '0') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === '0') end += 1;
    if (end - index > bestLength && end - index >= 2) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestStart < 0) return groups.join(':');
  const left = groups.slice(0, bestStart).join(':');
  const right = groups.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}

function prefixMask(bits, prefix) {
  if (prefix === 0) return 0n;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
}

export function parseRoomImageCidr(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  const match = value.match(/^([^/]+)\/(\d{1,3})$/);
  if (!match) throw new Error('Invalid CIDR');
  const prefix = Number(match[2]);
  if (match[1].includes(':')) {
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) throw new Error('Invalid IPv6 prefix');
    const address = expandIpv6(match[1]);
    const mapped = (address >> 32n) === 0xffffn;
    if (mapped) {
      if (prefix < 96) throw new Error('IPv4-mapped supernets are forbidden');
      const ipv4Prefix = prefix - 96;
      if (ipv4Prefix === 0) throw new Error('All-network CIDRs are forbidden');
      const network = (address & 0xffffffffn) & prefixMask(32, ipv4Prefix);
      return { family: 4, prefix: ipv4Prefix, network, canonical: `${ipv4Text(network)}/${ipv4Prefix}` };
    }
    if (prefix === 0) throw new Error('All-network CIDRs are forbidden');
    const network = address & prefixMask(128, prefix);
    return { family: 6, prefix, network, canonical: `${ipv6Text(network)}/${prefix}` };
  }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('Invalid IPv4 prefix');
  if (prefix === 0) throw new Error('All-network CIDRs are forbidden');
  const address = parseStrictIpv4(match[1]);
  const network = address & prefixMask(32, prefix);
  return { family: 4, prefix, network, canonical: `${ipv4Text(network)}/${prefix}` };
}

function parseRoomImagePeer(value) {
  const address = String(value || '');
  if (isIP(address) === 4) return { family: 4, value: parseStrictIpv4(address) };
  if (isIP(address) !== 6) return null;
  const parsed = expandIpv6(address);
  if ((parsed >> 32n) === 0xffffn) return { family: 4, value: parsed & 0xffffffffn };
  return { family: 6, value: parsed };
}

export function roomImagePeerAllowed(remoteAddress, cidrs) {
  const peer = parseRoomImagePeer(remoteAddress);
  if (!peer) return false;
  return cidrs.some((cidr) => cidr.family === peer.family
    && (peer.value & prefixMask(peer.family === 4 ? 32 : 128, cidr.prefix)) === cidr.network);
}

const HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function createRoomImageAuthConfig({
  mode = process.env.HMI_ROOM_IMAGE_AUTH_MODE,
  trustedProxyCidrs = process.env.HMI_ROOM_IMAGE_TRUSTED_PROXY_CIDRS,
  identityHeader = process.env.HMI_ROOM_IMAGE_IDENTITY_HEADER,
} = {}) {
  if (mode === 'direct') {
    return { configured: true, mode: 'direct', identityHeader: null, cidrs: [] };
  }
  const normalizedHeader = typeof identityHeader === 'string' ? identityHeader.trim().toLowerCase() : '';
  if (mode !== 'trusted_proxy' || !normalizedHeader || !HTTP_HEADER_NAME.test(normalizedHeader)) {
    return { configured: false, mode: null, identityHeader: null, cidrs: [] };
  }
  const entries = typeof trustedProxyCidrs === 'string'
    ? trustedProxyCidrs.split(',').map((entry) => entry.trim())
    : [];
  if (entries.length === 0 || entries.some((entry) => !entry)) {
    return { configured: false, mode: null, identityHeader: null, cidrs: [] };
  }
  try {
    const cidrs = entries.map(parseRoomImageCidr);
    return { configured: true, mode: 'trusted_proxy', identityHeader: normalizedHeader, cidrs };
  } catch {
    return { configured: false, mode: null, identityHeader: null, cidrs: [] };
  }
}

function rawHeaderValues(req, name) {
  const values = [];
  const raw = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (String(raw[index]).toLowerCase() === name) values.push(String(raw[index + 1]));
  }
  return values;
}

export function normalizeRoomImageIdentity(rawHeaders, headerName) {
  const values = [];
  const rawList = Array.isArray(rawHeaders) ? rawHeaders : [];
  for (let index = 0; index + 1 < rawList.length; index += 2) {
    if (String(rawList[index]).toLowerCase() === headerName) values.push(String(rawList[index + 1]));
  }
  if (values.length !== 1) return null;
  const raw = values[0];
  if (/[,\u0000-\u001f\u007f]/.test(raw)) return null;
  const identity = raw.trim().normalize('NFC');
  const bytes = Buffer.byteLength(identity, 'utf8');
  if (bytes < 1 || bytes > 256 || /[\uD800-\uDFFF]/.test(identity)) return null;
  return identity;
}

function normalizedRoomImageIdentity(req, headerName) {
  return normalizeRoomImageIdentity(req.rawHeaders, headerName);
}

// Same-Origin-Vergleich: Die Origin muss exakt dem effektiven Request-Origin
// aus Protokoll, Host und Port entsprechen.
function sameOriginAsRequest(origin, req) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || !host) return false;
  const protocol = req.socket?.encrypted ? 'https:' : 'http:';
  try {
    const browserOrigin = new URL(origin);
    const requestUrl = new URL(`${protocol}//${host}`);
    const validBrowserOrigin = ['http:', 'https:'].includes(browserOrigin.protocol)
      && !browserOrigin.username && !browserOrigin.password
      && browserOrigin.pathname === '/' && !browserOrigin.search && !browserOrigin.hash
      && browserOrigin.origin === origin;
    const validRequestHost = requestUrl.pathname === '/'
      && !requestUrl.username && !requestUrl.password
      && !requestUrl.search && !requestUrl.hash;
    return validBrowserOrigin && validRequestHost && browserOrigin.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function allowedRoomImageOrigin(req, allowedOrigins) {
  const origins = rawHeaderValues(req, 'origin');
  if (origins.length !== 1) return false;
  const origin = origins[0];
  return allowedOrigins.has(origin) || sameOriginAsRequest(origin, req);
}

class RoomImageUploadStoreError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RoomImageUploadStoreError';
    this.code = code;
  }
}

function roomImageUploadRootError(message, cause = undefined) {
  return new RoomImageUploadStoreError('ROOM_IMAGE_UPLOAD_ROOT_UNSAFE', message, cause);
}

function secureRoomImageUploadDirectory(path) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'EEXIST') {
      throw roomImageUploadRootError('Das Room-Image-Uploadverzeichnis konnte nicht sicher angelegt werden.', error);
    }
  }

  let metadata;
  try {
    metadata = lstatSync(path);
    const expectedRealPath = join(realpathSync(dirname(path)), basename(path));
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(path) !== expectedRealPath) {
      throw roomImageUploadRootError('Das Room-Image-Uploadverzeichnis ist kein echtes Verzeichnis.');
    }
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
      throw roomImageUploadRootError('Das Room-Image-Uploadverzeichnis gehört nicht dem aktuellen Prozessbenutzer.');
    }
    if ((metadata.mode & 0o022) !== 0) {
      throw roomImageUploadRootError('Das Room-Image-Uploadverzeichnis ist gruppen- oder weltbeschreibbar.');
    }
    chmodSync(path, 0o700);
    metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw roomImageUploadRootError('Das Room-Image-Uploadverzeichnis konnte nicht auf 0700 gesichert werden.');
    }
  } catch (error) {
    if (error instanceof RoomImageUploadStoreError) throw error;
    throw roomImageUploadRootError('Das Room-Image-Uploadverzeichnis konnte nicht sicher validiert werden.', error);
  }
}

function isRoomImageOsTempRoot(path) {
  const roots = new Set([resolve('/tmp'), resolve(tmpdir())]);
  for (const root of [...roots]) {
    try { roots.add(realpathSync(root)); } catch { /* unavailable canonical roots are ignored */ }
  }
  return roots.has(resolve(path));
}

function initializeRoomImageUploadRoot(root) {
  const uploadRoot = resolve(root);
  const controlledParent = dirname(uploadRoot);
  const parentIsOsTempRoot = isRoomImageOsTempRoot(controlledParent);
  if (!parentIsOsTempRoot) secureRoomImageUploadDirectory(controlledParent);
  secureRoomImageUploadDirectory(uploadRoot);
  return uploadRoot;
}

function roomImageUploadPaths(root, uploadId) {
  return {
    source: join(root, `${uploadId}.png`),
    metadata: join(root, `${uploadId}.json`),
  };
}

export function createRoomImageUploadStore({
  root = ROOM_IMAGE_UPLOAD_ROOT,
  now = () => Date.now(),
  removeFile = unlinkSync,
  assertSetupRecoveryHealthy = () => undefined,
} = {}) {
  assertSetupRecoveryHealthy();
  const uploadRoot = initializeRoomImageUploadRoot(root);
  const records = new Map();
  const locks = new Map();

  function temporaryPath(uploadId) {
    return join(uploadRoot, `.upload-${uploadId}-${randomBytes(12).toString('base64url')}.tmp`);
  }

  function writeAtomic(path, uploadId, bytes) {
    assertSetupRecoveryHealthy();
    const temporary = temporaryPath(uploadId);
    try {
      writeFileSync(temporary, bytes, { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, path);
    } finally {
      removeTemporaryFile(temporary);
    }
  }

  function persist(record) {
    const paths = roomImageUploadPaths(uploadRoot, record.uploadId);
    writeAtomic(paths.metadata, record.uploadId, `${JSON.stringify(record)}\n`);
  }

  function cleanupError(error) {
    return error instanceof RoomImageUploadStoreError
      ? error
      : new RoomImageUploadStoreError(
        'ROOM_IMAGE_UPLOAD_CLEANUP_FAILED',
        'Temporäre Room-Image-Uploaddaten konnten nicht vollständig gelöscht werden.',
        error,
      );
  }

  function removeTemporaryFile(path) {
    try {
      const metadata = lstatSync(path);
      if (metadata.isDirectory()) throw new Error('Upload partial is a directory');
      assertSetupRecoveryHealthy();
      removeFile(path);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return;
      throw cleanupError(error);
    }
  }

  function removeDiskRecord(uploadId, { restoreOnFailure = false } = {}) {
    const paths = roomImageUploadPaths(uploadRoot, uploadId);
    const snapshots = new Map();
    if (restoreOnFailure) {
      for (const path of [paths.source, paths.metadata]) {
        try {
          const metadata = lstatSync(path);
          if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Upload entry is not a safe file');
          snapshots.set(path, readFileSync(path));
        } catch (error) {
          if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw cleanupError(error);
        }
      }
    }
    let firstError = null;
    for (const path of [paths.source, paths.metadata]) {
      try {
        const metadata = lstatSync(path);
        if (metadata.isDirectory()) throw new Error('Upload entry is a directory');
        assertSetupRecoveryHealthy();
        removeFile(path);
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
        firstError ??= error;
      }
    }
    if (firstError) {
      let restoreError = null;
      if (restoreOnFailure) {
        for (const [path, bytes] of snapshots) {
          if (existsSync(path)) continue;
          try { writeAtomic(path, uploadId, bytes); } catch (error) { restoreError ??= error; }
        }
      }
      throw cleanupError(restoreError ?? firstError);
    }
  }

  function removeRecord(uploadId, { restoreOnFailure = false } = {}) {
    let record = records.get(uploadId);
    if (record && !record.inUse) {
      const consumed = { ...record, inUse: true };
      try {
        persist(consumed);
      } catch (error) {
        throw cleanupError(error);
      }
      records.set(uploadId, consumed);
      record = consumed;
    }
    removeDiskRecord(uploadId, { restoreOnFailure });
    records.delete(uploadId);
  }

  function validRecord(record, uploadId) {
    return record?.version === 1
      && record.uploadId === uploadId
      && typeof record.owner === 'string' && record.owner.length > 0
      && Number.isInteger(record.width) && record.width > 0
      && Number.isInteger(record.height) && record.height > 0
      && ['image/jpeg', 'image/png', 'image/webp'].includes(record.mimeType)
      && Number.isFinite(record.createdAt)
      && Number.isFinite(record.expiresAt)
      && typeof record.inUse === 'boolean'
      && record.expiresAt === record.createdAt + ROOM_IMAGE_UPLOAD_TTL_MS;
  }

  function load() {
    const names = readdirSync(uploadRoot);
    for (const name of names) {
      if (/^\.upload-[A-Za-z0-9_-]{43}-[A-Za-z0-9_-]{16}\.tmp$/.test(name)) {
        removeTemporaryFile(join(uploadRoot, name));
      }
    }
    const ids = new Set(names.map((name) => name.match(/^([A-Za-z0-9_-]{43})\.(?:png|json)$/)?.[1]).filter(Boolean));
    for (const uploadId of ids) {
      const paths = roomImageUploadPaths(uploadRoot, uploadId);
      let record;
      try {
        if (!lstatSync(paths.source).isFile() || !lstatSync(paths.metadata).isFile()) throw new Error('unsafe upload entry');
        record = JSON.parse(readFileSync(paths.metadata, 'utf8'));
        if (!validRecord(record, uploadId)) throw new Error('invalid upload');
      } catch {
        removeDiskRecord(uploadId);
        continue;
      }
      if (record.inUse) {
        removeDiskRecord(uploadId);
        continue;
      }
      records.set(uploadId, record);
      if (record.expiresAt <= now()) removeRecord(uploadId);
    }
  }

  function cleanup() {
    const timestamp = now();
    for (const [uploadId, record] of records) {
      if (record.expiresAt <= timestamp) removeRecord(uploadId);
    }
  }

  function create(owner, { buffer, width, height, mimeType }) {
    cleanup();
    assertSetupRecoveryHealthy();
    const uploadId = randomBytes(32).toString('base64url');
    const createdAt = now();
    const record = {
      version: 1,
      uploadId,
      owner,
      width,
      height,
      mimeType,
      createdAt,
      expiresAt: createdAt + ROOM_IMAGE_UPLOAD_TTL_MS,
      inUse: false,
    };
    const paths = roomImageUploadPaths(uploadRoot, uploadId);
    try {
      writeAtomic(paths.source, uploadId, Buffer.from(buffer));
      persist(record);
      records.set(uploadId, record);
    } catch (error) {
      removeRecord(uploadId);
      throw error;
    }
    return { uploadId, width, height, mimeType, expiresAt: new Date(record.expiresAt).toISOString() };
  }

  function hasOwn(owner, uploadId) {
    cleanup();
    const record = ROOM_IMAGE_ID_PATTERN.test(uploadId || '') ? records.get(uploadId) : null;
    return Boolean(record && record.owner === owner);
  }

  function inspectOwn(owner, uploadId) {
    cleanup();
    const record = ROOM_IMAGE_ID_PATTERN.test(uploadId || '') ? records.get(uploadId) : null;
    if (!record || record.owner !== owner || record.inUse) return null;
    return {
      uploadId: record.uploadId,
      width: record.width,
      height: record.height,
      mimeType: record.mimeType,
      expiresAt: record.expiresAt,
    };
  }

  function deleteOwn(owner, uploadId) {
    cleanup();
    if (!ROOM_IMAGE_ID_PATTERN.test(uploadId || '')) return 'absent';
    const record = records.get(uploadId);
    if (!record || record.owner !== owner) return 'absent';
    if (record.inUse) return 'in_use';
    assertSetupRecoveryHealthy();
    removeRecord(uploadId);
    return 'deleted';
  }

  function runLocked(uploadId, operation) {
    const previous = locks.get(uploadId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    locks.set(uploadId, current);
    return current.finally(() => {
      if (locks.get(uploadId) === current) locks.delete(uploadId);
    });
  }

  async function bindForJob(owner, uploadId) {
    if (!ROOM_IMAGE_ID_PATTERN.test(uploadId || '')) return null;
    return runLocked(uploadId, async () => {
      cleanup();
      const record = records.get(uploadId);
      if (!record || record.owner !== owner || record.inUse) return null;
      assertSetupRecoveryHealthy();
      const bound = { ...record, inUse: true };
      persist(bound);
      records.set(uploadId, bound);
      let active = true;
      let rollbackReleasePending = false;
      return {
        uploadId,
        width: bound.width,
        height: bound.height,
        mimeType: bound.mimeType,
        async materializeProviderJpeg(crop, handoff = async (bytes) => bytes) {
          if (!active) throw new Error('Upload binding is no longer active');
          return runLocked(uploadId, async () => {
            const current = records.get(uploadId);
            if (!current || current.owner !== owner || !current.inUse || current.expiresAt <= now()) {
              active = false;
              if (current?.expiresAt <= now()) removeRecord(uploadId);
              throw new Error('Upload is no longer available');
            }
            let result;
            try {
              const sourcePath = roomImageUploadPaths(uploadRoot, uploadId).source;
              if (!lstatSync(sourcePath).isFile()) throw new Error('Upload source is not a regular file');
              /* Die Kompositionsphase bekommt das ungeschnittene Foto: sie soll
                 Rahmen und Perspektive selbst waehlen (siehe Prompt-Policy). */
              const jpeg = await sourceFullToProviderJpeg(readFileSync(sourcePath));
              assertProviderInputSize(jpeg);
              result = await handoff(jpeg);
            } catch (error) {
              const retained = records.get(uploadId);
              if (retained) {
                assertSetupRecoveryHealthy();
                const released = { ...retained, inUse: false };
                persist(released);
                records.set(uploadId, released);
              }
              active = false;
              throw error;
            }
            const protocolType = roomImageUploadHandoffProtocolType(result);
            if (protocolType && protocolType !== 'created') {
              const retained = records.get(uploadId);
              if (retained) {
                assertSetupRecoveryHealthy();
                const released = { ...retained, inUse: false };
                persist(released);
                records.set(uploadId, released);
              }
              active = false;
              return result;
            }
            try {
              assertSetupRecoveryHealthy();
              removeRecord(uploadId, { restoreOnFailure: protocolType === 'created' });
              active = false;
              return result;
            } catch (error) {
              rollbackReleasePending = protocolType === 'created';
              active = false;
              throw error;
            }
          });
        },
        async restoreAfterRollback() {
          if (!rollbackReleasePending) return false;
          return runLocked(uploadId, async () => {
            if (!rollbackReleasePending) return false;
            const current = records.get(uploadId);
            if (!current || current.owner !== owner || !current.inUse) return false;
            assertSetupRecoveryHealthy();
            const released = { ...current, inUse: false };
            persist(released);
            records.set(uploadId, released);
            rollbackReleasePending = false;
            return true;
          });
        },
        async release() {
          if (!active) return;
          await runLocked(uploadId, async () => {
            const current = records.get(uploadId);
            if (current?.owner === owner) {
              assertSetupRecoveryHealthy();
              const released = { ...current, inUse: false };
              persist(released);
              records.set(uploadId, released);
            }
            active = false;
          });
        },
      };
    });
  }

  load();
  return { bindForJob, cleanup, create, deleteOwn, hasOwn, inspectOwn, root: uploadRoot };
}

function roomImageUploadHandoffProtocolType(result) {
  const keys = result?.type === 'already'
    ? ['type']
    : ['created', 'replay', 'conflict', 'upload_already'].includes(result?.type)
      ? ['type', 'record']
      : null;
  if (!keys || !roomImageExactObject(result, keys)) return null;
  if (keys.includes('record')
      && (!result.record || typeof result.record !== 'object' || Array.isArray(result.record))) return null;
  return result.type;
}

class RoomImageJobStoreError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RoomImageJobStoreError';
    this.code = code;
  }
}

function roomImageJobStoreError(message, cause = undefined) {
  return new RoomImageJobStoreError('ROOM_IMAGE_STORE_INVALID', message, cause);
}

function roomImageExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function roomImageCanonical(value) {
  if (Array.isArray(value)) return value.map(roomImageCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, roomImageCanonical(value[key])]));
  }
  return value;
}

function roomImageFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(roomImageCanonical(value))).digest('hex');
}

function strongByteEtag(bytes) {
  return `"${createHash('sha256').update(bytes).digest('hex')}"`;
}

function roomImageOpaqueId() {
  return randomBytes(32).toString('base64url');
}

function roomImageAssetId() {
  let assetId;
  do assetId = randomBytes(32).toString('base64url').toLowerCase();
  while (!ROOM_IMAGE_ASSET_ID_PATTERN.test(assetId));
  return assetId;
}

function roomImageCounters(confirmedCount = undefined) {
  return {
    ...(confirmedCount === undefined ? {} : { confirmedCount }),
    plannedCount: 0,
    startedCount: 0,
    completedCount: 0,
    outcomeUnknownCount: 0,
  };
}

function roomImageProviderCalls(confirmedCount, lineage = null, wizard = null) {
  return {
    attempt: roomImageCounters(confirmedCount),
    lineage: lineage ? { ...lineage } : roomImageCounters(),
    wizard: wizard ? { ...wizard } : roomImageCounters(),
  };
}

function incrementRoomImageCounter(record, key) {
  record.providerCalls.attempt[key] += 1;
  record.providerCalls.lineage[key] += 1;
  record.providerCalls.wizard[key] += 1;
}

const ROOM_IMAGE_COUNTER_KEYS = ['plannedCount', 'startedCount', 'completedCount', 'outcomeUnknownCount'];

function derivedRoomImageAttemptCounters(record) {
  return {
    plannedCount: record.attempts.length,
    startedCount: record.attempts.filter((attempt) => ['started', 'completed', 'outcome_unknown'].includes(attempt.status)).length,
    completedCount: record.attempts.filter((attempt) => attempt.status === 'completed').length,
    outcomeUnknownCount: record.attempts.filter((attempt) => attempt.status === 'outcome_unknown').length,
  };
}

function synchronizeRoomImageAggregates(records) {
  const lineage = new Map();
  const wizard = new Map();
  for (const record of records) {
    const attempt = derivedRoomImageAttemptCounters(record);
    for (const [map, id] of [[lineage, record.lineageId], [wizard, record.wizardId]]) {
      const aggregate = map.get(id) ?? roomImageCounters();
      for (const key of ROOM_IMAGE_COUNTER_KEYS) aggregate[key] += attempt[key];
      map.set(id, aggregate);
    }
  }
  for (const record of records) {
    record.providerCalls.attempt = {
      confirmedCount: record.providerCalls.attempt.confirmedCount,
      ...derivedRoomImageAttemptCounters(record),
    };
    record.providerCalls.lineage = { ...lineage.get(record.lineageId) };
    record.providerCalls.wizard = { ...wizard.get(record.wizardId) };
  }
}

function validRoomImageSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validRoomImageTimestamp(value) {
  return validRoomImageSafeInteger(value);
}

function validRoomImageNullableTimestamp(value) {
  return value === null || validRoomImageTimestamp(value);
}

function validRoomImageOwner(value) {
  return typeof value === 'string'
    && value === value.trim().normalize('NFC')
    && Buffer.byteLength(value, 'utf8') >= 1
    && Buffer.byteLength(value, 'utf8') <= 256
    && !/[,\u0000-\u001f\u007f\uD800-\uDFFF]/.test(value);
}

function validRoomImagePointValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validStoredRoomImagePoint(value) {
  return roomImageExactObject(value, ['x', 'y'])
    && validRoomImagePointValue(value.x) && validRoomImagePointValue(value.y);
}

function validStoredRoomImageFocus(value) {
  return roomImageExactObject(value, ['panel', 'phone'])
    && validStoredRoomImagePoint(value.panel) && validStoredRoomImagePoint(value.phone);
}

function validRoomImageAssetObject(asset) {
  if (asset === null) return true;
  if (!roomImageExactObject(asset, ['assetId', 'variants', 'focus'])
      || !ROOM_IMAGE_ASSET_ID_PATTERN.test(asset.assetId || '')
      || !roomImageExactObject(asset.variants, ['light', 'dark', 'darkOff'])
      || !validStoredRoomImageFocus(asset.focus)) return false;
  return asset.variants.light === `/assets/room-images/${asset.assetId}/light.avif`
    && asset.variants.dark === `/assets/room-images/${asset.assetId}/dark.avif`
    && asset.variants.darkOff === `/assets/room-images/${asset.assetId}/dark-off.avif`;
}

function validStoredMainRoomImageRequest(value, { retry = false } = {}) {
  if (!roomImageExactObject(value, [
    'kind', 'clientRequestId', 'uploadId', 'crop', 'canonicalCropPixels', 'focus',
    'stylePreset', 'adjustments', 'candidateCount', 'noticeVersion', 'costConfirmed',
    'confirmedProviderCalls',
  ])
      || value.kind !== 'main_candidates'
      || !ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN.test(value.clientRequestId || '')
      || !ROOM_IMAGE_ID_PATTERN.test(value.uploadId || '')
      || !roomImageExactObject(value.crop, ['x', 'y', 'width', 'height'])
      || !['x', 'y', 'width', 'height'].every((key) => (
        typeof value.crop[key] === 'number' && Number.isFinite(value.crop[key])
      ))
      || value.crop.x < 0 || value.crop.y < 0
      || value.crop.width < 0.2 || value.crop.height < 0.2
      || value.crop.x + value.crop.width > 1 || value.crop.y + value.crop.height > 1
      || !roomImageExactObject(value.canonicalCropPixels, ['x', 'y', 'width', 'height'])
      || !['x', 'y', 'width', 'height'].every((key) => validRoomImageSafeInteger(value.canonicalCropPixels[key]))
      || value.canonicalCropPixels.width < 1 || value.canonicalCropPixels.height < 1
      || !validStoredRoomImageFocus(value.focus)
      || !roomImageExactObject(value.adjustments, ['declutter', 'tone', 'preserveFeatures'])
      || ![1, 2].includes(value.candidateCount)
      || value.noticeVersion !== 'room-image-v1' || value.costConfirmed !== true
      || !validRoomImageSafeInteger(value.confirmedProviderCalls)
      || (retry
        ? ![value.candidateCount, value.candidateCount + 1].includes(value.confirmedProviderCalls)
        : value.confirmedProviderCalls !== value.candidateCount + 1)) return false;
  try {
    validateRoomImagePromptSpec({
      stylePreset: value.stylePreset,
      declutter: value.adjustments.declutter,
      tone: value.adjustments.tone,
      preserveFeatures: value.adjustments.preserveFeatures,
    });
  } catch { return false; }
  return true;
}

function validStoredFinalRoomImageRequest(value, jobId) {
  return roomImageExactObject(value, [
    'kind', 'clientRequestId', 'parentJobId', 'candidateId', 'focus', 'noticeVersion',
    'costConfirmed', 'confirmedProviderCalls',
  ])
    && value.kind === 'variant_set'
    && ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN.test(value.clientRequestId || '')
    && ROOM_IMAGE_ID_PATTERN.test(value.parentJobId || '') && value.parentJobId !== jobId
    && ROOM_IMAGE_ID_PATTERN.test(value.candidateId || '')
    && validStoredRoomImageFocus(value.focus)
    && value.noticeVersion === 'room-image-v1' && value.costConfirmed === true
    && value.confirmedProviderCalls === 2;
}

function validRoomImageTempReference(value, kind, suffix, stem = null) {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const expectedStem = stem === null ? 'source-[A-Za-z0-9_-]{43}' : stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${kind}/${expectedStem}\\.${suffix}$`).test(value);
}

function validStoredRoomImageCandidate(value) {
  return roomImageExactObject(value, ['candidateId', 'preview', 'providerInput'])
    && ROOM_IMAGE_ID_PATTERN.test(value.candidateId || '')
    && validRoomImageTempReference(value.preview, 'candidates', 'avif', `candidate-${value.candidateId}`)
    && validRoomImageTempReference(value.providerInput, 'candidates', 'jpg', `candidate-${value.candidateId}`);
}

function validStoredRoomImageTemp(record) {
  const value = record.temp;
  if (!roomImageExactObject(value, [
    'source', 'composition', 'candidates', 'selectedProvider', 'selectedPreview', 'finals',
  ])
      || !validRoomImageTempReference(value.source, 'sources', 'jpg', null)
      || !Array.isArray(value.candidates)
      || new Set(value.candidates.map((candidate) => candidate?.candidateId)).size !== value.candidates.length
      || !value.candidates.every(validStoredRoomImageCandidate)
      || !value.finals || typeof value.finals !== 'object' || Array.isArray(value.finals)) return false;

  if (record.kind === 'main_candidates') {
    if (!validRoomImageTempReference(value.composition, 'compositions', 'jpg', `composition-${record.lineageId}`)
        || value.selectedProvider !== null || value.selectedPreview !== null
        || !roomImageExactObject(value.finals, [])
        || value.candidates.length > record.request.candidateCount + 1) return false;
    if (record.status === 'succeeded') {
      const ownsCompletedCandidates = value.source !== null && value.candidates.length >= 1
        && value.candidates.length <= record.request.candidateCount + 1;
      const transferredToFinal = value.source === null && value.composition === null && value.candidates.length === 0;
      if (!ownsCompletedCandidates && !transferredToFinal) return false;
    }
    if (['queued', 'running', 'cancelling'].includes(record.status) && value.source === null) return false;
    if (record.status === 'awaiting_confirmation') return false;
    if (['expired', 'superseded'].includes(record.status)
        && (value.source !== null || value.composition !== null || value.candidates.length !== 0)) return false;
    if (record.status === 'failed' && !record.retryable
        && (value.source !== null || value.composition !== null || value.candidates.length !== 0)) return false;
    if (record.retryable && value.source === null) return false;
    return true;
  }

  if (value.composition !== null || value.candidates.length !== 0
      || !validRoomImageTempReference(value.selectedProvider, 'candidates', 'jpg', `candidate-${record.request.candidateId}`)
      || !validRoomImageTempReference(value.selectedPreview, 'candidates', 'avif', `candidate-${record.request.candidateId}`)
      || (value.selectedProvider === null) !== (value.selectedPreview === null)) return false;
  const finalKeys = Object.keys(value.finals).sort();
  if (![
    '', 'dark', 'dark,darkOff', 'dark,darkOff,light',
  ].includes(finalKeys.join(','))) return false;
  if (Object.hasOwn(value.finals, 'dark')
      && !validRoomImageTempReference(value.finals.dark, 'finals', 'avif', `final-${record.jobId}-dark`)) return false;
  if (Object.hasOwn(value.finals, 'darkOff')
      && !validRoomImageTempReference(value.finals.darkOff, 'finals', 'avif', `final-${record.jobId}-dark-off`)) return false;
  if (Object.hasOwn(value.finals, 'light')
      && !validRoomImageTempReference(value.finals.light, 'finals', 'avif', `final-${record.jobId}-light`)) return false;
  if (['queued', 'running', 'cancelling', 'awaiting_confirmation'].includes(record.status)
      && (value.source === null || value.selectedProvider === null)) return false;
  if (record.status === 'awaiting_confirmation' && finalKeys.join(',') !== 'dark,darkOff,light') return false;
  if (record.status === 'succeeded') {
    return value.source === null && value.selectedProvider === null && finalKeys.length === 0;
  }
  if (['expired', 'superseded'].includes(record.status)
      && (value.source !== null || value.selectedProvider !== null || finalKeys.length !== 0)) return false;
  if (record.status === 'failed' && !record.retryable
      && (value.source !== null || value.selectedProvider !== null || finalKeys.length !== 0)) return false;
  if (record.retryable && (value.source === null || value.selectedProvider === null)) return false;
  return true;
}

function validRoomImageCounters(value, attempt = false) {
  const keys = attempt
    ? ['confirmedCount', 'plannedCount', 'startedCount', 'completedCount', 'outcomeUnknownCount']
    : ['plannedCount', 'startedCount', 'completedCount', 'outcomeUnknownCount'];
  if (!roomImageExactObject(value, keys)
      || !keys.every((key) => validRoomImageSafeInteger(value[key]))
      || value.startedCount > value.plannedCount
      || value.completedCount + value.outcomeUnknownCount > value.startedCount
      || (attempt && value.confirmedCount !== value.plannedCount)) return false;
  return true;
}

function validStoredRoomImageAttempt(attempt, record) {
  if (!roomImageExactObject(attempt, [
    'providerAttemptId', 'attemptId', 'parentAttemptId', 'lineageId', 'jobId', 'wizardId',
    'phase', 'status', 'plannedAt', 'startedAt', 'completedAt', 'unknownAt', 'outcome', 'errorCode',
  ])
      || !ROOM_IMAGE_ID_PATTERN.test(attempt.providerAttemptId || '')
      || attempt.attemptId !== record.attemptId
      || attempt.parentAttemptId !== record.parentAttemptId
      || attempt.lineageId !== record.lineageId || attempt.jobId !== record.jobId
      || attempt.wizardId !== record.wizardId
      || !ROOM_IMAGE_PROMPT_POLICY_V1.phases.includes(attempt.phase)
      || !['planned', 'started', 'failed_local', 'cancelled_before_start', 'completed', 'outcome_unknown'].includes(attempt.status)
      || !validRoomImageTimestamp(attempt.plannedAt)
      || !validRoomImageNullableTimestamp(attempt.startedAt)
      || !validRoomImageNullableTimestamp(attempt.completedAt)
      || !validRoomImageNullableTimestamp(attempt.unknownAt)) return false;

  if (attempt.status === 'planned') {
    return attempt.startedAt === null && attempt.completedAt === null && attempt.unknownAt === null
      && attempt.outcome === null && attempt.errorCode === null;
  }
  if (attempt.status === 'started') {
    return attempt.startedAt >= attempt.plannedAt && attempt.completedAt === null && attempt.unknownAt === null
      && attempt.outcome === null && attempt.errorCode === null;
  }
  if (attempt.status === 'failed_local') {
    return attempt.startedAt === null && attempt.completedAt === null && attempt.unknownAt === null
      && attempt.outcome === null
      && ['LOCAL_PROVIDER_REQUEST_NOT_SENT', 'SERVER_RESTARTED_RETRY_REQUIRED'].includes(attempt.errorCode);
  }
  if (attempt.status === 'cancelled_before_start') {
    return attempt.startedAt === null && attempt.completedAt === null && attempt.unknownAt === null
      && attempt.outcome === null
      && ['JOB_CANCELLED', 'DEPENDENCY_FAILED'].includes(attempt.errorCode);
  }
  if (attempt.status === 'completed') {
    return attempt.startedAt >= attempt.plannedAt && attempt.completedAt >= attempt.startedAt
      && attempt.unknownAt === null
      && ['http_error', 'result_valid', 'result_invalid'].includes(attempt.outcome)
      && ((attempt.outcome === 'result_valid' && attempt.errorCode === null)
        || (attempt.outcome === 'http_error' && [
          'PROVIDER_CREDENTIAL_INVALID', 'PROVIDER_FORBIDDEN', 'PROVIDER_QUOTA_OR_RATE_LIMIT',
          'PROVIDER_IMAGE_REJECTED', 'PROVIDER_HTTP_ERROR',
        ].includes(attempt.errorCode))
        || (attempt.outcome === 'result_invalid'
          && ['PROVIDER_INVALID_RESPONSE', 'PROVIDER_RESULT_INVALID'].includes(attempt.errorCode)));
  }
  return attempt.startedAt >= attempt.plannedAt && attempt.completedAt === null
    && attempt.unknownAt >= attempt.startedAt && attempt.outcome === null
    && attempt.errorCode === 'PROVIDER_OUTCOME_UNKNOWN';
}

function validStoredRoomImageError(value) {
  return roomImageExactObject(value, ['code', 'message'])
    && [
      'JOB_CANCELLED', 'LOCAL_PROVIDER_REQUEST_NOT_SENT', 'PROVIDER_CREDENTIAL_INVALID',
      'PROVIDER_FORBIDDEN', 'PROVIDER_HTTP_ERROR', 'PROVIDER_IMAGE_REJECTED',
      'PROVIDER_INVALID_RESPONSE', 'PROVIDER_OUTCOME_UNKNOWN', 'PROVIDER_QUOTA_OR_RATE_LIMIT',
      'PROVIDER_RESULT_INVALID', 'ROOM_IMAGE_TEMP_EXPIRED',
      'SERVER_RESTARTED_RETRY_REQUIRED', 'SERVER_RESTARTED_SOURCE_MISSING',
      'PUBLISH_FAILED', 'PUBLISH_RECOVERY_REQUIRED',
    ].includes(value.code)
    && typeof value.message === 'string' && value.message.length >= 1 && value.message.length <= 512;
}

function validStoredRoomImageRetry(value, kind) {
  return roomImageExactObject(value, ['kind', 'requiredProviderCalls', 'noticeVersion'])
    && value.kind === kind
    && [1, 2, 3].includes(value.requiredProviderCalls)
    && (kind !== 'variant_set' || value.requiredProviderCalls <= 2)
    && value.noticeVersion === 'room-image-v1';
}

function validStoredRoomImageState(record) {
  const mainPhases = ['generating_composition', 'generating_style_1', 'generating_style_2'];
  const finalPhases = ['generating_dark', 'generating_dark_off', 'validating_set'];
  if (record.status === 'queued') {
    if (record.phase !== 'queued' || !record.cancellable || record.retryable || record.discardable) return false;
  } else if (record.status === 'running') {
    if (!(record.kind === 'main_candidates' ? mainPhases : finalPhases).includes(record.phase)
        || !record.cancellable || record.retryable || record.discardable) return false;
  } else if (record.status === 'cancelling') {
    const phases = record.kind === 'main_candidates'
      ? ['queued', ...mainPhases, 'complete']
      : ['queued', ...finalPhases, 'awaiting_confirmation'];
    if (!phases.includes(record.phase) || !record.cancellable || record.retryable || record.discardable) return false;
  } else if (record.status === 'succeeded') {
    if (record.phase !== 'complete' || record.retryable || record.discardable
        || (record.kind === 'main_candidates' ? !record.cancellable : record.cancellable)) return false;
  } else if (record.status === 'awaiting_confirmation') {
    if (record.kind !== 'variant_set' || !['awaiting_confirmation', 'publishing_set'].includes(record.phase)
        || record.cancellable !== (record.phase === 'awaiting_confirmation')
        || record.retryable || record.discardable) return false;
  } else if (!['failed', 'cancelled', 'expired', 'superseded'].includes(record.status)
      || record.phase !== 'complete' || record.cancellable || record.retryable && record.status !== 'failed') return false;
  if (record.retryable && !record.discardable) return false;

  const active = ['queued', 'running', 'cancelling', 'succeeded', 'awaiting_confirmation'].includes(record.status);
  if ((active && record.error !== null)
      || (!active && !validStoredRoomImageError(record.error))) return false;
  if (record.retryable !== (record.retry !== null)
      || (record.retry !== null && !validStoredRoomImageRetry(record.retry, record.kind))) return false;
  if (record.status === 'superseded') {
    if (!ROOM_IMAGE_ID_PATTERN.test(record.supersededByJobId || '')
        || record.supersededByJobId === record.jobId) return false;
  } else if (record.supersededByJobId !== null) return false;
  return true;
}

function validStoredRoomImageJob(record, jobId) {
  const keys = [
    'version', 'jobId', 'owner', 'wizardId', 'lineageId', 'attemptId', 'parentAttemptId',
    'kind', 'clientRequestId', 'fingerprint', 'status', 'phase', 'createdAt', 'updatedAt',
    'expiresAt', 'cancellable', 'retryable', 'discardable', 'retry', 'supersededByJobId',
    'error', 'policy', 'request', 'temp', 'attempts', 'providerCalls', 'transitionIds',
    'reservedAssetId', 'asset',
  ];
  if (!roomImageExactObject(record, keys)
      || record.version !== 1
      || record.jobId !== jobId || !ROOM_IMAGE_ID_PATTERN.test(jobId)
      || !validRoomImageOwner(record.owner)
      || ![record.wizardId, record.lineageId, record.attemptId].every((id) => ROOM_IMAGE_ID_PATTERN.test(id || ''))
      || new Set([record.jobId, record.wizardId, record.lineageId, record.attemptId]).size !== 4
      || !(record.parentAttemptId === null
        || (ROOM_IMAGE_ID_PATTERN.test(record.parentAttemptId || '') && record.parentAttemptId !== record.attemptId))
      || !['main_candidates', 'variant_set'].includes(record.kind)
      || !ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN.test(record.clientRequestId || '')
      || !/^[0-9a-f]{64}$/.test(record.fingerprint || '')
      || ![record.createdAt, record.updatedAt, record.expiresAt].every(validRoomImageTimestamp)
      || record.updatedAt < record.createdAt
      || record.expiresAt <= record.createdAt
      || record.expiresAt > record.createdAt + ROOM_IMAGE_JOB_TTL_MS
      || (record.kind === 'main_candidates' && record.parentAttemptId === null
        && record.expiresAt !== record.createdAt + ROOM_IMAGE_JOB_TTL_MS)
      || !['cancellable', 'retryable', 'discardable'].every((key) => typeof record[key] === 'boolean')
      || !validStoredRoomImageState(record)
      || !roomImageExactObject(record.policy, ['version', 'phases', 'spec'])
      || record.policy.version !== ROOM_IMAGE_PROMPT_POLICY_V1.id
      || !Array.isArray(record.policy.phases)
      || !Array.isArray(record.attempts) || !Array.isArray(record.transitionIds)
      || !roomImageExactObject(record.providerCalls, ['attempt', 'lineage', 'wizard'])
      || !validRoomImageCounters(record.providerCalls.attempt, true)
      || !validRoomImageCounters(record.providerCalls.lineage)
      || !validRoomImageCounters(record.providerCalls.wizard)) return false;

  if (!(record.reservedAssetId === null || ROOM_IMAGE_ASSET_ID_PATTERN.test(record.reservedAssetId || ''))
      || !validRoomImageAssetObject(record.asset)) return false;
  if (record.kind === 'main_candidates') {
    if (record.reservedAssetId !== null || record.asset !== null) return false;
  } else if (record.status === 'succeeded') {
    if (!record.asset || record.reservedAssetId !== record.asset.assetId) return false;
  } else if (record.phase === 'publishing_set') {
    if (!record.reservedAssetId || record.asset !== null) return false;
  } else if (record.asset !== null) return false;

  const requestValid = record.kind === 'main_candidates'
    ? validStoredMainRoomImageRequest(record.request, { retry: record.parentAttemptId !== null })
    : validStoredFinalRoomImageRequest(record.request, record.jobId);
  if (!requestValid || record.request.clientRequestId !== record.clientRequestId) return false;
  try { validateRoomImagePromptSpec(record.policy.spec); } catch { return false; }
  if (record.kind === 'main_candidates') {
    if (record.policy.spec.stylePreset !== record.request.stylePreset
        || record.policy.spec.declutter !== record.request.adjustments.declutter
        || record.policy.spec.tone !== record.request.adjustments.tone
        || JSON.stringify(record.policy.spec.preserveFeatures) !== JSON.stringify(record.request.adjustments.preserveFeatures)) return false;
  }

  const fullMainPhases = record.kind === 'main_candidates'
    ? ['composition', ...Array(record.request.candidateCount).fill('style-light')] : null;
  const retryMainPhases = record.kind === 'main_candidates'
    ? Array(record.request.candidateCount).fill('style-light') : null;
  const expectedPhases = record.kind === 'variant_set' ? ['dark', 'dark-off']
    : record.parentAttemptId !== null && record.policy.phases[0] !== 'composition'
      ? retryMainPhases : fullMainPhases;
  if (JSON.stringify(record.policy.phases) !== JSON.stringify(expectedPhases)
      || record.request.confirmedProviderCalls !== expectedPhases.length
      || record.attempts.length !== expectedPhases.length
      || record.attempts.some((attempt, index) => attempt.phase !== expectedPhases[index])
      || !record.attempts.every((attempt) => validStoredRoomImageAttempt(attempt, record))) return false;
  if (record.kind === 'main_candidates' && expectedPhases === retryMainPhases && record.temp?.composition === null) return false;

  const providerAttemptIds = record.attempts.map((attempt) => attempt.providerAttemptId);
  if (new Set(providerAttemptIds).size !== providerAttemptIds.length
      || record.transitionIds.some((transitionId) => (
        typeof transitionId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(transitionId)
      ))
      || new Set(record.transitionIds).size !== record.transitionIds.length) return false;
  const expectedTransitionCount = record.attempts.reduce((count, attempt) => (
    count + (attempt.status === 'planned' ? 0
      : ['started', 'failed_local', 'cancelled_before_start'].includes(attempt.status) ? 1 : 2)
  ), 0);
  if (record.transitionIds.length !== expectedTransitionCount) return false;

  const derived = derivedRoomImageAttemptCounters(record);
  if (!Object.entries(derived).every(([key, value]) => record.providerCalls.attempt[key] === value)
      || !['lineage', 'wizard'].every((scope) => Object.entries(derived).every(
        ([key, value]) => record.providerCalls[scope][key] >= value,
      ))) return false;

  const terminal = ['failed', 'cancelled', 'succeeded', 'awaiting_confirmation', 'expired', 'superseded'].includes(record.status);
  if (terminal && record.attempts.some((attempt) => attempt.status === 'started')) return false;
  if (record.status === 'succeeded' || record.status === 'awaiting_confirmation') {
    if (record.attempts.some((attempt) => attempt.status !== 'completed' || attempt.outcome !== 'result_valid')) return false;
  }
  if (['failed', 'superseded'].includes(record.status)) {
    const failedAttempt = record.attempts.some((attempt) => (
      ['failed_local', 'outcome_unknown', 'cancelled_before_start'].includes(attempt.status)
      || (attempt.status === 'completed' && attempt.outcome !== 'result_valid')
    ));
    const failedFinalValidation = record.status === 'failed' && record.kind === 'variant_set'
      && record.error?.code === 'PROVIDER_RESULT_INVALID'
      && record.attempts.every((attempt) => attempt.status === 'completed' && attempt.outcome === 'result_valid');
    const interruptedFinalValidation = record.status === 'failed' && record.kind === 'variant_set'
      && record.error?.code === 'SERVER_RESTARTED_RETRY_REQUIRED'
      && record.retryable && record.retry?.requiredProviderCalls === 2
      && record.attempts.every((attempt) => attempt.status === 'completed' && attempt.outcome === 'result_valid');
    const failedPublish = record.status === 'failed' && record.kind === 'variant_set'
      && ['PUBLISH_FAILED', 'PUBLISH_RECOVERY_REQUIRED'].includes(record.error?.code)
      && !record.retryable && record.reservedAssetId
      && record.attempts.every((attempt) => attempt.status === 'completed' && attempt.outcome === 'result_valid');
    if (!failedAttempt && !failedFinalValidation && !interruptedFinalValidation && !failedPublish) return false;
  }
  if (!validStoredRoomImageTemp(record)) return false;
  if (record.retryable) {
    const required = record.retry.requiredProviderCalls;
    if (record.kind === 'main_candidates') {
      if (record.temp.composition === null
        ? required !== record.request.candidateCount + 1
        : required > record.request.candidateCount) return false;
    } else if (required > 2) return false;
  }
  return true;
}

function initializeRoomImageJobDirectory(path) {
  try {
    const resolved = resolve(path);
    if (!isRoomImageOsTempRoot(dirname(resolved))) secureRoomImageUploadDirectory(dirname(resolved));
    secureRoomImageUploadDirectory(resolved);
    return resolved;
  } catch (error) {
    throw roomImageJobStoreError('Der Room-Image-Jobroot ist nicht sicher.', error);
  }
}

export function createRoomImageJobStore({
  metadataRoot,
  tempRoot = ROOM_IMAGE_TEMP_ROOT,
  now = () => Date.now(),
  removeFile = unlinkSync,
  transactionStep = () => undefined,
  assertSetupRecoveryHealthy = () => undefined,
} = {}) {
  if (typeof metadataRoot !== 'string' || !metadataRoot) {
    throw roomImageJobStoreError('Der Room-Image-Metadatenroot fehlt.');
  }
  if (typeof tempRoot !== 'string' || !tempRoot) {
    throw roomImageJobStoreError('Der private Room-Image-Temproot fehlt.');
  }
  assertSetupRecoveryHealthy();
  const root = initializeRoomImageJobDirectory(metadataRoot);
  let privateRoot = resolve(tempRoot);
  let tempDirectories = Object.fromEntries(
    ['sources', 'compositions', 'candidates', 'finals', 'partials'].map((name) => [name, join(privateRoot, name)]),
  );
  function initializePrivateRoots() {
    privateRoot = initializeRoomImageJobDirectory(tempRoot);
    tempDirectories = Object.fromEntries(['sources', 'compositions', 'candidates', 'finals', 'partials'].map((name) => {
      const path = initializeRoomImageJobDirectory(join(privateRoot, name));
      return [name, path];
    }));
  }
  const jobs = new Map();
  const idempotency = new Map();
  const lineageLocks = new Set();
  const pendingCommittedTransactions = new Map();

  function pendingLineageTransaction(lineageId) {
    return pendingCommittedTransactions.get(lineageId) ?? null;
  }
  function assertLineageMutable(lineageId) {
    if (pendingLineageTransaction(lineageId)) {
      throw roomImageJobStoreError('Die Room-Image-Lineage wartet auf sicheren Transaktionscleanup.');
    }
  }

  function metadataPath(jobId) { return join(root, `${jobId}.json`); }
  function transactionPath(transactionId) { return join(root, `.room-image-transaction-${transactionId}.json`); }
  function temporaryMetadataPath(jobId) {
    return join(root, `.job-${jobId}-${randomBytes(12).toString('base64url')}.tmp`);
  }
  function persist(record) {
    assertLineageMutable(record.wizardId);
    if (!validStoredRoomImageJob(record, record.jobId)) {
      throw roomImageJobStoreError('Inkohärente Room-Image-Jobmetadaten wurden abgewiesen.');
    }
    assertSetupRecoveryHealthy();
    const temporary = temporaryMetadataPath(record.jobId);
    try {
      writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flush: true });
      chmodSync(temporary, 0o600);
      renameSync(temporary, metadataPath(record.jobId));
      chmodSync(metadataPath(record.jobId), 0o600);
    } catch (error) {
      try { removeFile(temporary); } catch (cleanupError) {
        if (!cleanupError || typeof cleanupError !== 'object' || cleanupError.code !== 'ENOENT') {
          throw roomImageJobStoreError('Jobmetadaten und Partial konnten nicht atomar geschrieben werden.', cleanupError);
        }
      }
      throw roomImageJobStoreError('Jobmetadaten konnten nicht atomar geschrieben werden.', error);
    }
  }

  function tempPath(name) {
    if (typeof name !== 'string') return null;
    const match = name.match(/^(sources|compositions|candidates|finals|partials)\/([A-Za-z0-9_.-]+)$/);
    if (!match || match[2].includes('..')) return null;
    const candidate = join(tempDirectories[match[1]], match[2]);
    return dirname(candidate) === tempDirectories[match[1]] ? candidate : null;
  }
  function tempExists(name) {
    const path = tempPath(name);
    try { return Boolean(path && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()); } catch { return false; }
  }
  function readTemp(name) {
    const path = tempPath(name);
    if (!path) throw roomImageJobStoreError('Ungültige private Temp-Referenz.');
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw roomImageJobStoreError('Unsichere private Temp-Datei.');
    return readFileSync(path);
  }
  function writeTemp(kind, name, bytes) {
    if (!Object.hasOwn(tempDirectories, kind) || !/^[A-Za-z0-9_.-]+$/.test(name) || name.includes('..')) {
      throw roomImageJobStoreError('Ungültiger privater Temp-Dateiname.');
    }
    const relative = `${kind}/${name}`;
    const target = tempPath(relative);
    const temporary = join(tempDirectories.partials, `.room-image-${randomBytes(24).toString('base64url')}.tmp`);
    assertSetupRecoveryHealthy();
    try {
      writeFileSync(temporary, bytes, { mode: 0o600, flush: true });
      chmodSync(temporary, 0o600);
      renameSync(temporary, target);
      chmodSync(target, 0o600);
    } finally {
      try { removeFile(temporary); } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
          throw roomImageJobStoreError('Private Temp-Partials konnten nicht bereinigt werden.', error);
        }
      }
    }
    return relative;
  }
  function deleteTemp(name) {
    const path = tempPath(name);
    if (!path) return;
    assertSetupRecoveryHealthy();
    try {
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe temp');
      removeFile(path);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return;
      throw roomImageJobStoreError('Private Room-Image-Temps konnten nicht gelöscht werden.', error);
    }
  }
  function allTempNames(record) {
    const names = [record.temp.source, record.temp.composition, record.temp.selectedProvider, record.temp.selectedPreview];
    for (const candidate of record.temp.candidates || []) names.push(candidate.preview, candidate.providerInput);
    for (const name of Object.values(record.temp.finals || {})) names.push(name);
    return [...new Set(names.filter(Boolean))];
  }

  function validTransactionRecord(record) {
    return record === null || validStoredRoomImageJob(record, record.jobId);
  }
  function validProviderResultWrite(write, transactionId, index) {
    return roomImageExactObject(write, ['stagedRef', 'targetRef', 'sha256', 'byteLength'])
      && write.stagedRef === `partials/.provider-transition-${transactionId}-${index}.stage`
      && tempPath(write.stagedRef) !== null && tempPath(write.targetRef) !== null
      && !write.targetRef.startsWith('partials/')
      && /^[0-9a-f]{64}$/.test(write.sha256 || '')
      && Number.isSafeInteger(write.byteLength) && write.byteLength > 0;
  }
  function validTransaction(transaction, transactionId) {
    const beforeRecords = Array.isArray(transaction?.before) ? transaction.before.filter(Boolean) : [];
    const baseValid = transaction?.version === 1 && transaction.transactionId === transactionId
      && ['prepared', 'committed'].includes(transaction.state)
      && ROOM_IMAGE_ID_PATTERN.test(transaction.lineageId || '')
      && Array.isArray(transaction.before) && Array.isArray(transaction.after)
      && transaction.before.every(validTransactionRecord) && transaction.after.every(validTransactionRecord)
      && transaction.after.every((record) => record !== null)
      && new Set(beforeRecords.map((record) => record.jobId)).size === beforeRecords.length
      && new Set(transaction.after.map((record) => record.jobId)).size === transaction.after.length
      && Array.isArray(transaction.cleanupRefs)
      && new Set(transaction.cleanupRefs).size === transaction.cleanupRefs.length
      && transaction.cleanupRefs.every((reference) => tempPath(reference) !== null);
    if (!baseValid) return false;
    if (['final_accept', 'retry_supersede'].includes(transaction.type)) {
      return roomImageExactObject(transaction, [
        'version', 'transactionId', 'type', 'state', 'lineageId', 'before', 'after', 'cleanupRefs',
      ]);
    }
    if (transaction.type === 'final_validation') {
      if (!roomImageExactObject(transaction, [
        'version', 'transactionId', 'type', 'state', 'lineageId', 'before', 'after', 'cleanupRefs',
        'resultWrites',
      ])
          || transaction.before.length !== 1 || transaction.after.length !== 1
          || !Array.isArray(transaction.resultWrites) || transaction.resultWrites.length !== 1
          || !validProviderResultWrite(transaction.resultWrites[0], transaction.transactionId, 0)) return false;
      const before = transaction.before[0];
      const after = transaction.after[0];
      return before.jobId === after.jobId && before.wizardId === transaction.lineageId
        && before.kind === 'variant_set' && before.status === 'running' && before.phase === 'validating_set'
        && !Object.hasOwn(before.temp.finals, 'light')
        && after.status === 'awaiting_confirmation' && after.phase === 'awaiting_confirmation'
        && after.temp.finals.light === transaction.resultWrites[0].targetRef
        && transaction.cleanupRefs.length === 0;
    }
    if (transaction.type !== 'provider_transition'
        || !roomImageExactObject(transaction, [
          'version', 'transactionId', 'type', 'state', 'lineageId', 'before', 'after', 'cleanupRefs',
          'transitionId', 'resultWrites',
        ])
        || typeof transaction.transitionId !== 'string'
        || !/^[A-Za-z0-9_-]{1,256}$/.test(transaction.transitionId)
        || !Array.isArray(transaction.resultWrites)
        || transaction.resultWrites.some((write, index) => !validProviderResultWrite(write, transactionId, index))
        || transaction.before.some((record) => record?.transitionIds.includes(transaction.transitionId))
        || transaction.after.filter((record) => record.transitionIds.includes(transaction.transitionId)).length !== 1
        || new Set(transaction.resultWrites.map((write) => write.targetRef)).size !== transaction.resultWrites.length
        || new Set(transaction.resultWrites.map((write) => write.stagedRef)).size !== transaction.resultWrites.length) return false;
    const afterRefs = new Set(transaction.after.flatMap(allTempNames));
    return transaction.resultWrites.every((write) => afterRefs.has(write.targetRef));
  }
  function persistTransaction(transaction) {
    if (!validTransaction(transaction, transaction.transactionId)) {
      throw roomImageJobStoreError('Inkohärentes Room-Image-Transaktionsjournal wurde abgewiesen.');
    }
    assertSetupRecoveryHealthy();
    const target = transactionPath(transaction.transactionId);
    const temporary = join(root, `.room-image-transaction-${transaction.transactionId}-${randomBytes(12).toString('base64url')}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(transaction)}\n`, { mode: 0o600, flush: true });
      chmodSync(temporary, 0o600);
      renameSync(temporary, target);
      chmodSync(target, 0o600);
    } catch (error) {
      try { removeFile(temporary); } catch (cleanupError) {
        if (!cleanupError || typeof cleanupError !== 'object' || cleanupError.code !== 'ENOENT') {
          throw roomImageJobStoreError('Transaktionsjournal und Partial konnten nicht atomar geschrieben werden.', cleanupError);
        }
      }
      throw roomImageJobStoreError('Transaktionsjournal konnte nicht atomar geschrieben werden.', error);
    }
  }
  function removeRegularFile(path, message) {
    assertSetupRecoveryHealthy();
    try {
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe transaction entry');
      removeFile(path);
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') return;
      throw roomImageJobStoreError(message, error);
    }
  }
  function rebuildIndexes() {
    idempotency.clear();
    for (const record of jobs.values()) idempotency.set(`${record.owner}\u0000${record.clientRequestId}`, record.jobId);
  }
  function restorePreparedTransaction(transaction) {
    const beforeIds = new Set(transaction.before.filter(Boolean).map((record) => record.jobId));
    for (const record of transaction.before.filter(Boolean)) persist(record);
    for (const record of transaction.after) {
      if (!beforeIds.has(record.jobId)) {
        removeRegularFile(metadataPath(record.jobId), 'Halbfertige Jobmetadaten konnten nicht zurückgerollt werden.');
      }
    }
  }
  function transactionAcceptedRecord(transaction) {
    const beforeIds = new Set(transaction.before.filter(Boolean).map((record) => record.jobId));
    const accepted = transaction.after.filter((record) => !beforeIds.has(record.jobId));
    return accepted.length === 1 ? accepted[0] : null;
  }
  function trackPendingCommittedTransaction(transaction) {
    const existing = pendingLineageTransaction(transaction.lineageId);
    if (existing && existing.transactionId !== transaction.transactionId) {
      throw roomImageJobStoreError('Mehrere offene Transaktionen derselben Room-Image-Lineage wurden abgewiesen.');
    }
    pendingCommittedTransactions.set(transaction.lineageId, transaction);
    return transactionAcceptedRecord(transaction);
  }
  function completeCommittedLineageTransaction(transaction, { lockHeld = false } = {}) {
    if (!lockHeld) {
      if (lineageLocks.has(transaction.lineageId)) return { type: 'busy' };
      lineageLocks.add(transaction.lineageId);
    }
    try {
      let cleanupError = null;
      for (const reference of transaction.cleanupRefs) {
        try { deleteTemp(reference); } catch (error) { cleanupError ??= error; }
      }
      if (!cleanupError && Array.isArray(transaction.resultWrites)) {
        try { cleanupProviderResultWrites(transaction); } catch (error) { cleanupError = error; }
      }
      if (!cleanupError) {
        try {
          if (Array.isArray(transaction.resultWrites)) {
            transactionStep('journal_cleanup', structuredClone(transaction));
          }
          removeRegularFile(
            transactionPath(transaction.transactionId),
            'Abgeschlossenes Transaktionsjournal konnte nicht gelöscht werden.',
          );
        } catch (error) {
          if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
          cleanupError = error;
        }
      }
      if (cleanupError) return { type: 'cleanup_pending' };
      if (pendingLineageTransaction(transaction.lineageId)?.transactionId === transaction.transactionId) {
        pendingCommittedTransactions.delete(transaction.lineageId);
      }
      return { type: 'committed' };
    } finally {
      if (!lockHeld) lineageLocks.delete(transaction.lineageId);
    }
  }
  function resumeCommittedTransaction(record) {
    const transaction = pendingLineageTransaction(record.wizardId);
    if (!transaction) return { type: 'replay', record: jobs.get(record.jobId) ?? record };
    const accepted = transactionAcceptedRecord(transaction);
    if (!accepted || accepted.jobId !== record.jobId
        || !['final_accept', 'retry_supersede'].includes(transaction.type)) {
      throw roomImageJobStoreError('Nur der exakte Transaktionsresume darf die gesperrte Lineage verändern.');
    }
    const completed = completeCommittedLineageTransaction(transaction);
    if (completed.type !== 'committed') {
      return { type: 'cleanup_pending', record: jobs.get(record.jobId) ?? record };
    }
    return { type: 'resumed', record: jobs.get(record.jobId) ?? record };
  }
  function runLineageTransaction(type, lineageId, before, after, cleanupRefs) {
    assertLineageMutable(lineageId);
    if (lineageLocks.has(lineageId)) return { type: 'busy' };
    lineageLocks.add(lineageId);
    const transaction = {
      version: 1, transactionId: roomImageOpaqueId(), type, state: 'prepared', lineageId,
      before: structuredClone(before), after: structuredClone(after), cleanupRefs: [...new Set(cleanupRefs.filter(Boolean))],
    };
    try {
      persistTransaction(transaction);
      try {
        transactionStep('journal_prepared', structuredClone(transaction));
        for (let index = 0; index < transaction.after.length; index += 1) {
          persist(transaction.after[index]);
          transactionStep(`after_${index + 1}_persisted`, structuredClone(transaction));
        }
        transaction.state = 'committed';
        persistTransaction(transaction);
        transactionStep('journal_committed', structuredClone(transaction));
      } catch (error) {
        if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
        restorePreparedTransaction(transaction);
        removeRegularFile(transactionPath(transaction.transactionId), 'Zurückgerolltes Transaktionsjournal konnte nicht gelöscht werden.');
        throw error;
      }
      for (const record of transaction.after) jobs.set(record.jobId, record);
      rebuildIndexes();
      trackPendingCommittedTransaction(transaction);
      return completeCommittedLineageTransaction(transaction, { lockHeld: true });
    } finally {
      lineageLocks.delete(lineageId);
    }
  }
  function clearTemps(record, { keepSource = false, keepComposition = false, keepSelected = false } = {}) {
    /* Der Kompositionskandidat hängt am Kompositionsbild und überlebt einen
       Retry, der die Komposition behält — sonst fehlt er im fertigen Set. */
    const compositionCandidates = keepComposition && record.temp.composition
      ? record.temp.candidates.filter((entry) => entry.providerInput === record.temp.composition)
      : [];
    const retained = new Set([
      ...(keepSource ? [record.temp.source] : []),
      ...(keepComposition ? [record.temp.composition] : []),
      ...compositionCandidates.map((entry) => entry.preview),
      ...(keepSelected ? [record.temp.selectedProvider, record.temp.selectedPreview] : []),
    ].filter(Boolean));
    for (const name of allTempNames(record)) if (!retained.has(name)) deleteTemp(name);
    if (!keepSource) record.temp.source = null;
    if (!keepComposition) record.temp.composition = null;
    if (!keepSelected) {
      record.temp.selectedProvider = null;
      record.temp.selectedPreview = null;
    }
    record.temp.candidates = compositionCandidates;
    record.temp.finals = {};
  }

  function register(record) {
    persist(record);
    jobs.set(record.jobId, record);
    idempotency.set(`${record.owner}\u0000${record.clientRequestId}`, record.jobId);
    return record;
  }
  function planAttempts(record, phases) {
    const timestamp = now();
    for (const phase of phases) {
      record.attempts.push({
        providerAttemptId: roomImageOpaqueId(), attemptId: record.attemptId,
        parentAttemptId: record.parentAttemptId, lineageId: record.lineageId,
        jobId: record.jobId, wizardId: record.wizardId, phase,
        status: 'planned', plannedAt: timestamp, startedAt: null, completedAt: null,
        unknownAt: null, outcome: null, errorCode: null,
      });
      incrementRoomImageCounter(record, 'plannedCount');
    }
  }
  function baseRecord({ owner, kind, clientRequestId, fingerprint, confirmedCount, wizardId = null, lineageId = null, parentAttemptId = null, lineageCounters = null, wizardCounters = null, expiresAt = null, request, policySpec, temp }) {
    const timestamp = now();
    return {
      version: 1, jobId: roomImageOpaqueId(), owner,
      wizardId: wizardId ?? roomImageOpaqueId(), lineageId: lineageId ?? roomImageOpaqueId(),
      attemptId: roomImageOpaqueId(), parentAttemptId,
      kind, clientRequestId, fingerprint, status: 'queued', phase: 'queued',
      createdAt: timestamp, updatedAt: timestamp, expiresAt: expiresAt ?? timestamp + ROOM_IMAGE_JOB_TTL_MS,
      cancellable: true, retryable: false, discardable: false, retry: null,
      supersededByJobId: null, error: null,
      policy: { version: ROOM_IMAGE_PROMPT_POLICY_V1.id, phases: [], spec: policySpec },
      request, temp, attempts: [],
      providerCalls: roomImageProviderCalls(confirmedCount, lineageCounters, wizardCounters),
      transitionIds: [], reservedAssetId: null, asset: null,
    };
  }
  function idempotent(owner, clientRequestId, fingerprint) {
    const jobId = idempotency.get(`${owner}\u0000${clientRequestId}`);
    if (!jobId) return null;
    const record = jobs.get(jobId);
    if (record?.fingerprint !== fingerprint) return { type: 'conflict', record };
    const transaction = record ? pendingLineageTransaction(record.wizardId) : null;
    const accepted = transaction ? transactionAcceptedRecord(transaction) : null;
    return accepted?.jobId === jobId ? { type: 'pending', record } : { type: 'replay', record };
  }
  function createMain(owner, request, sourceBytes, fingerprint) {
    const existing = idempotent(owner, request.clientRequestId, fingerprint);
    if (existing) return existing;
    const uploadOwner = [...jobs.values()].find((record) => (
      record.owner === owner && record.kind === 'main_candidates' && record.request.uploadId === request.uploadId
    ));
    if (uploadOwner) return { type: 'upload_already', record: uploadOwner };
    const sourceName = `source-${roomImageOpaqueId()}.jpg`;
    const source = writeTemp('sources', sourceName, sourceBytes);
    const policySpec = {
      stylePreset: request.stylePreset,
      declutter: request.adjustments.declutter,
      tone: request.adjustments.tone,
      preserveFeatures: [...request.adjustments.preserveFeatures],
    };
    const record = baseRecord({
      owner, kind: 'main_candidates', clientRequestId: request.clientRequestId, fingerprint,
      confirmedCount: request.confirmedProviderCalls, request, policySpec,
      temp: { source, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {} },
    });
    record.policy.phases = ['composition', ...Array(request.candidateCount).fill('style-light')];
    planAttempts(record, record.policy.phases);
    try { register(record); } catch (error) { deleteTemp(source); throw error; }
    return { type: 'created', record };
  }
  function createFinal(owner, request, ignoredParent, fingerprint) {
    const existing = idempotent(owner, request.clientRequestId, fingerprint);
    if (existing?.type === 'pending') return resumeCommittedTransaction(existing.record);
    if (existing) return existing;
    const parent = findOwn(owner, request.parentJobId);
    if (!parent || parent.kind !== 'main_candidates' || parent.status !== 'succeeded') return { type: 'absent' };
    assertLineageMutable(parent.wizardId);
    if (parent.expiresAt <= now()) return { type: 'expired' };
    const accepted = [...jobs.values()].find((record) => (
      record.kind === 'variant_set'
      && record.request.parentJobId === parent.jobId
      && record.request.candidateId === request.candidateId
    ));
    if (accepted) return { type: 'already', record: accepted };
    const selected = parent.temp.candidates.find((candidate) => candidate.candidateId === request.candidateId);
    if (!selected || !tempExists(selected.preview) || !tempExists(selected.providerInput)
        || !parent.temp.source || !tempExists(parent.temp.source)) return { type: 'expired' };
    const changedParent = structuredClone(parent);
    const cleanupRefs = [changedParent.temp.composition];
    for (const candidate of changedParent.temp.candidates) {
      if (candidate.candidateId !== selected.candidateId) cleanupRefs.push(candidate.preview, candidate.providerInput);
    }
    changedParent.temp = {
      source: null, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {},
    };
    changedParent.updatedAt = now();
    const record = baseRecord({
      owner, kind: 'variant_set', clientRequestId: request.clientRequestId, fingerprint,
      confirmedCount: 2, wizardId: parent.wizardId,
      wizardCounters: parent.providerCalls.wizard,
      expiresAt: parent.expiresAt,
      request: { ...request, parentJobId: parent.jobId }, policySpec: parent.policy.spec,
      temp: {
        source: parent.temp.source, composition: null, candidates: [],
        selectedProvider: selected.providerInput, selectedPreview: selected.preview, finals: {},
      },
    });
    record.policy.phases = ['dark', 'dark-off'];
    planAttempts(record, record.policy.phases);
    const prospective = prospectiveWizardRecords(parent.wizardId, [changedParent], [record]);
    const aggregateTimestamp = now();
    for (const changed of prospective.after) {
      if (JSON.stringify(changed.providerCalls) !== JSON.stringify(jobs.get(changed.jobId)?.providerCalls)) {
        changed.updatedAt = aggregateTimestamp;
      }
    }
    const committedRecord = prospective.after.find((changed) => changed.jobId === record.jobId);
    const transaction = runLineageTransaction(
      'final_accept', parent.wizardId, prospective.before, prospective.after, cleanupRefs,
    );
    if (transaction.type === 'cleanup_pending') return { type: 'cleanup_pending', record: committedRecord };
    if (transaction.type !== 'committed') return { type: 'already' };
    return { type: 'created', record: committedRecord };
  }

  function rollbackCreatedMain(jobId) {
    const record = jobs.get(jobId);
    if (!record || record.kind !== 'main_candidates' || record.status !== 'queued'
        || record.attempts.some((attempt) => attempt.status !== 'planned')) return false;
    assertLineageMutable(record.wizardId);
    removeRegularFile(metadataPath(jobId), 'Nicht übergebene Mainjobmetadaten konnten nicht zurückgerollt werden.');
    jobs.delete(jobId);
    rebuildIndexes();
    let cleanupError = null;
    for (const reference of allTempNames(record)) {
      try { deleteTemp(reference); } catch (error) { cleanupError ??= error; }
    }
    if (cleanupError) throw cleanupError;
    return true;
  }

  function update(jobId, mutate) {
    const current = jobs.get(jobId);
    if (!current) return null;
    assertLineageMutable(current.wizardId);
    const record = structuredClone(current);
    const result = mutate(record);
    record.updatedAt = now();
    persist(record);
    jobs.set(jobId, record);
    return result === undefined ? record : { record, result };
  }

  function prospectiveWizardRecords(wizardId, replacements = [], additions = []) {
    const before = [...jobs.values()]
      .filter((record) => record.wizardId === wizardId)
      .map((record) => structuredClone(record));
    const replacementMap = new Map(replacements.map((record) => [record.jobId, record]));
    const after = before.map((record) => structuredClone(replacementMap.get(record.jobId) ?? record));
    for (const record of additions) after.push(structuredClone(record));
    synchronizeRoomImageAggregates(after);
    return { before, after };
  }

  function applyProviderAttemptTransition(record, providerAttemptId, transitionId, target, outcome, errorCode) {
    if (record.transitionIds.includes(transitionId)) return false;
    const attempt = record.attempts.find((entry) => entry.providerAttemptId === providerAttemptId);
    if (!attempt) throw roomImageJobStoreError('Providerattempt fehlt.');
    const timestamp = now();
    if (target === 'started' && attempt.status === 'planned') {
      attempt.status = 'started'; attempt.startedAt = timestamp;
      record.status = 'running';
      const siblings = record.attempts.filter((entry) => entry.phase === attempt.phase);
      const index = siblings.findIndex((entry) => entry.providerAttemptId === providerAttemptId) + 1;
      record.phase = attempt.phase === 'style-light' ? `generating_style_${index}`
        : attempt.phase === 'dark-off' ? 'generating_dark_off'
          : `generating_${attempt.phase}`;
    } else if (target === 'completed' && attempt.status === 'started') {
      attempt.status = 'completed'; attempt.completedAt = timestamp;
      attempt.outcome = outcome; attempt.errorCode = errorCode;
    } else if (target === 'outcome_unknown' && attempt.status === 'started') {
      attempt.status = 'outcome_unknown'; attempt.unknownAt = timestamp;
      attempt.outcome = null; attempt.errorCode = 'PROVIDER_OUTCOME_UNKNOWN';
    } else if (target === 'failed_local' && attempt.status === 'planned') {
      attempt.status = 'failed_local'; attempt.errorCode = errorCode || 'LOCAL_PROVIDER_REQUEST_NOT_SENT';
    } else if (target === 'cancelled_before_start' && attempt.status === 'planned') {
      attempt.status = 'cancelled_before_start'; attempt.errorCode = errorCode || 'JOB_CANCELLED';
    } else return false;
    record.transitionIds.push(transitionId);
    return true;
  }

  function providerResultWrites(record, result) {
    if (result === null) return [];
    if (!result || typeof result !== 'object') throw roomImageJobStoreError('Ungültiges Providerresultat für den Commit.');
    if (result.type === 'composition' && result.bytes instanceof Uint8Array && result.bytes.byteLength > 0) {
      const targetRef = `compositions/composition-${record.lineageId}.jpg`;
      record.temp.composition = targetRef;
      const writes = [{ targetRef, bytes: result.bytes }];
      /* Die Komposition wird zusätzlich als erster Kandidat angeboten. Sie
         bekommt eigene Candidate-Refs, damit die Temp-Formprüfung greift. */
      if (ROOM_IMAGE_ID_PATTERN.test(result.candidateId || '')
          && result.previewBytes instanceof Uint8Array && result.previewBytes.byteLength > 0) {
        const preview = `candidates/candidate-${result.candidateId}.avif`;
        const providerInput = `candidates/candidate-${result.candidateId}.jpg`;
        record.temp.candidates.push({ candidateId: result.candidateId, preview, providerInput });
        writes.push({ targetRef: preview, bytes: result.previewBytes });
        writes.push({ targetRef: providerInput, bytes: result.bytes });
      }
      return writes;
    }
    if (result.type === 'candidate' && ROOM_IMAGE_ID_PATTERN.test(result.candidateId || '')
        && result.previewBytes instanceof Uint8Array && result.previewBytes.byteLength > 0
        && result.providerBytes instanceof Uint8Array && result.providerBytes.byteLength > 0) {
      const preview = `candidates/candidate-${result.candidateId}.avif`;
      const providerInput = `candidates/candidate-${result.candidateId}.jpg`;
      record.temp.candidates.push({ candidateId: result.candidateId, preview, providerInput });
      return [
        { targetRef: preview, bytes: result.previewBytes },
        { targetRef: providerInput, bytes: result.providerBytes },
      ];
    }
    if (result.type === 'final' && ['dark', 'darkOff'].includes(result.variant)
        && result.previewBytes instanceof Uint8Array && result.previewBytes.byteLength > 0) {
      const suffix = result.variant === 'darkOff' ? 'dark-off' : 'dark';
      const targetRef = `finals/final-${record.jobId}-${suffix}.avif`;
      record.temp.finals[result.variant] = targetRef;
      return [{ targetRef, bytes: result.previewBytes }];
    }
    throw roomImageJobStoreError('Ungültige Providerresultatform für den Commit.');
  }

  function verifyProviderResultFile(reference, write) {
    const bytes = readTemp(reference);
    return bytes.byteLength === write.byteLength
      && createHash('sha256').update(bytes).digest('hex') === write.sha256;
  }

  function cleanupProviderResultWrites(transaction, { includeTargets = false } = {}) {
    for (const write of transaction.resultWrites || []) {
      deleteTemp(write.stagedRef);
      if (includeTargets) deleteTemp(write.targetRef);
    }
  }

  function installProviderResultWrites(transaction) {
    for (const write of transaction.resultWrites) {
      const stagedExists = tempExists(write.stagedRef);
      const targetExists = tempExists(write.targetRef);
      if (targetExists) {
        if (!verifyProviderResultFile(write.targetRef, write)) throw roomImageJobStoreError('Providerresultat stimmt nicht mit dem Journal überein.');
        if (stagedExists) deleteTemp(write.stagedRef);
        continue;
      }
      if (!stagedExists || !verifyProviderResultFile(write.stagedRef, write)) {
        throw roomImageJobStoreError('Vorbereitetes Providerresultat fehlt oder ist inkohärent.');
      }
      assertSetupRecoveryHealthy();
      renameSync(tempPath(write.stagedRef), tempPath(write.targetRef));
      chmodSync(tempPath(write.targetRef), 0o600);
    }
  }

  function runProviderTransitionTransaction(transaction) {
    assertLineageMutable(transaction.lineageId);
    if (lineageLocks.has(transaction.lineageId)) return { type: 'busy' };
    lineageLocks.add(transaction.lineageId);
    try {
      persistTransaction(transaction);
      try {
        transactionStep('journal_prepared', structuredClone(transaction));
        installProviderResultWrites(transaction);
        transactionStep('results_installed', structuredClone(transaction));
        for (let index = 0; index < transaction.after.length; index += 1) {
          persist(transaction.after[index]);
          transactionStep(`after_${index + 1}_persisted`, structuredClone(transaction));
        }
        transaction.state = 'committed';
        persistTransaction(transaction);
        transactionStep('journal_committed', structuredClone(transaction));
      } catch (error) {
        if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
        restorePreparedTransaction(transaction);
        cleanupProviderResultWrites(transaction, { includeTargets: true });
        removeRegularFile(transactionPath(transaction.transactionId), 'Zurückgerolltes Providerjournal konnte nicht gelöscht werden.');
        throw error;
      }
      for (const record of transaction.after) jobs.set(record.jobId, record);
      rebuildIndexes();
      trackPendingCommittedTransaction(transaction);
      return completeCommittedLineageTransaction(transaction, { lockHeld: true });
    } finally {
      lineageLocks.delete(transaction.lineageId);
    }
  }

  function commitProviderTransition(jobId, providerAttemptId, transitionId, {
    target, outcome = null, errorCode = null, result = null, jobState = null,
  } = {}) {
    const existing = jobs.get(jobId);
    if (!existing) return null;
    if (existing.transitionIds.includes(transitionId)) return { record: existing, result: false };
    assertLineageMutable(existing.wizardId);
    if (typeof transitionId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(transitionId)) {
      throw roomImageJobStoreError('Ungültige Providertransition-ID.');
    }
    const changed = structuredClone(existing);
    if (!applyProviderAttemptTransition(changed, providerAttemptId, transitionId, target, outcome, errorCode)) {
      return { record: existing, result: false };
    }
    if ((target === 'completed' && outcome === 'result_valid') !== (result !== null)) {
      throw roomImageJobStoreError('Providerresultat und Terminaltransition stimmen nicht überein.');
    }
    const writes = providerResultWrites(changed, result);
    if (jobState !== null) {
      if (!jobState || typeof jobState !== 'object' || Array.isArray(jobState)) {
        throw roomImageJobStoreError('Ungültiger Jobzustand für Providertransition.');
      }
      Object.assign(changed, structuredClone(jobState));
    }
    const timestamp = now();
    changed.updatedAt = timestamp;
    const prospective = prospectiveWizardRecords(existing.wizardId, [changed]);
    for (const record of prospective.after) {
      if (record.jobId !== jobId && JSON.stringify(record.providerCalls) !== JSON.stringify(jobs.get(record.jobId).providerCalls)) {
        record.updatedAt = timestamp;
      }
    }
    const transactionId = roomImageOpaqueId();
    const resultWrites = writes.map((write, index) => ({
      stagedRef: `partials/.provider-transition-${transactionId}-${index}.stage`,
      targetRef: write.targetRef,
      sha256: createHash('sha256').update(write.bytes).digest('hex'),
      byteLength: write.bytes.byteLength,
    }));
    const transaction = {
      version: 1, transactionId, type: 'provider_transition', state: 'prepared',
      lineageId: existing.wizardId, before: prospective.before, after: prospective.after,
      cleanupRefs: [], transitionId, resultWrites,
    };
    const staged = [];
    try {
      transactionStep('before_result_write', structuredClone(transaction));
      for (let index = 0; index < writes.length; index += 1) {
        if (tempExists(writes[index].targetRef)) throw roomImageJobStoreError('Providerresultat-Ziel existiert bereits.');
        writeTemp('partials', `.provider-transition-${transactionId}-${index}.stage`, writes[index].bytes);
        staged.push(resultWrites[index].stagedRef);
      }
      transactionStep('after_result_write_before_prepared', structuredClone(transaction));
    } catch (error) {
      if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
      for (const reference of staged) deleteTemp(reference);
      throw error;
    }
    const committed = runProviderTransitionTransaction(transaction);
    if (!['committed', 'cleanup_pending'].includes(committed.type)) {
      for (const reference of staged) deleteTemp(reference);
      return { record: existing, result: false };
    }
    return {
      record: jobs.get(jobId), result: true,
      cleanupError: committed.type === 'cleanup_pending'
        ? roomImageJobStoreError('Der Providertransition-Cleanup ist noch nicht sicher abgeschlossen.')
        : null,
    };
  }

  function commitFinalValidation(jobId, lightBytes) {
    const existing = jobs.get(jobId);
    if (!existing || existing.kind !== 'variant_set'
        || existing.status !== 'running' || existing.phase !== 'validating_set'
        || Object.hasOwn(existing.temp.finals, 'light')
        || !existing.temp.finals.dark || !existing.temp.finals.darkOff
        || existing.attempts.some((attempt) => attempt.status !== 'completed' || attempt.outcome !== 'result_valid')
        || !(lightBytes instanceof Uint8Array) || lightBytes.byteLength < 1) {
      return { record: existing ?? null, result: false };
    }
    assertLineageMutable(existing.wizardId);
    const changed = structuredClone(existing);
    const targetRef = `finals/final-${jobId}-light.avif`;
    changed.temp.finals.light = targetRef;
    changed.status = 'awaiting_confirmation'; changed.phase = 'awaiting_confirmation';
    changed.cancellable = true; changed.retryable = false; changed.discardable = false;
    changed.retry = null; changed.error = null; changed.updatedAt = now();
    const transactionId = roomImageOpaqueId();
    const stagedRef = `partials/.provider-transition-${transactionId}-0.stage`;
    const resultWrite = {
      stagedRef, targetRef,
      sha256: createHash('sha256').update(lightBytes).digest('hex'),
      byteLength: lightBytes.byteLength,
    };
    const transaction = {
      version: 1, transactionId, type: 'final_validation', state: 'prepared',
      lineageId: existing.wizardId, before: [structuredClone(existing)], after: [changed],
      cleanupRefs: [], resultWrites: [resultWrite],
    };
    try {
      transactionStep('before_result_write', structuredClone(transaction));
      if (tempExists(targetRef)) throw roomImageJobStoreError('Finales Light-Ziel existiert bereits.');
      writeTemp('partials', `.provider-transition-${transactionId}-0.stage`, lightBytes);
      transactionStep('after_result_write_before_prepared', structuredClone(transaction));
    } catch (error) {
      if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
      deleteTemp(stagedRef);
      throw error;
    }
    const committed = runProviderTransitionTransaction(transaction);
    if (!['committed', 'cleanup_pending'].includes(committed.type)) {
      deleteTemp(stagedRef);
      return { record: existing, result: false };
    }
    return {
      record: jobs.get(jobId), result: true,
      cleanupError: committed.type === 'cleanup_pending'
        ? roomImageJobStoreError('Der Finalvalidierungs-Cleanup ist noch nicht sicher abgeschlossen.')
        : null,
    };
  }

  function transition(jobId, providerAttemptId, transitionId, target, outcome = null, errorCode = null) {
    return commitProviderTransition(jobId, providerAttemptId, transitionId, {
      target, outcome, errorCode, result: null,
    });
  }
  function setJobState(jobId, fields) {
    return update(jobId, (record) => Object.assign(record, fields));
  }
  function beginPublish(owner, jobId) {
    const current = findOwn(owner, jobId);
    if (!current || current.kind !== 'variant_set') return { type: 'absent' };
    if (current.status === 'succeeded' && current.asset) return { type: 'replay', record: current };
    if (current.phase === 'publishing_set') return { type: 'publishing', record: current };
    if (current.status !== 'awaiting_confirmation' || current.phase !== 'awaiting_confirmation') {
      return { type: 'ineligible', record: current };
    }
    if (current.expiresAt <= now()
        || !['light', 'dark', 'darkOff'].every((key) => current.temp.finals[key] && tempExists(current.temp.finals[key]))) {
      update(jobId, (record) => expire(record));
      return { type: 'expired', record: jobs.get(jobId) };
    }
    const reservedAssetId = current.reservedAssetId ?? roomImageAssetId();
    const record = update(jobId, (changed) => {
      changed.phase = 'publishing_set';
      changed.cancellable = false;
      changed.reservedAssetId = reservedAssetId;
    });
    return { type: 'started', record };
  }
  function finishPublish(jobId, asset) {
    const current = jobs.get(jobId);
    if (!current || current.kind !== 'variant_set' || current.phase !== 'publishing_set'
        || current.reservedAssetId !== asset?.assetId || !validRoomImageAssetObject(asset)) {
      throw roomImageJobStoreError('Der Publish-Jobcommit ist inkohärent.');
    }
    const cleanupRefs = allTempNames(current);
    const record = update(jobId, (changed) => {
      changed.status = 'succeeded'; changed.phase = 'complete'; changed.cancellable = false;
      changed.retryable = false; changed.discardable = false; changed.retry = null;
      changed.error = null; changed.asset = structuredClone(asset);
      changed.temp = {
        source: null, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {},
      };
    });
    transactionStep('job_committed', { jobId, assetId: asset.assetId });
    transactionStep('before_temp_cleanup', { jobId, assetId: asset.assetId, cleanupRefs: [...cleanupRefs] });
    for (const reference of cleanupRefs) deleteTemp(reference);
    return record;
  }
  function failPublish(jobId, code = 'PUBLISH_FAILED') {
    const current = jobs.get(jobId);
    if (!current || current.kind !== 'variant_set' || current.phase !== 'publishing_set') return current ?? null;
    const cleanupRefs = allTempNames(current);
    const record = update(jobId, (changed) => {
      changed.status = 'failed'; changed.phase = 'complete'; changed.cancellable = false;
      changed.retryable = false; changed.discardable = true; changed.retry = null;
      changed.error = {
        code,
        message: code === 'PUBLISH_RECOVERY_REQUIRED'
          ? 'Die Veröffentlichung muss kontrolliert geprüft werden.'
          : 'Die Veröffentlichung wurde kontrolliert zurückgerollt.',
      };
      changed.temp = {
        source: null, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {},
      };
    });
    for (const reference of cleanupRefs) deleteTemp(reference);
    return record;
  }
  function findOwn(owner, jobId) {
    const record = ROOM_IMAGE_ID_PATTERN.test(jobId || '') ? jobs.get(jobId) : null;
    return record?.owner === owner ? record : null;
  }
  function publicJob(record) {
    const candidates = record.kind === 'main_candidates' && record.status === 'succeeded'
      ? record.temp.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        previewUrl: `/api/room-image-jobs/${record.jobId}/previews/${candidate.candidateId}`,
        suggestedRoomId: null,
      })) : [];
    const temporaryVariants = record.kind === 'variant_set' && record.status === 'awaiting_confirmation'
      && record.phase === 'awaiting_confirmation'
      ? {
        light: `/api/room-image-jobs/${record.jobId}/final-previews/light`,
        dark: `/api/room-image-jobs/${record.jobId}/final-previews/dark`,
        darkOff: `/api/room-image-jobs/${record.jobId}/final-previews/dark-off`,
      } : null;
    return {
      jobId: record.jobId, kind: record.kind, clientRequestId: record.clientRequestId,
      attemptId: record.attemptId, parentAttemptId: record.parentAttemptId,
      lineageId: record.lineageId, status: record.status, phase: record.phase,
      createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString(),
      expiresAt: new Date(record.expiresAt).toISOString(), cancellable: record.cancellable,
      retryable: record.retryable, discardable: record.discardable,
      retry: record.retry, supersededByJobId: record.supersededByJobId,
      providerCalls: structuredClone(record.providerCalls), candidates,
      ...(temporaryVariants ? { temporaryVariants, focus: structuredClone(record.request.focus) } : {}),
      asset: record.asset ? structuredClone(record.asset) : null,
      error: record.error ? structuredClone(record.error) : null,
    };
  }

  function retry(owner, oldJobId, request, fingerprint) {
    const old = findOwn(owner, oldJobId);
    if (!old) return { type: 'absent' };
    const existing = idempotent(owner, request.clientRequestId, fingerprint);
    if (existing?.type === 'pending') return resumeCommittedTransaction(existing.record);
    if (existing) return existing;
    assertLineageMutable(old.wizardId);
    if (old.status === 'superseded') return { type: 'already', record: jobs.get(old.supersededByJobId), old };
    if (old.expiresAt <= now()) return { type: 'expired', old };
    if (old.status !== 'failed' || !old.retryable || !old.retry) return { type: 'not_retryable', old };
    if (!old.temp.source || !tempExists(old.temp.source)
        || (old.kind === 'variant_set' && (!old.temp.selectedProvider || !tempExists(old.temp.selectedProvider)))) {
      return { type: 'expired', old };
    }
    const phases = old.kind === 'main_candidates'
      ? (old.temp.composition && tempExists(old.temp.composition)
        ? Array(old.request.candidateCount).fill('style-light')
        : ['composition', ...Array(old.request.candidateCount).fill('style-light')])
      : ['dark', 'dark-off'];
    if (request.confirmedProviderCalls !== phases.length) return { type: 'call_mismatch', old };
    const beforeOld = structuredClone(old);
    const record = baseRecord({
      owner, kind: old.kind, clientRequestId: request.clientRequestId, fingerprint,
      confirmedCount: phases.length, wizardId: old.wizardId, lineageId: old.lineageId,
      parentAttemptId: old.attemptId, lineageCounters: old.providerCalls.lineage,
      wizardCounters: old.providerCalls.wizard,
      expiresAt: old.expiresAt,
      request: structuredClone(old.request), policySpec: structuredClone(old.policy.spec),
      temp: structuredClone(old.temp),
    });
    record.request.clientRequestId = request.clientRequestId;
    record.request.confirmedProviderCalls = request.confirmedProviderCalls;
    record.policy.phases = phases;
    record.temp.candidates = [];
    record.temp.finals = {};
    planAttempts(record, phases);
    const changedOld = structuredClone(old);
    changedOld.status = 'superseded'; changedOld.phase = 'complete'; changedOld.cancellable = false;
    changedOld.retryable = false; changedOld.discardable = true; changedOld.retry = null;
    changedOld.supersededByJobId = record.jobId; changedOld.updatedAt = now();
    changedOld.temp = { source: null, composition: null, candidates: [], selectedProvider: null, selectedPreview: null, finals: {} };
    const successorRefs = new Set(allTempNames(record));
    const cleanupRefs = allTempNames(beforeOld).filter((reference) => !successorRefs.has(reference));
    const prospective = prospectiveWizardRecords(old.wizardId, [changedOld], [record]);
    const aggregateTimestamp = now();
    for (const changed of prospective.after) {
      if (JSON.stringify(changed.providerCalls) !== JSON.stringify(jobs.get(changed.jobId)?.providerCalls)) {
        changed.updatedAt = aggregateTimestamp;
      }
    }
    const committedRecord = prospective.after.find((changed) => changed.jobId === record.jobId);
    const transaction = runLineageTransaction(
      'retry_supersede', old.wizardId, prospective.before, prospective.after, cleanupRefs,
    );
    if (transaction.type === 'cleanup_pending') return { type: 'cleanup_pending', record: committedRecord };
    if (transaction.type !== 'committed') return { type: 'already' };
    return { type: 'created', record: committedRecord };
  }

  function discard(owner, jobId) {
    const record = findOwn(owner, jobId);
    if (!record) return 'absent';
    assertLineageMutable(record.wizardId);
    if (!['failed', 'cancelled', 'expired', 'superseded'].includes(record.status)) return 'not_discardable';
    update(jobId, (changed) => {
      clearTemps(changed);
      changed.retryable = false; changed.discardable = false; changed.retry = null;
    });
    return 'discarded';
  }
  function expire(record, code = 'ROOM_IMAGE_TEMP_EXPIRED') {
    clearTemps(record);
    record.status = 'expired'; record.phase = 'complete'; record.cancellable = false;
    record.retryable = false; record.discardable = true; record.retry = null;
    record.error = { code, message: 'Temporäre Room-Image-Daten sind abgelaufen.' };
  }
  function cleanup() {
    const timestamp = now();
    for (const record of [...jobs.values()]) {
      if (pendingLineageTransaction(record.wizardId)) continue;
      /* Veroeffentlichte Sets haben keine Zwischendaten mehr: sie duerfen nicht
         ablaufen, sonst widerspricht der Datensatz (Asset ohne 'succeeded')
         seiner eigenen Validierung und der Start scheitert. */
      if (record.expiresAt <= timestamp && record.phase !== 'publishing_set' && record.asset === null
          && !['expired', 'cancelled', 'superseded'].includes(record.status)) {
        update(record.jobId, (changed) => expire(changed));
      }
    }
  }

  function recover(initialRecord) {
    let record = jobs.get(initialRecord.jobId) ?? initialRecord;
    let changed = false;
    for (const attempt of [...record.attempts]) {
      if (attempt.status === 'started') {
        const transitionId = `recovery-unknown-${attempt.providerAttemptId}`;
        commitProviderTransition(record.jobId, attempt.providerAttemptId, transitionId, {
          target: 'outcome_unknown', outcome: null, errorCode: 'PROVIDER_OUTCOME_UNKNOWN', result: null,
        });
        record = jobs.get(record.jobId);
      } else if (attempt.status === 'planned') {
        const transitionId = `recovery-planned-${attempt.providerAttemptId}`;
        const cancelling = record.status === 'cancelling';
        commitProviderTransition(record.jobId, attempt.providerAttemptId, transitionId, {
          target: cancelling ? 'cancelled_before_start' : 'failed_local', outcome: null,
          errorCode: cancelling ? 'JOB_CANCELLED' : 'SERVER_RESTARTED_RETRY_REQUIRED', result: null,
        });
        record = jobs.get(record.jobId);
      }
    }
    if (record.status === 'cancelling') {
      const outcomeUnknown = record.attempts.some((attempt) => attempt.status === 'outcome_unknown');
      clearTemps(record);
      record.status = 'cancelled'; record.phase = 'complete'; record.cancellable = false;
      record.retryable = false; record.discardable = true; record.retry = null;
      record.error = {
        code: outcomeUnknown ? 'PROVIDER_OUTCOME_UNKNOWN' : 'JOB_CANCELLED',
        message: outcomeUnknown
          ? 'Der Providerausgang ist nach dem Abbruch unbekannt.'
          : 'Der Job wurde nach einem Serverneustart kontrolliert abgebrochen.',
      };
      changed = true;
    } else if (['queued', 'running'].includes(record.status)) {
      const hasSource = Boolean(record.temp.source && tempExists(record.temp.source));
      const hasLineageSource = hasSource && (record.kind !== 'variant_set'
        || Boolean(record.temp.selectedProvider && record.temp.selectedPreview
          && tempExists(record.temp.selectedProvider) && tempExists(record.temp.selectedPreview)));
      if (!hasLineageSource) expire(record, 'SERVER_RESTARTED_SOURCE_MISSING');
      else {
        const keepComposition = record.kind === 'main_candidates'
          && Boolean(record.temp.composition && tempExists(record.temp.composition));
        clearTemps(record, {
          keepSource: true,
          keepComposition,
          keepSelected: record.kind === 'variant_set',
        });
        record.status = 'failed';
        record.phase = 'complete'; record.cancellable = false; record.discardable = true;
        const required = record.kind === 'variant_set'
          ? 2
          : keepComposition ? record.request.candidateCount : record.request.candidateCount + 1;
        record.retryable = true;
        record.retry = { kind: record.kind, requiredProviderCalls: required, noticeVersion: 'room-image-v1' };
        record.error = { code: record.attempts.some((attempt) => attempt.status === 'outcome_unknown')
          ? 'PROVIDER_OUTCOME_UNKNOWN' : 'SERVER_RESTARTED_RETRY_REQUIRED', message: 'Der Job wurde nach einem Serverneustart kontrolliert beendet.' };
      }
      changed = true;
    }
    if (record.status === 'failed' && record.retryable) {
      const resumable = Boolean(record.temp.source && tempExists(record.temp.source))
        && (record.kind !== 'variant_set' || Boolean(
          record.temp.selectedProvider && record.temp.selectedPreview
          && tempExists(record.temp.selectedProvider) && tempExists(record.temp.selectedPreview)
        ));
      if (!resumable) { expire(record, 'SERVER_RESTARTED_SOURCE_MISSING'); changed = true; }
    }
    if (record.status === 'succeeded' && record.kind === 'main_candidates') {
      const transferredToFinal = record.temp.source === null && record.temp.composition === null
        && record.temp.candidates.length === 0 && [...jobs.values()].some((candidate) => (
          candidate.kind === 'variant_set' && candidate.request.parentJobId === record.jobId
        ));
      if (!transferredToFinal
          && (!record.temp.candidates.length || record.temp.candidates.some((candidate) => !tempExists(candidate.preview)))) {
        expire(record, 'SERVER_RESTARTED_SOURCE_MISSING'); changed = true;
      }
    }
    if (record.status === 'awaiting_confirmation' && record.phase === 'awaiting_confirmation'
        && !['light', 'dark', 'darkOff'].every((key) => tempExists(record.temp.finals[key]))) {
      expire(record, 'SERVER_RESTARTED_SOURCE_MISSING'); changed = true;
    }
    if (changed) { record.updatedAt = now(); persist(record); }
  }

  function validStoredReferences() {
    const recordsByAttemptId = new Map();
    const finalCandidateKeys = new Set();
    const tempOwners = new Map();
    const lineageAggregates = new Map();
    const wizardAggregates = new Map();
    for (const record of jobs.values()) {
      if (recordsByAttemptId.has(record.attemptId)) return false;
      recordsByAttemptId.set(record.attemptId, record);
      const attemptCounters = derivedRoomImageAttemptCounters(record);
      for (const [aggregates, id] of [[lineageAggregates, record.lineageId], [wizardAggregates, record.wizardId]]) {
        const aggregate = aggregates.get(id) ?? roomImageCounters();
        for (const key of ROOM_IMAGE_COUNTER_KEYS) aggregate[key] += attemptCounters[key];
        aggregates.set(id, aggregate);
      }
      for (const reference of allTempNames(record)) {
        if (tempOwners.has(reference)) return false;
        tempOwners.set(reference, record.jobId);
      }
      if (record.kind === 'variant_set') {
        const key = `${record.request.parentJobId}\u0000${record.request.candidateId}`;
        if (finalCandidateKeys.has(key)) return false;
        finalCandidateKeys.add(key);
      }
    }
    for (const record of jobs.values()) {
      if (!ROOM_IMAGE_COUNTER_KEYS.every((key) => (
        record.providerCalls.lineage[key] === lineageAggregates.get(record.lineageId)[key]
        && record.providerCalls.wizard[key] === wizardAggregates.get(record.wizardId)[key]
      ))) return false;
      if (record.kind === 'variant_set') {
        const parent = jobs.get(record.request.parentJobId);
        if (!parent || parent.kind !== 'main_candidates'
            || parent.owner !== record.owner || parent.wizardId !== record.wizardId
            || parent.expiresAt !== record.expiresAt
            || JSON.stringify(parent.policy.spec) !== JSON.stringify(record.policy.spec)) return false;
      }
      if (record.parentAttemptId !== null) {
        const parent = recordsByAttemptId.get(record.parentAttemptId);
        if (!parent || parent.status !== 'superseded' || parent.supersededByJobId !== record.jobId
            || parent.owner !== record.owner || parent.kind !== record.kind
            || parent.lineageId !== record.lineageId || parent.wizardId !== record.wizardId
            || parent.expiresAt !== record.expiresAt) return false;
      }
      if (record.status === 'superseded') {
        const successor = jobs.get(record.supersededByJobId);
        if (!successor || successor.parentAttemptId !== record.attemptId) return false;
      }
      if (record.kind === 'main_candidates' && record.status === 'succeeded' && record.temp.source === null) {
        const finals = [...jobs.values()].filter((candidate) => (
          candidate.kind === 'variant_set' && candidate.request.parentJobId === record.jobId
        ));
        if (finals.length !== 1) return false;
      }
    }
    return true;
  }

  function load() {
    let names;
    try { names = readdirSync(root); } catch (error) { throw roomImageJobStoreError('Jobmetadaten konnten nicht gelesen werden.', error); }
    const transactions = [];
    for (const name of names.filter((entry) => /^\.room-image-transaction-[A-Za-z0-9_-]{43}\.json$/.test(entry))) {
      const transactionId = name.slice('.room-image-transaction-'.length, -5);
      let transaction;
      try {
        const path = join(root, name);
        const metadata = lstatSync(path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe transaction journal');
        transaction = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) { throw roomImageJobStoreError('Korruptes Room-Image-Transaktionsjournal.', error); }
      if (!validTransaction(transaction, transactionId)) {
        throw roomImageJobStoreError('Inkohärentes Room-Image-Transaktionsjournal.');
      }
      transactions.push(transaction);
    }
    const duplicateLineages = new Set();
    for (const transaction of transactions) {
      if (duplicateLineages.has(transaction.lineageId)) {
        throw roomImageJobStoreError('Mehrere offene Transaktionen derselben Room-Image-Lineage.');
      }
      duplicateLineages.add(transaction.lineageId);
    }
    for (const transaction of transactions) {
      if (transaction.state === 'prepared') {
        restorePreparedTransaction(transaction);
        if (Array.isArray(transaction.resultWrites)) {
          cleanupProviderResultWrites(transaction, { includeTargets: true });
        }
        removeRegularFile(transactionPath(transaction.transactionId), 'Zurückgerolltes Startup-Transaktionsjournal konnte nicht gelöscht werden.');
      } else {
        if (Array.isArray(transaction.resultWrites)) installProviderResultWrites(transaction);
        for (const record of transaction.after) persist(record);
      }
    }
    try { names = readdirSync(root); } catch (error) { throw roomImageJobStoreError('Jobmetadaten konnten nach Recovery nicht gelesen werden.', error); }
    for (const name of names.filter((entry) => /^[A-Za-z0-9_-]{43}\.json$/.test(entry))) {
      const jobId = name.slice(0, -5);
      let record;
      try {
        const path = join(root, name);
        const metadata = lstatSync(path);
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe metadata');
        record = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) { throw roomImageJobStoreError('Korrupte Room-Image-Jobmetadaten.', error); }
      if (!validStoredRoomImageJob(record, jobId)) throw roomImageJobStoreError('Inkohärente Room-Image-Jobmetadaten.');
      const key = `${record.owner}\u0000${record.clientRequestId}`;
      if (idempotency.has(key)) throw roomImageJobStoreError('Doppelte Room-Image-Idempotenzdaten.');
      jobs.set(jobId, record); idempotency.set(key, jobId);
    }
    if (!validStoredReferences()) throw roomImageJobStoreError('Inkohärente Room-Image-Jobreferenzen.');
    initializePrivateRoots();
    for (const transaction of transactions.filter((entry) => entry.state === 'committed')) {
      for (const reference of transaction.cleanupRefs) deleteTemp(reference);
      if (Array.isArray(transaction.resultWrites)) cleanupProviderResultWrites(transaction);
      removeRegularFile(transactionPath(transaction.transactionId), 'Abgeschlossenes Startup-Transaktionsjournal konnte nicht gelöscht werden.');
    }
    for (const name of names) {
      if (/^\.job-[A-Za-z0-9_-]{43}-[A-Za-z0-9_-]{16}\.tmp$/.test(name)
          || /^\.room-image-transaction-[A-Za-z0-9_-]{43}-[A-Za-z0-9_-]{16}\.tmp$/.test(name)) {
        try { removeFile(join(root, name)); } catch (error) { throw roomImageJobStoreError('Jobpartial konnte nicht bereinigt werden.', error); }
      }
    }
    for (const record of jobs.values()) recover(record);
    cleanup();
    const referenced = new Set([...jobs.values()].flatMap(allTempNames));
    for (const [kind, directory] of Object.entries(tempDirectories)) {
      const namesInDirectory = readdirSync(directory);
      for (const name of namesInDirectory) {
        const relative = `${kind}/${name}`;
        if (kind === 'partials' && (
          /^\.room-image-[A-Za-z0-9_-]{32}\.tmp$/.test(name)
          || /^\.provider-transition-[A-Za-z0-9_-]{43}-[0-9]+\.stage$/.test(name)
        )) deleteTemp(relative);
        else if (kind !== 'partials' && /^[A-Za-z0-9_.-]+$/.test(name) && !referenced.has(relative)) deleteTemp(relative);
      }
    }
  }

  load();
  return {
    beginPublish, cleanup, commitFinalValidation, commitProviderTransition, createFinal, createMain, deleteTemp, discard,
    failPublish, finishPublish,
    findOwn, get(jobId) { cleanup(); return jobs.get(jobId) ?? null; },
    getOwn(owner, jobId) { cleanup(); return findOwn(owner, jobId); },
    idempotent, metadataRoot: root, now, persist, privateRoot,
    publicJob, readTemp, records() { cleanup(); return [...jobs.values()]; }, retry, rollbackCreatedMain, setJobState, tempExists, transition, update, writeTemp,
  };
}

class RoomImageAssetStoreError extends Error {
  constructor(message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'RoomImageAssetStoreError';
    this.code = 'ROOM_IMAGE_STORE_INVALID';
  }
}

function roomImageAssetStoreError(message, cause = undefined) {
  return new RoomImageAssetStoreError(message, cause);
}

function roomImageAssetPublic(assetId, focus) {
  return {
    assetId,
    variants: {
      light: `/assets/room-images/${assetId}/light.avif`,
      dark: `/assets/room-images/${assetId}/dark.avif`,
      darkOff: `/assets/room-images/${assetId}/dark-off.avif`,
    },
    focus: structuredClone(focus),
  };
}

function flushDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function canonicalRoomImageAssetPath(path) {
  const absolute = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  if (absolute === temporaryRoot || absolute.startsWith(`${temporaryRoot}${sep}`)) {
    return join(realpathSync(temporaryRoot), absolute.slice(temporaryRoot.length));
  }
  return absolute;
}

function inspectRoomImageAssetPath(path, expectedType = null) {
  const absolute = canonicalRoomImageAssetPath(path);
  const chain = [];
  for (let current = absolute; ; current = dirname(current)) {
    chain.push(current);
    if (dirname(current) === current) break;
  }
  chain.reverse();
  for (const [index, current] of chain.entries()) {
    let metadata;
    try { metadata = lstatSync(current); } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return { path: absolute, exists: false };
      }
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error('unsafe symlink component');
    if (index < chain.length - 1 && !metadata.isDirectory()) throw new Error('unsafe non-directory ancestor');
    if (index === chain.length - 1 && expectedType === 'directory' && !metadata.isDirectory()) {
      throw new Error('unsafe directory');
    }
    if (index === chain.length - 1 && expectedType === 'file' && !metadata.isFile()) {
      throw new Error('unsafe file');
    }
  }
  if (realpathSync(absolute) !== absolute) throw new Error('unsafe realpath mismatch');
  return { path: absolute, exists: true };
}

function ensureRoomImageAssetDirectory(path) {
  try {
    const inspected = inspectRoomImageAssetPath(path, 'directory');
    if (!inspected.exists) mkdirSync(inspected.path, { recursive: true, mode: 0o700 });
    const created = inspectRoomImageAssetPath(inspected.path, 'directory');
    if (!created.exists) throw new Error('directory creation failed');
    return created.path;
  } catch (error) {
    throw roomImageAssetStoreError('Ein Room-Image-Assetverzeichnis ist unsicher.', error);
  }
}

function realRoomImagePathContained(parent, candidate) {
  const realParent = realpathSync(parent);
  const realCandidate = realpathSync(candidate);
  return realCandidate.startsWith(`${realParent}${sep}`);
}

function validRoomImageAssetFileInfo(value) {
  return roomImageExactObject(value, ['sha256', 'byteLength'])
    && /^[0-9a-f]{64}$/.test(value.sha256 || '')
    && Number.isSafeInteger(value.byteLength) && value.byteLength > 0;
}

function validRoomImageCatalogEntry(entry) {
  if (!roomImageExactObject(entry, [
    'assetId', 'variants', 'focus', 'createdAt', 'status', 'files', 'manifestSha256',
  ])
      || !ROOM_IMAGE_ASSET_ID_PATTERN.test(entry.assetId || '')
      || !roomImageExactObject(entry.variants, ['light', 'dark', 'darkOff'])
      || !Object.entries(ROOM_IMAGE_VARIANT_FILES).every(([key, name]) => entry.variants[key] === name)
      || !validStoredRoomImageFocus(entry.focus)
      || typeof entry.createdAt !== 'string' || Number.isNaN(Date.parse(entry.createdAt))
      || !['active', 'tombstone'].includes(entry.status)
      || !roomImageExactObject(entry.files, ['light', 'dark', 'darkOff'])
      || !Object.values(entry.files).every(validRoomImageAssetFileInfo)
      || !/^[0-9a-f]{64}$/.test(entry.manifestSha256 || '')) return false;
  return true;
}

export function createRoomImageAssetStore({
  catalogPath,
  assetRoot = ROOM_IMAGE_ASSET_ROOT,
  now = () => Date.now(),
  transactionStep = () => undefined,
  removeTree = rmSync,
  readOnly = false,
  assertSetupRecoveryHealthy = () => undefined,
} = {}) {
  if (typeof catalogPath !== 'string' || !catalogPath) {
    throw roomImageAssetStoreError('Der Room-Image-Katalogpfad fehlt.');
  }
  let root = canonicalRoomImageAssetPath(assetRoot);
  const setsRoot = join(root, 'room-images');
  const catalog = canonicalRoomImageAssetPath(catalogPath);
  let catalogExisted;
  try {
    inspectRoomImageAssetPath(root, 'directory');
    inspectRoomImageAssetPath(setsRoot, 'directory');
    inspectRoomImageAssetPath(dirname(catalog), 'directory');
    catalogExisted = inspectRoomImageAssetPath(catalog, 'file').exists;
  } catch (error) {
    throw roomImageAssetStoreError('Ein kontrollierter Room-Image-Assetpfad ist unsicher.', error);
  }

  function assertMutable() {
    assertSetupRecoveryHealthy();
    if (readOnly) throw roomImageAssetStoreError('Der Room-Image-Assetkatalog ist schreibgeschützt.');
  }

  function safeSetPath(assetId) {
    if (!ROOM_IMAGE_ASSET_ID_PATTERN.test(assetId || '')) return null;
    const path = join(setsRoot, assetId);
    return dirname(path) === setsRoot ? path : null;
  }
  function stagingPath(assetId) {
    const path = safeSetPath(assetId);
    return path ? join(setsRoot, `.publishing-${assetId}`) : null;
  }
  function readCatalog() {
    let document;
    try {
      const inspected = inspectRoomImageAssetPath(catalog, 'file');
      if (!inspected.exists) return { version: 1, assets: [] };
      document = JSON.parse(readFileSync(catalog, 'utf8'));
    } catch (error) {
      throw roomImageAssetStoreError('Der Room-Image-Katalog ist korrupt oder unsicher.', error);
    }
    if (!roomImageExactObject(document, ['version', 'assets']) || document.version !== 1
        || !Array.isArray(document.assets) || !document.assets.every(validRoomImageCatalogEntry)
        || new Set(document.assets.map((entry) => entry.assetId)).size !== document.assets.length) {
      throw roomImageAssetStoreError('Der Room-Image-Katalog verletzt den geschlossenen Vertrag.');
    }
    return document;
  }
  function atomicCatalogWrite(document, commitState = { committed: false }) {
    assertMutable();
    if (!roomImageExactObject(document, ['version', 'assets']) || document.version !== 1
        || !Array.isArray(document.assets) || !document.assets.every(validRoomImageCatalogEntry)) {
      throw roomImageAssetStoreError('Ein inkohärenter Room-Image-Katalogwrite wurde abgewiesen.');
    }
    const temporary = join(dirname(catalog), `.assets-${randomBytes(16).toString('hex')}.tmp`);
    let primaryError = null;
    try {
      transactionStep('catalog_before_write', structuredClone(document));
      assertMutable();
      writeFileSync(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600, flush: true });
      chmodSync(temporary, 0o600);
      transactionStep('catalog_written', structuredClone(document));
      assertMutable();
      renameSync(temporary, catalog);
      commitState.committed = true;
      transactionStep('catalog_renamed', structuredClone(document));
      flushDirectory(dirname(catalog));
      transactionStep('catalog_directory_fsynced', structuredClone(document));
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try { unlinkSync(temporary); } catch (error) {
        if ((!error || typeof error !== 'object' || error.code !== 'ENOENT') && primaryError === null) {
          throw roomImageAssetStoreError('Ein Katalogpartial konnte nicht bereinigt werden.', error);
        }
      }
    }
  }
  function regularBytes(path) {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('unsafe asset file');
    return readFileSync(path);
  }
  function verifyEntryFiles(entry) {
    const directory = safeSetPath(entry.assetId);
    try {
      if (!directory || !inspectRoomImageAssetPath(setsRoot, 'directory').exists
          || !inspectRoomImageAssetPath(directory, 'directory').exists
          || !realRoomImagePathContained(setsRoot, directory)) return false;
      const expected = [...Object.values(ROOM_IMAGE_VARIANT_FILES), 'manifest.json'].sort();
      if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected)) return false;
      for (const [key, name] of Object.entries(ROOM_IMAGE_VARIANT_FILES)) {
        const path = join(directory, name);
        if (!inspectRoomImageAssetPath(path, 'file').exists || !realRoomImagePathContained(directory, path)) return false;
        const bytes = regularBytes(path);
        const info = entry.files[key];
        if (bytes.byteLength !== info.byteLength
            || createHash('sha256').update(bytes).digest('hex') !== info.sha256) return false;
      }
      const manifestPath = join(directory, 'manifest.json');
      if (!inspectRoomImageAssetPath(manifestPath, 'file').exists
          || !realRoomImagePathContained(directory, manifestPath)) return false;
      const manifest = regularBytes(manifestPath);
      if (createHash('sha256').update(manifest).digest('hex') !== entry.manifestSha256) return false;
      const manifestDocument = JSON.parse(manifest.toString('utf8'));
      return roomImageExactObject(manifestDocument, ['version', 'assetId', 'files'])
        && manifestDocument.version === 1
        && manifestDocument.assetId === entry.assetId
        && roomImageExactObject(manifestDocument.files, ['light', 'dark', 'darkOff'])
        && Object.entries(entry.files).every(([key, info]) => (
          validRoomImageAssetFileInfo(manifestDocument.files[key])
          && manifestDocument.files[key].sha256 === info.sha256
          && manifestDocument.files[key].byteLength === info.byteLength
        ));
    } catch { return false; }
  }
  function activeEntry(assetId, { requireComplete = true } = {}) {
    const entry = readCatalog().assets.find((candidate) => candidate.assetId === assetId);
    if (!entry || entry.status !== 'active') return null;
    if (requireComplete && !verifyEntryFiles(entry)) {
      throw roomImageAssetStoreError('Ein katalogisiertes Room-Image-Asset ist unvollständig oder unsicher.');
    }
    return entry;
  }
  function status(assetId) {
    const entry = readCatalog().assets.find((candidate) => candidate.assetId === assetId);
    if (!entry) return 'not_found';
    if (entry.status === 'tombstone') return 'tombstone';
    return verifyEntryFiles(entry) ? 'complete' : 'incomplete';
  }
  function list() {
    const document = readCatalog();
    return document.assets.filter((entry) => entry.status === 'active').map((entry) => {
      if (!verifyEntryFiles(entry)) throw roomImageAssetStoreError('Ein katalogisiertes Asset ist unvollständig.');
      const byteLength = Object.values(entry.files)
        .reduce((total, info) => total + info.byteLength, 0);
      return { ...roomImageAssetPublic(entry.assetId, entry.focus), createdAt: entry.createdAt, byteLength };
    });
  }
  function publish(assetId, focus, variants) {
    assertMutable();
    if (!ROOM_IMAGE_ASSET_ID_PATTERN.test(assetId || '') || !validStoredRoomImageFocus(focus)
        || !roomImageExactObject(variants, ['light', 'dark', 'darkOff'])
        || !Object.values(variants).every((bytes) => bytes instanceof Uint8Array && bytes.byteLength > 0)) {
      throw roomImageAssetStoreError('Ungültiger Room-Image-Publishinput.');
    }
    const document = readCatalog();
    const existing = document.assets.find((entry) => entry.assetId === assetId);
    if (existing) {
      if (existing.status === 'active' && verifyEntryFiles(existing)) return roomImageAssetPublic(assetId, existing.focus);
      throw roomImageAssetStoreError('Die reservierte Asset-ID ist bereits inkohärent belegt.');
    }
    const finalPath = safeSetPath(assetId);
    const stagePath = stagingPath(assetId);
    if (existsSync(finalPath) || existsSync(stagePath)) {
      throw roomImageAssetStoreError('Die reservierte Asset-ID besitzt bereits Publishdaten.');
    }
    const catalogCommit = { committed: false };
    try {
      assertMutable();
      mkdirSync(stagePath, { mode: 0o700 });
      transactionStep('staging_created', { assetId });
      const files = {};
      for (const [key, name] of Object.entries(ROOM_IMAGE_VARIANT_FILES)) {
        const bytes = Buffer.from(variants[key]);
        const path = join(stagePath, name);
        assertMutable();
        writeFileSync(path, bytes, { mode: 0o600, flush: true });
        chmodSync(path, 0o600);
        files[key] = { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength };
        transactionStep(`variant_${key}_written`, { assetId });
      }
      const manifestDocument = { version: 1, assetId, files };
      const manifest = Buffer.from(`${JSON.stringify(manifestDocument)}\n`);
      assertMutable();
      writeFileSync(join(stagePath, 'manifest.json'), manifest, { mode: 0o600, flush: true });
      chmodSync(join(stagePath, 'manifest.json'), 0o600);
      flushDirectory(stagePath);
      transactionStep('staging_flushed', { assetId });
      assertMutable();
      renameSync(stagePath, finalPath);
      flushDirectory(setsRoot);
      transactionStep('final_renamed', { assetId });
      const entry = {
        assetId,
        variants: structuredClone(ROOM_IMAGE_VARIANT_FILES),
        focus: structuredClone(focus),
        createdAt: new Date(now()).toISOString(),
        status: 'active', files,
        manifestSha256: createHash('sha256').update(manifest).digest('hex'),
      };
      document.assets.push(entry);
      atomicCatalogWrite(document, catalogCommit);
      transactionStep('catalog_committed', structuredClone(document));
      return roomImageAssetPublic(assetId, focus);
    } catch (error) {
      if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
      if (isSetupRecoveryRequiredError(error)) throw error;
      if (catalogCommit.committed) {
        const committedEntry = readCatalog().assets.find((candidate) => candidate.assetId === assetId);
        if (committedEntry?.status === 'active' && verifyEntryFiles(committedEntry)) {
          return roomImageAssetPublic(assetId, committedEntry.focus);
        }
        throw roomImageAssetStoreError('Der sichtbare Katalogcommit erfordert kontrollierte Recovery.', error);
      }
      if (!catalogCommit.committed) {
        try { rmSync(stagePath, { recursive: true, force: true }); } catch { /* recovery verifies leftovers */ }
        try { rmSync(finalPath, { recursive: true, force: true }); } catch { /* recovery verifies leftovers */ }
      }
      if (error instanceof RoomImageAssetStoreError) throw error;
      throw roomImageAssetStoreError('Das Room-Image-Asset konnte nicht atomar veröffentlicht werden.', error);
    }
  }
  function recoveryState(assetId) {
    const document = readCatalog();
    const entry = document.assets.find((candidate) => candidate.assetId === assetId) ?? null;
    const finalPath = safeSetPath(assetId);
    const stagePath = stagingPath(assetId);
    const finalExists = existsSync(finalPath);
    const stageExists = existsSync(stagePath);
    if (entry?.status === 'active' && finalExists && !stageExists && verifyEntryFiles(entry)) {
      return { type: 'complete', asset: roomImageAssetPublic(assetId, entry.focus) };
    }
    if (!entry && stageExists && finalExists) return { type: 'required' };
    if (!entry && (stageExists || finalExists)) {
      try {
        assertMutable();
        removeTree(stagePath, { recursive: true, force: true });
        removeTree(finalPath, { recursive: true, force: true });
        flushDirectory(setsRoot);
        return { type: 'rolled_back' };
      } catch { return { type: 'required' }; }
    }
    if (!entry && !stageExists && !finalExists) return { type: 'rolled_back' };
    return { type: 'required' };
  }
  function tombstone(assetId) {
    assertMutable();
    const document = readCatalog();
    const entry = document.assets.find((candidate) => candidate.assetId === assetId);
    if (!entry || entry.status === 'tombstone') return false;
    if (!verifyEntryFiles(entry)) throw roomImageAssetStoreError('Ein zu löschendes Asset ist unvollständig.');
    entry.status = 'tombstone';
    atomicCatalogWrite(document);
    return true;
  }
  function deleteTombstonedFiles(assetId) {
    assertMutable();
    const entry = readCatalog().assets.find((candidate) => candidate.assetId === assetId);
    if (!entry || entry.status !== 'tombstone') throw roomImageAssetStoreError('Assetdelete ohne Tombstone wurde abgewiesen.');
    const path = safeSetPath(assetId);
    try {
      if (!existsSync(path)) return;
      const metadata = lstatSync(path);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('unsafe tombstone directory');
      transactionStep('delete_before_unlink', { assetId });
      assertMutable();
      removeTree(path, { recursive: true });
      flushDirectory(setsRoot);
      transactionStep('delete_unlinked', { assetId });
    } catch (error) {
      throw roomImageAssetStoreError('Tombstoned Assetdateien konnten nicht bereinigt werden.', error);
    }
  }
  function variantBytes(assetId, variant) {
    const entry = activeEntry(assetId);
    const name = ROOM_IMAGE_VARIANT_FILES[variant];
    if (!entry || !name) return null;
    const bytes = regularBytes(join(safeSetPath(assetId), name));
    const info = entry.files[variant];
    if (bytes.byteLength !== info.byteLength || createHash('sha256').update(bytes).digest('hex') !== info.sha256) {
      throw roomImageAssetStoreError('Assetbytes stimmen nicht mit dem Katalog überein.');
    }
    return bytes;
  }
  function cleanupOrphans(reservedAssetIds = new Set()) {
    assertMutable();
    const document = readCatalog();
    const catalogIds = new Set(document.assets.map((entry) => entry.assetId));
    for (const name of readdirSync(setsRoot)) {
      const staged = name.match(/^\.publishing-([a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?)$/);
      const assetId = staged?.[1] ?? (ROOM_IMAGE_ASSET_ID_PATTERN.test(name) ? name : null);
      const path = join(setsRoot, name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) {
        throw roomImageAssetStoreError('Eine Symlinkstruktur im Room-Image-Assetroot wurde abgewiesen.');
      }
      if (!assetId || !metadata.isDirectory()) {
        throw roomImageAssetStoreError('Ein unbekannter Eintrag im Room-Image-Assetroot wurde abgewiesen.');
      }
      if (reservedAssetIds.has(assetId) || catalogIds.has(assetId)) continue;
      assertMutable();
      removeTree(path, { recursive: true, force: true });
    }
    flushDirectory(setsRoot);
  }

  // Existing state is fully validated before any directory creation or mode mutation.
  // A genuinely missing, symlink-free path is initialized only after that read-only pass.
  const initial = readCatalog();
  if (catalogExisted) {
    for (const entry of initial.assets.filter((candidate) => candidate.status === 'active')) {
      if (!verifyEntryFiles(entry)) throw roomImageAssetStoreError('Ein aktives Katalogasset ist unvollständig oder unsicher.');
    }
  }
  if (!readOnly) {
    assertMutable();
    root = ensureRoomImageAssetDirectory(root);
    ensureRoomImageAssetDirectory(setsRoot);
    ensureRoomImageAssetDirectory(dirname(catalog));
  }
  return {
    activeEntry, catalogPath: catalog, cleanupOrphans, deleteTombstonedFiles, list, publish,
    recoveryState, root, status, tombstone, variantBytes,
  };
}

export function createRoomImageProviderBoundary() {
  return Object.freeze({
    available: false,
    async probe() {
      throw Object.assign(new Error('Room-image provider adapter is not configured'), { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
    },
    async edit() {
      throw Object.assign(new Error('Room-image provider adapter is not configured'), { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
    },
  });
}

function roomImageJwtClaims(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch { return {}; }
}

function atomicWriteRoomImageCredential(path, document) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600, flag: 'wx', flush: true });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    flushDirectory(dirname(path));
  } finally {
    try { unlinkSync(temporary); } catch { /* atomic rename or cleanup completed */ }
  }
}

export function createRoomImageCredentialStore({
  path = ROOM_IMAGE_CREDENTIAL_PATH,
  environmentApiKey = process.env.HMI_OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const pending = new Map();

  function stored() {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value?.version !== 1 || !['api_key', 'chatgpt'].includes(value.mode)) return null;
      if (value.mode === 'api_key' && typeof value.apiKey === 'string' && value.apiKey.trim()) return value;
      if (value.mode === 'chatgpt' && typeof value.accessToken === 'string' && value.accessToken.trim()
          && typeof value.refreshToken === 'string' && value.refreshToken.trim()) return value;
    } catch { /* missing or invalid store means no persisted credential */ }
    return null;
  }

  function current() {
    const persisted = stored();
    if (persisted) return persisted;
    const apiKey = typeof environmentApiKey === 'string' ? environmentApiKey.trim() : '';
    return apiKey ? { version: 1, mode: 'api_key', apiKey, source: 'environment' } : null;
  }

  function status() {
    const credential = current();
    return {
      configured: Boolean(credential),
      mode: credential?.mode ?? null,
      source: credential?.source === 'environment' ? 'environment' : credential ? 'stored' : null,
    };
  }

  function setApiKey(apiKey) {
    const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (normalized.length < 20 || normalized.length > 512 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new RoomImageRequestError(422, 'OPENAI_API_KEY_INVALID', 'Der OpenAI-API-Key ist ungültig.');
    }
    atomicWriteRoomImageCredential(path, { version: 1, mode: 'api_key', apiKey: normalized, source: 'stored' });
    return status();
  }

  function clear() {
    try { unlinkSync(path); flushDirectory(dirname(path)); } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
    pending.clear();
    return status();
  }

  async function beginChatGptLogin() {
    let response;
    try {
      response = await fetchImpl(`${ROOM_IMAGE_CODEX_AUTH_URL}/api/accounts/deviceauth/usercode`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: ROOM_IMAGE_CODEX_CLIENT_ID }),
      });
    } catch {
      throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_UNREACHABLE', 'Der ChatGPT-Login ist gerade nicht erreichbar.');
    }
    if (response.status === 429) throw new RoomImageRequestError(429, 'CHATGPT_LOGIN_RATE_LIMITED', 'OpenAI begrenzt gerade neue Anmeldungen. Bitte später erneut versuchen.');
    if (!response.ok) throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_FAILED', 'Der ChatGPT-Login konnte nicht gestartet werden.');
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    const userCode = typeof payload?.user_code === 'string' ? payload.user_code.trim() : '';
    const deviceAuthId = typeof payload?.device_auth_id === 'string' ? payload.device_auth_id.trim() : '';
    const intervalSeconds = Math.max(3, Math.min(15, Number(payload?.interval) || 5));
    if (!userCode || !deviceAuthId) throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_FAILED', 'OpenAI hat keinen vollständigen Anmeldecode geliefert.');
    const loginId = randomBytes(32).toString('base64url');
    const expiresAt = now() + 15 * 60 * 1000;
    pending.set(loginId, { deviceAuthId, userCode, expiresAt });
    return {
      loginId, userCode, verificationUrl: `${ROOM_IMAGE_CODEX_AUTH_URL}/codex/device`,
      expiresAt: new Date(expiresAt).toISOString(), intervalSeconds,
    };
  }

  async function pollChatGptLogin(loginId) {
    const login = pending.get(loginId);
    if (!login || login.expiresAt <= now()) {
      pending.delete(loginId);
      throw new RoomImageRequestError(410, 'CHATGPT_LOGIN_EXPIRED', 'Der ChatGPT-Anmeldecode ist abgelaufen.');
    }
    let response;
    try {
      response = await fetchImpl(`${ROOM_IMAGE_CODEX_AUTH_URL}/api/accounts/deviceauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: login.deviceAuthId, user_code: login.userCode }),
      });
    } catch {
      throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_UNREACHABLE', 'Der ChatGPT-Login ist gerade nicht erreichbar.');
    }
    if ([403, 404].includes(response.status)) return { status: 'pending' };
    if (!response.ok) throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_FAILED', 'Die ChatGPT-Anmeldung konnte nicht abgeschlossen werden.');
    let authorization;
    try { authorization = await response.json(); } catch { authorization = null; }
    if (typeof authorization?.authorization_code !== 'string' || typeof authorization?.code_verifier !== 'string') {
      throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_FAILED', 'OpenAI hat die Anmeldung unvollständig bestätigt.');
    }
    let tokenResponse;
    try {
      tokenResponse = await fetchImpl(ROOM_IMAGE_CODEX_TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code: authorization.authorization_code,
          redirect_uri: `${ROOM_IMAGE_CODEX_AUTH_URL}/deviceauth/callback`,
          client_id: ROOM_IMAGE_CODEX_CLIENT_ID, code_verifier: authorization.code_verifier,
        }),
      });
    } catch {
      throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_UNREACHABLE', 'Der OpenAI-Tokenaustausch ist gerade nicht erreichbar.');
    }
    if (!tokenResponse.ok) throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_FAILED', 'Der ChatGPT-Zugang konnte nicht gespeichert werden.');
    let tokens;
    try { tokens = await tokenResponse.json(); } catch { tokens = null; }
    if (typeof tokens?.access_token !== 'string' || !tokens.access_token.trim()
        || typeof tokens?.refresh_token !== 'string' || !tokens.refresh_token.trim()) {
      throw new RoomImageRequestError(502, 'CHATGPT_LOGIN_FAILED', 'OpenAI hat keine vollständigen Zugangsdaten geliefert.');
    }
    atomicWriteRoomImageCredential(path, {
      version: 1, mode: 'chatgpt', accessToken: tokens.access_token.trim(),
      refreshToken: tokens.refresh_token.trim(), source: 'stored',
    });
    pending.delete(loginId);
    return { status: 'connected' };
  }

  async function chatGptAccessToken() {
    const credential = current();
    if (credential?.mode !== 'chatgpt') return null;
    const claims = roomImageJwtClaims(credential.accessToken);
    if (Number.isFinite(claims.exp) && claims.exp * 1000 > now() + 120_000) return credential.accessToken;
    let response;
    try {
      response = await fetchImpl(ROOM_IMAGE_CODEX_TOKEN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: credential.refreshToken, client_id: ROOM_IMAGE_CODEX_CLIENT_ID,
        }),
      });
    } catch { throw roomImageProviderUnknownError(); }
    if (!response.ok) return null;
    let tokens;
    try { tokens = await response.json(); } catch { return null; }
    if (typeof tokens?.access_token !== 'string' || !tokens.access_token.trim()) return null;
    atomicWriteRoomImageCredential(path, {
      ...credential, accessToken: tokens.access_token.trim(),
      refreshToken: typeof tokens.refresh_token === 'string' && tokens.refresh_token.trim()
        ? tokens.refresh_token.trim() : credential.refreshToken,
    });
    return tokens.access_token.trim();
  }

  return { beginChatGptLogin, chatGptAccessToken, clear, current, pollChatGptLogin, setApiKey, status };
}

function roomImageProviderHttpErrorCode(status) {
  if (status === 401) return 'PROVIDER_CREDENTIAL_INVALID';
  if (status === 403) return 'PROVIDER_FORBIDDEN';
  if (status === 402 || status === 429) return 'PROVIDER_QUOTA_OR_RATE_LIMIT';
  if (status === 422) return 'PROVIDER_IMAGE_REJECTED';
  return 'PROVIDER_HTTP_ERROR';
}

function roomImageProviderRequestId(response) {
  const value = response?.headers?.get?.('x-request-id');
  return typeof value === 'string' && ROOM_IMAGE_PROVIDER_REQUEST_ID_PATTERN.test(value) ? value : null;
}

function roomImageProviderLocalError() {
  return Object.assign(new Error('Room-image provider request was not sent'), {
    code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT',
  });
}

function roomImageProviderUnknownError() {
  return Object.assign(new Error('Room-image provider outcome is unknown'), {
    code: 'PROVIDER_OUTCOME_UNKNOWN',
  });
}

function decodeCanonicalRoomImageBase64(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > ROOM_IMAGE_PROVIDER_MAX_BASE64_BYTES
      || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength < 1 || bytes.toString('base64') !== value) return null;
  return bytes;
}

async function cancelRoomImageProviderResponseBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') await response.body.cancel();
  } catch { /* Provider body and cancellation details remain private. */ }
}

async function readBoundedRoomImageProviderJson(response, signal) {
  const contentLength = response?.headers?.get?.('content-length');
  if (signal?.aborted) {
    await cancelRoomImageProviderResponseBody(response);
    throw roomImageProviderUnknownError();
  }
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength.trim())
      && Number(contentLength.trim()) > ROOM_IMAGE_PROVIDER_MAX_JSON_RESPONSE_BYTES) {
    await cancelRoomImageProviderResponseBody(response);
    return null;
  }
  const body = response?.body;
  if (!body || typeof body.getReader !== 'function') {
    await cancelRoomImageProviderResponseBody(response);
    return null;
  }

  let reader;
  try {
    reader = body.getReader();
  } catch {
    await cancelRoomImageProviderResponseBody(response);
    return null;
  }
  let cancelPromise = null;
  const cancelReaderOnce = () => {
    if (!cancelPromise) {
      cancelPromise = Promise.resolve()
        .then(() => reader.cancel())
        .catch(() => undefined);
    }
    return cancelPromise;
  };
  let rejectForAbort = null;
  const aborted = new Promise((_, reject) => { rejectForAbort = reject; });
  const abortRead = () => {
    rejectForAbort(roomImageProviderUnknownError());
    void cancelReaderOnce();
  };
  signal?.addEventListener?.('abort', abortRead, { once: true });

  const chunks = [];
  let byteLength = 0;
  try {
    if (signal?.aborted) abortRead();
    while (true) {
      const result = signal ? await Promise.race([reader.read(), aborted]) : await reader.read();
      if (result?.done) break;
      if (!(result?.value instanceof Uint8Array)) {
        await cancelReaderOnce();
        return null;
      }
      if (result.value.byteLength > ROOM_IMAGE_PROVIDER_MAX_JSON_RESPONSE_BYTES - byteLength) {
        await cancelReaderOnce();
        return null;
      }
      chunks.push(result.value);
      byteLength += result.value.byteLength;
    }
  } catch {
    await cancelReaderOnce();
    throw roomImageProviderUnknownError();
  } finally {
    signal?.removeEventListener?.('abort', abortRead);
    try { reader.releaseLock(); } catch { /* Stream details remain private. */ }
  }

  try {
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function validateRoomImageProviderPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= ROOM_IMAGE_PNG_SIGNATURE.byteLength
      || !ROOM_IMAGE_PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return false;
  try {
    const options = { animated: true, failOn: 'error', limitInputPixels: ROOM_IMAGE_TRANSFORM_POLICY_V1.maxDecodedPixels };
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1) return false;
    await sharp(bytes, { ...options, animated: false }).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

function roomImageCodexHeaders(accessToken) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'codex_cli_rs/0.0.0 (Hauser)',
    originator: 'codex_cli_rs',
    'x-codex-image-turn-id': randomUUID(),
  };
  const accountId = roomImageJwtClaims(accessToken)?.['https://api.openai.com/auth']?.chatgpt_account_id;
  if (typeof accountId === 'string' && accountId) headers['ChatGPT-Account-ID'] = accountId;
  return headers;
}

export function createChatGptRoomImageProvider({ credentialStore, fetchImpl = globalThis.fetch } = {}) {
  if (!credentialStore || typeof credentialStore.chatGptAccessToken !== 'function') return createRoomImageProviderBoundary();
  async function probe() {
    const token = await credentialStore.chatGptAccessToken();
    return token
      ? { definitiveResponse: true, status: 200, imageCapability: 'unverified', modelVisible: true }
      : { definitiveResponse: true, status: 401, imageCapability: 'credential_invalid', modelVisible: false };
  }
  async function edit({ prompt, input, signal } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || !(input instanceof Uint8Array) || input.byteLength < 1) {
      throw roomImageProviderLocalError();
    }
    const token = await credentialStore.chatGptAccessToken();
    if (!token) return { definitiveResponse: true, status: 401, errorCode: 'PROVIDER_CREDENTIAL_INVALID' };
    const payload = {
      images: [{ image_url: `data:image/jpeg;base64,${Buffer.from(input).toString('base64')}` }],
      prompt,
      background: 'opaque',
      model: ROOM_IMAGE_CODEX_IMAGE_MODEL,
      quality: 'medium',
      size: '1536x1024',
    };
    let response;
    try {
      response = await fetchImpl(`${ROOM_IMAGE_CODEX_BASE_URL}/images/edits`, {
        method: 'POST', headers: roomImageCodexHeaders(token), body: JSON.stringify(payload), signal,
      });
    } catch { throw roomImageProviderUnknownError(); }
    const requestId = roomImageProviderRequestId(response);
    const support = requestId ? { requestId } : {};
    if (!response.ok) {
      await cancelRoomImageProviderResponseBody(response);
      return { definitiveResponse: true, status: response.status, errorCode: roomImageProviderHttpErrorCode(response.status), ...support };
    }
    let result;
    try {
      result = await readBoundedRoomImageProviderJson(response, signal);
    } catch { throw roomImageProviderUnknownError(); }
    const item = Array.isArray(result?.data) && result.data.length === 1 ? result.data[0] : null;
    const encoded = item && typeof item === 'object' && !Array.isArray(item) && !Object.hasOwn(item, 'url')
      ? item.b64_json : null;
    const image = decodeCanonicalRoomImageBase64(encoded);
    if (!image || !await validateRoomImageProviderPng(image)) {
      return { definitiveResponse: true, status: response.status, errorCode: 'PROVIDER_INVALID_RESPONSE', ...support };
    }
    return { definitiveResponse: true, status: response.status, image: new Uint8Array(image), ...support };
  }
  return Object.freeze({ available: true, edit, probe });
}

export function createRoomImageProviderRouter({ credentialStore, fetchImpl = globalThis.fetch } = {}) {
  const resolveProvider = () => {
    const credential = credentialStore?.current?.();
    if (credential?.mode === 'api_key') return createOpenAiRoomImageProvider({ credential: credential.apiKey, fetchImpl });
    if (credential?.mode === 'chatgpt') return createChatGptRoomImageProvider({ credentialStore, fetchImpl });
    return createRoomImageProviderBoundary();
  };
  return Object.freeze({
    get available() { return credentialStore?.status?.().configured === true; },
    probe: (options) => resolveProvider().probe(options),
    edit: (options) => resolveProvider().edit(options),
  });
}

export function createOpenAiRoomImageProvider({ credential, fetchImpl = globalThis.fetch } = {}) {
  const normalizedCredential = typeof credential === 'string' ? credential.trim() : '';
  if (!normalizedCredential) return createRoomImageProviderBoundary();
  if (typeof fetchImpl !== 'function') throw new TypeError('Room-image provider fetch boundary is required');
  const headers = () => ({ Authorization: `Bearer ${normalizedCredential}` });

  async function probe({ signal } = {}) {
    let response;
    try {
      response = await fetchImpl(ROOM_IMAGE_PROVIDER_MODELS_URL, { method: 'GET', headers: headers(), signal });
    } catch {
      return { definitiveResponse: false, imageCapability: 'unreachable', modelVisible: false };
    }
    await cancelRoomImageProviderResponseBody(response);
    if (response.status === 200) {
      return { definitiveResponse: true, status: 200, imageCapability: 'unverified', modelVisible: true };
    }
    if (response.status === 401) {
      return {
        definitiveResponse: true, status: 401, imageCapability: 'credential_invalid', modelVisible: false,
        errorCode: 'PROVIDER_CREDENTIAL_INVALID',
      };
    }
    if (response.status === 403) {
      return {
        definitiveResponse: true, status: 403, imageCapability: 'forbidden', modelVisible: false,
        errorCode: 'PROVIDER_FORBIDDEN',
      };
    }
    return { definitiveResponse: true, status: response.status, imageCapability: 'unreachable', modelVisible: false };
  }

  async function edit({ prompt, input, signal } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim() || !(input instanceof Uint8Array) || input.byteLength < 1) {
      throw roomImageProviderLocalError();
    }
    const body = new FormData();
    body.append('model', ROOM_IMAGE_PROVIDER_MODEL);
    body.append('image[]', new Blob([input], { type: 'image/jpeg' }), 'room-image-input.jpg');
    body.append('prompt', prompt);
    body.append('n', '1');
    body.append('quality', 'auto');
    body.append('size', 'auto');
    body.append('output_format', 'png');

    let response;
    try {
      response = await fetchImpl(ROOM_IMAGE_PROVIDER_EDITS_URL, {
        method: 'POST', headers: headers(), body, signal,
      });
    } catch {
      throw roomImageProviderUnknownError();
    }
    const requestId = roomImageProviderRequestId(response);
    const support = requestId ? { requestId } : {};
    if (response.status < 200 || response.status >= 300) {
      await cancelRoomImageProviderResponseBody(response);
      return {
        definitiveResponse: true, status: response.status,
        errorCode: roomImageProviderHttpErrorCode(response.status), ...support,
      };
    }
    let payload;
    try {
      payload = await readBoundedRoomImageProviderJson(response, signal);
    } catch {
      throw roomImageProviderUnknownError();
    }
    const item = Array.isArray(payload?.data) && payload.data.length === 1 ? payload.data[0] : null;
    const encoded = item && typeof item === 'object' && !Array.isArray(item) && !Object.hasOwn(item, 'url')
      ? item.b64_json : null;
    const image = decodeCanonicalRoomImageBase64(encoded);
    if (!image || !await validateRoomImageProviderPng(image)) {
      return { definitiveResponse: true, status: response.status, errorCode: 'PROVIDER_INVALID_RESPONSE', ...support };
    }
    return { definitiveResponse: true, status: response.status, image: new Uint8Array(image), ...support };
  }

  return Object.freeze({ available: true, edit, probe });
}

export function createDeterministicRoomImageFakeProvider({ delay = async () => undefined } = {}) {
  const calls = [];
  async function edit({ phase, input, providerAttemptId, signal }) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const inputHash = createHash('sha256').update(input).digest('hex');
    calls.push({ phase, providerAttemptId, inputHash, inputBytes: input.byteLength });
    await delay({ phase, providerAttemptId, signal });
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const colors = {
      composition: { r: 190, g: 184, b: 174 },
      'style-light': { r: 224, g: 216, b: 194 },
      dark: { r: 42, g: 49, b: 66 },
      'dark-off': { r: 18, g: 22, b: 31 },
    };
    const image = await sharp({
      create: { width: 64, height: 48, channels: 3, background: colors[phase] },
    }).png({ compressionLevel: 9, progressive: false, palette: false }).toBuffer();
    return { definitiveResponse: true, status: 200, image };
  }
  return { available: true, calls, edit, async probe() { return { definitiveResponse: true, status: 200 }; } };
}

const ROOM_IMAGE_FORBIDDEN_METADATA_FIELDS = [
  'orientation', 'exif', 'icc', 'iptc', 'xmp', 'tifftagPhotoshop', 'comments',
];

export async function validateRoomImagePreviewBytes(bytes, expectedFormat, {
  metadataReader = (image) => image.metadata(),
} = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || !['jpeg', 'heif'].includes(expectedFormat)) {
    throw new Error('invalid room-image preview input');
  }
  if (typeof metadataReader !== 'function') throw new Error('invalid room-image metadata reader');
  const image = sharp(bytes, { animated: true, failOn: 'error', limitInputPixels: 24_000_000 });
  const metadata = await metadataReader(image);
  if (metadata.format !== expectedFormat
      || (expectedFormat === 'heif' && metadata.compression !== 'av1')
      || metadata.width !== 3392 || metadata.height !== 2400
      || (metadata.pages ?? 1) !== 1 || metadata.pageHeight !== undefined
      || metadata.space !== 'srgb' || metadata.channels !== 3 || metadata.hasAlpha !== false
      || metadata.hasProfile !== false || metadata.depth !== 'uchar'
      || ROOM_IMAGE_FORBIDDEN_METADATA_FIELDS.some((field) => metadata[field] !== undefined)) {
    throw new Error('invalid room-image preview metadata');
  }
  const decoded = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 24_000_000 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== 3392 || decoded.info.height !== 2400
      || decoded.info.channels !== 3 || decoded.info.depth !== 'uchar' || decoded.info.hasAlpha !== false
      || decoded.data.byteLength !== 3392 * 2400 * 3) {
    throw new Error('invalid room-image preview decode');
  }
  return metadata;
}

export function createRoomImageJobRunner({
  store,
  provider = createRoomImageProviderBoundary(),
  editDeadlineMs = ROOM_IMAGE_EDIT_DEADLINE_MS,
  probeDeadlineMs = ROOM_IMAGE_PROBE_DEADLINE_MS,
  monotonicNow = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  prepareProviderResult = null,
  validatePreview = null,
  assertSetupRecoveryHealthy = () => undefined,
} = {}) {
  if (!store || typeof store.get !== 'function') throw new TypeError('Room-image job store is required');
  if (!Number.isFinite(editDeadlineMs) || editDeadlineMs <= 0 || !Number.isFinite(probeDeadlineMs) || probeDeadlineMs <= 0
      || typeof monotonicNow !== 'function') {
    throw new TypeError('Room-image deadlines must be positive finite values with a monotone clock');
  }
  const queue = [];
  const controllers = new Map();
  const providerOperations = new Set();
  let activeJobId = null;
  let reservations = 0;
  let drainPromise = Promise.resolve();

  function capacityUsed() { return (activeJobId ? 1 : 0) + queue.length + reservations; }
  function reserve() {
    assertSetupRecoveryHealthy();
    if (capacityUsed() >= 4) return null;
    reservations += 1;
    let active = true;
    return {
      consume(jobId) {
        if (!active) throw new Error('Room-image queue reservation is inactive');
        active = false; reservations -= 1; queue.push(jobId); schedule();
      },
      release() {
        if (!active) return;
        active = false; reservations -= 1;
      },
    };
  }

  function transition(jobId, providerAttemptId, suffix, target, outcome = null, errorCode = null) {
    return store.transition(jobId, providerAttemptId, `${suffix}-${providerAttemptId}`, target, outcome, errorCode);
  }

  function cancelRemaining(record, code = 'DEPENDENCY_FAILED') {
    for (const attempt of record.attempts.filter((entry) => entry.status === 'planned')) {
      transition(record.jobId, attempt.providerAttemptId, `cancel-${code}`, 'cancelled_before_start', null, code);
    }
  }

  function failedJobState(record, code, message) {
    const retryable = Boolean(record.temp.source)
      && (record.kind === 'main_candidates' || Boolean(record.temp.selectedProvider));
    const requiredProviderCalls = retryable
      ? record.kind === 'main_candidates'
        ? (record.temp.composition ? record.request.candidateCount : record.request.candidateCount + 1)
        : 2
      : 0;
    return {
      status: 'failed', phase: 'complete', cancellable: false, retryable, discardable: true,
      retry: retryable
        ? { kind: record.kind, requiredProviderCalls, noticeVersion: 'room-image-v1' }
        : null,
      error: { code, message },
    };
  }

  function failJob(jobId, code, message, { unknown = false, cancelled = false } = {}) {
    const current = store.get(jobId);
    if (!current) return;
    cancelRemaining(current, cancelled ? 'JOB_CANCELLED' : 'DEPENDENCY_FAILED');
    store.update(jobId, (record) => {
      for (const candidate of record.temp.candidates || []) {
        store.deleteTemp(candidate.preview); store.deleteTemp(candidate.providerInput);
      }
      record.temp.candidates = [];
      for (const name of Object.values(record.temp.finals || {})) store.deleteTemp(name);
      record.temp.finals = {};
      record.status = cancelled ? 'cancelled' : 'failed';
      record.phase = 'complete'; record.cancellable = false;
      record.retryable = !cancelled && Boolean(record.temp.source)
        && (record.kind === 'main_candidates' || Boolean(record.temp.selectedProvider));
      record.discardable = true;
      let requiredProviderCalls = 0;
      if (record.retryable) {
        requiredProviderCalls = record.kind === 'main_candidates'
          ? (record.temp.composition ? record.request.candidateCount : record.request.candidateCount + 1)
          : 2;
      }
      record.retry = record.retryable
        ? { kind: record.kind, requiredProviderCalls, noticeVersion: 'room-image-v1' }
        : null;
      record.error = { code, message: unknown
        ? 'Der Ausgang des Provideraufrufs ist unbekannt.' : message };
      if (cancelled) {
        for (const name of [record.temp.source, record.temp.composition, record.temp.selectedProvider, record.temp.selectedPreview]) {
          store.deleteTemp(name);
        }
        record.temp.source = null; record.temp.composition = null;
        record.temp.selectedProvider = null; record.temp.selectedPreview = null;
        record.retryable = false; record.retry = null;
      }
    });
  }

  function providerInput(record, attempt) {
    const reference = attempt.phase === 'composition' ? record.temp.source
      : attempt.phase === 'style-light' ? record.temp.composition
        : record.temp.selectedProvider;
    if (!reference || !store.tempExists(reference)) {
      throw Object.assign(new Error('Required provider input is unavailable'), { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
    }
    const bytes = store.readTemp(reference);
    assertProviderInputSize(bytes);
    return bytes;
  }

  function armDeadline(controller, durationMs, message, startedAt = monotonicNow()) {
    if (!Number.isFinite(startedAt)) throw new TypeError('Room-image monotone clock returned an invalid value');
    const deadlineAt = startedAt + durationMs;
    let timer;
    let onAbort;
    const timeout = new Promise((_, rejectPromise) => {
      timer = setTimer(() => {
        controller.abort();
        rejectPromise(Object.assign(new Error(message), { name: 'AbortError', code: 'PROVIDER_OUTCOME_UNKNOWN' }));
      }, Math.max(0, deadlineAt - monotonicNow()));
    });
    const aborted = new Promise((_, rejectPromise) => {
      onAbort = () => rejectPromise(Object.assign(new Error(message), { name: 'AbortError', code: 'PROVIDER_OUTCOME_UNKNOWN' }));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    return {
      wait(operation) { return Promise.race([operation, timeout, aborted]); },
      clear() {
        clearTimer(timer);
        controller.signal.removeEventListener('abort', onAbort);
      },
    };
  }

  function trackProviderOperation(operation) {
    providerOperations.add(operation);
    void operation.then(
      () => providerOperations.delete(operation),
      () => providerOperations.delete(operation),
    );
    return operation;
  }

  async function defaultPrepareValidResult(jobId, attempt, image) {
    if (!(image instanceof Uint8Array) || image.byteLength < 1) throw new Error('empty provider image');
    const providerInputJpeg = await providerPngToProviderJpeg(image);
    assertProviderInputSize(providerInputJpeg);
    if (attempt.phase === 'composition') {
      /* Die Komposition ist zugleich der realistische Kandidat: der Nutzer
         wählt zwischen korrigierter Perspektive und Illustrationslook. */
      const compositionPreview = await providerPngToFinalAvif(image);
      await validateRoomImagePreviewBytes(compositionPreview, 'heif');
      return {
        type: 'composition', bytes: providerInputJpeg,
        candidateId: roomImageOpaqueId(), previewBytes: compositionPreview,
      };
    }
    const preview = await providerPngToFinalAvif(image);
    await validateRoomImagePreviewBytes(preview, 'heif');
    if (attempt.phase === 'style-light') {
      return {
        type: 'candidate', candidateId: roomImageOpaqueId(), previewBytes: preview,
        providerBytes: providerInputJpeg,
      };
    }
    const variant = attempt.phase === 'dark' ? 'dark' : 'darkOff';
    return { type: 'final', variant, previewBytes: preview };
  }

  function prepareValidResult(jobId, attempt, image) {
    const defaultPrepare = () => defaultPrepareValidResult(jobId, attempt, image);
    return typeof prepareProviderResult === 'function'
      ? prepareProviderResult({ jobId, attempt, image, defaultPrepare })
      : defaultPrepare();
  }

  function validatePreviewBytes(bytes, expectedFormat, context = {}) {
    const defaultValidate = () => validateRoomImagePreviewBytes(bytes, expectedFormat);
    return typeof validatePreview === 'function'
      ? validatePreview({ ...context, bytes, expectedFormat, defaultValidate })
      : defaultValidate();
  }

  async function runAttempt(jobId, attemptId) {
    assertSetupRecoveryHealthy();
    let record = store.get(jobId);
    const attempt = record?.attempts.find((entry) => entry.providerAttemptId === attemptId);
    if (!record || !attempt || attempt.status !== 'planned') return false;
    if (record.status === 'cancelling') {
      transition(jobId, attemptId, 'cancel-before-start', 'cancelled_before_start', null, 'JOB_CANCELLED');
      return false;
    }
    let input;
    let prompt;
    try {
      if (provider.available !== true) throw Object.assign(new Error('Provider adapter is not configured'), { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
      input = providerInput(record, attempt);
      prompt = buildRoomImagePrompt(attempt.phase, record.policy.spec);
    } catch {
      const current = store.get(jobId);
      store.commitProviderTransition(jobId, attemptId, `local-failure-${attemptId}`, {
        target: 'failed_local', outcome: null, errorCode: 'LOCAL_PROVIDER_REQUEST_NOT_SENT', result: null,
        jobState: failedJobState(current, 'LOCAL_PROVIDER_REQUEST_NOT_SENT', 'Der Providerrequest wurde lokal nicht gesendet.'),
      });
      failJob(jobId, 'LOCAL_PROVIDER_REQUEST_NOT_SENT', 'Der Providerrequest wurde lokal nicht gesendet.');
      return false;
    }

    transition(jobId, attemptId, 'start', 'started');
    const deadlineStartedAt = monotonicNow();
    const controller = new AbortController();
    controllers.set(jobId, controller);
    const responseState = { definitive: false };
    const deadline = armDeadline(controller, editDeadlineMs, 'Room-image edit deadline exceeded', deadlineStartedAt);
    let runnerReleased = false;
    let operationSettled = false;
    const releaseController = () => {
      if (runnerReleased && operationSettled && controllers.get(jobId) === controller) controllers.delete(jobId);
    };
    const operation = trackProviderOperation(Promise.resolve().then(async () => {
      let response;
      try {
        assertSetupRecoveryHealthy();
        response = await provider.edit({
          phase: attempt.phase, prompt, input, signal: controller.signal,
          providerAttemptId: attempt.providerAttemptId, attemptId: attempt.attemptId,
          lineageId: attempt.lineageId, jobId, wizardId: attempt.wizardId,
        });
        assertSetupRecoveryHealthy();
      } catch (error) {
        if (isSetupRecoveryRequiredError(error)) throw error;
        return { kind: 'unknown' };
      }
      if (!response || response.definitiveResponse !== true || !Number.isInteger(response.status)) {
        return { kind: 'unknown' };
      }
      responseState.definitive = true;
      if (response.status < 200 || response.status >= 300) {
        return { kind: 'http_error', errorCode: roomImageProviderHttpErrorCode(response.status) };
      }
      try {
        assertSetupRecoveryHealthy();
        const preparedResult = await prepareValidResult(jobId, attempt, response.image);
        assertSetupRecoveryHealthy();
        return { kind: 'result_valid', preparedResult };
      } catch (error) {
        if (isSetupRecoveryRequiredError(error)) throw error;
        if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
        return {
          kind: 'result_invalid',
          errorCode: response.errorCode === 'PROVIDER_INVALID_RESPONSE'
            ? 'PROVIDER_INVALID_RESPONSE' : 'PROVIDER_RESULT_INVALID',
        };
      }
    }));
    void operation.then(
      () => { operationSettled = true; releaseController(); },
      () => { operationSettled = true; releaseController(); },
    );

    let processed;
    try {
      processed = await deadline.wait(operation);
    } catch (error) {
      if (isSetupRecoveryRequiredError(error)) throw error;
      if (error && typeof error === 'object' && error.simulateCrash === true) {
        runnerReleased = true; releaseController(); throw error;
      }
      const current = store.get(jobId);
      const cancelling = current?.status === 'cancelling';
      if (responseState.definitive) {
        store.commitProviderTransition(jobId, attemptId, `invalid-${attemptId}`, {
          target: 'completed', outcome: 'result_invalid', errorCode: 'PROVIDER_RESULT_INVALID', result: null,
          jobState: cancelling ? null : failedJobState(
            current, 'PROVIDER_RESULT_INVALID', 'Das Providerergebnis wurde nicht innerhalb der Gesamtdeadline validiert.',
          ),
        });
        failJob(jobId, cancelling ? 'JOB_CANCELLED' : 'PROVIDER_RESULT_INVALID',
          cancelling ? 'Der Job wurde abgebrochen.' : 'Das Providerergebnis war ungültig.', { cancelled: cancelling });
      } else {
        store.commitProviderTransition(jobId, attemptId, `unknown-${attemptId}`, {
          target: 'outcome_unknown', outcome: null, errorCode: 'PROVIDER_OUTCOME_UNKNOWN', result: null,
          jobState: cancelling ? null : failedJobState(
            current, 'PROVIDER_OUTCOME_UNKNOWN', 'Der Ausgang des Provideraufrufs ist unbekannt.',
          ),
        });
        failJob(jobId, 'PROVIDER_OUTCOME_UNKNOWN', 'Der Providerausgang ist unbekannt.', { unknown: true, cancelled: cancelling });
      }
      runnerReleased = true; releaseController();
      return false;
    } finally {
      deadline.clear();
    }

    const current = store.get(jobId);
    const cancelling = current?.status === 'cancelling';
    if (processed.kind === 'unknown') {
      store.commitProviderTransition(jobId, attemptId, `unknown-${attemptId}`, {
        target: 'outcome_unknown', outcome: null, errorCode: 'PROVIDER_OUTCOME_UNKNOWN', result: null,
        jobState: cancelling ? null : failedJobState(
          current, 'PROVIDER_OUTCOME_UNKNOWN', 'Der Ausgang des Provideraufrufs ist unbekannt.',
        ),
      });
      failJob(jobId, 'PROVIDER_OUTCOME_UNKNOWN', 'Der Providerausgang ist unbekannt.', { unknown: true, cancelled: cancelling });
      runnerReleased = true; releaseController();
      return false;
    }
    if (processed.kind === 'http_error') {
      store.commitProviderTransition(jobId, attemptId, `http-${attemptId}`, {
        target: 'completed', outcome: 'http_error', errorCode: processed.errorCode, result: null,
        jobState: cancelling ? null : failedJobState(current, processed.errorCode, 'Der Provider hat den Request abgelehnt.'),
      });
      failJob(jobId, cancelling ? 'JOB_CANCELLED' : processed.errorCode,
        cancelling ? 'Der Job wurde abgebrochen.' : 'Der Provider hat den Request abgelehnt.', { cancelled: cancelling });
      runnerReleased = true; releaseController();
      return false;
    }
    if (processed.kind === 'result_invalid') {
      store.commitProviderTransition(jobId, attemptId, `invalid-${attemptId}`, {
        target: 'completed', outcome: 'result_invalid', errorCode: processed.errorCode, result: null,
        jobState: cancelling ? null : failedJobState(current, processed.errorCode, 'Das Providerergebnis war ungültig.'),
      });
      failJob(jobId, cancelling ? 'JOB_CANCELLED' : processed.errorCode,
        cancelling ? 'Der Job wurde abgebrochen.' : 'Das Providerergebnis war ungültig.', { cancelled: cancelling });
      runnerReleased = true; releaseController();
      return false;
    }

    const lastAttempt = current.attempts.at(-1)?.providerAttemptId === attemptId;
    const jobState = !cancelling && lastAttempt && current.kind === 'main_candidates'
      ? {
        status: 'succeeded', phase: 'complete', cancellable: true,
        retryable: false, discardable: false, retry: null, error: null,
      }
      : null;
    store.commitProviderTransition(jobId, attemptId, `valid-${attemptId}`, {
      target: 'completed', outcome: 'result_valid', errorCode: null,
      result: processed.preparedResult, jobState,
    });
    if (cancelling || store.get(jobId)?.status === 'cancelling') {
      failJob(jobId, 'JOB_CANCELLED', 'Der Job wurde abgebrochen.', { cancelled: true });
      runnerReleased = true; releaseController();
      return false;
    }
    runnerReleased = true; releaseController();
    return true;
  }

  async function run(jobId) {
    let record = store.get(jobId);
    if (!record || record.status !== 'queued') return;
    for (const attempt of record.attempts) {
      const success = await runAttempt(jobId, attempt.providerAttemptId);
      if (!success) return;
      record = store.get(jobId);
      if (!record || ['failed', 'cancelled'].includes(record.status)) return;
    }
    record = store.get(jobId);
    if (!record) return;
    if (record.status === 'succeeded' || record.status === 'awaiting_confirmation') return;
    if (record.kind === 'main_candidates') {
      if (record.temp.candidates.length !== record.request.candidateCount + 1) {
        failJob(jobId, 'PROVIDER_RESULT_INVALID', 'Die Candidateanzahl ist unvollständig.');
        return;
      }
      store.setJobState(jobId, {
        status: 'succeeded', phase: 'complete', cancellable: true,
        retryable: false, discardable: false, retry: null, error: null,
      });
      return;
    }
    store.setJobState(jobId, { phase: 'validating_set' });
    record = store.get(jobId);
    const references = {
      light: record.temp.selectedPreview,
      dark: record.temp.finals.dark,
      darkOff: record.temp.finals.darkOff,
    };
    if (!Object.values(references).every((reference) => reference && store.tempExists(reference))) {
      failJob(jobId, 'PROVIDER_RESULT_INVALID', 'Der temporäre Variantensatz ist unvollständig.');
      return;
    }
    let bytes;
    try {
      bytes = Object.fromEntries(Object.entries(references).map(([variant, reference]) => [variant, store.readTemp(reference)]));
      await Promise.all(Object.entries(bytes).map(([variant, variantBytes]) => validatePreviewBytes(
        variantBytes, 'heif', { purpose: 'final-set', variant, jobId },
      )));
    } catch {
      const cancelling = store.get(jobId)?.status === 'cancelling';
      failJob(jobId, cancelling ? 'JOB_CANCELLED' : 'PROVIDER_RESULT_INVALID',
        cancelling ? 'Der Job wurde abgebrochen.' : 'Der temporäre Variantensatz war ungültig.', { cancelled: cancelling });
      return;
    }
    const current = store.get(jobId);
    if (current?.status === 'cancelling') {
      failJob(jobId, 'JOB_CANCELLED', 'Der Job wurde abgebrochen.', { cancelled: true });
      return;
    }
    const committed = store.commitFinalValidation(jobId, bytes.light);
    if (!committed?.result) {
      const cancelling = store.get(jobId)?.status === 'cancelling';
      failJob(jobId, cancelling ? 'JOB_CANCELLED' : 'PROVIDER_RESULT_INVALID',
        cancelling ? 'Der Job wurde abgebrochen.' : 'Der temporäre Variantensatz konnte nicht atomar bestätigt werden.',
        { cancelled: cancelling });
    }
  }

  async function drain() {
    if (activeJobId) return;
    const jobId = queue.shift();
    if (!jobId) return;
    activeJobId = jobId;
    try { await run(jobId); } finally {
      activeJobId = null;
      if (queue.length) await drain();
    }
  }
  function schedule() {
    drainPromise = drainPromise.then(drain, drain);
    void drainPromise.catch(() => undefined);
  }
  function enqueue(jobId, reservation = null) {
    if (reservation) reservation.consume(jobId);
    else {
      const slot = reserve();
      if (!slot) return false;
      slot.consume(jobId);
    }
    return true;
  }
  function cancel(jobId) {
    assertSetupRecoveryHealthy();
    const record = store.get(jobId);
    if (!record) return 'absent';
    if (record.phase === 'publishing_set') return 'publishing';
    if (['cancelling', 'cancelled'].includes(record.status)) return 'cancelled';
    if (record.status === 'queued') {
      store.setJobState(jobId, { status: 'cancelling' });
      const index = queue.indexOf(jobId);
      if (index >= 0) queue.splice(index, 1);
      cancelRemaining(store.get(jobId), 'JOB_CANCELLED');
      failJob(jobId, 'JOB_CANCELLED', 'Der Job wurde vor dem Start abgebrochen.', { cancelled: true });
      return 'cancelled';
    }
    if (record.status === 'running') {
      store.setJobState(jobId, { status: 'cancelling' });
      controllers.get(jobId)?.abort();
      return 'cancelling';
    }
    if (record.status === 'succeeded' || record.status === 'awaiting_confirmation') {
      store.setJobState(jobId, { status: 'cancelling' });
      failJob(jobId, 'JOB_CANCELLED', 'Der temporäre Job wurde verworfen.', { cancelled: true });
      return 'cancelled';
    }
    return 'not_cancellable';
  }
  async function probe() {
    assertSetupRecoveryHealthy();
    if (provider.available !== true) throw Object.assign(new Error('Provider adapter is not configured'), { code: 'LOCAL_PROVIDER_REQUEST_NOT_SENT' });
    const controller = new AbortController();
    const deadline = armDeadline(controller, probeDeadlineMs, 'Room-image probe deadline exceeded');
    const operation = trackProviderOperation(Promise.resolve().then(() => {
      assertSetupRecoveryHealthy();
      return provider.probe({ signal: controller.signal });
    }));
    try {
      return await deadline.wait(operation);
    } finally {
      deadline.clear();
    }
  }
  return {
    cancel, editDeadlineMs, enqueue, probe, probeDeadlineMs, reserve,
    get activeJobId() { return activeJobId; },
    get queuedJobIds() { return [...queue]; },
    get capacityUsed() { return capacityUsed(); },
    async waitForIdle() {
      while (true) {
        const scheduled = drainPromise;
        await scheduled;
        const pendingProviderOperations = [...providerOperations];
        if (pendingProviderOperations.length) await Promise.allSettled(pendingProviderOperations);
        if (scheduled === drainPromise && !activeJobId && queue.length === 0 && providerOperations.size === 0) return;
      }
    },
  };
}

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

export function requestOriginAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  const origin = req.headers?.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string' || !origin) return false;
  if (allowedOrigins.has(origin)) return true;
  return sameOriginAsRequest(origin, req);
}

export function songRequestAllowed(req, target, allowedOrigins = ALLOWED_ORIGINS) {
  if (!target) return false;
  const methodAllowed = target.method
    ? req.method === target.method
    : (target.kind === 'library' && ['GET', 'POST'].includes(req.method || ''))
      || (target.kind === 'library-item' && ['PATCH', 'DELETE'].includes(req.method || ''))
      || (target.kind === 'library-audio' && ['GET', 'HEAD'].includes(req.method || ''));
  return methodAllowed && requestOriginAllowed(req, allowedOrigins);
}


export function proxyRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return false;
  return requestOriginAllowed(req, allowedOrigins);
}

export function notionBridgeRequestAllowed(req, targetPath, allowedOrigins = ALLOWED_ORIGINS) {
  const methodAllowed = (targetPath === '/health' && req.method === 'GET')
    || (targetPath !== '/health' && req.method === 'POST');
  return methodAllowed && requestOriginAllowed(req, allowedOrigins);
}

export function ambientRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'POST' && requestOriginAllowed(req, allowedOrigins);
}

export function configRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'PUT'].includes(req.method || '') && requestOriginAllowed(req, allowedOrigins);
}

export function householdConfigRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'GET' && requestOriginAllowed(req, allowedOrigins);
}

export function familyDataRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')
    && requestOriginAllowed(req, allowedOrigins);
}



export function ablageRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return ['GET', 'POST'].includes(req.method || '') && requestOriginAllowed(req, allowedOrigins);
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
  '/api/reminders',
  '/api/songs',
  '/notion-bridge',
  '/notion-shopping.json',
  '/hermes',
  '/ambient-llm',
  '/shopping-llm',
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

export function createConfigMutationCoordinator() {
  let tail = Promise.resolve();
  let queued = 0;
  let active = false;

  function run(operation) {
    queued += 1;
    const turn = tail.then(async () => {
      queued -= 1;
      active = true;
      try { return await operation(); } finally { active = false; }
    });
    tail = turn.then(() => undefined, () => undefined);
    return turn;
  }

  function runSync(operation) {
    if (active || queued > 0) {
      throw new Error('Eine asynchrone Household-Konfigurationsmutation ist bereits aktiv.');
    }
    active = true;
    try { return operation(); } finally { active = false; }
  }

  return { run, runSync };
}

export function createCentralConfigStore(
  path = CONFIG_PATH,
  { assertSetupRecoveryHealthy = () => undefined } = {},
) {
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

  function prepareUpdate(updates) {
    const values = read();
    for (const [key, value] of Object.entries(updates)) {
      if (!SHARED_CONFIG_KEYS.has(key)) continue;
      if (value === null) delete values[key];
      else if (validSharedConfigValue(value)) values[key] = value;
    }
    return { values, bytes: Buffer.from(`${JSON.stringify(values, null, 2)}\n`) };
  }

  function update(updates) {
    const prepared = prepareUpdate(updates);
    assertSetupRecoveryHealthy();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, prepared.bytes, { mode: 0o600, flush: true });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    flushDirectory(dirname(path));
    return prepared.values;
  }

  function responseSnapshot() {
    const state = readSetupTargetState(path);
    let values = {};
    if (state.exists) {
      try {
        const parsed = JSON.parse(setupStateBytes(state).toString('utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          values = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => (
            SHARED_CONFIG_KEYS.has(key) && typeof value === 'string'
          )));
        }
      } catch { /* invalid Shared Config projects to the existing closed empty response */ }
    }
    return { exists: state.exists, body: Buffer.from(JSON.stringify({ values })) };
  }
  function responseBody() { return responseSnapshot().body; }
  function exists() {
    try { return readSetupTargetState(path).exists; } catch { return false; }
  }

  function snapshot() {
    const state = readSetupTargetState(path);
    return state.exists
      ? { existed: true, bytes: setupStateBytes(state) }
      : { existed: false, bytes: null };
  }
  function restore(snapshotValue) {
    assertSetupRecoveryHealthy();
    if (!snapshotValue?.existed) {
      try { unlinkSync(path); } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
      }
      if (existsSync(dirname(path))) flushDirectory(dirname(path));
      return;
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.restore.tmp`;
    let primaryError = null;
    try {
      writeFileSync(temporary, snapshotValue.bytes, { mode: 0o600, flush: true });
      chmodSync(temporary, 0o600);
      renameSync(temporary, path);
      flushDirectory(dirname(path));
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try { unlinkSync(temporary); } catch (error) {
        if ((!error || typeof error !== 'object' || error.code !== 'ENOENT') && primaryError === null) throw error;
      }
    }
  }

  return { exists, path, prepareUpdate, read, responseBody, responseSnapshot, restore, snapshot, update };
}

function setupRecoveryFailure(message = 'Eine Setup-Konfigurationstransaktion konnte nicht sicher wiederhergestellt werden.') {
  return { ok: false, code: 'SETUP_CONFIG_RECOVERY_REQUIRED', message };
}

function setupRecoveryRequiredError() {
  return Object.assign(new Error('Setup configuration recovery required'), {
    code: 'SETUP_CONFIG_RECOVERY_REQUIRED',
    status: 503,
  });
}

function isSetupRecoveryRequiredError(error) {
  let current = error;
  const seen = new Set();
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (current.code === 'SETUP_CONFIG_RECOVERY_REQUIRED') return true;
    seen.add(current);
    current = current.cause;
  }
  return false;
}

function setupExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function setupCanonicalPath(path) {
  if (typeof path !== 'string' || !path) throw new Error('setup target path missing');
  return canonicalRoomImageAssetPath(path);
}

function setupInspectPath(path, expectedType = null) {
  return inspectRoomImageAssetPath(setupCanonicalPath(path), expectedType);
}

function ensureSetupDirectory(path, mode = 0o700) {
  const absolute = setupCanonicalPath(path);
  const inspected = setupInspectPath(absolute, 'directory');
  if (!inspected.exists) mkdirSync(absolute, { recursive: true, mode });
  const created = setupInspectPath(absolute, 'directory');
  if (!created.exists) throw new Error('setup directory creation failed');
  chmodSync(absolute, mode);
  return absolute;
}

function ensureSetupJournalDirectory(path) {
  const absolute = setupCanonicalPath(path);
  const inspected = setupInspectPath(absolute, 'directory');
  if (inspected.exists) {
    const metadata = lstatSync(absolute);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
      throw new Error('unsafe setup recovery directory');
    }
    return absolute;
  }
  mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const created = setupInspectPath(absolute, 'directory');
  if (!created.exists) throw new Error('setup recovery directory creation failed');
  chmodSync(absolute, 0o700);
  flushDirectory(dirname(absolute));
  return absolute;
}

function setupPathBinding(path) {
  return createHash('sha256').update(setupCanonicalPath(path)).digest('hex');
}

function setupState(exists, bytes = null) {
  return exists
    ? { exists: true, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.toString('base64') }
    : { exists: false, sha256: null, bytes: null };
}

function readSetupTargetState(path) {
  const absolute = setupCanonicalPath(path);
  const inspected = setupInspectPath(absolute, 'file');
  if (!inspected.exists) return setupState(false);
  let descriptor;
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > Math.max(CONFIG_BODY_MAX, HOUSEHOLD_CONFIG_BODY_MAX)) {
      throw new Error('unsafe setup target');
    }
    const bytes = readFileSync(descriptor);
    const current = lstatSync(absolute);
    if (!current.isFile() || current.isSymbolicLink()
        || current.dev !== metadata.dev || current.ino !== metadata.ino) {
      throw new Error('setup target changed during snapshot');
    }
    return setupState(true, bytes);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validSetupState(value) {
  if (!setupExactObject(value, ['exists', 'sha256', 'bytes']) || typeof value.exists !== 'boolean') return false;
  if (!value.exists) return value.sha256 === null && value.bytes === null;
  if (!/^[0-9a-f]{64}$/.test(value.sha256 || '') || typeof value.bytes !== 'string') return false;
  let bytes;
  try { bytes = Buffer.from(value.bytes, 'base64'); } catch { return false; }
  return bytes.toString('base64') === value.bytes
    && createHash('sha256').update(bytes).digest('hex') === value.sha256;
}

function setupStateMatches(actual, expected) {
  return actual.exists === expected.exists
    && actual.sha256 === expected.sha256
    && (!actual.exists || actual.bytes === expected.bytes);
}

function setupStateBytes(state) {
  return state.exists ? Buffer.from(state.bytes, 'base64') : null;
}

function validSetupAfterState(role, state) {
  if (!state.exists) return false;
  const bytes = setupStateBytes(state);
  const maxBytes = role === 'shared' ? CONFIG_BODY_MAX : HOUSEHOLD_CONFIG_BODY_MAX;
  if (bytes.length === 0 || bytes.length > maxBytes) return false;
  let document;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    document = JSON.parse(text);
  } catch { return false; }
  if (role === 'shared') return validSharedConfigDocument(document);
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) return false;
  try {
    projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
    return true;
  } catch { return false; }
}

function atomicWriteSetupTarget(path, state, afterRename = () => undefined) {
  const absolute = setupCanonicalPath(path);
  const parent = ensureSetupDirectory(dirname(absolute));
  const current = setupInspectPath(absolute, 'file');
  if (current.exists && lstatSync(absolute).isSymbolicLink()) throw new Error('unsafe setup target');
  if (!state.exists) {
    try { unlinkSync(absolute); } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
    }
    flushDirectory(parent);
    return;
  }
  const temporary = join(parent, `.setup-target-${randomUUID()}.tmp`);
  let primaryError = null;
  try {
    writeFileSync(temporary, setupStateBytes(state), { mode: 0o600, flag: 'wx', flush: true });
    chmodSync(temporary, 0o600);
    renameSync(temporary, absolute);
    afterRename();
    flushDirectory(parent);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { unlinkSync(temporary); } catch (error) {
      if ((!error || typeof error !== 'object' || error.code !== 'ENOENT') && primaryError === null) throw error;
    }
  }
}

function writeSetupJournal(path, journal) {
  const directory = dirname(path);
  const temporary = join(directory, `.setup-journal-${randomUUID()}.tmp`);
  let primaryError = null;
  try {
    const bytes = Buffer.from(`${JSON.stringify(journal)}\n`);
    if (bytes.length > SETUP_TRANSACTION_MAX_BYTES) throw new Error('setup journal exceeds limit');
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx', flush: true });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    flushDirectory(directory);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try { unlinkSync(temporary); } catch (error) {
      if ((!error || typeof error !== 'object' || error.code !== 'ENOENT') && primaryError === null) throw error;
    }
  }
}

function validSetupJournal(journal, id, targets) {
  if (!setupExactObject(journal, ['version', 'id', 'phase', 'targets'])
      || journal.version !== SETUP_TRANSACTION_VERSION || journal.id !== id
      || !['prepared', 'shared_committed', 'household_committed', 'complete'].includes(journal.phase)
      || !setupExactObject(journal.targets, ['shared', 'household'])) return false;
  for (const role of ['shared', 'household']) {
    const target = journal.targets[role];
    if (!setupExactObject(target, ['role', 'pathBinding', 'before', 'after'])
        || target.role !== role || target.pathBinding !== setupPathBinding(targets[role])
        || !validSetupState(target.before) || !validSetupState(target.after)
        || !validSetupAfterState(role, target.after)) return false;
  }
  return true;
}

function removeSetupJournal(path) {
  const directory = dirname(path);
  unlinkSync(path);
  flushDirectory(directory);
  if (readdirSync(directory).length === 0) {
    rmdirSync(directory);
    flushDirectory(dirname(directory));
  }
}

function recoverSetupJournal(path, targets) {
  const name = basename(path);
  const match = name.match(SETUP_TRANSACTION_JOURNAL_PATTERN);
  if (!match) throw new Error('unexpected setup recovery artifact');
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600
      || metadata.size > SETUP_TRANSACTION_MAX_BYTES) throw new Error('unsafe setup recovery journal');
  const journal = JSON.parse(readFileSync(path, 'utf8'));
  if (!validSetupJournal(journal, match[1], targets)) throw new Error('invalid setup recovery journal');
  const current = {
    shared: readSetupTargetState(targets.shared),
    household: readSetupTargetState(targets.household),
  };
  const matches = Object.fromEntries(['shared', 'household'].map((role) => [role, {
    before: setupStateMatches(current[role], journal.targets[role].before),
    after: setupStateMatches(current[role], journal.targets[role].after),
  }]));
  if (Object.values(matches).some((candidate) => !candidate.before && !candidate.after)) {
    throw new Error('ambiguous setup recovery bytes');
  }

  let generation = 'after';
  if (journal.phase === 'prepared') {
    const sharedCommitted = matches.shared.after && !matches.shared.before;
    const householdCommitted = matches.household.after && !matches.household.before;
    if (householdCommitted && !sharedCommitted) throw new Error('incoherent prepared setup transaction');
    generation = sharedCommitted || householdCommitted ? 'after' : 'before';
  } else {
    if (!matches.shared.after) throw new Error('incoherent durable Shared setup phase');
    if (['household_committed', 'complete'].includes(journal.phase) && !matches.household.after) {
      throw new Error('incoherent durable Household setup phase');
    }
  }

  if (generation === 'after') {
    if (journal.phase === 'prepared') {
      journal.phase = 'shared_committed';
      writeSetupJournal(path, journal);
    }
    for (const role of ['shared', 'household']) {
      if (!matches[role].after) atomicWriteSetupTarget(targets[role], journal.targets[role].after);
    }
    journal.phase = 'complete';
    writeSetupJournal(path, journal);
  }
  removeSetupJournal(path);
  return { recovered: true, generation };
}

export function recoverSetupConfigTransactions({ configPath, householdConfigPath } = {}) {
  if (!configPath || !householdConfigPath) return { ok: true, status: 'not_configured', recovered: 0 };
  const targets = { shared: setupCanonicalPath(configPath), household: setupCanonicalPath(householdConfigPath) };
  const directory = join(dirname(targets.household), SETUP_TRANSACTION_DIRECTORY);
  try {
    const inspected = setupInspectPath(directory, 'directory');
    if (!inspected.exists) return { ok: true, status: 'clean', recovered: 0 };
    const metadata = lstatSync(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) {
      throw new Error('unsafe setup recovery directory');
    }
    const names = readdirSync(directory).sort();
    if (names.length > 1) throw new Error('multiple setup recovery journals');
    if (names.length === 0) {
      rmdirSync(directory);
      flushDirectory(dirname(directory));
      return { ok: true, status: 'clean', recovered: 0 };
    }
    recoverSetupJournal(join(directory, names[0]), targets);
    return { ok: true, status: 'recovered', recovered: 1 };
  } catch {
    return setupRecoveryFailure();
  }
}

async function commitSetupConfigTransaction({
  configPath,
  householdConfigPath,
  sharedAfterBytes,
  householdAfterBytes,
  setupMutationStep = () => undefined,
  latchSetupRecoveryFailure = () => undefined,
  assertSetupRecoveryHealthy = () => undefined,
}) {
  assertSetupRecoveryHealthy();
  const targets = { shared: setupCanonicalPath(configPath), household: setupCanonicalPath(householdConfigPath) };
  if (targets.shared === targets.household) throw new Error('setup targets must be distinct');
  const before = {
    shared: readSetupTargetState(targets.shared),
    household: readSetupTargetState(targets.household),
  };
  const directory = ensureSetupJournalDirectory(join(dirname(targets.household), SETUP_TRANSACTION_DIRECTORY));
  if (readdirSync(directory).length !== 0) throw new Error('setup recovery is not clean');
  const id = randomUUID();
  const path = join(directory, `setup-${id}.journal`);
  const journal = {
    version: SETUP_TRANSACTION_VERSION,
    id,
    phase: 'prepared',
    targets: {
      shared: {
        role: 'shared', pathBinding: setupPathBinding(targets.shared),
        before: before.shared, after: setupState(true, sharedAfterBytes),
      },
      household: {
        role: 'household', pathBinding: setupPathBinding(targets.household),
        before: before.household, after: setupState(true, householdAfterBytes),
      },
    },
  };
  try {
    assertSetupRecoveryHealthy();
    writeSetupJournal(path, journal);
    await setupMutationStep('setup_transaction_prepared');
    assertSetupRecoveryHealthy();
    atomicWriteSetupTarget(targets.shared, journal.targets.shared.after);
    journal.phase = 'shared_committed';
    assertSetupRecoveryHealthy();
    writeSetupJournal(path, journal);
    await setupMutationStep('shared_config_committed');
    assertSetupRecoveryHealthy();
    atomicWriteSetupTarget(targets.household, journal.targets.household.after, () => {
      const result = setupMutationStep('household_config_renamed');
      if (result && typeof result.then === 'function') throw new Error('household_config_renamed must be synchronous');
    });
    journal.phase = 'household_committed';
    assertSetupRecoveryHealthy();
    writeSetupJournal(path, journal);
    await setupMutationStep('household_config_committed');
    journal.phase = 'complete';
    assertSetupRecoveryHealthy();
    writeSetupJournal(path, journal);
    await setupMutationStep('setup_transaction_complete');
    assertSetupRecoveryHealthy();
    removeSetupJournal(path);
  } catch (error) {
    if (isSetupRecoveryRequiredError(error)) throw error;
    const recovered = recoverSetupConfigTransactions({ configPath: targets.shared, householdConfigPath: targets.household });
    if (!recovered.ok) {
      latchSetupRecoveryFailure();
      if (error && typeof error === 'object') error.recoveryError = setupRecoveryFailure();
    }
    throw error;
  }
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
        message: 'The household configuration path is not configured.',
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
          message: 'The household configuration was not found.',
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
          message: 'The household configuration was not found.',
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
      message: 'The household configuration is not valid JSON.',
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
      message: 'The migrated document does not satisfy the current household contract.',
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
        : 'The migrated document cannot be projected into the production runtime.',
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
      message: 'The household configuration could not be backed up before migration.',
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
      message: 'The migrated household configuration could not be activated atomically.',
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
      `The built frontend is missing at ${indexPath}.`,
    );
  }

  for (const directory of requiredWritableDirs) {
    try {
      if (!statSync(directory).isDirectory()) throw new Error('not a directory');
      accessSync(directory, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      return notReady(
        'RUNTIME_DIRECTORY_NOT_WRITABLE',
        `Runtime directory is not readable and writable: ${directory}`,
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
      'The household configuration is not valid JSON.',
    );
  }
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) {
    const issue = parsed.issues[0];
    return notReady(
      'HOUSEHOLD_CONFIG_INVALID',
      `The household configuration is invalid (${parsed.issues.length} Problem${parsed.issues.length === 1 ? '' : 'e'}).`,
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

/* Lizenz-/Quellcodeherkunft der laufenden Fassung. Bewusst öffentlich: die
   AGPL verlangt, dass Benutzer den Corresponding Source finden — auch die
   spätere Hotel-Gastoberfläche darf diese Auskunft nicht hinter einem
   Admin-Unlock verstecken. Ungültige Umgebungswerte werden zu `null`, damit
   nie eine erfundene Upstream-Herkunft behauptet wird. */
export function readBuildInfo({
  version = APP_VERSION,
  revision = process.env.HMI_REVISION,
  sourceUrl = process.env.HMI_SOURCE_URL,
} = {}) {
  return resolveBuildInfo({ version, revision, sourceUrl });
}

export function serveBuildInfo(req, res, buildInfo) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    jsonResponse(res, 405, {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Die Build-Information ist ausschließlich per GET lesbar.',
    }, { allow: 'GET, HEAD' });
    return;
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }
  jsonResponse(res, 200, buildInfo);
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

  const bodyBytes = Buffer.from(result.body);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    etag: strongByteEtag(bodyBytes),
    ...modeHeader,
  });
  res.end(bodyBytes);
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

  function addReminder(who, rawTitle, rawDue = null, rawLabel = null) {
    /* Die drei Voreinstellungen bleiben ohne Label gültig; frei angelegte
       Bewohner (Notizen-Screen) schicken ihren Anzeigenamen mit. */
    const labels = { alex: 'Alex', sam: 'Sam', beide: 'Beide' };
    const id = String(who || '').trim().toLowerCase();
    const label = String(rawLabel || labels[id] || '').trim();
    const title = String(rawTitle || '').trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(id) || !label || label.length > 40) {
      throw new Error('Unbekannte Person');
    }
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fullTitle = new RegExp(`^(${id}|${escaped})\\s*[-–:]`, 'i').test(title) ? title : `${label} - ${title}`;
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

function serveConfig(req, res, store, configMutations, assertSetupRecoveryHealthy) {
  if (req.method === 'GET') {
    try {
      const bytes = store.responseBody();
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        etag: strongByteEtag(bytes),
      });
      res.end(bytes);
    } catch {
      jsonResponse(res, 503, setupRecoveryFailure());
    }
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
  req.on('end', async () => {
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
    const ifMatchValues = rawHeaderValues(req, 'if-match');
    if (ifMatchValues.length !== 1) {
      jsonResponse(res, 428, { ok: false, code: 'CONFIG_PRECONDITION_REQUIRED', message: 'Der Shared-Config-ETag fehlt.' });
      return;
    }
    try {
      const result = await configMutations.run(() => {
        assertSetupRecoveryHealthy();
        if (ifMatchValues[0] !== strongByteEtag(store.responseBody())) return { stale: true };
        const values = store.update(payload.updates);
        return { stale: false, bytes: Buffer.from(JSON.stringify({ values })) };
      });
      if (result.stale) {
        jsonResponse(res, 412, { ok: false, code: 'CONFIG_PRECONDITION_FAILED', message: 'Die Shared Config wurde zwischenzeitlich geändert.' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
        etag: strongByteEtag(result.bytes),
      });
      res.end(result.bytes);
    } catch (error) {
      if (isSetupRecoveryRequiredError(error)) {
        jsonResponse(res, 503, setupRecoveryFailure());
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end('{"error":"Konfiguration konnte nicht gespeichert werden"}');
    }
  });
}

function setupRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'POST' && requestOriginAllowed(req, allowedOrigins);
}

/* Die lesenden Setup-Routen des Supervisor-Modus liefern Haushaltsstruktur,
   niemals Credentials, bleiben aber an dieselbe Origin-Grenze gebunden. */
function setupReadRequestAllowed(req, allowedOrigins = ALLOWED_ORIGINS) {
  return req.method === 'GET' && requestOriginAllowed(req, allowedOrigins);
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

/* B-08E11: Der einzige serverseitige Auflöser des Home-Assistant-Zugangs.
   Im direkten Modus kommt er aus der Shared Config, im App-Modus
   ausschließlich aus der Prozessumgebung — dort wird nichts gespeichert und es
   gibt keinen Rückfall auf einen Long-Lived Access Token. */
function resolveServerHaAccess(configStore, connectionMode = HA_CONNECTION_MODE) {
  if (connectionMode === 'supervisor') {
    const token = readSupervisorToken();
    return token
      ? { baseUrl: HA_SUPERVISOR_CORE_URL, token, websocketUrl: HA_SUPERVISOR_WEBSOCKET_URL }
      : null;
  }
  const values = configStore ? configStore.read() : {};
  const baseUrl = normalizeSetupHaUrl(values['hmi:ha-url']);
  const token = values['hmi:ha-token'];
  return baseUrl && typeof token === 'string' && token ? { baseUrl, token } : null;
}

/* Cutover: eine bestehende Installation, die auf den App-Modus wechselt, darf
   ihren alten Long-Lived Access Token nicht behalten. Entfernt wird atomar über
   dieselbe Schreibroutine wie jede andere Änderung — es entsteht keine
   Klartext-Sicherungsdatei, in der das Secret weiterlebt. */
export function purgeHaCredentialsFromSharedConfig(configStore) {
  const values = configStore.read();
  if (values['hmi:ha-url'] === undefined && values['hmi:ha-token'] === undefined) return false;
  configStore.update({ 'hmi:ha-url': null, 'hmi:ha-token': null });
  return true;
}

/* HA-Pfade relativ auflösen, damit derselbe Aufruf gegen eine HA-Adresse und
   gegen den internen Core-Präfix `/core/` funktioniert. */
function haRestUrl(baseUrl, path) {
  const base = String(baseUrl).endsWith('/') ? String(baseUrl) : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), base);
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

function setupPayloadError(payload, connectionMode = 'direct') {
  const supervisor = connectionMode === 'supervisor';
  /* Im App-Modus gibt es keine Nutzer-Credentials. Eine Anfrage, die trotzdem
     welche mitbringt, wird abgelehnt statt stillschweigend entwertet. */
  if (supervisor && (payload?.haUrl !== undefined || payload?.haToken !== undefined)) {
    return {
      code: 'SETUP_CREDENTIALS_NOT_ALLOWED',
      message: 'Im Home-Assistant-App-Modus werden weder HA-Adresse noch HA-Token entgegengenommen.',
    };
  }
  const haUrl = supervisor ? null : normalizeSetupHaUrl(payload?.haUrl);
  if (!supervisor && !haUrl) {
    return {
      code: 'SETUP_INVALID_HOME_ASSISTANT_URL',
      message: 'Die Home-Assistant-URL muss eine gültige HTTP- oder HTTPS-Adresse sein.',
    };
  }
  if (!supervisor && (typeof payload?.haToken !== 'string' || !payload.haToken.trim()
      || Buffer.byteLength(payload.haToken) > 16 * 1024)) {
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
      message: `The household configuration is invalid (${parsed.issues.length} Probleme).`,
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
    haToken: supervisor ? null : payload.haToken.trim(),
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

/* Aktivierungsprüfung im App-Modus: derselbe Vertrag wie
   `verifySetupHomeAssistant`, aber über den internen Zugang und ohne jede
   Nutzereingabe. Fehlt die Berechtigung, wird das gemeldet — es gibt keinen
   Rückfall auf eine HA-Adresse oder einen Long-Lived Access Token. */
export async function verifySetupSupervisorHomeAssistant(client) {
  try {
    const result = await client.rest('GET', '/api/config');
    if (result.status === 200) return { ok: true };
    return {
      ok: false,
      code: 'HA_SUPERVISOR_HTTP_ERROR',
      message: 'Home Assistant hat die interne Anfrage abgelehnt.',
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
      message: typeof error?.message === 'string'
        ? error.message
        : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
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

/* Ein Supervisor-Client pro Anfrage: der interne Zugang wird geöffnet,
   benutzt und wieder geschlossen, statt über Anfragen hinweg zu leben. */
async function withSupervisorClient(clientFactory, use) {
  const client = clientFactory();
  try { return await use(client); } finally { client.close(); }
}

/* CalDAV-/iCloud-Einrichtung im App-Modus: der HA-Config-Flow läuft über den
   internen Zugang statt über direktes Browser-REST mit CORS. Das App-Passwort
   wird durchgereicht und nie gespeichert oder geloggt. */
async function serveHaCaldavFlow(req, res, { connectionMode, supervisorClientFactory }) {
  if (connectionMode !== 'supervisor') {
    jsonResponse(res, 404, {
      ok: false,
      code: 'HA_CALDAV_FLOW_NOT_AVAILABLE',
      message: 'Der serverseitige CalDAV-Flow gibt es nur im Home-Assistant-App-Modus.',
    });
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > 64 * 1024) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      jsonResponse(res, 413, { ok: false, code: 'HA_CALDAV_REQUEST_TOO_LARGE', message: 'Die Anfrage ist zu groß.' });
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = null; }
    const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
    const password = typeof payload?.password === 'string' ? payload.password : '';
    if (!username || !password) {
      jsonResponse(res, 400, {
        ok: false, code: 'HA_CALDAV_INVALID_REQUEST',
        message: 'Apple-ID und App-Passwort werden benötigt.',
      });
      return;
    }
    try {
      const result = await withSupervisorClient(supervisorClientFactory, async (client) => {
        const started = await client.rest('POST', '/api/config/config_entries/flow', {
          handler: 'caldav', show_advanced_options: false,
        });
        if (started.status === 404) {
          return { httpStatus: 404, payload: { ok: false, code: 'HA_CALDAV_NOT_AVAILABLE', message: 'Die CalDAV-Integration ist in dieser Home-Assistant-Version nicht verfügbar.' } };
        }
        const flowId = started.body?.flow_id;
        if (started.status >= 400 || typeof flowId !== 'string' || !flowId) {
          return { httpStatus: 502, payload: { ok: false, code: 'HA_CALDAV_FLOW_FAILED', message: 'Home Assistant hat den CalDAV-Flow nicht gestartet.' } };
        }
        const step = await client.rest('POST', `/api/config/config_entries/flow/${encodeURIComponent(flowId)}`, {
          url: 'https://caldav.icloud.com', username, password, verify_ssl: true,
        });
        if (step.status >= 400 || !step.body || typeof step.body !== 'object') {
          return { httpStatus: 502, payload: { ok: false, code: 'HA_CALDAV_FLOW_FAILED', message: 'Home Assistant hat den CalDAV-Flow abgebrochen.' } };
        }
        return { httpStatus: 200, payload: { ok: true, result: step.body } };
      });
      jsonResponse(res, result.httpStatus, result.payload);
    } catch (error) {
      jsonResponse(res, Number.isInteger(error?.status) ? error.status : 502, {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
        message: typeof error?.message === 'string'
          ? error.message
          : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
      });
    }
  });
}

/* Same-Origin-Laufzeitauskunft: sagt Wizard und Runtime, ob dieser Server die
   Home-Assistant-Verbindung selbst vermittelt. Antwortet in beiden Betriebsarten
   und liefert nie Credentials. */
function serveHaConnection(res, { connectionMode, supervisorAvailable }) {
  jsonResponse(res, 200, {
    ok: true,
    mode: connectionMode,
    credentialsRequired: connectionMode !== 'supervisor',
    available: connectionMode === 'supervisor' ? supervisorAvailable : true,
    gatewayPath: connectionMode === 'supervisor' ? HA_GATEWAY_PATH : null,
  }, { 'cache-control': 'no-store' });
}

/* Areas, Geräte, Entitäten und States über den internen Zugang. Nur im
   App-Modus erreichbar; im direkten Modus entdeckt weiterhin der Browser. */
async function serveSetupDiscovery(res, { connectionMode, supervisorClientFactory }) {
  if (connectionMode !== 'supervisor') {
    jsonResponse(res, 404, {
      ok: false,
      code: 'SETUP_DISCOVERY_NOT_AVAILABLE',
      message: 'Die serverseitige Entdeckung gibt es nur im Home-Assistant-App-Modus.',
    });
    return;
  }
  try {
    const snapshot = await withSupervisorClient(supervisorClientFactory, readHaDiscoverySnapshot);
    jsonResponse(res, 200, { ok: true, ...snapshot }, { 'cache-control': 'no-store' });
  } catch (error) {
    jsonResponse(res, Number.isInteger(error?.status) ? error.status : 502, {
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'HA_SUPERVISOR_UNREACHABLE',
      message: typeof error?.message === 'string'
        ? error.message
        : 'Home Assistant ist über den internen App-Zugang nicht erreichbar.',
    });
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
    configMutations,
    setupMutationStep,
    latchSetupRecoveryFailure,
    assertSetupRecoveryHealthy,
    reconfigure = false,
    connectionMode = 'direct',
    supervisorConnectionVerifier = null,
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
    const supervisor = connectionMode === 'supervisor';
    const result = setupPayloadError(payload, connectionMode);
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
    const householdMatches = rawHeaderValues(req, 'if-match');
    const sharedMatches = rawHeaderValues(req, 'x-hauser-shared-config-if-match');
    let sharedAtRequest;
    try { sharedAtRequest = configStore.responseSnapshot(); } catch {
      jsonResponse(res, 503, setupRecoveryFailure());
      return;
    }
    if ((reconfigure && householdMatches.length !== 1)
        || sharedMatches.length > 1
        || ((reconfigure || sharedAtRequest.exists) && sharedMatches.length !== 1)) {
      jsonResponse(res, 428, {
        ok: false, code: 'CONFIG_PRECONDITION_REQUIRED',
        message: 'Die erforderlichen Household-/Shared-Config-ETags fehlen oder sind mehrdeutig.',
      });
      return;
    }
    const connection = supervisor
      ? await supervisorConnectionVerifier()
      : await setupConnectionVerifier(result.haUrl, result.haToken);
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
    let activatedHouseholdConfig = result.householdConfig;
    const sharedConfigUpdates = {
      'hmi:backend': 'ha',
      /* Im App-Modus wird bewusst kein HA-Zugang in die Shared Config
         geschrieben; der interne Zugang lebt nur im Serverprozess. */
      'hmi:ha-url': supervisor ? null : result.haUrl,
      'hmi:ha-token': supervisor ? null : result.haToken,
      'hmi:jf-url': result.jellyfin.enabled ? result.jellyfin.url : null,
      'hmi:jf-token': result.jellyfin.enabled ? result.jellyfin.accessToken : null,
      'hmi:jf-user': result.jellyfin.enabled ? result.jellyfin.userId : null,
      'hmi:library': result.jellyfin.enabled ? 'live' : 'fake',
    };
    try {
      await configMutations.run(async () => {
        assertSetupRecoveryHealthy();
        if (reconfigure) {
          const current = readRoomImageHouseholdSnapshot(householdConfigPath);
          if (householdMatches[0] !== current.etag) {
            throw Object.assign(new Error('stale household config'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
          }
          const merged = structuredClone(result.householdConfig);
          merged.globalEntities.laundry = structuredClone(current.document.globalEntities.laundry);
          const parsed = parseHouseholdConfig(merged);
          if (!parsed.ok) throw new Error('merged setup config is invalid');
          projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
          activatedHouseholdConfig = merged;
        } else if (existsSync(householdConfigPath)) {
          throw Object.assign(new Error('household config appeared'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
        }
        const currentShared = configStore.responseSnapshot();
        if (currentShared.exists !== sharedAtRequest.exists
            || !currentShared.body.equals(sharedAtRequest.body)) {
          throw Object.assign(new Error('stale shared existence or bytes'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
        }
        if (reconfigure || sharedAtRequest.exists || sharedMatches.length === 1) {
          if (sharedMatches[0] !== strongByteEtag(sharedAtRequest.body)) {
            throw Object.assign(new Error('stale shared config'), { code: 'CONFIG_PRECONDITION_FAILED', status: 412 });
          }
        }
        const preparedShared = configStore.prepareUpdate(sharedConfigUpdates);
        await commitSetupConfigTransaction({
          configPath: configStore.path,
          householdConfigPath,
          sharedAfterBytes: preparedShared.bytes,
          householdAfterBytes: Buffer.from(`${JSON.stringify(activatedHouseholdConfig, null, 2)}\n`),
          setupMutationStep,
          latchSetupRecoveryFailure,
          assertSetupRecoveryHealthy,
        });
      });
      jsonResponse(res, reconfigure ? 200 : 201, {
        ok: true,
        status: reconfigure ? 'reconfigured' : 'activated',
        schemaVersion: activatedHouseholdConfig.schemaVersion,
      });
    } catch (error) {
      if (isSetupRecoveryRequiredError(error)) {
        jsonResponse(res, 503, setupRecoveryFailure());
        return;
      }
      if (error && typeof error === 'object' && error.recoveryError?.code === 'SETUP_CONFIG_RECOVERY_REQUIRED') {
        jsonResponse(res, 503, error.recoveryError);
        return;
      }
      if (error && typeof error === 'object' && error.code === 'CONFIG_PRECONDITION_FAILED') {
        jsonResponse(res, 412, {
          ok: false, code: 'CONFIG_PRECONDITION_FAILED',
          message: 'Eine Konfiguration wurde zwischen Vorprüfung und Commit geändert.',
        });
        return;
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

function createLaundryError(code, status, message, details = {}) {
  return Object.assign(new Error(message), { code, status, details });
}

function laundryPublicError(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return {
      status: Number.isInteger(error.status) ? error.status : 502,
      payload: {
        ok: false,
        code: error.code,
        message: typeof error.message === 'string' ? error.message : 'Die Wäsche-Konfiguration ist fehlgeschlagen.',
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
      },
    };
  }
  return {
    status: 502,
    payload: {
      ok: false,
      code: 'LAUNDRY_HOME_ASSISTANT_ERROR',
      message: 'Home Assistant konnte die Wäsche-Konfiguration nicht ausführen.',
    },
  };
}

function laundryExactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function laundryCanonical(value) {
  if (Array.isArray(value)) return value.map(laundryCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, laundryCanonical(value[key])]));
  }
  return value;
}

function laundryFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(laundryCanonical(value))).digest('hex');
}

function normalizeLaundryPowerUnit(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeLaundryEntityId(value, domains) {
  if (typeof value !== 'string' || value.length > 255) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(normalized)) return null;
  return domains.includes(normalized.split('.')[0]) ? normalized : null;
}

function normalizeLaundryStates(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return null;
  const states = value.map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase() : '');
  if (states.some((state) => !state || state.length > 128 || ['unknown', 'unavailable'].includes(state))) return null;
  return new Set(states).size === states.length ? states : null;
}

function normalizeExistingLaundryPayload(payload) {
  if (!laundryExactObject(payload, ['device', 'entityId', 'runningStates', 'doneStates', 'doneOnInitial'])) return null;
  if (!['washer', 'dryer'].includes(payload.device) || typeof payload.doneOnInitial !== 'boolean') return null;
  const entityId = normalizeLaundryEntityId(payload.entityId, ['input_boolean', 'input_select', 'binary_sensor', 'sensor', 'select']);
  const runningStates = normalizeLaundryStates(payload.runningStates);
  const doneStates = normalizeLaundryStates(payload.doneStates);
  if (!entityId || !runningStates || !doneStates || doneStates.some((state) => runningStates.includes(state))) return null;
  return {
    device: payload.device,
    adapter: { type: 'entity', entityId, runningStates, doneStates, doneOnInitial: payload.doneOnInitial },
  };
}

function normalizeBlueprintLaundryPayload(payload) {
  if (!laundryExactObject(payload, [
    'device', 'powerSensorEntityId', 'startThreshold', 'endThreshold', 'startHoldSeconds', 'endHoldSeconds',
  ])) return null;
  if (!['washer', 'dryer'].includes(payload.device)) return null;
  const powerSensorEntityId = normalizeLaundryEntityId(payload.powerSensorEntityId, ['sensor']);
  const numbers = ['startThreshold', 'endThreshold', 'startHoldSeconds', 'endHoldSeconds'];
  if (!powerSensorEntityId || numbers.some((key) => typeof payload[key] !== 'number' || !Number.isFinite(payload[key]))) return null;
  if (Math.abs(payload.startThreshold) > 1_000_000 || Math.abs(payload.endThreshold) > 1_000_000
      || payload.endThreshold >= payload.startThreshold
      || !Number.isInteger(payload.startHoldSeconds) || !Number.isInteger(payload.endHoldSeconds)
      || payload.startHoldSeconds < 1 || payload.startHoldSeconds > 3_600
      || payload.endHoldSeconds < 1 || payload.endHoldSeconds > 3_600) return null;
  return {
    device: payload.device,
    inputs: {
      powerSensorEntityId,
      startThreshold: payload.startThreshold,
      endThreshold: payload.endThreshold,
      startHoldSeconds: payload.startHoldSeconds,
      endHoldSeconds: payload.endHoldSeconds,
    },
  };
}

function readLaundryHouseholdSnapshot(path) {
  if (!path) throw createLaundryError('LAUNDRY_CONFIG_NOT_CONFIGURED', 503, 'Der Pfad zur Haushaltskonfiguration fehlt.');
  let bytes;
  try { bytes = readFileSync(path); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_UNREADABLE', 500, 'Die Haushaltskonfiguration konnte nicht gelesen werden.');
  }
  if (bytes.length > HOUSEHOLD_CONFIG_BODY_MAX) {
    throw createLaundryError('LAUNDRY_CONFIG_TOO_LARGE', 413, 'Die Haushaltskonfiguration ist größer als 1 MiB.');
  }
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'The household configuration is not valid JSON.');
  }
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die Haushaltskonfiguration ist ungültig.');
  try { projectActiveHouseholdData(compileHouseholdConfig(parsed.value)); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die Haushaltskonfiguration kann nicht aktiviert werden.');
  }
  return { bytes, document, parsed: parsed.value, fingerprint: laundryFingerprint(bytes.toString('base64')) };
}

function assertLaundryTargetUnchanged(session, snapshot) {
  const currentAdapter = snapshot.parsed.globalEntities.laundry[session.device] ?? null;
  if (laundryFingerprint(currentAdapter) !== session.previousAdapterFingerprint) {
    throw createLaundryError('LAUNDRY_CONFIG_CHANGED', 409, 'Der betroffene Wäsche-Adapter wurde seit der Prüfung geändert.');
  }
}

function writeLaundryAdapterAtomically(path, snapshot, device, adapter, replaceConfig = renameSync) {
  const document = structuredClone(snapshot.document);
  if (!document?.globalEntities?.laundry) {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Der Wäsche-Vertrag fehlt in der Haushaltskonfiguration.');
  }
  document.globalEntities.laundry[device] = adapter;
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die aktualisierte Haushaltskonfiguration ist ungültig.');
  try { projectActiveHouseholdData(compileHouseholdConfig(parsed.value)); } catch {
    throw createLaundryError('LAUNDRY_CONFIG_INVALID', 500, 'Die aktualisierte Haushaltskonfiguration kann nicht aktiviert werden.');
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.laundry.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flush: true });
    chmodSync(temporary, 0o600);
    replaceConfig(temporary, path);
    chmodSync(path, 0o600);
  } catch {
    try { unlinkSync(temporary); } catch { /* no incomplete activation remains */ }
    throw createLaundryError('LAUNDRY_CONFIG_WRITE_FAILED', 500, 'Die bisherige Haushaltskonfiguration blieb aktiv.');
  }
}

async function laundryWebSocketMessage(socket, timeoutMs, accept) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    const timeout = setTimeout(() => finish(createLaundryError(
      'LAUNDRY_HOME_ASSISTANT_TIMEOUT', 502, 'Home Assistant hat nicht rechtzeitig geantwortet.',
    )), timeoutMs);
    const onError = () => finish(createLaundryError(
      'LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 502, 'Home Assistant ist nicht erreichbar.',
    ));
    const onClose = () => finish(createLaundryError(
      'LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 502, 'Die Home-Assistant-Verbindung wurde beendet.',
    ));
    const onMessage = async (event) => {
      let text;
      try {
        text = typeof event.data === 'string' ? event.data
          : event.data instanceof Blob ? await event.data.text()
            : Buffer.from(event.data).toString('utf8');
        const message = JSON.parse(text);
        if (accept(message)) finish(null, message);
      } catch { /* unrelated or malformed frames are ignored until timeout */ }
    };
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
  });
}

export function createLaundryHomeAssistantClient({
  baseUrl,
  token,
  /* Im App-Modus liegt der interne WebSocket nicht unter `/api/websocket`,
     sondern wird vom Zugangsauflöser mitgeliefert. */
  websocketUrl = null,
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  timeoutMs = 5_000,
} = {}) {
  let socket = null;
  let candidateSocket = null;
  let nextId = 1;
  let connecting = null;
  const closedConnections = new WeakSet();
  function closeConnection(connection) {
    if (!connection || closedConnections.has(connection)) return;
    closedConnections.add(connection);
    try { connection.close(); } catch { /* best effort */ }
  }

  async function connect() {
    if (socket?.readyState === WebSocketImpl.OPEN) return socket;
    if (connecting) return connecting;
    const attempt = (async () => {
      let target;
      if (websocketUrl) {
        target = websocketUrl;
      } else {
        target = haRestUrl(baseUrl, 'api/websocket');
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      }
      const candidate = new WebSocketImpl(target);
      candidateSocket = candidate;
      try {
        const required = await laundryWebSocketMessage(candidate, timeoutMs, (message) => message?.type === 'auth_required');
        if (required.type !== 'auth_required') throw createLaundryError(
          'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
        );
        const authentication = laundryWebSocketMessage(candidate, timeoutMs, (message) => (
          message?.type === 'auth_ok' || message?.type === 'auth_invalid'
        ));
        candidate.send(JSON.stringify({ type: 'auth', access_token: token }));
        const authenticated = await authentication;
        if (authenticated.type !== 'auth_ok') throw createLaundryError(
          'LAUNDRY_HOME_ASSISTANT_AUTH_FAILED', 502, 'Home Assistant hat die serverseitige Anmeldung abgelehnt.',
        );
        socket = candidate;
        if (candidateSocket === candidate) candidateSocket = null;
        return socket;
      } catch (error) {
        if (candidateSocket === candidate) candidateSocket = null;
        closeConnection(candidate);
        throw error;
      }
    })();
    connecting = attempt;
    try { return await attempt; } finally { if (connecting === attempt) connecting = null; }
  }

  async function rest(method, path, body = undefined) {
    let response;
    try {
      response = await fetchImpl(haRestUrl(baseUrl, path), {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_UNREACHABLE', 502, 'Home Assistant ist nicht erreichbar.');
    }
    if (response.status === 401 || response.status === 403) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_AUTH_FAILED', 502, 'Home Assistant hat die serverseitige Anmeldung abgelehnt.');
    }
    let responseBody = null;
    const text = await response.text();
    if (Buffer.byteLength(text) > HOUSEHOLD_CONFIG_BODY_MAX) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
    }
    if (text) {
      try { responseBody = JSON.parse(text); } catch {
        throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
      }
    }
    return { status: response.status, body: responseBody };
  }

  async function ws(type, payload = {}) {
    const connection = await connect();
    const id = nextId;
    nextId += 1;
    const resultPromise = laundryWebSocketMessage(connection, timeoutMs, (message) => message?.id === id && message?.type === 'result');
    connection.send(JSON.stringify({ id, type, ...payload }));
    const message = await resultPromise;
    if (message.success !== true) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_COMMAND_FAILED', 502, 'Home Assistant hat den Wäsche-Befehl abgelehnt.');
    }
    return message.result;
  }

  function close() {
    const candidates = new Set([candidateSocket, socket].filter(Boolean));
    candidateSocket = null;
    socket = null;
    connecting = null;
    for (const connection of candidates) closeConnection(connection);
  }
  return { close, rest, ws };
}

async function laundryRest(client, method, path, body, allowedStatuses = [200]) {
  const result = await client.rest(method, path, body);
  if (!result || typeof result.status !== 'number' || !Object.hasOwn(result, 'body')) {
    throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
  }
  if (!allowedStatuses.includes(result.status)) {
    throw createLaundryError('LAUNDRY_HOME_ASSISTANT_HTTP_ERROR', 502, 'Home Assistant hat die Anfrage abgelehnt.');
  }
  return result;
}

async function readLaundrySource(client, entityId) {
  const stateResult = await laundryRest(client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404]);
  if (stateResult.status === 404) throw createLaundryError('LAUNDRY_SOURCE_MISSING', 422, 'Die Home-Assistant-Quelle wurde nicht gefunden.');
  const state = stateResult.body;
  if (!state || typeof state !== 'object' || state.entity_id !== entityId
      || typeof state.state !== 'string' || !state.attributes || typeof state.attributes !== 'object') {
    throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.');
  }
  if (['unknown', 'unavailable'].includes(state.state.toLowerCase())) {
    throw createLaundryError('LAUNDRY_SOURCE_UNAVAILABLE', 422, 'Die Home-Assistant-Quelle ist nicht verfügbar.');
  }
  let registry = null;
  try {
    const registryResult = await client.ws('config/entity_registry/get', { entity_id: entityId });
    if (registryResult && typeof registryResult === 'object' && registryResult.entity_id === entityId) {
      registry = registryResult;
    }
  } catch { /* Live state is authoritative; YAML entities need no registry row. */ }
  if (registry?.disabled_by) throw createLaundryError('LAUNDRY_SOURCE_UNAVAILABLE', 422, 'Die Home-Assistant-Quelle ist deaktiviert.');
  const attributes = state.attributes;
  const sourceFingerprint = laundryFingerprint({
    entityId,
    deviceClass: attributes.device_class ?? registry?.device_class ?? null,
    options: Array.isArray(attributes.options) ? attributes.options : null,
    unitOfMeasurement: normalizeLaundryPowerUnit(attributes.unit_of_measurement),
    registry: registry ? {
      unique_id: registry.unique_id ?? null,
      platform: registry.platform ?? null,
      config_entry_id: registry.config_entry_id ?? null,
      device_id: registry.device_id ?? null,
    } : null,
  });
  return { state, registry, sourceFingerprint };
}

function validateExistingLaundrySource(source, adapter) {
  const domain = adapter.entityId.split('.')[0];
  const allStates = [...adapter.runningStates, ...adapter.doneStates];
  if (domain === 'input_boolean' || domain === 'binary_sensor') {
    if (!['on', 'off'].includes(source.state.state.toLowerCase())
        || adapter.runningStates.length !== 1 || adapter.runningStates[0] !== 'on'
        || adapter.doneStates.length !== 1 || adapter.doneStates[0] !== 'off'
        || adapter.doneOnInitial) {
      throw createLaundryError('LAUNDRY_SOURCE_INCOMPATIBLE', 422, 'Binäre Quellen benötigen die explizite Zuordnung on → running und off → done.');
    }
    return;
  }
  const options = Array.isArray(source.state.attributes.options)
    ? source.state.attributes.options.filter((option) => typeof option === 'string').map((option) => option.toLowerCase())
    : null;
  const deviceClass = String(source.state.attributes.device_class ?? source.registry?.device_class ?? '').toLowerCase();
  if ((domain === 'sensor' && deviceClass !== 'enum') || !options || options.length === 0
      || !options.includes(source.state.state.toLowerCase())
      || allStates.some((state) => !options.includes(state))) {
    throw createLaundryError('LAUNDRY_SOURCE_INCOMPATIBLE', 422, 'Die Enum-Quelle enthält nicht alle ausgewählten Zustände.');
  }
}

function validatePowerLaundrySource(source) {
  const deviceClass = String(source.state.attributes.device_class ?? source.registry?.device_class ?? '').toLowerCase();
  const unit = normalizeLaundryPowerUnit(source.state.attributes.unit_of_measurement);
  if (deviceClass !== 'power' || !unit || !Number.isFinite(Number(source.state.state))) {
    throw createLaundryError('LAUNDRY_POWER_SOURCE_INCOMPATIBLE', 422, 'Die Quelle ist kein verfügbarer Leistungssensor mit numerischem Wert und Einheit.');
  }
  return unit;
}

function blueprintExists(result, path) {
  if (Array.isArray(result)) return result.some((entry) => entry === path || entry?.path === path);
  return Boolean(result && typeof result === 'object' && Object.hasOwn(result, path));
}

function inputSelectItems(result) {
  if (!Array.isArray(result)) throw createLaundryError(
    'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
  );
  return result;
}

function inputSelectOptionsMatch(value) {
  return Array.isArray(value) && laundryFingerprint(value) === laundryFingerprint(['idle', 'running', 'done']);
}

function createdInputSelect(result) {
  if (!result || typeof result !== 'object') return null;
  const id = typeof result.id === 'string' && /^[a-z0-9_]+$/.test(result.id) ? result.id : null;
  return id ? { id } : null;
}

function entityRegistryItems(result) {
  if (!Array.isArray(result)) throw createLaundryError(
    'LAUNDRY_HOME_ASSISTANT_INVALID_RESPONSE', 502, 'Home Assistant hat ungültig geantwortet.',
  );
  return result;
}

function registryEntityId(entry, domain) {
  return entry && typeof entry === 'object' && !entry.disabled_by
    ? normalizeLaundryEntityId(entry.entity_id, [domain])
    : null;
}

function helperRegistryMatches(entries, helperId) {
  return entries.filter((entry) => entry?.platform === 'input_select'
    && entry?.unique_id === helperId && registryEntityId(entry, 'input_select'));
}

function automationRegistryMatches(entries, automationId) {
  return entries.filter((entry) => entry?.platform === 'automation'
    && entry?.unique_id === automationId && registryEntityId(entry, 'automation'));
}

async function pollLaundryCleanup(operation, sleep, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { if (await operation()) return true; } catch (error) {
      if (isSetupRecoveryRequiredError(error)) throw error;
      // Cleanup remains conservative for ordinary HA read failures.
    }
    if (attempt + 1 < attempts) await sleep();
  }
  return false;
}

function verifyAutomationConfig(body, expected) {
  const useBlueprint = body?.use_blueprint;
  return Boolean(body && typeof body === 'object'
    && body.alias === expected.alias
    && body.description === expected.description
    && body.mode === expected.mode
    && useBlueprint?.path === LAUNDRY_BLUEPRINT_PATH
    && laundryFingerprint(useBlueprint.input) === laundryFingerprint(expected.use_blueprint.input));
}

function verifyLoadedAutomationConfig(body, expected) {
  return Boolean(body && typeof body === 'object'
    && laundryFingerprint(body) === laundryFingerprint(expected));
}

function canonicalLaundrySubstitution(input) {
  return {
    triggers: [
      {
        trigger: 'numeric_state', entity_id: input.power_sensor,
        above: input.start_threshold, for: { seconds: input.start_hold_seconds }, id: 'running',
      },
      {
        trigger: 'numeric_state', entity_id: input.power_sensor,
        below: input.end_threshold, for: { seconds: input.end_hold_seconds }, id: 'done',
      },
    ],
    actions: [{
      choose: [
        {
          conditions: [{ condition: 'trigger', id: ['running'] }],
          sequence: [{
            action: 'input_select.select_option',
            target: { entity_id: input.state_helper },
            data: { option: 'running' },
          }],
        },
        {
          conditions: [
            { condition: 'trigger', id: ['done'] },
            { condition: 'state', entity_id: input.state_helper, state: 'running' },
          ],
          sequence: [{
            action: 'input_select.select_option',
            target: { entity_id: input.state_helper },
            data: { option: 'done' },
          }],
        },
      ],
    }],
    mode: 'restart',
  };
}

async function inspectHelperOwnership(client, session, knownId = null) {
  const items = inputSelectItems(await client.ws('input_select/list'));
  const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
  const named = items.filter((entry) => entry?.name === session.helperName);
  if (named.length === 0) {
    const registryCollision = registry.some((entry) => (knownId && entry?.unique_id === knownId)
      || entry?.entity_id === session.expectedHelperEntityId);
    return registryCollision ? { status: 'unknown' } : { status: 'absent' };
  }
  if (named.length !== 1) return { status: 'unknown' };
  const item = named[0];
  const id = typeof item.id === 'string' && /^[a-z0-9_]+$/.test(item.id) ? item.id : null;
  if (!id || (knownId && id !== knownId) || !inputSelectOptionsMatch(item.options)
      || (item.initial !== undefined && item.initial !== null)) return { status: 'unknown' };
  const matches = helperRegistryMatches(registry, id);
  if (matches.length !== 1) return { status: 'pending' };
  const entityId = registryEntityId(matches[0], 'input_select');
  const state = await laundryRest(
    client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404],
  );
  if (state.status === 404) return { status: 'pending' };
  if (state.body?.entity_id !== entityId || !inputSelectOptionsMatch(state.body?.attributes?.options)
      || !['idle', 'running', 'done'].includes(state.body?.state)) return { status: 'unknown' };
  return { status: 'owned', helper: { id, entityId } };
}

async function resolveOwnedHelper(client, session, knownId, sleep, settleAbsent = false) {
  let latest = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await inspectHelperOwnership(client, session, knownId);
    if (latest.status === 'owned' || latest.status === 'unknown') return latest;
    if (latest.status === 'absent' && !settleAbsent) return latest;
    if (attempt + 1 < 20) await sleep();
  }
  return latest?.status === 'owned' || latest?.status === 'absent'
    ? latest
    : { status: 'unknown' };
}

async function inspectAutomationOwnership(
  client, session, expectedAutomation, expectedLoadedAutomation = null, verifyLoaded = true,
) {
  const config = await laundryRest(
    client, 'GET', `/api/config/automation/config/${session.automationId}`, undefined, [200, 404],
  );
  const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
  const matches = automationRegistryMatches(registry, session.automationId);
  if (config.status === 404) return matches.length === 0 ? { status: 'absent' } : { status: 'unknown' };
  if (!verifyAutomationConfig(config.body, expectedAutomation)) return { status: 'unknown' };
  if (!verifyLoaded) {
    const entityId = matches.length === 1 ? registryEntityId(matches[0], 'automation') : null;
    return { status: 'owned_config', automation: { id: session.automationId, entityId } };
  }
  if (matches.length !== 1) return { status: 'pending' };
  const entityId = registryEntityId(matches[0], 'automation');
  const state = await laundryRest(
    client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404],
  );
  if (state.status === 404) return { status: 'pending' };
  if (state.body?.entity_id !== entityId) {
    return { status: 'owned_invalid', automation: { id: session.automationId, entityId } };
  }
  let loaded;
  try { loaded = await client.ws('automation/config', { entity_id: entityId }); } catch { return { status: 'pending' }; }
  if (!expectedLoadedAutomation
      || !verifyLoadedAutomationConfig(loaded?.config, expectedLoadedAutomation)) {
    return { status: 'owned_invalid', automation: { id: session.automationId, entityId } };
  }
  return { status: 'owned', automation: { id: session.automationId, entityId } };
}

async function resolveOwnedAutomation(
  client, session, expectedAutomation, expectedLoadedAutomation, sleep, settleAbsent = false,
) {
  let latest = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    latest = await inspectAutomationOwnership(
      client, session, expectedAutomation, expectedLoadedAutomation,
    );
    if (['owned', 'owned_invalid', 'unknown'].includes(latest.status)) return latest;
    if (latest.status === 'absent' && !settleAbsent) return latest;
    if (attempt + 1 < 20) await sleep();
  }
  return latest ?? { status: 'unknown' };
}

function createLaundryCoordinator({
  configStore,
  connectionMode = HA_CONNECTION_MODE,
  householdConfigPath,
  clientFactory,
  replaceConfig,
  now,
  sleep,
  blueprintFile,
  configMutations,
  assertSetupRecoveryHealthy = () => undefined,
}) {
  const validations = new Map();
  const previews = new Map();
  const disablePreviews = new Map();
  const reservations = new Map();

  function localGeneration() {
    const household = readLaundryHouseholdSnapshot(householdConfigPath);
    const sharedBytes = configStore.responseBody();
    return {
      household,
      householdFingerprint: household.fingerprint,
      sharedFingerprint: createHash('sha256').update(configStore.exists() ? '1' : '0').update(sharedBytes).digest('hex'),
    };
  }

  function reserveApply(session) {
    return configMutations.run(() => {
      assertSetupRecoveryHealthy();
      const generation = localGeneration();
      assertLaundryTargetUnchanged(session, generation.household);
      assertSessionCredentialSnapshot(session);
      if (reservations.has(session.device)) {
        throw createLaundryError('LAUNDRY_TARGET_RESERVED', 409, 'Das Laundry-Ziel wird bereits geändert.');
      }
      const id = randomBytes(24).toString('base64url');
      reservations.set(session.device, id);
      return { id, ...generation };
    });
  }

  function finalReservedCommit(session, reservation, adapter) {
    return configMutations.run(() => {
      assertSetupRecoveryHealthy();
      if (reservations.get(session.device) !== reservation.id) {
        throw createLaundryError('LAUNDRY_TARGET_RESERVED', 409, 'Die Laundry-Reservierung ist nicht mehr gültig.');
      }
      const current = localGeneration();
      if (current.householdFingerprint !== reservation.householdFingerprint
          || current.sharedFingerprint !== reservation.sharedFingerprint) {
        throw createLaundryError('LAUNDRY_CONFIG_CHANGED', 409, 'Die lokale Konfiguration wurde während der Home-Assistant-Prüfung geändert.');
      }
      assertLaundryTargetUnchanged(session, current.household);
      assertSessionCredentialSnapshot(session);
      assertNoAdapterCollision(current.household, session.device, adapter.entityId);
      writeLaundryAdapterAtomically(householdConfigPath, current.household, session.device, adapter, replaceConfig);
    });
  }

  function releaseReservation(session, reservation) {
    return configMutations.run(() => {
      if (reservations.get(session.device) === reservation.id) reservations.delete(session.device);
    });
  }

  function credentialSnapshot() {
    const credentials = resolveServerHaAccess(configStore, connectionMode);
    if (!credentials) {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_NOT_CONFIGURED', 503, 'Home Assistant ist serverseitig nicht konfiguriert.');
    }
    return {
      credentials,
      identity: laundryFingerprint(credentials),
    };
  }

  function assertSessionCredentialSnapshot(session) {
    const current = credentialSnapshot();
    if (current.identity !== session.haCredentialIdentity) {
      throw createLaundryError('LAUNDRY_CONFIG_CHANGED', 409, 'Die Home-Assistant-Verbindung wurde seit der Prüfung geändert.');
    }
    return current;
  }

  function sessionBase(origin, snapshot, device, sourceFingerprint, haCredentialIdentity = null) {
    return {
      origin,
      device,
      sourceFingerprint,
      ...(haCredentialIdentity ? { haCredentialIdentity } : {}),
      householdFingerprint: snapshot.fingerprint,
      previousAdapterFingerprint: laundryFingerprint(snapshot.parsed.globalEntities.laundry[device] ?? null),
      expiresAt: now() + LAUNDRY_SESSION_TTL_MS,
    };
  }

  function putSession(map, session) {
    const id = randomBytes(32).toString('base64url');
    map.set(id, session);
    return id;
  }

  function takeSession(map, id, origin) {
    if (typeof id !== 'string' || id.length < 32) {
      throw createLaundryError('LAUNDRY_SESSION_INVALID', 409, 'Die Prüfung ist ungültig oder wurde bereits verwendet.');
    }
    const session = map.get(id);
    map.delete(id);
    if (!session || session.origin !== origin) {
      throw createLaundryError('LAUNDRY_SESSION_INVALID', 409, 'Die Prüfung ist ungültig oder wurde bereits verwendet.');
    }
    if (session.expiresAt <= now()) {
      throw createLaundryError('LAUNDRY_SESSION_EXPIRED', 409, 'Die Prüfung ist abgelaufen.');
    }
    return session;
  }

  async function withClient(snapshot, operation) {
    const client = clientFactory(snapshot.credentials);
    if (!client || typeof client.rest !== 'function' || typeof client.ws !== 'function') {
      throw createLaundryError('LAUNDRY_HOME_ASSISTANT_INVALID_CLIENT', 500, 'Der Home-Assistant-Client ist nicht verfügbar.');
    }
    try { return await operation(client); } finally { try { client.close?.(); } catch { /* best effort */ } }
  }

  function assertNoAdapterCollision(snapshot, device, entityId) {
    const otherDevice = device === 'washer' ? 'dryer' : 'washer';
    const other = snapshot.parsed.globalEntities.laundry[otherDevice];
    if (other?.entityId === entityId) {
      throw createLaundryError('LAUNDRY_TARGET_CONFLICT', 409, 'Die Quelle ist bereits dem anderen Wäschegerät zugeordnet.');
    }
  }

  async function validateExisting(input, origin) {
    const normalized = normalizeExistingLaundryPayload(input);
    if (!normalized) throw createLaundryError('LAUNDRY_INVALID_REQUEST', 400, 'Die Existing-Anfrage ist ungültig.');
    const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
    const currentAdapter = snapshot.parsed.globalEntities.laundry[normalized.device] ?? null;
    const adapter = currentAdapter?.entityId === normalized.adapter.entityId && currentAdapter.cycleMarkerEntityId
      ? { ...normalized.adapter, cycleMarkerEntityId: currentAdapter.cycleMarkerEntityId }
      : normalized.adapter;
    assertNoAdapterCollision(snapshot, normalized.device, adapter.entityId);
    const ha = credentialSnapshot();
    const source = await withClient(ha, async (client) => readLaundrySource(client, adapter.entityId));
    validateExistingLaundrySource(source, adapter);
    const validationId = putSession(validations, {
      ...sessionBase(origin, snapshot, normalized.device, source.sourceFingerprint, ha.identity),
      adapter,
    });
    return {
      ok: true,
      status: 'validated',
      validationId,
      expiresInSeconds: LAUNDRY_SESSION_TTL_MS / 1000,
      device: normalized.device,
      adapter,
      source: { entityId: adapter.entityId, name: source.state.attributes.friendly_name ?? adapter.entityId },
    };
  }

  async function applyExisting(input, origin) {
    if (!laundryExactObject(input, ['validationId', 'confirmed']) || input.confirmed !== true) {
      throw createLaundryError('LAUNDRY_CONFIRMATION_REQUIRED', 400, 'Die geprüfte Änderung muss ausdrücklich bestätigt werden.');
    }
    const session = takeSession(validations, input.validationId, origin);
    const reservation = await reserveApply(session);
    try {
      const ha = assertSessionCredentialSnapshot(session);
      const source = await withClient(ha, async (client) => readLaundrySource(client, session.adapter.entityId));
      validateExistingLaundrySource(source, session.adapter);
      if (source.sourceFingerprint !== session.sourceFingerprint) {
        throw createLaundryError('LAUNDRY_SOURCE_CHANGED', 409, 'Die Home-Assistant-Quelle wurde seit der Prüfung geändert.');
      }
      await finalReservedCommit(session, reservation, session.adapter);
      return {
        ok: true, status: 'configured', device: session.device,
        entityId: session.adapter.entityId, adapter: session.adapter,
      };
    } finally {
      await releaseReservation(session, reservation);
    }
  }

  async function previewDisable(input, origin) {
    if (!laundryExactObject(input, ['device']) || !['washer', 'dryer'].includes(input.device)) {
      throw createLaundryError('LAUNDRY_INVALID_REQUEST', 400, 'Die Disable-Anfrage ist ungültig.');
    }
    const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
    const adapter = snapshot.parsed.globalEntities.laundry[input.device] ?? null;
    const previewId = putSession(disablePreviews, sessionBase(origin, snapshot, input.device, null));
    return {
      ok: true,
      status: 'preview',
      previewId,
      expiresInSeconds: LAUNDRY_SESSION_TTL_MS / 1000,
      device: input.device,
      adapter,
    };
  }

  async function applyDisable(input, origin) {
    if (!laundryExactObject(input, ['previewId', 'confirmed']) || input.confirmed !== true) {
      throw createLaundryError('LAUNDRY_CONFIRMATION_REQUIRED', 400, 'Die geprüfte Deaktivierung muss ausdrücklich bestätigt werden.');
    }
    const session = takeSession(disablePreviews, input.previewId, origin);
    await configMutations.run(() => {
      assertSetupRecoveryHealthy();
      if (reservations.has(session.device)) {
        throw createLaundryError('LAUNDRY_TARGET_RESERVED', 409, 'Das Laundry-Ziel wird bereits geändert.');
      }
      const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
      assertLaundryTargetUnchanged(session, snapshot);
      if (snapshot.parsed.globalEntities.laundry[session.device] === null) return;
      writeLaundryAdapterAtomically(householdConfigPath, snapshot, session.device, null, replaceConfig);
    });
    return { ok: true, status: 'disabled', device: session.device, adapter: null };
  }

  async function previewBlueprint(input, origin) {
    const normalized = normalizeBlueprintLaundryPayload(input);
    if (!normalized) throw createLaundryError('LAUNDRY_INVALID_REQUEST', 400, 'Die Blueprint-Anfrage ist ungültig.');
    const snapshot = readLaundryHouseholdSnapshot(householdConfigPath);
    const ha = credentialSnapshot();
    const source = await withClient(ha, async (client) => readLaundrySource(client, normalized.inputs.powerSensorEntityId));
    const powerUnit = validatePowerLaundrySource(source);
    const suffix = randomBytes(6).toString('hex');
    const automationId = `hauser_${normalized.device}_laundry_${suffix}`;
    const automationAlias = `Hauser ${normalized.device} laundry ${suffix}`;
    const helperName = `Hauser ${normalized.device} laundry ${suffix}`;
    const expectedHelperId = `hauser_${normalized.device}_laundry_${suffix}`;
    const ownershipMarker = `hauser-laundry:${automationId}:${randomBytes(8).toString('hex')}`;
    const previewId = putSession(previews, {
      ...sessionBase(origin, snapshot, normalized.device, source.sourceFingerprint, ha.identity),
      inputs: normalized.inputs,
      automationId,
      automationAlias,
      expectedAutomationEntityId: `automation.${automationId}`,
      helperName,
      expectedHelperEntityId: `input_select.${expectedHelperId}`,
      ownershipMarker,
      powerUnit,
    });
    return {
      ok: true,
      status: 'preview',
      previewId,
      expiresInSeconds: LAUNDRY_SESSION_TTL_MS / 1000,
      device: normalized.device,
      blueprint: { path: LAUNDRY_BLUEPRINT_PATH },
      helper: {
        name: helperName,
        entityId: null,
        idAssignedBy: 'home_assistant_during_apply',
        options: ['idle', 'running', 'done'],
      },
      automation: {
        id: automationId,
        entityId: null,
        expectedEntityId: `automation.${automationId}`,
        entityIdStatus: 'expected_not_confirmed',
        alias: automationAlias,
      },
      inputs: { ...normalized.inputs, unitOfMeasurement: powerUnit },
    };
  }

  async function applyBlueprint(input, origin) {
    if (!laundryExactObject(input, ['previewId', 'confirmed']) || input.confirmed !== true) {
      throw createLaundryError('LAUNDRY_CONFIRMATION_REQUIRED', 400, 'Die geprüfte Änderung muss ausdrücklich bestätigt werden.');
    }
    const session = takeSession(previews, input.previewId, origin);
    const reservation = await reserveApply(session);
    let blueprintCreated = false;
      let blueprintGeneration = null;
      let helper = null;
      let automation = null;
      let expectedAutomation = null;
      let expectedLoadedAutomation = null;
      let helperWriteAttempted = false;
      let automationWriteAttempted = false;
      let client;
      try {
        const ha = assertSessionCredentialSnapshot(session);
        client = clientFactory(ha.credentials);
        const source = await readLaundrySource(client, session.inputs.powerSensorEntityId);
        validatePowerLaundrySource(source);
        if (source.sourceFingerprint !== session.sourceFingerprint) {
          throw createLaundryError('LAUNDRY_SOURCE_CHANGED', 409, 'Die Home-Assistant-Quelle wurde seit der Vorschau geändert.');
        }

        const blueprints = await client.ws('blueprint/list', { domain: 'automation' });
        const helperItems = inputSelectItems(await client.ws('input_select/list'));
        const registryBefore = entityRegistryItems(await client.ws('config/entity_registry/list'));
        const automationBefore = await laundryRest(
          client, 'GET', `/api/config/automation/config/${session.automationId}`, undefined, [200, 404],
        );
        const automationStateBefore = await laundryRest(
          client, 'GET', `/api/states/${encodeURIComponent(session.expectedAutomationEntityId)}`, undefined, [200, 404],
        );
        const helperStateBefore = await laundryRest(
          client, 'GET', `/api/states/${encodeURIComponent(session.expectedHelperEntityId)}`, undefined, [200, 404],
        );
        const expectedHelperId = session.expectedHelperEntityId.slice('input_select.'.length);
        const registryCollision = registryBefore.some((entry) => (
          entry?.entity_id === session.expectedAutomationEntityId
          || entry?.entity_id === session.expectedHelperEntityId
          || (entry?.platform === 'automation' && entry?.unique_id === session.automationId)
          || (entry?.platform === 'input_select' && entry?.unique_id === expectedHelperId)
        ));
        const helperCollision = helperItems.some((entry) => entry?.name === session.helperName
          || entry?.id === expectedHelperId);
        if (automationBefore.status !== 404 || automationStateBefore.status !== 404
            || helperStateBefore.status !== 404 || registryCollision || helperCollision) {
          throw createLaundryError('LAUNDRY_TARGET_CONFLICT', 409, 'Ein vorgesehenes Home-Assistant-Ziel existiert bereits.');
        }

        let yaml;
        try { yaml = readFileSync(blueprintFile, 'utf8'); } catch {
          throw createLaundryError('LAUNDRY_BLUEPRINT_MISSING', 500, 'Der mitgelieferte Wäsche-Blueprint fehlt.');
        }
        if (!blueprintExists(blueprints, LAUNDRY_BLUEPRINT_PATH)) {
          assertSetupRecoveryHealthy();
          await client.ws('blueprint/save', {
            domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, yaml, allow_override: false,
          });
          blueprintCreated = true;
          const generationInput = {
            power_sensor: session.inputs.powerSensorEntityId,
            state_helper: session.expectedHelperEntityId,
            start_threshold: session.inputs.startThreshold,
            end_threshold: session.inputs.endThreshold,
            start_hold_seconds: session.inputs.startHoldSeconds,
            end_hold_seconds: session.inputs.endHoldSeconds,
          };
          const generationReadback = await client.ws('blueprint/substitute', {
            domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, input: generationInput,
          });
          const expectedGeneration = canonicalLaundrySubstitution(generationInput);
          if (!generationReadback?.substituted_config
              || typeof generationReadback.substituted_config !== 'object'
              || !verifyLoadedAutomationConfig(generationReadback.substituted_config, expectedGeneration)) {
            throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Die gespeicherte Wäsche-Blueprintgeneration konnte nicht verifiziert werden.');
          }
          blueprintGeneration = {
            input: generationInput,
            fingerprint: laundryFingerprint(generationReadback.substituted_config),
          };
        }

        helperWriteAttempted = true;
        let helperCreate = null;
        let helperCreateError = null;
        try {
          assertSetupRecoveryHealthy();
          helperCreate = createdInputSelect(await client.ws('input_select/create', {
            name: session.helperName,
            options: ['idle', 'running', 'done'],
            icon: session.device === 'washer' ? 'mdi:washing-machine' : 'mdi:tumble-dryer',
          }));
        } catch (error) { helperCreateError = error; }
        assertSetupRecoveryHealthy();
        const helperOwnership = await resolveOwnedHelper(
          client, session, helperCreate?.id ?? null, sleep, Boolean(helperCreateError),
        );
        if (helperOwnership.status === 'owned') {
          helper = helperOwnership.helper;
        } else if (helperCreateError && helperOwnership.status === 'absent') {
          throw helperCreateError;
        } else if (helperOwnership.status === 'unknown') {
          throw createLaundryError('LAUNDRY_OUTCOME_UNKNOWN', 502, 'Das Ergebnis der Home-Assistant-Helper-Erstellung ist nicht eindeutig.', {
            status: 'outcome_unknown', target: { helperName: session.helperName },
          });
        } else {
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Home Assistant konnte den erzeugten Wäsche-Helper nicht verifizieren.');
        }

        const automationInput = {
          power_sensor: session.inputs.powerSensorEntityId,
          state_helper: helper.entityId,
          start_threshold: session.inputs.startThreshold,
          end_threshold: session.inputs.endThreshold,
          start_hold_seconds: session.inputs.startHoldSeconds,
          end_hold_seconds: session.inputs.endHoldSeconds,
        };
        expectedAutomation = {
          alias: session.automationAlias,
          description: `Hauser laundry automation ownership ${session.ownershipMarker}`,
          use_blueprint: { path: LAUNDRY_BLUEPRINT_PATH, input: automationInput },
          mode: 'restart',
        };
        const substituted = await client.ws('blueprint/substitute', {
          domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, input: automationInput,
        });
        const canonicalSubstitution = canonicalLaundrySubstitution(automationInput);
        if (!substituted?.substituted_config || typeof substituted.substituted_config !== 'object'
            || !verifyLoadedAutomationConfig(substituted.substituted_config, canonicalSubstitution)) {
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Der Wäsche-Blueprint konnte nicht strukturell verifiziert werden.');
        }
        expectedLoadedAutomation = {
          ...canonicalSubstitution,
          id: session.automationId,
          alias: session.automationAlias,
          description: expectedAutomation.description,
        };
        automationWriteAttempted = true;
        let automationWriteError = null;
        try {
          assertSetupRecoveryHealthy();
          await laundryRest(
            client, 'POST', `/api/config/automation/config/${session.automationId}`, expectedAutomation, [200, 201],
          );
        } catch (error) { automationWriteError = error; }
        assertSetupRecoveryHealthy();
        const automationOwnership = await resolveOwnedAutomation(
          client, session, expectedAutomation, expectedLoadedAutomation,
          sleep, Boolean(automationWriteError),
        );
        if (automationOwnership.status === 'owned') {
          automation = automationOwnership.automation;
        } else if (automationOwnership.status === 'owned_invalid') {
          automation = automationOwnership.automation;
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Die geladene Wäsche-Automation entspricht nicht dem erzeugten Objekt.');
        } else if (automationWriteError && automationOwnership.status === 'absent') {
          throw automationWriteError;
        } else if (automationOwnership.status === 'unknown') {
          throw createLaundryError('LAUNDRY_OUTCOME_UNKNOWN', 502, 'Das Ergebnis der Home-Assistant-Automationserstellung ist nicht eindeutig.', {
            status: 'outcome_unknown', target: { automationId: session.automationId },
          });
        } else {
          throw createLaundryError('LAUNDRY_VERIFICATION_FAILED', 502, 'Home Assistant konnte die erzeugte Wäsche-Automation nicht verifizieren.');
        }

        await finalReservedCommit(session, reservation, {
          type: 'entity', entityId: helper.entityId,
          runningStates: ['running'], doneStates: ['done'], doneOnInitial: true,
          cycleMarkerEntityId: automation.entityId,
        });
        return {
          ok: true,
          status: 'configured',
          device: session.device,
          helper: { id: helper.id, entityId: helper.entityId },
          automation: { id: session.automationId, entityId: automation.entityId },
          blueprint: { path: LAUNDRY_BLUEPRINT_PATH, created: blueprintCreated },
        };
      } catch (error) {
        assertSetupRecoveryHealthy();
        let cleanupFailed = false;
        let automationUncertain = false;
        let helperUncertain = false;

        if (client && automationWriteAttempted && expectedAutomation && !automation) {
          try {
            const ownership = await inspectAutomationOwnership(
              client, session, expectedAutomation, null, false,
            );
            if (ownership.status === 'owned_config') automation = ownership.automation;
            else if (ownership.status === 'unknown') automationUncertain = true;
          } catch { automationUncertain = true; }
        }
        if (client && helperWriteAttempted && !helper) {
          try {
            assertSetupRecoveryHealthy();
            const ownership = await resolveOwnedHelper(client, session, null, sleep, true);
            if (ownership.status === 'owned') helper = ownership.helper;
            else if (ownership.status === 'unknown') helperUncertain = true;
          } catch { helperUncertain = true; }
        }

        let automationGone = !automationWriteAttempted;
        if (client && automation) {
          try {
            const currentOwnership = expectedAutomation
              ? await inspectAutomationOwnership(
                client, session, expectedAutomation, expectedLoadedAutomation,
              )
              : { status: 'unknown' };
            if (currentOwnership.status === 'absent') {
              automationGone = true;
            } else if (!['owned', 'owned_invalid'].includes(currentOwnership.status)
                || (automation.entityId && currentOwnership.automation?.entityId !== automation.entityId)) {
              automationGone = false;
              cleanupFailed = true;
            } else {
              assertSetupRecoveryHealthy();
              await laundryRest(client, 'DELETE', `/api/config/automation/config/${session.automationId}`, undefined, [200, 204]);
              const entityIds = new Set([
                session.expectedAutomationEntityId,
                automation.entityId,
              ].filter(Boolean));
              assertSetupRecoveryHealthy();
              automationGone = await pollLaundryCleanup(async () => {
                assertSetupRecoveryHealthy();
                const config = await laundryRest(
                  client, 'GET', `/api/config/automation/config/${session.automationId}`, undefined, [200, 404],
                );
                const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
                if (config.status !== 404 || registry.some((entry) => entry?.unique_id === session.automationId
                    || entityIds.has(entry?.entity_id))) return false;
                for (const entityId of entityIds) {
                  const state = await laundryRest(
                    client, 'GET', `/api/states/${encodeURIComponent(entityId)}`, undefined, [200, 404],
                  );
                  if (state.status !== 404) return false;
                }
                return true;
              }, sleep);
              if (!automationGone) cleanupFailed = true;
            }
          } catch (cleanupError) {
            if (isSetupRecoveryRequiredError(cleanupError)) throw cleanupError;
            cleanupFailed = true;
          }
        } else if (automationUncertain) {
          automationGone = false;
        } else if (automationWriteAttempted) {
          automationGone = true;
        }

        let helperGone = !helperWriteAttempted;
        if (client && helper && automationGone) {
          try {
            const currentOwnership = await inspectHelperOwnership(client, session, helper.id);
            if (currentOwnership.status === 'absent') {
              helperGone = true;
            } else if (currentOwnership.status !== 'owned'
                || currentOwnership.helper?.id !== helper.id
                || currentOwnership.helper?.entityId !== helper.entityId) {
              helperGone = false;
              cleanupFailed = true;
            } else {
              assertSetupRecoveryHealthy();
              await client.ws('input_select/delete', { input_select_id: helper.id });
              assertSetupRecoveryHealthy();
              helperGone = await pollLaundryCleanup(async () => {
                assertSetupRecoveryHealthy();
                const items = inputSelectItems(await client.ws('input_select/list'));
                const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
                const state = await laundryRest(
                  client, 'GET', `/api/states/${encodeURIComponent(helper.entityId)}`, undefined, [200, 404],
                );
                return !items.some((entry) => entry?.id === helper.id || entry?.name === session.helperName)
                  && !registry.some((entry) => entry?.unique_id === helper.id || entry?.entity_id === helper.entityId)
                  && state.status === 404;
              }, sleep);
              if (!helperGone) cleanupFailed = true;
            }
          } catch (cleanupError) {
            if (isSetupRecoveryRequiredError(cleanupError)) throw cleanupError;
            cleanupFailed = true;
          }
        } else if (helperUncertain || !automationGone) {
          helperGone = false;
        } else if (helperWriteAttempted) {
          helperGone = true;
        }

        let blueprintGone = !blueprintCreated;
        if (client && blueprintCreated && automationGone && !automationUncertain) {
          let inUse = false;
          try {
            const registry = entityRegistryItems(await client.ws('config/entity_registry/list'));
            for (const entry of registry.filter((candidate) => candidate?.platform === 'automation'
              && registryEntityId(candidate, 'automation'))) {
              const loaded = await client.ws('automation/config', { entity_id: entry.entity_id });
              if (loaded?.config?.use_blueprint?.path === LAUNDRY_BLUEPRINT_PATH) {
                inUse = true;
                break;
              }
            }
          } catch { inUse = true; }
          if (!inUse) {
            try {
              const currentBlueprints = await client.ws('blueprint/list', { domain: 'automation' });
              const currentGeneration = blueprintGeneration && blueprintExists(currentBlueprints, LAUNDRY_BLUEPRINT_PATH)
                ? await client.ws('blueprint/substitute', {
                  domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH, input: blueprintGeneration.input,
                })
                : null;
              const generationMatches = Boolean(currentGeneration?.substituted_config
                && typeof currentGeneration.substituted_config === 'object'
                && laundryFingerprint(currentGeneration.substituted_config) === blueprintGeneration?.fingerprint);
              if (!generationMatches) {
                cleanupFailed = true;
              } else {
                assertSetupRecoveryHealthy();
                await client.ws('blueprint/delete', { domain: 'automation', path: LAUNDRY_BLUEPRINT_PATH });
                assertSetupRecoveryHealthy();
                blueprintGone = await pollLaundryCleanup(async () => {
                  assertSetupRecoveryHealthy();
                  return !blueprintExists(
                    await client.ws('blueprint/list', { domain: 'automation' }), LAUNDRY_BLUEPRINT_PATH,
                  );
                }, sleep);
                if (!blueprintGone) cleanupFailed = true;
              }
            } catch (cleanupError) {
              if (isSetupRecoveryRequiredError(cleanupError)) throw cleanupError;
              cleanupFailed = true;
            }
          } else {
            cleanupFailed = true;
          }
        } else if (blueprintCreated) {
          blueprintGone = false;
        }

        const remaining = {};
        if (automation && !automationGone) remaining.automationId = session.automationId;
        if (helper && !helperGone) remaining.inputSelectId = helper.id;
        if (blueprintCreated && !blueprintGone) remaining.blueprintPath = LAUNDRY_BLUEPRINT_PATH;
        if (error?.code === 'LAUNDRY_OUTCOME_UNKNOWN' || automationUncertain || helperUncertain) {
          throw createLaundryError('LAUNDRY_OUTCOME_UNKNOWN', 502, 'Das Ergebnis der Home-Assistant-Schreiboperation ist nicht eindeutig.', {
            status: 'outcome_unknown',
            ...(Object.keys(remaining).length ? { remaining } : {}),
            target: error?.details?.target ?? { automationId: session.automationId, helperName: session.helperName },
          });
        }
        if (cleanupFailed || Object.keys(remaining).length) {
          throw createLaundryError('LAUNDRY_PARTIAL_FAILURE', 502, 'Home Assistant konnte nicht vollständig zurückgerollt werden.', {
            status: 'partial_failure', remaining,
          });
        }
        throw error;
      } finally {
        try { client?.close?.(); } catch { /* best effort */ }
        await releaseReservation(session, reservation);
      }
  }

  return {
    applyBlueprint,
    applyDisable,
    applyExisting,
    previewBlueprint,
    previewDisable,
    validateExisting,
  };
}

function serveLaundry(req, res, coordinator, route, origin) {
  if (req.method !== 'POST') {
    jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Die Wäsche-Route unterstützt ausschließlich POST.' }, { allow: 'POST' });
    return;
  }
  const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';', 1)[0].trim();
  if (contentType !== 'application/json') {
    jsonResponse(res, 415, { ok: false, code: 'LAUNDRY_CONTENT_TYPE_REQUIRED', message: 'Die Wäsche-Route erwartet application/json.' });
    return;
  }
  let body = '';
  let oversized = false;
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > LAUNDRY_BODY_MAX) oversized = true;
  });
  req.on('end', async () => {
    if (oversized) {
      jsonResponse(res, 413, { ok: false, code: 'LAUNDRY_REQUEST_TOO_LARGE', message: 'Die Wäsche-Anfrage ist zu groß.' });
      return;
    }
    let payload;
    try { payload = JSON.parse(body); } catch {
      jsonResponse(res, 400, { ok: false, code: 'LAUNDRY_INVALID_JSON', message: 'Die Wäsche-Anfrage enthält kein gültiges JSON.' });
      return;
    }
    try {
      const handlers = {
        '/api/laundry/existing/validate': coordinator.validateExisting,
        '/api/laundry/existing/apply': coordinator.applyExisting,
        '/api/laundry/blueprint/preview': coordinator.previewBlueprint,
        '/api/laundry/blueprint/apply': coordinator.applyBlueprint,
        '/api/laundry/disable/preview': coordinator.previewDisable,
        '/api/laundry/disable/apply': coordinator.applyDisable,
      };
      const result = await handlers[route](payload, origin);
      jsonResponse(res, 200, result);
    } catch (error) {
      const response = laundryPublicError(error);
      jsonResponse(res, response.status, response.payload);
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

class RoomImageRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function roomImageJsonResponse(req, res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(JSON.stringify(payload));
}

function roomImageError(req, res, status, code, message, headers = {}) {
  roomImageJsonResponse(req, res, status, { ok: false, code, message, retryable: false }, headers);
}

function authorizeRoomImage(req, res, authConfig, allowedOrigins, requireOrigin) {
  if (!authConfig?.configured) {
    roomImageError(req, res, 503, 'AUTH_BOUNDARY_MISSING', 'Die Room-Image-Autorisierungsgrenze ist nicht vollständig konfiguriert.');
    return null;
  }
  if (authConfig.mode === 'direct') {
    if (requireOrigin && !allowedRoomImageOrigin(req, allowedOrigins)) {
      roomImageError(req, res, 403, 'ORIGIN_FORBIDDEN', 'Die Room-Image-Anfrage stammt nicht von einer freigegebenen Origin.');
      return null;
    }
    return 'direct-household';
  }
  if (!roomImagePeerAllowed(req.socket.remoteAddress, authConfig.cidrs)) {
    roomImageError(req, res, 403, 'ROOM_IMAGE_AUTH_FORBIDDEN', 'Der unmittelbare Proxy-Peer ist nicht freigegeben.');
    return null;
  }
  const identity = normalizedRoomImageIdentity(req, authConfig.identityHeader);
  if (!identity) {
    roomImageError(req, res, 401, 'ROOM_IMAGE_AUTH_REQUIRED', 'Eine eindeutige vertrauenswürdige Benutzeridentität ist erforderlich.');
    return null;
  }
  if (requireOrigin && !allowedRoomImageOrigin(req, allowedOrigins)) {
    roomImageError(req, res, 403, 'ORIGIN_FORBIDDEN', 'Die Room-Image-Anfrage stammt nicht von einer freigegebenen Origin.');
    return null;
  }
  return identity;
}

function roomImageBaseCapability(authConfig, testCapability, credentialStatus = null) {
  const test = testCapability && typeof testCapability === 'object' ? testCapability : null;
  const releaseEnabled = test ? test.releaseEnabled === true : ROOM_IMAGE_WIZARD_ENABLED;
  if (!releaseEnabled) return { enabled: false, imageCapability: 'disabled', reasonCode: 'FEATURE_DISABLED' };
  if (!authConfig?.configured) return { enabled: false, imageCapability: 'disabled', reasonCode: 'AUTH_BOUNDARY_MISSING' };
  const credentialConfigured = test && Object.hasOwn(test, 'credentialConfigured')
    ? test.credentialConfigured === true : credentialStatus?.configured === true;
  if (!credentialConfigured) {
    return { enabled: false, imageCapability: 'disabled', reasonCode: 'CREDENTIAL_MISSING' };
  }
  if (test?.ready === true) return { enabled: true, imageCapability: 'ready', reasonCode: null };
  return { enabled: true, imageCapability: 'unverified', reasonCode: 'UNVERIFIED' };
}

function roomImagePrivateDetails(testCapability, probeState = null, credentialStatus = null) {
  const testedCredential = testCapability && typeof testCapability === 'object'
      && Object.hasOwn(testCapability, 'credentialConfigured')
    ? testCapability.credentialConfigured === true : null;
  const credentialConfigured = testedCredential ?? credentialStatus?.configured === true ?? probeState?.credentialConfigured === true;
  const checked = typeof probeState?.probe?.checkedAt === 'string';
  return {
    enabled: ROOM_IMAGE_WIZARD_ENABLED && Boolean(credentialConfigured),
    provider: 'openai',
    credentialConfigured,
    credentialSource: credentialStatus?.source ?? (credentialConfigured ? 'environment' : null),
    credentialMode: credentialStatus?.mode ?? (credentialConfigured ? 'api_key' : null),
    imageCapability: checked ? probeState.imageCapability : credentialConfigured ? 'unverified' : 'credential_missing',
    reasonCode: credentialConfigured ? null : 'CREDENTIAL_MISSING',
    model: credentialStatus?.mode === 'chatgpt' ? 'gpt-image-2' : ROOM_IMAGE_PROVIDER_MODEL,
    probe: checked ? { ...probeState.probe } : { modelVisible: false, checkedAt: null },
    limits: {
      maxUploadBytes: ROOM_IMAGE_UPLOAD_MAX_BYTES,
      maxDecodedPixels: ROOM_IMAGE_TRANSFORM_POLICY_V1.maxDecodedPixels,
      maxMainCandidates: 2,
      maxConcurrentProviderCalls: 1,
      maxQueuedJobs: 3,
    },
  };
}

async function serveRoomImageProbe(req, res, { jobRunner, now, probeState, testCapability, credentialStore }) {
  const credentialStatus = credentialStore?.status?.() ?? null;
  if (!jobRunner || !probeState) {
    roomImageJsonResponse(req, res, 200, roomImagePrivateDetails(testCapability, probeState, credentialStatus));
    return;
  }
  let imageCapability;
  let modelVisible = false;
  try {
    const result = await jobRunner.probe();
    if (result?.definitiveResponse === true && result.status === 200 && result.modelVisible === true) {
      imageCapability = 'unverified';
      modelVisible = true;
    } else if (result?.definitiveResponse === true && result.status === 401) {
      imageCapability = 'credential_invalid';
    } else if (result?.definitiveResponse === true && result.status === 403) {
      imageCapability = 'forbidden';
    } else {
      imageCapability = 'unreachable';
    }
  } catch {
    imageCapability = probeState.credentialConfigured ? 'unreachable' : 'credential_missing';
  }
  probeState.imageCapability = imageCapability;
  probeState.probe = { modelVisible, checkedAt: new Date(now()).toISOString() };
  roomImageJsonResponse(req, res, 200, roomImagePrivateDetails(testCapability, probeState, credentialStatus));
}

async function serveRoomImageAccess(req, res, pathname, credentialStore) {
  try {
    if (!credentialStore) throw new RoomImageRequestError(503, 'ROOM_IMAGE_ACCESS_UNAVAILABLE', 'Die Zugangskonfiguration ist nicht verfügbar.');
    if (pathname === '/api/room-images/access') {
      if (req.method === 'GET') {
        roomImageJsonResponse(req, res, 200, credentialStore.status());
      } else if (req.method === 'DELETE') {
        roomImageJsonResponse(req, res, 200, credentialStore.clear());
      } else {
        roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Der Zugang erlaubt nur GET und DELETE.', { allow: 'GET, DELETE' });
      }
      return;
    }
    const payload = await readRoomImageJsonBody(req);
    if (pathname === '/api/room-images/access/api-key') {
      roomImageJsonResponse(req, res, 200, credentialStore.setApiKey(payload.apiKey));
    } else if (pathname === '/api/room-images/access/chatgpt/start') {
      roomImageJsonResponse(req, res, 200, await credentialStore.beginChatGptLogin());
    } else if (pathname === '/api/room-images/access/chatgpt/poll') {
      if (!payload || typeof payload.loginId !== 'string' || !ROOM_IMAGE_ID_PATTERN.test(payload.loginId)) {
        throw new RoomImageRequestError(400, 'CHATGPT_LOGIN_INVALID', 'Die ChatGPT-Anmeldung ist ungültig.');
      }
      roomImageJsonResponse(req, res, 200, await credentialStore.pollChatGptLogin(payload.loginId));
    }
  } catch (error) {
    if (error instanceof RoomImageRequestError) roomImageError(req, res, error.status, error.code, error.message);
    else roomImageError(req, res, 500, 'ROOM_IMAGE_ACCESS_FAILED', 'Der KI-Zugang konnte nicht geändert werden.');
  }
}

function roomImageLengthFailure(status, code, message) {
  return {
    ok: false,
    status,
    payload: { ok: false, code, message, retryable: false },
  };
}

export function parseRoomImageContentLength(rawHeaders, maxBytes = ROOM_IMAGE_UPLOAD_MAX_BYTES) {
  const values = rawHeaderValues({ rawHeaders }, 'content-length');
  if (values.length === 0) {
    return roomImageLengthFailure(
      411,
      'CONTENT_LENGTH_REQUIRED',
      'Content-Length ist für Bild-Uploads erforderlich.',
    );
  }
  if (values.length !== 1 || !/^(?:0|[1-9]\d*)$/.test(values[0])) {
    return roomImageLengthFailure(
      400,
      'INVALID_CONTENT_LENGTH',
      'Content-Length ist ungültig oder inkohärent.',
    );
  }
  const length = Number(values[0]);
  if (!Number.isSafeInteger(length) || length < 0) {
    return roomImageLengthFailure(
      400,
      'INVALID_CONTENT_LENGTH',
      'Content-Length ist ungültig oder inkohärent.',
    );
  }
  if (length > maxBytes) {
    return roomImageLengthFailure(
      413,
      'UPLOAD_TOO_LARGE',
      'Das Bild überschreitet die Uploadgrenze von 12 MiB.',
    );
  }
  return { ok: true, length };
}

function roomImageFormatForMime(mimeType, bytes) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const png = bytes.length >= pngSignature.length
    && pngSignature.every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP';
  const avif = bytes.length >= 16
    && Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'
    && ['avif', 'avis'].includes(Buffer.from(bytes.subarray(8, 12)).toString('ascii'));
  const matches = (mimeType === 'image/jpeg' && jpeg)
    || (mimeType === 'image/png' && png)
    || (mimeType === 'image/webp' && webp)
    || (mimeType === 'image/avif' && avif);
  if (!matches) throw new RoomImageRequestError(415, 'IMAGE_TYPE_MISMATCH', 'MIME-Typ und Bildsignatur stimmen nicht überein.');
  if (mimeType === 'image/jpeg') return 'jpeg';
  if (mimeType === 'image/avif') return 'avif';
  return mimeType.slice('image/'.length);
}

export function readBoundedRoomImageBody(
  req,
  declaredLength,
  maxBytes = ROOM_IMAGE_UPLOAD_MAX_BYTES,
) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
      req.off('error', onError);
    };
    const reject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    };
    const onData = (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += bytes.byteLength;
      if (received > maxBytes) {
        reject(new RoomImageRequestError(413, 'UPLOAD_TOO_LARGE', 'Das Bild überschreitet die Uploadgrenze von 12 MiB.'));
        return;
      }
      if (received > declaredLength) {
        reject(new RoomImageRequestError(400, 'CONTENT_LENGTH_MISMATCH', 'Die tatsächliche Uploadlänge stimmt nicht mit Content-Length überein.'));
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      if (received !== declaredLength || req.complete === false) {
        reject(new RoomImageRequestError(400, 'CONTENT_LENGTH_MISMATCH', 'Die tatsächliche Uploadlänge stimmt nicht mit Content-Length überein.'));
        return;
      }
      settled = true;
      cleanup();
      resolvePromise(Buffer.concat(chunks, received));
    };
    const onAborted = () => reject(new RoomImageRequestError(400, 'UPLOAD_ABORTED', 'Der Bild-Upload wurde vorzeitig abgebrochen.'));
    const onError = () => reject(new RoomImageRequestError(400, 'UPLOAD_ABORTED', 'Der Bild-Upload wurde vorzeitig abgebrochen.'));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('aborted', onAborted);
    req.on('error', onError);
  });
}

async function serveRoomImageUpload(req, res, identity, uploadStore, assertSetupRecoveryHealthy) {
  try {
    const contentTypes = rawHeaderValues(req, 'content-type');
    const mimeType = contentTypes.length === 1 ? contentTypes[0] : '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new RoomImageRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Nur exaktes image/jpeg, image/png oder image/webp ist erlaubt.');
    }
    const contentLength = parseRoomImageContentLength(req.rawHeaders);
    if (!contentLength.ok) {
      roomImageJsonResponse(req, res, contentLength.status, contentLength.payload);
      return;
    }
    const original = await readBoundedRoomImageBody(req, contentLength.length);
    const expectedFormat = roomImageFormatForMime(mimeType, original);
    const normalized = await normalizeUploadedRoomImage(original, expectedFormat);
    assertSetupRecoveryHealthy();
    const stored = uploadStore.create(identity, { ...normalized, mimeType });
    roomImageJsonResponse(req, res, 201, stored);
  } catch (error) {
    if (res.writableEnded || res.destroyed) return;
    if (isSetupRecoveryRequiredError(error)) {
      roomImageError(req, res, 503, 'SETUP_CONFIG_RECOVERY_REQUIRED', setupRecoveryFailure().message);
      return;
    }
    if (error instanceof RoomImageRequestError) {
      roomImageError(req, res, error.status, error.code, error.message);
      return;
    }
    if (error instanceof RoomImageUploadStoreError) {
      roomImageError(req, res, 500, error.code, 'Temporäre Uploaddaten konnten nicht sicher verarbeitet werden.');
      return;
    }
    if (error instanceof RoomImageTransformError) {
      const unsupported = ['UNSUPPORTED_IMAGE_FORMAT', 'ANIMATED_IMAGE_NOT_ALLOWED'].includes(error.code);
      roomImageError(req, res, unsupported ? 415 : 422, error.code, unsupported
        ? 'Das Bildformat oder eine Animation ist nicht erlaubt.'
        : 'Das Bild konnte nicht nach der Transformationspolicy verarbeitet werden.');
      return;
    }
    if (/pixel limit|exceeds.*pixels|image exceeds/i.test(error instanceof Error ? error.message : '')) {
      roomImageError(req, res, 413, 'IMAGE_PIXEL_LIMIT_EXCEEDED', 'Das Bild überschreitet die Grenze von 24.000.000 dekodierten Pixeln.');
      return;
    }
    roomImageError(req, res, 422, 'IMAGE_DECODE_FAILED', 'Das Bild konnte nicht sicher dekodiert werden.');
  }
}

function manualRoomBackgroundOriginAllowed(req, allowedOrigins) {
  return allowedRoomImageOrigin(req, allowedOrigins);
}

async function decodeManualRoomBackground(req) {
  const contentTypes = rawHeaderValues(req, 'content-type');
  const mimeType = contentTypes.length === 1 ? contentTypes[0] : '';
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mimeType)) {
    throw new RoomImageRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Nur JPEG, PNG, WebP oder AVIF ist erlaubt.');
  }
  const contentLength = parseRoomImageContentLength(req.rawHeaders);
  if (!contentLength.ok) {
    throw new RoomImageRequestError(contentLength.status, contentLength.payload.code, contentLength.payload.message);
  }
  const original = await readBoundedRoomImageBody(req, contentLength.length);
  const expectedFormat = roomImageFormatForMime(mimeType, original);
  const normalized = await normalizeUploadedRoomImage(original, expectedFormat);
  return providerPngToFinalAvif(normalized.buffer);
}

function validRoomImagePoint(value) {
  return roomImageExactObject(value, ['x', 'y'])
    && ['x', 'y'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1);
}

function validRoomImageFocus(value) {
  return roomImageExactObject(value, ['panel', 'phone'])
    && validRoomImagePoint(value.panel) && validRoomImagePoint(value.phone);
}

function normalizeRoomImageJobRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.kind === 'main_candidates') {
    if (!roomImageExactObject(payload, [
      'kind', 'clientRequestId', 'uploadId', 'crop', 'canonicalCropPixels', 'focus',
      'stylePreset', 'adjustments', 'candidateCount', 'noticeVersion', 'costConfirmed',
      'confirmedProviderCalls',
    ])
        || !ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN.test(payload.clientRequestId || '')
        || !ROOM_IMAGE_ID_PATTERN.test(payload.uploadId || '')
        || !roomImageExactObject(payload.crop, ['x', 'y', 'width', 'height'])
        || !['x', 'y', 'width', 'height'].every((key) => typeof payload.crop[key] === 'number' && Number.isFinite(payload.crop[key]))
        || payload.crop.x < 0 || payload.crop.y < 0 || payload.crop.width < 0.2 || payload.crop.height < 0.2
        || payload.crop.x + payload.crop.width > 1 || payload.crop.y + payload.crop.height > 1
        || !roomImageExactObject(payload.canonicalCropPixels, ['x', 'y', 'width', 'height'])
        || !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(payload.canonicalCropPixels[key]) && payload.canonicalCropPixels[key] >= 0)
        || !validRoomImageFocus(payload.focus)
        || !roomImageExactObject(payload.adjustments, ['declutter', 'tone', 'preserveFeatures'])
        || ![1, 2].includes(payload.candidateCount)
        || payload.noticeVersion !== 'room-image-v1' || payload.costConfirmed !== true
        || payload.confirmedProviderCalls !== payload.candidateCount + 1) return null;
    try {
      validateRoomImagePromptSpec({
        stylePreset: payload.stylePreset,
        declutter: payload.adjustments.declutter,
        tone: payload.adjustments.tone,
        preserveFeatures: payload.adjustments.preserveFeatures,
      });
    } catch { return null; }
    return structuredClone(payload);
  }
  if (payload.kind === 'variant_set') {
    if (!roomImageExactObject(payload, [
      'kind', 'clientRequestId', 'parentJobId', 'candidateId', 'focus', 'noticeVersion',
      'costConfirmed', 'confirmedProviderCalls',
    ])
        || !ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN.test(payload.clientRequestId || '')
        || !ROOM_IMAGE_ID_PATTERN.test(payload.parentJobId || '')
        || !ROOM_IMAGE_ID_PATTERN.test(payload.candidateId || '')
        || !validRoomImageFocus(payload.focus)
        || payload.noticeVersion !== 'room-image-v1' || payload.costConfirmed !== true
        || payload.confirmedProviderCalls !== 2) return null;
    return structuredClone(payload);
  }
  return null;
}

function normalizeRoomImageRetryRequest(payload) {
  return roomImageExactObject(payload, ['clientRequestId', 'noticeVersion', 'costConfirmed', 'confirmedProviderCalls'])
    && ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN.test(payload.clientRequestId || '')
    && payload.noticeVersion === 'room-image-v1' && payload.costConfirmed === true
    && Number.isInteger(payload.confirmedProviderCalls) && [1, 2, 3].includes(payload.confirmedProviderCalls)
    ? structuredClone(payload) : null;
}

function readRoomImageJsonBody(req, { allowEmpty = false, maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const contentTypes = rawHeaderValues(req, 'content-type');
    const declaredEmpty = rawHeaderValues(req, 'content-length').length === 1
      && rawHeaderValues(req, 'content-length')[0] === '0';
    if (allowEmpty && (declaredEmpty || (contentTypes.length === 0 && !req.headers['transfer-encoding']))) {
      req.resume(); resolvePromise({}); return;
    }
    if (contentTypes.length !== 1 || contentTypes[0].toLowerCase() !== 'application/json') {
      rejectPromise(new RoomImageRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Die Room-Image-Anfrage erwartet exaktes application/json.'));
      return;
    }
    let body = '';
    let oversized = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (oversized) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) oversized = true;
    });
    req.on('end', () => {
      if (oversized) {
        rejectPromise(new RoomImageRequestError(413, 'INVALID_REQUEST', 'Die Room-Image-Anfrage ist zu groß.'));
        return;
      }
      if (!body && allowEmpty) { resolvePromise({}); return; }
      try { resolvePromise(JSON.parse(body)); } catch {
        rejectPromise(new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Anfrage enthält kein gültiges JSON.'));
      }
    });
    req.on('aborted', () => rejectPromise(new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Anfrage wurde abgebrochen.')));
    req.on('error', () => rejectPromise(new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Anfrage konnte nicht gelesen werden.')));
  });
}

function roomImageHandleAsyncError(req, res, error) {
  if (res.writableEnded || res.destroyed) return;
  if (isSetupRecoveryRequiredError(error)) {
    roomImageError(req, res, 503, 'SETUP_CONFIG_RECOVERY_REQUIRED', setupRecoveryFailure().message); return;
  }
  if (error instanceof RoomImageRequestError) {
    roomImageError(req, res, error.status, error.code, error.message); return;
  }
  const simulatedCrash = error && typeof error === 'object'
    && (error.simulateCrash === true || error.cause?.simulateCrash === true);
  if (error instanceof RoomImageJobStoreError || error instanceof RoomImageUploadStoreError
      || (error instanceof RoomImageAssetStoreError && !simulatedCrash)) {
    roomImageError(req, res, 503, error.code, 'Der Room-Image-Store ist nicht sicher verfügbar.'); return;
  }
  roomImageError(req, res, 500, 'ROOM_IMAGE_JOB_FAILED', 'Der Room-Image-Job konnte nicht sicher verarbeitet werden.');
}

async function serveRoomImageJobCreate(req, res, identity, uploadStore, jobStore, runner, assertSetupRecoveryHealthy) {
  try {
    const payload = normalizeRoomImageJobRequest(await readRoomImageJsonBody(req));
    assertSetupRecoveryHealthy();
    if (!payload) throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Room-Image-Jobanfrage ist ungültig.');
    const fingerprint = roomImageFingerprint(payload);
    const idempotent = jobStore.idempotent(identity, payload.clientRequestId, fingerprint);
    if (idempotent?.type === 'replay') {
      roomImageJsonResponse(req, res, 200, jobStore.publicJob(idempotent.record)); return;
    }
    if (idempotent?.type === 'conflict') {
      throw new RoomImageRequestError(409, 'IDEMPOTENCY_CONFLICT', 'Die Client-Request-ID wurde bereits mit anderer Semantik verwendet.');
    }
    if (payload.kind === 'main_candidates') {
      const upload = uploadStore.inspectOwn?.(identity, payload.uploadId);
      if (!upload) throw new RoomImageRequestError(404, 'ROOM_IMAGE_UPLOAD_NOT_FOUND', 'Der Upload wurde nicht gefunden.');
      let snapped;
      try { snapped = snapRoomImageCrop(upload.width, upload.height, payload.crop); } catch {
        throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Der Crop ist ungültig.');
      }
      const supplied = payload.canonicalCropPixels;
      if (supplied.x !== snapped.left || supplied.y !== snapped.top
          || supplied.width !== snapped.width || supplied.height !== snapped.height) {
        throw new RoomImageRequestError(409, 'CROP_POLICY_MISMATCH', 'Der kanonische Crop entspricht nicht der Serverpolicy.');
      }
      const reservation = runner.reserve();
      if (!reservation) throw new RoomImageRequestError(429, 'ROOM_IMAGE_QUEUE_FULL', 'Die Room-Image-Queue ist ausgelastet.');
      try {
        const binding = await uploadStore.bindForJob(identity, payload.uploadId);
        if (!binding) {
          const raced = jobStore.idempotent(identity, payload.clientRequestId, fingerprint);
          if (raced?.type === 'replay') {
            roomImageJsonResponse(req, res, 200, jobStore.publicJob(raced.record));
            return;
          }
          if (raced?.type === 'conflict') {
            throw new RoomImageRequestError(409, 'IDEMPOTENCY_CONFLICT', 'Die Client-Request-ID wurde parallel mit anderer Semantik verwendet.');
          }
          throw new RoomImageRequestError(404, 'ROOM_IMAGE_UPLOAD_NOT_FOUND', 'Der Upload wurde nicht gefunden.');
        }
        let createdMain = null;
        let result;
        try {
          result = await binding.materializeProviderJpeg(payload.crop, async (source) => {
            const handoff = jobStore.createMain(identity, payload, source, fingerprint);
            if (handoff.type === 'created') createdMain = handoff.record;
            return handoff;
          });
        } catch (error) {
          if (createdMain) {
            const rolledBack = jobStore.rollbackCreatedMain(createdMain.jobId);
            if (rolledBack && typeof binding.restoreAfterRollback === 'function') {
              await binding.restoreAfterRollback();
            }
          }
          throw error;
        }
        if (result.type !== 'created') {
          if (result.type === 'replay') roomImageJsonResponse(req, res, 200, jobStore.publicJob(result.record));
          else throw new RoomImageRequestError(409, 'IDEMPOTENCY_CONFLICT', 'Die Client-Request-ID steht in Konflikt.');
          return;
        }
        if (!runner.enqueue(result.record.jobId, reservation)) {
          throw new RoomImageRequestError(503, 'ROOM_IMAGE_JOB_FAILED', 'Der Room-Image-Job konnte nicht sicher eingereiht werden.');
        }
        roomImageJsonResponse(req, res, 202, jobStore.publicJob(result.record));
        return;
      } finally {
        reservation.release();
      }
    }
    let parent = null;
    if (idempotent?.type !== 'pending') {
      parent = jobStore.getOwn(identity, payload.parentJobId);
      if (parent?.status === 'expired') {
        throw new RoomImageRequestError(410, 'SOURCE_PREVIEW_EXPIRED', 'Der ausgewählte Candidate ist abgelaufen.');
      }
      if (!parent || parent.kind !== 'main_candidates' || parent.status !== 'succeeded') {
        throw new RoomImageRequestError(404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Parentjob wurde nicht gefunden.');
      }
    }
    const reservation = runner.reserve();
    if (!reservation) throw new RoomImageRequestError(429, 'ROOM_IMAGE_QUEUE_FULL', 'Die Room-Image-Queue ist ausgelastet.');
    try {
      const result = jobStore.createFinal(identity, payload, parent, fingerprint);
      if (result.type === 'expired') {
        throw new RoomImageRequestError(410, 'SOURCE_PREVIEW_EXPIRED', 'Der ausgewählte Candidate ist abgelaufen.');
      }
      if (result.type === 'cleanup_pending') {
        throw roomImageJobStoreError('Die Finalannahme wartet auf sicheren Temp-Cleanup.');
      }
      if (!['created', 'resumed'].includes(result.type)) {
        if (result.type === 'replay') roomImageJsonResponse(req, res, 200, jobStore.publicJob(result.record));
        else throw new RoomImageRequestError(409, 'IDEMPOTENCY_CONFLICT', 'Für diesen Candidate wurde bereits ein Finaljob angenommen.');
        return;
      }
      if (!runner.enqueue(result.record.jobId, reservation)) {
        throw new RoomImageRequestError(503, 'ROOM_IMAGE_JOB_FAILED', 'Der Finaljob konnte nicht sicher eingereiht werden.');
      }
      roomImageJsonResponse(req, res, result.type === 'created' ? 202 : 200, jobStore.publicJob(result.record));
    } finally {
      reservation.release();
    }
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

async function serveRoomImageRetry(req, res, identity, jobId, jobStore, runner, assertSetupRecoveryHealthy) {
  try {
    const payload = normalizeRoomImageRetryRequest(await readRoomImageJsonBody(req));
    assertSetupRecoveryHealthy();
    if (!payload) throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Retry-Anfrage ist ungültig.');
    const fingerprint = roomImageFingerprint({ oldJobId: jobId, ...payload });
    const existing = jobStore.idempotent(identity, payload.clientRequestId, fingerprint);
    if (existing?.type === 'replay') {
      roomImageJsonResponse(req, res, 200, jobStore.publicJob(existing.record)); return;
    }
    if (existing?.type === 'conflict') throw new RoomImageRequestError(409, 'IDEMPOTENCY_CONFLICT', 'Die Client-Request-ID steht in Konflikt.');
    const old = jobStore.getOwn(identity, jobId);
    if (!old) throw new RoomImageRequestError(404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.');
    if (existing?.type !== 'pending') {
      if (old.status === 'expired') throw new RoomImageRequestError(410, 'RETRY_SOURCE_EXPIRED', 'Die Retryquelle ist abgelaufen.');
      if (old.status === 'superseded') throw new RoomImageRequestError(409, 'RETRY_ALREADY_CREATED', 'Für diesen Versuch wurde bereits ein Retry angelegt.');
      if (!old.retryable || old.status !== 'failed') throw new RoomImageRequestError(409, 'JOB_NOT_RETRYABLE', 'Der Job ist nicht retrybar.');
      if (old.retry.requiredProviderCalls !== payload.confirmedProviderCalls) {
        throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die bestätigte Providerabrufzahl ist falsch.');
      }
    }
    const reservation = runner.reserve();
    if (!reservation) throw new RoomImageRequestError(429, 'ROOM_IMAGE_QUEUE_FULL', 'Die Room-Image-Queue ist ausgelastet.');
    try {
      const result = jobStore.retry(identity, jobId, payload, fingerprint);
      if (result.type === 'expired') {
        throw new RoomImageRequestError(410, 'RETRY_SOURCE_EXPIRED', 'Die Retryquelle ist abgelaufen.');
      }
      if (result.type === 'cleanup_pending') {
        throw roomImageJobStoreError('Die Retryannahme wartet auf sicheren Temp-Cleanup.');
      }
      if (!['created', 'resumed'].includes(result.type)) {
        if (result.type === 'replay') roomImageJsonResponse(req, res, 200, jobStore.publicJob(result.record));
        else if (result.type === 'already') throw new RoomImageRequestError(409, 'RETRY_ALREADY_CREATED', 'Für diesen Versuch wurde bereits ein Retry angelegt.');
        else throw new RoomImageRequestError(409, 'JOB_NOT_RETRYABLE', 'Der Job ist nicht retrybar.');
        return;
      }
      if (!runner.enqueue(result.record.jobId, reservation)) {
        throw new RoomImageRequestError(503, 'ROOM_IMAGE_JOB_FAILED', 'Der Retryjob konnte nicht sicher eingereiht werden.');
      }
      roomImageJsonResponse(req, res, result.type === 'created' ? 202 : 200, jobStore.publicJob(result.record));
    } finally {
      reservation.release();
    }
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

async function serveRoomImageEmptyMutation(req, res, identity, jobId, action, jobStore, runner, assertSetupRecoveryHealthy) {
  try {
    const payload = await readRoomImageJsonBody(req, { allowEmpty: action === 'cancel' });
    assertSetupRecoveryHealthy();
    if (!roomImageExactObject(payload, [])) throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Der Requestbody muss leer sein.');
    if (!jobStore.getOwn(identity, jobId)) throw new RoomImageRequestError(404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.');
    if (jobStore.getOwn(identity, jobId)?.phase === 'publishing_set') {
      throw new RoomImageRequestError(409, 'PUBLISH_IN_PROGRESS', 'Die Veröffentlichung läuft bereits.');
    }
    if (action === 'discard') {
      const result = jobStore.discard(identity, jobId);
      if (result === 'not_discardable') throw new RoomImageRequestError(409, 'JOB_NOT_DISCARDABLE', 'Der Job ist nicht verwerfbar.');
      res.writeHead(204, { 'cache-control': 'no-store' }); res.end(); return;
    }
    const result = runner.cancel(jobId);
    if (result === 'publishing') throw new RoomImageRequestError(409, 'PUBLISH_IN_PROGRESS', 'Die Veröffentlichung läuft bereits.');
    if (result === 'not_cancellable') throw new RoomImageRequestError(409, 'JOB_NOT_CANCELLABLE', 'Der Job ist nicht abbrechbar.');
    roomImageJsonResponse(req, res, 200, jobStore.publicJob(jobStore.getOwn(identity, jobId)));
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

async function serveRoomImagePreview(req, res, store, reference, contentType, expiredCode, previewValidator) {
  if (!reference) {
    roomImageError(req, res, 410, expiredCode, 'Die private Vorschau ist abgelaufen.'); return;
  }
  try {
    const bytes = store.readTemp(reference);
    const expectedFormat = contentType === 'image/jpeg' ? 'jpeg' : 'heif';
    await previewValidator(bytes, expectedFormat);
    res.writeHead(200, {
      'content-type': contentType, 'content-length': bytes.byteLength,
      'cache-control': 'private, no-store',
    });
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
  } catch {
    roomImageError(req, res, 410, expiredCode, 'Die private Vorschau ist abgelaufen.');
  }
}

function readRoomImageHouseholdSnapshot(path) {
  try {
    if (!path) throw new Error('missing household path');
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > HOUSEHOLD_CONFIG_BODY_MAX) throw new Error('unsafe household config');
    const bytes = readFileSync(path);
    const parsed = parseHouseholdConfig(JSON.parse(bytes.toString('utf8')));
    if (!parsed.ok) throw new Error('invalid household config');
    projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
    return { bytes, document: parsed.value, etag: strongByteEtag(bytes) };
  } catch (error) {
    throw roomImageAssetStoreError('Die Household Config ist für Room-Image-Mutationen ungültig.', error);
  }
}

function roomImageHouseholdCommitMatches(path, expectedBytes) {
  let descriptor;
  try {
    const absolute = setupCanonicalPath(path);
    if (!setupInspectPath(absolute, 'file').exists) return false;
    descriptor = openSync(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size !== expectedBytes.byteLength
        || (metadata.mode & 0o777) !== 0o600) return false;
    const activeBytes = readFileSync(descriptor);
    const current = lstatSync(absolute);
    return current.isFile() && !current.isSymbolicLink()
      && current.dev === metadata.dev && current.ino === metadata.ino
      && (current.mode & 0o777) === 0o600
      && activeBytes.equals(expectedBytes);
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeRoomImageHousehold(
  path,
  document,
  transactionStep = () => undefined,
  latchSetupRecoveryFailure = () => undefined,
  assertSetupRecoveryHealthy = () => undefined,
) {
  const parsed = parseHouseholdConfig(document);
  if (!parsed.ok) throw roomImageAssetStoreError('Die geänderte Household Config ist ungültig.');
  projectActiveHouseholdData(compileHouseholdConfig(parsed.value));
  const bytes = Buffer.from(`${JSON.stringify(parsed.value, null, 2)}\n`);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let renamed = false;
  let operationError = null;
  let cleanupError = null;
  try {
    assertSetupRecoveryHealthy();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx', flush: true });
    chmodSync(temporary, 0o600);
    const temporaryMetadata = lstatSync(temporary);
    if (!temporaryMetadata.isFile() || temporaryMetadata.isSymbolicLink()
        || (temporaryMetadata.mode & 0o777) !== 0o600) {
      throw new Error('unsafe assignment temporary');
    }
    transactionStep('assignment_before_rename', { path, temporary });
    assertSetupRecoveryHealthy();
    renameSync(temporary, path);
    renamed = true;
    transactionStep('assignment_renamed', { path });
    transactionStep('assignment_directory_fsync', { path });
    flushDirectory(dirname(path));
    transactionStep('assignment_committed', { path });
  } catch (error) {
    operationError = error;
  }
  try {
    if (!isSetupRecoveryRequiredError(operationError)) unlinkSync(temporary);
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') cleanupError = error;
  }
  if (!renamed) {
    if (cleanupError) {
      throw roomImageAssetStoreError('Ein Household-Config-Partial konnte nicht bereinigt werden.', cleanupError);
    }
    if (operationError) throw operationError;
  }
  if (renamed && cleanupError === null && roomImageHouseholdCommitMatches(path, bytes)) {
    return { bytes, etag: strongByteEtag(bytes), document: parsed.value };
  }
  latchSetupRecoveryFailure();
  throw new RoomImageRequestError(
    503,
    'SETUP_CONFIG_RECOVERY_REQUIRED',
    'Eine Konfigurationsmutation konnte nicht sicher abgeschlossen werden.',
  );
}

function assignedRoomIds(document, assetId) {
  return document.rooms.filter((room) => room.hero?.assetId === assetId).map((room) => room.id).sort();
}

function normalizeRoomImageAssignment(payload) {
  if (!roomImageExactObject(payload, ['asset'])) return null;
  if (payload.asset === null) return { asset: null };
  if (!roomImageExactObject(payload.asset, ['assetId', 'focus'])
      || !ROOM_IMAGE_ASSET_ID_PATTERN.test(payload.asset.assetId || '')
      || !validRoomImageFocus(payload.asset.focus)) return null;
  return { asset: structuredClone(payload.asset) };
}

async function serveRoomImagePublish(req, res, identity, jobId, context) {
  try {
    const payload = await readRoomImageJsonBody(req);
    context.assertSetupRecoveryHealthy();
    if (!roomImageExactObject(payload, ['confirmed']) || payload.confirmed !== true) {
      const record = context.jobStore.getOwn(identity, jobId);
      if (record?.phase === 'publishing_set') throw new RoomImageRequestError(409, 'PUBLISH_IN_PROGRESS', 'Die Veröffentlichung läuft bereits.');
      throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Publish erwartet exakt confirmed:true.');
    }
    const flightKey = `${identity}\u0000${jobId}`;
    let operation = context.publishFlights.get(flightKey);
    if (!operation) {
      operation = (async () => {
        context.assertSetupRecoveryHealthy();
        const started = context.jobStore.beginPublish(identity, jobId);
        if (started.type === 'absent') throw new RoomImageRequestError(404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.');
        if (started.type === 'replay') return started.record.asset;
        if (started.type === 'publishing') {
          context.assertSetupRecoveryHealthy();
          const recovery = context.assetStore.recoveryState(started.record.reservedAssetId);
          context.assertSetupRecoveryHealthy();
          if (recovery.type === 'complete') return context.jobStore.finishPublish(jobId, recovery.asset).asset;
          context.jobStore.failPublish(jobId, recovery.type === 'required' ? 'PUBLISH_RECOVERY_REQUIRED' : 'PUBLISH_FAILED');
          throw new RoomImageRequestError(503, recovery.type === 'required' ? 'PUBLISH_RECOVERY_REQUIRED' : 'PUBLISH_FAILED', 'Die Veröffentlichung konnte nicht fortgesetzt werden.');
        }
        if (started.type === 'expired') throw new RoomImageRequestError(410, 'ROOM_IMAGE_TEMP_EXPIRED', 'Der Finaljob ist abgelaufen.');
        if (started.type !== 'started') throw new RoomImageRequestError(409, 'JOB_NOT_PUBLISHABLE', 'Der Job ist nicht veröffentlichbar.');
        const record = started.record;
        const variants = Object.fromEntries(['light', 'dark', 'darkOff'].map((key) => [key, context.jobStore.readTemp(record.temp.finals[key])]));
        try {
          context.assertSetupRecoveryHealthy();
          await Promise.all(Object.entries(variants).map(([variant, bytes]) => context.previewValidator(bytes, 'heif', {
            purpose: 'publish-set', variant, jobId,
          })));
          context.assertSetupRecoveryHealthy();
        } catch (error) {
          if (isSetupRecoveryRequiredError(error)) throw error;
          context.assertSetupRecoveryHealthy();
          context.jobStore.failPublish(jobId, 'PUBLISH_FAILED');
          throw new RoomImageRequestError(422, 'PUBLISH_FAILED', 'Der Finalsatz ist nicht vollständig AVIF-dekodierbar.');
        }
        try {
          context.assertSetupRecoveryHealthy();
          const asset = await context.configMutations.run(() => {
            context.assertSetupRecoveryHealthy();
            return context.assetStore.publish(record.reservedAssetId, record.request.focus, variants);
          });
          context.publishStep('before_job_commit', { jobId, assetId: asset.assetId });
          context.assertSetupRecoveryHealthy();
          return context.jobStore.finishPublish(jobId, asset).asset;
        } catch (error) {
          if (error && typeof error === 'object' && error.simulateCrash === true) throw error;
          if (isSetupRecoveryRequiredError(error)) throw error;
          context.assertSetupRecoveryHealthy();
          const recovery = context.assetStore.recoveryState(record.reservedAssetId);
          context.assertSetupRecoveryHealthy();
          if (recovery.type === 'complete') {
            try { return context.jobStore.finishPublish(jobId, recovery.asset).asset; } catch { throw error; }
          }
          context.jobStore.failPublish(jobId, recovery.type === 'required' ? 'PUBLISH_RECOVERY_REQUIRED' : 'PUBLISH_FAILED');
          throw error;
        }
      })();
      context.publishFlights.set(flightKey, operation);
      void operation.finally(() => {
        if (context.publishFlights.get(flightKey) === operation) context.publishFlights.delete(flightKey);
      }).catch(() => undefined);
    }
    roomImageJsonResponse(req, res, 200, await operation);
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

async function serveRoomImageAssetListing(req, res, context) {
  try {
    const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
    const assets = context.assetStore.list().map((asset) => ({
      ...asset, assignedRoomIds: assignedRoomIds(snapshot.document, asset.assetId),
    }));
    const totalByteLength = assets.reduce((total, asset) => total + (asset.byteLength || 0), 0);
    roomImageJsonResponse(req, res, 200, { assets, totalByteLength, householdEtag: snapshot.etag });
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

async function serveRoomImageAssignment(req, res, roomId, context) {
  try {
    const payload = normalizeRoomImageAssignment(await readRoomImageJsonBody(req));
    context.assertSetupRecoveryHealthy();
    if (!payload) throw new RoomImageRequestError(400, 'INVALID_REQUEST', 'Die Assignment-Anfrage ist ungültig.');
    const matches = rawHeaderValues(req, 'if-match');
    if (matches.length !== 1) throw new RoomImageRequestError(428, 'CONFIG_PRECONDITION_REQUIRED', 'Der Household-ETag fehlt.');
    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      if (matches[0] !== snapshot.etag) return { type: 'stale' };
      const room = snapshot.document.rooms.find((candidate) => candidate.id === roomId);
      if (!room) return { type: 'room_absent' };
      if (payload.asset) {
        const status = context.assetStore.status(payload.asset.assetId);
        if (status !== 'complete') {
          return { type: ['not_found', 'tombstone'].includes(status) ? 'asset_absent' : 'asset_incomplete' };
        }
      }
      room.hero = payload.asset;
      const written = writeRoomImageHousehold(
        context.householdConfigPath,
        snapshot.document,
        context.publishStep,
        context.latchSetupRecoveryFailure,
        context.assertSetupRecoveryHealthy,
      );
      return { type: 'written', roomId, hero: structuredClone(room.hero), etag: written.etag };
    });
    if (result.type === 'stale') throw new RoomImageRequestError(412, 'CONFIG_PRECONDITION_FAILED', 'Die Household Config wurde zwischenzeitlich geändert.');
    if (result.type === 'room_absent') throw new RoomImageRequestError(404, 'ROOM_NOT_FOUND', 'Der Raum wurde nicht gefunden.');
    if (result.type === 'asset_absent') throw new RoomImageRequestError(404, 'ASSET_NOT_FOUND', 'Das Asset wurde nicht gefunden.');
    if (result.type === 'asset_incomplete') throw new RoomImageRequestError(409, 'ASSET_INCOMPLETE', 'Das Asset ist unvollständig.');
    roomImageJsonResponse(req, res, 200, { roomId: result.roomId, hero: result.hero, etag: result.etag });
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

async function serveManualRoomBackground(req, res, roomId, context) {
  let variantBytes = null;
  try {
    context.assertSetupRecoveryHealthy();
    const matches = rawHeaderValues(req, 'if-match');
    if (matches.length !== 1) {
      throw new RoomImageRequestError(428, 'CONFIG_PRECONDITION_REQUIRED', 'Der Household-ETag fehlt.');
    }
    if (req.method === 'POST') variantBytes = await decodeManualRoomBackground(req);

    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      if (matches[0] !== snapshot.etag) return { type: 'stale' };
      const room = snapshot.document.rooms.find((candidate) => candidate.id === roomId);
      if (!room) return { type: 'room_absent' };

      const previousAssetId = room.hero?.assetId ?? null;
      let createdAsset = null;
      if (variantBytes) {
        const assetId = `manual_${randomBytes(16).toString('hex')}`;
        const focus = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };
        createdAsset = context.assetStore.publish(assetId, focus, {
          light: variantBytes, dark: variantBytes, darkOff: variantBytes,
        });
      }
      room.hero = createdAsset ? { assetId: createdAsset.assetId, focus: createdAsset.focus } : null;

      let written;
      try {
        written = writeRoomImageHousehold(
          context.householdConfigPath,
          snapshot.document,
          context.publishStep,
          context.latchSetupRecoveryFailure,
          context.assertSetupRecoveryHealthy,
        );
      } catch (error) {
        if (createdAsset) {
          try {
            context.assetStore.tombstone(createdAsset.assetId);
            context.assetStore.deleteTombstonedFiles(createdAsset.assetId);
          } catch { /* original config failure remains authoritative */ }
        }
        throw error;
      }

      if (previousAssetId?.startsWith('manual_') && previousAssetId !== createdAsset?.assetId
          && assignedRoomIds(written.document, previousAssetId).length === 0) {
        try {
          context.assetStore.tombstone(previousAssetId);
          context.assetStore.deleteTombstonedFiles(previousAssetId);
        } catch { /* assignment is already durable; cleanup can be retried later */ }
      }
      return { type: 'written', roomId, hero: structuredClone(room.hero), etag: written.etag };
    });

    if (result.type === 'stale') throw new RoomImageRequestError(412, 'CONFIG_PRECONDITION_FAILED', 'Die Household Config wurde zwischenzeitlich geändert.');
    if (result.type === 'room_absent') throw new RoomImageRequestError(404, 'ROOM_NOT_FOUND', 'Der Raum wurde nicht gefunden.');
    roomImageJsonResponse(req, res, 200, { roomId: result.roomId, hero: result.hero, etag: result.etag });
  } catch (error) {
    if (error instanceof RoomImageTransformError) {
      roomImageError(req, res, 422, error.code, 'Das Bild konnte nicht verarbeitet werden.');
      return;
    }
    if (/pixel limit|exceeds.*pixels|image exceeds/i.test(error instanceof Error ? error.message : '')) {
      roomImageError(req, res, 413, 'IMAGE_PIXEL_LIMIT_EXCEEDED', 'Das Bild überschreitet die Grenze von 24.000.000 Pixeln.');
      return;
    }
    roomImageHandleAsyncError(req, res, error);
  }
}

async function serveRoomImageAssetDelete(req, res, assetId, context) {
  try {
    context.assertSetupRecoveryHealthy();
    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      const status = context.assetStore.status(assetId);
      if (status === 'not_found') return { type: 'absent' };
      if (status === 'incomplete') throw roomImageAssetStoreError('Ein unvollständiges Asset kann nicht gelöscht werden.');
      if (status === 'tombstone') {
        context.assetStore.deleteTombstonedFiles(assetId);
        return { type: 'deleted' };
      }
      const roomIds = assignedRoomIds(snapshot.document, assetId);
      if (roomIds.length) return { type: 'in_use', roomIds };
      context.assetStore.tombstone(assetId);
      context.assetStore.deleteTombstonedFiles(assetId);
      return { type: 'deleted' };
    });
    if (result.type === 'absent') throw new RoomImageRequestError(404, 'ASSET_NOT_FOUND', 'Das Asset wurde nicht gefunden.');
    if (result.type === 'in_use') {
      roomImageJsonResponse(req, res, 409, {
        ok: false, code: 'ASSET_IN_USE', message: 'Das Asset ist Räumen zugewiesen.', retryable: false, roomIds: result.roomIds,
      });
      return;
    }
    res.writeHead(204, { 'cache-control': 'no-store' }); res.end();
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

function serveRoomImagePublicAsset(req, res, assetId, file, assetStore) {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }); res.end(); return;
  }
  const variant = Object.entries(ROOM_IMAGE_VARIANT_FILES).find(([, name]) => name === file)?.[0];
  if (!variant || !ROOM_IMAGE_ASSET_ID_PATTERN.test(assetId || '')) {
    jsonResponse(res, 404, { code: 'ASSET_NOT_FOUND', message: 'Asset nicht gefunden.' }); return;
  }
  try {
    const bytes = assetStore.variantBytes(assetId, variant);
    if (!bytes) { jsonResponse(res, 404, { code: 'ASSET_NOT_FOUND', message: 'Asset nicht gefunden.' }); return; }
    res.writeHead(200, {
      'content-type': 'image/avif', 'content-length': bytes.byteLength,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
  } catch { jsonResponse(res, 404, { code: 'ASSET_NOT_FOUND', message: 'Asset nicht gefunden.' }); }
}

function serveRoomImages(req, res, {
  authConfig,
  allowedOrigins,
  uploadStore,
  jobStore,
  jobRunner,
  previewValidator,
  testCapability,
  probeState,
  credentialStore,
  now,
  assetStore,
  householdConfigPath,
  configMutations,
  publishFlights,
  publishStep,
  latchSetupRecoveryFailure,
  assertSetupRecoveryHealthy,
}) {
  const parsed = new URL(req.url || '/', 'http://hmi.local');
  const pathname = parsed.pathname;
  const context = {
    assetStore, householdConfigPath, configMutations, jobStore, previewValidator, publishFlights, publishStep,
    latchSetupRecoveryFailure, assertSetupRecoveryHealthy,
  };
  if (pathname === '/api/room-images/access'
      || pathname === '/api/room-images/access/api-key'
      || pathname === '/api/room-images/access/chatgpt/start'
      || pathname === '/api/room-images/access/chatgpt/poll') {
    const expectedMethods = pathname === '/api/room-images/access' ? ['GET', 'DELETE'] : ['POST'];
    if (!expectedMethods.includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Zugangsanfrage verwendet eine ungültige Methode.', { allow: expectedMethods.join(', ') });
      return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, req.method !== 'GET');
    if (identity) void serveRoomImageAccess(req, res, pathname, credentialStore);
    return true;
  }
  if (pathname.startsWith('/assets/room-images')) {
    const match = !parsed.search && pathname.match(/^\/assets\/room-images\/([^/]+)\/([^/]+)$/);
    if (!match || !assetStore) jsonResponse(res, 404, { code: 'ASSET_NOT_FOUND', message: 'Asset nicht gefunden.' });
    else serveRoomImagePublicAsset(req, res, match[1], match[2], assetStore);
    return true;
  }
  if (pathname === '/api/room-image-assets') {
    if (req.method !== 'GET') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Assetliste erlaubt ausschließlich GET.', { allow: 'GET' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, false);
    if (identity && assetStore) void serveRoomImageAssetListing(req, res, context);
    else if (identity) roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Assetstore fehlt.');
    return true;
  }
  const manualBackgroundMatch = pathname.match(/^\/api\/room-backgrounds\/([^/]+)$/);
  if (manualBackgroundMatch) {
    if (!['POST', 'DELETE'].includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Raumbilder erlauben ausschließlich POST und DELETE.', { allow: 'POST, DELETE' }); return true;
    }
    if (!manualRoomBackgroundOriginAllowed(req, allowedOrigins)) {
      roomImageError(req, res, 403, 'ORIGIN_FORBIDDEN', 'Die Raumbild-Anfrage stammt nicht von einer freigegebenen Origin.'); return true;
    }
    if (!ROOM_IMAGE_ROOM_ID_PATTERN.test(manualBackgroundMatch[1] || '')) {
      roomImageError(req, res, 404, 'ROOM_NOT_FOUND', 'Der Raum wurde nicht gefunden.'); return true;
    }
    if (!assetStore) roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Assetstore fehlt.');
    else void serveManualRoomBackground(req, res, manualBackgroundMatch[1], context);
    return true;
  }
  const assignmentMatch = pathname.match(/^\/api\/room-image-assignments\/([^/]+)$/);
  if (assignmentMatch) {
    if (req.method !== 'PUT') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Assignment erlaubt ausschließlich PUT.', { allow: 'PUT' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!ROOM_IMAGE_ROOM_ID_PATTERN.test(assignmentMatch[1] || '')) {
      roomImageError(req, res, 404, 'ROOM_NOT_FOUND', 'Der Raum wurde nicht gefunden.'); return true;
    }
    if (!assetStore) roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Assetstore fehlt.');
    else void serveRoomImageAssignment(req, res, assignmentMatch[1], context);
    return true;
  }
  const assetDeleteMatch = pathname.match(/^\/api\/room-image-assets\/([^/]+)$/);
  if (assetDeleteMatch) {
    if (req.method !== 'DELETE') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Assetdelete erlaubt ausschließlich DELETE.', { allow: 'DELETE' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!assetStore || !ROOM_IMAGE_ASSET_ID_PATTERN.test(assetDeleteMatch[1] || '')) roomImageError(req, res, 404, 'ASSET_NOT_FOUND', 'Das Asset wurde nicht gefunden.');
    else void serveRoomImageAssetDelete(req, res, assetDeleteMatch[1], context);
    return true;
  }
  if (pathname === '/api/room-images/capability') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Capability-Basis erlaubt nur GET und HEAD.', { allow: 'GET, HEAD' });
    } else {
      roomImageJsonResponse(req, res, 200, roomImageBaseCapability(authConfig, testCapability, credentialStore?.status?.()));
    }
    return true;
  }
  if (pathname === '/api/room-images/capability/details') {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Capability-Details erlauben nur GET und HEAD.', { allow: 'GET, HEAD' });
      return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, false);
    if (identity) roomImageJsonResponse(req, res, 200, roomImagePrivateDetails(testCapability, probeState, credentialStore?.status?.()));
    return true;
  }
  if (pathname === '/api/room-images/probe') {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Capability-Probe erlaubt nur POST.', { allow: 'POST' });
      return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (identity) void serveRoomImageProbe(req, res, { jobRunner, now, probeState, testCapability, credentialStore });
    return true;
  }
  if (pathname === '/api/room-image-uploads') {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Der Upload-Endpunkt erlaubt nur POST.', { allow: 'POST' });
      return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (identity) void serveRoomImageUpload(req, res, identity, uploadStore, assertSetupRecoveryHealthy);
    return true;
  }
  const uploadMatch = pathname.match(/^\/api\/room-image-uploads\/([^/]+)$/);
  if (uploadMatch) {
    if (req.method !== 'DELETE') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Uploads können ausschließlich gelöscht werden.', { allow: 'DELETE' });
      return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    let result;
    try {
      result = uploadStore.deleteOwn(identity, uploadMatch[1]);
    } catch (error) {
      if (error instanceof RoomImageUploadStoreError) {
        roomImageError(req, res, 500, error.code, 'Temporäre Uploaddaten konnten nicht sicher gelöscht werden.');
        return true;
      }
      throw error;
    }
    if (result === 'in_use') {
      roomImageError(req, res, 409, 'UPLOAD_IN_USE', 'Der Upload ist bereits aktiv an einen Job gebunden.');
    } else {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
    }
    return true;
  }
  if (pathname === '/api/room-image-jobs') {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Jobs können ausschließlich per POST angelegt werden.', { allow: 'POST' });
      return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!jobStore || !jobRunner) {
      roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Room-Image-Jobpfad ist nicht konfiguriert.');
      return true;
    }
    void serveRoomImageJobCreate(req, res, identity, uploadStore, jobStore, jobRunner, assertSetupRecoveryHealthy);
    return true;
  }
  const publishMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)\/publish$/);
  if (publishMatch) {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Publish erlaubt ausschließlich POST.', { allow: 'POST' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!jobStore || !assetStore) {
      roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Publishstores fehlen.'); return true;
    }
    void serveRoomImagePublish(req, res, identity, publishMatch[1], context);
    return true;
  }
  const retryMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)\/retry$/);
  if (retryMatch) {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Retry erlaubt ausschließlich POST.', { allow: 'POST' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!jobStore || !jobRunner) {
      roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Room-Image-Jobpfad ist nicht konfiguriert.'); return true;
    }
    void serveRoomImageRetry(req, res, identity, retryMatch[1], jobStore, jobRunner, assertSetupRecoveryHealthy);
    return true;
  }
  const mutationMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)\/(discard|cancel)$/);
  if (mutationMatch) {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Jobmutation erlaubt ausschließlich POST.', { allow: 'POST' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!jobStore || !jobRunner) {
      roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Room-Image-Jobpfad ist nicht konfiguriert.'); return true;
    }
    void serveRoomImageEmptyMutation(
      req, res, identity, mutationMatch[1], mutationMatch[2], jobStore, jobRunner, assertSetupRecoveryHealthy,
    );
    return true;
  }
  const sourcePreviewMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)\/source-preview$/);
  if (sourcePreviewMatch) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Source-Preview erlaubt nur GET und HEAD.', { allow: 'GET, HEAD' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, false);
    if (!identity) return true;
    if (!jobStore) { roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Jobstore fehlt.'); return true; }
    const record = jobStore.getOwn(identity, sourcePreviewMatch[1]);
    if (!record) { roomImageError(req, res, 404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.'); return true; }
    const resumable = ['queued', 'running', 'succeeded', 'failed', 'awaiting_confirmation'].includes(record.status)
      && (record.status !== 'failed' || record.retryable);
    void serveRoomImagePreview(req, res, jobStore, resumable ? record.temp.source : null, 'image/jpeg', 'SOURCE_PREVIEW_EXPIRED', previewValidator);
    return true;
  }
  const candidatePreviewMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)\/previews\/([^/]+)$/);
  if (candidatePreviewMatch) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Candidate-Preview erlaubt nur GET und HEAD.', { allow: 'GET, HEAD' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, false);
    if (!identity) return true;
    if (!jobStore) { roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Jobstore fehlt.'); return true; }
    const record = jobStore.getOwn(identity, candidatePreviewMatch[1]);
    if (!record) { roomImageError(req, res, 404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.'); return true; }
    const candidate = record.temp.candidates.find((entry) => entry.candidateId === candidatePreviewMatch[2]);
    if (!candidate) { roomImageError(req, res, 404, 'ROOM_IMAGE_PREVIEW_NOT_FOUND', 'Die Vorschau wurde nicht gefunden.'); return true; }
    void serveRoomImagePreview(req, res, jobStore, candidate.preview, 'image/avif', 'ROOM_IMAGE_PREVIEW_EXPIRED', previewValidator);
    return true;
  }
  const finalPreviewMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)\/final-previews\/(light|dark|dark-off)$/);
  if (finalPreviewMatch) {
    if (!['GET', 'HEAD'].includes(req.method || '')) {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Final-Preview erlaubt nur GET und HEAD.', { allow: 'GET, HEAD' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, false);
    if (!identity) return true;
    if (!jobStore) { roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Jobstore fehlt.'); return true; }
    const record = jobStore.getOwn(identity, finalPreviewMatch[1]);
    if (!record || record.kind !== 'variant_set') { roomImageError(req, res, 404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.'); return true; }
    const key = finalPreviewMatch[2] === 'dark-off' ? 'darkOff' : finalPreviewMatch[2];
    const complete = ['light', 'dark', 'darkOff'].every((variant) => record.temp.finals[variant] && jobStore.tempExists(record.temp.finals[variant]));
    void serveRoomImagePreview(req, res, jobStore, complete ? record.temp.finals[key] : null, 'image/avif', 'ROOM_IMAGE_PREVIEW_EXPIRED', previewValidator);
    return true;
  }
  const jobMatch = pathname.match(/^\/api\/room-image-jobs\/([^/]+)$/);
  if (jobMatch) {
    if (req.method !== 'GET') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Jobstatus erlaubt ausschließlich GET.', { allow: 'GET' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, false);
    if (!identity) return true;
    if (!jobStore) { roomImageError(req, res, 503, 'ROOM_IMAGE_STORE_INVALID', 'Der Jobstore fehlt.'); return true; }
    const record = jobStore.getOwn(identity, jobMatch[1]);
    if (!record) roomImageError(req, res, 404, 'ROOM_IMAGE_JOB_NOT_FOUND', 'Der Job wurde nicht gefunden.');
    else roomImageJsonResponse(req, res, 200, jobStore.publicJob(record));
    return true;
  }
  if (pathname.startsWith('/api/room-images') || pathname.startsWith('/api/room-image-uploads')
      || pathname.startsWith('/api/room-image-jobs') || pathname.startsWith('/api/room-image-assets')
      || pathname.startsWith('/api/room-image-assignments') || pathname.startsWith('/api/room-backgrounds')
      || pathname.startsWith('/api/rooms/')) {
    roomImageError(req, res, 404, 'ROOM_IMAGE_ROUTE_NOT_FOUND', 'Die Room-Image-Route wurde nicht gefunden.');
    return true;
  }
  return false;
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
        try { jsonResponse(res, 201, { ok: true, item: store.addReminder(payload?.who, payload?.title, payload?.due, payload?.label) }); }
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
    setupConfigRecoveryResult = null,
    staticRoot = DIST,
    requiredWritableDirs = REQUIRED_WRITABLE_DIRS,
    notionShoppingPath = NOTION_SHOPPING_PATH,
    familyDataPath = FAMILY_DATA_PATH,
    familyData = null,
    setupConnectionVerifier = verifySetupHomeAssistant,
    setupJellyfinVerifier = verifySetupJellyfin,
    haConnectionMode = HA_CONNECTION_MODE,
    haSupervisorClientFactory = createHaSupervisorClient,
    haGatewayFactory = createHaWebSocketGateway,
    setupMutationStep = () => undefined,
    laundryClientFactory = createLaundryHomeAssistantClient,
    laundryReplaceConfig = renameSync,
    laundryNow = () => Date.now(),
    laundrySleep = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 250)),
    laundryBlueprintFile = LAUNDRY_BLUEPRINT_FILE,
    configMutationCoordinator = null,
    roomImageAuthConfig = createRoomImageAuthConfig(),
    roomImageUploadRoot = ROOM_IMAGE_UPLOAD_ROOT,
    roomImageNow = () => Date.now(),
    roomImageUploadStore = null,
    roomImageUploadStoreFactory = createRoomImageUploadStore,
    roomImageTestCapability = null,
    roomImageJobRoot = householdConfigPath ? join(dirname(householdConfigPath), 'room-images', 'jobs') : null,
    roomImageTempRoot = ROOM_IMAGE_TEMP_ROOT,
    roomImageJobStore = null,
    roomImageJobStoreFactory = createRoomImageJobStore,
    roomImageProvider = null,
    roomImageProviderFactory = createOpenAiRoomImageProvider,
    roomImageProviderCredential = undefined,
    roomImageFetchImpl = undefined,
    roomImageCredentialStore = null,
    roomImageCredentialStoreFactory = createRoomImageCredentialStore,
    roomImageCredentialPath = ROOM_IMAGE_CREDENTIAL_PATH,
    roomImageJobRunner = null,
    roomImageJobRunnerFactory = createRoomImageJobRunner,
    roomImagePreviewValidator = validateRoomImagePreviewBytes,
    roomImageAssetRoot = ROOM_IMAGE_ASSET_ROOT,
    roomImageAssetCatalogPath = undefined,
    roomImageAssetStore = null,
    roomImageAssetStoreFactory = createRoomImageAssetStore,
    roomImagePublishStep = () => undefined,
    buildInfo = readBuildInfo(),
    hotelModeDataPath = null,
    hotelModeStore = null,
    hotelModeNow = () => Date.now(),
    hotelModeSessionMs = HOTEL_ADMIN_SESSION_MS,
    hotelModeStayService = null,
    hotelCalendarClientFactory = createHotelCalendarClient,
    hotelGuestStateService = null,
    hotelStatesClientFactory = createHotelStatesClient,
    hotelCommandService = null,
    hotelCommandClientFactory = createHotelCommandClient,
    hotelSettingsService = null,
    hotelActivationPreflightService = null,
    hotelCheckoutService = null,
    hotelEventClientFactory = createHotelEventClient,
  } = {},
) {
  const normalizedHouseholdConfigMode = normalizeHouseholdConfigMode(householdConfigMode);
  const configMutations = configMutationCoordinator ?? createConfigMutationCoordinator();
  const setupRecoveryResult = setupConfigRecoveryResult ?? configMutations.runSync(
    () => recoverSetupConfigTransactions({ configPath, householdConfigPath }),
  );
  let setupRecoveryFailureLatched = !setupRecoveryResult.ok;
  const latchSetupRecoveryFailure = () => { setupRecoveryFailureLatched = true; };
  const assertSetupRecoveryHealthy = () => {
    if (setupRecoveryFailureLatched) throw setupRecoveryRequiredError();
  };
  const migrationResult = !setupRecoveryResult.ok ? setupRecoveryResult : (householdConfigMigrationResult ?? (
    normalizedHouseholdConfigMode === 'active'
      ? configMutations.runSync(() => migrateHouseholdConfigFile(householdConfigPath))
      : { ok: true, status: 'shadow' }
  ));
  const configStore = createCentralConfigStore(configPath, { assertSetupRecoveryHealthy });
  if (haConnectionMode === 'supervisor' && setupRecoveryResult.ok) {
    /* Ab dem ersten Start im App-Modus existiert kein gespeicherter HA-Zugang
       mehr — weder in `/data` noch in einer Antwort an den Browser. */
    try { configMutations.runSync(() => purgeHaCredentialsFromSharedConfig(configStore)); }
    catch (error) { console.warn('[hauser] HA-Credentials konnten nicht entfernt werden:', error?.code ?? error); }
  }
  const householdConfigReader = createHouseholdConfigReader(householdConfigPath);
  const familyStore = familyData || createFamilyDataStore(familyDataPath);
  const ablageAccess = createAblageAccess(paperlessPin, paperlessToken);
  const hotelStore = hotelModeStore || createHotelModeStore(hotelModeDataPath || resolveHotelModeDataPath(configPath));
  const hotelAdminAccess = createHotelModeAdminAccess(hotelStore, { now: hotelModeNow, sessionMs: hotelModeSessionMs });
  const hotelAdminGate = createHotelModeAdminGate(householdConfigPath, { access: hotelAdminAccess });
  const hotelStays = hotelModeStayService || createHotelModeStayService({
    store: hotelStore,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    now: hotelModeNow,
    calendarClientFactory: hotelCalendarClientFactory,
  });
  const hotelGuestStates = hotelGuestStateService || createHotelGuestStateService({
    stays: hotelStays,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    now: hotelModeNow,
    statesClientFactory: hotelStatesClientFactory,
  });
  const hotelCommands = hotelCommandService || createHotelCommandService({
    stays: hotelStays,
    guests: hotelGuestStates,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    commandClientFactory: hotelCommandClientFactory,
  });
  const hotelActivationPreflight = hotelActivationPreflightService || createHotelActivationPreflight({
    configStore,
    connectionMode: haConnectionMode,
    access: hotelAdminAccess,
    statesClientFactory: hotelStatesClientFactory,
    calendarClientFactory: hotelCalendarClientFactory,
    now: hotelModeNow,
  });
  const hotelSettings = hotelSettingsService || createHotelModeSettingsService({
    householdConfigPath,
    configMutations,
    publishStep: roomImagePublishStep,
    latchSetupRecoveryFailure,
    assertSetupRecoveryHealthy,
    preflight: hotelActivationPreflight,
  });
  const hotelCheckouts = hotelCheckoutService || createHotelCheckoutService({
    stays: hotelStays,
    store: hotelStore,
    guests: hotelGuestStates,
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    now: hotelModeNow,
    eventClientFactory: hotelEventClientFactory,
    commandClientFactory: hotelCommandClientFactory,
  });
  const library = songLibrary || createSongLibrary();
  const roomImageUploads = setupRecoveryResult.ok ? (roomImageUploadStore || roomImageUploadStoreFactory({
    root: roomImageUploadRoot, now: roomImageNow, assertSetupRecoveryHealthy,
  })) : null;
  const roomImageJobs = setupRecoveryResult.ok ? (roomImageJobStore || (roomImageJobRoot && roomImageAuthConfig?.configured
    ? roomImageJobStoreFactory({
      metadataRoot: roomImageJobRoot, tempRoot: roomImageTempRoot, now: roomImageNow,
      transactionStep: roomImagePublishStep, assertSetupRecoveryHealthy,
    })
    : null)) : null;
  const resolvedRoomImageCredentialStore = roomImageCredentialStore || roomImageCredentialStoreFactory({
    path: roomImageCredentialPath,
    environmentApiKey: roomImageProviderCredential !== undefined
      ? roomImageProviderCredential
      : process.env.NODE_ENV === 'test' ? '' : process.env.HMI_OPENAI_API_KEY,
    fetchImpl: roomImageFetchImpl,
    now: roomImageNow,
  });
  let resolvedRoomImageProvider = roomImageProvider;
  if (!roomImageJobRunner && roomImageJobs && !resolvedRoomImageProvider) {
    resolvedRoomImageProvider = roomImageProviderFactory === createOpenAiRoomImageProvider
      ? createRoomImageProviderRouter({ credentialStore: resolvedRoomImageCredentialStore, fetchImpl: roomImageFetchImpl })
      : roomImageProviderFactory({
        credential: resolvedRoomImageCredentialStore.current()?.apiKey,
        credentialStore: resolvedRoomImageCredentialStore,
        fetchImpl: roomImageFetchImpl,
      });
  }
  const roomImageRunner = setupRecoveryResult.ok ? (roomImageJobRunner || (roomImageJobs
    ? roomImageJobRunnerFactory({
      store: roomImageJobs, provider: resolvedRoomImageProvider || createRoomImageProviderBoundary(), assertSetupRecoveryHealthy,
    })
    : null)) : null;
  const roomImageProbeState = {
    credentialConfigured: resolvedRoomImageCredentialStore.status().configured,
    imageCapability: 'disabled',
    probe: { modelVisible: false, checkedAt: null },
  };
  const resolvedRoomImageAssetCatalogPath = roomImageAssetCatalogPath === undefined
    ? (householdConfigPath ? join(dirname(householdConfigPath), 'room-images', 'assets.json') : null)
    : roomImageAssetCatalogPath;
  let roomImageAssets = null;
  if (setupRecoveryResult.ok) {
    roomImageAssets = roomImageAssetStore || (resolvedRoomImageAssetCatalogPath
        && (roomImageJobs || roomImageAssetCatalogPath !== undefined || existsSync(resolvedRoomImageAssetCatalogPath)
          || roomImageAssetRoot !== '/assets' || existsSync(roomImageAssetRoot))
      ? roomImageAssetStoreFactory({
        catalogPath: resolvedRoomImageAssetCatalogPath, assetRoot: roomImageAssetRoot,
        now: roomImageNow, transactionStep: roomImagePublishStep, assertSetupRecoveryHealthy,
      })
      : null);
  } else if (resolvedRoomImageAssetCatalogPath && existsSync(resolvedRoomImageAssetCatalogPath)) {
    try {
      roomImageAssets = roomImageAssetStoreFactory({
        catalogPath: resolvedRoomImageAssetCatalogPath, assetRoot: roomImageAssetRoot,
        now: roomImageNow, transactionStep: roomImagePublishStep, readOnly: true,
        assertSetupRecoveryHealthy: () => undefined,
      });
    } catch { roomImageAssets = null; }
  }
  if (setupRecoveryResult.ok && roomImageJobs && roomImageAssets) {
    configMutations.runSync(() => {
      for (const record of roomImageJobs.records().filter((candidate) => candidate.phase === 'publishing_set')) {
        const recovery = roomImageAssets.recoveryState(record.reservedAssetId);
        if (recovery.type === 'complete') roomImageJobs.finishPublish(record.jobId, recovery.asset);
        else roomImageJobs.failPublish(record.jobId, recovery.type === 'required' ? 'PUBLISH_RECOVERY_REQUIRED' : 'PUBLISH_FAILED');
      }
      const retainedReservations = new Set(roomImageJobs.records()
        .map((record) => record.reservedAssetId).filter(Boolean));
      roomImageAssets.cleanupOrphans(retainedReservations);
    });
  }
  const roomImagePublishFlights = new Map();
  const laundry = createLaundryCoordinator({
    configStore,
    connectionMode: haConnectionMode,
    householdConfigPath,
    clientFactory: laundryClientFactory,
    replaceConfig: laundryReplaceConfig,
    now: laundryNow,
    sleep: laundrySleep,
    blueprintFile: laundryBlueprintFile,
    configMutations,
    assertSetupRecoveryHealthy,
  });
  /* B-08E11: Der Live-Kanal des App-Modus. Im direkten Modus existiert er
     nicht — dort spricht der Browser weiterhin selbst mit Home Assistant. */
  const haGateway = haGatewayFactory({
    connectionMode: haConnectionMode,
    originAllowed: (req) => requestOriginAllowed(req, allowedOrigins),
  });
  const httpServer = http.createServer((req, res) => {
    const effectiveMigrationResult = setupRecoveryFailureLatched
      ? setupRecoveryFailure()
      : migrationResult;
    const readinessOptions = {
      staticRoot,
      householdConfigPath,
      householdConfigMode: normalizedHouseholdConfigMode,
      requiredWritableDirs,
      migrationResult: effectiveMigrationResult,
    };
    const readiness = assessHmiReadiness(readinessOptions);
    const setupIsRequired = readiness.payload.status === 'setup_required';
    const targetPath = aiCustomizingEnabled ? proxyTargetPath(req.url || '/') : null;
    const notionTargetPath = notionBridgeTargetPath(req.url || '/');
    const laundryRoutes = new Set([
      '/api/laundry/existing/validate',
      '/api/laundry/existing/apply',
      '/api/laundry/blueprint/preview',
      '/api/laundry/blueprint/apply',
      '/api/laundry/disable/preview',
      '/api/laundry/disable/apply',
    ]);
    const laundryRoute = laundryRoutes.has(req.url || '') ? req.url : null;

    const songTarget = songTargetPath(req.url || '/');
    const familyDataRoute = (req.url || '').startsWith('/api/reminders');
    if ((req.url || '') === '/api/health') {
      serveHmiHealth(req, res, readinessOptions);
    } else if ((req.url || '') === '/api/build-info') {
      serveBuildInfo(req, res, buildInfo);
    } else if ((req.url || '') === '/api/ha/connection'
        && setupReadRequestAllowed(req, allowedOrigins)) {
      /* Sanitisierte Laufzeitauskunft: sagt Oberfläche und Runtime, ob dieser
         Server Home Assistant selbst vermittelt. Enthält keine Credentials und
         wird deshalb wie Health und Build-Info früh beantwortet. */
      serveHaConnection(res, {
        connectionMode: haConnectionMode,
        supervisorAvailable: haConnectionMode !== 'supervisor'
          || haSupervisorClientFactory().available,
      });
    } else if (hotelAdminGate.blocked(req)) {
      // Vor jeder anderen Auswertung: bei eingerichtetem Hotel Mode verlangen
      // sensitive Routen eine Adminsitzung, unabhängig davon, was die
      // Oberfläche gerade anzeigt.
      jsonResponse(res, 401, { code: 'HOTEL_ADMIN_REQUIRED', message: 'Adminsitzung erforderlich.' });
    } else if (!effectiveMigrationResult.ok && ((req.url || '').startsWith('/api/')
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
    } else if (serveRoomImages(req, res, {
      authConfig: roomImageAuthConfig,
      allowedOrigins,
      uploadStore: roomImageUploads,
      jobStore: roomImageJobs,
      jobRunner: roomImageRunner,
      previewValidator: roomImagePreviewValidator,
      testCapability: roomImageTestCapability,
      probeState: roomImageProbeState,
      credentialStore: resolvedRoomImageCredentialStore,
      now: roomImageNow,
      assetStore: roomImageAssets,
      householdConfigPath,
      configMutations,
      publishFlights: roomImagePublishFlights,
      publishStep: roomImagePublishStep,
      latchSetupRecoveryFailure,
      assertSetupRecoveryHealthy,
    })) {
      // Room-image capability and private auth are independent of setup/readiness routes.
    } else if (!aiCustomizingEnabled && (req.url || '').startsWith('/hermes')) {
      jsonResponse(res, 404, { error: 'Route nicht gefunden' });
    } else if ((req.url || '') === '/api/ha/caldav-flow'
        && setupRequestAllowed(req, allowedOrigins)) {
      void serveHaCaldavFlow(req, res, {
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      });
    } else if ((req.url || '') === '/api/setup/discovery'
        && setupReadRequestAllowed(req, allowedOrigins)) {
      void serveSetupDiscovery(res, {
        connectionMode: haConnectionMode,
        supervisorClientFactory: haSupervisorClientFactory,
      });
    } else if (setupIsRequired && (req.url || '') === '/api/setup/activate'
        && setupRequestAllowed(req, allowedOrigins)) {
      serveSetupActivation(req, res, {
        configStore,
        householdConfigPath,
        setupConnectionVerifier,
        setupJellyfinVerifier,
        configMutations,
        setupMutationStep,
        latchSetupRecoveryFailure,
        assertSetupRecoveryHealthy,
        connectionMode: haConnectionMode,
        supervisorConnectionVerifier: () => withSupervisorClient(
          haSupervisorClientFactory, verifySetupSupervisorHomeAssistant,
        ),
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
        configMutations,
        setupMutationStep,
        latchSetupRecoveryFailure,
        assertSetupRecoveryHealthy,
        reconfigure: true,
        connectionMode: haConnectionMode,
        supervisorConnectionVerifier: () => withSupervisorClient(
          haSupervisorClientFactory, verifySetupSupervisorHomeAssistant,
        ),
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
    } else if ((req.url || '').startsWith('/api/laundry')) {
      const origin = String(req.headers.origin || '');
      if (!readiness.ok || normalizedHouseholdConfigMode !== 'active') {
        jsonResponse(res, 503, {
          ok: false,
          code: 'LAUNDRY_NOT_READY',
          message: 'Die Wäsche-Konfiguration ist nur bei aktiver, bereiter Haushaltskonfiguration verfügbar.',
        });
      } else if (origin && !allowedOrigins.has(origin)) {
        jsonResponse(res, 403, {
          ok: false,
          code: 'LAUNDRY_ORIGIN_FORBIDDEN',
          message: 'Die Wäsche-Anfrage stammt nicht von einer freigegebenen Origin.',
        });
      } else if (!laundryRoute) {
        jsonResponse(res, 404, { ok: false, code: 'LAUNDRY_ROUTE_NOT_FOUND', message: 'Die Wäsche-Route wurde nicht gefunden.' });
      } else {
        serveLaundry(req, res, laundry, laundryRoute, origin);
      }
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
    } else if ((req.url || '').startsWith('/api/hotel-mode/') && hotelModeRequestAllowed(req, allowedOrigins)) {
      serveHotelModeSession(
        req, res, hotelAdminAccess, hotelStays, hotelGuestStates, hotelCommands, hotelSettings, hotelCheckouts,
      );
    } else if ((req.url || '').startsWith('/api/hotel-mode')) {
      jsonResponse(res, 403, { code: 'HOTEL_ROUTE_FORBIDDEN', message: 'Hotel-Mode-Route nicht freigegeben.' });
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
      if (requestOriginAllowed(req, allowedOrigins)) {
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
      serveConfig(req, res, configStore, configMutations, assertSetupRecoveryHealthy);
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
  httpServer.on('upgrade', (req, socket, head) => {
    /* Genau ein Pfad wird zum WebSocket erhoben; alles andere wird verworfen,
       damit hier keine allgemeine Bridge entsteht. */
    if (!haGateway.handlesUpgrade(req)) {
      socket.destroy();
      return;
    }
    haGateway.handleUpgrade(req, socket, head);
  });
  httpServer.on('close', () => haGateway.close());
  return httpServer;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let server;
  try {
    const householdConfigMode = normalizeHouseholdConfigMode(process.env.HMI_HOUSEHOLD_CONFIG_MODE);
    const setupRecoveryResult = recoverSetupConfigTransactions({
      configPath: CONFIG_PATH,
      householdConfigPath: HOUSEHOLD_CONFIG_PATH,
    });
    const migrationResult = !setupRecoveryResult.ok ? setupRecoveryResult : (householdConfigMode === 'active'
      ? migrateHouseholdConfigFile(HOUSEHOLD_CONFIG_PATH)
      : { ok: true, status: 'shadow' });
    const readiness = assessHmiReadiness({ householdConfigMode, migrationResult });
    if (!readiness.ok && readiness.payload.code !== 'SETUP_CONFIG_RECOVERY_REQUIRED') {
      const issue = readiness.payload.issue;
      const issueText = issue ? ` ${issue.path}: ${issue.message}` : '';
      throw new Error(`[${readiness.payload.code}] ${readiness.payload.message}${issueText}`);
    }
    server = createHmiServer(undefined, {
      householdConfigMode,
      householdConfigMigrationResult: migrationResult,
      setupConfigRecoveryResult: setupRecoveryResult,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'HMI-Server konnte nicht starten.');
    process.exit(1);
  }
  server.listen(PORT, HOST, () => console.log(`Smart Home HMI hört auf ${HOST}:${PORT}`));
}
