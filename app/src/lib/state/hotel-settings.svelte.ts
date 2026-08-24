/* ── Hotel-Mode-Einstellungen in der Admin-GUI ──
   Lesen und Schreiben laufen über `/api/hotel-mode/settings` hinter der
   Adminsitzung; geschrieben wird mit dem Household-ETag über den vorhandenen
   atomaren Mutationspfad. Dieser Store hält nur den Serverstand — der
   Formentwurf lebt in der Komponente. */

import type { HotelModeConfig } from '../config/household-config.ts';
import { parseHotelActivationReport, type HotelActivationReport } from '../hotel-mode-activation.ts';

export const HOTEL_SETTINGS_ENDPOINT = '/api/hotel-mode/settings';
export const HOTEL_PIN_ENDPOINT = '/api/hotel-mode/pin';
export const HOTEL_OVERRIDE_ENDPOINT = '/api/hotel-mode/override';
export const HOTEL_STAY_ENDPOINT = '/api/hotel-mode/stay';
export const HOTEL_CHECKOUT_ENDPOINT = '/api/hotel-mode/checkout';
export const HOTEL_ACTIVATION_ENDPOINT = '/api/hotel-mode/activation';
const HOTEL_SETTINGS_TIMEOUT_MS = 6000;

export interface HotelSettingsState {
  loaded: boolean;
  etag: string | null;
  hotelMode: HotelModeConfig | null;
  /** Ob der Server überhaupt einen Aktivierungscheck anbietet. */
  activationReady: boolean;
  busy: boolean;
  error: string | null;
  stay: Record<string, unknown> | null;
  /** Ergebnis des Aktivierungschecks; `null`, solange er nicht lief. */
  activation: HotelActivationReport | null;
}

export const hotelSettings = $state<HotelSettingsState>({
  loaded: false,
  etag: null,
  hotelMode: null,
  activationReady: false,
  busy: false,
  error: null,
  stay: null,
  activation: null,
});

async function request(url: string, init: RequestInit = {}): Promise<{ status: number; payload: any }> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(HOTEL_SETTINGS_TIMEOUT_MS),
    ...init,
  });
  let payload: any = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, payload };
}

function fail(payload: any, fallback: string): false {
  hotelSettings.error = typeof payload?.message === 'string' ? payload.message : fallback;
  return false;
}

export async function loadHotelSettings(): Promise<void> {
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_SETTINGS_ENDPOINT);
    if (status !== 200) {
      fail(payload, 'Die Hotel-Mode-Einstellungen sind nicht verfügbar.');
      return;
    }
    hotelSettings.etag = typeof payload.etag === 'string' ? payload.etag : null;
    hotelSettings.hotelMode = (payload.hotelMode ?? null) as HotelModeConfig | null;
    hotelSettings.activationReady = payload.activationReady === true;
    hotelSettings.loaded = true;
    hotelSettings.error = null;
  } catch {
    hotelSettings.error = 'Die Hotel-Mode-Einstellungen sind nicht erreichbar.';
  } finally {
    hotelSettings.busy = false;
  }
}

export async function saveHotelMode(next: HotelModeConfig | null): Promise<boolean> {
  if (hotelSettings.etag === null) return fail(null, 'Bitte zuerst die Einstellungen laden.');
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_SETTINGS_ENDPOINT, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ etag: hotelSettings.etag, hotelMode: next }),
    });
    if (status !== 200) {
      // Ein fremder Schreibzugriff macht den ETag ungültig; neu laden statt raten.
      if (status === 412) await loadHotelSettings();
      return fail(payload, 'Die Einstellungen konnten nicht gespeichert werden.');
    }
    hotelSettings.etag = typeof payload.etag === 'string' ? payload.etag : null;
    hotelSettings.hotelMode = (payload.hotelMode ?? null) as HotelModeConfig | null;
    hotelSettings.activationReady = payload.activationReady === true;
    hotelSettings.error = null;
    return true;
  } catch {
    return fail(null, 'Die Einstellungen konnten nicht gespeichert werden.');
  } finally {
    hotelSettings.busy = false;
  }
}

/** Setzt oder ändert die Admin-PIN; ein Wechsel verlangt immer die bisherige. */
export async function setHotelPin(pin: string, currentPin: string | null): Promise<boolean> {
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_PIN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(currentPin === null ? { pin } : { pin, currentPin }),
    });
    if (status !== 200) return fail(payload, 'Die PIN konnte nicht gesetzt werden.');
    hotelSettings.error = null;
    return true;
  } catch {
    return fail(null, 'Die PIN konnte nicht gesetzt werden.');
  } finally {
    hotelSettings.busy = false;
  }
}

export async function loadHotelStay(): Promise<void> {
  try {
    const { status, payload } = await request(HOTEL_STAY_ENDPOINT);
    hotelSettings.stay = status === 200 ? payload : null;
  } catch {
    hotelSettings.stay = null;
  }
}

export async function setHotelOverride(startsAt: number | null, endsAt: number): Promise<boolean> {
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_OVERRIDE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startsAt === null ? { endsAt } : { startsAt, endsAt }),
    });
    if (status !== 200) return fail(payload, 'Der manuelle Aufenthalt ist ungültig.');
    hotelSettings.error = null;
    await loadHotelStay();
    return true;
  } catch {
    return fail(null, 'Der manuelle Aufenthalt konnte nicht gesetzt werden.');
  } finally {
    hotelSettings.busy = false;
  }
}

export async function clearHotelOverride(): Promise<boolean> {
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_OVERRIDE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    });
    if (status !== 200) return fail(payload, 'Der manuelle Aufenthalt konnte nicht beendet werden.');
    hotelSettings.error = null;
    await loadHotelStay();
    return true;
  } catch {
    return fail(null, 'Der manuelle Aufenthalt konnte nicht beendet werden.');
  } finally {
    hotelSettings.busy = false;
  }
}

/** Nur der Admin darf eine Checkout-Markierung zurücknehmen. */
export async function resetHotelCheckout(): Promise<boolean> {
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_CHECKOUT_ENDPOINT, { method: 'DELETE' });
    if (status !== 200) return fail(payload, 'Die Checkout-Markierung konnte nicht zurückgenommen werden.');
    hotelSettings.error = null;
    await loadHotelStay();
    return true;
  } catch {
    return fail(null, 'Die Checkout-Markierung konnte nicht zurückgenommen werden.');
  } finally {
    hotelSettings.busy = false;
  }
}

/** Der Aktivierungscheck prüft mit echten Abrufen und läuft deshalb nur auf Wunsch. */
export async function inspectHotelActivation(): Promise<void> {
  hotelSettings.busy = true;
  try {
    const { status, payload } = await request(HOTEL_ACTIVATION_ENDPOINT);
    hotelSettings.activation = status === 200 ? parseHotelActivationReport(payload) : null;
    if (status !== 200) fail(payload, 'Der Aktivierungscheck ist gerade nicht möglich.');
  } catch {
    hotelSettings.activation = null;
    fail(null, 'Der Aktivierungscheck ist gerade nicht möglich.');
  } finally {
    hotelSettings.busy = false;
  }
}
