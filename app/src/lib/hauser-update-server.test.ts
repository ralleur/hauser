import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { createHauserUpdateWatch } from '../../server/hauser-update.mjs';

const state = (s: string, installed: string, latest: string, title = 'Hauser') => ({
  entity_id: 'update.hauser_update', state: s, attributes: { title, installed_version: installed, latest_version: latest },
});

function clientWith(answers: Record<string, { status: number; body: unknown } | Error>) {
  return () => ({
    rest: vi.fn(async (_method: string, path: string) => {
      const answer = answers[path];
      if (answer instanceof Error || !answer) throw answer ?? new Error('unbekannt');
      return answer;
    }),
    close: vi.fn(),
  });
}

describe('Update-Hinweis (P28)', () => {
  it('meldet eine neuere Fassung aus der Update-Entität', async () => {
    const watch = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: clientWith({
      '/api/states/update.hauser_update': { status: 200, body: state('on', '0.45.0', '0.48.0') },
    }) });
    expect(await watch.status()).toEqual({ available: true, installed: '0.45.0', latest: '0.48.0' });
  });

  it('meldet nichts, wenn die Fassung aktuell ist', async () => {
    const watch = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: clientWith({
      '/api/states/update.hauser_update': { status: 200, body: state('off', '0.48.0', '0.48.0') },
    }) });
    expect((await watch.status()).available).toBe(false);
  });

  it('findet ein anders benanntes Add-on über den Titel', async () => {
    const watch = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: clientWith({
      '/api/states/update.hauser_update': { status: 404, body: { message: 'Entity not found.' } },
      '/api/states': { status: 200, body: [{ entity_id: 'light.x', state: 'on', attributes: {} }, { ...state('on', '0.47.0', '0.48.0'), entity_id: 'update.hauser_beta_update' }] },
    }) });
    expect(await watch.status()).toMatchObject({ available: true, latest: '0.48.0' });
  });

  it('bleibt still, wenn Home Assistant nicht antwortet oder es kein Add-on ist', async () => {
    const broken = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: clientWith({
      '/api/states/update.hauser_update': new Error('weg'), '/api/states': new Error('weg'),
    }) });
    expect(await broken.status()).toEqual({ available: false });
    const docker = createHauserUpdateWatch({ connectionMode: 'direct', supervisorClientFactory: () => { throw new Error('nie gefragt'); } });
    expect(await docker.status()).toEqual({ available: false });
  });

  it('nimmt kaputte Attribute nicht als Update', async () => {
    const watch = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: clientWith({
      '/api/states/update.hauser_update': { status: 200, body: { entity_id: 'update.hauser_update', state: 'on', attributes: { latest_version: 48, installed_version: null } } },
    }) });
    expect((await watch.status()).available).toBe(false);
    const unavailable = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: clientWith({
      '/api/states/update.hauser_update': { status: 200, body: state('unavailable', '0.45.0', '0.48.0') },
    }) });
    expect((await unavailable.status()).available).toBe(false);
  });

  it('fragt Home Assistant höchstens alle 30 Minuten', async () => {
    let time = 0;
    const factory = vi.fn(clientWith({ '/api/states/update.hauser_update': { status: 200, body: state('on', '0.45.0', '0.48.0') } }));
    const watch = createHauserUpdateWatch({ connectionMode: 'supervisor', supervisorClientFactory: factory, now: () => time });
    await watch.status(); time += 10 * 60_000; await watch.status();
    expect(factory).toHaveBeenCalledTimes(1);
    time += 25 * 60_000; await watch.status();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
