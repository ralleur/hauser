// SPDX-License-Identifier: AGPL-3.0-only
const MODE_KEY = 'hmi:recording-demo:v1';
let nativeStorage: Storage | null = null;

export let RECORDING_DEMO = false;
export let IS_DEMO = import.meta.env?.VITE_DEMO === '1';
export const RECORDING_HOME_COORDS = { latitude: 50.9367, longitude: 6.9470 };

export const demoSeeds: {
  energy?: typeof import('./demo-mode.ts').demoEnergySeed;
  todo?: typeof import('./demo-mode.ts').demoTodoSeed;
  people?: typeof import('./demo-mode.ts').DEMO_REMINDER_PERSONS;
} = {};

/** A recording gets its own storage, including caches and household settings. */
export function recordingStorage(source: Pick<Storage, 'getItem'> | null): Storage {
  const values = new Map<string, string>();
  for (const key of ['PARAGLIDE_LOCALE', 'hmi:ui-mode', 'hmi:appearance']) {
    const value = source?.getItem(key);
    if (value !== null && value !== undefined) values.set(key, value);
  }
  values.set('hmi:backend', 'fake');
  values.set('hmi:library', 'fake');
  values.set('hmi:calendar-selected', JSON.stringify(['calendar.mia', 'calendar.leo', 'calendar.emma']));
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}

export function initRecordingMode(): void {
  try {
    nativeStorage = window.localStorage;
    RECORDING_DEMO = nativeStorage.getItem(MODE_KEY) === 'on';
  } catch { return; }
  if (!RECORDING_DEMO) return;
  IS_DEMO = true;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: recordingStorage(nativeStorage) });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: recordingStorage(null) });
}

export function setRecordingDemo(on: boolean): void {
  if (on) nativeStorage?.setItem(MODE_KEY, 'on');
  else nativeStorage?.removeItem(MODE_KEY);
  location.reload();
}

export function reapplyDemoNames(rooms: Parameters<typeof import('./demo-names.ts').applyDemoNames>[0]): void {
  if (!IS_DEMO) return;
  void import('./demo-names.ts').then(({ applyDemoNames }) => applyDemoNames(rooms));
}
