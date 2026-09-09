/* Benachrichtigungsregeln (B-04B): Regelspeicher und Automations-Abgleich.
   Herausgelöst aus server.mjs (technische Basis 1.x); Verhalten unverändert. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  NOTIFICATION_AUTOMATION_PREFIX,
  NOTIFICATION_BLUEPRINTS,
  NOTIFICATION_BLUEPRINT_DIR,
  NOTIFICATION_CATEGORY_IDS,
  NOTIFICATION_COLORS,
  NOTIFICATION_ID_PREFIX,
  NOTIFICATION_RULES_PATH,
} from './runtime-env.mjs';
import { jsonResponse, readSmallJson } from './shared.mjs';
import { blueprintExists, laundryFingerprint, laundryRest } from './laundry.mjs';

/* ── Benachrichtigungsregeln (B-04B) ──
   Die App ist Konfigurator und Anzeige, Home Assistant übernimmt Timer und
   Auslösung: jede aktive Regel × Auslöser wird zu einer Automation aus einem
   Hauser-Blueprint, die eine Persistent Notification mit der Regel-Id erzeugt.
   Der Server hält die Regelliste als JSON-Datei und gleicht die Automationen
   bei jedem Speichern ab: anlegen, aktualisieren, verwaiste entfernen. */
const NOTIFICATION_RULE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NOTIFICATION_TRIGGER_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const NOTIFICATION_ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

export function createNotificationError(code, status, message) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function notificationPublicError(error) {
  const code = typeof error?.code === 'string' ? error.code : null;
  if (code && typeof error.status === 'number') {
    return {
      status: error.status,
      payload: { ok: false, code: code.replace(/^LAUNDRY_/, 'NOTIFICATIONS_'), message: String(error.message || '') },
    };
  }
  return {
    status: 500,
    payload: { ok: false, code: 'NOTIFICATIONS_INTERNAL', message: 'Die Benachrichtigungsregeln konnten nicht verarbeitet werden.' },
  };
}

function notificationObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function parseNotificationTrigger(value) {
  const raw = notificationObject(value);
  if (!raw || typeof raw.key !== 'string' || !NOTIFICATION_TRIGGER_KEY.test(raw.key)) return null;
  if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 120) return null;
  if (typeof raw.enabled !== 'boolean') return null;
  if (!['state', 'above', 'below'].includes(raw.kind)) return null;
  if (!Number.isInteger(raw.delayMinutes) || raw.delayMinutes < 0 || raw.delayMinutes > 1440) return null;
  const trigger = { key: raw.key, label: raw.label.trim(), enabled: raw.enabled, kind: raw.kind, delayMinutes: raw.delayMinutes };
  if (raw.kind === 'state') {
    if (!Array.isArray(raw.to) || raw.to.length < 1 || raw.to.length > 16) return null;
    const to = raw.to.map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''));
    if (to.some((entry) => !entry || entry.length > 64)) return null;
    trigger.to = [...new Set(to)];
  } else {
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || Math.abs(raw.value) > 1_000_000) return null;
    trigger.value = raw.value;
  }
  return trigger;
}

/** Spiegel von `src/lib/state/notification-rules.ts`: strikt, fail-closed. */
export function parseNotificationRules(value) {
  if (!Array.isArray(value) || value.length > 64) return null;
  const rules = [];
  for (const entry of value) {
    const raw = notificationObject(entry);
    if (!raw || typeof raw.id !== 'string' || !NOTIFICATION_RULE_ID.test(raw.id)) return null;
    if (!NOTIFICATION_CATEGORY_IDS.has(raw.category)) return null;
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) return null;
    if (typeof raw.entityId !== 'string' || !NOTIFICATION_ENTITY_ID.test(raw.entityId)) return null;
    if (typeof raw.enabled !== 'boolean') return null;
    if (!Array.isArray(raw.triggers) || raw.triggers.length < 1 || raw.triggers.length > 8) return null;
    if (rules.some((known) => known.id === raw.id)) return null;
    const triggers = [];
    for (const item of raw.triggers) {
      const trigger = parseNotificationTrigger(item);
      if (!trigger || triggers.some((known) => known.key === trigger.key)) return null;
      triggers.push(trigger);
    }
    rules.push({
      id: raw.id, category: raw.category, name: raw.name.trim(), entityId: raw.entityId, enabled: raw.enabled, triggers,
    });
  }
  return rules;
}

