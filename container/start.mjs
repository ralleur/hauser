/* Container entrypoint.

   Under Home Assistant OS the Supervisor hands the App a `/data` volume
   owned by root, so the server cannot write to it as an unprivileged user.
   This entrypoint therefore starts as root, prepares the runtime directories,
   drops to the `node` user and only then runs the server. Started as a
   non-root user (plain `docker run --user`, Compose with `user:`), the
   preparation is skipped and the server runs directly.

   The directories are derived from HMI_REQUIRED_WRITABLE_DIRS — the same list
   the readiness check verifies. Deriving them from one source is the point:
   a deployment that adds a directory to that list (as the Home Assistant
   App did with /data/assets for room images) would otherwise fail at
   startup with RUNTIME_DIRECTORY_NOT_WRITABLE, because nothing ever created
   it. */
import {
  chownSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { spawn } from 'node:child_process';

const NODE_UID = 1000;
const NODE_GID = 1000;

const requiredDirectories = (process.env.HMI_REQUIRED_WRITABLE_DIRS || '')
  .split(',').map((path) => path.trim()).filter(Boolean);

/* Additional directories the server writes into but that are not themselves
   part of the readiness contract. */
const derivedDirectories = [
  process.env.HMI_SONG_LIBRARY_DIR,
  process.env.HMI_ROOM_IMAGE_ASSET_ROOT,
].filter(Boolean);

/* Preparation is best-effort throughout. A path can legitimately resist it —
   a read-only bind mount of an already-correct file is the normal case for
   `docker run --read-only -v host.json:/config/household.json:ro`. Refusing to
   start there would replace a precise diagnosis with a stack trace, so the
   entrypoint prepares what it can and leaves judgement to the readiness check,
   which reports RUNTIME_DIRECTORY_NOT_WRITABLE with the offending path. */
function chownTree(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    let entries = [];
    try {
      entries = readdirSync(path);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      chownTree(`${path}/${entry}`);
    }
  }
  if (stat.uid === NODE_UID && stat.gid === NODE_GID) return;
  try {
    chownSync(path, NODE_UID, NODE_GID);
  } catch {
    /* Read-only mount or a path the platform owns deliberately. */
  }
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  const prepared = new Set([...requiredDirectories, ...derivedDirectories]);
  for (const directory of prepared) {
    try {
      mkdirSync(directory, { recursive: true });
    } catch {
      /* Already provided, or provided read-only. */
    }
  }
  /* Ownership is corrected after creation so that pre-existing volume content
     — a household config restored from a backup, generated room images —
     becomes readable for the unprivileged user as well. */
  for (const directory of prepared) {
    chownTree(directory);
  }
  process.setgroups([]);
  process.setgid(NODE_GID);
  process.setuid(NODE_UID);
}

const child = spawn(process.execPath, ['server.mjs'], {
  env: process.env,
  stdio: 'inherit',
});

let requestedSignal = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    requestedSignal = signal;
    child.kill(signal);
  });
}

const exitCode = await new Promise((resolve) => {
  child.once('error', () => resolve(1));
  child.once('exit', (code, signal) => {
    resolve(requestedSignal && signal === requestedSignal ? 0 : (code ?? 1));
  });
});
process.exitCode = exitCode;
