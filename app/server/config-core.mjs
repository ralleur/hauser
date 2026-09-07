/* Konfigurationskern: geteilte Konfiguration, Setup-Transaktionen, Haushaltskonfiguration, Migration, Readiness, Health und Build-Info.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  APP_VERSION,
  CONFIG_BODY_MAX,
  CONFIG_PATH,
  DIST,
  HOUSEHOLD_CONFIG_BODY_MAX,
  HOUSEHOLD_CONFIG_MODE_HEADER,
  HOUSEHOLD_CONFIG_PATH,
  REQUIRED_WRITABLE_DIRS,
  SETUP_TRANSACTION_DIRECTORY,
  SETUP_TRANSACTION_JOURNAL_PATTERN,
  SETUP_TRANSACTION_MAX_BYTES,
  SETUP_TRANSACTION_VERSION,
  SHARED_CONFIG_KEYS,
  compileHouseholdConfig,
  migrateHouseholdConfigDocument,
  parseHouseholdConfig,
  projectActiveHouseholdData,
  resolveBuildInfo,
  validSharedConfigDocument,
  validSharedConfigValue,
} from './runtime-env.mjs';
import {
  RoomImageRequestError,
  canonicalRoomImageAssetPath,
  flushDirectory,
  inspectRoomImageAssetPath,
  jsonResponse,
  rawHeaderValues,
  readRoomImageJsonBody,
  roomImageAssetStoreError,
  strongByteEtag,
} from './shared.mjs';

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

export function setupRecoveryFailure(message = 'Eine Setup-Konfigurationstransaktion konnte nicht sicher wiederhergestellt werden.') {
  return { ok: false, code: 'SETUP_CONFIG_RECOVERY_REQUIRED', message };
}

export function setupRecoveryRequiredError() {
  return Object.assign(new Error('Setup configuration recovery required'), {
    code: 'SETUP_CONFIG_RECOVERY_REQUIRED',
    status: 503,
  });
}

export function isSetupRecoveryRequiredError(error) {
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

export async function commitSetupConfigTransaction({
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

export function notReady(code, message, extra = {}) {
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
  /* Ergebnis der Startprüfung (Paket 11). Fehlende Bilddateien sind eine
     Warnung im Payload, kein Grund, den Dienst als nicht bereit zu melden. */
  selfCheck = null,
  /* Zusammenfassung des letzten nächtlichen Vorberechnungslaufs (Paket 11). */
  precompute = null,
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

  const warnings = { ...selfCheckWarnings(selfCheck), ...precomputeSummary(precompute) };

  if (normalizedMode === 'shadow') {
    return {
      ok: true,
      status: 200,
      payload: {
        ok: true,
        status: 'ready',
        householdConfigMode: normalizedMode,
        schemaVersion: null,
        ...warnings,
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
      ...warnings,
    },
  };
}

/* Die Startprüfung erscheint nur, wenn sie gelaufen ist. Ihr Ergebnis steht
   als `selfCheck` neben dem Status — sichtbar, aber nicht blockierend. */
function selfCheckWarnings(selfCheck) {
  if (!selfCheck) return {};
  return {
    selfCheck: {
      ok: selfCheck.ok !== false,
      at: selfCheck.at ?? null,
      roomImages: selfCheck.roomImages
        ? {
          checkedSets: selfCheck.roomImages.checkedSets ?? 0,
          missing: selfCheck.roomImages.missing ?? [],
        }
        : null,
      /* Der Jobspeicher des Raumbild-Assistenten: `ok: false` heißt, das Haus
         läuft ohne Assistent; der Grund steht im Serverlog. */
      roomImageJobStore: selfCheck.roomImageJobStore
        ? { ok: selfCheck.roomImageJobStore.ok !== false, code: selfCheck.roomImageJobStore.code ?? null }
        : null,
    },
  };
}

/* Der letzte nächtliche Lauf, auf das Nötige eingedampft: wann, ob alles
   durchlief, und welche Aufgabe was gemeldet hat. */
