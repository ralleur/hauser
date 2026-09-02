/* ============================================
   Benachrichtigungsregeln — reines Datenmodell, geteilt von Settings-UI,
   Notification-Layer und (als Vertrag) dem Server.

   Eine Regel bindet eine Kategorie an eine Entität und trägt mehrere
   Auslöser („Zustände"). Jeder aktive Auslöser wird serverseitig zu genau
   einer Home-Assistant-Automation aus einem Hauser-Blueprint; die Automation
   erzeugt eine Persistent Notification mit der Regel-Id, die die App als
   Kachel spiegelt. Timer und Auslösung laufen damit in HA, auch wenn Hauser
   geschlossen ist. Die Auslöser sind selbstbeschreibend (Zustände, Schwelle,
   Wartezeit), damit der Server keine Kategorie-Kenntnis braucht.
   ============================================ */

export const NOTIFICATION_CATEGORY_IDS = [
  'laundry',
  'doors-windows',
  'motion-presence',
  'safety',
  'climate',
  'device-health',
  'energy',
  'custom',
] as const;
export type NotificationCategoryId = (typeof NOTIFICATION_CATEGORY_IDS)[number];

export type NotificationTriggerKind = 'state' | 'above' | 'below';

export interface NotificationTrigger {
  /** Stabil innerhalb der Regel; Teil der Automations-Id in HA. */
  key: string;
  /** Anzeigetext und HA-Nachricht, in der Sprache des Einrichtenden. */
  label: string;
  enabled: boolean;
  kind: NotificationTriggerKind;
  /** Zielzustände (`kind === 'state'`). */
  to?: string[];
  /** Schwellenwert (`kind === 'above' | 'below'`). */
  value?: number;
  /** 0 = beim Zustandswechsel, sonst erst nach dieser Haltezeit. */
  delayMinutes: number;
}

export interface NotificationRule {
  id: string;
  category: NotificationCategoryId;
  name: string;
  entityId: string;
  enabled: boolean;
  triggers: NotificationTrigger[];
}

export const NOTIFICATION_DELAY_OPTIONS = [5, 10, 15, 30, 60, 120] as const;

/* ── Farbe einer Kategorie ──
   Die Farbe des schmalen Randes links an der Kachel. Sie ist derselbe Wert wie
   der Kachel-Typ (`is-info`/`is-success`/…), damit die Auswahl automatisch den
   themefesten Token trifft statt eines frei gewählten Hex-Werts. */
export const NOTIFICATION_COLORS = ['info', 'success', 'warning', 'critical', 'neutral'] as const;
export type NotificationColor = (typeof NOTIFICATION_COLORS)[number];
export type NotificationColorMap = Partial<Record<NotificationCategoryId, NotificationColor>>;

export function parseNotificationColors(value: unknown): NotificationColorMap | null {
  if (value === undefined || value === null) return {};
  const raw = object(value);
  if (!raw) return null;
  const colors: NotificationColorMap = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!isCategory(key)) return null;
    if (typeof entry !== 'string' || !(NOTIFICATION_COLORS as readonly string[]).includes(entry)) return null;
    colors[key] = entry as NotificationColor;
  }
  return colors;
}

const RULE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TRIGGER_KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const MAX_RULES = 64;
const MAX_TRIGGERS = 8;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isCategory(value: unknown): value is NotificationCategoryId {
  return typeof value === 'string' && (NOTIFICATION_CATEGORY_IDS as readonly string[]).includes(value);
}

export function parseNotificationTrigger(value: unknown): NotificationTrigger | null {
  const raw = object(value);
  if (!raw || typeof raw.key !== 'string' || !TRIGGER_KEY.test(raw.key)) return null;
  if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 120) return null;
  if (typeof raw.enabled !== 'boolean') return null;
  if (raw.kind !== 'state' && raw.kind !== 'above' && raw.kind !== 'below') return null;
  const delayMinutes = raw.delayMinutes;
  if (typeof delayMinutes !== 'number' || !Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 1440) return null;
  const trigger: NotificationTrigger = {
    key: raw.key,
    label: raw.label.trim(),
    enabled: raw.enabled,
    kind: raw.kind,
    delayMinutes,
  };
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

