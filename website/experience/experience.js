// SPDX-License-Identifier: AGPL-3.0-only
import { tourSteps, loadingCopy } from './tour.js';
import { copy } from './copy.js';

const $ = id => document.getElementById(id);
const frame = $('home');
const sheet = $('sheet');
const mobileViewport = matchMedia('(max-width: 767px)');
let device = mobileViewport.matches ? 'mobile' : 'desktop';
let frameScale = 1;
document.body.dataset.device = device;
const requestedLocale = new URLSearchParams(location.search).get('lang');
let locale = ['de', 'en'].includes(requestedLocale) ? requestedLocale : document.documentElement.lang === 'de' ? 'de' : 'en';
let mode = 'welcome';
let current = 0;
let step = 0;
let loadState = { phase: 0, done: 0, total: 0 };
let slowTimer;
let ready = false;
let collapsed = false;
let target = null;
let appearance = 'evening';
let openSheet = null;
const visited = new Set();
const interacted = new Set();
const t = () => copy[locale];
const mobileLight = {
  en: {title:'Your room.<br>Within reach.', text:'Tap Floor lamp or choose a scene. Your room, its lights and the controls you need — together on your phone.', detail:'Room controls, made for a phone ↗', heading:'Made for your hand.', more:'Open a room to bring its lights, scenes and climate controls together. Tap a light to switch it and hold it for the available controls. The phone web app uses room sheets that fit your screen.', response:'One tap. Your room responds.'},
  de: {title:'Dein Raum.<br>Alles dabei.', text:'Tippe auf „Stehlampe“ oder wähle eine Szene. Dein Raum, seine Lichter und die passenden Regler — zusammen auf deinem Smartphone.', detail:'Raumsteuerung fürs Smartphone ↗', heading:'Für deine Hand gemacht.', more:'Öffne einen Raum: Seine Lichter, Szenen und Klimaregler gehören zusammen. Antippen schaltet ein Licht, Gedrückthalten öffnet die verfügbaren Regler. Die mobile Web-App zeigt Raumblätter, die zu deinem Bildschirm passen.', response:'Eine Berührung. Dein Raum reagiert.'},
};
function moments() {
  return copy[locale].moments.filter(m => device !== 'mobile' || m.id !== 'quiet')
    .map(m => device === 'mobile' && m.id === 'light' ? {...m,...mobileLight[locale]} : m);
}
const chapter = () => moments()[current];
const steps = () => tourSteps(chapter().id, locale);
const stop = () => steps()[step];
const moment = () => ({...chapter(), ...stop()});
const interactionKey = () => `${chapter().id}:${stop().key}`;

function renderLoading() {
  const c = loadingCopy[locale];
  $('loading-title').textContent = c.title;
  $('loading-progress').value = loadState.phase;
  $('loading-phase').textContent = loadState.total ? c.images(loadState.done, loadState.total) : c.phases[Math.floor(loadState.phase)];
  $('loading-slow-text').textContent = c.slow;
  $('reload-demo').textContent = c.retry;
}
function updateLoading(data) {
  if (data.phase < loadState.phase) return;
  loadState = { phase: data.phase, done: data.done ?? 0, total: data.total ?? 0 };
  renderLoading();
}

function fitDemo() {
  const stage = $('stage');
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (!width || !height) return;
  const panelWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--story-panel-width'));
  const logicalWidth = device === 'desktop' ? Math.max(width, panelWidth) : width;
  frameScale = width / logicalWidth;
  frame.style.width = `${logicalWidth}px`;
  frame.style.height = `${height / frameScale}px`;
  frame.style.transformOrigin = 'top left';
  frame.style.transform = `scale(${frameScale})`;
  placeHint();
}

