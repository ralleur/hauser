/* ============================================
   Einkaufsliste aus Notion — der optionale zweite Weg neben den
   Home-Assistant-Listen (Einstellungen → Einkaufsliste).

   Die Notion-API verträgt keinen Aufruf aus dem Browser (CORS), und der Token
   gehört ohnehin nicht ins Frontend. Lesen und Schreiben laufen deshalb hier;
   Zugangsdaten stehen in der geteilten Konfiguration (`hmi:notion-token`,
   `hmi:notion-page`) wie der Home-Assistant- und der Paperless-Zugang auch.

   Modell der Notion-Seite: Läden sind Überschriften, Artikel `to_do`-Blöcke
   darunter. Das entspricht der abgelösten Python-Bridge
   (`scripts/notion-bridge.py`), damit bestehende Seiten weiterlaufen.
   ============================================ */

import { jsonResponse, readSmallJson } from './shared.mjs';

const NOTION_BASE_URL = 'https://api.notion.com/v1/';
const NOTION_VERSION = '2022-06-28';
const NOTION_TIMEOUT_MS = 15_000;
const HEADER_TYPES = new Set(['heading_1', 'heading_2', 'heading_3']);
/* Historische Läden der ersten Seite: dort sind die Überschriften einfache
   Absätze, nicht Headings. */
const LEGACY_STORES = new Map([['aldi', 'Aldi'], ['rewe', 'Rewe'], ['dm', 'dm']]);
const BLOCK_ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;
const CHECKED_RETENTION_MS = 24 * 60 * 60 * 1000;

export function notionShoppingRoute(url) {
  const pathname = new URL(url || '/', 'http://hmi.local').pathname;
  return pathname === '/api/shopping/notion' || pathname.startsWith('/api/shopping/notion/');
}

/* Aus einer Notion-Adresse oder einer nackten ID die Seiten-ID lösen: Notion
   hängt die 32 Hex-Zeichen an den Titel-Slug an. */
export function notionPageId(value) {
  const match = String(value ?? '').match(/[0-9a-f]{32}|[0-9a-f-]{36}/i);
  return match ? match[0].replace(/-/g, '').toLowerCase() : null;
}

export function readNotionAccess(configStore) {
  const values = configStore ? configStore.read() : {};
  const token = typeof values['hmi:notion-token'] === 'string' ? values['hmi:notion-token'].trim() : '';
  const pageId = notionPageId(values['hmi:notion-page']);
  return token && pageId ? { token, pageId } : null;
}