function precomputeSummary(precompute) {
  if (!precompute) return {};
  return {
    precompute: {
      at: precompute.at ?? null,
      ok: precompute.ok !== false,
      tasks: (precompute.tasks ?? []).map((task) => ({ name: task.name, ok: task.ok !== false })),
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

export function readRoomImageHouseholdSnapshot(path) {
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

export function writeRoomImageHousehold(
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

/* Ein Modul an- oder abschalten. Schmaler Schreibzugriff auf die
   Haushalts-Konfiguration nach dem Muster der Raumbild-Zuweisung: ETag-gesichert,
   in derselben Mutations-Serialisierung, ohne Home-Assistant-Zugangsdaten in der
   Anfrage. `enabledModules` und `navigation` müssen zusammenpassen — die
   Projektion weist sonst die ganze Konfiguration zurück. */
const TOGGLEABLE_HOUSEHOLD_MODULES = new Map([
  ['energy', ['energy']],
  ['calendar', ['calendar']],
  ['notes', ['notes', 'shopping', 'reminders']],
  ['media', ['media']],
  ['library', ['library']],
  ['ablage', ['ablage']],
]);

export async function serveHouseholdModuleToggle(req, res, moduleId, context) {
  try {
    context.assertSetupRecoveryHealthy();
    const ids = TOGGLEABLE_HOUSEHOLD_MODULES.get(moduleId);
    if (!ids) return jsonResponse(res, 404, { ok: false, code: 'MODULE_UNKNOWN', message: 'Dieses Modul lässt sich nicht schalten.' });
    const payload = await readRoomImageJsonBody(req);
    if (!payload || typeof payload.enabled !== 'boolean') {
      return jsonResponse(res, 400, { ok: false, code: 'INVALID_REQUEST', message: 'Die Modul-Anfrage ist ungültig.' });
    }
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 64) : moduleId;
    const matches = rawHeaderValues(req, 'if-match');
    if (matches.length !== 1) {
      return jsonResponse(res, 428, { ok: false, code: 'CONFIG_PRECONDITION_REQUIRED', message: 'Der Household-ETag fehlt.' });
    }
    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      if (matches[0] !== snapshot.etag) return { type: 'stale' };
      const document = snapshot.document;
      const modules = new Set(document.enabledModules);
      for (const id of ids) {
        if (payload.enabled) modules.add(id);
        else modules.delete(id);
      }
      document.enabledModules = [...modules];
      /* Die Energie-Sektion haengt am Modul: ohne Modul muss sie fehlen, mit
         Modul muss sie da sein (INCONSISTENT_MODULE). Beim Anschalten entsteht
         eine leere Sektion, die die Dienste-Seite dann fuellt. */
      if (moduleId === 'energy') {
        if (!payload.enabled) document.energy = null;
        else if (!document.energy) {
          document.energy = {
            sensors: { productionPower: null, consumptionPower: [] },
            kpis: { producedToday: null, consumedToday: null, fedInToday: null, drawnToday: null },
          };
        }
      }
      const navigation = document.navigation.filter((item) => item.target.id !== moduleId);
      if (payload.enabled) {
        const systemIndex = navigation.findIndex((item) => item.target.id === 'system');
        const entry = { id: `nav-${moduleId}`, name, order: 0, target: { type: 'module', id: moduleId } };
        // Die Reihenfolge zählt ab 0 — so steht sie in der Konfiguration.
        if (systemIndex >= 0) navigation.splice(systemIndex, 0, entry);
        else navigation.push(entry);
      }
      document.navigation = navigation.map((item, index) => ({ ...item, order: index }));
      const written = writeRoomImageHousehold(
        context.householdConfigPath,
        document,
        context.publishStep,
        context.latchSetupRecoveryFailure,
        context.assertSetupRecoveryHealthy,
      );
      return { type: 'written', etag: written.etag, enabled: payload.enabled };
    });
    if (result.type === 'stale') {
      return jsonResponse(res, 412, { ok: false, code: 'CONFIG_PRECONDITION_FAILED', message: 'Die Household Config wurde zwischenzeitlich geändert.' });
    }
    jsonResponse(res, 200, { ok: true, module: moduleId, enabled: result.enabled, etag: result.etag });
  } catch (error) {
    console.warn('[hauser] Modulschalter fehlgeschlagen:', error?.code ?? error);
    jsonResponse(res, 500, { ok: false, code: 'MODULE_WRITE_FAILED', message: 'Das Modul konnte nicht geschaltet werden.' });
  }
}

/* Energie-Entitäten setzen: eine Erzeugungsquelle, beliebig viele Verbraucher.
   Wie der Modulschalter ein schmaler, ETag-gesicherter Schreibzugriff auf die
   Haushalts-Konfiguration — die Oberfläche schickt die Auswahl, der Server
   baut daraus die `energy`-Sektion. */
function normalizeEnergySelection(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const entity = (value) => (typeof value === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(value) ? value : null);
  const production = payload.production === null || payload.production === undefined
    ? null
    : entity(payload.production);
  if (payload.production && !production) return null;
  if (!Array.isArray(payload.consumption) || payload.consumption.length > 64) return null;
  const consumption = [];
  const seen = new Set();
  for (const item of payload.consumption) {
    const entityId = entity(item?.entityId ?? item);
    if (!entityId || seen.has(entityId) || entityId === production) continue;
    seen.add(entityId);
    const name = typeof item?.name === 'string' && item.name.trim()
      ? item.name.trim().slice(0, 64)
      : entityId.split('.')[1].replace(/_/g, ' ');
    consumption.push({ id: `load_${consumption.length + 1}`, name, entityId });
  }
  const kpi = (value) => (value === null || value === undefined ? null : entity(value));
  return {
    production,
    consumption,
    kpis: {
      producedToday: kpi(payload.kpis?.producedToday),
      consumedToday: kpi(payload.kpis?.consumedToday),
      fedInToday: kpi(payload.kpis?.fedInToday),
      drawnToday: kpi(payload.kpis?.drawnToday),
    },
  };
}

/* Zettelplätze des Energie-Screens (R19): je Motiv, alles in Bildprozent.
   Die Form ist geschlossen; die Prüfung beim Schreiben läuft ohnehin noch
   einmal über parseHouseholdConfig. */
function normalizePercentPoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'x' || keys[1] !== 'y') return null;
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  if (!ok(value.x) || !ok(value.y)) return null;
  return { x: Math.round(value.x * 10) / 10, y: Math.round(value.y * 10) / 10 };
}

