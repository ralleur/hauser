/* Laufzeitumgebung: Umgebungsvariablen, Pfade, Grenzwerte und die kompilierten Verträge.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHaConnectionMode } from './ha-supervisor.mjs';
import { AMBIENT_MAP_ASSET_DIRECTORY, AMBIENT_MAP_CONFIG_PATH } from './ambient-map-service.mjs';

const SERVER_CONTRACT_COMPILED = process.env.HMI_SERVER_CONTRACT === 'compiled';
const serverContractBase = SERVER_CONTRACT_COMPILED ? '../server-contract' : '../src/lib/config';
const serverContractExtension = SERVER_CONTRACT_COMPILED ? 'js' : 'ts';
const roomImageContractBase = SERVER_CONTRACT_COMPILED ? '../room-image-contract' : '../src/lib/room-images';
const roomImageContractExtension = SERVER_CONTRACT_COMPILED ? 'js' : 'ts';
export const { compileHouseholdConfig, parseHouseholdConfig } = await import(
  `${serverContractBase}/household-config.${serverContractExtension}`
);
export const { migrateHouseholdConfigDocument } = await import(
  `${serverContractBase}/household-config-migration.${serverContractExtension}`
);
export const { projectActiveHouseholdData } = await import(
  `${serverContractBase}/household-runtime-data.${serverContractExtension}`
);
export const { resolveBuildInfo } = await import(
  `${serverContractBase}/build-info.${serverContractExtension}`
);
export const {
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
export const {
  ROOM_IMAGE_TRANSFORM_POLICY_V1,
  RoomImageTransformError,
  assertProviderInputSize,
  finalAvifToProviderJpeg,
  normalizeUploadedRoomImage,
  providerPngToFinalAvif,
  providerPngToProviderJpeg,
  snapRoomImageCrop,
  sourceCropToProviderJpeg,
  sourceFullToProviderJpeg,
} = await import(`${roomImageContractBase}/room-image-transform-policy-v1.${roomImageContractExtension}`);
export const {
  ROOM_IMAGE_PROMPT_POLICY_V1,
  buildRoomImagePrompt,
  validateRoomImagePromptSpec,
} = await import(`${roomImageContractBase}/room-image-prompt-policy-v1.${roomImageContractExtension}`);
const {
  ROOM_IMAGE_PHONE_VARIANT_FILES,
  ROOM_IMAGE_PHONE_VARIANT_SOURCES,
} = await import(`${roomImageContractBase}/room-image-phone-variants.${roomImageContractExtension}`);
export const {
  deriveRoomImagePhoneVariants,
} = await import(`${roomImageContractBase}/room-image-phone-derivation-policy-v1.${roomImageContractExtension}`);
export const { default: sharp } = await import('sharp');

/* B-08E11: Betriebsart des Home-Assistant-Zugangs. `direct` ist der heutige
   Browser-zu-HA-Pfad mit Long-Lived Access Token und bleibt der Default für
   Compose und Entwicklung. `supervisor` ist der interne HA-Core-Zugang der
   Home-Assistant-App. Ein ungültiger Wert bricht den Start ab, statt still auf
   `direct` zurückzufallen. */
export const HA_CONNECTION_MODE = parseHaConnectionMode(process.env.HMI_HA_CONNECTION_MODE);

export const HOST = process.env.HMI_HOST || '0.0.0.0';
export const PORT = Number(process.env.HMI_PORT || 4173);
/* Herkunft der laufenden Fassung (AGPL §13). Version aus dem mitgelieferten
   Paketmanifest, Revision und Source-URL aus der Deployment-Umgebung — ein
   Fork muss auf seinen eigenen Corresponding Source zeigen können. */
export const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '';
  }
})();
export const HERMES_HOST = process.env.HMI_HERMES_HOST || '127.0.0.1';
export const HERMES_PORT = Number(process.env.HMI_HERMES_PORT || 8642);
export const AI_CUSTOMIZING_ENABLED = process.env.HMI_AI_CUSTOMIZING_ENABLED !== '0';
export const AMBIENT_HOST = process.env.HMI_AMBIENT_HOST || '127.0.0.1';
export const AMBIENT_PORT = Number(process.env.HMI_AMBIENT_PORT || 18088);

