const CACHE_KEY = 'hmi:ha-cache';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_MINIMAL_CACHE_LENGTH = 1024 * 1024;
export const MAX_MINIMAL_CACHE_ENTRIES = 2048;

export interface MinimalShellCacheSnapshot {
  deviceCount: number;
  lightsOn: number;
}

export interface MinimalShellConfigStatus {
  code: 'HOUSEHOLD_CONFIG_INVALID' | 'HOUSEHOLD_CONFIG_UNSUPPORTED' | 'HOUSEHOLD_CONFIG_UNAVAILABLE' | 'HOUSEHOLD_CONFIG_VALIDATION_FAILED';
  title: string;
  message: string;
}

const INVALID_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_INVALID',
  title: 'Konfiguration ungültig',
  message: 'Die lokale Oberfläche bleibt bedienbar. Eine gültige Konfiguration ist erforderlich.',
};
const UNSUPPORTED_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_UNSUPPORTED',
  title: 'Konfiguration nicht unterstützt',
  message: 'Die lokale Oberfläche bleibt bedienbar. Live-Daten und Geräteaktionen sind nicht verfügbar.',
};
const UNAVAILABLE_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_UNAVAILABLE',
  title: 'Konfiguration nicht verfügbar',
  message: 'Die lokale Oberfläche bleibt bedienbar. Live-Daten und Geräteaktionen sind nicht verfügbar.',
};
const VALIDATION_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_VALIDATION_FAILED',
  title: 'Konfiguration konnte nicht geprüft werden',
  message: 'Die lokale Oberfläche bleibt bedienbar. Die sichere Prüfung muss erneut ausgeführt werden.',
};

function renderAfterNavigation(shell: HTMLElement, render: () => void): void {
  render();
  shell.addEventListener('click', () => queueMicrotask(render), { passive: true });
}

export function publishMinimalShellConfigStatus(
  code: unknown,
  root: Pick<Document, 'querySelector'> | null = typeof document === 'undefined' ? null : document,
): MinimalShellConfigStatus {
  const status = code === 'HOUSEHOLD_CONFIG_INVALID' || code === 'HOUSEHOLD_CONFIG_INVALID_JSON'
    ? INVALID_STATUS
    : typeof code === 'string' && [
      'HOUSEHOLD_CONFIG_AMBIGUOUS_ROOM_ROLE',
      'HOUSEHOLD_CONFIG_MEDIA_TARGET_REQUIRED',
      'HOUSEHOLD_CONFIG_HOME_MODULE_REQUIRED',
      'HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION',
      'HOUSEHOLD_CONFIG_DUPLICATE_NAVIGATION_TARGET',
      'HOUSEHOLD_CONFIG_HOME_NAVIGATION_REQUIRED',
      'HOUSEHOLD_CONFIG_SONG_TARGETS_MISSING',
      'HOUSEHOLD_CONFIG_PROJECTION_FAILED',
    ].includes(code)
      ? UNSUPPORTED_STATUS
      : code === 'HOUSEHOLD_CONFIG_VALIDATION_FAILED' || code === 'HOUSEHOLD_CONFIG_VALIDATION_SCHEDULING_FAILED'
        ? VALIDATION_STATUS
        : UNAVAILABLE_STATUS;
  const shell = root?.querySelector<HTMLElement>('[data-shell="minimal"]');
  const header = shell?.querySelector<HTMLElement>('.minimal-shell__status');
  if (header) {
    header.textContent = status.title;
    header.setAttribute('role', 'alert');
  }
  const renderSystemStatus = () => {
    if (shell?.dataset.view !== 'system') return;
    const view = shell.querySelector<HTMLElement>('.minimal-shell__intro');
    const title = view?.querySelector<HTMLElement>('h1');
    const summary = view?.querySelector<HTMLElement>('span');
    const details = view?.querySelector<HTMLElement>('p');
    if (title) title.textContent = status.title;
    if (summary) summary.textContent = status.message;
    if (details) details.textContent = `${status.code} · Lokale Navigation verfügbar`;
  };
  if (shell) renderAfterNavigation(shell, renderSystemStatus);
  return status;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeMappedValue(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const fields = Object.entries(value);
  if (fields.length > 32) return false;
  return fields.every(([key, field]) => (
    !FORBIDDEN_KEYS.has(key)
    && (field === null
      || typeof field === 'string'
      || typeof field === 'boolean'
      || (typeof field === 'number' && Number.isFinite(field)))
  ));
}

/** Reads only a bounded, privacy-poor aggregate; entity IDs never leave this module. */
export function readMinimalShellCache(
  storage?: Pick<Storage, 'getItem'> | null,
): MinimalShellCacheSnapshot | null {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    const raw = source?.getItem(CACHE_KEY);
    if (!raw || raw.length > MAX_MINIMAL_CACHE_LENGTH) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return null;
    const entries = Object.entries(parsed);
    if (entries.length === 0 || entries.length > MAX_MINIMAL_CACHE_ENTRIES) return null;

    let lightsOn = 0;
    for (const [entityId, value] of entries) {
      if (
        entityId.length > 255
        || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId)
        || !isSafeMappedValue(value)
      ) return null;
      if (entityId.startsWith('light.') && value.on === true) lightsOn += 1;
    }
    return { deviceCount: entries.length, lightsOn };
  } catch {
    return null;
  }
}

export function hydrateMinimalShellCache(
  storage?: Pick<Storage, 'getItem'> | null,
  root: Pick<Document, 'querySelector'> | null = typeof document === 'undefined' ? null : document,
): void {
  const snapshot = readMinimalShellCache(storage);
  const shell = root?.querySelector<HTMLElement>('[data-shell="minimal"]');
  if (!snapshot || !shell) return;
  const render = () => {
    if (shell.dataset.view !== 'home') return;
    const view = shell.querySelector<HTMLElement>('.minimal-shell__intro');
    const summary = view?.querySelector<HTMLElement>('span');
    const details = view?.querySelector<HTMLElement>('p');
    if (summary) summary.textContent = `${snapshot.deviceCount} Geräte im letzten Stand · ${snapshot.lightsOn} Lichter an`;
    if (details) details.textContent = 'Letzter lokaler Stand · Daten können veraltet sein';
  };
  renderAfterNavigation(shell, render);
}
