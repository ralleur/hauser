/* ── Formmodell der Gast-Allowlist ──
   Freigegeben wird ausschließlich, was in der Haushaltskonfiguration ohnehin
   schon existiert: vorhandene Räume, ihre sichtbaren Entities und pro Entity
   nur die Aktionen, die das jeweilige Hauser-Control wirklich sendet. Es gibt
   keine freie Policy-Texteingabe — die GUI kann daher keine Freigabe erzeugen,
   die weiter reicht als der v4-Vertrag erlaubt.

   Default-Deny bleibt erhalten: eine neue HA-Entity taucht hier höchstens als
   auswählbare Option auf, niemals als bereits freigegeben. */

import {
  HOTEL_GUEST_ROLE_ACTIONS,
  type HotelGuestAccessConfig,
  type HotelGuestAction,
  type HotelGuestEntityConfig,
  type HouseholdRuntimeModel,
} from '../../config/household-config.ts';

export interface HotelAllowlistEntityOption {
  entityId: string;
  name: string;
  /** Genau die Aktionen, die das vorhandene Control unterstützt. */
  supportedActions: readonly HotelGuestAction[];
  /** Nur climate kennt einen numerischen Gastbereich. */
  supportsTemperatureRange: boolean;
}

export interface HotelAllowlistRoomOption {
  roomId: string;
  name: string;
  entities: HotelAllowlistEntityOption[];
}

export interface HotelAllowlistEntityDraft {
  entityId: string;
  actions: HotelGuestAction[];
  /** Leerer String heißt „nicht gesetzt"; die Eingabe bleibt eine Zeichenkette. */
  min: string;
  max: string;
}

export interface HotelAllowlistDraft {
  rooms: { roomId: string; entities: HotelAllowlistEntityDraft[] }[];
  scenes: string[];
  scripts: string[];
}

export const HOTEL_TEMPERATURE_DEFAULT = { min: 18, max: 24 };

