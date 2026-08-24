import { describe, expect, it } from 'vitest';
// @ts-expect-error native Node smoke without @types/node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error native Node smoke without @types/node
import { tmpdir } from 'node:os';
// @ts-expect-error native Node smoke without @types/node
import { join } from 'node:path';
import { afterEach } from 'vitest';
import neutralApartment from '../../../../config/examples/neutral-apartment.json';
import { parseHouseholdConfig } from '../../config/household-config.ts';
// @ts-expect-error native .mjs runtime contract
import { createConfigMutationCoordinator, createHotelModeSettingsService } from '../../../../server.mjs';
import {
  draftFromHotelMode,
  draftToHotelMode,
  emptyHotelModeDraft,
  hotelActivationBlockers,
  hotelGuestPreview,
  validateHotelModeDraft,
} from './hotel-mode-settings.ts';

/* Die GUI darf nur Werte erzeugen, die der v4-Parser annimmt — und sie darf den
   Hotel Mode vor dem Aktivierungscheck nicht produktiv scharf schalten. */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function apartment(): any {
  return JSON.parse(JSON.stringify(neutralApartment));
}

function parsedHotelMode(document: unknown = apartment()) {
  const result = parseHouseholdConfig(document);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.hotelMode!;
}

function validDraft() {
  return draftFromHotelMode(parsedHotelMode());
}

describe('Entwurf der Betriebseinstellungen', () => {
  it('liest den vorhandenen Block vollständig zurück', () => {
    const draft = validDraft();

    expect(draft).toEqual({
      enabled: false,
      calendarEntityId: 'calendar.apartment_stays',
      timeZone: 'Europe/Berlin',
      allDayCheckIn: '15:00',
      allDayCheckOut: '11:00',
      useDescriptionAsWelcome: true,
      checkoutEnabled: true,
      checkoutSceneEntityId: 'scene.apartment_after_checkout',
      adminIdleTimeoutMinutes: 15,
      kioskAcknowledged: false,
    });
  });

  it('erzeugt aus einem gültigen Entwurf einen vom Parser angenommenen Block', () => {
    const document = apartment();
    document.hotelMode = draftToHotelMode(validDraft(), parsedHotelMode().guestAccess);

    expect(parseHouseholdConfig(document).ok).toBe(true);
  });

  it('meldet genau die Grenzen, die auch der Parser zieht', () => {
    const fields = (draft: any) => validateHotelModeDraft(draft).map((issue) => issue.field);

    expect(fields({ ...validDraft(), calendarEntityId: '' })).toContain('calendarEntityId');
    expect(fields({ ...validDraft(), calendarEntityId: 'light.living' })).toContain('calendarEntityId');
    expect(fields({ ...validDraft(), calendarEntityId: 'Calendar.Stays' })).toContain('calendarEntityId');
    expect(fields({ ...validDraft(), timeZone: 'Mars/Olympus' })).toContain('timeZone');
    expect(fields({ ...validDraft(), allDayCheckIn: '25:00' })).toContain('allDayCheckIn');
    expect(fields({ ...validDraft(), allDayCheckOut: '11' })).toContain('allDayCheckOut');
    expect(fields({ ...validDraft(), checkoutSceneEntityId: 'script.gate' })).toContain('checkoutSceneEntityId');
    expect(fields({ ...validDraft(), adminIdleTimeoutMinutes: 0 })).toContain('adminIdleTimeoutMinutes');
    expect(fields({ ...validDraft(), adminIdleTimeoutMinutes: 121 })).toContain('adminIdleTimeoutMinutes');
    expect(fields({ ...validDraft(), adminIdleTimeoutMinutes: 15.5 })).toContain('adminIdleTimeoutMinutes');
    // Ohne bestätigte Kioskcheckliste lehnt auch der Parser ein aktives Hotel ab.
    expect(fields({ ...validDraft(), enabled: true, kioskAcknowledged: false })).toContain('kioskAcknowledged');
    expect(validateHotelModeDraft(validDraft())).toEqual([]);
  });

  it('behandelt eine leere Checkout-Szene als „keine Szene"', () => {
    const config = draftToHotelMode({ ...validDraft(), checkoutSceneEntityId: '' }, { rooms: [], scenes: [], scripts: [] });

    expect(config.checkout.sceneEntityId).toBeNull();
    expect(validateHotelModeDraft({ ...validDraft(), checkoutSceneEntityId: '' })).toEqual([]);
  });

  it('startet ohne vorhandenen Block mit brauchbaren Vorgaben', () => {
    const draft = emptyHotelModeDraft();

    expect(draft.enabled).toBe(false);
    expect(draft.kioskAcknowledged).toBe(false);
    expect(draft.allDayCheckIn).toBe('15:00');
    expect(draft.allDayCheckOut).toBe('11:00');
    expect(validateHotelModeDraft(draft).map((issue) => issue.field)).toEqual(['calendarEntityId']);
  });
});

