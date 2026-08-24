/* ── Credential-Cutover auf dem Gasttablett ──
   Der Home-Assistant-Vollzugriffstoken bleibt serverseitig (Plan §7). Sobald
   ein Panel eine Gastoberfläche zeigt, dürfen die lokalen Reste eines früheren
   Adminbetriebs dort nicht liegen bleiben: Zugangsdaten und persönliche
   Zwischenspeicher werden gezielt entfernt.

   Wichtig: gelöscht wird ausschließlich lokal. Der Weg über `sharedStorage`
   würde ein Outbox-Ereignis schreiben und den Wert damit auch zentral in
   `/data/config.json` löschen — genau das darf ein Wechsel in den Gastzustand
   nicht tun, sonst wäre der Admin nach dem Deaktivieren ausgesperrt. */

import type { HotelSurface } from './hotel-mode-bootstrap.ts';

/** Zugangsdaten zu Home Assistant, Jellyfin und dem AI-Zugang. */
export const HOTEL_SENSITIVE_CREDENTIAL_KEYS = [
  'hmi:ha-token',
  'hmi:jf-token',
  'hmi:jf-user',
  'hmi:ai-hermes-key',
  'hmi:ai-hermes-url',
] as const;

/** Zwischenspeicher mit Haushaltsdaten, die einen Gast nichts angehen. */
export const HOTEL_SENSITIVE_CACHE_KEYS = [
  'hmi:ha-cache',
  'hmi:calendar-familie-cache',
  'hmi:reminders-cache',
  'hmi:shopping-cache',
  'hmi:shopping-done-log.v1',
  'hmi:notifications:v1',
  'hmi:notifications:v2',
  'hmi:ai-session',
  'hmi:ai-draft',
  'hmi:ai-active-run',
] as const;

export const HOTEL_SENSITIVE_LOCAL_KEYS: readonly string[] = [
  ...HOTEL_SENSITIVE_CREDENTIAL_KEYS,
  ...HOTEL_SENSITIVE_CACHE_KEYS,
];

export type LocalStorageLike = Pick<Storage, 'getItem' | 'removeItem'>;

/** Nur Gastoberflächen werden bereinigt; der Adminbetrieb bleibt unverändert. */
export function hotelSurfaceNeedsPurge(surface: HotelSurface): boolean {
  return surface === 'inactive' || surface === 'active';
}

/**
 * Entfernt die sensiblen lokalen Werte und meldet, was wirklich entfernt wurde.
 * Ein fehlender oder gesperrter Speicher ist kein Fehler — der Server bleibt
 * die eigentliche Grenze.
 */
export function purgeHotelSensitiveValues(storage: LocalStorageLike | null): string[] {
  if (!storage) return [];
  const removed: string[] = [];
  for (const key of HOTEL_SENSITIVE_LOCAL_KEYS) {
    try {
      if (storage.getItem(key) === null) continue;
      storage.removeItem(key);
      removed.push(key);
    } catch {
      // Ein blockierter Speicher ändert die Serverentscheidung nicht.
    }
  }
  return removed;
}

export interface HotelActivationCheck {
  id: string;
  ok: boolean;
  code: string | null;
}

export interface HotelActivationReport {
  ok: boolean;
  checks: HotelActivationCheck[];
}

/** Fail-closed: was nicht als vollständiger Bericht lesbar ist, gilt als offen. */
export function parseHotelActivationReport(payload: unknown): HotelActivationReport {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, checks: [] };
  const document = payload as Record<string, unknown>;
  const checks = Array.isArray(document.checks)
    ? document.checks.flatMap((raw): HotelActivationCheck[] => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const check = raw as Record<string, unknown>;
      if (typeof check.id !== 'string') return [];
      return [{
        id: check.id,
        ok: check.ok === true,
        code: typeof check.code === 'string' ? check.code : null,
      }];
    })
    : [];
  return { ok: document.ok === true && checks.length > 0 && checks.every((check) => check.ok), checks };
}