export const PAPERLESS_HOST = process.env.HMI_PAPERLESS_HOST || '127.0.0.1';
export const PAPERLESS_PORT = Number(process.env.HMI_PAPERLESS_PORT || 8000);
export const ACESTEP_HOST = process.env.HMI_ACESTEP_HOST || '127.0.0.1';
export const ACESTEP_PORT = Number(process.env.HMI_ACESTEP_PORT || 18001);
export const AMBIENT_MODEL = 'gpt-5.6-luna';
export const AMBIENT_BODY_MAX = 64 * 1024;
export const KEYCHAIN_SERVICE = process.env.HMI_KEYCHAIN_SERVICE || 'smart-home-hmi.hermes-api';
export const KEYCHAIN_ACCOUNT = process.env.HMI_KEYCHAIN_ACCOUNT || 'hmi-customizing';
export const ABLAGE_KEYCHAIN_SERVICE = process.env.HMI_ABLAGE_KEYCHAIN_SERVICE || 'smart-home-hmi.ablage';
export const ABLAGE_PIN_ACCOUNT = process.env.HMI_ABLAGE_PIN_ACCOUNT || 'pin';
export const ABLAGE_TOKEN_ACCOUNT = process.env.HMI_ABLAGE_TOKEN_ACCOUNT || 'paperless-token';
export const ABLAGE_SESSION_MS = 15 * 60 * 1000;
export const ABLAGE_BODY_MAX = 1024;
export const HOTEL_MODE_DATA_PATH = process.env.HMI_HOTEL_MODE_DATA_PATH || null;
export const HOTEL_MODE_DATA_VERSION = 1;
export const HOTEL_ADMIN_SESSION_MS = 15 * 60 * 1000;
export const HOTEL_ADMIN_BODY_MAX = 1024;
export const HOTEL_ADMIN_PIN_PATTERN = /^\d{6,12}$/;
export const HOTEL_ADMIN_ATTEMPTS_PER_BLOCK = 5;
export const HOTEL_ADMIN_BLOCK_BASE_MS = 60 * 1000;
export const HOTEL_ADMIN_BLOCK_MAX_MS = 15 * 60 * 1000;
export const HOTEL_ADMIN_SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const HOTEL_MODE_CACHE_MAX_STAYS = 32;
export const HOTEL_CALENDAR_CACHE_MS = 10 * 60 * 1000;
export const HOTEL_CALENDAR_LOOKBEHIND_MS = 2 * 24 * 60 * 60 * 1000;
export const HOTEL_CALENDAR_LOOKAHEAD_MS = 30 * 24 * 60 * 60 * 1000;
export const HOTEL_CALENDAR_TIMEOUT_MS = 5 * 1000;
export const HOTEL_CALENDAR_BODY_MAX = 512 * 1024;
export const HOTEL_STATE_TIMEOUT_MS = 5 * 1000;
export const HOTEL_COMMAND_TIMEOUT_MS = 5 * 1000;
export const HOTEL_SETTINGS_BODY_MAX = 64 * 1024;
export const HOTEL_STATE_BODY_MAX = 64 * 1024;
/* Ein Gastpanel pollt; die kurze Serversammlung hält Home Assistant aus dem
   Takt der Clients heraus, ohne dass sich eine Bedienung spürbar verzögert. */
export const HOTEL_STATE_CACHE_MS = 2 * 1000;
export const HOTEL_STATE_MAX_ENTITIES = 64;
export const HOTEL_OVERRIDE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
export const HOTEL_OVERRIDE_LEAD_MS = 30 * 24 * 60 * 60 * 1000;
export const ABLAGE_UPLOAD_MAX = Math.max(1, Number(process.env.HMI_ABLAGE_UPLOAD_MAX) || 52428800);
export const SONG_BODY_MAX = 4 * 1024;
export const SONG_STYLES = new Set(['Pop', 'Rock', 'Disco', 'Jazz', 'Hip-Hop', 'Metal', 'Indie', 'Britpop', 'Electronic', 'House', 'Funk', 'Soul', 'Country', 'Reggae', 'Classical']);
export const SONG_ERAS = new Set(['Heute', '2000er', '1990er', '1980er', '1970er', '1960er']);
export const SONG_VOICES = new Set(['Weiblich', 'Männlich', 'Duett', 'Instrumental']);
export const SONG_LYRICS_MODEL = 'gpt-5.6-luna';
export const SONG_LIBRARY_DIR = process.env.HMI_SONG_LIBRARY_DIR || resolve(homedir(), '.local', 'share', 'smart-home-hmi', 'songs');
export const SONG_LIBRARY_PATH = resolve(SONG_LIBRARY_DIR, 'library.json');
export const FAMILY_DATA_PATH = process.env.HMI_FAMILY_DATA_PATH || resolve(homedir(), '.local', 'share', 'smart-home-hmi', 'family-data.json');
export const FAMILY_DATA_SEED_PATH = fileURLToPath(new URL('../data/family-data.seed.json', import.meta.url));
/* Kalendermomente merken sich nur, in welcher Saison der erste Schnee fiel. */
export const MOMENTS_STATE_PATH = process.env.HMI_MOMENTS_STATE_PATH
  || resolve(dirname(FAMILY_DATA_PATH), 'moments-state.json');