function normalizeEnergyMarkAnchor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'note,point,tilt') return null;
  const point = normalizePercentPoint(value.point);
  const note = normalizePercentPoint(value.note);
  if (!point || !note || typeof value.tilt !== 'number' || !Number.isFinite(value.tilt) || Math.abs(value.tilt) > 45) return null;
  return { point, note, tilt: Math.round(value.tilt * 10) / 10 };
}

export function normalizeEnergyMarks(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'marks') return undefined;
  if (payload.marks === null) return null;
  const marks = payload.marks;
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) return undefined;
  if (Object.keys(marks).sort().join(',') !== 'assetId,grid,house,sun') return undefined;
  if (marks.assetId !== null && !(typeof marks.assetId === 'string' && /^[a-z0-9_-]{1,128}$/.test(marks.assetId))) return undefined;
  const sun = normalizeEnergyMarkAnchor(marks.sun);
  const house = normalizeEnergyMarkAnchor(marks.house);
  const grid = normalizeEnergyMarkAnchor(marks.grid);
  if (!sun || !house || !grid) return undefined;
  return { assetId: marks.assetId, sun, house, grid };
}

export async function serveHouseholdEnergyMarks(req, res, context) {
  try {
    context.assertSetupRecoveryHealthy();
    const marks = normalizeEnergyMarks(await readRoomImageJsonBody(req));
    if (marks === undefined) {
      return jsonResponse(res, 400, { ok: false, code: 'INVALID_REQUEST', message: 'Die Zettelplätze sind ungültig.' });
    }
    const matches = rawHeaderValues(req, 'if-match');
    if (matches.length !== 1) {
      return jsonResponse(res, 428, { ok: false, code: 'CONFIG_PRECONDITION_REQUIRED', message: 'Der Household-ETag fehlt.' });
    }
    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      if (matches[0] !== snapshot.etag) return { type: 'stale' };
      const document = snapshot.document;
      const exterior = { hero: document.exterior?.hero ?? null };
      if (marks) exterior.marks = marks;
      document.exterior = exterior;
      const written = writeRoomImageHousehold(
        context.householdConfigPath,
        document,
        context.publishStep,
        context.latchSetupRecoveryFailure,
        context.assertSetupRecoveryHealthy,
      );
      return { type: 'written', etag: written.etag, marks: marks ?? null };
    });
    if (result.type === 'stale') {
      return jsonResponse(res, 412, { ok: false, code: 'CONFIG_PRECONDITION_FAILED', message: 'Die Household Config wurde zwischenzeitlich geändert.' });
    }
    jsonResponse(res, 200, { ok: true, marks: result.marks, etag: result.etag });
  } catch (error) {
    console.warn('[hauser] Zettelplätze fehlgeschlagen:', error?.code ?? error);
    jsonResponse(res, 500, { ok: false, code: 'ENERGY_MARKS_WRITE_FAILED', message: 'Die Zettelplätze konnten nicht gespeichert werden.' });
  }
}

