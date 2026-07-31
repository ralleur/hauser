import { describe, expect, it, vi } from 'vitest';
import {
  MAX_MINIMAL_CACHE_ENTRIES,
  MAX_MINIMAL_CACHE_LENGTH,
  hydrateMinimalShellCache,
  publishMinimalShellConfigStatus,
  readMinimalShellCache,
} from './minimal-shell-cache.ts';

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: vi.fn(() => value) };
}

function statusRoot() {
  const header = { textContent: '', setAttribute: vi.fn() };
  const title = { textContent: '' };
  const summary = { textContent: '' };
  const details = { textContent: '' };
  const view = {
    querySelector: vi.fn((selector: string) => selector === 'h1' ? title : selector === 'span' ? summary : details),
  };
  const shell = {
    dataset: { view: 'system' },
    querySelector: vi.fn((selector: string) => selector === '.minimal-shell__status' ? header : view),
    addEventListener: vi.fn(),
  };
  const root = {
    querySelector: vi.fn(() => shell),
  } as unknown as Pick<Document, 'querySelector'>;
  return { root, shell, header, title, summary, details };
}

function cacheRoot(viewId = 'home') {
  const summary = { textContent: '' };
  const details = { textContent: '' };
  const view = {
    querySelector: vi.fn((selector: string) => selector === 'span' ? summary : details),
  };
  const shell = {
    dataset: { view: viewId },
    querySelector: vi.fn(() => view),
    addEventListener: vi.fn(),
  };
  const root = {
    querySelector: vi.fn(() => shell),
  } as unknown as Pick<Document, 'querySelector'>;
  return { root, shell, summary, details };
}

describe('minimal shell local HA cache reader', () => {
  it('aggregates devices and active lights without exposing entity IDs', () => {
    const result = readMinimalShellCache(storageWith(JSON.stringify({
      'light.private_office': { on: true, brightness: 42 },
      'light.private_bedroom': { on: false },
      'switch.private_door': { on: true },
      'climate.private_room': { target: 21, hvac: 'heat', current: 20.5 },
      'sensor.private_power': { value: 310, unit: 'W' },
    })));

    expect(result).toEqual({ deviceCount: 5, lightsOn: 1 });
    expect(JSON.stringify(result)).not.toMatch(/private|light\.|switch\.|climate\.|sensor\./);
  });

  it.each([
    ['absent', null],
    ['malformed', '{nope'],
    ['array', '[]'],
    ['scalar', '42'],
    ['prototype key', '{"__proto__":{"on":true}}'],
    ['constructor key', '{"constructor":{"on":true}}'],
  ])('returns null for %s cache data', (_case, value) => {
    expect(readMinimalShellCache(storageWith(value))).toBeNull();
  });

  it('rejects oversized input before parsing', () => {
    const oversized = `{"padding":"${'x'.repeat(MAX_MINIMAL_CACHE_LENGTH)}"}`;
    expect(readMinimalShellCache(storageWith(oversized))).toBeNull();
  });

  it('rejects records above the bounded entry count', () => {
    const entries = Array.from(
      { length: MAX_MINIMAL_CACHE_ENTRIES + 1 },
      (_, index) => [`sensor.safe_${index}`, { value: index, unit: null }],
    );
    expect(readMinimalShellCache(storageWith(JSON.stringify(Object.fromEntries(entries))))).toBeNull();
  });

  it('fails closed when storage access throws', () => {
    const storage: Pick<Storage, 'getItem'> = {
      getItem: vi.fn(() => { throw new Error('denied'); }),
    };
    expect(readMinimalShellCache(storage)).toBeNull();
  });

  it('hydrates bounded aggregate copy only into the local Home view', () => {
    const dom = cacheRoot();
    const storage = storageWith(JSON.stringify({
      'light.safe_one': { on: true },
      'switch.safe_two': { on: false },
    }));

    hydrateMinimalShellCache(storage, dom.root);

    expect(dom.summary.textContent).toBe('2 Geräte im letzten Stand · 1 Lichter an');
    expect(dom.details.textContent).toBe('Letzter lokaler Stand · Daten können veraltet sein');
    expect(dom.shell.addEventListener).toHaveBeenCalledOnce();
  });
});

describe('minimal shell config status seam', () => {
  it.each([
    ['HOUSEHOLD_CONFIG_INVALID_JSON', 'HOUSEHOLD_CONFIG_INVALID', 'Konfiguration ungültig'],
    ['HOUSEHOLD_CONFIG_NOT_READABLE', 'HOUSEHOLD_CONFIG_UNAVAILABLE', 'Konfiguration nicht verfügbar'],
    ['HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION', 'HOUSEHOLD_CONFIG_UNSUPPORTED', 'Konfiguration nicht unterstützt'],
    ['HOUSEHOLD_CONFIG_VALIDATION_FAILED', 'HOUSEHOLD_CONFIG_VALIDATION_FAILED', 'Konfiguration konnte nicht geprüft werden'],
  ])('maps %s to controlled local status %s', (input, code, title) => {
    const dom = statusRoot();

    const status = publishMinimalShellConfigStatus(input, dom.root);

    expect(status).toMatchObject({ code, title });
    expect(status.message).toMatch(/Lokal|lokale/);
    expect(dom.header.textContent).toBe(title);
    expect(dom.header.setAttribute).toHaveBeenCalledWith('role', 'alert');
    expect(dom.title.textContent).toBe(title);
    expect(dom.summary.textContent).toBe(status.message);
    expect(dom.details.textContent).toContain(code);
  });

  it('never exposes malformed codes or raw errors', () => {
    const secret = 'token=very-secret\nError: /private/config.json';
    const dom = statusRoot();
    const status = publishMinimalShellConfigStatus(secret, dom.root);

    expect(status).toEqual({
      code: 'HOUSEHOLD_CONFIG_UNAVAILABLE',
      title: 'Konfiguration nicht verfügbar',
      message: 'Die lokale Oberfläche bleibt bedienbar. Live-Daten und Geräteaktionen sind nicht verfügbar.',
    });
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(JSON.stringify(status)).not.toMatch(/very-secret|private\/config/);
    expect(`${dom.summary.textContent}${dom.details.textContent}`).not.toMatch(/very-secret|private\/config/);
  });
});