/** Kachelfarbe je Kategorie; Spiegel von `NOTIFICATION_COLORS` im Client. */
export function parseNotificationColors(value) {
  if (value === undefined || value === null) return {};
  const raw = notificationObject(value);
  if (!raw) return null;
  const colors = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!NOTIFICATION_CATEGORY_IDS.has(key)) return null;
    if (!NOTIFICATION_COLORS.has(entry)) return null;
    colors[key] = entry;
  }
  return colors;
}

export function createNotificationRulesStore(path = NOTIFICATION_RULES_PATH) {
  function read() {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      const rules = data?.version === 1 ? parseNotificationRules(data.rules) : null;
      const colors = rules ? parseNotificationColors(data.colors) : null;
      if (rules && colors) {
        return { version: 1, updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null, rules, colors, push: parseNotificationPush(data.push) };
      }
    } catch { /* erster Start oder unlesbar: leere Liste */ }
    return { version: 1, updatedAt: null, rules: [], colors: {}, push: { service: null } };
  }

  function write(rules, colors = {}, push = { service: null }) {
    const data = { version: 1, updatedAt: new Date().toISOString(), rules, colors, push };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    return data;
  }

  return { read, write };
}

function notificationHaSafe(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

/** Welche Automationen die Regelliste in Home Assistant verlangt. */
/* Push an das Telefon (Plan 21, Stufe 4): der notify-Dienst der Companion-App
   und der Deep-Link, den der Push in Hauser öffnet. Kein eigener Push-Server. */
const NOTIFY_SERVICE = /^notify\.[a-z0-9_]{1,64}$/;
export const NOTIFICATION_PUSH_URL = 'hauser://open?screen=notifications';

export function parseNotificationPush(value) {
  const raw = notificationObject(value);
  const service = typeof raw?.service === 'string' && NOTIFY_SERVICE.test(raw.service) ? raw.service : null;
  return { service };
}

export function notificationAutomationSpecs(rules, push = { service: null }) {
  const specs = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const trigger of rule.triggers) {
      if (!trigger.enabled) continue;
      const blueprint = NOTIFICATION_BLUEPRINTS[trigger.kind];
      const input = {
        source_entity: rule.entityId,
        hold_minutes: trigger.delayMinutes,
        notification_id: `${NOTIFICATION_ID_PREFIX}${notificationHaSafe(rule.id)}`,
        title: rule.name,
        message: trigger.label,
        ...(trigger.kind === 'state' ? { to_states: trigger.to } : { threshold: trigger.value }),
        ...(push?.service ? { notify_service: push.service, notify_url: NOTIFICATION_PUSH_URL } : {}),
      };
      specs.push({
        id: `${NOTIFICATION_AUTOMATION_PREFIX}${notificationHaSafe(rule.id)}__${notificationHaSafe(trigger.key)}`,
        config: {
          alias: `Hauser · ${rule.name} · ${trigger.label}`,
          description: `Hauser notification rule ${rule.id} / ${trigger.key}`,
          use_blueprint: { path: blueprint.path, input },
          mode: 'restart',
        },
      });
    }
  }
  return specs;
}

function sameNotificationAutomation(body, expected) {
  return Boolean(body && typeof body === 'object'
    && body.alias === expected.alias
    && body.description === expected.description
    && body.mode === expected.mode
    && body.use_blueprint?.path === expected.use_blueprint.path
    && laundryFingerprint(body.use_blueprint.input) === laundryFingerprint(expected.use_blueprint.input));
}