/** Jeder Raum mit seinen tatsächlich gastfähigen Entities, in Konfigurationsreihenfolge. */
export function allowlistOptions(model: HouseholdRuntimeModel): HotelAllowlistRoomOption[] {
  return model.rooms
    .map((room) => ({
      roomId: room.id,
      name: room.name,
      entities: room.visibleEntities.flatMap((entity) => {
        const supportedActions = HOTEL_GUEST_ROLE_ACTIONS[entity.role];
        if (supportedActions === undefined || supportedActions.length === 0) return [];
        return [{
          entityId: entity.entityId,
          name: entity.name,
          supportedActions,
          supportsTemperatureRange: supportedActions.includes('set_temperature'),
        }];
      }),
    }))
    .filter((room) => room.entities.length > 0);
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function emptyAllowlistDraft(): HotelAllowlistDraft {
  return { rooms: [], scenes: [], scripts: [] };
}

export function allowlistDraftFromConfig(
  guestAccess: HotelGuestAccessConfig | undefined,
): HotelAllowlistDraft {
  if (!guestAccess) return emptyAllowlistDraft();
  return {
    rooms: guestAccess.rooms.map((room) => ({
      roomId: room.roomId,
      entities: room.entities.map((entity) => ({
        entityId: entity.entityId,
        actions: [...entity.actions],
        min: entity.temperatureRange === null ? '' : String(entity.temperatureRange.min),
        max: entity.temperatureRange === null ? '' : String(entity.temperatureRange.max),
      })),
    })),
    scenes: [...guestAccess.scenes],
    scripts: [...guestAccess.scripts],
  };
}

export function isEntitySelected(draft: HotelAllowlistDraft, roomId: string, entityId: string): boolean {
  return draft.rooms.some((room) => room.roomId === roomId
    && room.entities.some((entity) => entity.entityId === entityId));
}

export function entityDraft(
  draft: HotelAllowlistDraft,
  roomId: string,
  entityId: string,
): HotelAllowlistEntityDraft | undefined {
  return draft.rooms.find((room) => room.roomId === roomId)
    ?.entities.find((entity) => entity.entityId === entityId);
}

/**
 * Freigeben oder zurücknehmen. Beim Freigeben startet eine Entity mit ihren
 * unterstützten Aktionen; ein numerisches Control bekommt den dokumentierten
 * Vorschlagsbereich, damit nie eine offene Spanne entsteht.
 */
export function toggleEntity(
  draft: HotelAllowlistDraft,
  roomId: string,
  option: HotelAllowlistEntityOption,
): HotelAllowlistDraft {
  if (isEntitySelected(draft, roomId, option.entityId)) {
    return {
      ...draft,
      rooms: draft.rooms
        .map((room) => (room.roomId === roomId
          ? { ...room, entities: room.entities.filter((entity) => entity.entityId !== option.entityId) }
          : room))
        .filter((room) => room.entities.length > 0),
    };
  }
  const next: HotelAllowlistEntityDraft = {
    entityId: option.entityId,
    actions: [...option.supportedActions],
    min: option.supportsTemperatureRange ? String(HOTEL_TEMPERATURE_DEFAULT.min) : '',
    max: option.supportsTemperatureRange ? String(HOTEL_TEMPERATURE_DEFAULT.max) : '',
  };
  const existing = draft.rooms.find((room) => room.roomId === roomId);
  return {
    ...draft,
    rooms: existing
      ? draft.rooms.map((room) => (room.roomId === roomId
        ? { ...room, entities: [...room.entities, next] }
        : room))
      : [...draft.rooms, { roomId, entities: [next] }],
  };
}

/** Aktionen bleiben auf die des Controls beschränkt; die letzte lässt sich nicht abwählen. */
export function toggleAction(
  draft: HotelAllowlistDraft,
  roomId: string,
  option: HotelAllowlistEntityOption,
  action: HotelGuestAction,
): HotelAllowlistDraft {
  if (!option.supportedActions.includes(action)) return draft;
  return {
    ...draft,
    rooms: draft.rooms.map((room) => (room.roomId === roomId
      ? {
        ...room,
        entities: room.entities.map((entity) => {
          if (entity.entityId !== option.entityId) return entity;
          const has = entity.actions.includes(action);
          if (has && entity.actions.length === 1) return entity;
          return {
            ...entity,
            actions: has
              ? entity.actions.filter((candidate) => candidate !== action)
              : [...option.supportedActions.filter(
                (candidate) => candidate === action || entity.actions.includes(candidate),
              )],
          };
        }),
      }
      : room)),
  };
}

export function setTemperatureBound(
  draft: HotelAllowlistDraft,
  roomId: string,
  entityId: string,
  bound: 'min' | 'max',
  value: string,
): HotelAllowlistDraft {
  return {
    ...draft,
    rooms: draft.rooms.map((room) => (room.roomId === roomId
      ? {
        ...room,
        entities: room.entities.map((entity) => (entity.entityId === entityId
          ? { ...entity, [bound]: value }
          : entity)),
      }
      : room)),
  };
}

export function toggleReleasedEntityId(list: readonly string[], entityId: string): string[] {
  return list.includes(entityId)
    ? list.filter((candidate) => candidate !== entityId)
    : [...list, entityId].sort();
}

export interface HotelAllowlistIssue {
  roomId: string;
  entityId: string;
  code: 'NO_ACTION' | 'RANGE_REQUIRED' | 'RANGE_INVALID' | 'RANGE_ORDER' | 'RANGE_NOT_ALLOWED';
}

/** Genau die Grenzen des v4-Parsers, damit die GUI nichts Unspeicherbares anbietet. */
export function validateAllowlistDraft(
  draft: HotelAllowlistDraft,
  options: readonly HotelAllowlistRoomOption[],
): HotelAllowlistIssue[] {
  const byRoom = new Map(options.map((room) => [room.roomId, new Map(
    room.entities.map((entity) => [entity.entityId, entity]),
  )]));
  const issues: HotelAllowlistIssue[] = [];
  for (const room of draft.rooms) {
    for (const entity of room.entities) {
      const option = byRoom.get(room.roomId)?.get(entity.entityId);
      const supportsRange = option?.supportsTemperatureRange === true;
      if (entity.actions.length === 0) {
        issues.push({ roomId: room.roomId, entityId: entity.entityId, code: 'NO_ACTION' });
      }
      const wantsRange = entity.actions.includes('set_temperature');
      const min = numberOrNull(entity.min);
      const max = numberOrNull(entity.max);
      if (!wantsRange || !supportsRange) {
        if (min !== null || max !== null) {
          issues.push({ roomId: room.roomId, entityId: entity.entityId, code: 'RANGE_NOT_ALLOWED' });
        }
        continue;
      }
      if (min === null || max === null) {
        issues.push({ roomId: room.roomId, entityId: entity.entityId, code: 'RANGE_REQUIRED' });
        continue;
      }
      if (Number.isNaN(min) || Number.isNaN(max)) {
        issues.push({ roomId: room.roomId, entityId: entity.entityId, code: 'RANGE_INVALID' });
        continue;
      }
      if (min >= max) {
        issues.push({ roomId: room.roomId, entityId: entity.entityId, code: 'RANGE_ORDER' });
      }
    }
  }
  return issues;
}

/**
 * Baut die Freigabe neu auf — ausschließlich aus bekannten Räumen, bekannten
 * Entities und deren unterstützten Aktionen. Was in den Optionen fehlt, fällt
 * weg, statt eine tote Freigabe zu konservieren.
 */
export function allowlistDraftToConfig(
  draft: HotelAllowlistDraft,
  options: readonly HotelAllowlistRoomOption[],
): HotelGuestAccessConfig {
  const byRoom = new Map(options.map((room) => [room.roomId, new Map(
    room.entities.map((entity) => [entity.entityId, entity]),
  )]));
  const rooms = draft.rooms.flatMap((room) => {
    const roomOptions = byRoom.get(room.roomId);
    if (!roomOptions) return [];
    const entities = room.entities.flatMap((entity): HotelGuestEntityConfig[] => {
      const option = roomOptions.get(entity.entityId);
      if (!option) return [];
      const actions = option.supportedActions.filter((action) => entity.actions.includes(action));
      if (actions.length === 0) return [];
      const wantsRange = actions.includes('set_temperature');
      const min = numberOrNull(entity.min);
      const max = numberOrNull(entity.max);
      return [{
        entityId: entity.entityId,
        actions: [...actions],
        temperatureRange: wantsRange && min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max)
          ? { min, max }
          : null,
      }];
    });
    return entities.length === 0 ? [] : [{ roomId: room.roomId, entities }];
  });
  return {
    rooms,
    scenes: [...new Set(draft.scenes)].sort(),
    scripts: [...new Set(draft.scripts)].sort(),
  };
}