export const ACESTEP_AUDIO_ROOT = process.env.HMI_ACESTEP_AUDIO_ROOT || '/path/to/ace-step-1.5/.cache/acestep/tmp/api_audio';

export const ALLOWED_ORIGINS = new Set(
  (process.env.HMI_ALLOWED_ORIGINS || 'https://dashboard.example.com,https://haus.example.com,http://localhost:4173,http://127.0.0.1:4173')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
);
export const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
export const CONFIG_PATH = process.env.HMI_CONFIG_PATH
  || resolve(homedir(), '.config', 'smart-home-hmi', 'config.json');
export const CONFIG_BODY_MAX = 1024 * 1024;
export const HOUSEHOLD_CONFIG_PATH = process.env.HMI_HOUSEHOLD_CONFIG_PATH || null;
/* Companion-App (Plan 21): gekoppelte Geräte neben der Konfiguration; die
   Fernzugriffs-Adresse setzt später der Tunnel-Sidecar. */
export const PAIRING_DEVICES_PATH = process.env.HMI_PAIRING_DEVICES_PATH
  || resolve(dirname(CONFIG_PATH), 'devices.json');
export const REMOTE_URL = process.env.HMI_REMOTE_URL || null;
export const HOUSEHOLD_CONFIG_BODY_MAX = 1024 * 1024;
export const HOUSEHOLD_CONFIG_MODE_HEADER = 'x-hmi-household-config-mode';
export const SETUP_TRANSACTION_VERSION = 1;
export const SETUP_TRANSACTION_DIRECTORY = '.hauser-setup-transactions';
export const SETUP_TRANSACTION_JOURNAL_PATTERN = /^setup-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.journal$/;
export const SETUP_TRANSACTION_MAX_BYTES = (CONFIG_BODY_MAX + HOUSEHOLD_CONFIG_BODY_MAX) * 4 + 64 * 1024;
export const LAUNDRY_BODY_MAX = 16 * 1024;
export const LAUNDRY_SESSION_TTL_MS = 2 * 60 * 1000;
export const LAUNDRY_BLUEPRINT_PATH = 'hauser/laundry-power-cycle-v1.yaml';
export const LAUNDRY_BLUEPRINT_FILE = fileURLToPath(new URL('../public/blueprints/automation/laundry-power-cycle-v1.yaml', import.meta.url));
/* Benachrichtigungsregeln (B-04B): Regelliste als kleine JSON-Datei, die
   Auslösung selbst liegt als Blueprint-Automation in Home Assistant. */
export const NOTIFICATION_RULES_PATH = process.env.HMI_NOTIFICATION_RULES_PATH
  || resolve(homedir(), '.local', 'share', 'smart-home-hmi', 'notification-rules.json');
