/* ============================================
   Benachrichtigungskategorien — welche Entitäten eine Kategorie bindet und
   welche Auslöser eine neue Regel mitbringt. Reine Vorlagen: eine gespeicherte
   Regel trägt ihre Auslöser selbst (siehe notification-rules.ts), die
   Kategorie liefert nur Icon, Texte, Kandidatenfilter und Standardwerte.
   ============================================ */

import { m } from '../../paraglide/messages.js';
import type { LaundryAdapterConfig } from '../config/household-config.ts';
import type { EntityCatalogItem } from './fake-discovery-catalog.ts';
import {
  newRuleId,
  type NotificationCategoryId,
  type NotificationColor,
  type NotificationColorMap,
  type NotificationRule,
  type NotificationTrigger,
} from './notification-rules.ts';

export interface NotificationCategory {
  id: NotificationCategoryId;
  icon: string;
  readonly label: string;
  readonly description: string;
  /** Nutzer legt Regeln selbst an. Wäsche kommt aus der Wäsche-Einrichtung. */
  userRules: boolean;
  /** Kandidaten für neue Regeln aus dem Gerätekatalog. */
  sources(catalog: readonly EntityCatalogItem[]): EntityCatalogItem[];
  /** Standard-Auslöser für eine Quelle dieser Kategorie. */
  triggers(source: EntityCatalogItem): NotificationTrigger[];
}

export type LaundryDevice = 'washer' | 'dryer';

function state(key: string, label: string, to: readonly string[], enabled: boolean, delayMinutes = 0): NotificationTrigger {
  return { key, label, enabled, kind: 'state', to: [...to], delayMinutes };
}

function numeric(
  key: string, label: string, kind: 'above' | 'below', value: number, enabled: boolean, delayMinutes = 0,
): NotificationTrigger {
  return { key, label, enabled, kind, value, delayMinutes };
}

function binarySensors(classes: readonly string[]) {
  return (catalog: readonly EntityCatalogItem[]) => catalog.filter((item) => (
    item.domain === 'binary_sensor' && classes.includes(item.deviceClass ?? '')
  ));
}

function sensors(classes: readonly string[]) {
  return (catalog: readonly EntityCatalogItem[]) => catalog.filter((item) => (
    item.domain === 'sensor' && classes.includes(item.deviceClass ?? '')
  ));
}

const CLIMATE_THRESHOLDS: Record<string, { above: number; below: number }> = {
  temperature: { above: 26, below: 16 },
  humidity: { above: 65, below: 30 },
  carbon_dioxide: { above: 1200, below: 400 },
  pm25: { above: 25, below: 0 },
  pm10: { above: 50, below: 0 },
  volatile_organic_compounds: { above: 500, below: 0 },
  volatile_organic_compounds_parts: { above: 500, below: 0 },
  aqi: { above: 100, below: 0 },
};

const ENERGY_THRESHOLDS: Record<string, { above: number; below: number }> = {
  power: { above: 2000, below: 5 },
  apparent_power: { above: 2000, below: 5 },
  energy: { above: 10, below: 0 },
  current: { above: 10, below: 0 },
  voltage: { above: 250, below: 200 },
};

