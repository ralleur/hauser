import { describe, expect, it } from 'vitest';
import neutralApartment from '../../../config/examples/neutral-apartment.json';
import {
  parseHouseholdConfig,
  type ConfigIssue,
  type HotelModeConfig,
  type HouseholdConfigV4,
} from './household-config.ts';
import {
  adminIdleTimeoutMs,
  evaluateGuestCommand,
  findOverlappingStays,
  guestVisibleEntityIds,
  guestVisibleRoomIds,
  isStayActive,
  projectStays,
  resolveGuestServiceCall,
  resolveStayWindow,
  selectStayStatus,
  zonedWallClockToInstant,
  type HotelCalendarEventInput,
} from './hotel-mode-policy.ts';

function parseValid(input: unknown): HouseholdConfigV4 {
  const result = parseHouseholdConfig(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function parseIssues(input: unknown): ConfigIssue[] {
  const result = parseHouseholdConfig(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected an invalid household config');
  return result.issues;
}

function expectIssue(input: unknown, code: ConfigIssue['code'], path: string): void {
  expect(parseIssues(input)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code, path }),
  ]));
}

function apartmentDocument(): Record<string, any> {
  return structuredClone(neutralApartment) as Record<string, any>;
}

function hotelPolicy(mutate: (hotelMode: Record<string, any>) => void = () => {}): HotelModeConfig {
  const document = apartmentDocument();
  mutate(document.hotelMode);
  const config = parseValid(document);
  if (!config.hotelMode) throw new Error('Expected a parsed hotel mode block');
  return config.hotelMode;
}

const calendar = hotelPolicy().calendar;

function enabledPolicy(): HotelModeConfig {
  return hotelPolicy((hotelMode) => {
    hotelMode.enabled = true;
    hotelMode.kioskAcknowledged = true;
  });
}

function event(overrides: Partial<HotelCalendarEventInput> = {}): HotelCalendarEventInput {
  return { uid: 'stay-1', start: '2026-08-24', end: '2026-08-27', ...overrides };
}

