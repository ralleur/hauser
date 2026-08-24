import { describe, expect, it } from 'vitest';
import neutralApartment from '../../../../config/examples/neutral-apartment.json';
import {
  compileHouseholdConfig,
  parseHouseholdConfig,
  type HouseholdRuntimeModel,
} from '../../config/household-config.ts';
import { guestVisibleEntityIds, projectGuestAccess } from '../../config/hotel-mode-policy.ts';
import {
  allowlistDraftFromConfig,
  allowlistDraftToConfig,
  allowlistOptions,
  allowlistSummary,
  emptyAllowlistDraft,
  entityDraft,
  isEntitySelected,
  setTemperatureBound,
  toggleAction,
  toggleEntity,
  toggleReleasedEntityId,
  validateAllowlistDraft,
} from './hotel-mode-allowlist.ts';

/* Die GUI darf ausschließlich Freigaben erzeugen, die der v4-Parser annimmt —
   und keine, die weiter reicht als das, was die Räume wirklich hergeben. */

function apartment(): any {
  return JSON.parse(JSON.stringify(neutralApartment));
}

function model(): HouseholdRuntimeModel {
  const parsed = parseHouseholdConfig(apartment());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return compileHouseholdConfig(parsed.value);
}

function parsedGuestAccess() {
  const parsed = parseHouseholdConfig(apartment());
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value.hotelMode!.guestAccess;
}

const OPTIONS = allowlistOptions(model());

function option(roomId: string, entityId: string) {
  return OPTIONS.find((room) => room.roomId === roomId)!
    .entities.find((entity) => entity.entityId === entityId)!;
}

describe('Auswählbare Räume und Geräte', () => {
  it('bietet nur Entities an, für die ein Hauser-Control existiert', () => {
    const living = OPTIONS.find((room) => room.roomId === 'living')!;

    expect(living.entities.map((entity) => entity.entityId))
      .toEqual(['light.living_ceiling', 'climate.living']);
    // Sensoren, Fenster, Kameras und andere Rollen tauchen gar nicht auf.
    const everything = OPTIONS.flatMap((room) => room.entities.map((entity) => entity.entityId));
    expect(everything.some((entityId) => entityId.startsWith('sensor.'))).toBe(false);
    expect(everything.some((entityId) => entityId.startsWith('binary_sensor.'))).toBe(false);
  });

  it('bietet je Gerät genau die Aktionen des Controls an', () => {
    expect(option('living', 'light.living_ceiling').supportedActions).toEqual(['turn_on', 'turn_off']);
    expect(option('living', 'climate.living').supportedActions).toEqual(['set_temperature', 'set_hvac_mode']);
    expect(option('living', 'light.living_ceiling').supportsTemperatureRange).toBe(false);
    expect(option('living', 'climate.living').supportsTemperatureRange).toBe(true);
  });

  it('lässt Räume ohne gastfähiges Gerät weg', () => {
    expect(OPTIONS.every((room) => room.entities.length > 0)).toBe(true);
  });
});

describe('Freigeben und zurücknehmen', () => {
  it('startet ein neu freigegebenes Gerät mit seinen Aktionen', () => {
    const draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'light.living_ceiling'));

    expect(isEntitySelected(draft, 'living', 'light.living_ceiling')).toBe(true);
    expect(entityDraft(draft, 'living', 'light.living_ceiling')).toEqual({
      entityId: 'light.living_ceiling', actions: ['turn_on', 'turn_off'], min: '', max: '',
    });
  });

  it('gibt einem numerischen Control nie eine offene Spanne', () => {
    const draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'climate.living'));

    expect(entityDraft(draft, 'living', 'climate.living')).toMatchObject({ min: '18', max: '24' });
    expect(validateAllowlistDraft(draft, OPTIONS)).toEqual([]);
  });

  it('räumt einen leer gewordenen Raum mit ab', () => {
    const on = toggleEntity(emptyAllowlistDraft(), 'bath', option('bath', 'light.bath_mirror'));
    const off = toggleEntity(on, 'bath', option('bath', 'light.bath_mirror'));

    expect(off.rooms).toEqual([]);
  });

  it('nimmt keine Aktion an, die das Control nicht kennt', () => {
    const draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'light.living_ceiling'));
    const tampered = toggleAction(draft, 'living', option('living', 'light.living_ceiling'), 'set_temperature');

    expect(entityDraft(tampered, 'living', 'light.living_ceiling')!.actions).toEqual(['turn_on', 'turn_off']);
  });

  it('lässt die letzte Aktion stehen, statt ein totes Gerät freizugeben', () => {
    let draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'light.living_ceiling'));
    draft = toggleAction(draft, 'living', option('living', 'light.living_ceiling'), 'turn_off');
    expect(entityDraft(draft, 'living', 'light.living_ceiling')!.actions).toEqual(['turn_on']);

    draft = toggleAction(draft, 'living', option('living', 'light.living_ceiling'), 'turn_on');
    expect(entityDraft(draft, 'living', 'light.living_ceiling')!.actions).toEqual(['turn_on']);
  });

  it('gibt Szenen und Skripte einzeln frei', () => {
    expect(toggleReleasedEntityId([], 'scene.evening')).toEqual(['scene.evening']);
    expect(toggleReleasedEntityId(['scene.evening'], 'scene.evening')).toEqual([]);
    expect(toggleReleasedEntityId(['scene.b'], 'scene.a')).toEqual(['scene.a', 'scene.b']);
  });
});

