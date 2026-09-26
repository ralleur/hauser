/* Der Stresshaus-Crawler: richtet Hauser gegen das nachgebaute Home Assistant
   ein und klickt die gebaute App durch — Einrichtung, jeder Raum, jede Kachel
   (Tippen und Gerätedetail), jeder Tab, jeder Einstellungsbereich, am Panel
   und am Telefon. Jeder Absturz, jede Fehlerzeile in der Konsole und jeder
   Serverfehler landet mit dem Schritt, in dem er passierte, im Bericht.

   Voraussetzung: gebautes dist/ (npm run build). Alles läuft in einem
   Wegwerf-Ordner; Werkstatt und echter Haushalt bleiben unberührt.

     node scripts/stresshaus/crawl.mjs            — alles
     node scripts/stresshaus/crawl.mjs --quick    — höchstens 6 Kacheln je Raum
     node scripts/stresshaus/crawl.mjs --dev      — gegen Vite statt dist/: Svelte
                                                    nennt doppelte Schlüssel beim Namen
     node scripts/stresshaus/crawl.mjs --ios      — danach dieselbe Runde in der iOS-App
                                                    (Simulator, Swift-Repo hauser-app-swift)
     node scripts/stresshaus/crawl.mjs --nur-ios  — nur die iOS-App
     node scripts/stresshaus/crawl.mjs --seed=42  — gewürfelte Geräte, Sprache, Bildschirm und
                                                    Einstellungskombinationen; dieselbe Zahl
                                                    wiederholt denselben Lauf
     --szenarien=<ordner>                         — ausgedachte Szenarien (JSON) dazunehmen
     --gross                                      — Großrunde: jede Geräteart mit jeder Macke,
                                                    40 Räume, Fluten, Energie, Bedienen im Detail
     --bedienen                                   — im Gerätedetail jeden Knopf und Regler bedienen
     --unruhe                                     — HA hält nie still: Zustände kippen, Geräte
                                                    verschwinden, Dienste scheitern, Neustarts
     --haus=leer|unavailable|imperial             — ein ganz anderes Haus
     --zeitzone=<IANA>                            — Browser in dieser Zeitzone
     --alle-einstellungen                         — jede Einstellung einzeln, jede Option
     STRESSHAUS_KEEP=1 …                          — Wegwerf-Ordner behalten

   Exit 0 heißt: nichts gefunden. Exit 1: Befunde, siehe Bericht. */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeHa } from './fake-ha.mjs';
import { crawlIos } from './ios.mjs';
import { hostileHomeWith, seededRandom } from '../../src/lib/stresshaus/hostile-home.ts';
import { applyVariant, grossrundeScenarios } from '../../src/lib/stresshaus/grossrunde.ts';
import { readdirSync, readFileSync } from 'node:fs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const QUICK = process.argv.includes('--quick');
const DEV = process.argv.includes('--dev');
const IOS_ONLY = process.argv.includes('--nur-ios');
const IOS = IOS_ONLY || process.argv.includes('--ios');
const TILE_LIMIT = QUICK ? 6 : Infinity;
const argValue = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const SEED = argValue('seed') === null ? null : Number(argValue('seed'));
const SCENARIO_DIR = argValue('szenarien');
const GROSS = process.argv.includes('--gross');
const OPERATE = GROSS || process.argv.includes('--bedienen');
const UNREST = process.argv.includes('--unruhe');
const HOUSE = argValue('haus');
const ALL_SETTINGS = process.argv.includes('--alle-einstellungen');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Diese Konsolenzeilen sind erwartet: das Stresshaus lässt absichtlich
   Kalender, Kamera und Bilder scheitern. Alles andere ist ein Befund. */
const EXPECTED_CONSOLE = [
  /Failed to load resource/,
  /Kalender calendar\.kaputt/,
  /Stream nicht verfügbar/,
  /Stresshaus sagt nein/,
];

/* Serverantworten ≥ 500, die gewollt sind: das Stresshaus richtet manche
   Dienste bewusst nicht ein, und der Server sagt das mit 503. */
const EXPECTED_SERVER = [
  /^\/api\/shopping\/notion/, // „Notion ist nicht eingerichtet" — die Einstellungsrunde wählt Notion als Quelle
];

function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function waitFor(fn, { timeout = 20_000, every = 250, what = 'Bedingung' } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > until) throw new Error(`Zeitüberschreitung: ${what}`);
    await sleep(every);
  }
}

