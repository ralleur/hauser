/* Die iOS-Hälfte des Stresshauses: koppelt ein simuliertes iPhone und iPad an
   den Wegwerf-Server des Crawlers und startet dort den UI-Test
   `StresshausUITests` aus dem Swift-Repo (hauser-app-swift). Befunde kommen
   aus drei Quellen: den Zeilen, die der Test selbst schreibt, aus
   fehlgeschlagenen XCTest-Prüfungen und aus dem Gerätelog der App — dort meldet
   SwiftUI doppelte IDs („occurs multiple times"), das Gegenstück zu Sveltes
   each_key_duplicate, und Swift seine fatalen Fehler.

   Eigene Simulatoren („Stresshaus iPhone", „Stresshaus iPad"), damit Kopplung
   und Einstellungen nicht in die Geräte der Werkstatt laufen; danach fahren sie
   wieder herunter. */

import { execFileSync, spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SWIFT_REPO = process.env.HAUSER_SWIFT_REPO ?? join(homedir(), 'workspace/hauser-app-swift');
const DERIVED = process.env.STRESSHAUS_IOS_DERIVED ?? join(homedir(), 'Library/Caches/hauser-stresshaus/ios-dd');

/* Was im Gerätelog der App ein Befund ist. */
const LOG_FINDINGS = [
  /occurs multiple times within the collection/i,
  /Fatal error/,
  /Precondition failed/,
  /Index out of range/,
  /Unexpectedly found nil/,
  /keyNotFound|typeMismatch|valueNotFound|dataCorrupted/,
];

/* SwiftUI schreibt den ganzen generischen Typ in die Zeile; übrig bleiben
   sollen die doppelte ID und die Art der Elemente. */
function describeLogLine(line) {
  const duplicate = line.match(/ForEach<Array<(.+?)>, .*?the ID (.+?) occurs multiple times/);
  if (duplicate) return `SwiftUI ForEach: ID „${duplicate[2]}" doppelt (Elemente ${duplicate[1].slice(0, 80)})`;
  return line.replace(/^.*?\] /, '').slice(0, 300);
}

function simctl(args) {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
}

function ensureSimulator(name, typePattern) {
  const { devices } = JSON.parse(simctl(['list', 'devices', 'available', '-j']));
  for (const list of Object.values(devices)) {
    const found = list.find((d) => d.name === name);
    if (found) return found.udid;
  }
  /* Typ und Laufzeit von einem vorhandenen Gerät gleicher Art abschauen — so
     passt die Laufzeit sicher zum Typ (die Typliste kennt auch iPhone 7). */
  for (const [runtime, list] of Object.entries(devices)) {
    const model = list.find((d) => typePattern.test(d.name));
    if (model) return simctl(['create', name, model.deviceTypeIdentifier, runtime]).trim();
  }
  throw new Error(`Kein Simulator als Vorlage für ${name}`);
}

function buildForTesting(log) {
  mkdirSync(DERIVED, { recursive: true });
  execFileSync('xcodegen', ['generate'], { cwd: SWIFT_REPO, stdio: 'ignore' });
  log('iOS: baue App und Stresshaus-Test …');
  execFileSync('xcodebuild', [
    'build-for-testing', '-project', 'Hauser.xcodeproj', '-scheme', 'Stresshaus',
    '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', DERIVED,
    'CODE_SIGNING_ALLOWED=NO',
  ], { cwd: SWIFT_REPO, stdio: 'ignore', maxBuffer: 1 << 28 });
  const products = join(DERIVED, 'Build/Products');
  const xctestrun = readdirSync(products).find((f) => f.startsWith('Stresshaus') && f.endsWith('.xctestrun'));
  if (!xctestrun) throw new Error('xctestrun fehlt nach dem Bau');
  return join(products, xctestrun);
}

/* Durchleiter zwischen App und Server: jede Anfrage der App, die der Server
   ablehnt (≥ 400), ist ein Befund — falsche Form, fehlender ETag, fehlende
   Freigabe. Die Schnittstellen der App waren aus dem Servercode abgeleitet und
   nie gegen einen echten Server geprüft (Gegenprobe 2026-09-24: Modulschalter
   und Raumbild-Zuweisung scheiterten immer). */
const EXPECTED_REFUSALS = [
  [404, /^\/api\/app\/hero/],            // kein eigenes Raumbild — die App nimmt das Motiv
  [404, /^\/(assets|hero)\//],
  [503, /^\/api\/shopping\/notion/],      // Notion nicht eingerichtet
  [409, /^\/api\/household-modules\/media/], // Media ohne Mediaplayer
  [500, /^\/api\/camera_proxy/],           // Kamera in HA nicht erreichbar — das Stresshaus hat solche
  [502, /^\/api\/camera_proxy/],
];

function startProxy(apiOrigin, onRefusal) {
  const target = new URL(apiOrigin);
  const server = createServer((req, res) => {
    const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (answer) => {
      const path = (req.url ?? '').split('?')[0];
      if (answer.statusCode >= 400 && !EXPECTED_REFUSALS.some(([code, re]) => code === answer.statusCode && re.test(path))) {
        const chunks = [];
        answer.on('data', (c) => chunks.push(c));
        answer.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 160).replace(/\s+/g, ' ');
          onRefusal(`${answer.statusCode} ${req.method} ${path} — ${body}`);
        });
      }
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  })));
}