export async function syncNotificationAutomations(client, rules, blueprintDir = NOTIFICATION_BLUEPRINT_DIR, push = { service: null }) {
  const specs = notificationAutomationSpecs(rules, push);
  const summary = { created: 0, updated: 0, deleted: 0, unchanged: 0 };

  const neededBlueprints = new Set(specs.map((spec) => spec.config.use_blueprint.path));
  if (neededBlueprints.size) {
    const blueprints = await client.ws('blueprint/list', { domain: 'automation' });
    for (const blueprint of Object.values(NOTIFICATION_BLUEPRINTS)) {
      if (!neededBlueprints.has(blueprint.path)) continue;
      const exists = blueprintExists(blueprints, blueprint.path);
      /* Push braucht die Blueprint-Version 2 (Eingaben notify_service/notify_url):
         eine ältere installierte Fassung wird dann überschrieben. */
      if (exists && !push?.service) continue;
      let yaml;
      try { yaml = readFileSync(join(blueprintDir, blueprint.file), 'utf8'); } catch {
        throw createNotificationError('NOTIFICATIONS_BLUEPRINT_MISSING', 500, `Der mitgelieferte Blueprint ${blueprint.file} fehlt.`);
      }
      await client.ws('blueprint/save', { domain: 'automation', path: blueprint.path, yaml, allow_override: exists });
    }
  }

  for (const spec of specs) {
    const current = await laundryRest(client, 'GET', `/api/config/automation/config/${spec.id}`, undefined, [200, 404]);
    if (current.status === 200 && sameNotificationAutomation(current.body, spec.config)) {
      summary.unchanged += 1;
      continue;
    }
    await laundryRest(client, 'POST', `/api/config/automation/config/${spec.id}`, spec.config, [200, 201]);
    if (current.status === 200) summary.updated += 1; else summary.created += 1;
  }

  const wanted = new Set(specs.map((spec) => spec.id));
  const registry = await client.ws('config/entity_registry/list');
  const stale = (Array.isArray(registry) ? registry : []).filter((entry) => entry?.platform === 'automation'
    && typeof entry.unique_id === 'string'
    && entry.unique_id.startsWith(NOTIFICATION_AUTOMATION_PREFIX)
    && !wanted.has(entry.unique_id));
  for (const entry of stale) {
    await laundryRest(client, 'DELETE', `/api/config/automation/config/${entry.unique_id}`, undefined, [200, 204, 404]);
    summary.deleted += 1;
  }
  return summary;
}

export function serveNotifications(req, res, service) {
  const pathname = new URL(req.url || '/', 'http://hmi.local').pathname;
  if (pathname !== '/api/notifications/rules') {
    jsonResponse(res, 404, { ok: false, code: 'NOTIFICATIONS_ROUTE_NOT_FOUND', message: 'Die Benachrichtigungs-Route wurde nicht gefunden.' });
    return;
  }
  if (req.method === 'GET') {
    const data = service.store.read();
    jsonResponse(res, 200, {
      ok: true, version: 1, updatedAt: data.updatedAt, rules: data.rules, colors: data.colors ?? {}, push: data.push ?? { service: null },
    });
    return;
  }
  if (req.method !== 'PUT') {
    jsonResponse(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Die Regel-Route unterstützt GET und PUT.' }, { allow: 'GET, PUT' });
    return;
  }
  readSmallJson(req, res, async (payload) => {
    const rules = parseNotificationRules(payload?.rules);
    const colors = parseNotificationColors(payload?.colors);
    const push = parseNotificationPush(payload?.push);
    if (!rules || !colors) {
      jsonResponse(res, 422, { ok: false, code: 'NOTIFICATIONS_INVALID_RULES', message: 'Die Regelliste ist ungültig.' });
      return;
    }
    let data;
    try { data = service.store.write(rules, colors, push); } catch {
      jsonResponse(res, 500, { ok: false, code: 'NOTIFICATIONS_WRITE_FAILED', message: 'Die Regeln konnten nicht gespeichert werden.' });
      return;
    }
    let sync = null;
    let syncError = null;
    try { sync = await service.sync(rules, push); } catch (error) {
      syncError = notificationPublicError(error).payload;
    }
    jsonResponse(res, 200, {
      ok: true, version: 1, updatedAt: data.updatedAt, rules: data.rules, colors: data.colors ?? {}, push: data.push ?? { service: null }, sync, syncError,
    });
  });
}
