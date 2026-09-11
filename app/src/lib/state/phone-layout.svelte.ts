/* ── Layout des Telefon-Home (Owner-Entscheidung 2026-09-11) ──
   Gerätelokal wie die Reihenfolge der unteren Leiste: das Telefon in der
   Tasche darf drei Räume je Zeile zeigen, während das Wandpanel bei seinem
   Raster bleibt. Zwei Werte: Räume pro Zeile (1–3, Vorgabe 2) und ob die
   Schnellaktionen (Aus, Klima, Urlaub) unter dem Raster stehen. */

const STORAGE_KEY = 'hmi:phone-layout:v1';

export const PHONE_ROOMS_PER_ROW: readonly number[] = [1, 2, 3];

export interface PhoneLayout {
  roomsPerRow: number;
  quickActions: boolean;
}

const DEFAULTS: PhoneLayout = { roomsPerRow: 2, quickActions: true };

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function parsePhoneLayout(raw: string | null): PhoneLayout {
  if (!raw) return { ...DEFAULTS };
  try {
    const obj = JSON.parse(raw) as Partial<PhoneLayout> | null;
    if (!obj || typeof obj !== 'object') return { ...DEFAULTS };
    return {
      roomsPerRow: PHONE_ROOMS_PER_ROW.includes(obj.roomsPerRow as number) ? (obj.roomsPerRow as number) : DEFAULTS.roomsPerRow,
      quickActions: typeof obj.quickActions === 'boolean' ? obj.quickActions : DEFAULTS.quickActions,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function load(): PhoneLayout {
  try { return parsePhoneLayout(storage()?.getItem(STORAGE_KEY) ?? null); } catch { return { ...DEFAULTS }; }
}

export const phoneLayout = $state<PhoneLayout>(load());

function save(): void {
  try {
    const isDefault = phoneLayout.roomsPerRow === DEFAULTS.roomsPerRow && phoneLayout.quickActions === DEFAULTS.quickActions;
    if (isDefault) storage()?.removeItem(STORAGE_KEY);
    else storage()?.setItem(STORAGE_KEY, JSON.stringify({ roomsPerRow: phoneLayout.roomsPerRow, quickActions: phoneLayout.quickActions }));
  } catch { /* ohne Speicher gilt die Einstellung bis zum Neuladen */ }
}

export function setPhoneRoomsPerRow(value: number): void {
  if (!PHONE_ROOMS_PER_ROW.includes(value)) return;
  phoneLayout.roomsPerRow = value;
  save();
}

export function setPhoneQuickActions(value: boolean): void {
  phoneLayout.quickActions = value;
  save();
}

export function resetPhoneLayout(): void {
  phoneLayout.roomsPerRow = DEFAULTS.roomsPerRow;
  phoneLayout.quickActions = DEFAULTS.quickActions;
  save();
}
