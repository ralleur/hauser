/* Sichern und Wiederherstellen (Cpt.Hardy, Postfach 2026-10-03: „langsam
   sollte man über eine backup/restore Funktion nachdenken“).

   Eine Sicherung ist eine einzige Datei: gzip-komprimiertes JSON mit dem
   Haushalt (Räume, Geräte, Szenen), der geteilten Konfiguration, den
   Familiendaten, den Benachrichtigungsregeln und allen Raumbildern samt
   Katalog. Zugangsdaten bleiben draußen — HA-Token, Jellyfin-, Paperless- und
   Notion-Token, Ablage-PIN, Raumbild-Anmeldung und gekoppelte Geräte gehören
   zur Installation, nicht zum Haushalt, und sollen nicht in einer Datei im
   Download-Ordner liegen. Beim Wiederherstellen bleiben sie, wie sie sind.

   Wiederherstellen ersetzt den Bestand. Vorher legt der Server eine Sicherung
   des alten Stands neben die Haushaltsdatei (`backups/`), und alles wird
   geprüft, bevor die erste Datei geschrieben wird: ein Haushalt, den der
   Server beim Start nicht laden könnte, erreicht die Platte nie. Danach
   startet der Dienst neu, weil Raumbildkatalog, Familiendaten und Regeln beim
   Start geladen werden — Exit 75 heißt für Container-Einstieg und launchd
   „bitte wieder hochfahren“. */
import { randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  migrateHouseholdConfigDocument,
  parseHouseholdConfig,
  ROOM_IMAGE_ASSET_ID_PATTERN,
  SHARED_CONFIG_KEYS,
  validSharedConfigValue,
} from './runtime-env.mjs';
import { flushDirectory, jsonResponse } from './shared.mjs';

export const BACKUP_FORMAT = 'hauser-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_RESTART_EXIT_CODE = 75;
const BACKUP_UPLOAD_MAX = 512 * 1024 * 1024;
const BACKUP_FILE_MAX = 4 * 1024 * 1024;
const KEEP_SAFETY_COPIES = 5;

/* Zugangsdaten und die Adresse der eigenen HA-Instanz: gehören zur
   Installation, nicht zum Haushalt. */
export const BACKUP_EXCLUDED_CONFIG_KEYS = new Set([
  'hmi:ha-url', 'hmi:ha-token', 'hmi:jf-token', 'hmi:paperless-token', 'hmi:ablage-pin', 'hmi:notion-token',
]);
const DATA_FILES = ['familyData', 'notificationRules', 'momentsState', 'ambientMap'];
const ROOM_IMAGE_FILE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}\.(avif|jpg|jpeg|png|webp|json)$/;

export class BackupError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function readTextIfPresent(path) {
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function roomImageSetsRoot(assetRoot) {
  return assetRoot ? join(assetRoot, 'room-images') : null;
}

function collectRoomImageSets(assetRoot) {
  const root = roomImageSetsRoot(assetRoot);
  const sets = {};
  if (!root || !existsSync(root)) return sets;
  for (const setId of readdirSync(root)) {
    if (!ROOM_IMAGE_ASSET_ID_PATTERN.test(setId)) continue;
    const setPath = join(root, setId);
    if (!statSync(setPath).isDirectory()) continue;
    for (const file of readdirSync(setPath)) {
      if (!ROOM_IMAGE_FILE_PATTERN.test(file)) continue;
      const filePath = join(setPath, file);
      if (!statSync(filePath).isFile()) continue;
      sets[`${setId}/${file}`] = readFileSync(filePath).toString('base64');
    }
  }
  return sets;
}

function sharedConfigForBackup(configPath) {
  let parsed = {};
  try { parsed = JSON.parse(readFileSync(configPath, 'utf8')); } catch { parsed = {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => (
    SHARED_CONFIG_KEYS.has(key) && !BACKUP_EXCLUDED_CONFIG_KEYS.has(key) && validSharedConfigValue(value)
  )));
}

/** Liest den aktuellen Bestand in ein Sicherungsdokument. */
export function createBackupDocument(paths, { version = '', now = () => new Date() } = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now().toISOString(),
    appVersion: version,
    household: readTextIfPresent(paths.householdConfigPath),
    config: sharedConfigForBackup(paths.configPath),
    files: Object.fromEntries(DATA_FILES.map((name) => [name, readTextIfPresent(paths[`${name}Path`])])),
    roomImages: {
      catalog: readTextIfPresent(paths.roomImageCatalogPath),
      files: collectRoomImageSets(paths.roomImageAssetRoot),
    },
  };
}