function loadDemo() {
  ready = false;
  target = null;
  document.body.dataset.loading = 'true';
  (mode === 'welcome' ? $('loading-slot') : $('stage')).append($('loading'));
  $('loading').hidden = false;
  $('loading-slow').hidden = true;
  loadState = { phase: 0, done: 0, total: 0 };
  renderLoading();
  clearTimeout(slowTimer);
  slowTimer = setTimeout(() => { if (!ready) $('loading-slow').hidden = false; }, 25000);
  $('enter').disabled = true;
  $('skip').disabled = true;
  const url = new URL(frame.dataset.demoSrc, location.href);
  url.searchParams.set('device',device);
  frame.src = url.href;
  fitDemo();
}
function send(type, data = {}) { frame.contentWindow?.postMessage({source:'hauser-story', type, ...data}, location.origin); }

function localize() {
  document.documentElement.lang = locale;
  document.title = locale === 'de' ? 'Hauser — Komm herein.' : 'Hauser — Come on in.';
  document.querySelector('meta[name=description]').content = copy[locale].description;
  document.querySelectorAll('[data-copy]').forEach(el => { el.innerHTML = t()[el.dataset.copy] ?? ''; });
  (device === 'mobile' ? document.querySelector('.story-footer') : $('guide')).append($('journey-controls'));
  $('language').textContent = locale === 'en' ? 'DE' : 'EN';
  $('language').setAttribute('aria-label', locale === 'en' ? 'Auf Deutsch ansehen' : 'View in English');
  $('previous').setAttribute('aria-label', t().previous);
  $('close-sheet').setAttribute('aria-label', t().close);
  $('brand').setAttribute('aria-label', locale === 'en' ? 'Hauser — back to the beginning' : 'Hauser — zurück zum Anfang');
  $('home').title = locale === 'en' ? 'Hauser — interactive demo with simulated devices' : 'Hauser — interaktive Demo mit simulierten Geräten';
  $('chapters').innerHTML = moments().map((m,i) => `<button class="chapter" data-moment="${i}" aria-label="${m.kicker}: ${m.name}" title="${m.name}"><span class="chapter-number">0${i+1}</span><span class="chapter-label">${m.name}</span></button>`).join('');
  renderLoading();
  renderMoment();
  if (ready) send('locale', {locale});
}

function renderMoment() {
  const m = moment();
  document.body.dataset.chapter = m.id;
  document.body.dataset.step = stop().key;
  $('chapter-kicker').textContent = m.kicker;
  $('chapter-title').innerHTML = m.title;
  $('chapter-text').textContent = m.text;
  $('detail').textContent = m.detail;
  $('response').textContent = m.response;
  $('response').hidden = !interacted.has(interactionKey());
  $('tour-progress').hidden = steps().length === 1;
  $('tour-progress').textContent = `${loadingCopy[locale].step} ${step + 1} / ${steps().length} · ${stop().label}`;
  $('chapter-action').innerHTML = m.id === 'light' && step === 0 ? `<button class="pill" data-appearance="day" aria-pressed="${appearance === 'day'}">${t().day}</button><button class="pill" data-appearance="evening" aria-pressed="${appearance === 'evening'}">${t().evening}</button>` : '';
  $('previous').disabled = current === 0 && step === 0;
  $('next').firstElementChild.textContent = m.next ?? (current === moments().length - 1 ? t().finish : t().next);
  $('mode').lastElementChild.textContent = mode === 'explore' ? t().storyMode : t().exploreMode;
  $('collapse').setAttribute('aria-label', collapsed ? t().maximize : t().minimize);
  document.querySelectorAll('[data-moment]').forEach((el,i) => {
    if (i === current && mode === 'story') el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current');
    el.classList.toggle('is-visited',visited.has(i));
  });
  placeHint();
}

function setMode(next) {
  mode = next;
  document.body.dataset.mode = mode;
  $('welcome').hidden = mode !== 'welcome';
  document.querySelector('.welcome-footer').hidden = mode !== 'welcome';
  document.querySelector('.story-footer').hidden = mode === 'welcome';
  $('guide').hidden = mode !== 'story';
  $('explore-label').hidden = mode !== 'explore';
  frame.tabIndex = mode === 'welcome' ? -1 : 0;
  frame.inert = mode === 'welcome';
  send('mode', {mode: mode === 'explore' ? 'explore' : 'guided'});
  renderMoment();
  fitDemo();
}

