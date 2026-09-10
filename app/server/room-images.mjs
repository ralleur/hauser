/* Raumbilder: Zugriffsschutz, Upload-, Job- und Asset-Speicher, Provider, Job-Runner und Routen.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { validRegionsRecord } from './room-image-regions.mjs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  ROOM_IMAGE_ASSET_ID_PATTERN,
  ROOM_IMAGE_ASSET_ROOT,
  ROOM_IMAGE_CLIENT_REQUEST_ID_PATTERN,
  ROOM_IMAGE_CODEX_AUTH_URL,
  ROOM_IMAGE_CODEX_BASE_URL,
  ROOM_IMAGE_CODEX_CLIENT_ID,
  ROOM_IMAGE_CODEX_IMAGE_MODEL,
  ROOM_IMAGE_CODEX_TOKEN_URL,
  ROOM_IMAGE_CREDENTIAL_PATH,
  ROOM_IMAGE_EDIT_DEADLINE_MS,
  ROOM_IMAGE_FINAL_VARIANT_FILES,
  ROOM_IMAGE_FINAL_VARIANT_KEYS,
  ROOM_IMAGE_ID_PATTERN,
  ROOM_IMAGE_JOB_TTL_MS,
  ROOM_IMAGE_MANIFEST_VERSION,
  ROOM_IMAGE_PNG_SIGNATURE,
  ROOM_IMAGE_PROBE_DEADLINE_MS,
  ROOM_IMAGE_PROMPT_POLICY_V1,
  ROOM_IMAGE_PROVIDER_EDITS_URL,
  ROOM_IMAGE_PROVIDER_MAX_BASE64_BYTES,
  ROOM_IMAGE_PROVIDER_MAX_JSON_RESPONSE_BYTES,
  ROOM_IMAGE_PROVIDER_MODEL,
  ROOM_IMAGE_PROVIDER_MODELS_URL,
  ROOM_IMAGE_PROVIDER_REQUEST_ID_PATTERN,
  ROOM_IMAGE_ROOM_ID_PATTERN,
  ROOM_IMAGE_TEMP_ROOT,
  ROOM_IMAGE_TRANSFORM_POLICY_V1,
  ROOM_IMAGE_UPLOAD_MAX_BYTES,
  ROOM_IMAGE_UPLOAD_ROOT,
  ROOM_IMAGE_UPLOAD_TTL_MS,
  ROOM_IMAGE_VARIANT_FILES,
  ROOM_IMAGE_OPTIONAL_VARIANT_FILES,
  ROOM_IMAGE_OPTIONAL_VARIANT_KEYS,
  ROOM_IMAGE_VARIANT_KEYS,
  ROOM_IMAGE_WIZARD_ENABLED,
  RoomImageTransformError,
  assertProviderInputSize,
  buildRoomImagePrompt,
  deriveRoomImagePhoneVariants,
  normalizeUploadedRoomImage,
  providerPngToFinalAvif,
  providerPngToProviderJpeg,
  sharp,
  snapRoomImageCrop,
  sourceFullToProviderJpeg,
  validateRoomImagePromptSpec,
} from './runtime-env.mjs';
import {
  RoomImageAssetStoreError,
  RoomImageRequestError,
  canonicalRoomImageAssetPath,
  flushDirectory,
  inspectRoomImageAssetPath,
  jsonResponse,
  rawHeaderValues,
  readRoomImageJsonBody,
  roomImageAssetStoreError,
  roomImageError,
  roomImageJsonResponse,
  sameOriginAsRequest,
} from './shared.mjs';
import {
  isSetupRecoveryRequiredError,
  readRoomImageHouseholdSnapshot,
  setupRecoveryFailure,
  writeRoomImageHousehold,
} from './config-core.mjs';

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

  /* Welche Datensätze die Verweisregeln verletzen — mit Regelname, damit das
     Log beim Start sagt, welcher Job das Haus blockiert hätte. */
  function referenceViolations() {
    const violations = [];
    const flag = (record, rule) => { violations.push({ jobId: record.jobId, rule }); };
    const recordsByAttemptId = new Map();
    const finalCandidateKeys = new Set();
    const tempOwners = new Map();
    const lineageAggregates = new Map();
    const wizardAggregates = new Map();
    for (const record of jobs.values()) {
      if (recordsByAttemptId.has(record.attemptId)) flag(record, 'duplicate_attempt');
      recordsByAttemptId.set(record.attemptId, record);
      const attemptCounters = derivedRoomImageAttemptCounters(record);
      for (const [aggregates, id] of [[lineageAggregates, record.lineageId], [wizardAggregates, record.wizardId]]) {
        const aggregate = aggregates.get(id) ?? roomImageCounters();
        for (const key of ROOM_IMAGE_COUNTER_KEYS) aggregate[key] += attemptCounters[key];
        aggregates.set(id, aggregate);
      }
      for (const reference of allTempNames(record)) {
        if (tempOwners.has(reference)) flag(record, 'shared_temp');
        tempOwners.set(reference, record.jobId);
      }
      if (record.kind === 'variant_set') {
        const key = `${record.request.parentJobId}\u0000${record.request.candidateId}`;
        if (finalCandidateKeys.has(key)) flag(record, 'duplicate_final');
        finalCandidateKeys.add(key);
      }
    }
    for (const record of jobs.values()) {
      if (!ROOM_IMAGE_COUNTER_KEYS.every((key) => (
        record.providerCalls.lineage[key] === lineageAggregates.get(record.lineageId)[key]
        && record.providerCalls.wizard[key] === wizardAggregates.get(record.wizardId)[key]
      ))) flag(record, 'counters');
      if (record.kind === 'variant_set') {
        const parent = jobs.get(record.request.parentJobId);
        if (!parent || parent.kind !== 'main_candidates'
            || parent.owner !== record.owner || parent.wizardId !== record.wizardId
            || parent.expiresAt !== record.expiresAt
            || JSON.stringify(parent.policy.spec) !== JSON.stringify(record.policy.spec)) flag(record, 'variant_parent');
      }
      if (record.parentAttemptId !== null) {
        const parent = recordsByAttemptId.get(record.parentAttemptId);
        if (!parent || parent.status !== 'superseded' || parent.supersededByJobId !== record.jobId
            || parent.owner !== record.owner || parent.kind !== record.kind
            || parent.lineageId !== record.lineageId || parent.wizardId !== record.wizardId
            || parent.expiresAt !== record.expiresAt) flag(record, 'retry_parent');
      }
      if (record.status === 'superseded') {
        const successor = jobs.get(record.supersededByJobId);
        if (!successor || successor.parentAttemptId !== record.attemptId) flag(record, 'successor');
      }
      if (record.kind === 'main_candidates' && record.status === 'succeeded' && record.temp.source === null) {
        const finals = [...jobs.values()].filter((candidate) => (
          candidate.kind === 'variant_set' && candidate.request.parentJobId === record.jobId
        ));
        if (finals.length !== 1) flag(record, 'final_count');
      }
    }
    return violations;
  }

  function validStoredReferences() {
    return referenceViolations().length === 0;
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
    const violations = referenceViolations();
    if (violations.length > 0) {
      const detail = violations.slice(0, 6).map((entry) => `${entry.jobId} (${entry.rule})`).join(', ');
      throw roomImageJobStoreError(`Inkohärente Room-Image-Jobreferenzen: ${detail}${violations.length > 6 ? ', …' : ''}`);
    }
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

function roomImageAssetPublic(assetId, focus, entry = null) {
  const variants = {
    light: `/assets/room-images/${assetId}/light.avif`,
    dark: `/assets/room-images/${assetId}/dark.avif`,
    darkOff: `/assets/room-images/${assetId}/dark-off.avif`,
  };
  /* Optionale Teile (Paket 13) erscheinen nur, wenn das Set sie wirklich hat:
     die trübe Variante als weitere Adresse, die Fenster als Polygone. */
  for (const key of ROOM_IMAGE_OPTIONAL_VARIANT_KEYS) {
    if (entry?.files?.[key]) {
      variants[key] = `/assets/room-images/${assetId}/${ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key]}`;
    }
  }
  return {
    assetId,
    variants,
    focus: structuredClone(focus),
    ...(entry?.regions ? { regions: structuredClone(entry.regions) } : {}),
  };
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

/* Die Dateiliste eines Eintrags: Pflichtvarianten plus die optionalen, die er
   ausweist (Paket 13). Alles andere ist ein Fremdkörper. */
function roomImageEntryFileKeys(entry) {
  return [
    ...ROOM_IMAGE_VARIANT_KEYS,
    ...ROOM_IMAGE_OPTIONAL_VARIANT_KEYS.filter((key) => entry?.files?.[key]),
  ];
}

function validRoomImageCatalogEntry(entry) {
  /* `regions` ist optional (Paket 13): Bildsets von vor der Flächenerkennung
     bleiben gültig, und ein Katalog ohne das Feld darf nicht abgewiesen
     werden. Ist es da, muss es vollständig stimmen.

     `windows` ist der Vorgängername aus derselben Woche. Er wird geduldet und
     ignoriert, damit ein Katalog aus der Zwischenzeit nicht das ganze Bildset
     ungültig macht; geschrieben wird er nicht mehr. */
  const optional = [];
  if (Object.hasOwn(entry ?? {}, 'regions')) optional.push('regions');
  if (Object.hasOwn(entry ?? {}, 'windows')) optional.push('windows');
  if (optional.includes('regions') && !validRegionsRecord(entry.regions)) return false;
  if (!roomImageExactObject(entry, [
    'assetId', 'variants', 'focus', 'createdAt', 'status', 'files', 'manifestSha256',
    ...optional,
  ])
      || !ROOM_IMAGE_ASSET_ID_PATTERN.test(entry.assetId || '')
      || !roomImageExactObject(entry.variants, roomImageEntryFileKeys(entry))
      || !Object.entries(ROOM_IMAGE_VARIANT_FILES).every(([key, name]) => entry.variants[key] === name)
      || !ROOM_IMAGE_OPTIONAL_VARIANT_KEYS.filter((key) => entry.files?.[key])
        .every((key) => entry.variants[key] === ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key])
      || !validStoredRoomImageFocus(entry.focus)
      || typeof entry.createdAt !== 'string' || Number.isNaN(Date.parse(entry.createdAt))
      || !['active', 'tombstone'].includes(entry.status)
      || !roomImageExactObject(entry.files, roomImageEntryFileKeys(entry))
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
  /* Damit die Warnung einmal je Stand erscheint und nicht bei jedem Lesen. */
  let reportedDroppedEntries = 0;
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
  /* Ein einzelnes unbrauchbares Bildset darf das Haus nicht am Starten
     hindern. Bis 0.12.0 lehnte der Store den ganzen Katalog ab, sobald ein
     Eintrag den Vertrag verletzte — nach einem Sprung ueber mehrere Versionen
     genuegte dafuer ein Set, dessen Dateien beim Nachziehen der
     Phone-Ableitungen verlorengingen, und der Dienst kam nicht mehr hoch.

     Der Vertrag selbst bleibt geschlossen: Was ihn verletzt, wird nicht
     geladen, nicht ausgeliefert und beim naechsten Schreiben nicht wieder
     mitgeschrieben. Der Raum faellt auf sein Standardbild zurueck, statt das
     ganze Haus mitzunehmen. Doppelte Ids bleiben hart — sie sind kein
     beschaedigtes Set, sondern ein beschaedigter Katalog. */
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
        || !Array.isArray(document.assets)) {
      throw roomImageAssetStoreError('Der Room-Image-Katalog verletzt den geschlossenen Vertrag.');
    }
    const assets = document.assets.filter(validRoomImageCatalogEntry);
    if (new Set(assets.map((entry) => entry.assetId)).size !== assets.length) {
      throw roomImageAssetStoreError('Der Room-Image-Katalog verletzt den geschlossenen Vertrag.');
    }
    const dropped = document.assets.length - assets.length;
    if (dropped > 0 && dropped !== reportedDroppedEntries) {
      reportedDroppedEntries = dropped;
      const ids = document.assets
        .filter((entry) => !validRoomImageCatalogEntry(entry))
        .map((entry) => (typeof entry?.assetId === 'string' ? entry.assetId : '?'))
        .join(', ');
      console.warn(`[hauser] ${dropped} Raumbild-Set(s) uebergangen — unvollstaendig oder vertragswidrig: ${ids}. Die betroffenen Raeume zeigen ihr Standardbild.`);
    }
    return { version: 1, assets };
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
      /* Pflichtdateien müssen alle da sein; darüber hinaus ist nur erlaubt,
         was der Katalog als optionale Variante ausweist (Paket 13). Ein
         fremdes Byte im Verzeichnis bleibt ein Fehler. */
      const mandatory = [...Object.values(ROOM_IMAGE_VARIANT_FILES), 'manifest.json'];
      const optional = ROOM_IMAGE_OPTIONAL_VARIANT_KEYS
        .filter((key) => entry.files?.[key])
        .map((key) => ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key]);
      const expected = [...mandatory, ...optional].sort();
      if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected)) return false;
      const checked = { ...ROOM_IMAGE_VARIANT_FILES };
      for (const key of ROOM_IMAGE_OPTIONAL_VARIANT_KEYS) {
        if (entry.files?.[key]) checked[key] = ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key];
      }
      for (const [key, name] of Object.entries(checked)) {
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
        && manifestDocument.version === ROOM_IMAGE_MANIFEST_VERSION
        && manifestDocument.assetId === entry.assetId
        && roomImageExactObject(manifestDocument.files, Object.keys(checked))
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
      return { ...roomImageAssetPublic(entry.assetId, entry.focus, entry), createdAt: entry.createdAt, byteLength };
    });
  }
  function publish(assetId, focus, variants) {
    assertMutable();
    if (!ROOM_IMAGE_ASSET_ID_PATTERN.test(assetId || '') || !validStoredRoomImageFocus(focus)
        || !roomImageExactObject(variants, [...ROOM_IMAGE_VARIANT_KEYS])
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
      const manifestDocument = { version: ROOM_IMAGE_MANIFEST_VERSION, assetId, files };
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
  /* Optionale Variante nachtragen (Paket 13, trübes Licht). Sie kommt nach der
     Veröffentlichung dazu, also wird das Set genauso getauscht wie beim
     Phone-Backfill: vollständiges Staging, flush, dann rename. Bricht es
     dazwischen ab, liegt entweder das alte Set oder das vollständige Staging da
     — nie ein halbes Verzeichnis. Der Katalog folgt erst nach dem Tausch. */
  function addOptionalVariant(assetId, key, bytes) {
    assertMutable();
    const name = ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key];
    if (!name || !(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
      throw roomImageAssetStoreError('Ungültige optionale Room-Image-Variante.');
    }
    const document = readCatalog();
    const entry = document.assets.find((candidate) => candidate.assetId === assetId);
    if (!entry || entry.status !== 'active') return false;
    if (!verifyEntryFiles(entry)) throw roomImageAssetStoreError('Das Zielasset ist unvollständig.');

    const directory = safeSetPath(assetId);
    const staging = join(setsRoot, `.optional-${key}-${assetId}`);
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { mode: 0o700 });

    const files = {};
    const written = { ...ROOM_IMAGE_VARIANT_FILES, [key]: name };
    for (const [fileKey, fileName] of Object.entries(written)) {
      const content = fileKey === key
        ? Buffer.from(bytes)
        : regularBytes(join(directory, fileName));
      const target = join(staging, fileName);
      writeFileSync(target, content, { mode: 0o600, flush: true });
      chmodSync(target, 0o600);
      files[fileKey] = {
        sha256: createHash('sha256').update(content).digest('hex'),
        byteLength: content.byteLength,
      };
    }
    /* Auch schon vorhandene andere optionale Varianten wandern mit. */
    for (const otherKey of ROOM_IMAGE_OPTIONAL_VARIANT_KEYS) {
      if (otherKey === key || !entry.files?.[otherKey]) continue;
      const otherName = ROOM_IMAGE_OPTIONAL_VARIANT_FILES[otherKey];
      const content = regularBytes(join(directory, otherName));
      const target = join(staging, otherName);
      writeFileSync(target, content, { mode: 0o600, flush: true });
      chmodSync(target, 0o600);
      files[otherKey] = {
        sha256: createHash('sha256').update(content).digest('hex'),
        byteLength: content.byteLength,
      };
    }

    const manifestDocument = { version: ROOM_IMAGE_MANIFEST_VERSION, assetId, files };
    const manifest = Buffer.from(`${JSON.stringify(manifestDocument)}\n`);
    writeFileSync(join(staging, 'manifest.json'), manifest, { mode: 0o600, flush: true });
    chmodSync(join(staging, 'manifest.json'), 0o600);
    flushDirectory(staging);

    rmSync(directory, { recursive: true, force: true });
    renameSync(staging, directory);
    flushDirectory(setsRoot);

    entry.files = files;
    entry.variants = { ...entry.variants, [key]: name };
    entry.manifestSha256 = createHash('sha256').update(manifest).digest('hex');
    atomicCatalogWrite(document);
    return true;
  }

  /* Flächen eines Bildsets festhalten (Paket 13). Dieselbe Mechanik wie
     tombstone(): lesen, prüfen, atomar zurückschreiben. Der Bildbestand bleibt
     unberührt — es ändert sich nur, was der Katalog über ihn weiß. */
  function setRegions(assetId, regions) {
    assertMutable();
    if (regions !== null && !validRegionsRecord(regions)) {
      throw roomImageAssetStoreError('Die Flächenangaben sind ungültig.');
    }
    const document = readCatalog();
    const entry = document.assets.find((candidate) => candidate.assetId === assetId);
    if (!entry || entry.status !== 'active') return false;
    delete entry.windows; // Vorgängername; verschwindet beim ersten Schreiben.
    if (regions === null) delete entry.regions;
    else entry.regions = regions;
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
    const name = ROOM_IMAGE_VARIANT_FILES[variant] ?? ROOM_IMAGE_OPTIONAL_VARIANT_FILES[variant];
    /* Eine optionale Variante gibt es nur, wenn dieses Set sie hat. */
    if (!entry || !name || !entry.files?.[variant]) return null;
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
    const retained = [];
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
      /* Datenschutz vor Aufräumen: Gab es beim Start keinen Katalog, dann zeigt
         dieser Server mit einiger Wahrscheinlichkeit auf fremde oder
         wiederhergestellte Daten (anderer Config-Pfad, Volume ohne Katalog).
         Vollständig veröffentlichte Bildsets — erkennbar am Manifest — bleiben
         dann liegen und werden nur gemeldet; ein fehlender Katalog darf nie
         eine ganze Bibliothek löschen. Staging-Reste werden weiter entfernt. */
      if (!catalogExisted && !staged && existsSync(join(path, 'manifest.json'))) {
        retained.push(assetId);
        continue;
      }
      assertMutable();
      removeTree(path, { recursive: true, force: true });
    }
    if (retained.length) {
      console.warn(`[hauser] Room-Image-Assetroot enthält ${retained.length} Bildset(s) ohne Katalogeintrag; ohne Katalog beim Start wird nichts entfernt: ${retained.join(', ')}`);
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
    activeEntry, addOptionalVariant, catalogPath: catalog, cleanupOrphans, deleteTombstonedFiles,
    list, publish, recoveryState, root, setRegions, status, tombstone, variantBytes,
  };
}