async function pair(apiOrigin, lanOrigin = apiOrigin) {
  const headers = { 'Content-Type': 'application/json', Origin: apiOrigin };
  const start = await (await fetch(`${apiOrigin}/api/pairing/start`, {
    method: 'POST', headers, body: JSON.stringify({ lan: apiOrigin }),
  })).json();
  if (!start.ok) throw new Error(`Kopplung: ${start.code}`);
  const claim = await (await fetch(`${apiOrigin}/api/pairing/claim`, {
    method: 'POST', headers, body: JSON.stringify({ code: start.code, name: 'Stresshaus', platform: 'ios' }),
  })).json();
  if (!claim.ok) throw new Error(`Kopplung: ${claim.code}`);
  const pairing = { lan: lanOrigin, remote: null, token: claim.token, deviceId: claim.deviceId, name: claim.name, person: null };
  return Buffer.from(JSON.stringify(pairing)).toString('base64');
}

function runDevice({ udid, label, xctestrun, env, record, setStep, coverage }) {
  return new Promise((resolve) => {
    try { simctl(['boot', udid]); } catch { /* läuft schon */ }
    const logStream = spawn('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'compact', '--predicate', 'process == "hauser"'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let current = `${label}: Start`;
    logStream.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (LOG_FINDINGS.some((re) => re.test(line))) {
          setStep(current);
          record('iOS-Log', describeLogLine(line));
        }
      }
    });
    const test = spawn('xcodebuild', [
      'test-without-building', '-xctestrun', xctestrun, '-destination', `id=${udid}`,
    ], { env: { ...process.env, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [`TEST_RUNNER_${k}`, v])) } });
    let buffer = '';
    const onLine = (line) => {
      const stepLine = line.match(/STRESSHAUS-SCHRITT (.*)$/);
      if (stepLine) { current = stepLine[1]; setStep(stepLine[1]); return; }
      const finding = line.match(/STRESSHAUS-BEFUND \[(.*?)\] (.*)$/);
      const cover = line.match(/STRESSHAUS-ABDECKUNG (.*)$/);
      const failure = line.match(/error: -\[.*\] : (.*)$/);
      if (finding) { current = finding[1]; setStep(finding[1]); record('iOS', finding[2]); }
      else if (cover) { const key = `${label} ${cover[1]}`; coverage[key] = (coverage[key] ?? 0) + 1; }
      else if (failure) { setStep(current); record('iOS-Test', failure[1]); }
    };
    const feed = (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(onLine);
    };
    test.stdout.on('data', feed);
    test.stderr.on('data', feed);
    test.on('close', () => {
      if (buffer) onLine(buffer);
      logStream.kill('SIGTERM');
      try { simctl(['shutdown', udid]); } catch { /* schon aus */ }
      resolve();
    });
  });
}

export async function crawlIos({ apiOrigin, record, setStep, coverage, tileLimit, seed = null, operate = false, log = console.log }) {
  if (!existsSync(join(SWIFT_REPO, 'project.yml'))) {
    record('iOS', `Swift-Repo fehlt unter ${SWIFT_REPO}`);
    return;
  }
  const xctestrun = buildForTesting(log);
  let current = 'iOS: Start';
  const proxy = await startProxy(apiOrigin, (line) => { setStep(current); record('iOS-Server', line); });
  const pairing = await pair(apiOrigin, proxy.origin);
  const household = await (await fetch(`${apiOrigin}/api/household-config`, { headers: { Origin: apiOrigin } })).json();
  const rooms = (household.rooms ?? []).map((room) => room.id).join(',');
  const env = {
    STRESSHAUS_PAIRING: pairing,
    STRESSHAUS_ROOMS: rooms,
    ...(Number.isFinite(tileLimit) ? { STRESSHAUS_TILE_LIMIT: String(tileLimit) } : {}),
    ...(seed === null ? {} : { STRESSHAUS_SEED: String(seed) }),
    ...(operate ? { STRESSHAUS_BEDIENEN: '1' } : {}),
  };
  const devices = [
    { label: 'iPhone', udid: ensureSimulator('Stresshaus iPhone', /^iPhone \d+$/) },
    { label: 'iPad', udid: ensureSimulator('Stresshaus iPad', /^iPad/) },
  ];
  for (const device of devices) {
    log(`iOS: ${device.label} …`);
    await runDevice({ ...device, xctestrun, env, record, setStep: (value) => { current = value; setStep(value); }, coverage });
  }
  proxy.close();
}