function thresholdTriggers(table: Record<string, { above: number; below: number }>, source: EntityCatalogItem): NotificationTrigger[] {
  const defaults = table[source.deviceClass ?? ''] ?? { above: 100, below: 0 };
  return [
    numeric('above', m.notif_trig_above(), 'above', defaults.above, true),
    numeric('below', m.notif_trig_below(), 'below', defaults.below, false),
  ];
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    id: 'laundry', icon: 'i-washing-machine', userRules: false,
    get label() { return m.notif_cat_laundry(); },
    get description() { return m.notif_cat_laundry_desc(); },
    sources: () => [],
    triggers: () => [],
  },
  {
    id: 'doors-windows', icon: 'i-door-open', userRules: true,
    get label() { return m.notif_cat_doors_windows(); },
    get description() { return m.notif_cat_doors_windows_desc(); },
    sources: binarySensors(['door', 'window', 'opening', 'garage_door', 'garage']),
    triggers: () => [
      state('open', m.notif_trig_open(), ['on'], true),
      state('open-long', m.notif_trig_open_long(), ['on'], false, 15),
      state('closed', m.notif_trig_closed(), ['off'], false),
    ],
  },
  {
    id: 'motion-presence', icon: 'i-motion-sensor', userRules: true,
    get label() { return m.notif_cat_motion_presence(); },
    get description() { return m.notif_cat_motion_presence_desc(); },
    sources: binarySensors(['motion', 'occupancy', 'presence', 'moving', 'vibration']),
    triggers: () => [
      state('detected', m.notif_trig_detected(), ['on'], true),
      state('clear-long', m.notif_trig_clear_long(), ['off'], false, 30),
    ],
  },
  {
    id: 'safety', icon: 'i-shield-home', userRules: true,
    get label() { return m.notif_cat_safety(); },
    get description() { return m.notif_cat_safety_desc(); },
    sources: binarySensors(['smoke', 'carbon_monoxide', 'gas', 'moisture', 'safety', 'tamper', 'heat', 'sound']),
    triggers: () => [
      state('alarm', m.notif_trig_alarm(), ['on'], true),
      state('cleared', m.notif_trig_cleared(), ['off'], false),
    ],
  },
  {
    id: 'climate', icon: 'i-thermometer', userRules: true,
    get label() { return m.notif_cat_climate(); },
    get description() { return m.notif_cat_climate_desc(); },
    sources: sensors(Object.keys(CLIMATE_THRESHOLDS)),
    triggers: (source) => thresholdTriggers(CLIMATE_THRESHOLDS, source),
  },
  {
    id: 'device-health', icon: 'i-heart-pulse', userRules: true,
    get label() { return m.notif_cat_device_health(); },
    get description() { return m.notif_cat_device_health_desc(); },
    sources: (catalog) => [...catalog],
    triggers: (source) => {
      const unavailable = state('unavailable', m.notif_trig_unavailable(), ['unavailable'], true, 10);
      if (source.domain === 'binary_sensor') {
        return [state('problem', m.notif_trig_problem(), ['on'], true), unavailable];
      }
      if (source.domain === 'sensor' && source.deviceClass === 'battery') {
        return [numeric('battery-low', m.notif_trig_battery_low(), 'below', 20, true), unavailable];
      }
      return [unavailable];
    },
  },
  {
    id: 'energy', icon: 'i-lightning-bolt', userRules: true,
    get label() { return m.notif_cat_energy(); },
    get description() { return m.notif_cat_energy_desc(); },
    sources: sensors(Object.keys(ENERGY_THRESHOLDS)),
    triggers: (source) => thresholdTriggers(ENERGY_THRESHOLDS, source),
  },
  {
    id: 'custom', icon: 'i-tune-variant', userRules: true,
    get label() { return m.notif_cat_custom(); },
    get description() { return m.notif_cat_custom_desc(); },
    sources: (catalog) => [...catalog],
    triggers: () => [
      state('reached', m.notif_trig_custom_state(), ['on'], true),
      state('held', m.notif_trig_custom_state_long(), ['on'], false, 15),
    ],
  },
];

export function categoryById(id: NotificationCategoryId): NotificationCategory {
  return NOTIFICATION_CATEGORIES.find((category) => category.id === id) ?? NOTIFICATION_CATEGORIES[0];
}

/** Vorgabefarbe einer Kategorie, solange der Nutzer keine eigene gewählt hat. */
export function defaultCategoryColor(id: NotificationCategoryId): NotificationColor {
  switch (id) {
    case 'safety': return 'critical';
    case 'device-health':
    case 'energy':
    case 'climate': return 'warning';
    case 'laundry': return 'success';
    default: return 'info';
  }
}

/** Farbe des Kachelrandes je Kategorie — eingestellter Wert vor Vorgabe. */
export function categoryColor(id: NotificationCategoryId, colors: NotificationColorMap = {}): NotificationColor {
  return colors[id] ?? defaultCategoryColor(id);
}

export function laundryRuleId(device: LaundryDevice): string {
  return `laundry_${device}`;
}

/** Wäsche-Regeln entstehen aus den Wäsche-Adaptern der Haushaltskonfiguration. */
export function laundryRule(device: LaundryDevice, adapter: LaundryAdapterConfig): NotificationRule {
  return {
    id: laundryRuleId(device),
    category: 'laundry',
    name: device === 'washer' ? m.notif_washer() : m.notif_dryer(),
    entityId: adapter.entityId,
    enabled: true,
    triggers: [
      state('running', m.notif_trig_running(), adapter.runningStates, true),
      state('done', m.notif_trig_done(), adapter.doneStates, true),
      state('done-unattended', m.notif_trig_done_unattended(), adapter.doneStates, false, 15),
    ],
  };
}

/** Der Adapter bleibt die Wahrheit für Entität und Zustände; Schalter und
 * Wartezeit der Regel bleiben erhalten. */
export function refreshLaundryRule(rule: NotificationRule, adapter: LaundryAdapterConfig): void {
  rule.entityId = adapter.entityId;
  for (const trigger of rule.triggers) {
    if (trigger.kind !== 'state') continue;
    trigger.to = trigger.key === 'running' ? [...adapter.runningStates] : [...adapter.doneStates];
  }
}

export function ruleFromSource(category: NotificationCategory, source: EntityCatalogItem): NotificationRule {
  return {
    id: newRuleId(category.id, source.entityId),
    category: category.id,
    name: source.name.trim() || source.entityId,
    entityId: source.entityId,
    enabled: true,
    triggers: category.triggers(source),
  };
}

/** Quelle einer Regel wechseln: Auslöser neu aus der Vorlage, Schalter bleiben. */
export function rebindRule(rule: NotificationRule, category: NotificationCategory, source: EntityCatalogItem): void {
  const previous = new Map(rule.triggers.map((trigger) => [trigger.key, trigger]));
  rule.entityId = source.entityId;
  rule.name = source.name.trim() || source.entityId;
  rule.triggers = category.triggers(source).map((trigger) => {
    const known = previous.get(trigger.key);
    return known ? { ...trigger, enabled: known.enabled, delayMinutes: known.delayMinutes || trigger.delayMinutes } : trigger;
  });
}
