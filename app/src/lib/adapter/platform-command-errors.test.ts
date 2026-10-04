import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomeBridge } from '../native/bridge.ts';
import { PlatformBackend } from './platform-backend.ts';
import { LazyPlatformBackend } from './platform-backend-lazy.ts';

afterEach(() => vi.useRealTimers());

async function dimmingHarness(firstWriteDelay = 0) {
  const writes: Array<[string, unknown]> = [];
  let emit: (id: string, value: unknown) => void = () => {};
  const home: HomeBridge = {
    snapshot: async () => ({ authorized: true, homes: [{
      id: 'home', name: 'Test', primary: true, rooms: [], accessories: [{
        id: 'lamp', name: 'Lamp', roomId: null, reachable: true, category: 'lightbulb',
        services: [{ id: 'S1', type: 'lightbulb', name: 'Lamp', characteristics: [
          { id: 'power', type: 'power', value: true, writable: true },
          { id: 'brightness', type: 'brightness', value: 20, writable: true },
        ] }],
      }],
    }] }),
    write: async (id, value) => {
      writes.push([id, value]);
      if (writes.length === 1 && firstWriteDelay > 0) await new Promise((resolve) => setTimeout(resolve, firstWriteDelay));
      emit(id, value);
    },
    onChange: (cb) => { emit = cb; return () => {}; },
  };
  const backend = new PlatformBackend(home);
  const updates = vi.fn();
  const connected = new Promise<void>((resolve) => backend.onConnectionChange((status) => {
    if (status === 'connected') resolve();
  }));
  backend.subscribe(updates);
  backend.start();
  await connected;
  updates.mockClear();
  return { backend, writes, updates };
}

describe('Apple-Home-Dimmen über die Web-Bridge', () => {
  it('sendet Zwischenwerte, hält das UI-Ziel ruhig und erreicht beide Helligkeitsrichtungen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { backend, writes, updates } = await dimmingHarness();
    for (const target of [80, 20]) {
      writes.length = 0;
      updates.mockClear();
      backend.callService('light', 'turn_on', 'light.hk_s1', { brightness_pct: target });
      await vi.advanceTimersByTimeAsync(0);
      expect(writes[0][0]).toBe('brightness');
      expect(writes[0][1]).not.toBe(target);
      expect(updates).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(450);
      const levels = writes.filter(([id]) => id === 'brightness').map(([, value]) => Number(value));
      expect(levels.length).toBeGreaterThan(1);
      expect(levels.at(-1)).toBe(target);
      expect(levels.slice(1).every((level, index) => target === 80 ? level > levels[index] : level < levels[index])).toBe(true);
      expect(updates).toHaveBeenCalledExactlyOnceWith('light.hk_s1', expect.objectContaining({ brightness: target }));
      expect(writes).not.toContainEqual(['power', true]);
    }
  });

  it('überspringt bei verspäteter HomeKit-Antwort keine Stufen und läuft sanft aus', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const sequences: number[][] = [];
    for (const delay of [0, 120]) {
      const { backend, writes } = await dimmingHarness(delay);
      backend.callService('light', 'turn_on', 'light.hk_s1', { brightness_pct: 80 });
      await vi.advanceTimersByTimeAsync(1000);
      sequences.push(writes.filter(([id]) => id === 'brightness').map(([, value]) => Number(value)));
    }
    expect(sequences[1]).toEqual(sequences[0]);
    const levels = [20, ...sequences[0]];
    const jumps = levels.slice(1).map((level, index) => level - levels[index]);
    expect(levels.at(-1)).toBe(80);
    expect(jumps[0]).toBeLessThan(Math.max(...jumps));
    expect(jumps.at(-1)).toBeLessThan(Math.max(...jumps));
  });

  it('ersetzt laufendes Dimmen sofort durch Aus ohne spätes Wiedereinschalten', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { backend, writes } = await dimmingHarness();
    backend.callService('light', 'turn_on', 'light.hk_s1', { brightness_pct: 80 });
    await vi.advanceTimersByTimeAsync(60);
    backend.callService('light', 'turn_off', 'light.hk_s1', {});
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.at(-1)).toEqual(['power', false]);
    const count = writes.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toHaveLength(count);
    expect(writes).not.toContainEqual(['brightness', 80]);
    expect(writes).not.toContainEqual(['power', true]);
  });
});

describe.each([PlatformBackend, LazyPlatformBackend])('%s: Befehlsfehler aus der nativen Bridge', (BackendClass) => {
  it('reicht die ID des fehlgeschlagenen Befehls unverändert zurück', async () => {
    const home: HomeBridge = {
      snapshot: async () => ({ authorized: true, homes: [{
        id: 'home', name: 'Test', primary: true, rooms: [], accessories: [{
          id: 'lamp', name: 'Lamp', roomId: null, reachable: true, category: 'lightbulb',
          services: [{ id: 'S1', type: 'lightbulb', name: 'Lamp', characteristics: [
            { id: 'power', type: 'power', value: false, writable: true },
          ] }],
        }],
      }] }),
      write: vi.fn(async () => { throw new Error('Rejected'); }),
      onChange: () => () => {},
    };
    const backend = new BackendClass(home);
    const failed = vi.fn();
    const connected = new Promise<void>((resolve) => backend.onConnectionChange((status) => {
      if (status === 'connected') resolve();
    }));
    backend.onCommandError(failed);
    backend.start();
    await connected;
    backend.callService('light', 'turn_on', 'light.hk_s1', {}, 42);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith('light.hk_s1', 42));
    expect(home.write).toHaveBeenCalledWith('power', true);
  });
});
