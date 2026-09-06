#!/usr/bin/env node
/* FCP und TTI eines Produktionsbuilds messen (ADR-027/ADR-029).

   Headless Chrome über CDP, mobile Emulation und CPU-Drossel, damit die Zahl
   nicht die des Entwicklungsrechners ist. TTI nach der üblichen Definition:
   ab FCP das erste 5-Sekunden-Fenster ohne Long Task; Ende der letzten
   vorangehenden Long Task ist der Wert.

   Aufruf: node scripts/measure-startup.mjs http://127.0.0.1:4197/ [--runs 5] [--cpu 4]
*/

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] ?? 'http://127.0.0.1:4197/';
const runs = Number(argValue('--runs') ?? 5);
const cpuRate = Number(argValue('--cpu') ?? 4);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const profile = mkdtempSync(join(tmpdir(), 'hauser-startup-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9333',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--disable-gpu',
], { stdio: 'ignore' });

async function endpoint() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9333/json/version');
      return (await response.json()).webSocketDebuggerUrl;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('Chrome-DevTools-Endpunkt nicht erreichbar.');
}

/* Läuft in der Seite: sammelt Paint- und Long-Task-Einträge und leitet daraus
   FCP und TTI ab, sobald 5 s ohne Long Task vergangen sind. */
const COLLECTOR = `
  new Promise((resolve) => {
    const longTasks = [];
    let fcp = null;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') fcp = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry);
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* ohne Long-Task-API bleibt TTI = FCP */ }

    const finish = () => {
      const quiet = 5000;
      let candidate = fcp ?? 0;
      for (const task of longTasks) {
        const end = task.startTime + task.duration;
        if (end <= candidate) continue;
        if (task.startTime - candidate >= quiet) break;
        candidate = end;
      }
      resolve({
        fcp,
        tti: candidate,
        longTasks: longTasks.map((task) => ({ start: task.startTime, duration: task.duration })),
        domContentLoaded: performance.timing
          ? performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
          : null,
      });
    };
    /* Das Skript kann nach dem load-Ereignis ankommen — dann sofort warten
       statt auf ein Ereignis, das nicht mehr kommt. */
    if (document.readyState === 'complete') setTimeout(finish, 6000);
    else addEventListener('load', () => setTimeout(finish, 6000), { once: true });
  })
`;

async function measure(socketUrl) {
  const { default: WebSocketImpl } = { default: globalThis.WebSocket };
  const socket = new WebSocketImpl(socketUrl);
  let seq = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = (seq += 1);
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  const results = [];
  for (let run = 0; run < runs; run += 1) {
    await send('Network.enable', {}, sessionId);
    await send('Network.clearBrowserCache', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    }, sessionId);
    await send('Emulation.setCPUThrottlingRate', { rate: cpuRate }, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Page.navigate', { url: 'about:blank' }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url }, sessionId);
    const evaluated = await send('Runtime.evaluate', {
      expression: COLLECTOR,
      awaitPromise: true,
      returnByValue: true,
      timeout: 60000,
    }, sessionId);
    results.push(evaluated.result.value);
  }

  socket.close();
  return results;
}

try {
  const results = await measure(await endpoint());
  const fcps = results.map((result) => result.fcp).filter((value) => value !== null).sort((a, b) => a - b);
  const ttis = results.map((result) => result.tti).sort((a, b) => a - b);
  const median = (values) => values[Math.floor(values.length / 2)];
  const longest = Math.max(0, ...results.flatMap((result) => result.longTasks.map((task) => task.duration)));
  console.log(JSON.stringify({
    url,
    runs,
    cpuThrottlingRate: cpuRate,
    fcpMs: fcps.map((value) => Number(value.toFixed(1))),
    ttiMs: ttis.map((value) => Number(value.toFixed(1))),
    medianFcpMs: Number(median(fcps).toFixed(1)),
    medianTtiMs: Number(median(ttis).toFixed(1)),
    longestLongTaskMs: Number(longest.toFixed(1)),
  }, null, 2));
} finally {
  chrome.kill();
  // Chrome schreibt sein Profil noch, während es beendet: erst warten, dann löschen.
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.warn(`[startup] Profil blieb liegen: ${profile}`);
  }
}