describe('hotel mode v4 configuration contract', () => {
  it('keeps the hotel block optional so a migrated household stays unchanged', () => {
    const document = apartmentDocument();
    delete document.hotelMode;

    const config = parseValid(document);

    expect(config.schemaVersion).toBe(4);
    expect(Object.hasOwn(config, 'hotelMode')).toBe(false);
  });

  it('accepts the example apartment policy and preserves its released actions', () => {
    const policy = hotelPolicy();

    expect(policy.enabled).toBe(false);
    expect(policy.adminIdleTimeoutMinutes).toBe(15);
    expect(policy.guestAccess.rooms.map((room) => room.roomId)).toEqual(['living', 'bath']);
    expect(policy.guestAccess.rooms[0].entities[1]).toEqual({
      entityId: 'climate.living',
      actions: ['set_temperature', 'set_hvac_mode'],
      temperatureRange: { min: 18, max: 24 },
    });
    expect(policy.guestAccess.scenes).toEqual(['scene.apartment_evening']);
  });

  it.each([
    ['unknown fields', (hotelMode: Record<string, any>) => { hotelMode.roomTypes = []; }, 'UNKNOWN_FIELD', '$.hotelMode.roomTypes'],
    ['unknown rooms', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.rooms[0].roomId = 'penthouse'; }, 'UNKNOWN_REFERENCE', '$.hotelMode.guestAccess.rooms[0].roomId'],
    ['foreign entities', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.rooms[1].entities[0].entityId = 'light.living_ceiling'; }, 'UNKNOWN_REFERENCE', '$.hotelMode.guestAccess.rooms[1].entities[0].entityId'],
    ['unsupported actions', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.rooms[0].entities[0].actions = ['set_temperature']; }, 'INVALID_VALUE', '$.hotelMode.guestAccess.rooms[0].entities[0].actions[0]'],
    ['empty action lists', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.rooms[1].entities[0].actions = []; }, 'INVALID_VALUE', '$.hotelMode.guestAccess.rooms[1].entities[0].actions'],
    ['inverted ranges', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.rooms[0].entities[1].temperatureRange = { min: 24, max: 18 }; }, 'INVALID_VALUE', '$.hotelMode.guestAccess.rooms[0].entities[1].temperatureRange.min'],
    ['open temperature control', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.rooms[0].entities[1].temperatureRange = null; }, 'INVALID_VALUE', '$.hotelMode.guestAccess.rooms[0].entities[1].temperatureRange'],
    ['unknown time zones', (hotelMode: Record<string, any>) => { hotelMode.calendar.timeZone = 'Mars/Olympus'; }, 'INVALID_VALUE', '$.hotelMode.calendar.timeZone'],
    ['malformed default times', (hotelMode: Record<string, any>) => { hotelMode.calendar.allDayCheckIn = '25:00'; }, 'INVALID_VALUE', '$.hotelMode.calendar.allDayCheckIn'],
    ['foreign calendar domains', (hotelMode: Record<string, any>) => { hotelMode.calendar.entityId = 'sensor.stays'; }, 'INVALID_ENTITY_ID', '$.hotelMode.calendar.entityId'],
    ['scripts in the scene list', (hotelMode: Record<string, any>) => { hotelMode.guestAccess.scenes = ['script.apartment_evening']; }, 'INVALID_ENTITY_ID', '$.hotelMode.guestAccess.scenes[0]'],
    ['out-of-range idle timeouts', (hotelMode: Record<string, any>) => { hotelMode.adminIdleTimeoutMinutes = 0; }, 'INVALID_VALUE', '$.hotelMode.adminIdleTimeoutMinutes'],
    ['activation without a kiosk confirmation', (hotelMode: Record<string, any>) => { hotelMode.enabled = true; }, 'INCONSISTENT_MODULE', '$.hotelMode.kioskAcknowledged'],
  ])('fails closed for %s', (_label, mutate, code, path) => {
    const document = apartmentDocument();
    mutate(document.hotelMode);
    expectIssue(document, code as ConfigIssue['code'], path as string);
  });

  it('rejects a duplicate release of the same entity', () => {
    const document = apartmentDocument();
    document.hotelMode.guestAccess.rooms[0].entities.push({
      entityId: 'light.living_ceiling',
      actions: ['turn_on'],
      temperatureRange: null,
    });

    expectIssue(document, 'DUPLICATE_ENTITY_ID', '$.hotelMode.guestAccess.rooms[0].entities[2].entityId');
  });

  it('rejects releasing a control Hauser cannot operate', () => {
    const document = apartmentDocument();
    document.hotelMode.guestAccess.rooms[0].entities = [
      { entityId: 'sensor.living_temperature', actions: ['turn_on'], temperatureRange: null },
    ];

    expectIssue(document, 'INVALID_VALUE', '$.hotelMode.guestAccess.rooms[0].entities[0].entityId');
  });
});