export interface HotelAllowlistSummaryEntity {
  entityId: string;
  name: string;
  actions: HotelGuestAction[];
  temperatureRange: { min: number; max: number } | null;
}

export interface HotelAllowlistSummary {
  rooms: { roomId: string; name: string; entities: HotelAllowlistSummaryEntity[] }[];
  scenes: string[];
  scripts: string[];
  entityCount: number;
}

/**
 * Verständliche Zusammenfassung der effektiven Gastfreigabe. Sie liest aus
 * derselben Konfiguration, die der Server projiziert — die Vorschau kann
 * deshalb nichts zeigen, was der Gast nicht bekäme.
 */
export function allowlistSummary(
  guestAccess: HotelGuestAccessConfig,
  options: readonly HotelAllowlistRoomOption[],
): HotelAllowlistSummary {
  const names = new Map(options.map((room) => [room.roomId, {
    name: room.name,
    entities: new Map(room.entities.map((entity) => [entity.entityId, entity.name])),
  }]));
  const rooms = guestAccess.rooms
    .filter((room) => room.entities.length > 0)
    .map((room) => ({
      roomId: room.roomId,
      name: names.get(room.roomId)?.name ?? room.roomId,
      entities: room.entities.map((entity) => ({
        entityId: entity.entityId,
        name: names.get(room.roomId)?.entities.get(entity.entityId) ?? entity.entityId,
        actions: [...entity.actions],
        temperatureRange: entity.temperatureRange === null ? null : { ...entity.temperatureRange },
      })),
    }));
  return {
    rooms,
    scenes: [...guestAccess.scenes],
    scripts: [...guestAccess.scripts],
    entityCount: new Set(rooms.flatMap((room) => room.entities.map((entity) => entity.entityId))).size,
  };
}