export async function serveHouseholdEnergy(req, res, context) {
  try {
    context.assertSetupRecoveryHealthy();
    const selection = normalizeEnergySelection(await readRoomImageJsonBody(req));
    if (!selection) {
      return jsonResponse(res, 400, { ok: false, code: 'INVALID_REQUEST', message: 'Die Energie-Auswahl ist ungültig.' });
    }
    const matches = rawHeaderValues(req, 'if-match');
    if (matches.length !== 1) {
      return jsonResponse(res, 428, { ok: false, code: 'CONFIG_PRECONDITION_REQUIRED', message: 'Der Household-ETag fehlt.' });
    }
    const result = await context.configMutations.run(() => {
      context.assertSetupRecoveryHealthy();
      const snapshot = readRoomImageHouseholdSnapshot(context.householdConfigPath);
      if (matches[0] !== snapshot.etag) return { type: 'stale' };
      const document = snapshot.document;
      const previous = document.energy;
      /* Die Sektion bleibt bestehen, auch wenn nichts ausgewählt ist: bei
         aktivem Energie-Modul weist die Prüfung `energy: null` zurück
         (INCONSISTENT_MODULE). Die Tageswerte bleiben, solange die Oberfläche
         sie nicht selbst schickt — sie hängen an anderen Sensoren. */
      document.energy = {
        sensors: { productionPower: selection.production, consumptionPower: selection.consumption },
        kpis: {
          producedToday: selection.kpis.producedToday ?? previous?.kpis.producedToday ?? null,
          consumedToday: selection.kpis.consumedToday ?? previous?.kpis.consumedToday ?? null,
          fedInToday: selection.kpis.fedInToday ?? previous?.kpis.fedInToday ?? null,
          drawnToday: selection.kpis.drawnToday ?? previous?.kpis.drawnToday ?? null,
        },
      };
      const written = writeRoomImageHousehold(
        context.householdConfigPath,
        document,
        context.publishStep,
        context.latchSetupRecoveryFailure,
        context.assertSetupRecoveryHealthy,
      );
      return { type: 'written', etag: written.etag, energy: document.energy };
    });
    if (result.type === 'stale') {
      return jsonResponse(res, 412, { ok: false, code: 'CONFIG_PRECONDITION_FAILED', message: 'Die Household Config wurde zwischenzeitlich geändert.' });
    }
    jsonResponse(res, 200, { ok: true, energy: result.energy, etag: result.etag });
  } catch (error) {
    console.warn('[hauser] Energie-Auswahl fehlgeschlagen:', error?.code ?? error);
    jsonResponse(res, 500, { ok: false, code: 'ENERGY_WRITE_FAILED', message: 'Die Energie-Auswahl konnte nicht gespeichert werden.' });
  }
}
