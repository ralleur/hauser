import { describe, expect, it, vi } from 'vitest';
import type { HomeBridge } from '../native/bridge.ts';
import { PlatformBackend } from './platform-backend.ts';
import { LazyPlatformBackend } from './platform-backend-lazy.ts';

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