export const NOTIFICATION_BLUEPRINT_DIR = fileURLToPath(new URL('../public/blueprints/automation/', import.meta.url));
export const NOTIFICATION_BLUEPRINTS = Object.freeze({
  state: { path: 'hauser/notify-state-v1.yaml', file: 'notify-state-v1.yaml' },
  above: { path: 'hauser/notify-above-v1.yaml', file: 'notify-above-v1.yaml' },
  below: { path: 'hauser/notify-below-v1.yaml', file: 'notify-below-v1.yaml' },
});
export const NOTIFICATION_AUTOMATION_PREFIX = 'hauser_notif_';
export const NOTIFICATION_ID_PREFIX = 'hauser_rule_';
export const NOTIFICATION_CATEGORY_IDS = new Set([
  'laundry', 'doors-windows', 'motion-presence', 'safety', 'climate', 'device-health', 'energy', 'custom',
]);
export const NOTIFICATION_COLORS = new Set(['info', 'success', 'warning', 'critical', 'neutral']);
export const REQUIRED_WRITABLE_DIRS = (process.env.HMI_REQUIRED_WRITABLE_DIRS || '')
  .split(',').map((path) => path.trim()).filter(Boolean);
/* AMBIENT-MAP S3: Standortkonfiguration und Kartenasset gehören dem Server.
   Die Defaults sind exakt die Produktionspfade aus Plan §5.3; die
   Environmentwerte existieren nur für Deployments, die `/data` und `/assets`
   an anderer Stelle einhängen. Aus dem Browser ist kein Pfad wählbar. */
export const AMBIENT_MAP_SERVER_CONFIG_PATH = process.env.HMI_AMBIENT_MAP_CONFIG_PATH || AMBIENT_MAP_CONFIG_PATH;
export const AMBIENT_MAP_SERVER_ASSET_DIRECTORY = process.env.HMI_AMBIENT_MAP_ASSET_ROOT || AMBIENT_MAP_ASSET_DIRECTORY;
export const AMBIENT_MAP_HA_TIMEOUT_MS = 5_000;
export const AMBIENT_MAP_HA_BODY_MAX = 256 * 1024;
export const ROOM_IMAGE_WIZARD_ENABLED = true;
export const ROOM_IMAGE_UPLOAD_MAX_BYTES = 12_582_912;
export const ROOM_IMAGE_UPLOAD_TTL_MS = 30 * 60 * 1000;
const ROOM_IMAGE_TEST_ROOT_OVERRIDE = process.env.NODE_ENV === 'test'
  && process.env.HMI_ROOM_IMAGE_TEST_ROOT_OVERRIDE === '1';
export const ROOM_IMAGE_UPLOAD_ROOT = ROOM_IMAGE_TEST_ROOT_OVERRIDE
  ? process.env.HMI_ROOM_IMAGE_UPLOAD_ROOT || '/tmp/hauser-room-images/uploads'
  : '/tmp/hauser-room-images/uploads';
export const ROOM_IMAGE_PROVIDER_MODEL = 'gpt-image-2-2026-04-21';
export const ROOM_IMAGE_PROVIDER_MODELS_URL = `https://api.openai.com/v1/models/${ROOM_IMAGE_PROVIDER_MODEL}`;
export const ROOM_IMAGE_PROVIDER_EDITS_URL = 'https://api.openai.com/v1/images/edits';
/* Fenstererkennung (Paket 13): ein sehfähiges Chatmodell beim selben Anbieter.
   Die Bildendpunkte geben nur Bilder zurück, keinen Text — deshalb ein eigenes
   Modell und ein eigener Aufruf. Über die Umgebung austauschbar, damit ein
   Konto mit neuerem Angebot nicht auf einen Neubau warten muss. */
export const ROOM_IMAGE_VISION_MODEL = process.env.HMI_ROOM_IMAGE_VISION_MODEL || 'gpt-4o';
/* Dasselbe für die ChatGPT-Anmeldung: das Codex-Backend führt eigene Modelle,
   die es im öffentlichen API-Katalog nicht gibt. */
export const ROOM_IMAGE_CODEX_VISION_MODEL = process.env.HMI_ROOM_IMAGE_CODEX_VISION_MODEL || 'gpt-5.6-sol';
export const ROOM_IMAGE_VISION_URL = 'https://api.openai.com/v1/chat/completions';
export const ROOM_IMAGE_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const ROOM_IMAGE_CODEX_AUTH_URL = 'https://auth.openai.com';
export const ROOM_IMAGE_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const ROOM_IMAGE_CODEX_TOKEN_URL = `${ROOM_IMAGE_CODEX_AUTH_URL}/oauth/token`;
export const ROOM_IMAGE_CODEX_IMAGE_MODEL = 'gpt-image-2';
export const ROOM_IMAGE_CREDENTIAL_PATH = process.env.HMI_ROOM_IMAGE_CREDENTIAL_PATH
  || resolve(dirname(CONFIG_PATH), 'room-image-auth.json');