async function notionApi(access, endpoint, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(new URL(endpoint, NOTION_BASE_URL), {
    method,
    headers: {
      authorization: `Bearer ${access.token}`,
      'notion-version': NOTION_VERSION,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(NOTION_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : `HTTP ${response.status}`;
    throw new Error(`Notion: ${message.slice(0, 200)}`);
  }
  return payload ?? {};
}

function blockText(block) {
  const payload = block?.[block?.type] ?? {};
  return (payload.rich_text ?? []).map((part) => part.plain_text ?? '').join('').trim();
}

export function storeIdFromLabel(label) {
  return String(label ?? '').trim().toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* Gruppiert `to_do`-Blöcke unter ihre Laden-Überschrift. `anchor` ist der
   letzte Block der Sektion — dahinter hängt ein neuer Artikel. */
export function parseNotionSections(blocks) {
  const sections = new Map([...LEGACY_STORES].map(([id, title]) => [id, { id, title, items: [], anchor: null }]));
  let current = null;
  for (const block of blocks) {
    const type = block?.type ?? '';
    const text = blockText(block);
    const isHeading = HEADER_TYPES.has(type) && Boolean(storeIdFromLabel(text));
    const isLegacyHeading = type === 'paragraph' && LEGACY_STORES.has(text.toLocaleLowerCase('de-DE'));
    if (isHeading || isLegacyHeading) {
      const id = isLegacyHeading ? text.toLocaleLowerCase('de-DE') : storeIdFromLabel(text);
      if (!sections.has(id)) sections.set(id, { id, title: text, items: [], anchor: null });
      current = sections.get(id);
      current.anchor = block.id;
      continue;
    }
    if (!current) continue;
    if (HEADER_TYPES.has(type) && text) {
      current = null; // fremde Überschrift beendet die Sektion
      continue;
    }
    current.anchor = block.id;
    if (type === 'to_do' && text) {
      const checked = Boolean(block.to_do?.checked);
      current.items.push({
        id: block.id,
        title: text,
        checked,
        checkedAt: checked ? block.last_edited_time ?? null : null,
      });
    }
  }
  return [...sections.values()];
}

async function fetchBlocks(access, fetchImpl) {
  const blocks = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const query = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '';
    const result = await notionApi(access, `blocks/${access.pageId}/children?page_size=100${query}`, { fetchImpl });
    blocks.push(...(result.results ?? []));
    if (!result.has_more) return blocks;
    cursor = result.next_cursor;
  }
  return blocks;
}

/* Seit einem Tag abgehakte Artikel verschwinden endgültig — sonst wächst die
   Notion-Seite unbegrenzt. Fehlschläge sind unkritisch: der Block bleibt. */
async function purgeCheckedBlocks(access, blocks, fetchImpl, now) {
  const retained = [];
  for (const block of blocks) {
    const edited = Date.parse(block?.last_edited_time ?? '');
    if (block?.type === 'to_do' && block.to_do?.checked
        && Number.isFinite(edited) && now - edited >= CHECKED_RETENTION_MS) {
      try {
        await notionApi(access, `blocks/${block.id}`, { method: 'DELETE', fetchImpl });
        continue;
      } catch { /* bleibt stehen und wird nächstes Mal erneut versucht */ }
    }
    retained.push(block);
  }
  return retained;
}

export async function readNotionShopping(access, { fetchImpl = fetch, now = Date.now() } = {}) {
  const blocks = await purgeCheckedBlocks(access, await fetchBlocks(access, fetchImpl), fetchImpl, now);
  return {
    updated_at: new Date(now).toISOString(),
    source_name: 'Einkaufen (Notion)',
    sections: parseNotionSections(blocks).map(({ id, title, items }) => ({ id, title, items })),
  };
}

export async function addNotionItem(access, store, title, { fetchImpl = fetch } = {}) {
  const section = parseNotionSections(await fetchBlocks(access, fetchImpl))
    .find((entry) => entry.id === store);
  if (!section?.anchor) throw new Error(`Sektion „${store}" steht nicht auf der Notion-Seite.`);
  await notionApi(access, `blocks/${access.pageId}/children`, {
    method: 'PATCH',
    fetchImpl,
    body: {
      children: [{
        object: 'block',
        type: 'to_do',
        to_do: { rich_text: [{ type: 'text', text: { content: title } }], checked: false },
      }],
      after: section.anchor,
    },
  });
}

export async function setNotionItemChecked(access, blockId, checked, { fetchImpl = fetch } = {}) {
  await notionApi(access, `blocks/${blockId}`, { method: 'PATCH', fetchImpl, body: { to_do: { checked } } });
}

/* Fehler der Notion-Seite sind Betriebsfehler des fremden Dienstes, keine
   Fehler dieser API — deshalb 502 statt 500. */
function notionFailure(res, error) {
  jsonResponse(res, 502, { error: error instanceof Error ? error.message : 'Notion antwortet nicht.' });
}

export function serveNotionShopping(req, res, { configStore, fetchImpl = fetch } = {}) {
  const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;
  const access = readNotionAccess(configStore);
  if (!access) {
    return jsonResponse(res, 503, { error: 'Notion ist nicht eingerichtet (Token und Seite fehlen).' });
  }
  if (pathname === '/api/shopping/notion' && req.method === 'GET') {
    void readNotionShopping(access, { fetchImpl })
      .then((payload) => jsonResponse(res, 200, payload))
      .catch((error) => notionFailure(res, error));
    return undefined;
  }
  if (pathname === '/api/shopping/notion/items' && req.method === 'POST') {
    return readSmallJson(req, res, (payload) => {
      const store = storeIdFromLabel(payload?.store);
      const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
      if (!store || !title) return jsonResponse(res, 400, { error: 'Laden und Titel werden benötigt.' });
      return void addNotionItem(access, store, title, { fetchImpl })
        .then(() => jsonResponse(res, 200, { ok: true }))
        .catch((error) => notionFailure(res, error));
    });
  }
  const item = pathname.match(/^\/api\/shopping\/notion\/items\/([0-9a-f-]{32,36})$/i);
  if (item && req.method === 'PATCH') {
    return readSmallJson(req, res, (payload) => {
      if (typeof payload?.checked !== 'boolean' || !BLOCK_ID_RE.test(item[1])) {
        return jsonResponse(res, 400, { error: 'Eintrag und Zustand werden benötigt.' });
      }
      return void setNotionItemChecked(access, item[1], payload.checked, { fetchImpl })
        .then(() => jsonResponse(res, 200, { ok: true }))
        .catch((error) => notionFailure(res, error));
    });
  }
  return jsonResponse(res, 404, { error: 'Notion-Route nicht gefunden' });
}