describe('Grenzen der Eingabe', () => {
  function climateDraft(min: string, max: string) {
    let draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'climate.living'));
    draft = setTemperatureBound(draft, 'living', 'climate.living', 'min', min);
    return setTemperatureBound(draft, 'living', 'climate.living', 'max', max);
  }

  it('meldet fehlende, unlesbare und verdrehte Bereiche', () => {
    const codes = (min: string, max: string) =>
      validateAllowlistDraft(climateDraft(min, max), OPTIONS).map((issue) => issue.code);

    expect(codes('18', '')).toEqual(['RANGE_REQUIRED']);
    expect(codes('warm', '24')).toEqual(['RANGE_INVALID']);
    expect(codes('24', '18')).toEqual(['RANGE_ORDER']);
    expect(codes('24', '24')).toEqual(['RANGE_ORDER']);
    expect(codes('18', '24')).toEqual([]);
  });

  it('erlaubt einen Bereich nur zusammen mit der Temperaturwahl', () => {
    let draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'light.living_ceiling'));
    draft = setTemperatureBound(draft, 'living', 'light.living_ceiling', 'min', '18');

    expect(validateAllowlistDraft(draft, OPTIONS).map((issue) => issue.code)).toEqual(['RANGE_NOT_ALLOWED']);
  });
});

describe('Von der Eingabe zur gespeicherten Policy', () => {
  it('erzeugt eine Freigabe, die der v4-Parser annimmt', () => {
    let draft = toggleEntity(emptyAllowlistDraft(), 'living', option('living', 'light.living_ceiling'));
    draft = toggleEntity(draft, 'living', option('living', 'climate.living'));
    draft = { ...draft, scenes: ['scene.apartment_evening'] };

    const document = apartment();
    document.hotelMode = { ...document.hotelMode, guestAccess: allowlistDraftToConfig(draft, OPTIONS) };

    const parsed = parseHouseholdConfig(document);
    expect(parsed.ok).toBe(true);
  });

  it('verwirft eine Freigabe für Räume und Geräte, die es nicht mehr gibt', () => {
    const stale = allowlistDraftToConfig({
      rooms: [
        { roomId: 'kein_raum', entities: [{ entityId: 'light.living_ceiling', actions: ['turn_on'], min: '', max: '' }] },
        { roomId: 'living', entities: [{ entityId: 'light.does_not_exist', actions: ['turn_on'], min: '', max: '' }] },
      ],
      scenes: [],
      scripts: [],
    }, OPTIONS);

    expect(stale.rooms).toEqual([]);
  });

  it('schneidet fremde Aktionen weg, statt sie zu speichern', () => {
    const config = allowlistDraftToConfig({
      rooms: [{
        roomId: 'living',
        entities: [{ entityId: 'light.living_ceiling', actions: ['turn_on', 'start', 'set_hvac_mode'] as any, min: '', max: '' }],
      }],
      scenes: [],
      scripts: [],
    }, OPTIONS);

    expect(config.rooms[0].entities[0].actions).toEqual(['turn_on']);
  });

  it('liest eine gespeicherte Freigabe verlustfrei zurück', () => {
    const draft = allowlistDraftFromConfig(parsedGuestAccess());

    expect(allowlistDraftToConfig(draft, OPTIONS)).toEqual({
      rooms: parsedGuestAccess().rooms,
      scenes: parsedGuestAccess().scenes,
      scripts: parsedGuestAccess().scripts,
    });
  });

  it('bleibt Default-Deny: eine neue HA-Entity ist nur wählbar, nie freigegeben', () => {
    const document = apartment();
    document.rooms[0].visibleEntities.push({
      id: 'floor_lamp', name: 'Stehlampe', entityId: 'light.living_floor', role: 'light',
    });
    const parsed = parseHouseholdConfig(document);
    expect(parsed.ok).toBe(true);
    const extended = allowlistOptions(compileHouseholdConfig((parsed as any).value));

    expect(extended[0].entities.map((entity) => entity.entityId)).toContain('light.living_floor');
    const saved = allowlistDraftToConfig(allowlistDraftFromConfig(parsedGuestAccess()), extended);
    expect(guestVisibleEntityIds({ enabled: true, guestAccess: saved } as any))
      .not.toContain('light.living_floor');
  });
});

describe('Zusammenfassung der effektiven Freigabe', () => {
  it('entspricht der Projektion, die der Server an Gäste ausliefert', () => {
    const guestAccess = parsedGuestAccess();
    const summary = allowlistSummary(guestAccess, OPTIONS);
    const projected = projectGuestAccess({ enabled: true, guestAccess } as any);

    expect(summary.rooms.map((room) => room.roomId)).toEqual(projected.rooms.map((room) => room.roomId));
    expect(summary.rooms.flatMap((room) => room.entities.map((entity) => entity.entityId)))
      .toEqual(projected.rooms.flatMap((room) => room.entities.map((entity) => entity.entityId)));
    expect(summary.scenes).toEqual(projected.scenes);
    expect(summary.entityCount).toBe(3);
  });

  it('zeigt lesbare Namen statt roher Entity-IDs', () => {
    const summary = allowlistSummary(parsedGuestAccess(), OPTIONS);

    expect(summary.rooms[0].name).not.toBe(summary.rooms[0].roomId);
    expect(summary.rooms[0].entities[0].name).not.toBe(summary.rooms[0].entities[0].entityId);
  });
});