function go(index, focus = true, atStep = 0) {
  current = Math.max(0,Math.min(moments().length-1,index));
  step = Math.min(atStep, steps().length - 1);
  visited.add(current);
  collapsed = false;
  document.body.classList.remove('guide-collapsed');
  $('guide').classList.remove('is-collapsed');
  $('collapse').textContent = '−';
  setMode('story');
  send('moment', {moment: moment().id, step: stop().key});
  if (focus) $('chapter-title').focus({preventScroll:true});
}

function goStep(index, present = true) {
  step = Math.max(0, Math.min(steps().length - 1, index));
  renderMoment();
  fitDemo();
  if (present) send('moment', {moment: moment().id, step: stop().key});
}
function placeHint() {
  const hint = $('lamp-hint');
  const r = frame.getBoundingClientRect();
  hint.hidden = !(ready && mode === 'story' && current === 0 && step === 0 && target && !interacted.has(interactionKey()) && device === 'desktop');
  if (target) { hint.style.left = `${r.left + target.x * frameScale}px`; hint.style.top = `${r.top + target.y * frameScale}px`; }
}

const photoPair = () => `<div class="photo-pair"><figure><img src="/media/wizard-input-raw-700.webp" alt="${t().photo}" width="700" height="525"><figcaption>${t().photo}</figcaption></figure><figure><img src="/media/room-light-700.webp" alt="${t().illustration}" width="700" height="495"><figcaption>${t().illustration}</figcaption></figure></div>`;
function showSheet(kind) {
  openSheet = kind;
  const c = t();
  let html = '';
  if (kind === 'about') html = `<p class="eyebrow">${c.aboutKicker}</p><h2 id="sheet-title">${c.aboutTitle}</h2><p>${c.aboutText}</p>${photoPair()}<p>${c.aboutSecond}</p><p>${c.aboutThird}</p><div class="sheet-links"><a href="https://github.com/ralleur/hauser" target="_blank" rel="noopener">${c.source}</a><a href="https://hauserhome.app/docs/" target="_blank" rel="noopener">${c.docs}</a></div><div class="sheet-section"><p class="smallprint">${c.credits}</p></div>`;
  if (kind === 'detail') {
    const m = moment();
    html = `<p class="eyebrow">${m.kicker}</p><h2 id="sheet-title">${m.heading}</h2><p>${m.more}</p>${m.id === 'rooms' ? photoPair() : ''}<div class="sheet-section"><p class="smallprint">${m.note}</p><a href="https://hauserhome.app/docs/${m.url}" target="_blank" rel="noopener">${m.link} ↗</a></div>`;
  }
  if (kind === 'get') html = `<p class="eyebrow">${c.getKicker}</p><h2 id="sheet-title">${c.getTitle}</h2><p>${c.getText}</p><section class="sheet-section"><p class="sub">${c.appleSub}</p><h3>${c.apple}</h3><p>${c.appleText}</p><a class="primary" href="https://testflight.apple.com/join/WPcA1eE1" target="_blank" rel="noopener">${c.appleCta}</a></section><section class="sheet-section"><p class="sub">${c.haSub}</p><h3>${c.ha}</h3><p>${c.haText}</p><a class="primary" href="https://hauserhome.app/docs/getting-started/home-assistant-app/" target="_blank" rel="noopener">${c.haCta}</a><div class="sheet-links"><a href="https://hauserhome.app/docs/getting-started/docker-compose/" target="_blank" rel="noopener">${c.docker}</a></div></section><p class="smallprint">${c.beta}</p><div class="sheet-links"><a href="https://github.com/ralleur/hauser" target="_blank" rel="noopener">${c.source}</a><button class="detail-link" id="keep-exploring">${c.back} →</button></div>`;
  $('sheet-body').innerHTML = html;
  if (!sheet.open) sheet.showModal();
  $('close-sheet').focus();
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.source !== 'hauser-demo') return;
  const data = event.data;
  if (data.type === 'loading') updateLoading(data);
  if (data.type === 'ready') {
    updateLoading({phase: 5});
    document.body.dataset.loading = 'false';
    clearTimeout(slowTimer);
    ready = true;
    $('loading').hidden = true;
    $('enter').disabled = false; $('skip').disabled = false;
    send('locale',{locale});
    send('mode',{mode:mode === 'explore' ? 'explore' : 'guided'});
    send('moment',{moment:moment().id, step:stop().key});
    send('appearance',{appearance});
  }
  if (data.type === 'target') { target = data.rect; placeHint(); }
  if (data.type === 'interaction' && data.chapter === moment().id && mode === 'story') {
    if (data.action === 'detail-open' && moment().id === 'light' && step === 0) goStep(1);
    if (data.step === stop().key || data.action === 'detail-open') { interacted.add(interactionKey()); renderMoment(); }
  }
});
$('enter').addEventListener('click',()=>go(0));
$('welcome-guide').addEventListener('click',()=>{if(ready) go(0);});
$('skip').addEventListener('click',()=>setMode('explore'));
$('brand').addEventListener('click',()=>{setMode('welcome');send('moment',{moment:'light'});$('enter').focus();});
$('get').addEventListener('click',()=>showSheet('get'));
$('about').addEventListener('click',()=>showSheet('about'));
$('detail').addEventListener('click',()=>showSheet('detail'));
$('close-sheet').addEventListener('click',()=>sheet.close());
sheet.addEventListener('click',event=>{if(event.target === sheet) {const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) sheet.close();}if(event.target.closest('#keep-exploring')){sheet.close();setMode('explore');}});
sheet.addEventListener('close',()=>{openSheet=null;});
$('next').addEventListener('click',()=>{if(step < steps().length - 1)goStep(step+1);else if(current === moments().length-1)showSheet('get');else go(current+1);});
$('previous').addEventListener('click',()=>{if(step > 0)goStep(step-1);else go(current-1,true,tourSteps(moments()[current-1].id,locale).length-1);});
$('chapters').addEventListener('click',event=>{const button=event.target.closest('[data-moment]');if(button)go(Number(button.dataset.moment));});
$('mode').addEventListener('click',()=>{if(mode === 'explore')go(current,true,step);else setMode('explore');});
$('collapse').addEventListener('click',()=>{collapsed=!collapsed;document.body.classList.toggle('guide-collapsed',collapsed);$('guide').classList.toggle('is-collapsed',collapsed);$('collapse').textContent=collapsed?'+':'−';renderMoment();});
$('chapter-action').addEventListener('click',event=>{const button=event.target.closest('[data-appearance]');if(button){appearance=button.dataset.appearance;send('appearance',{appearance});renderMoment();}});
$('language').addEventListener('click',()=>{
  locale=locale === 'en'?'de':'en';
  const url=new URL(location.href);
  url.searchParams.set('lang',locale);
  if (/^\/(?:de\/)?(?:index\.html)?$/.test(url.pathname)) url.pathname=locale === 'de'?'/de/':'/';
  try { localStorage.setItem('hauser-website-language',locale); } catch { /* Explicit URLs work without storage. */ }
  history.replaceState(null,'',url);
  const canonical=document.querySelector('link[rel=canonical]');
  if(canonical) canonical.href=`https://hauserhome.app/${locale === 'de'?'de/':''}`;
  localize();if(openSheet)showSheet(openSheet);
});
mobileViewport.addEventListener('change',() => {
  const previousId = moment().id;
  device = mobileViewport.matches ? 'mobile' : 'desktop';
  document.body.dataset.device = device;
  current = Math.max(0,moments().findIndex(m => m.id === previousId));
  if (previousId === 'quiet' && device === 'mobile') current = moments().length - 1;
  step = Math.min(step, steps().length - 1);
  ready = false;
  localize();
  loadDemo();
});
new ResizeObserver(fitDemo).observe($('stage'));
new ResizeObserver(entries => {
  if (mode === 'story') document.documentElement.style.setProperty('--story-guide-reserve', `${entries[0].target.getBoundingClientRect().height + 16}px`);
}).observe($('guide'));
localize();
loadDemo();
$('reload-demo').addEventListener('click',loadDemo);
if (['#install','#setup','#beta','#app'].includes(location.hash)) showSheet('get');
