// SPDX-License-Identifier: AGPL-3.0-only
// Real two-finger input on the owner's connected Pad 7. Local evidence only.
// Forward its existing WebView debugger to port 9487 before running this file.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const { WebSocket } = createRequire(new URL('../../app/package.json', import.meta.url))('ws');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cdpPort = Number(process.env.HAUSER_ZOOM_CDP_PORT || 9487);
const evidence = { surface: cdpPort === 9487 ? 'Pad 7' : 'Chromium', checks: [], screenshots: {} };
async function capture(page, name) {
  if (cdpPort === 9487) return JSON.parse(execFileSync('/home/user/.local/bin/androidctl', ['screenshot', '--settle', '0.1'], { encoding: 'utf8' })).path;
  const path = new URL(`../../output/room-zoom-fixes-2026-11-19/${name}-browser.png`, import.meta.url);
  const shot = await page.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
  return path.pathname;
}
const passed = name => { evidence.checks.push(name); console.log('PASS ' + name); };
class Page {
  constructor(ws) {
    this.ws = ws; this.next = 0; this.pending = new Map(); this.commands = 0; this.services = []; this.phase = 'initializing';
    ws.on('message', bytes => {
      const message = JSON.parse(bytes);
      if (message.id) this.pending.get(message.id)?.(message);
      if (message.method === 'Network.webSocketFrameSent') {
        try {
          const sent = JSON.parse(message.params.response.payloadData);
          if (sent.type === 'call_service') {
            this.commands++;
            this.services.push({ phase: this.phase, domain: sent.domain, service: sent.service });
          }
        } catch {}
      }
    });
  }
  static async open() {
    const pages = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const target = pages.find(page => page.type === 'page' && !page.url.includes('.invalid'));
    assert(target, 'Missing household WebView');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const page = new Page(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    await page.call('Network.enable');
    if (cdpPort !== 9487) {
      await page.call('Emulation.setDeviceMetricsOverride', { width: 1164, height: 777, deviceScaleFactor: 1, mobile: true });
      await page.call('Emulation.setTouchEmulationEnabled', { enabled: true });
      await page.call('Network.setBypassServiceWorker', { bypass: true });
      await page.call('Network.setCacheDisabled', { cacheDisabled: true });
      await page.eval("localStorage.setItem('hmi:ui-mode','panel')");
    }
    return page;
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
      this.pending.set(id, message => {
        clearTimeout(timer); this.pending.delete(id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, result.exceptionDetails?.text);
    return result.result.value;
  }
  async until(expression) {
    for (let i = 0; i < 160; i++) { const value = await this.eval(expression); if (value) return value; await delay(100); }
    throw new Error('UI timeout: ' + expression);
  }
  async click(selector) {
    const point = await this.eval(`(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
    assert(point, 'Missing ' + selector);
    await this.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await this.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async view() { return this.eval('document.querySelector(".home-stage")?.dataset.homeView'); }
  async settled(view) {
    await this.until(`document.querySelector('.home-stage')?.dataset.homeView===${JSON.stringify(view)}&&!document.querySelector('.is-view-changing')`);
    await delay(450); // Let the trailing-click gate expire before a new gesture.
  }
  async mode(view) {
    this.phase = 'mode:' + view;
    for (let i = 0; i < 3 && await this.view() !== view; i++) {
      await this.click('.status-group-end > .standby-btn');
      await this.until('!document.querySelector(".is-view-changing")');
      await delay(500);
    }
    await this.settled(view);
  }
  async pinch({ card, scale, capture, cancel = false }) {
    this.phase = 'pinch:' + (card || 'background') + ':' + scale;
    const into = !!card;
    const point = await this.eval(`(()=>{
      const card=${card ? `document.querySelector('[data-room-id="${card}"]')` : 'null'};
      if(card){const r=card.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,d:Math.min(90,r.width/3,r.height/2)}}
      const s=document.querySelector('.home-stage').getBoundingClientRect();
      const ignore='.home-panels,.camera-popout-layer,.hero-device-target,.hero-device-hit-layer,.image-edge-pull,[role="dialog"]';
      for(let y=.35;y<.8;y+=.1)for(let x=.65;x<.85;x+=.05){
        const cx=s.x+s.width*x,cy=s.y+s.height*y,d=180;
        if([-1,1].every(k=>!document.elementFromPoint(cx+k*d/2,cy)?.closest(ignore)))return {x:cx,y:cy,d};
      } return null;
    })()`);
    assert(point, 'No free pinch surface');
    const points = factor => [
      { x: point.x - point.d * factor / 2, y: point.y, id: 11, radiusX: 6, radiusY: 6 },
      { x: point.x + point.d * factor / 2, y: point.y, id: 12, radiusX: 6, radiusY: 6 },
    ];
    await this.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(1) });
    for (let i = 1; i <= 10; i++) {
      await this.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(1 + (scale - 1) * i / 10) });
      await delay(16);
    }
    if (capture) {
      // Hold the pinch beyond the long-press deadline, then verify it stayed a zoom.
      await delay(600);
      evidence.screenshots[capture] = await captureImage(this, capture);
      assert.equal(await this.eval(`document.querySelector(${into ? "'[data-room-zoom-preview]'" : "'.room-hero'"}).style.transform.startsWith('scale(')`), true);
      if (into) {
        const bounds = await this.eval(`(()=>{const p=document.querySelector('[data-room-zoom-preview]'),g=document.querySelector('.home-room-grid'),r=p.getBoundingClientRect(),s=g.getBoundingClientRect();return {outside:!p.closest('.home-room-grid'),top:r.top,gridTop:s.top,bottom:r.bottom,gridBottom:s.bottom}})()`);
        assert(bounds.outside, 'The enlarged picture must be outside the scroll clip');
        if (capture === 'above-top-bar') assert(bounds.top < bounds.gridTop, 'The enlarged picture must extend above the grid');
        if (capture === 'zoom-in-held') assert(bounds.bottom > bounds.gridBottom, 'The enlarged picture must extend below the grid');
      }
    }
    await this.call('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  }
}
let page;
const captureImage = capture;
let originalUrl;
try {
  page = await Page.open();
  originalUrl = await page.eval('location.href');
  const rainy = new URL(originalUrl); rainy.searchParams.set('weather', 'rainy');
  await page.call('Page.navigate', { url: rainy.href });
  await page.until('document.querySelector(".home-stage")?.dataset.homeView');
  if (await page.eval('!!document.querySelector(".ambient-layer")')) await page.click('.ambient-layer');
  await page.mode('fullscreen');
  assert.equal(await page.eval("'startViewTransition' in document"), true);
  await page.pinch({ scale: .65, capture: 'zoom-out-held' });
  await page.settled('rooms');
  passed('Full-screen pinch shrinks into the room grid without a long press');
  await page.until('!!document.querySelector(".home-room-grid .phone-room-hero-layer.is-front [data-weather-room]")');
  passed('The room grid shows weather inside the decoded room images');
  await page.eval('document.querySelector(".home-room-grid").scrollTop=0');
  const topRoom = await page.eval('document.querySelector(".phone-room-card").dataset.roomId');
  await page.pinch({ card: topRoom, scale: 1.5, capture: 'above-top-bar' });
  // The preview must be a stage sibling of the scroller, even before release.
  await page.settled('fullscreen');
  passed('The enlarged tile can grow behind the top bar without the grid clipping it');
  await page.mode('rooms');
  const visibleRooms = await page.eval(`Array.from(document.querySelectorAll('.phone-room-card')).filter(e=>{const r=e.getBoundingClientRect();return r.top>70&&r.bottom<innerHeight-65}).map(e=>e.dataset.roomId)`);
  assert(visibleRooms.length >= 2, 'Need two visible rooms');
  const target = visibleRooms[1];
  await page.pinch({ card: target, scale: 1.5, capture: 'zoom-in-held' });
  await page.settled('fullscreen');
  assert.equal(await page.eval('JSON.parse(localStorage.getItem("hmi:home-layout:v1")).slots[0].roomId'), target);
  passed('Spreading a different tile opens that room in the remembered full-screen view');

  await page.pinch({ scale: .94 });
  await page.settled('fullscreen');
  await page.pinch({ scale: 1.35 });
  await page.settled('fullscreen');
  await page.pinch({ scale: .6, cancel: true });
  await page.settled('fullscreen');
  passed('Short, opposite-direction and cancelled gestures return to the starting view');

  await page.mode('image');
  await page.pinch({ scale: .6 });
  await page.settled('rooms');
  await page.pinch({ card: visibleRooms[0], scale: 1.5 });
  await page.settled('image');
  passed('Image control also zooms out and is restored when opening another room');

  await page.mode('fullscreen');
  await page.mode('rooms');
  await page.pinch({ card: target, scale: 1.5 });
  await page.settled('fullscreen');
  passed('Changing the mode with the existing button updates the remembered destination');

  const roomButtons = await page.eval(`Array.from(document.querySelectorAll('.room-page:not([inert]) .room-btn')).filter(e=>e.getBoundingClientRect().width>0).length`);
  if (roomButtons > 1) {
    page.phase = 'normal-room-change';
    await page.eval(`window.__weatherSamples=[];window.__weatherTimer=setInterval(()=>window.__weatherSamples.push([...document.querySelectorAll('.room-hero > .hero-layer[data-image-room]')].map(e=>({image:e.dataset.imageRoom,weather:[...e.querySelectorAll('[data-weather-room]')].map(w=>w.dataset.weatherRoom),opacity:Number(getComputedStyle(e).opacity)}))),20)`);
    await page.click('.room-page:not([inert]) .room-btn:nth-child(2)');
    await delay(500);
    evidence.screenshots['room-weather-fade'] = await capture(page, 'room-weather-fade');
    await delay(1000);
    const samples = await page.eval('clearInterval(window.__weatherTimer);window.__weatherSamples');
    assert(samples.length > 10);
    assert(samples.every(sample => sample.every(layer => layer.weather.every(room => room === layer.image))));
    assert(samples.some(sample => sample.some(layer => layer.opacity > 0 && layer.opacity < 1)));
    passed('During a room crossfade the weather stays in the same image opacity layer');
  } else throw new Error('Missing room selector for weather crossfade check');

  await page.mode('rooms');
  const last = await page.eval(`(()=>{const cards=document.querySelectorAll('.phone-room-card');const card=cards[cards.length-1];card.scrollIntoView({block:'center',behavior:'instant'});return card.dataset.roomId})()`);
  await delay(300);
  await page.pinch({ card: last, scale: 1.5 });
  await page.settled('fullscreen');
  await page.pinch({ scale: .6 });
  await page.settled('rooms');
  assert.equal(await page.eval(`(()=>{const r=document.querySelector('[data-room-id="${last}"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`), true);
  passed('Zooming out reveals the matching tile even after scrolling to a later room');
  evidence.services = page.services;
  assert.equal(page.commands, 0, 'Zooming must never send a device command: ' + JSON.stringify(page.services));
  passed('No Home Assistant service calls were sent by any of the zoom gestures');
  await page.pinch({ card: last, scale: 1.5 });
  await page.settled('fullscreen');
  await page.call('Page.navigate', { url: originalUrl });
  await page.until('document.querySelector(".home-stage")?.dataset.homeView');
  await page.mode('fullscreen');
  evidence.screenshots.ready = await capture(page, 'ready');
  evidence.result = 'passed';
} catch (error) {
  evidence.result = 'failed'; evidence.error = error.stack; process.exitCode = 1;
} finally {
  page?.ws.close();
  writeFileSync(new URL(cdpPort === 9487 ? '../build/tablet-prototype/room-zoom-weather-check.json' : '../../output/room-zoom-fixes-2026-11-19/browser-check.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
