// SPDX-License-Identifier: AGPL-3.0-only
import { scenes, narrative, loadingCopy } from './tour.js?v=float-2';
import { copy } from './copy.js?v=float-2';
const $ = id => document.getElementById(id);
const frame = $('home'), sheet = $('sheet');
const mobileViewport = matchMedia('(max-width: 767px)');
let device = mobileViewport.matches ? 'mobile' : 'desktop';
const requestedLocale = new URLSearchParams(location.search).get('lang');
let locale = ['de','en'].includes(requestedLocale) ? requestedLocale : document.documentElement.lang === 'de' ? 'de' : 'en';
let mode = 'welcome', current = 0, ready = false, playing = false, cueReady = false, ended = false;
let elapsed = 0, previousTime = 0, request = 0, sceneTimer, slowTimer, openSheet = null, failed = false;
let loadState = {phase:0,done:0,total:0};
const chapters = [...new Set(scenes.map(scene => scene.chapter))];
const t = () => copy[locale];
const n = () => narrative[locale];
const scene = () => scenes[current];
const send = (type,data={}) => frame.contentWindow?.postMessage({source:'hauser-story',type,...data},location.origin);
function renderLoading() {
  const c = loadingCopy[locale];
  $('loading-title').textContent=c.title;
  $('loading-progress').value=loadState.phase;
  $('loading-phase').textContent=loadState.total?c.images(loadState.done,loadState.total):c.phases[Math.floor(loadState.phase)];
  $('loading-slow-text').textContent=c.slow; $('reload-demo').textContent=c.retry;
}
function fitDemo() {
  const stage=$('stage'), header=document.querySelector('.site-header'), footer=document.querySelector('.experience-footer');
  const style=getComputedStyle(document.documentElement), gap=parseFloat(style.getPropertyValue('--space-4'));
  const gutter=parseFloat(getComputedStyle(header).paddingLeft), panel=device==='desktop'||(mode==='story'&&scene().panel);
  const rail=device==='desktop' ? footer.getBoundingClientRect().width+gap : 0;
  let width=innerWidth, height=innerHeight, left=0, top=0;
  if(mode!=='welcome') {
    top=header.getBoundingClientRect().bottom+gap;
    const availableWidth=innerWidth-gutter*2-rail;
    const availableHeight=innerHeight-top-gap-(device==='mobile'?footer.getBoundingClientRect().height+gap:0);
    if(panel) {
      const maximum=parseFloat(style.getPropertyValue('--story-panel-aspect'));
      const minimum=parseFloat(style.getPropertyValue('--story-panel-min-aspect'));
      const aspect=device==='mobile'?maximum:Math.min(maximum,Math.max(minimum,availableWidth/availableHeight));
      width=Math.min(availableWidth,availableHeight*aspect); height=width/aspect;
      left=gutter+rail+(availableWidth-width)/2; top+=(availableHeight-height)/2;
    } else {
      // The phone keeps its portrait shell; its caption uses the free space above it.
      Object.assign($('guide').style,{width:`${innerWidth-gutter*2}px`,left:`${gutter}px`,top:`${top}px`});
      delete $('guide').dataset.place;
      const captionHeight=mode==='story'&&!$('guide').hidden?$('guide').offsetHeight:0;
      top+=captionHeight+(captionHeight?gap:0);
      left=gap/2; width=innerWidth-gap; height=Math.max(gap,innerHeight-top-footer.getBoundingClientRect().height-gap*2);
    }
  }
  Object.assign(stage.style,{inset:'auto',left:`${left}px`,top:`${top}px`,width:`${width}px`,height:`${height}px`,transform:'none'});
  const logicalWidth=panel?Math.max(width,parseFloat(style.getPropertyValue('--story-panel-width'))):width;
  const scale=width/logicalWidth;
  Object.assign(frame.style,{width:`${logicalWidth}px`,height:`${height/scale}px`,transformOrigin:'top left',transform:`scale(${scale})`});
  if(panel)placeCaption();
  const label=$('panel-label');Object.assign(label.style,{top:`${Math.max(header.offsetHeight,top-gap*1.5)}px`,right:`${innerWidth-left-width}px`});
}
function placeCaption() {
  if(mode!=='story'||$('guide').hidden||document.body.dataset.takeover==='true')return;
  const guide=$('guide'), stage=$('stage').getBoundingClientRect(), frameBox=frame.getBoundingClientRect();
  const style=getComputedStyle(document.documentElement), gap=parseFloat(style.getPropertyValue('--space-4'));
  const scale=frameBox.width/parseFloat(frame.style.width);
  const occupied=[];
  const add=(r,pad=gap)=>{if(r.width>0&&r.height>0)occupied.push({left:frameBox.left+r.left*scale-pad,top:frameBox.top+r.top*scale-pad,right:frameBox.left+r.right*scale+pad,bottom:frameBox.top+r.bottom*scale+pad});};
  const doc=frame.contentDocument;
  if(doc) {
    const ambient=doc.querySelector('.ambient.is-on');
    const selectors=ambient
      ? 'button, .ambient-content, .commute-card, .commute-view-control, .ambient-shopping, .ambient-postits, .ambient-week, .commute-map-credit, .commute-pin, .commute-incident'
      : 'button:not(.room-sheet-image-area), .climate-dock, .tab-nav, .security-bar, .home-panels:not(.is-hidden), .energy-mark, .energy-story, .energy-daycurve, .notes-panel, .phone-bottom-nav';
    for(const el of (ambient??doc).querySelectorAll(selectors)) {
      if(el.checkVisibility?.({checkOpacity:true,checkVisibilityCSS:true})!==false)add(el.getBoundingClientRect());
    }
    // Protect the route itself, rather than blocking its entire rectangular map.
    for(const path of doc.querySelectorAll('.ambient.is-on .commute-route-line')) {
      const matrix=path.getScreenCTM(), length=path.getTotalLength();
      if(!matrix)continue;
      for(let i=0;i<=24;i++) {
        const point=path.getPointAtLength(length*i/24).matrixTransform(matrix);
        add({left:point.x,top:point.y,right:point.x,bottom:point.y,width:1,height:1},gap*1.5);
      }
    }
  }
  const overlaps=box=>occupied.some(r=>box.left<r.right&&box.right>r.left&&box.top<r.bottom&&box.bottom>r.top);
  delete guide.dataset.place;
  const maxWidth=Math.min(parseFloat(style.getPropertyValue('--story-guide')),stage.width-gap*2);
  guide.style.width=`${maxWidth}px`;
  const height=guide.offsetHeight;
  const positions=[ [1,0], [0,0], [1,.5], [0,.5], [1,1], [0,1], [.5,0], [.5,1], [.5,.5] ];
  let chosen;
  for(const [x,y] of positions) {
    const left=stage.left+gap+(stage.width-maxWidth-gap*2)*x, top=stage.top+gap+(stage.height-height-gap*2)*y;
    const box={left,top,right:left+maxWidth,bottom:top+height};
    if(!overlaps(box)){chosen=box;break;}
  }
  if(!chosen) {
    // Dense screens (lists, standby) leave a genuinely free column beside the app.
    const footer=document.querySelector('.experience-footer').getBoundingClientRect(), header=document.querySelector('.site-header').getBoundingClientRect();
    if(device==='desktop') {
      guide.dataset.place='rail';guide.style.width=`${footer.width}px`;
      chosen={left:footer.left,top:header.bottom+gap};
    } else {
      chosen={left:stage.left,top:Math.max(header.bottom+gap,stage.top-guide.offsetHeight-gap)};
    }
  }
  Object.assign(guide.style,{left:`${chosen.left}px`,top:`${chosen.top}px`});
}
function renderControls() {
  $('play').textContent=ended?n().replay:playing?n().pause:n().resume;
  $('play').setAttribute('aria-label',n().playLabel);
  $('play').setAttribute('aria-pressed',String(playing));
  $('chapters').value=scene().chapter;
  $('chapters').setAttribute('aria-label',n().chapters);
  $('chapter-number').textContent=String(chapters.indexOf(scene().chapter)+1).padStart(2,'0');
  $('mode').textContent=mode==='explore'?n().resume:n().explore;
  $('finish-explore').textContent=n().explore;
  $('panel-label').textContent=n().panel;
  $('panel-label').hidden=!(mode==='story'&&device==='mobile'&&scene().panel);
  $('playback-status').textContent=mode==='explore'?'':failed?n().error:!playing?n().paused:!cueReady?n().loading:'';
  $('film-progress').setAttribute('aria-label',n().progress);
  if(mode!=='welcome')fitDemo();
}
function renderCaption() {
  const [title,text]=n()[scene().chapter];
  $('chapter-title').textContent=title; $('chapter-text').textContent=text;
  $('chapter-kicker').textContent=`HAUSER · ${n().names[chapters.indexOf(scene().chapter)]}`;
  document.body.dataset.chapter=scene().chapter;
  document.body.dataset.scene=scene().id;
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const duration=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-enter'));
    $('guide').animate([{opacity:0},{opacity:1}],{duration});
  }
  $('room-photo').classList.toggle('is-visible',mode==='story'&&scene().id==='photo');
  $('finish-actions').hidden=scene().id!=='finish';
  fitDemo();
}
function localize() {
  document.documentElement.lang=locale;
  document.title=locale==='de'?'Hauser — Komm herein.':'Hauser — Come on in.';
  document.querySelector('meta[name=description]').content=t().description;
  document.querySelectorAll('[data-copy]').forEach(el=>{el.innerHTML=t()[el.dataset.copy]??'';});
  $('language').textContent=locale==='en'?'DE':'EN';
  $('language').setAttribute('aria-label',locale==='en'?'Auf Deutsch ansehen':'View in English');
  $('close-sheet').setAttribute('aria-label',t().close);
  $('brand').setAttribute('aria-label',locale==='de'?'Hauser — zurück zum Anfang':'Hauser — back to the beginning');
  $('home').title=locale==='en'?'Hauser — interactive demo with simulated devices':'Hauser — interaktive Demo mit simulierten Geräten';
  $('chapters').innerHTML=chapters.map((id,i)=>`<option value="${id}">${n().names[i]}</option>`).join('');
  renderLoading();renderCaption();renderControls();
  if(ready)send('locale',{locale});
}
function setMode(next) {
  mode=next;document.body.dataset.mode=mode;
  $('welcome').hidden=mode!=='welcome';
  document.querySelector('.welcome-footer').hidden=mode!=='welcome';
  document.querySelector('.story-footer').hidden=mode==='welcome';
  $('guide').hidden=mode!=='story';$('explore-label').hidden=mode!=='explore';
  frame.inert=mode==='welcome';frame.tabIndex=mode==='welcome'?-1:0;
  document.body.dataset.wall=String(mode==='story'&&!!scene().panel);
  if(mode!=='story')$('room-photo').classList.remove('is-visible');
  send('mode',{mode:mode==='explore'?'explore':'guided'});
  renderControls();fitDemo();
}
function pause(takeover=false) {
  playing=false;previousTime=0;
  if(takeover)document.body.dataset.takeover='true';
  if(!cueReady||takeover){request++;cueReady=false;clearTimeout(sceneTimer);send('cancel');}
  renderControls();
}
async function present() {
  const id=++request;cueReady=false;failed=false;clearTimeout(sceneTimer);
  document.body.dataset.wall=String(!!scene().panel);fitDemo();renderControls();
  if(scene().id==='photo') {
    try{await $('room-photo').decode();}catch{if(id===request){failed=true;pause();}return;}
    if(id!==request)return;
  }
  send('scene',{id:scene().id,requestId:id,device,locale});
  sceneTimer=setTimeout(()=>{if(id===request){failed=true;pause();}},25000);
}
function play(index=current) {
  if(!ready||document.hidden||sheet.open)return;
  if(index!==current||ended){current=ended?0:index;elapsed=0;cueReady=false;ended=false;}
  document.body.dataset.takeover='false';
  setMode('story');playing=true;previousTime=0;renderControls();
  if(!cueReady)void present();
}
function explore() {pause(true);setMode('explore');}
function loadDemo() {
  pause(true);ready=false;ended=false;current=0;elapsed=0;setMode('welcome');
  document.body.dataset.loading='true';$('loading-slot').append($('loading'));$('loading').hidden=false;$('loading-slow').hidden=true;
  loadState={phase:0,done:0,total:0};renderLoading();clearTimeout(slowTimer);
  slowTimer=setTimeout(()=>{if(!ready)$('loading-slow').hidden=false;},25000);
  $('enter').disabled=true;$('skip').disabled=true;
  const url=new URL(frame.dataset.demoSrc,location.href);url.searchParams.set('device',device);frame.src=url.href;
}
function advance(time) {
  if(playing&&cueReady&&mode==='story'&&!document.hidden&&!sheet.open) {
    if(previousTime)elapsed+=Math.min(time-previousTime,250);
    previousTime=time;
    $('film-progress').value=scenes.slice(0,current).reduce((sum,cue)=>sum+cue.seconds,0)+elapsed/1000;
    if(elapsed>=scene().seconds*1000) {
      if(current===scenes.length-1){ended=true;pause();$('playback-status').textContent='';}
      else{current++;elapsed=0;previousTime=0;void present();}
    }
  }else previousTime=0;
  requestAnimationFrame(advance);
}
const photoPair = () => `<div class="photo-pair"><figure><img src="/media/wizard-input-raw-700.webp" alt="${t().photo}" width="700" height="525"><figcaption>${t().photo}</figcaption></figure><figure><img src="/media/room-light-700.webp" alt="${t().illustration}" width="700" height="495"><figcaption>${t().illustration}</figcaption></figure></div>`;
function showSheet(kind) {
  pause();
  openSheet = kind;
  const c = t();
  let html = '';
  if (kind === 'about') html = `<p class="eyebrow">${c.aboutKicker}</p><h2 id="sheet-title">${c.aboutTitle}</h2><p>${c.aboutText}</p>${photoPair()}<p>${c.aboutSecond}</p><p>${c.aboutThird}</p><div class="sheet-links"><a href="https://github.com/ralleur/hauser" target="_blank" rel="noopener">${c.source}</a><a href="https://hauserhome.app/docs/" target="_blank" rel="noopener">${c.docs}</a></div><div class="sheet-section"><p class="smallprint">${c.credits}</p></div>`;
  if (kind === 'get') html = `<section class="sheet-section"><p class="sub">${c.appleSub}</p><h3>${c.apple}</h3><p>${c.appleText}</p><a class="primary" href="https://testflight.apple.com/join/WPcA1eE1" target="_blank" rel="noopener">${c.appleCta}</a></section><section class="sheet-section"><p class="sub">${c.androidSub}</p><h3>${c.android}</h3><p>${c.androidText}</p><a class="primary" href="/downloads/hauser-android-1.0.0-beta.3.apk" download>${c.androidCta}</a><div class="sheet-links"><a href="${locale === 'de' ? '/de/android/' : '/android/'}">${c.androidGuide}</a></div></section><section class="sheet-section"><p class="sub">${c.haSub}</p><h3>${c.ha}</h3><p>${c.haText}</p><a class="primary" href="https://hauserhome.app/docs/getting-started/home-assistant-app/" target="_blank" rel="noopener">${c.haCta}</a><div class="sheet-links"><a href="https://hauserhome.app/docs/getting-started/docker-compose/" target="_blank" rel="noopener">${c.docker}</a></div></section><p class="smallprint">${c.beta}</p><div class="sheet-links"><a href="https://github.com/ralleur/hauser" target="_blank" rel="noopener">${c.source}</a><button class="detail-link" id="keep-exploring">${c.back} →</button></div>`;
  sheet.removeAttribute(kind === 'get' ? 'aria-labelledby' : 'aria-label');
  sheet.setAttribute(kind === 'get' ? 'aria-label' : 'aria-labelledby', kind === 'get' ? c.get.replace(' ↗', '') : 'sheet-title');
  $('sheet-body').innerHTML = html;
  if (!sheet.open) sheet.showModal();
  $('close-sheet').focus();
}

