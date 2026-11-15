// SPDX-License-Identifier: AGPL-3.0-only
// Android-only presentation of the live Hauser feed. Read != dismiss: reading
// never acknowledges a household alarm or removes a Home Assistant notification.
(() => {
  if (window.hauserTabletNotifications) return;
  const local = typeof Tablet !== 'undefined';
  const de = document.documentElement.lang.startsWith('de');
  const t = (a, b) => de ? a : b;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = path => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const bell = svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>');
  const closeIcon = svg('<path d="m6 6 12 12M6 18 18 6"/>');
  const filterIcon = svg('<path d="M3 6h18M6 12h12M10 18h4"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/>');
  const storageKey = 'hauser:tablet-notifications:read:v1';
  let read = {};
  try { read = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
  let connected = local;
  let items = [], group = 'all', unreadOnly = false, expanded = null, banner = null, bannerTimer, previousFocus;
  const previewed = new Set();
  const fingerprint = item => `${item.id}:${item.createdAt}`;
  const unread = item => read[item.id] !== fingerprint(item);
  function save() {
    // Bound per-device reading history without persisting notification contents.
    read = Object.fromEntries(Object.entries(read).slice(-200));
    try { localStorage.setItem(storageKey, JSON.stringify(read)); } catch {}
  }
  function markRead(item) { read[item.id] = fingerprint(item); save(); if (local && item.source !== 'android-app') Tablet.command('notificationRead', JSON.stringify({id:item.id,read:true})); }
  function timestamp(item) {
    if (Date.now() - item.createdAt < 60_000) return t('Jetzt', 'Now');
    const date = new Date(item.createdAt);
    return date.toLocaleDateString() === new Date().toLocaleDateString()
      ? date.toLocaleTimeString(de ? 'de-DE' : 'en-GB', {hour:'2-digit', minute:'2-digit'})
      : date.toLocaleDateString(de ? 'de-DE' : 'en-GB', {day:'2-digit', month:'2-digit'});
  }
  function icon(item) {
    if (local && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.iconData ?? '')) return `<img class="icon" src="${item.iconData}" alt="">`;
    if(local) { const name = /^i-[a-z0-9-]+$/.test(item.icon ?? '') ? item.icon.slice(2) : 'bell'; return `<img class="icon htn-mdi" src="${name}.svg" alt="">`; }
    try {
      const url = new URL(item.iconUrl, location.href);
      if (url.origin === location.origin && /\/mdi-icons\/[a-z0-9-]+\.svg$/.test(url.pathname))
        return `<span class="icon tabler-icon-mask" style="--icon-url:url('${url.pathname}')" aria-hidden="true"></span>`;
    } catch {}
    return bell;
  }
  const center = document.createElement('dialog');
  center.id = 'hauser-notification-center';
  center.className = 'htn-center';
  center.setAttribute('aria-labelledby', 'htn-title');
  center.innerHTML = `<header class="htn-header"><h2 id="htn-title">${bell}${t('Mitteilungen', 'Notifications')}</h2><button type="button" class="htn-icon-button" data-command="close" aria-label="${t('Schließen','Close')}">${closeIcon}</button></header><div class="htn-toolbar"><div class="htn-filters" role="group" aria-label="${t('Mitteilungen filtern','Filter notifications')}">${[['all',t('Alle','All')],['home',t('Zuhause','Home')],['system',t('System','System')],['apps','Apps']].map(([id,label]) => `<button type="button" data-group="${id}" aria-pressed="${id==='all'}">${label}</button>`).join('')}</div><button type="button" class="htn-icon-button" data-command="unread" aria-pressed="false" aria-label="${t('Nur ungelesene Mitteilungen','Only unread notifications')}">${filterIcon}</button></div><div class="htn-list"></div><footer><button type="button" class="htn-read-all" data-command="read-all">${t('Alle Mitteilungen lesen','Mark all as read')}</button><p class="htn-feedback" role="status" aria-live="polite"></p></footer>`;
  const toast = document.createElement('aside');
  toast.className = 'htn-toast'; toast.hidden = true;
  toast.setAttribute('aria-live', 'polite'); toast.setAttribute('aria-atomic', 'true');
  document.body.append(center, toast);
  function paintBanner() {
    const item = items.find(item => fingerprint(item) === banner && (unread(item) || item.type === 'critical'));
    toast.hidden = !item || center.open;
    if (!item) return;
    toast.classList.toggle('is-critical', item.type === 'critical');
    toast.setAttribute('role', item.type === 'critical' ? 'alert' : 'status');
    toast.innerHTML = `<button type="button" class="htn-banner-open" aria-label="${esc(t('Mitteilung öffnen: ','Open notification: ') + item.title)}"><span class="htn-symbol">${icon(item)}</span><span class="htn-copy">${item.type==='critical'?`<em class="htn-critical-label">${t('Wichtiger Hinweis','Important alert')}</em>`:''}<strong>${esc(item.title)}</strong>${item.message ? `<span>${esc(item.message)}</span>` : ''}</span><time datetime="${new Date(item.createdAt).toISOString()}">${timestamp(item)}</time></button><button type="button" class="htn-icon-button" data-command="hide-banner" aria-label="${t('Banner schließen','Close banner')}">${closeIcon}</button>`;
  }
  function paint() {
    const focused = center.contains(document.activeElement) ? {id:document.activeElement.dataset.id, command:document.activeElement.dataset.command, summary:document.activeElement.classList.contains('htn-summary')} : null;
    const list = center.querySelector('.htn-list'), scroll = list.scrollTop;
    center.querySelectorAll('[data-group]').forEach(button => button.setAttribute('aria-pressed', button.dataset.group === group));
    center.querySelector('[data-command=unread]').setAttribute('aria-pressed', unreadOnly);
    const visible = items.filter(item => (group === 'all' || item.group === group) && (!unreadOnly || unread(item) || item.id === expanded));
    center.querySelector('.htn-list').innerHTML = visible.length ? visible.map(item => {
      const isUnread = unread(item), open = expanded === item.id;
      return `<article class="htn-row${isUnread ? ' is-unread' : ''}${item.type === 'critical' ? ' is-critical' : ''}"><button type="button" class="htn-summary" data-id="${esc(item.id)}" aria-expanded="${open}" aria-label="${esc(item.title + (isUnread ? t(', ungelesen', ', unread') : ''))}"><span class="htn-dot" aria-hidden="true"></span><span class="htn-symbol">${icon(item)}</span><span class="htn-copy">${item.type==='critical'?`<em class="htn-critical-label">${t('Wichtiger Hinweis','Important alert')}</em>`:''}<strong>${esc(item.title)}</strong>${item.message ? `<span>${esc(item.message)}</span>` : ''}</span><time datetime="${new Date(item.createdAt).toISOString()}">${timestamp(item)}</time></button>${open ? `<div class="htn-details">${item.message ? `<p>${esc(item.message)}</p>` : ''}<div class="htn-actions">${item.action ? `<button type="button" data-command="activate" data-id="${esc(item.id)}">${t('Öffnen','Open')}</button>` : ''}<button type="button" data-command="mark-unread" data-id="${esc(item.id)}">${t('Als ungelesen markieren','Mark as unread')}</button>${item.dismissible!==false?`<button type="button" data-command="dismiss" data-id="${esc(item.id)}">${t('Quittieren','Dismiss')}</button>`:''}</div></div>` : ''}</article>`;
    }).join('') : `<div class="htn-empty">${bell}<strong>${unreadOnly ? t('Alles gelesen','All read') : t('Alles ruhig','All quiet')}</strong><p>${unreadOnly ? t('Hier gibt es keine ungelesenen Mitteilungen.','There are no unread notifications here.') : group === 'all' ? t('Neue Mitteilungen erscheinen hier.','New notifications will appear here.') : local && group==='apps' && window.tabletNotificationAccess===false ? t('App-Mitteilungen können im Adminbereich freigegeben werden.','Allow app notifications in admin settings.') : t('In dieser Kategorie gibt es keine Mitteilungen.','There are no notifications in this category.')}</p></div>`;
    list.scrollTop = scroll;
    if (focused?.id) [...center.querySelectorAll('button[data-id]')].find(button => button.dataset.id === focused.id && (focused.summary ? button.classList.contains('htn-summary') : button.dataset.command === focused.command))?.focus({preventScroll:true});
    center.querySelector('[data-command=read-all]').disabled = !items.some(unread);
    const count = !local && window.hauserTabletUnread !== undefined ? window.hauserTabletUnread : items.filter(unread).length;
    document.querySelectorAll('[data-tablet=notifications]').forEach(button => {
      button.classList.toggle('has-unread', count > 0);
      button.classList.toggle('is-active', center.open);
      button.setAttribute('aria-label', `${t('Mitteilungen','Notifications')}${count ? ` · ${count} ${t('ungelesen','unread')}` : ''}`);
    });
    paintBanner();
    if (local) Tablet.command('notificationBadge', JSON.stringify({count}));
  }
  function open(id) {
    if (!local) { location.href = 'hauser-tablet://open/notifications' + (id ? '?item='+encodeURIComponent(id) : ''); return; }
    if (!connected) { window.dispatchEvent(new Event('hauser:notifications')); return; }
    if (!center.open) { previousFocus = document.activeElement; center.showModal(); }
    document.documentElement.dataset.tabletNotifications = 'open';
    if (id) { group = 'all'; unreadOnly = false; expanded = id; const item = items.find(item => item.id === id); if (item) markRead(item); }
    paint();
    center.querySelector('[data-command=close]').focus();
    if (id) [...center.querySelectorAll('.htn-summary')].find(button => button.dataset.id === id)?.scrollIntoView({block:'nearest'});
  }
  function close() {
    if (local && window.closeTablet) window.closeTablet();
    else center.close();
  }
  function reset() {
    center.close(); delete document.documentElement.dataset.tabletNotifications;
    expanded = null; paint();
  }
  center.addEventListener('cancel', event => { event.preventDefault(); close(); });
  center.addEventListener('close', () => {
    delete document.documentElement.dataset.tabletNotifications;
    expanded = null; paint(); previousFocus?.focus?.();
    // The local shell closes after its exit animation; native reset is silent.
  });
  center.addEventListener('click', event => {
    if (event.target === center) { const rect = center.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); return; }
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.group) { group = button.dataset.group; expanded = null; paint(); return; }
    const item = items.find(item => item.id === button.dataset.id);
    switch (button.dataset.command) {
      case 'close': close(); break;
      case 'unread': unreadOnly = !unreadOnly; expanded = null; paint(); break;
      case 'read-all': items.forEach(markRead); expanded = null; paint(); center.querySelector('.htn-feedback').textContent = t('Alle Mitteilungen sind gelesen.','All notifications are read.'); break;
      case 'mark-unread': if (item) { delete read[item.id]; save(); if(local && item.source !== 'android-app')Tablet.command('notificationRead',JSON.stringify({id:item.id,read:false})); expanded = null; paint(); } break;
      case 'activate': if (item) { if(local)Tablet.command('notificationAction',JSON.stringify({action:'activate',id:item.id}));else window.dispatchEvent(new CustomEvent('hauser:notification-command', {detail:{action:'activate', id:item.id}})); close(); } break;
      case 'dismiss': if (item && item.dismissible !== false) { if(local)Tablet.command('notificationAction',JSON.stringify({action:'dismiss',id:item.id}));else window.dispatchEvent(new CustomEvent('hauser:notification-command', {detail:{action:'dismiss', id:item.id}})); } break;
      default: if (item) { expanded = expanded === item.id ? null : item.id; markRead(item); paint(); [...center.querySelectorAll('.htn-summary')].find(button => button.dataset.id === item.id)?.focus(); }
    }
  });
  toast.addEventListener('click', event => {
    if (event.target.closest('[data-command=hide-banner]')) { banner = null; paintBanner(); return; }
    const item = items.find(item => fingerprint(item) === banner);
    if (item) open(item.id);
  });
  // Swipe hides the preview, while the unread entry remains in the center.
  let startX;
  toast.addEventListener('pointerdown', event => { startX = event.clientX; });
  toast.addEventListener('pointerup', event => { if (startX !== undefined && Math.abs(event.clientX - startX) > 70) { banner = null; paintBanner(); } startX = undefined; });
  window.addEventListener('hauser:notification-state', event => {
    if (!Array.isArray(event.detail)) return;
    connected = true;
    document.documentElement.dataset.tabletNotificationFeed = 'ready';
    items = [...event.detail].sort((a,b)=>b.priority-a.priority || b.createdAt-a.createdAt);
    const fresh = items.filter(item => unread(item) && !previewed.has(fingerprint(item)))
      .sort((a,b) => b.priority-a.priority || b.createdAt-a.createdAt)[0];
    items.forEach(item => previewed.add(fingerprint(item)));
    const currentCritical = items.find(item => fingerprint(item) === banner && item.type === 'critical');
    if (fresh && (!currentCritical || fresh.type === 'critical')) {
      banner = fingerprint(fresh); clearTimeout(bannerTimer);
      if (fresh.type !== 'critical') bannerTimer = setTimeout(() => { banner = null; paintBanner(); }, 8000);
    }
    paint();
  });
  window.addEventListener('hauser:notifications', event => { if (connected) { event.stopImmediatePropagation(); open(); } }, {capture:true});
  window.hauserTabletNotifications = {open, close, reset, importRead:values=>{for(const [id,key] of Object.entries(values||{}))if(!(id in read))read[id]=key;save();paint();}, setRead:(id,value)=>{const item=items.find(item=>item.id===id);if(!item)return;if(value)read[id]=fingerprint(item);else delete read[id];save();paint();}, back: () => { if (!center.open) return false; close(); return true; }};
  window.dispatchEvent(new Event('hauser:notification-request'));
  setInterval(() => { if (center.open) paint(); else if (!toast.hidden) paintBanner(); }, 30_000);
})();