export function parseNotificationRule(value: unknown): NotificationRule | null {
  const raw = object(value);
  if (!raw || typeof raw.id !== 'string' || !RULE_ID.test(raw.id)) return null;
  if (!isCategory(raw.category)) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80) return null;
  if (typeof raw.entityId !== 'string' || !ENTITY_ID.test(raw.entityId)) return null;
  if (typeof raw.enabled !== 'boolean') return null;
  if (!Array.isArray(raw.triggers) || raw.triggers.length < 1 || raw.triggers.length > MAX_TRIGGERS) return null;
  const triggers: NotificationTrigger[] = [];
  for (const entry of raw.triggers) {
    const trigger = parseNotificationTrigger(entry);
    if (!trigger || triggers.some((known) => known.key === trigger.key)) return null;
    triggers.push(trigger);
  }
  return {
    id: raw.id,
    category: raw.category,
    name: raw.name.trim(),
    entityId: raw.entityId,
    enabled: raw.enabled,
    triggers,
  };
}

/** Strikt: eine ungültige Regel verwirft die ganze Liste (fail-closed). */
export function parseNotificationRules(value: unknown): NotificationRule[] | null {
  if (!Array.isArray(value) || value.length > MAX_RULES) return null;
  const rules: NotificationRule[] = [];
  for (const entry of value) {
    const rule = parseNotificationRule(entry);
    if (!rule || rules.some((known) => known.id === rule.id)) return null;
    rules.push(rule);
  }
  return rules;
}

export function activeRuleCount(rules: readonly NotificationRule[], category: NotificationCategoryId): number {
  return rules.filter((rule) => rule.category === category && rule.enabled
    && rule.triggers.some((trigger) => trigger.enabled)).length;
}

/* ── Identitäten in Home Assistant ──
   Die Persistent Notification trägt die Regel-Id: eine neue Auslösung
   derselben Regel ersetzt die vorige (wie „läuft" → „fertig" bei der Wäsche).
   Die Automation trägt Regel und Auslöser, damit jeder Auslöser einzeln
   angelegt und entfernt werden kann. */
export const NOTIFICATION_ID_PREFIX = 'hauser_rule_';
export const NOTIFICATION_TEST_ID_PREFIX = 'hauser_test_';
export const AUTOMATION_ID_PREFIX = 'hauser_notif_';

function haSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

export function notificationIdForRule(ruleId: string): string {
  return `${NOTIFICATION_ID_PREFIX}${haSafe(ruleId)}`;
}

export function ruleForNotificationId(rules: readonly NotificationRule[], notificationId: string): NotificationRule | null {
  if (!notificationId.startsWith(NOTIFICATION_ID_PREFIX)) return null;
  return rules.find((rule) => notificationIdForRule(rule.id) === notificationId) ?? null;
}

/* Die Testkachel kommt bei verbundenem Home Assistant denselben Weg zurück wie
   eine echte Benachrichtigung. Sie gehört zu keiner Regel, deshalb trägt ihre
   Id die Kategorie — sonst wüsste die Anzeige nicht, welche Farbe gemeint ist. */
export function testNotificationIdFor(category: NotificationCategoryId): string {
  return `${NOTIFICATION_TEST_ID_PREFIX}${category.replace(/-/g, '_')}`;
}

export function categoryForTestNotificationId(notificationId: string): NotificationCategoryId | null {
  if (!notificationId.startsWith(NOTIFICATION_TEST_ID_PREFIX)) return null;
  const candidate = notificationId.slice(NOTIFICATION_TEST_ID_PREFIX.length).replace(/_/g, '-');
  return isCategory(candidate) ? candidate : null;
}

export function automationIdFor(ruleId: string, triggerKey: string): string {
  return `${AUTOMATION_ID_PREFIX}${haSafe(ruleId)}__${haSafe(triggerKey)}`;
}

export function newRuleId(category: NotificationCategoryId, entityId: string): string {
  const tail = haSafe(entityId.split('.')[1] ?? entityId).slice(0, 40);
  const salt = Math.random().toString(36).slice(2, 6);
  return `${haSafe(category)}_${tail}_${salt}`.replace(/_+/g, '_').slice(0, 64);
}