describe('hotel mode stay windows', () => {
  it('applies the configured all-day defaults in the configured time zone', () => {
    const resolved = resolveStayWindow(event(), calendar);

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.stay.allDay).toBe(true);
    expect(resolved.stay.checkIn).toBe(Date.parse('2026-08-24T15:00:00+02:00'));
    expect(resolved.stay.checkOut).toBe(Date.parse('2026-08-27T11:00:00+02:00'));
  });

  it('resolves wall-clock defaults across a standard-time boundary', () => {
    expect(zonedWallClockToInstant(2026, 1, 15, 15, 0, 'Europe/Berlin'))
      .toBe(Date.parse('2026-01-15T15:00:00+01:00'));
    expect(zonedWallClockToInstant(2026, 7, 15, 15, 0, 'Europe/Berlin'))
      .toBe(Date.parse('2026-07-15T15:00:00+02:00'));
  });

  it('uses timed calendar boundaries verbatim', () => {
    const resolved = resolveStayWindow(
      event({ start: '2026-08-24T17:30:00+02:00', end: '2026-08-25T09:00:00+02:00' }),
      calendar,
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.stay.allDay).toBe(false);
    expect(resolved.stay.checkIn).toBe(Date.parse('2026-08-24T17:30:00+02:00'));
  });

  it.each([
    ['a mixed all-day and timed pair', { start: '2026-08-24', end: '2026-08-25T09:00:00Z' }, 'MIXED_DATE_KINDS'],
    ['an unparsable start', { start: 'tomorrow', end: '2026-08-25T09:00:00Z' }, 'INVALID_START'],
    ['an unparsable end', { start: '2026-08-24T09:00:00Z', end: 'later' }, 'INVALID_END'],
    ['an inverted window', { start: '2026-08-25T09:00:00Z', end: '2026-08-24T09:00:00Z' }, 'EMPTY_WINDOW'],
    ['an empty window', { start: '2026-08-24T09:00:00Z', end: '2026-08-24T09:00:00Z' }, 'EMPTY_WINDOW'],
  ])('rejects %s', (_label, boundaries, code) => {
    const resolved = resolveStayWindow(event(boundaries), calendar);

    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.issue.code).toBe(code);
  });

  it('carries the guest name and only uses the description when it is configured', () => {
    const withWelcome = resolveStayWindow(event({ summary: '  Ada  ', description: ' Enjoy ' }), calendar);
    const withoutWelcome = resolveStayWindow(
      event({ summary: 'Ada', description: 'Enjoy' }),
      { ...calendar, useDescriptionAsWelcome: false },
    );

    expect(withWelcome.ok && withWelcome.stay).toMatchObject({ guestName: 'Ada', welcomeMessage: 'Enjoy' });
    expect(withoutWelcome.ok && withoutWelcome.stay).toMatchObject({ guestName: 'Ada', welcomeMessage: null });
  });

  it('never invents a welcome message from an empty description', () => {
    const resolved = resolveStayWindow(event({ description: '   ' }), calendar);

    expect(resolved.ok && resolved.stay.welcomeMessage).toBe(null);
  });

  it('treats a stay as active from check-in until, but not including, check-out', () => {
    const resolved = resolveStayWindow(event(), calendar);
    if (!resolved.ok) throw new Error('Expected a resolved stay');
    const { stay } = resolved;

    expect(isStayActive(stay, stay.checkIn - 1)).toBe(false);
    expect(isStayActive(stay, stay.checkIn)).toBe(true);
    expect(isStayActive(stay, stay.checkOut - 1)).toBe(true);
    expect(isStayActive(stay, stay.checkOut)).toBe(false);
  });
});

describe('hotel mode stay selection', () => {
  const stays: HotelCalendarEventInput[] = [
    event({ uid: 'past', start: '2026-08-01', end: '2026-08-05' }),
    event({ uid: 'current', start: '2026-08-24', end: '2026-08-27' }),
    event({ uid: 'next', start: '2026-09-04', end: '2026-09-08' }),
  ];
  const duringCurrent = Date.parse('2026-08-25T12:00:00+02:00');

  it('selects exactly the stay that contains the server instant', () => {
    const status = selectStayStatus(projectStays(stays, calendar), duringCurrent);

    expect(status.status).toBe('active');
    expect(status.status === 'active' && status.stay.uid).toBe('current');
  });

  it('stays neutral before check-in and reports only the next stay', () => {
    const status = selectStayStatus(projectStays(stays, calendar), Date.parse('2026-08-20T12:00:00+02:00'));

    expect(status.status).toBe('inactive');
    expect(status.status === 'inactive' && status.nextStay?.uid).toBe('current');
  });

  it('stays neutral from check-out onwards', () => {
    const status = selectStayStatus(projectStays(stays, calendar), Date.parse('2026-08-27T11:00:00+02:00'));

    expect(status.status).toBe('inactive');
    expect(status.status === 'inactive' && status.nextStay?.uid).toBe('next');
  });

  it('never releases a guest while stays overlap', () => {
    const overlapping = [...stays, event({ uid: 'double', start: '2026-08-26', end: '2026-08-29' })];

    const status = selectStayStatus(projectStays(overlapping, calendar), duringCurrent);

    expect(status.status).toBe('conflict');
    expect(status.status === 'conflict' && status.issues.map((issue) => issue.code)).toContain('OVERLAP');
    expect(findOverlappingStays(projectStays(overlapping, calendar).stays)).toHaveLength(1);
  });

  it('never releases a guest while any calendar event is unusable', () => {
    const broken = [...stays, event({ uid: 'broken', start: 'nonsense', end: '2026-09-20' })];

    const status = selectStayStatus(projectStays(broken, calendar), duringCurrent);

    expect(status.status).toBe('conflict');
  });

  it('rejects an impossible calendar date instead of rolling it over', () => {
    const status = selectStayStatus(
      projectStays([event({ uid: 'rollover', start: '2026-02-30', end: '2026-03-02' })], calendar),
      duringCurrent,
    );

    expect(status.status).toBe('conflict');
    expect(status.status === 'conflict' && status.issues[0].code).toBe('INVALID_START');
  });
});