describe('Aktivierungshindernisse', () => {
  const access = parsedHotelMode().guestAccess;

  it('nennt jedes fehlende Stück einzeln', () => {
    expect(hotelActivationBlockers(emptyHotelModeDraft(), {
      pinConfigured: false, guestAccess: { rooms: [], scenes: [], scripts: [] }, preflightReady: true,
    })).toEqual(['DRAFT_INVALID', 'PIN_MISSING', 'KIOSK_UNCONFIRMED', 'NO_GUEST_ACCESS']);
  });

  it('bleibt bis zum Aktivierungscheck immer gesperrt', () => {
    expect(hotelActivationBlockers({ ...validDraft(), kioskAcknowledged: true }, {
      pinConfigured: true, guestAccess: access, preflightReady: false,
    })).toEqual(['PREFLIGHT_PENDING']);
  });

  it('ist mit Preflight und vollständigem Entwurf frei', () => {
    expect(hotelActivationBlockers({ ...validDraft(), kioskAcknowledged: true }, {
      pinConfigured: true, guestAccess: access, preflightReady: true,
    })).toEqual([]);
  });
});

describe('Gastvorschau', () => {
  it('zeigt die effektive Freigabe ohne leere Räume', () => {
    const preview = hotelGuestPreview({
      rooms: [
        { roomId: 'living', entities: [{ entityId: 'light.living_ceiling', actions: ['turn_on'], temperatureRange: null }] },
        { roomId: 'leer', entities: [] },
      ],
      scenes: ['scene.evening'],
      scripts: [],
    });

    expect(preview.rooms).toEqual([{ roomId: 'living', entityIds: ['light.living_ceiling'] }]);
    expect(preview.entityCount).toBe(1);
    expect(preview.scenes).toEqual(['scene.evening']);
  });
});