export function encodeBackup(document) {
  return gzipSync(Buffer.from(JSON.stringify(document)));
}

function invalid(message) {
  return new BackupError('BACKUP_INVALID', message);
}

function validJsonText(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value) > BACKUP_FILE_MAX) throw invalid(`${label} ist beschädigt.`);
  try { JSON.parse(value); } catch { throw invalid(`${label} ist beschädigt.`); }
  return value;
}

/** Entpackt und prüft eine Sicherung vollständig, bevor irgendetwas geschrieben wird. */
export function decodeBackup(bytes) {
  let document;
  try {
    document = JSON.parse(gunzipSync(bytes, { maxOutputLength: BACKUP_UPLOAD_MAX * 2 }).toString('utf8'));
  } catch {
    throw invalid('Die Datei ist keine Hauser-Sicherung.');
  }
  if (!document || typeof document !== 'object' || document.format !== BACKUP_FORMAT) {
    throw invalid('Die Datei ist keine Hauser-Sicherung.');
  }
  if (document.version !== BACKUP_VERSION) {
    throw new BackupError('BACKUP_VERSION_UNSUPPORTED', 'Diese Sicherung stammt aus einer neueren Hauser-Version.');
  }

  const household = validJsonText(document.household ?? null, 'Der Haushalt');
  if (household === null) throw invalid('Die Sicherung enthält keinen Haushalt.');
  const migration = migrateHouseholdConfigDocument(JSON.parse(household));
  if (!migration.ok || !parseHouseholdConfig(migration.document).ok) {
    throw invalid('Der Haushalt in der Sicherung lässt sich nicht laden.');
  }

  const config = document.config ?? {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw invalid('Die Einstellungen sind beschädigt.');
  for (const [key, value] of Object.entries(config)) {
    if (!SHARED_CONFIG_KEYS.has(key) || BACKUP_EXCLUDED_CONFIG_KEYS.has(key) || !validSharedConfigValue(value)) {
      throw invalid('Die Einstellungen sind beschädigt.');
    }
  }

  const files = {};
  for (const name of DATA_FILES) files[name] = validJsonText(document.files?.[name] ?? null, 'Eine Datendatei');

  const catalog = validJsonText(document.roomImages?.catalog ?? null, 'Der Bildkatalog');
  const imageFiles = document.roomImages?.files ?? {};
  if (!imageFiles || typeof imageFiles !== 'object' || Array.isArray(imageFiles)) throw invalid('Die Raumbilder sind beschädigt.');
  const images = [];
  for (const [path, data] of Object.entries(imageFiles)) {
    const [setId, file, rest] = path.split('/');
    if (rest !== undefined || !ROOM_IMAGE_ASSET_ID_PATTERN.test(setId ?? '') || !ROOM_IMAGE_FILE_PATTERN.test(file ?? '')
        || typeof data !== 'string') {
      throw invalid('Die Raumbilder sind beschädigt.');
    }
    images.push({ setId, file, bytes: Buffer.from(data, 'base64') });
  }

  return { createdAt: typeof document.createdAt === 'string' ? document.createdAt : null, household, config, files, catalog, images };
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.restore-${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o600, flush: true });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  flushDirectory(dirname(path));
}

function replaceOrRemove(path, text) {
  if (!path) return;
  if (text === null) {
    try { unlinkSync(path); } catch { /* war ohnehin nicht da */ }
    return;
  }
  writeAtomic(path, text);
}

function pruneSafetyCopies(directory) {
  const copies = readdirSync(directory).filter((name) => name.startsWith('vor-wiederherstellung-')).sort();
  for (const name of copies.slice(0, Math.max(0, copies.length - KEEP_SAFETY_COPIES))) {
    rmSync(join(directory, name), { force: true });
  }
}