/* ── Hauser-Server in einem Wegwerf-Ordner ── */
async function startHauser(root) {
  if (!DEV && !existsSync(join(APP, 'dist/index.html'))) throw new Error('dist/ fehlt — erst npm run build');
  const port = await freePort();
  const devPort = DEV ? await freePort() : null;
  const apiOrigin = `http://127.0.0.1:${port}`;
  const origin = DEV ? `http://127.0.0.1:${devPort}` : apiOrigin;
  for (const dir of ['config', 'data', 'assets', 'tmp', 'uploads']) mkdirSync(join(root, dir), { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    HMI_HOST: '127.0.0.1',
    HMI_PORT: String(port),
    HMI_ALLOWED_ORIGINS: [apiOrigin, origin].join(','),
    HMI_AI_CUSTOMIZING_ENABLED: '0',
    HMI_HOUSEHOLD_CONFIG_PATH: join(root, 'config/household.json'),
    HMI_HOUSEHOLD_CONFIG_MODE: 'active',
    HMI_CONFIG_PATH: join(root, 'data/config.json'),
    HMI_FAMILY_DATA_PATH: join(root, 'data/family-data.json'),
    HMI_MOMENTS_STATE_PATH: join(root, 'data/moments-state.json'),
    HMI_NOTIFICATION_RULES_PATH: join(root, 'data/notification-rules.json'),
    HMI_PAIRING_DEVICES_PATH: join(root, 'data/devices.json'),
    HMI_HOTEL_MODE_DATA_PATH: join(root, 'data/hotel.json'),
    HMI_SONG_LIBRARY_DIR: join(root, 'data/songs'),
    HMI_TUNNEL_STATE: join(root, 'data/tunnel'),
    HMI_TUNNEL_CONTROL: '127.0.0.1:9',
    HMI_ROOM_IMAGE_AUTH_MODE: 'direct',
    HMI_ROOM_IMAGE_ASSET_ROOT: join(root, 'assets'),
    HMI_ROOM_IMAGE_TEMP_ROOT: join(root, 'tmp'),
    HMI_ROOM_IMAGE_UPLOAD_ROOT: join(root, 'uploads'),
    HMI_ROOM_IMAGE_CREDENTIAL_PATH: join(root, 'data/room-image-credential.json'),
    HMI_AMBIENT_MAP_ASSET_ROOT: join(root, 'assets/map'),
    HMI_AMBIENT_MAP_CONFIG_PATH: join(root, 'data/ambient-map.json'),
    HMI_KEYCHAIN_SERVICE: 'hauser-stresshaus',
    HMI_ABLAGE_KEYCHAIN_SERVICE: 'hauser-stresshaus',
    HMI_FEEDBACK_URL: 'http://127.0.0.1:9/',
    HMI_OPENAI_API_KEY: '',
  };
  const log = [];
  const child = spawn(process.execPath, ['server.mjs'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  await waitFor(async () => (await fetch(`${apiOrigin}/api/health`)).status > 0, { what: 'Hauser-Server', timeout: 30_000 })
    .catch((err) => { throw new Error(`${err.message}\n${log.join('')}`); });
  let vite = null;
  if (DEV) {
    vite = spawn(join(APP, 'node_modules/.bin/vite'), ['--port', String(devPort), '--strictPort', '--host', '127.0.0.1'], {
      cwd: APP, env: { ...env, NODE_ENV: 'development', HMI_DEV_API_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stderr.on('data', (d) => log.push(String(d)));
    await waitFor(async () => (await fetch(`${origin}/`)).ok, { what: 'Vite', timeout: 60_000 });
  }
  return { origin, apiOrigin, log, stop: () => { child.kill('SIGTERM'); vite?.kill('SIGTERM'); } };
}

/* ── Chrome per DevTools-Protokoll ── */
async function startChrome(root) {
  const port = await freePort();
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(root, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank',
  ], { stdio: 'ignore' });
  const targets = await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json`)).json(), { what: 'Chrome' });
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    on: (fn) => listeners.add(fn),
    stop: () => { try { ws.close(); } catch { /* egal */ } chrome.kill('SIGKILL'); },
  };
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'stresshaus-'));
  const findings = [];
  const coverage = { Einrichtungsräume: 0, Räume: 0, Kacheln: 0, Gerätedetails: 0, Tabs: 0, Einstellungsbereiche: 0, Telefonräume: 0, Telefonkacheln: 0, Telefondetails: 0, Telefonziele: 0, Ruhebilder: 0 };
  let step = 'Start';
  /* Ein Befund zählt einmal, egal wie oft er auftritt; der erste Schritt, in
     dem er auftrat, steht dabei. Die Konsolenzeile der Auffangnetze ist
     dieselbe Nachricht wie der sichtbare Absturz und wird nicht doppelt
     gezählt. */
  const record = (kind, detail) => {
    const text = String(detail).replace(/^\[hauser\] Bereich konnte nicht aufgebaut werden: /, '').slice(0, 600);
    const key = text.replace(/^Diese Ansicht ist beim Aufbau gescheitert\. /, '').replace(/ Erneut versuchen$/, '').split('\n')[0];
    const known = findings.find((f) => f.key === key);
    if (known) { known.count++; return; }
    findings.push({ step, kind, text, key, count: 1 });
    console.log(`  ✗ [${kind}] ${key}  ← ${step}`);
  };

  /* Ausgedachte Szenarien: jede Datei ein Szenario oder eine Liste davon. */
  const scenarios = [];
  if (SCENARIO_DIR && existsSync(SCENARIO_DIR)) {
    for (const file of readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).sort()) {
      try { scenarios.push(...[JSON.parse(readFileSync(join(SCENARIO_DIR, file), 'utf8'))].flat()); }
      catch (err) { console.log(`Szenario ${file} unlesbar: ${err.message}`); }
    }
  }
  if (GROSS) scenarios.push(...grossrundeScenarios());
  const home = hostileHomeWith({ seed: SEED, scenarios });
  if (HOUSE) applyVariant(home, HOUSE);
  const rng = seededRandom(SEED ?? 1);
  const pickOne = (list) => list[Math.floor(rng() * list.length)];
  const locale = SEED === null ? null : pickOne(['de', 'en', 'fr', 'it', 'pl', 'pt']);
  const panelSize = SEED === null ? { width: 1280, height: 800 } : pickOne([
    { width: 1280, height: 800 }, { width: 1194, height: 834 }, { width: 1920, height: 1080 }, { width: 1024, height: 600 }, { width: 2560, height: 1440 },
  ]);
  const phoneSize = SEED === null ? { width: 390, height: 844 } : pickOne([
    { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 430, height: 932 }, { width: 320, height: 568 },
  ]);
  const timezone = argValue('zeitzone') ?? (SEED === null ? null : pickOne([
    'Europe/Berlin', 'Pacific/Kiritimati', 'America/St_Johns', 'Asia/Kathmandu', 'Pacific/Pago_Pago', 'Australia/Lord_Howe',
  ]));
  console.log(`Runde: ${[GROSS && 'Großrunde', OPERATE && 'Bedienen', UNREST && 'Unruhe', HOUSE && `Haus ${HOUSE}`, ALL_SETTINGS && 'alle Einstellungen', timezone && `Zeitzone ${timezone}`].filter(Boolean).join(', ') || 'Grundrunde'}`);
  if (SEED !== null) console.log(`Startzahl ${SEED}: Sprache ${locale}, Panel ${panelSize.width}×${panelSize.height}, Telefon ${phoneSize.width}×${phoneSize.height}, ${scenarios.length} Szenarien`);
  const ha = await startFakeHa({
    home, unruhe: UNREST, seed: SEED ?? 1,
    log: (line) => { if (!line.startsWith('Unruhe:')) record('fake-ha', line); },
  });
  const hauser = await startHauser(root);
  const chrome = await startChrome(root);
  const { send } = chrome;

  chrome.on((msg) => {
    /* Rückfragen („Wirklich löschen?") blockieren die Seite — ablehnen, weiter. */
    if (msg.method === 'Page.javascriptDialogOpening') {
      void send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      coverage.Rückfragen = (coverage.Rückfragen ?? 0) + 1;
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const frames = (d.stackTrace?.callFrames ?? []).slice(0, 4)
        .map((f) => `${f.functionName || '?'} ${f.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}:${f.lineNumber + 1}`);
      record('Ausnahme', [d.exception?.description ?? d.text, ...frames].join('\n'));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
        + (msg.params.stackTrace?.callFrames?.[0] ? `\n@ ${msg.params.stackTrace.callFrames.slice(0, 3).map((f) => `${f.functionName || '?'} ${f.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}:${f.lineNumber + 1}`).join(' < ')}` : '');
      if (!EXPECTED_CONSOLE.some((re) => re.test(text))) record('Konsole', text);
    } else if (msg.method === 'Network.responseReceived') {
      const { status, url } = msg.params.response;
      const path = url.slice(hauser.origin.length);
      /* Vor der Einrichtung antwortet /api/* absichtlich mit 503. */
      const beforeSetup = step.startsWith('Einrichtung') && status === 503;
      const expected = status === 503 && EXPECTED_SERVER.some((re) => re.test(path));
      if (status >= 500 && url.startsWith(hauser.origin) && !beforeSetup && !expected) record('Server', `${status} ${path}`);
    }
  });

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { ...panelSize, deviceScaleFactor: 1, mobile: false });
  if (timezone) await send('Emulation.setTimezoneOverride', { timezoneId: timezone });
  if (locale) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { if (!localStorage.getItem('stresshaus-locale')) { localStorage.setItem('PARAGLIDE_LOCALE', ${JSON.stringify(locale)}); localStorage.setItem('stresshaus-locale', '1'); } } catch {}`,
    });
  }

  const evaluate = async (expression) => {
    const out = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
    return out.result.value;
  };
  /* Nach einem Absturz lädt der Crawler neu: ein abgestürzter Bereich bleibt
     sonst stehen, und jeder weitere Schritt meldete denselben Fehler. */
  let afterCrash = async () => {};
  const boundaries = async () => {
    const texts = await evaluate(`[...document.querySelectorAll('.screen-boundary')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())`);
    for (const t of texts ?? []) record('Absturz', t);
    if (!texts?.length) return false;
    await send('Page.reload');
    await sleep(4000);
    /* Stürzt schon der Weg zurück ab, geht der Lauf beim nächsten Schritt
       weiter — ein Befund soll nicht alle folgenden verdecken. */
    await afterCrash().catch((err) => record('Crawler', `Wiederaufsetzen gescheitert: ${err.message}`));
    return true;
  };
  const click = (selector, index = 0) => evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  })()`);
  const center = (selector, index) => evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  const longPress = async (selector, index) => {
    const p = await center(selector, index);
    if (!p) return false;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(900);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    return true;
  };
  const escape = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  };
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);

  /* Bedienen: im offenen Gerätedetail jeden Knopf drücken und jeden Regler
     auf Minimum, Maximum und Mitte ziehen. Schließen, Umbenennen, Entfernen
     und Gruppenbau bleiben liegen — sie beenden das Detail oder verändern das
     Haus dauerhaft. */
  const DETAIL = '.light-detail.is-open';
  const DETAIL_SPARE = /schließ|close|entfern|lösch|remove|delete|umbenenn|rename|gruppe|group|zurück|back/i;
  const operateDetail = async (where, container = DETAIL) => {
    if (!OPERATE || !(await count(container))) return;
    const DETAIL = container;
    const controls = await evaluate(`[...document.querySelectorAll('${DETAIL} button, ${DETAIL} input[type=range], ${DETAIL} select')].map((el) => ({
      tag: el.tagName, type: el.type, min: el.min, max: el.max, options: el.options?.length ?? 0,
      label: (el.getAttribute('aria-label') || el.innerText || el.title || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    }))`);
    for (let c = 0; c < controls.length; c++) {
      const control = controls[c];
      if (DETAIL_SPARE.test(control.label)) continue;
      const values = control.type === 'range'
        ? [control.min || '0', control.max || '100', String((Number(control.min || 0) + Number(control.max || 100)) / 2)]
        : control.tag === 'SELECT' ? Array.from({ length: Math.min(control.options, 6) }, (_, i) => String(i)) : [null];
      for (const value of values) {
        step = `${where}, bedient „${control.label || control.tag.toLowerCase()}"${value === null ? '' : ` = ${value}`}`;
        const still = await evaluate(`(() => {
          const el = document.querySelectorAll('${DETAIL} button, ${DETAIL} input[type=range], ${DETAIL} select')[${c}];
          if (!el) return false;
          if (el.type === 'range') {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
          } else if (el.tagName === 'SELECT') {
            el.selectedIndex = ${value === null ? 0 : Number(value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else el.click();
          return true;
        })()`);
        if (!still) return;
        coverage['Bedienelemente im Detail'] = (coverage['Bedienelemente im Detail'] ?? 0) + 1;
        await sleep(120);
        if (await boundaries()) return;
      }
      /* Ein Knopf kann das Detail schließen oder eine Unterauswahl öffnen. */
      if (!(await count(DETAIL))) return;
    }
  };

  try {
    /* ── Einrichtung wie ein neuer Haushalt ── */
    step = 'Einrichtung: Verbinden';
    console.log(`Stresshaus: HA ${ha.url}, Hauser ${hauser.origin}`);
    await send('Page.navigate', { url: hauser.origin });
    await waitFor(() => evaluate(`!!document.querySelector('input[type=url]')`), { what: 'Einrichtungsformular', timeout: 30_000 });
    await evaluate(`(() => {
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[type=url]'), ${JSON.stringify(ha.url)});
      set(document.querySelector('input[type=password]'), 'stresshaus-token');
      document.querySelector('input[type=url]').form.requestSubmit();
    })()`);
    step = 'Einrichtung: Räume';
    /* Ein leeres Home Assistant schlägt keinen Raum vor — dann steht nur „Raum hinzufügen" da. */
    await waitFor(() => evaluate(`document.querySelectorAll('.room-expand').length + document.querySelectorAll('.add-room').length`), { what: 'Raumliste der Einrichtung', timeout: 30_000 });
    await boundaries();
    const setupRooms = await count('.room-expand');
    for (let i = 0; i < setupRooms; i++) {
      step = `Einrichtung: Raum ${i + 1} aufklappen`;
      await click('.room-expand', i);
      coverage.Einrichtungsräume++;
      await sleep(150);
      await boundaries();
    }
    step = 'Einrichtung: Aktivieren';
    await click('button.primary[type=button]');
    await waitFor(() => count('.done button.primary'), { what: 'Einrichtung abgeschlossen', timeout: 30_000 })
      .catch(async (err) => { record('Einrichtung', `${err.message}: ${await evaluate('document.body.innerText.slice(0, 400)')}`); throw err; });
    await click('.done button.primary');

    /* ── Ausstatten: alle Module an, Energie und Kalender belegt — auch mit
       Sensoren, die es nicht gibt oder die etwas anderes messen ── */
    step = 'Ausstatten';
    await waitFor(() => count('[data-nav]'), { what: 'Startseite nach der Einrichtung', timeout: 90_000 })
      .catch(async (err) => {
        const screen = await evaluate(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400)`).catch(() => '?');
        const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (shot) writeFileSync(join(root, 'haengt.png'), Buffer.from(shot.data, 'base64'));
        throw new Error(`${err.message} — sichtbar: ${screen}`);
      });
    const calendars = home.states.filter((s) => s.entity_id.startsWith('calendar.')).map((s) => s.entity_id);
    /* Energie: sonst drei ausgesuchte Fälle, in der Großrunde jeder Leistungssensor des Hauses. */
    const powerSensors = home.states.filter((s) => s.entity_id.startsWith('sensor.') && s.attributes.device_class === 'power').map((s) => s.entity_id);
    const energySelection = GROSS
      ? {
        production: ['sensor.pv_leistung', 'sensor.speicher_leistung_mw', 'sensor.leistung_unavailable'].filter((id) => powerSensors.includes(id)),
        consumption: powerSensors.filter((id) => !['sensor.pv_leistung', 'sensor.speicher_leistung_mw', 'sensor.leistung_unavailable'].includes(id))
          .slice(0, 80).map((entityId) => ({ entityId, name: entityId.split('.')[1] })),
      }
      : {
        production: ['sensor.kuche_leistung', 'sensor.verwaist'],
        consumption: [
          { entityId: 'sensor.kuche_leistung', name: 'Küche' },
          { entityId: 'sensor.gibt_es_nicht', name: 'Weg' },
          { entityId: 'sensor.wohnzimmer', name: 'Misst Grad statt Watt' },
        ],
      };
    const todos = home.states.filter((s) => s.entity_id.startsWith('todo.')).map((s) => s.entity_id);
    /* Läden mit feindlichen Namen an die Listen binden: 60 Zeichen mit Emoji und ł, dazu einer ohne Liste — Web und iOS lesen dieselbe Konfiguration. */
    const shoppingConfig = { version: 1, provider: 'ha', stores: [
      { id: 'laden', label: '🛒 Łukasz’ Gemüseladen an der Straße mit dem sehr langen Namen', categories: [], entityId: 'todo.einkaufsliste' },
      { id: 'leer', label: 'Leer', categories: [], entityId: 'todo.leer' },
      { id: 'ohne', label: 'Ohne Liste', categories: [], entityId: null },
    ] };
    const outfit = await evaluate(`(async () => {
      const out = [];
      const etagOf = async (path) => { const r = await fetch(path, { cache: 'no-store' }); await r.text(); return r.headers.get('etag'); };
      const put = async (path, etagPath, body) => {
        const r = await fetch(path, { method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'If-Match': await etagOf(etagPath) }, body: JSON.stringify(body) });
        out.push(path + ' ' + r.status);
      };
      for (const id of ['energy', 'calendar', 'notes', 'media', 'library']) {
        await put('/api/household-modules/' + id, '/api/household-config', { enabled: true, name: id });
      }
      await put('/api/household-energy', '/api/household-config', ${JSON.stringify(energySelection)});
      await put('/api/config', '/api/config', { updates: {
        'hmi:calendar-selected': ${JSON.stringify(JSON.stringify(calendars))},
        'hmi:reminders-selected': ${JSON.stringify(JSON.stringify(todos))},
        'hmi:shopping-config:v1': ${JSON.stringify(JSON.stringify(shoppingConfig))},
      } });
      return out;
    })()`);
    /* Media ohne einen einzigen Mediaplayer lehnt der Server mit 409 und Grund ab — gewollt. */
    for (const line of outfit) if (!/ 200$/.test(line) && !/household-modules\/media 409$/.test(line)) record('Ausstatten', line);

    if (!IOS_ONLY) {
    /* ── Panel ── */
    step = 'Panel: Start';
    await send('Page.reload');
    await waitFor(() => count('[data-nav]'), { what: 'Startseite', timeout: 40_000 });
    await sleep(1500);
    await boundaries();

    const rooms = await evaluate(`[...new Set([...document.querySelectorAll('[data-room]')].map((el) => el.dataset.room))]`);
    console.log(`Panel: ${rooms.length} Räume`);
    const selectRoom = (roomId) => evaluate(`(() => { const el = document.querySelector('[data-room=${JSON.stringify(roomId)}]'); el?.scrollIntoView(); el?.click(); })()`);
    for (const roomId of rooms) {
      step = `Panel: Raum ${roomId}`;
      afterCrash = async () => {
        await waitFor(() => count('[data-nav]'), { what: 'Startseite nach Neuladen', timeout: 30_000 });
        await selectRoom(roomId);
        await sleep(500);
      };
      await selectRoom(roomId);
      coverage.Räume++;
      await sleep(500);
      await boundaries();
      const tiles = Math.min(await count('.home-panel .light-tile'), TILE_LIMIT);
      for (let i = 0; i < tiles; i++) {
        step = `Panel: Raum ${roomId}, Kachel ${i + 1} tippen`;
        await click('.home-panel .light-tile', i);
        coverage.Kacheln++;
        await sleep(250);
        await boundaries();
        step = `Panel: Raum ${roomId}, Kachel ${i + 1} Detail`;
        if (await longPress('.home-panel .light-tile', i)) {
          await sleep(500);
          if (await count('.light-detail.is-open')) coverage.Gerätedetails++;
          await boundaries();
          await operateDetail(`Panel: Raum ${roomId}, Kachel ${i + 1}`);
          await escape();
          await sleep(350);
        }
      }
      if (OPERATE) {
        /* Szenen anwenden, die erste bearbeiten; den Raum selbst bearbeiten. */
        const scenes = await count('.home-panel .scene-btn');
        for (let sc = 0; sc < scenes; sc++) {
          step = `Panel: Raum ${roomId}, Szene ${sc + 1}`;
          await click('.home-panel .scene-btn', sc);
          coverage.Szenen = (coverage.Szenen ?? 0) + 1;
          await sleep(300);
          await boundaries();
        }
        if (scenes && await longPress('.home-panel .scene-btn', 0)) {
          await sleep(600);
          if (await count('.scene-edit.is-open')) coverage['Szenen bearbeitet'] = (coverage['Szenen bearbeitet'] ?? 0) + 1;
          await operateDetail(`Panel: Raum ${roomId}, Szene bearbeiten`, '.scene-edit.is-open');
          await escape();
          await sleep(400);
        }
        step = `Panel: Raum ${roomId} bearbeiten`;
        const index = await evaluate(`[...document.querySelectorAll('[data-room]')].findIndex((el) => el.dataset.room === ${JSON.stringify(roomId)})`);
        if (index >= 0 && await longPress('[data-room]', index)) {
          await sleep(600);
          if (await count('.room-edit.is-open')) coverage['Räume bearbeitet'] = (coverage['Räume bearbeitet'] ?? 0) + 1;
          await boundaries();
          await operateDetail(`Panel: Raum ${roomId} bearbeiten`, '.room-edit.is-open:not(.scene-edit)');
          await escape();
          await sleep(400);
        }
      }
    }

    const tabs = await evaluate(`[...document.querySelectorAll('[data-nav]')].map((el) => el.dataset.nav)`);
    for (const tab of tabs) {
      step = `Panel: Tab ${tab}`;
      afterCrash = async () => {
        await waitFor(() => count('[data-nav]'), { what: 'Tabs nach Neuladen', timeout: 30_000 });
        await click(`[data-nav=${JSON.stringify(tab)}]`);
        await sleep(1000);
      };
      await click(`[data-nav=${JSON.stringify(tab)}]`);
      coverage.Tabs++;
      await sleep(1500);
      await boundaries();
      if (tab === 'system') {
        const sections = await count('.settings-nav-btn');
        for (let i = 0; i < sections; i++) {
          step = `Panel: Einstellungen, Bereich ${i + 1}`;
          await click('.settings-nav-btn', i);
          coverage.Einstellungsbereiche++;
          await sleep(700);
          await boundaries();
        }
      }
    }

    /* ── Einstellungsrunde: in jedem Bereich eine gewürfelte Auswahl an
       Schaltern, Optionen und Listen umstellen, dann Start, Raum und Gerät
       ansehen. Ohne Startzahl stellt sie nichts um. Was die Sitzung beendet
       (Bearbeiten sperren, Zurücksetzen, Löschen), bleibt unberührt. ── */
    if (SEED !== null || ALL_SETTINGS) {
      const CONTROLS = '.settings-pane-content [role=switch], .settings-pane-content [role=radio], .settings-pane-content .settings-option, .settings-pane-content .settings-chip, .settings-pane-content select';
      const SPARE = /bearbeit|bedienen|sperr|pin|hotel|zurücksetz|löschen|entfern|abmeld|reset|delete|remove|edit mode|lock/i;
      const goSystem = async () => { await click('[data-nav="system"]'); await sleep(1200); };
      afterCrash = async () => { await waitFor(() => count('[data-nav]'), { what: 'Tabs nach Neuladen', timeout: 30_000 }); await goSystem(); };
      await goSystem();
      const sections = await count('.settings-nav-btn');
      for (let i = 0; i < sections; i++) {
        step = `Einstellungsrunde: Bereich ${i + 1}`;
        await click('.settings-nav-btn', i);
        await sleep(800);
        const controls = await evaluate(`[...document.querySelectorAll(${JSON.stringify(CONTROLS)})].map((el) => ({
          kind: el.tagName === 'SELECT' ? 'select' : 'button', options: el.tagName === 'SELECT' ? el.options.length : 0,
          label: (el.closest('.settings-row, label, li, section')?.innerText ?? el.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 60),
          disabled: !!el.disabled,
        }))`);
        const changes = [];
        for (let c = 0; c < controls.length; c++) {
          const control = controls[c];
          if (control.disabled || SPARE.test(control.label) || (!ALL_SETTINGS && rng() > 0.35)) continue;
          /* Alle Einstellungen: jede Option einer Liste einmal, sonst eine gewürfelte. */
          const choices = control.kind !== 'select' ? [null]
            : ALL_SETTINGS ? Array.from({ length: Math.min(control.options, 8) }, (_, o) => o)
            : [Math.floor(rng() * Math.max(1, control.options))];
          for (const choice of choices) {
          changes.push(`${control.label || control.kind}${choice === null ? '' : ` → ${choice + 1}`}`);
          step = `Einstellungsrunde: Bereich ${i + 1}, „${control.label || control.kind}"`;
          await evaluate(`(() => {
            const el = document.querySelectorAll(${JSON.stringify(CONTROLS)})[${c}];
            if (!el) return;
            el.scrollIntoView({ block: 'center' });
            if (el.tagName === 'SELECT') { el.selectedIndex = ${choice ?? 0}; el.dispatchEvent(new Event('change', { bubbles: true })); }
            else el.click();
          })()`);
          coverage.Einstellungsschalter = (coverage.Einstellungsschalter ?? 0) + 1;
          await sleep(350);
          if (await boundaries()) break;
          }
        }
        /* Wirkung ansehen: Start, ein Raum, ein Gerät. */
        step = `Einstellungsrunde: Bereich ${i + 1} → Start (${changes.slice(0, 4).join('; ')})`;
        await click('[data-nav="home"]');
        await sleep(1000);
        await boundaries();
        const roomCount = await count('[data-room]');
        if (roomCount) {
          await click('[data-room]', Math.floor(rng() * roomCount));
          await sleep(500);
          const tiles = await count('.home-panel .light-tile');
          if (tiles && await longPress('.home-panel .light-tile', Math.floor(rng() * tiles))) {
            await sleep(500);
            await boundaries();
            await escape();
            await sleep(300);
          }
        }
        await goSystem();
      }
    }

    /* ── Ruhebild: Uhr, Wochenband, Zettel, Wetter — tags und in tiefer Nacht ── */
    for (const [label, query] of [['Ruhebild', '?idle=2'], ['Ruhebild Nacht', '?idle=2&deepnight=1']]) {
      step = `Panel: ${label}`;
      afterCrash = async () => {};
      await send('Page.navigate', { url: `${hauser.origin}/${query}` });
      if (await waitFor(() => count('.ambient.is-on'), { what: label, timeout: 30_000 }).catch(() => 0)) coverage.Ruhebilder++;
      await sleep(4000);
      await boundaries();
    }
    await send('Page.navigate', { url: hauser.origin });
    await waitFor(() => count('[data-nav]'), { what: 'Startseite nach dem Ruhebild', timeout: 30_000 });

    /* ── Telefon ── */
    step = 'Telefon: Start';
    await send('Emulation.setDeviceMetricsOverride', { ...phoneSize, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await send('Page.reload');
    await waitFor(() => count('.phone-nav-target'), { what: 'Telefon-Start', timeout: 40_000 });
    await sleep(1500);
    await boundaries();
    const phoneRooms = await count('.phone-room-card');
    console.log(`Telefon: ${phoneRooms} Räume`);
    const closeSheet = async () => {
      await escape();
      await sleep(250);
      await evaluate(`document.querySelector('.room-sheet-scrim')?.click()`);
      await sleep(400);
    };
    for (let r = 0; r < phoneRooms; r++) {
      step = `Telefon: Raum ${r + 1}`;
      afterCrash = async () => {
        await waitFor(() => count('.phone-nav-target'), { what: 'Telefon-Start nach Neuladen', timeout: 30_000 });
        await click('.phone-room-card', r);
        await sleep(800);
      };
      await click('.phone-room-card', r);
      if (await waitFor(() => count('.room-sheet'), { what: 'Raumblatt', timeout: 3000 }).catch(() => 0)) coverage.Telefonräume++;
      await sleep(500);
      await boundaries();
      const tiles = Math.min(await count('.room-sheet .light-tile'), TILE_LIMIT);
      for (let i = 0; i < tiles; i++) {
        step = `Telefon: Raum ${r + 1}, Kachel ${i + 1} tippen`;
        await click('.room-sheet .light-tile', i);
        coverage.Telefonkacheln++;
        await sleep(250);
        await boundaries();
        step = `Telefon: Raum ${r + 1}, Kachel ${i + 1} Detail`;
        if (await longPress('.room-sheet .light-tile', i)) {
          await sleep(500);
          if (await count('.light-detail.is-open')) coverage.Telefondetails++;
          await boundaries();
          await operateDetail(`Telefon: Raum ${r + 1}, Kachel ${i + 1}`);
          await escape();
          await sleep(350);
        }
      }
      await closeSheet();
    }
    const phoneTabs = await count('.phone-nav-target');
    for (let t = 0; t < phoneTabs; t++) {
      step = `Telefon: Tab ${t + 1}`;
      afterCrash = async () => {
        await waitFor(() => count('.phone-nav-target'), { what: 'Telefon-Tabs nach Neuladen', timeout: 30_000 });
      };
      await click('.phone-nav-target', t);
      await sleep(1500);
      await boundaries();
      const targets = await count('.more-sheet-target');
      for (let i = 0; i < targets; i++) {
        step = `Telefon: Mehr, Ziel ${i + 1}`;
        if (!(await count('.more-sheet-target'))) await click('.phone-nav-target', t);
        await sleep(400);
        await click('.more-sheet-target', i);
        coverage.Telefonziele++;
        await sleep(1500);
        await boundaries();
      }
    }
    }

    /* ── iOS-App: dieselbe Runde im Simulator ── */
    if (IOS) {
      await crawlIos({
        apiOrigin: hauser.apiOrigin, record, coverage, tileLimit: TILE_LIMIT, seed: SEED, operate: OPERATE,
        setStep: (value) => { step = value; },
      });
    }
  } catch (err) {
    record('Crawler', err.stack ?? err);
  } finally {
    chrome.stop();
    hauser.stop();
    await ha.close();
  }

  const serverErrors = hauser.log.join('').split('\n')
    .filter((line) => /error|unhandled|TypeError|fehlgeschlagen/i.test(line) && !/Stresshaus sagt nein|\[vite\] \(client\)/.test(line));
  step = 'Server-Log';
  for (const line of serverErrors.slice(0, 20)) record('Server', line);

  const report = join(root, 'bericht.json');
  writeFileSync(report, JSON.stringify({ seed: SEED, locale, panelSize, phoneSize, scenarios: scenarios.map((x) => x.name), coverage, findings, haCalls: Object.fromEntries(ha.seen) }, null, 2));
  if (process.env.STRESSHAUS_REPORT) writeFileSync(process.env.STRESSHAUS_REPORT, readFileSync(report));
  console.log(`\nAbgedeckt: ${Object.entries(coverage).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(`HA-Aufrufe: ${[...ha.seen.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`\n${findings.length === 0 ? 'Keine Befunde.' : `${findings.length} Befunde:`}`);
  for (const f of findings) console.log(`- ${f.kind} (${f.count}×, zuerst: ${f.step})\n    ${f.text.split('\n').slice(0, 8).join('\n    ')}`);
  if (process.env.STRESSHAUS_KEEP) console.log(`\nOrdner: ${root}`);
  else rmSync(root, { recursive: true, force: true });
  process.exit(findings.length === 0 ? 0 : 1);
}

await main();