describe('Serverseitiges Speichern der Betriebseinstellungen', () => {
  /** `preflight: null` steht für „Aktivierungscheck steht nicht bereit". */
  function service({ preflightOk = null as boolean | null } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'hauser-hotel-settings-'));
    roots.push(root);
    const householdConfigPath = join(root, 'household.json');
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(householdConfigPath, `${JSON.stringify(apartment(), null, 2)}\n`);
    return createHotelModeSettingsService({
      householdConfigPath,
      configMutations: createConfigMutationCoordinator(),
      preflight: preflightOk === null ? null : {
        inspect: async () => ({
          ok: preflightOk,
          checks: [{ id: 'proxy', ok: preflightOk, code: preflightOk ? null : 'HOTEL_PROXY_UNAVAILABLE' }],
        }),
      },
    });
  }

  it('schreibt einen gültigen Block über den ETag-Pfad', async () => {
    const settings = service();
    const current = settings.read();
    expect(current.ok).toBe(true);

    const next = draftToHotelMode(
      { ...validDraft(), allDayCheckIn: '16:00', kioskAcknowledged: true },
      current.hotelMode.guestAccess,
    );
    const result = await settings.save({ etag: current.etag, hotelMode: next });

    expect(result.ok).toBe(true);
    expect(result.hotelMode.calendar.allDayCheckIn).toBe('16:00');
    expect(result.etag).not.toBe(current.etag);
    expect(settings.read().hotelMode.kioskAcknowledged).toBe(true);
  });

  it('lehnt einen veralteten ETag ab, statt fremde Änderungen zu überschreiben', async () => {
    const settings = service();
    const current = settings.read();
    const written = await settings.save({
      etag: current.etag,
      hotelMode: { ...current.hotelMode, adminIdleTimeoutMinutes: 20 },
    });
    expect(written.ok).toBe(true);

    const stale = await settings.save({ etag: current.etag, hotelMode: current.hotelMode });
    expect(stale).toMatchObject({ ok: false, status: 412, code: 'HOTEL_SETTINGS_STALE' });
  });

  it('verlangt überhaupt einen ETag', async () => {
    expect(await service().save({ hotelMode: null }))
      .toMatchObject({ ok: false, status: 428, code: 'HOTEL_SETTINGS_PRECONDITION_REQUIRED' });
  });

  it('speichert keinen Block, den der v4-Parser ablehnt', async () => {
    const settings = service();
    const current = settings.read();

    const rejected = await settings.save({
      etag: current.etag,
      hotelMode: { ...current.hotelMode, calendar: { ...current.hotelMode.calendar, timeZone: 'Mars/Olympus' } },
    });

    expect(rejected).toMatchObject({ ok: false, status: 422, code: 'HOTEL_SETTINGS_REJECTED' });
    expect(settings.read().hotelMode.calendar.timeZone).toBe('Europe/Berlin');
  });

  it('sperrt die produktive Aktivierung ohne Aktivierungscheck', async () => {
    const settings = service();
    const current = settings.read();

    const locked = await settings.save({
      etag: current.etag,
      hotelMode: { ...current.hotelMode, enabled: true, kioskAcknowledged: true },
    });

    expect(locked).toMatchObject({ ok: false, status: 409, code: 'HOTEL_ACTIVATION_LOCKED' });
    expect(settings.read().hotelMode.enabled).toBe(false);
  });

  it('lässt die Aktivierung zu, sobald der Preflight besteht', async () => {
    const settings = service({ preflightOk: true });
    const current = settings.read();

    const result = await settings.save({
      etag: current.etag,
      hotelMode: { ...current.hotelMode, enabled: true, kioskAcknowledged: true },
    });

    expect(result.ok).toBe(true);
    expect(result.hotelMode.enabled).toBe(true);
  });

  it('aktiviert nicht, solange der Preflight noch etwas beanstandet', async () => {
    const settings = service({ preflightOk: false });
    const current = settings.read();

    const blocked = await settings.save({
      etag: current.etag,
      hotelMode: { ...current.hotelMode, enabled: true, kioskAcknowledged: true },
    });

    expect(blocked).toMatchObject({ ok: false, status: 409, code: 'HOTEL_ACTIVATION_BLOCKED' });
    expect(blocked.checks).toEqual([{ id: 'proxy', ok: false, code: 'HOTEL_PROXY_UNAVAILABLE' }]);
    // Der bisherige Adminbetrieb bleibt unverändert erreichbar.
    expect(settings.read().hotelMode.enabled).toBe(false);
  });

  it('deaktiviert ohne Preflight und ohne Servercredentials anzufassen', async () => {
    const settings = service({ preflightOk: true });
    const current = settings.read();
    await settings.save({
      etag: current.etag,
      hotelMode: { ...current.hotelMode, enabled: true, kioskAcknowledged: true },
    });

    const off = settings.read();
    const result = await settings.save({ etag: off.etag, hotelMode: { ...off.hotelMode, enabled: false } });

    expect(result.ok).toBe(true);
    expect(result.hotelMode.enabled).toBe(false);
    // Die Gastfreigabe bleibt vollständig erhalten.
    expect(result.hotelMode.guestAccess).toEqual(current.hotelMode.guestAccess);
  });

  it('entfernt den Block, ohne die übrige Haushaltskonfiguration zu verlieren', async () => {
    const settings = service();
    const current = settings.read();

    const result = await settings.save({ etag: current.etag, hotelMode: null });

    expect(result.ok).toBe(true);
    expect(result.hotelMode).toBeNull();
    expect(settings.read().hotelMode).toBeNull();
  });
});