/* ── B-27 D3: Backfill der Phone-Ableitungen ──
   Zwingend, nicht optional. `verifyEntryFiles` und die Dateilistenprüfung
   vergleichen gegen `ROOM_IMAGE_VARIANT_FILES`; ohne Migration gilt jedes
   heutige Asset sofort als inkohärent und `createRoomImageAssetStore` wirft
   schon beim Konstruieren. Der Lauf muss deshalb VOR dem Store passieren.

   Er nimmt denselben Weg wie publish(): vollständiges Staging-Verzeichnis,
   fsync, dann rename. Bricht er zwischen Abräumen und Umbenennen ab, liegt das
   Staging noch vollständig da und der nächste Start schließt den Tausch ab —
   ein abgebrochener Lauf hinterlässt keinen inkohärenten Katalog. Der Katalog
   wird erst nach allen Dateitauschen geschrieben; ein Abbruch davor lässt den
   nächsten Lauf einfach erneut ableiten. */
export async function backfillRoomImagePhoneVariants({
  catalogPath,
  assetRoot = ROOM_IMAGE_ASSET_ROOT,
  derive = deriveRoomImagePhoneVariants,
  log = (message) => console.warn(message),
} = {}) {
  if (typeof catalogPath !== 'string' || !catalogPath || !existsSync(catalogPath)) {
    return { status: 'skipped', migrated: [], failed: [] };
  }
  const setsRoot = join(canonicalRoomImageAssetPath(assetRoot), 'room-images');
  if (!existsSync(setsRoot)) return { status: 'skipped', migrated: [], failed: [] };

  let document;
  try {
    document = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    log(`[hauser] Room-Image-Katalog für den Phone-Backfill nicht lesbar: ${error?.message ?? error}`);
    return { status: 'unreadable', migrated: [], failed: [] };
  }
  if (!document || !Array.isArray(document.assets)) {
    return { status: 'unreadable', migrated: [], failed: [] };
  }

  const migrated = [];
  const failed = [];
  let changed = false;

  for (const entry of document.assets) {
    if (!entry || entry.status !== 'active' || !ROOM_IMAGE_ASSET_ID_PATTERN.test(entry.assetId || '')) continue;
    const directory = join(setsRoot, entry.assetId);
    if (dirname(directory) !== setsRoot) continue;
    const staging = join(setsRoot, `.phone-backfill-${entry.assetId}`);

    // Wiederaufnahme eines abgebrochenen Tauschs.
    if (existsSync(staging) && !existsSync(directory)) {
      try {
        renameSync(staging, directory);
        flushDirectory(setsRoot);
      } catch (error) {
        failed.push(entry.assetId);
        log(`[hauser] Phone-Backfill konnte ${entry.assetId} nicht wiederherstellen: ${error?.message ?? error}`);
        continue;
      }
    }

    const complete = ROOM_IMAGE_VARIANT_KEYS.every((key) => (
      entry.files?.[key]?.sha256 && existsSync(join(directory, ROOM_IMAGE_VARIANT_FILES[key]))
    ));
    if (complete) continue;

    try {
      const finals = {};
      for (const key of ROOM_IMAGE_FINAL_VARIANT_KEYS) {
        finals[key] = readFileSync(join(directory, ROOM_IMAGE_FINAL_VARIANT_FILES[key]));
      }
      const phone = await derive(finals);
      const bytesByKey = { ...finals, ...phone };

      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { mode: 0o700 });
      /* Die truebe Variante ist optional, aber vorhanden ist sie teuer: sie
         kostet einen eigenen Modellaufruf. Sie wandert mit ins Staging, sonst
         nimmt der Verzeichnistausch sie mit. */
      for (const key of ROOM_IMAGE_OPTIONAL_VARIANT_KEYS) {
        const source = join(directory, ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key]);
        if (entry.files?.[key] && existsSync(source)) bytesByKey[key] = readFileSync(source);
      }
      const carried = ROOM_IMAGE_OPTIONAL_VARIANT_KEYS.filter((key) => bytesByKey[key]);

      const files = {};
      for (const key of [...ROOM_IMAGE_VARIANT_KEYS, ...carried]) {
        const bytes = Buffer.from(bytesByKey[key]);
        const name = ROOM_IMAGE_VARIANT_FILES[key] ?? ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key];
        const target = join(staging, name);
        writeFileSync(target, bytes, { mode: 0o600, flush: true });
        chmodSync(target, 0o600);
        files[key] = {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          byteLength: bytes.byteLength,
        };
      }
      const manifest = Buffer.from(`${JSON.stringify({
        version: ROOM_IMAGE_MANIFEST_VERSION, assetId: entry.assetId, files,
      })}\n`);
      writeFileSync(join(staging, 'manifest.json'), manifest, { mode: 0o600, flush: true });
      chmodSync(join(staging, 'manifest.json'), 0o600);
      flushDirectory(staging);

      rmSync(directory, { recursive: true, force: true });
      renameSync(staging, directory);
      flushDirectory(setsRoot);

      entry.files = files;
      entry.variants = { ...ROOM_IMAGE_VARIANT_FILES };
      for (const key of carried) {
        entry.variants[key] = ROOM_IMAGE_OPTIONAL_VARIANT_FILES[key];
      }
      entry.manifestSha256 = createHash('sha256').update(manifest).digest('hex');
      migrated.push(entry.assetId);
      changed = true;
    } catch (error) {
      failed.push(entry.assetId);
      log(`[hauser] Phone-Backfill für ${entry.assetId} fehlgeschlagen: ${error?.message ?? error}`);
      try { rmSync(staging, { recursive: true, force: true }); } catch { /* der naechste Start raeumt nach */ }
    }
  }

  if (changed) {
    const temporary = join(dirname(catalogPath), `.assets-${randomBytes(16).toString('hex')}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600, flush: true });
    chmodSync(temporary, 0o600);
    renameSync(temporary, catalogPath);
    flushDirectory(dirname(catalogPath));
  }

  return { status: failed.length ? 'partial' : 'ok', migrated, failed };
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

  /* Lebt der Zugang noch? (R15, docs/23) `status()` sieht nur, dass eine
     Datei da ist — ein abgelaufenes Refresh-Token sieht genauso aus wie ein
     frisches. Für den ChatGPT-Weg ist die Antwort eindeutig: derselbe Griff,
     den auch der Assistent benutzt. Liefert er kein Token, ist die Anmeldung
     hin. Ist der Mac gerade offline, wissen wir es nicht — dann `null`, denn
     eine Warnung ohne Grund ist schlimmer als keine. Ein API-Key altert nicht
     von selbst; ihn zu prüfen kostete bei jedem Öffnen eine Anfrage. */
  async function check() {
    const base = status();
    if (base.mode !== 'chatgpt') return { ...base, valid: null };
    try {
      return { ...base, valid: Boolean(await chatGptAccessToken()) };
    } catch {
      return { ...base, valid: null };
    }
  }

  return { beginChatGptLogin, chatGptAccessToken, check, clear, current, pollChatGptLogin, setApiKey, status };
}

/* Ein Satz je Grund (R16, docs/23): Bisher las jeder Anbieterfehler gleich —
   „Der Provider hat den Request abgelehnt." Abgelaufene Anmeldung, erschöpftes
   Kontingent und ein zurückgewiesenes Foto verlangen aber verschiedene
   nächste Schritte. Der Code kennt den Unterschied längst; nur der Satz
   verschwieg ihn. */
export function roomImageProviderFailureMessage(code) {
  if (code === 'PROVIDER_CREDENTIAL_INVALID') {
    return 'Die Anmeldung beim Bildanbieter ist abgelaufen. Im Zugang neu anmelden.';
  }
  if (code === 'PROVIDER_QUOTA_OR_RATE_LIMIT') {
    return 'Das Kontingent des Bildanbieters ist gerade erschöpft. Später noch einmal versuchen.';
  }
  if (code === 'PROVIDER_FORBIDDEN') {
    return 'Dieser Zugang darf das Bildmodell nicht verwenden.';
  }
  if (code === 'PROVIDER_IMAGE_REJECTED') {
    return 'Der Bildanbieter hat das Foto zurückgewiesen. Ein anderes Foto versuchen.';
  }
  return 'Der Bildanbieter hat den Auftrag abgelehnt.';
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

export function roomImageCodexHeaders(accessToken) {
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

/* Textaufrufe an dasselbe Backend (Paket 13). Bewusst der kleinste
   Kopfzeilensatz, mit dem die Responses-API nachweislich antwortet: die
   Bild-Turn-Id gehört zum Bildendpunkt, und die Kontokennung führt hier zu
   HTTP 429 (gemessen 2026-09-05). `session_id` gehört dagegen dazu. */
export function roomImageCodexTextHeaders(accessToken) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'codex_cli_rs/0.0.0 (Hauser)',
    originator: 'codex_cli_rs',
    session_id: randomUUID(),
  };
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
        jobState: cancelling ? null
          : failedJobState(current, processed.errorCode, roomImageProviderFailureMessage(processed.errorCode)),
      });
      failJob(jobId, cancelling ? 'JOB_CANCELLED' : processed.errorCode,
        cancelling ? 'Der Job wurde abgebrochen.' : roomImageProviderFailureMessage(processed.errorCode),
        { cancelled: cancelling });
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
        roomImageJsonResponse(req, res, 200, await credentialStore.check());
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

/* Das Außenbild (R14, docs/23) wird wie ein Raum zugewiesen, liegt aber
   unter `document.exterior.hero`, nicht in `rooms`. Beide Wege teilen sich
   diesen Griff, damit Zuweisung, Hochladen und Verwaisungsschutz dieselbe
   Stelle sehen. */
const EXTERIOR_HERO_ID = 'exterior';

function heroTarget(document, roomId) {
  if (roomId === EXTERIOR_HERO_ID) {
    return {
      get hero() { return document.exterior?.hero ?? null; },
      set hero(value) { document.exterior = { hero: value }; },
    };
  }
  return document.rooms.find((candidate) => candidate.id === roomId) ?? null;
}

function assignedRoomIds(document, assetId) {
  const rooms = document.rooms.filter((room) => room.hero?.assetId === assetId).map((room) => room.id);
  if (document.exterior?.hero?.assetId === assetId) rooms.push(EXTERIOR_HERO_ID);
  return rooms.sort();
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
        const variants = Object.fromEntries(ROOM_IMAGE_FINAL_VARIANT_KEYS.map((key) => [key, context.jobStore.readTemp(record.temp.finals[key])]));
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
        /* B-27 D2: Die Phone-Ableitungen entstehen aus genau diesen Final-AVIFs
           und gehen in denselben atomaren Publish-Vorgang. Bewusst vor dem
           Mutations-Lock: die Kodierung ist reine Rechenzeit auf bereits
           feststehenden Bytes und muss die serialisierte Konfigurationsmutation
           nicht blockieren. */
        let publishVariants;
        try {
          publishVariants = { ...variants, ...await context.phoneDeriver(variants) };
        } catch (error) {
          context.assertSetupRecoveryHealthy();
          context.jobStore.failPublish(jobId, 'PUBLISH_FAILED');
          throw new RoomImageRequestError(422, 'PUBLISH_FAILED', 'Die Phone-Ableitungen konnten nicht erzeugt werden.');
        }
        try {
          context.assertSetupRecoveryHealthy();
          const asset = await context.configMutations.run(() => {
            context.assertSetupRecoveryHealthy();
            return context.assetStore.publish(record.reservedAssetId, record.request.focus, publishVariants);
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
    const asset = await operation;
    /* Feinschliff anstoßen (Paket 13): Flächenerkennung und trübe Variante
       hängen hinter der Veröffentlichung, nicht darin — der Wizard antwortet
       sofort, die beiden Anbieteraufrufe laufen danach. Ein Fehlschlag bleibt
       für den nächtlichen Nachzug liegen und darf den Publish nicht anfassen. */
    if (asset?.assetId) void Promise.resolve(context.finishAsset?.(asset.assetId)).catch(() => undefined);
    roomImageJsonResponse(req, res, 200, asset);
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

/* Erkennen und festhalten. Die Antwort trägt den Katalogstand zurück, damit
   die Diagnose sofort zeichnen kann, ohne die Liste neu zu holen. */
async function serveRoomImageRegionDetection(req, res, assetId, context) {
  try {
    if (typeof context.detectRegions !== 'function') {
      roomImageError(req, res, 503, 'REGION_DETECTION_UNAVAILABLE', 'Die Flächenerkennung ist auf diesem Server nicht eingerichtet.');
      return;
    }
    const result = await context.detectRegions(assetId);
    if (result.ok) {
      roomImageJsonResponse(req, res, 200, { assetId, regions: result.regions });
      return;
    }
    const status = result.code === 'ASSET_NOT_FOUND' ? 404
      : ['PROVIDER_CREDENTIAL_MISSING', 'WINDOW_DETECTION_NEEDS_API_KEY'].includes(result.code) ? 409
        : result.code === 'ROOM_IMAGE_STORE_INVALID' ? 503 : 502;
    /* 429 heißt: zu schnell hintereinander gefragt. Das ist kein Fehlschlag,
       sondern eine Bitte um Geduld — die Oberfläche darf es erneut anbieten. */
    if (result.detail) {
      console.warn('[hauser] Flächenerkennung abgewiesen (%s): %s', result.status ?? '?', result.detail);
    }
    const retryable = result.status === 429 || result.code === 'REGION_DETECTION_UNREACHABLE';
    roomImageError(req, res, status, result.code, regionDetectionMessage(result), {}, retryable);
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

function regionDetectionMessage(result) {
  if (result.code === 'ASSET_NOT_FOUND') return 'Das Asset wurde nicht gefunden.';
  if (result.code === 'ASSET_UNREADABLE') return 'Das Bildset ließ sich nicht lesen.';
  if (result.code === 'PROVIDER_CREDENTIAL_MISSING') return 'Für die Flächenerkennung fehlt der Provider-Zugang.';
  if (result.code === 'PROVIDER_CREDENTIAL_INVALID') return 'Die Anmeldung beim Bildanbieter ist abgelaufen.';
  if (result.code === 'REGION_DETECTION_MODEL_UNAVAILABLE') {
    return `Das Sehmodell ${result.model ?? ''} ist für diesen Zugang nicht verfügbar.`.trim();
  }
  if (result.code === 'REGION_DETECTION_UNREACHABLE') return 'Das Sehmodell war nicht erreichbar.';
  if (result.code === 'REGION_DETECTION_INVALID_RESPONSE') return 'Die Antwort des Sehmodells war unbrauchbar.';
  if (result.code === 'REGION_DETECTION_PROVIDER_ERROR') {
    if (result.status === 429) return 'Das Sehmodell bremst gerade — in einer Minute noch einmal versuchen.';
    return `Das Sehmodell antwortete mit HTTP ${result.status ?? '?'}.`;
  }
  return 'Die Flächenerkennung ist fehlgeschlagen.';
}

/* Erzeugen und dazulegen. Die Antwort sagt nur, ob es jetzt da ist — das Bild
   selbst holt der Aufrufer über die gewöhnliche Assetadresse. */
async function serveRoomImageOvercast(req, res, assetId, context) {
  try {
    if (typeof context.deriveOvercast !== 'function') {
      roomImageError(req, res, 503, 'OVERCAST_UNAVAILABLE', 'Die trübe Variante ist auf diesem Server nicht eingerichtet.');
      return;
    }
    const result = await context.deriveOvercast(assetId);
    if (result.ok) {
      roomImageJsonResponse(req, res, 200, { assetId, status: result.status });
      return;
    }
    const status = result.code === 'ASSET_NOT_FOUND' ? 404
      : result.code === 'PROVIDER_CREDENTIAL_MISSING' ? 409
        : result.code === 'ROOM_IMAGE_STORE_INVALID' ? 503 : 502;
    roomImageError(req, res, status, result.code, overcastMessage(result));
  } catch (error) { roomImageHandleAsyncError(req, res, error); }
}

function overcastMessage(result) {
  if (result.code === 'ASSET_NOT_FOUND') return 'Das Asset wurde nicht gefunden.';
  if (result.code === 'ASSET_UNREADABLE') return 'Das Bildset ließ sich nicht lesen.';
  if (result.code === 'PROVIDER_CREDENTIAL_MISSING') return 'Für die trübe Variante fehlt der Provider-Zugang.';
  if (result.code === 'PROVIDER_UNREACHABLE') return 'Der Bildanbieter war nicht erreichbar.';
  return 'Die trübe Variante konnte nicht erzeugt werden.';
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
      const room = heroTarget(snapshot.document, roomId);
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

    /* B-27 D2: wie im Finaljob — ableiten, bevor der Mutations-Lock greift. */
    const manualFinals = variantBytes
      ? { light: variantBytes, dark: variantBytes, darkOff: variantBytes }
      : null;
    const manualVariants = manualFinals
      ? { ...manualFinals, ...await context.phoneDeriver(manualFinals) }
      : null;

    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      if (matches[0] !== snapshot.etag) return { type: 'stale' };
      const room = heroTarget(snapshot.document, roomId);
      if (!room) return { type: 'room_absent' };

      const previousAssetId = room.hero?.assetId ?? null;
      let createdAsset = null;
      if (manualVariants) {
        const assetId = `manual_${randomBytes(16).toString('hex')}`;
        const focus = { panel: { x: 0.5, y: 0.5 }, phone: { x: 0.5, y: 0.5 } };
        createdAsset = context.assetStore.publish(assetId, focus, manualVariants);
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
  /* Pflicht- und optionale Varianten werden gleich ausgeliefert (Paket 13):
     `variantBytes` prüft ohnehin gegen den Katalog, also kann hier nichts
     ausgeliefert werden, was der Katalog nicht kennt. */
  const variant = Object.entries({ ...ROOM_IMAGE_VARIANT_FILES, ...ROOM_IMAGE_OPTIONAL_VARIANT_FILES })
    .find(([, name]) => name === file)?.[0];
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

export function serveRoomImages(req, res, {
  authConfig,
  allowedOrigins,
  uploadStore,
  jobStore,
  jobRunner,
  previewValidator,
  phoneDeriver,
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
  detectRegions,
  deriveOvercast,
  finishAsset,
}) {
  const parsed = new URL(req.url || '/', 'http://hmi.local');
  const pathname = parsed.pathname;
  const context = {
    assetStore, householdConfigPath, configMutations, jobStore, previewValidator, phoneDeriver,
    publishFlights, publishStep, latchSetupRecoveryFailure, assertSetupRecoveryHealthy,
    detectRegions, deriveOvercast, finishAsset,
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
  /* Nur der Ordner ist die Assetroute. Ein Bundle-Chunk wie
     `/assets/room-images-<hash>.js` (Rollup benennt geteilte Chunks nach dem
     Modulordner) muss zur statischen Auslieferung durchfallen — sonst
     beantwortet ihn diese Route mit 404 und das Raum-Overlay lädt nicht. */
  if (pathname.startsWith('/assets/room-images/')) {
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
  /* Trübe Variante nachziehen (Paket 13). Wie die Fenstererkennung: kostet
     einen Anbieteraufruf, also Admin und nur auf ausdrückliches POST. */
  const assetOvercastMatch = pathname.match(/^\/api\/room-image-assets\/([^/]+)\/overcast$/);
  if (assetOvercastMatch) {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die trübe Variante erlaubt ausschließlich POST.', { allow: 'POST' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!assetStore || !ROOM_IMAGE_ASSET_ID_PATTERN.test(assetOvercastMatch[1] || '')) {
      roomImageError(req, res, 404, 'ASSET_NOT_FOUND', 'Das Asset wurde nicht gefunden.');
    } else void serveRoomImageOvercast(req, res, assetOvercastMatch[1], context);
    return true;
  }
  /* Flächenerkennung eines Bildsets (Paket 13). Admin-Sache: sie kostet einen
     Modellaufruf und ändert den Katalog. */
  const assetRegionsMatch = pathname.match(/^\/api\/room-image-assets\/([^/]+)\/regions$/);
  if (assetRegionsMatch) {
    if (req.method !== 'POST') {
      roomImageError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Die Flächenerkennung erlaubt ausschließlich POST.', { allow: 'POST' }); return true;
    }
    const identity = authorizeRoomImage(req, res, authConfig, allowedOrigins, true);
    if (!identity) return true;
    if (!assetStore || !ROOM_IMAGE_ASSET_ID_PATTERN.test(assetRegionsMatch[1] || '')) {
      roomImageError(req, res, 404, 'ASSET_NOT_FOUND', 'Das Asset wurde nicht gefunden.');
    } else void serveRoomImageRegionDetection(req, res, assetRegionsMatch[1], context);
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
