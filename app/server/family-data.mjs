/* Familiendaten: Erinnerungen und Einkaufsliste als lokale Dateien.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FAMILY_DATA_PATH, FAMILY_DATA_SEED_PATH } from './runtime-env.mjs';
import { jsonResponse, readSmallJson } from './shared.mjs';

export function createFamilyDataStore(
  path = FAMILY_DATA_PATH,
  seedPath = FAMILY_DATA_SEED_PATH,
) {
  function seed() {
    try {
      const data = JSON.parse(readFileSync(seedPath, 'utf8'));
      if (data?.version === 1 && Array.isArray(data.reminders) && Array.isArray(data.shopping)) return data;
    } catch { /* defaults below */ }
    return { version: 1, updatedAt: new Date().toISOString(), reminders: [], shopping: [
      { id: 'aldi', title: 'Aldi', items: [] },
      { id: 'rewe', title: 'Rewe', items: [] },
      { id: 'dm', title: 'dm', items: [] },
    ] };
  }

  function write(data) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return data;
  }

  function read() {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data?.version === 1 && Array.isArray(data.reminders) && Array.isArray(data.shopping)) return data;
    } catch { /* first start: migrate the bundled snapshots */ }
    return write(seed());
  }

  function update(mutator) {
    const data = read();
    mutator(data);
    data.updatedAt = new Date().toISOString();
    return write(data);
  }

  function reminders() {
    const data = read();
    return {
      updated_at: data.updatedAt,
      source_name: 'HMI Erinnerungen',
      source_color: '#ffffff',
      items: data.reminders,
    };
  }

  function reminderDue(rawDue) {
    if (rawDue === null || rawDue === undefined || rawDue === '') return null;
    const due = String(rawDue);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(`${due}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== due) {
      throw new Error('Ungültiges Erinnerungsdatum');
    }
    return due;
  }

  function addReminder(who, rawTitle, rawDue = null, rawLabel = null) {
    /* Die drei Voreinstellungen bleiben ohne Label gültig; frei angelegte
       Bewohner (Notizen-Screen) schicken ihren Anzeigenamen mit. */
    const labels = { alex: 'Alex', sam: 'Sam', beide: 'Beide' };
    const id = String(who || '').trim().toLowerCase();
    const label = String(rawLabel || labels[id] || '').trim();
    const title = String(rawTitle || '').trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(id) || !label || label.length > 40) {
      throw new Error('Unbekannte Person');
    }
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fullTitle = new RegExp(`^(${id}|${escaped})\\s*[-–:]`, 'i').test(title) ? title : `${label} - ${title}`;
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(), title: fullTitle, completed: false, due: reminderDue(rawDue),
      description: null, priority: null, created: now, edited: now, source: 'hmi',
    };
    update((data) => data.reminders.push(item));
    return item;
  }

  function completeReminder(id) {
    let found = false;
    update((data) => {
      const item = data.reminders.find((entry) => entry.id === id);
      if (!item) return;
      item.completed = true;
      item.edited = new Date().toISOString();
      found = true;
    });
    if (!found) throw new Error('Erinnerung nicht gefunden');
  }

  function updateReminder(id, rawTitle, rawDue) {
    const title = String(rawTitle || '').trim();
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const due = reminderDue(rawDue);
    let found = false;
    update((data) => {
      const item = data.reminders.find((entry) => entry.id === id);
      if (!item) return;
      item.title = title;
      item.due = due;
      item.edited = new Date().toISOString();
      found = true;
    });
    if (!found) throw new Error('Erinnerung nicht gefunden');
  }

  function shopping() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let changed = false;
    const data = read();
    for (const section of data.shopping) {
      const retained = section.items.filter((item) => !item.checked || !item.checkedAt
        || new Date(item.checkedAt).getTime() > cutoff);
      changed ||= retained.length !== section.items.length;
      section.items = retained;
    }
    if (changed) {
      data.updatedAt = new Date().toISOString();
      write(data);
    }
    return { updated_at: data.updatedAt, source_name: 'HMI Einkaufsliste', sections: data.shopping };
  }

  function addShoppingItem(store, rawTitle) {
    const title = String(rawTitle || '').trim();
    if (!store) throw new Error('Unbekannter Laden');
    if (!title) throw new Error('Leerer Titel');
    if (title.length > 120) throw new Error('Titel ist zu lang');
    const item = { id: randomUUID(), title, checked: false, checkedAt: null };
    let found = false;
    update((data) => {
      const section = data.shopping.find((entry) => entry.id === store);
      if (!section) return;
      section.items.push(item);
      found = true;
    });
    if (!found) throw new Error('Laden nicht gefunden');
    return item;
  }

  function toggleShoppingItem(id, checked) {
    let found = false;
    update((data) => {
      const item = data.shopping.flatMap((section) => section.items).find((entry) => entry.id === id);
      if (!item) return;
      item.checked = Boolean(checked);
      item.checkedAt = item.checked ? new Date().toISOString() : null;
      found = true;
    });
    if (!found) throw new Error('Einkaufsartikel nicht gefunden');
  }

  function addShoppingStore(id, rawLabel) {
    const label = String(rawLabel || '').trim();
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !label) throw new Error('Ungültiger Laden');
    update((data) => {
      if (data.shopping.some((entry) => entry.id === id)) throw new Error('Laden existiert bereits');
      data.shopping.push({ id, title: label, items: [] });
    });
  }

  function deleteShoppingStore(id) {
    let found = false;
    update((data) => {
      const index = data.shopping.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      data.shopping.splice(index, 1);
      found = true;
    });
    if (!found) throw new Error('Laden nicht gefunden');
  }

  return {
    addReminder, addShoppingItem, addShoppingStore, completeReminder,
    deleteShoppingStore, reminders, shopping, toggleShoppingItem, updateReminder,
  };
}

export function serveFamilyData(req, res, store) {
  const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;
  try {
    if (pathname === '/api/reminders' && req.method === 'GET') {
      return jsonResponse(res, 200, store.reminders());
    }
    if (pathname === '/api/shopping' && req.method === 'GET') {
      return jsonResponse(res, 200, store.shopping());
    }
    const reminderComplete = pathname.match(/^\/api\/reminders\/([0-9a-f-]{36})\/complete$/i);
    if (reminderComplete && req.method === 'POST') {
      store.completeReminder(reminderComplete[1]);
      return jsonResponse(res, 200, { ok: true });
    }
    const reminderItem = pathname.match(/^\/api\/reminders\/([0-9a-f-]{36})$/i);
    if (reminderItem && req.method === 'PATCH') {
      return readSmallJson(req, res, (payload) => {
        try {
          store.updateReminder(reminderItem[1], payload?.title, payload?.due);
          jsonResponse(res, 200, { ok: true });
        } catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    const shoppingItem = pathname.match(/^\/api\/shopping\/items\/([0-9a-f-]{36})$/i);
    if (shoppingItem && req.method === 'PATCH') {
      return readSmallJson(req, res, (payload) => {
        try {
          if (typeof payload?.checked !== 'boolean') throw new Error('Ungültiger Status');
          store.toggleShoppingItem(shoppingItem[1], payload.checked);
          jsonResponse(res, 200, { ok: true });
        } catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    const shoppingStore = pathname.match(/^\/api\/shopping\/stores\/([a-z0-9-]{1,64})$/);
    if (shoppingStore && req.method === 'DELETE') {
      store.deleteShoppingStore(shoppingStore[1]);
      return jsonResponse(res, 200, { ok: true });
    }
    if (pathname === '/api/reminders' && req.method === 'POST') {
      return readSmallJson(req, res, (payload) => {
        try { jsonResponse(res, 201, { ok: true, item: store.addReminder(payload?.who, payload?.title, payload?.due, payload?.label) }); }
        catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    if (pathname === '/api/shopping/items' && req.method === 'POST') {
      return readSmallJson(req, res, (payload) => {
        try { jsonResponse(res, 201, { ok: true, item: store.addShoppingItem(payload?.store, payload?.title) }); }
        catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    if (pathname === '/api/shopping/stores' && req.method === 'POST') {
      return readSmallJson(req, res, (payload) => {
        try {
          store.addShoppingStore(payload?.id, payload?.label);
          jsonResponse(res, 201, { ok: true });
        } catch (error) { jsonResponse(res, 422, { error: error.message }); }
      });
    }
    jsonResponse(res, 404, { error: 'Route nicht gefunden' });
  } catch (error) {
    jsonResponse(res, 422, { error: error instanceof Error ? error.message : 'Daten konnten nicht gespeichert werden' });
  }
}
