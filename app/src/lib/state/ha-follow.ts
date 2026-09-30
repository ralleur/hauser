/* ── R43: Hauser folgt Home Assistant ──
   Ordnet jemand in HA ein Gerät einem anderen Bereich zu, zieht es in Hauser
   mit; ein Gerät, das nach dem Stichtag in HA neu angelegt wird, erscheint im
   Raum seines Bereichs. Beides wird wie ein Handgriff in die Geräte-Config
   geschrieben — so sehen Panel, Telefon und iOS-App dasselbe, und eine spätere
   Zuordnung von Hand in Hauser gewinnt wieder.

   Warum ein gemerkter Bereich statt „immer der HA-Bereich": Die Einrichtung
   lässt Geräte von Hand in einen anderen Raum legen. Diese Entscheidung ist
   nirgends als solche gespeichert; würde der HA-Bereich stets gewinnen, spränge
   das Gerät zurück. Gezogen wird deshalb nur bei einer Änderung in HA.

   Warum ein Stichtag: Was vor ihm schon in HA stand, hat die Einrichtung
   gesehen und bewusst nicht gezeigt. Es darf nicht von selbst auftauchen.

   R56: Landet ein neues oder umgezogenes Gerät in einem Bereich, den Hauser
   noch nie gesehen hat und für den es keinen Raum gibt, meldet der Abgleich
   den Bereich als neu, statt ihn zu merken. Ist der Raum angelegt, läuft der
   Abgleich noch einmal und das Gerät zieht ein. Ein Bereich, den Hauser schon
   kannte, wird nie von selbst ein Raum — sonst käme ein gelöschter Raum
   zurück. */

import { assignDeviceRoom, roomIdForArea, type DeviceConfig, type EntityCatalogItem } from './device-config.ts';

export const HA_FOLLOW_KEY = 'hmi:ha-follow:v1';

/* Dieselben Rollen, die auch die Einrichtung sichtbar schaltet. Sensoren und
   Helfer bleiben im Katalog, bis jemand sie holt. */
const FOLLOW_DOMAINS: ReadonlySet<string> = new Set(['light', 'switch', 'cover', 'vacuum']);

export interface HaFollowState {
  version: 1;
  /** Ab hier angelegte HA-Entitäten erscheinen von selbst (ms). */
  since: number;
  /** Zuletzt gesehener HA-Bereich je Entität. */
  areas: Record<string, string>;
}

export function parseHaFollowState(raw: string | null): HaFollowState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<HaFollowState>;
    if (value?.version !== 1 || typeof value.since !== 'number' || !Number.isFinite(value.since)) return null;
    const areas: Record<string, string> = {};
    if (value.areas && typeof value.areas === 'object' && !Array.isArray(value.areas)) {
      for (const [id, area] of Object.entries(value.areas)) if (typeof area === 'string') areas[id] = area;
    }
    return { version: 1, since: value.since, areas };
  } catch {
    return null;
  }
}

export interface HaFollowResult {
  config: DeviceConfig;
  state: HaFollowState;
  /** Geräte-Config geändert? */
  configChanged: boolean;
  /** Gemerkte Bereiche geändert? */
  stateChanged: boolean;
  /** Bereiche, die ein Raum werden sollen, bevor ihre Geräte einziehen (R56). */
  newAreas: string[];
}

/**
 * Gleicht den frischen HA-Katalog mit dem gemerkten Stand ab.
 * `shown` sind die Entitäten, die gerade in einem Raum stehen (Haushalt oder
 * Geräte-Config) — nur die ziehen mit; Verstecktes bleibt versteckt.
 */
export function followHomeAssistant(
  config: DeviceConfig,
  catalog: readonly EntityCatalogItem[],
  rooms: readonly { id: string; name: string }[],
  shown: ReadonlySet<string>,
  previous: HaFollowState | null,
  now: number,
): HaFollowResult {
  const state: HaFollowState = previous
    ? { version: 1, since: previous.since, areas: { ...previous.areas } }
    : { version: 1, since: now, areas: {} };
  let next = config;
  let configChanged = false;
  let stateChanged = previous === null;
  const knownAreas = new Set(Object.values(previous?.areas ?? {}));
  const newAreas = new Set<string>();

  for (const item of catalog) {
    const tracked = FOLLOW_DOMAINS.has(item.domain) || shown.has(item.entityId);
    if (!tracked || !item.area) continue;
    const area = item.area.trim();
    if (!area) continue;
    const before = state.areas[item.entityId];
    const target = roomIdForArea(area, rooms);
    const override = next.devices[item.entityId];
    const moved = before !== undefined && before !== area && shown.has(item.entityId);
    const fresh = before === undefined
      && FOLLOW_DOMAINS.has(item.domain)
      && typeof item.createdAt === 'number' && item.createdAt > state.since
      && !shown.has(item.entityId) && !override;

    if (!target && (moved || fresh) && !knownAreas.has(area)) {
      newAreas.add(area);
      continue;
    }
    if (before !== area) {
      state.areas[item.entityId] = area;
      stateChanged = true;
    }
    if (!target) continue;

    if (moved) {
      // Umgezogen: nur wenn Hauser das Gerät nicht schon dort zeigt.
      if (override?.roomId !== target) {
        next = assignDeviceRoom(next, item.entityId, target);
        configChanged = true;
      }
      continue;
    }

    if (fresh) {
      next = assignDeviceRoom(next, item.entityId, target);
      configChanged = true;
    }
  }

  return { config: next, state, configChanged, stateChanged, newAreas: [...newAreas] };
}
