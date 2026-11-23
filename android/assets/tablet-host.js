// SPDX-License-Identifier: AGPL-3.0-only
(()=>{
  if(window.__hauserTabletHost)return;window.__hauserTabletHost=true;
  const de=document.documentElement.lang.startsWith('de'),label=(a,b)=>de?a:b;
  document.documentElement.dataset.tabletShell='hauser';
  window.hauserTabletStandby=()=>{
    window.hauserTabletNotifications?.reset();
    const detail={handled:false};window.dispatchEvent(new CustomEvent('hauser:device-standby',{detail}));
    return detail.handled;
  };
  const symbols={notifications:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',device:'<rect x="5" y="2" width="14" height="20" rx="2"/>',store:'<rect x="3" y="6" width="18" height="16" rx="2"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',apps:'<circle cx="5" cy="5" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="19" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="19" r="1"/>'};
  const svg=path=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const style=document.createElement('style');style.textContent=`
    .hauser-tablet-status{display:flex;align-items:center;gap:var(--space-2);border:0;border-radius:0;padding:var(--space-1) var(--space-2);min-height:var(--touch-min);color:var(--color-text-secondary);text-decoration:none;background:none;box-shadow:none;font:inherit;font-size:var(--text-sm);font-variant-numeric:tabular-nums;white-space:nowrap}
    .hauser-tablet-status .icon{width:var(--icon-md);height:var(--icon-md)}
    .hauser-tablet-tab{text-decoration:none;cursor:pointer;min-width:calc(var(--space-7) + var(--space-4));flex-shrink:0}
    .hauser-tablet-tab .icon{width:var(--space-5);height:var(--space-5)}
    [data-shell=panel] .tab-nav:has(.hauser-tablet-tab){max-width:calc(100vw - var(--space-6));overflow-x:auto;scrollbar-width:none}
    [data-shell=panel] .tab-nav:has(.hauser-tablet-tab) .tab{min-width:calc(var(--space-7) + var(--space-4));padding-left:var(--space-3);padding-right:var(--space-3)}
    .hauser-tablet-status:focus-visible,.hauser-tablet-tab:focus-visible{outline:2px solid var(--color-accent-warm);outline-offset:var(--space-1)}
  `;document.head.append(style);
  let activePanel='', previousTab=null;
  let gliderNode,gliderTarget,gliderAnimation,gliderDuration=0,gliderEasing='';
  function placeGlider(nav,selected){
    const glider=nav.querySelector('.tab-glider');if(!glider||!selected)return;
    if(glider!==gliderNode){
      gliderAnimation?.cancel();gliderNode=glider;gliderTarget=null;
      const style=getComputedStyle(glider),duration=style.getPropertyValue('--duration-glider').trim()||style.transitionDuration.split(',')[0];
      gliderDuration=parseFloat(duration)*(duration.endsWith('ms')?1:1000);
      gliderEasing=style.getPropertyValue('--ease-glider').trim()||style.transitionTimingFunction.match(/cubic-bezier\([^)]+\)/)?.[0]||'ease';
      glider.style.transition='none';glider.style.transformOrigin='left center';
    }
    const target={x:selected.offsetLeft,w:selected.offsetWidth};
    if(gliderTarget?.x===target.x&&gliderTarget.w===target.w)return;
    const bounds=gliderTarget?glider.getBoundingClientRect():null,origin=bounds?nav.getBoundingClientRect():null;
    gliderAnimation?.cancel();glider.style.width=target.w+'px';glider.style.transform=`translate3d(${target.x}px,0,0)`;
    if(bounds&&origin&&target.w>0&&gliderDuration>0&&!matchMedia('(prefers-reduced-motion: reduce)').matches)gliderAnimation=glider.animate([{transform:`translate3d(${bounds.left-origin.left-nav.clientLeft}px,0,0) scaleX(${bounds.width/target.w})`},{transform:`translate3d(${target.x}px,0,0) scaleX(1)`}],{duration:gliderDuration,easing:gliderEasing});
    gliderTarget=target;
  }
  let legacyNav;
  let status={battery:-1,wifi:false,charging:false};
  function mount(){
    const group=document.querySelector('[data-shell=panel] .status-group-end');
    if(group&&!document.getElementById('hauser-tablet-status')){
      const a=document.createElement('a');a.id='hauser-tablet-status';a.className='hauser-tablet-status';a.href='hauser-tablet://open/device';a.setAttribute('aria-label',label('Dieses Tablet','This tablet'));group.prepend(a);update();
    }

    const nav=document.querySelector('[data-shell=panel] .tab-nav');
    if(nav&&!nav.dataset.tabletNavigation){
      if(nav!==legacyNav){legacyNav=nav;new MutationObserver(()=>placeGlider(nav,nav.querySelector('.tab.is-active'))).observe(nav,{attributes:true,attributeFilter:['class'],subtree:true});new ResizeObserver(()=>placeGlider(nav,nav.querySelector('.tab.is-active'))).observe(nav);}
      let added=false;
      for(const [kind,name] of [['apps','Apps']])if(!nav.querySelector('[data-tablet="'+kind+'"]')){
        const a=document.createElement('a');a.className='tab pressable hauser-tablet-tab';a.dataset.tablet=kind;a.href='hauser-tablet://open/'+kind;a.innerHTML=svg(symbols[kind])+`<span class="tab-label">${name}</span>`;a.setAttribute('aria-label',name);nav.insertBefore(a,nav.querySelector('[data-nav=system]'));added=true;
      }
      const old=document.querySelector('.tab-edge-end .security-bar');
      if(old&&!old.dataset.tablet){old.dataset.tablet='notifications';old.insertAdjacentHTML('beforeend',svg(symbols.notifications));old.setAttribute('aria-label',label('Status und Mitteilungen','Status and notifications'));old.setAttribute('role','button');old.tabIndex=0;const open=event=>{event.preventDefault();event.stopImmediatePropagation();location.href='hauser-tablet://open/notifications';};old.addEventListener('click',open,true);old.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')open(event);});}
      if(added)window.dispatchEvent(new Event('resize'));
      selectLegacy(nav);
      placeGlider(nav,nav.querySelector('.tab.is-active'));
    }

  }
  function update(){
    const a=document.getElementById('hauser-tablet-status');if(!a)return;
    const battery=Number.isFinite(status.battery)&&status.battery>=0?Math.min(100,Math.round(status.battery)):null;
    const wifi=svg(status.wifi?'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>':'<path d="m3 3 18 18M2 8a16 16 0 0 1 20 0M8 16a6 6 0 0 1 8 0"/>');
    const bolt='<path d="m12 4-5 9h5l-1 7 6-10h-5z"/>';
    const fill=battery===null?'':`<rect class="battery-fill" x="4" y="8" width="${14*battery/100}" height="8" rx="1" fill="currentColor" stroke="none" mask="url(#hauser-battery-mask)"/>`;
    const batteryIcon=svg(`<defs><mask id="hauser-battery-mask"><rect width="24" height="24" fill="white" stroke="none"/>${status.charging?bolt.replace('<path','<path fill="black" stroke="black"'):''}</mask></defs><rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4"/>${fill}${status.charging?bolt:''}`);
    const text=wifi+batteryIcon+`<span>${battery===null?'—':battery+' %'}</span>`;
    a.setAttribute('aria-label',`${label('Dieses Tablet','This tablet')} · ${status.wifi?'WLAN':label('Kein WLAN','Wi-Fi disconnected')} · ${label('Akku','Battery')} ${battery===null?'—':battery+' %'}${status.charging?' · '+label('wird geladen','charging'):''}`);
    if(a.innerHTML!==text)a.innerHTML=text;
  }
  function selectLegacy(nav){
    if(!activePanel)return;
    const selected=activePanel==='apps'||activePanel==='store'?nav.querySelector('[data-tablet="apps"]'):nav.querySelector(`[data-nav="${previousTab}"]`)||nav.querySelector('[data-nav].is-active');
    if(!selected)return;
    if(activePanel)nav.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('is-active',tab===selected));
    placeGlider(nav,selected);
  }
  window.addEventListener('hauser:tablet-panel',event=>{
    const nav=document.querySelector('.tab-nav');if(!nav||nav.dataset.tabletNavigation)return;
    if(!activePanel)previousTab=nav.querySelector('[data-nav].is-active')?.dataset.nav;
    activePanel=event.detail;
    if(!activePanel){nav.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('is-active',tab.dataset.nav===previousTab));placeGlider(nav,nav.querySelector('.tab.is-active'));}
    else selectLegacy(nav);
  });
  document.addEventListener('click',event=>{const tab=event.target.closest('.tab[data-nav]');if(tab&&activePanel){previousTab=tab.dataset.nav;location.href='hauser-tablet://close';}},true);
  window.hauserTabletBadge=count=>{window.hauserTabletUnread=count;const pill=document.querySelector('[data-tablet=notifications]');if(pill){let badge=pill.querySelector('.tablet-unread');if(!badge){badge=document.createElement('span');badge.className='tablet-unread';pill.append(badge);}badge.textContent=count?String(count):'';}window.dispatchEvent(new CustomEvent('hauser:tablet-badge',{detail:count}));};
  window.addEventListener('hauser:tablet-dismiss',()=>{location.href='hauser-tablet://close';});
  document.addEventListener('hmi:ambient-change',event=>{
    if(!event.detail?.active)return;
    window.hauserTabletNotifications?.reset();
    if(document.documentElement.dataset.tabletPanel)location.href='hauser-tablet://close';
  });
  window.addEventListener('hauser:notifications',event=>{event.stopImmediatePropagation();location.href='hauser-tablet://open/notifications';},true);
  window.dispatchEvent(new Event('hauser:tablet-ready'));
  window.hauserTabletStatus=s=>{status=s;mount();update();};
  let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount();});}).observe(document.documentElement,{childList:true,subtree:true});mount();
})();