export const ROOM_IMAGE_PROVIDER_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const ROOM_IMAGE_PROVIDER_MAX_JSON_RESPONSE_BYTES = 100 * 1024 * 1024;
export const ROOM_IMAGE_PROVIDER_MAX_BASE64_BYTES = 96 * 1024 * 1024;
export const ROOM_IMAGE_PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
export const ROOM_IMAGE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ROOM_IMAGE_JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const ROOM_IMAGE_EDIT_DEADLINE_MS = 300_000;
export const ROOM_IMAGE_PROBE_DEADLINE_MS = 10_000;
export const ROOM_IMAGE_TEMP_ROOT = ROOM_IMAGE_TEST_ROOT_OVERRIDE
  ? process.env.HMI_ROOM_IMAGE_TEMP_ROOT || '/tmp/hauser-room-images'
  : '/tmp/hauser-room-images';
export const ROOM_IMAGE_ASSET_ROOT = process.env.HMI_ROOM_IMAGE_ASSET_ROOT || '/assets';
export const ROOM_IMAGE_ASSET_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;
export const ROOM_IMAGE_ROOM_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
/* B-27 D2: Die Phone-Ableitungen gehoeren zum Asset, nicht zu einem
   Nebenpfad. Damit kann kein Asset im Katalog aktiv sein, ohne dass seine
   Phone-Fassung mit passendem Hash danebenliegt. */
export const ROOM_IMAGE_FINAL_VARIANT_FILES = Object.freeze({
  light: 'light.avif', dark: 'dark.avif', darkOff: 'dark-off.avif',
});
export const ROOM_IMAGE_VARIANT_FILES = Object.freeze({
  ...ROOM_IMAGE_FINAL_VARIANT_FILES, ...ROOM_IMAGE_PHONE_VARIANT_FILES,
});
/* Trübe Variante (Paket 13): bewusst OPTIONAL. Sie kostet einen weiteren
   Modellaufruf und entsteht deshalb nachträglich — ein Bildset ohne sie ist
   vollständig, nicht kaputt. Deshalb steht sie nicht in
   ROOM_IMAGE_VARIANT_FILES, gegen das der Assetstore auf Vollständigkeit
   prüft, sondern daneben. */
export const ROOM_IMAGE_OPTIONAL_VARIANT_FILES = Object.freeze({ overcast: 'overcast.avif' });
export const ROOM_IMAGE_OPTIONAL_VARIANT_KEYS = Object.freeze(Object.keys(ROOM_IMAGE_OPTIONAL_VARIANT_FILES));
export const ROOM_IMAGE_VARIANT_KEYS = Object.freeze(Object.keys(ROOM_IMAGE_VARIANT_FILES));
export const ROOM_IMAGE_FINAL_VARIANT_KEYS = Object.freeze(Object.keys(ROOM_IMAGE_FINAL_VARIANT_FILES));
export const ROOM_IMAGE_MANIFEST_VERSION = 2;
export const SHARED_CONFIG_KEYS = new Set([
  'hmi:backend', 'hmi:ha-url', 'hmi:ha-token', 'hmi:jf-url', 'hmi:jf-token',
  'hmi:jf-user', 'hmi:library', 'hmi:lock-button',
  'hmi:device-config:v1', 'hmi:scene-config:v1', 'hmi:home-layout:v1',
  'hmi:light-icon-overrides:v1', 'hmi:calendar-selected', 'hmi:reminders-selected',
  'hmi:moment-holidays:v1',
  'hmi:shopping-config:v1', 'hmi:reminder-persons:v1',
  'hmi:paperless-url', 'hmi:paperless-token',
  'hmi:notion-token', 'hmi:notion-page',
]);
const SHARED_CONFIG_VALUE_MAX = 256 * 1024;

export function validSharedConfigValue(value) {
  return typeof value === 'string' && Buffer.byteLength(value) <= SHARED_CONFIG_VALUE_MAX;
}

export function validSharedConfigDocument(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => (
      SHARED_CONFIG_KEYS.has(key) && validSharedConfigValue(entry)
    ));
}

export const MIME = new Map([
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
