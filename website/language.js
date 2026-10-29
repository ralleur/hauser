/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
  'use strict';
  const key = 'hauser-website-language';
  const url = new URL(location.href);
  const explicit = url.searchParams.get('lang');
  let saved;
  try {
    saved = localStorage.getItem(key);
    if (explicit === 'en' || explicit === 'de') localStorage.setItem(key, explicit);
  } catch { /* Links and explicit URLs also work when storage is unavailable. */ }
  // Only the unqualified homepage chooses a language. Deep links are explicit.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const browser = (navigator.languages?.length ? navigator.languages : [navigator.language])
      .find(language => /^(de|en)(-|$)/i.test(language || '')) || navigator.language || 'en';
    const language = ['en', 'de'].includes(explicit) ? explicit
      : ['en', 'de'].includes(saved) ? saved : /^de(-|$)/i.test(browser) ? 'de' : 'en';
    if (language === 'de') {
      url.pathname = '/de/';
      location.replace(url.href);
      return;
    }
  }
  document.addEventListener('click', event => {
    const link = event.target.closest?.('[data-language-switch]');
    if (!link) return;
    const language = link.dataset.languageSwitch;
    try { localStorage.setItem(key, language); } catch { /* Native link remains usable. */ }
    const target = new URL(link.href);
    // Explicit English wins over browser detection, including with blocked storage.
    if (language === 'en' && target.pathname === '/') target.searchParams.set('lang', 'en');
    target.hash = location.hash;
    link.href = target.href;
  });
})();
