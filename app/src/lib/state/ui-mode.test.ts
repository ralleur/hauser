import { describe, expect, it, vi } from 'vitest';
import {
  UI_MODE_QUERY,
  UI_MODE_STORAGE_KEY,
  createLatestShellLoader,
  createUiModeController,
  destroyUiMode,
  initUiMode,
  readUiModePreference,
  resolveUiMode,
  setUiModePreference,
  uiMode,
  writeUiModePreference,
} from './ui-mode.svelte.ts';

function media(matches = false) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  return {
    query: UI_MODE_QUERY,
    matches,
    addEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener)),
    change(next: boolean) { this.matches = next; for (const listener of listeners) listener({ matches: next }); },
    listeners,
  };
}

function storage(value: string | null = null) {
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
}

describe('UI mode contract', () => {
  it.each([
    ['auto', true, 'phone'], ['auto', false, 'panel'],
    ['phone', false, 'phone'], ['panel', true, 'panel'],
  ] as const)('resolves %s / narrow=%s to %s', (preference, narrow, expected) => {
    expect(resolveUiMode(preference, narrow)).toBe(expected);
  });

  it('uses the portrait boundary and keeps a typical landscape phone in phone mode', () => {
    expect(UI_MODE_QUERY).toBe('(max-width: 767px), (max-width: 950px) and (max-height: 500px)');
    expect(resolveUiMode('auto', 767 <= 767)).toBe('phone');
    expect(resolveUiMode('auto', 768 <= 767)).toBe('panel');
  });

  it.each([null, '', 'PHONE', 'mobile', '768'])('falls back to auto for storage value %j', (value) => {
    expect(readUiModePreference(storage(value))).toBe('auto');
  });

  it('fails safe on storage read/write errors and uses the exact key', () => {
    const broken = { getItem: vi.fn(() => { throw new Error('denied'); }), setItem: vi.fn(() => { throw new Error('denied'); }), removeItem: vi.fn(() => { throw new Error('denied'); }) };
    expect(readUiModePreference(broken)).toBe('auto');
    expect(() => writeUiModePreference('phone', broken)).not.toThrow();
    expect(broken.setItem).toHaveBeenCalledWith(UI_MODE_STORAGE_KEY, 'phone');
    expect(() => writeUiModePreference('auto', broken)).not.toThrow();
    expect(broken.removeItem).toHaveBeenCalledWith('hmi:ui-mode');
  });

  it('fails safe when the window.localStorage getter itself throws', () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const narrow = media(true);
    const fakeWindow = { matchMedia: vi.fn(() => narrow) } as unknown as Window;
    Object.defineProperty(fakeWindow, 'localStorage', {
      configurable: true,
      get() {
        const error = new Error('denied');
        error.name = 'SecurityError';
        throw error;
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    });

    try {
      destroyUiMode();
      expect(() => initUiMode()).not.toThrow();
      expect(uiMode.preference).toBe('auto');
      expect(uiMode.effective).toBe('phone');

      destroyUiMode();
      expect(() => setUiModePreference('auto')).not.toThrow();
      expect(uiMode.preference).toBe('auto');
      expect(uiMode.effective).toBe('phone');
    } finally {
      destroyUiMode();
      if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('observes matchMedia once, reacts, honors overrides and cleans up', () => {
    const mql = media(false);
    const saved = storage(null);
    const controller = createUiModeController({ matchMedia: vi.fn(() => mql), storage: saved });
    const changes: string[] = [];
    const stop = controller.subscribe((mode) => changes.push(mode));
    const stopAgain = controller.subscribe(() => undefined);
    expect(mql.addEventListener).toHaveBeenCalledTimes(1);
    expect(controller.effective).toBe('panel');
    mql.change(true);
    expect(controller.effective).toBe('phone');
    controller.setPreference('panel');
    expect(controller.effective).toBe('panel');
    stopAgain(); stop(); controller.destroy();
    expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    expect(changes).toEqual(['panel', 'phone', 'panel']);
  });

  it('discards a stale literal shell load result', async () => {
    let resolvePhone!: (value: string) => void;
    const phone = new Promise<string>((resolve) => { resolvePhone = resolve; });
    const accepted: string[] = [];
    const loader = createLatestShellLoader({ phone: () => phone, panel: async () => 'panel' });
    const oldLoad = loader.load('phone', (value) => accepted.push(value));
    await loader.load('panel', (value) => accepted.push(value));
    resolvePhone('phone');
    await oldLoad;
    expect(accepted).toEqual(['panel']);
  });
});
