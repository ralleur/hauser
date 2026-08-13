import {
  chownSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { spawn } from 'node:child_process';

const NODE_UID = 1000;
const NODE_GID = 1000;
const APP_DATA_DIR = '/data';

function chownTree(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      chownTree(`${path}/${entry}`);
    }
  }
  chownSync(path, NODE_UID, NODE_GID);
}

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  mkdirSync(`${APP_DATA_DIR}/songs`, { recursive: true });
  chownTree(APP_DATA_DIR);
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