describe('hotel mode guest allowlist', () => {
  it('denies everything while hotel mode is absent or disabled', () => {
    const disabled = hotelPolicy();

    expect(guestVisibleEntityIds(undefined)).toEqual([]);
    expect(guestVisibleRoomIds(disabled)).toEqual([]);
    expect(evaluateGuestCommand(undefined, { entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'DISABLED' });
    expect(evaluateGuestCommand(disabled, { entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'DISABLED' });
  });

  it('projects only released rooms and entities', () => {
    const policy = enabledPolicy();

    expect(guestVisibleRoomIds(policy)).toEqual(['living', 'bath']);
    expect(guestVisibleEntityIds(policy)).toEqual(['climate.living', 'light.bath_mirror', 'light.living_ceiling']);
    expect(guestVisibleEntityIds(policy)).not.toContain('switch.utility_boiler');
  });

  it('allows a released action and denies an unreleased one on the same entity', () => {
    const policy = enabledPolicy();

    expect(evaluateGuestCommand(policy, { entityId: 'light.living_ceiling', action: 'turn_off' }))
      .toEqual({ allowed: true });
    expect(evaluateGuestCommand(policy, { entityId: 'light.bath_mirror', action: 'set_temperature', value: 21 }))
      .toEqual({ allowed: false, reason: 'ACTION_NOT_ALLOWED' });
  });

  it('denies an entity that was never released, however it is addressed', () => {
    const policy = enabledPolicy();

    expect(evaluateGuestCommand(policy, { entityId: 'switch.utility_boiler', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
    expect(evaluateGuestCommand(policy, { entityId: 'light.living_ceiling ', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
  });

  it('clamps guest temperatures to the configured range', () => {
    const policy = enabledPolicy();
    const temperature = (value: unknown) =>
      evaluateGuestCommand(policy, { entityId: 'climate.living', action: 'set_temperature', value });

    expect(temperature(18)).toEqual({ allowed: true });
    expect(temperature(24)).toEqual({ allowed: true });
    expect(temperature(17.9)).toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(temperature(30)).toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(temperature('21')).toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(temperature(undefined)).toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
  });

  it('accepts only the HVAC modes the Hauser climate control sends', () => {
    const policy = enabledPolicy();
    const mode = (value: unknown) =>
      evaluateGuestCommand(policy, { entityId: 'climate.living', action: 'set_hvac_mode', value });

    expect(mode('heat')).toEqual({ allowed: true });
    expect(mode('off')).toEqual({ allowed: true });
    expect(mode('dry')).toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
  });

  it('rejects a smuggled payload on a valueless action', () => {
    const policy = enabledPolicy();

    expect(evaluateGuestCommand(policy, { entityId: 'light.living_ceiling', action: 'turn_on', value: { brightness: 255 } }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
  });

  it('releases scenes and scripts only when they are listed explicitly', () => {
    const policy = enabledPolicy();

    expect(evaluateGuestCommand(policy, { entityId: 'scene.apartment_evening', action: 'turn_on' }))
      .toEqual({ allowed: true });
    expect(evaluateGuestCommand(policy, { entityId: 'scene.apartment_after_checkout', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
    expect(evaluateGuestCommand(policy, { entityId: 'script.anything', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
  });

  it('never widens the allowlist when a new Home Assistant entity appears in a released room', () => {
    const document = apartmentDocument();
    document.hotelMode.enabled = true;
    document.hotelMode.kioskAcknowledged = true;
    document.rooms[0].visibleEntities.push({
      id: 'floor_lamp',
      name: 'Floor lamp',
      entityId: 'light.living_floor',
      role: 'light',
    });
    const policy = parseValid(document).hotelMode;

    expect(guestVisibleEntityIds(policy)).not.toContain('light.living_floor');
    expect(evaluateGuestCommand(policy, { entityId: 'light.living_floor', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
  });

  it('derives the admin idle timeout from the policy and falls back to 15 minutes', () => {
    expect(adminIdleTimeoutMs(hotelPolicy((hotelMode) => { hotelMode.adminIdleTimeoutMinutes = 5; }))).toBe(300_000);
    expect(adminIdleTimeoutMs(undefined)).toBe(900_000);
  });
});

describe('resolveGuestServiceCall', () => {
  it('builds the service call from the entity id and the released action', () => {
    const policy = enabledPolicy();

    expect(resolveGuestServiceCall(policy, {
      entityId: 'light.living_ceiling', action: 'turn_on', data: { brightness_pct: 60 },
    })).toEqual({
      allowed: true,
      call: { domain: 'light', service: 'turn_on', entityId: 'light.living_ceiling', data: { brightness_pct: 60 } },
    });
    expect(resolveGuestServiceCall(policy, { entityId: 'climate.living', action: 'set_hvac_mode', data: { hvac_mode: 'heat' } }))
      .toEqual({
        allowed: true,
        call: { domain: 'climate', service: 'set_hvac_mode', entityId: 'climate.living', data: { hvac_mode: 'heat' } },
      });
  });

  it('drops every payload field the controls do not send', () => {
    const policy = enabledPolicy();

    for (const data of [{ transition: 5 }, { entity_id: 'lock.front_door' }, { brightness: 255 }]) {
      expect(resolveGuestServiceCall(policy, { entityId: 'light.living_ceiling', action: 'turn_on', data }))
        .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    }
    expect(resolveGuestServiceCall(policy, { entityId: 'light.living_ceiling', action: 'turn_off', data: { brightness_pct: 10 } }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
  });

  it('rejects out-of-range payload values', () => {
    const policy = enabledPolicy();

    expect(resolveGuestServiceCall(policy, { entityId: 'light.living_ceiling', action: 'turn_on', data: { brightness_pct: 101 } }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(resolveGuestServiceCall(policy, { entityId: 'light.living_ceiling', action: 'turn_on', data: { rgb_color: [10, 20] } }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(resolveGuestServiceCall(policy, { entityId: 'climate.living', action: 'set_temperature', data: { temperature: 30 } }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(resolveGuestServiceCall(policy, { entityId: 'climate.living', action: 'set_temperature' }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    expect(resolveGuestServiceCall(policy, { entityId: 'climate.living', action: 'set_hvac_mode', data: { hvac_mode: 'dry' } }))
      .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
  });

  it('rejects malformed entity ids, unknown actions and non-object payloads', () => {
    const policy = enabledPolicy();

    for (const entityId of ['', 'light', 'Light.Living', '../../etc', 42, null]) {
      expect(resolveGuestServiceCall(policy, { entityId, action: 'turn_on' }))
        .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
    }
    for (const action of ['call_service', 'reload', '', 7, undefined]) {
      expect(resolveGuestServiceCall(policy, { entityId: 'light.living_ceiling', action }))
        .toEqual({ allowed: false, reason: 'ACTION_NOT_ALLOWED' });
    }
    for (const data of ['{}', [], null, 3]) {
      expect(resolveGuestServiceCall(policy, { entityId: 'light.living_ceiling', action: 'turn_on', data }))
        .toEqual({ allowed: false, reason: 'VALUE_NOT_ALLOWED' });
    }
  });

  it('keeps scenes and scripts on their explicit release', () => {
    const policy = enabledPolicy();

    expect(resolveGuestServiceCall(policy, { entityId: 'scene.apartment_evening', action: 'turn_on' }))
      .toEqual({
        allowed: true,
        call: { domain: 'scene', service: 'turn_on', entityId: 'scene.apartment_evening', data: {} },
      });
    expect(resolveGuestServiceCall(policy, { entityId: 'script.open_gate', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'ENTITY_NOT_ALLOWED' });
  });

  it('stays closed without an active policy', () => {
    expect(resolveGuestServiceCall(undefined, { entityId: 'light.living_ceiling', action: 'turn_on' }))
      .toEqual({ allowed: false, reason: 'DISABLED' });
  });
});