window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.source!=='hauser-demo')return;
  const data=event.data;
  if(data.type==='loading'&&data.phase>=loadState.phase){loadState={phase:data.phase,done:data.done??0,total:data.total??0};renderLoading();}
  if(data.type==='ready') {
    ready=true;loadState={phase:5};renderLoading();document.body.dataset.loading='false';clearTimeout(slowTimer);$('loading').hidden=true;
    $('enter').disabled=false;$('skip').disabled=false;send('locale',{locale});
    // Autoplay starts only once the opening room is decoded and visible.
    if(!sheet.open&&!document.hidden)play(0);
  }
  if(data.type==='scene-ready'&&data.requestId===request&&playing) {
    clearTimeout(sceneTimer);cueReady=true;previousTime=0;renderCaption();renderControls();
  }
  if(data.type==='scene-error'&&data.requestId===request){failed=true;pause();}
  if(data.type==='interaction'&&mode==='story')pause(true);
});
$('play').addEventListener('click',()=>playing?pause():play());
$('enter').addEventListener('click',()=>play(0));$('welcome-guide').addEventListener('click',()=>play(0));
$('skip').addEventListener('click',explore);$('finish-explore').addEventListener('click',explore);
$('mode').addEventListener('click',()=>mode==='explore'?play():explore());
$('chapters').addEventListener('change',()=>{const selected=$('chapters').value;pause(true);current=scenes.findIndex(cue=>cue.chapter===selected);elapsed=0;ended=false;play();});
$('brand').addEventListener('click',()=>{pause(true);current=0;elapsed=0;ended=false;play();});
$('get').addEventListener('click',()=>showSheet('get'));$('finish-get').addEventListener('click',()=>showSheet('get'));
$('about').addEventListener('click',()=>showSheet('about'));
$('close-sheet').addEventListener('click',()=>sheet.close());
sheet.addEventListener('click',event=>{if(event.target===sheet){const r=sheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)sheet.close();}if(event.target.closest('#keep-exploring')){sheet.close();explore();}});
sheet.addEventListener('close',()=>{openSheet=null;renderControls();});
$('language').addEventListener('click',()=>{
  locale=locale==='en'?'de':'en';const url=new URL(location.href);url.searchParams.set('lang',locale);
  if(/^\/(?:de\/)?(?:index\.html)?$/.test(url.pathname))url.pathname=locale==='de'?'/de/':'/';
  try{localStorage.setItem('hauser-website-language',locale);}catch{}
  history.replaceState(null,'',url);const canonical=document.querySelector('link[rel=canonical]');if(canonical)canonical.href=`https://hauserhome.app/${locale==='de'?'de/':''}`;
  localize();if(openSheet)showSheet(openSheet);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
mobileViewport.addEventListener('change',()=>{device=mobileViewport.matches?'mobile':'desktop';document.body.dataset.device=device;loadDemo();});
window.addEventListener('resize',fitDemo);
setInterval(()=>{if(cueReady&&(device==='desktop'||scene().panel))placeCaption();},500);
$('reload-demo').addEventListener('click',loadDemo);
document.body.dataset.device=device;localize();loadDemo();requestAnimationFrame(advance);
if(['#install','#setup','#beta','#app'].includes(location.hash))showSheet('get');
