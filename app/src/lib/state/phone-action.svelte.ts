/* SPDX-License-Identifier: AGPL-3.0-only */

/* ── Schnellzugriff rechts in der Telefon-Leiste ──
   Ab Werk schaltet der Knopf den Urlaubsmodus. Ein Long-Press öffnet den
   Editor, in dem ein beliebiges schaltbares Gerät dahinter gelegt wird; das
   Symbol schlägt sich aus dessen Domäne vor, bis der Nutzer ausdrücklich ein
   eigenes wählt. Gespeichert wird nur die Abweichung — Muster und Speicher wie
   `climate-central-config.svelte.ts`. */
import { runtime } from '../adapter/runtime.svelte.ts';
import { toggleVacationMode, vacationModeActive } from './commands.ts';
import { categoryOf } from './device-config.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { isSafeIconId } from './icon-path.ts';
import { defaultIconFor } from './light-icons.ts';
import { sharedStorage } from './shared-config.ts';
import type { EntityCatalogItem, ManagedDomain } from './fake-discovery-catalog.ts';

/* Nur Domänen, die ein An und ein Aus kennen: der Knopf ist ein Schalter, kein
   Auslöser. Szenen und Skripte blieben sonst dauerhaft „aus". */
export const PHONE_ACTION_DOMAINS: readonly ManagedDomain[] = [
  'switch', 'input_boolean', 'light', 'fan', 'siren', 'remote', 'humidifier',
];

/* Ohne hinterlegtes Gerät bleibt es der Urlaubsknopf mit seinem Schirm. */
export const PHONE_ACTION_FALLBACK_ICON = 'i-umbrella-beach';

export interface PhoneActionConfig {
  version: 1;
  entityId: string | null;
  icon: string | null;
}

export const PHONE_ACTION_CONFIG_KEY = 'hmi:phone-action:v1';
export const EMPTY_PHONE_ACTION_CONFIG: PhoneActionConfig = {
  version: 1,
  entityId: null,
  icon: null,
};

function validEntityId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(value);
}

export function parsePhoneActionConfig(raw: string | null): PhoneActionConfig {
  if (!raw) return structuredClone(EMPTY_PHONE_ACTION_CONFIG);
  try {
    const parsed = JSON.parse(raw) as Partial<PhoneActionConfig>;
    if (parsed.version !== 1) return structuredClone(EMPTY_PHONE_ACTION_CONFIG);
    return {
      version: 1,
      entityId: validEntityId(parsed.entityId) ? parsed.entityId : null,
      icon: typeof parsed.icon === 'string' && isSafeIconId(parsed.icon) ? parsed.icon : null,
    };
  } catch {
    return structuredClone(EMPTY_PHONE_ACTION_CONFIG);
  }
}

function load(): PhoneActionConfig {
  try {
    return parsePhoneActionConfig(sharedStorage.getItem(PHONE_ACTION_CONFIG_KEY));
  } catch {
    return structuredClone(EMPTY_PHONE_ACTION_CONFIG);
  }
}

export const phoneActionConfig = $state(load());

function save(): void {
  if (phoneActionConfig.entityId === null && phoneActionConfig.icon === null) {
    sharedStorage.removeItem(PHONE_ACTION_CONFIG_KEY);
    return;
  }
  sharedStorage.setItem(PHONE_ACTION_CONFIG_KEY, JSON.stringify(phoneActionConfig));
}

export function setPhoneActionEntity(entityId: string | null): void {
  phoneActionConfig.entityId = validEntityId(entityId) ? entityId : null;
  save();
}

export function setPhoneActionIcon(icon: string | null): void {
  phoneActionConfig.icon = icon !== null && isSafeIconId(icon) ? icon : null;
  save();
}

/* Der Katalogeintrag trägt Name und Domäne — beides zeigt der Knopf. */
export function phoneActionEntity(): EntityCatalogItem | null {
  const entityId = phoneActionConfig.entityId;
  if (!entityId) return null;
  return deviceManager.catalog.find((item) => item.entityId === entityId) ?? null;
}

/* Vorschlag aus der Domäne: dieselbe Zuordnung, die auch die Raumkacheln
   benutzen. Ein unbekanntes Gerät (Katalog noch nicht geladen) behält den
   Schirm, damit der Knopf nie leer aussieht. */
export function suggestedPhoneActionIcon(): string {
  const entry = phoneActionEntity();
  return entry ? defaultIconFor(categoryOf(entry.domain)) : PHONE_ACTION_FALLBACK_ICON;
}

export function phoneActionIcon(): string {
  return phoneActionConfig.icon ?? suggestedPhoneActionIcon();
}

export function phoneActionDeviceName(): string | null {
  return phoneActionEntity()?.name ?? null;
}

export function phoneActionActive(): boolean {
  const entityId = phoneActionConfig.entityId;
  if (!entityId) return vacationModeActive();
  return Boolean((runtime.merged(entityId) as { on?: boolean } | undefined)?.on);
}

export function togglePhoneAction(): void {
  const entry = phoneActionEntity();
  const entityId = phoneActionConfig.entityId;
  if (!entityId) return toggleVacationMode();
  const current = runtime.merged(entityId) as Record<string, unknown> | undefined;
  const next = !phoneActionActive();
  runtime.dispatch(
    {
      entityId,
      /* Ohne Katalogeintrag steht die Domäne im entity_id — sie ist dort die
         Wahrheit, der Katalog nur die bequemere Quelle. */
      domain: entry?.domain ?? entityId.split('.')[0],
      service: next ? 'turn_on' : 'turn_off',
      data: {},
      queuedAt: Date.now(),
    },
    { ...(current ?? {}), on: next },
  );
}

/* Der Knopf lebt außerhalb jeder Raumansicht: ohne diese Zeile bliebe das
   hinterlegte Gerät unabonniert und der Zustand ewig „aus". */
export function configuredPhoneActionIds(): string[] {
  return phoneActionConfig.entityId ? [phoneActionConfig.entityId] : [];
}