/** Ersetzt den Bestand durch die geprüfte Sicherung; der alte Stand bleibt als Datei unter `backups/`. */
export function restoreBackup(paths, restored, { version = '', now = () => new Date() } = {}) {
  const safetyDirectory = join(dirname(paths.householdConfigPath), 'backups');
  mkdirSync(safetyDirectory, { recursive: true, mode: 0o700 });
  const stamp = now().toISOString().replace(/[:.]/g, '-');
  const safetyPath = join(safetyDirectory, `vor-wiederherstellung-${stamp}.hauser`);
  writeFileSync(safetyPath, encodeBackup(createBackupDocument(paths, { version, now })), { mode: 0o600, flush: true });
  pruneSafetyCopies(safetyDirectory);

  /* Bilder zuerst und als Ganzes: der Katalog darf nie auf ein Set zeigen,
     dessen Dateien fehlen — der Assetstore verweigert sonst den Start. */
  const setsRoot = roomImageSetsRoot(paths.roomImageAssetRoot);
  if (setsRoot) {
    const staging = join(paths.roomImageAssetRoot, `.restore-${randomBytes(8).toString('hex')}`);
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    for (const { setId, file, bytes } of restored.images) {
      mkdirSync(join(staging, setId), { recursive: true, mode: 0o700 });
      writeFileSync(join(staging, setId, file), bytes, { mode: 0o600 });
    }
    const previous = existsSync(setsRoot) ? `${setsRoot}.alt-${randomBytes(8).toString('hex')}` : null;
    if (previous) renameSync(setsRoot, previous);
    renameSync(staging, setsRoot);
    flushDirectory(paths.roomImageAssetRoot);
    if (previous) rmSync(previous, { recursive: true, force: true });
  }
  replaceOrRemove(paths.roomImageCatalogPath, restored.catalog);

  for (const name of DATA_FILES) replaceOrRemove(paths[`${name}Path`], restored.files[name]);

  /* Zugangsdaten des laufenden Hauses bleiben, alles andere kommt aus der Sicherung. */
  let current = {};
  try { current = JSON.parse(readFileSync(paths.configPath, 'utf8')) ?? {}; } catch { current = {}; }
  const kept = Object.fromEntries(Object.entries(current).filter(([key]) => BACKUP_EXCLUDED_CONFIG_KEYS.has(key)));
  writeAtomic(paths.configPath, `${JSON.stringify({ ...restored.config, ...kept }, null, 2)}\n`);

  writeAtomic(paths.householdConfigPath, restored.household);
  return { safetyPath };
}

function backupFileName(now) {
  return `hauser-sicherung-${now.toISOString().slice(0, 10)}.hauser`;
}

function readBody(req, maxBytes) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectPromise(new BackupError('BACKUP_TOO_LARGE', 'Die Sicherung ist zu groß.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks)));
    req.on('error', rejectPromise);
  });
}

export function backupRoute(url) {
  const pathname = new URL(url || '/', 'http://hmi.local').pathname;
  return pathname === '/api/backup' || pathname === '/api/backup/restore' ? pathname : null;
}

/**
 * `GET /api/backup` liefert die Sicherung als Download, `POST
 * /api/backup/restore` nimmt sie als Rohdaten entgegen und startet danach neu.
 */
export async function serveBackup(req, res, route, {
  paths, configMutations, version = '', now = () => new Date(), requestRestart,
}) {
  if (!paths.householdConfigPath) {
    jsonResponse(res, 503, { ok: false, code: 'BACKUP_UNAVAILABLE', message: 'Dieser Server führt keinen Haushalt.' });
    return;
  }
  if (req.hauserDevice?.guest) {
    jsonResponse(res, 403, { ok: false, code: 'BACKUP_FORBIDDEN', message: 'Gäste können keine Sicherung anlegen.' });
    return;
  }
  try {
    if (route === '/api/backup' && req.method === 'GET') {
      const bytes = configMutations.runSync(() => encodeBackup(createBackupDocument(paths, { version, now })));
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Length': bytes.length,
        'Content-Disposition': `attachment; filename="${backupFileName(now())}"`,
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
      return;
    }
    if (route === '/api/backup/restore' && req.method === 'POST') {
      const restored = decodeBackup(await readBody(req, BACKUP_UPLOAD_MAX));
      configMutations.runSync(() => restoreBackup(paths, restored, { version, now }));
      jsonResponse(res, 200, { ok: true, restarting: true, createdAt: restored.createdAt });
      res.on('finish', () => requestRestart());
      return;
    }
    jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Methode nicht erlaubt.' });
  } catch (error) {
    if (error instanceof BackupError) {
      jsonResponse(res, error.status, { ok: false, code: error.code, message: error.message });
      return;
    }
    console.error('[hauser] Sicherung fehlgeschlagen:', error instanceof Error ? error.message : String(error));
    jsonResponse(res, 500, { ok: false, code: 'BACKUP_FAILED', message: 'Die Sicherung ist fehlgeschlagen.' });
  }
}
