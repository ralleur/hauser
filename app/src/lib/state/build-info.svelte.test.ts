import { afterEach, describe, expect, it, vi } from 'vitest';

/* Der Anzeigezustand hängt an einem einzigen Abruf von `/api/build-info`. Die
   Zusammenführung selbst ist in config/build-info.test.ts geprüft; hier geht es
   nur darum, dass ein Deployment die Werte überhaupt überschreiben kann und ein
   fehlender Server nichts kaputt macht. */

const SHA = 'd'.repeat(40);

async function freshBuildInfo() {
  vi.resetModules();
  return await import('./build-info.svelte.ts');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadBuildInfo', () => {
  it('takes the served license, revision and source url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '9.9.9',
        revision: SHA,
        license: 'AGPL-3.0-or-later',
        sourceUrl: 'https://fork.example/tree/head',
      }),
    })));
    const { buildInfo, loadBuildInfo } = await freshBuildInfo();
    await loadBuildInfo();
    expect(buildInfo.version).toBe('9.9.9');
    expect(buildInfo.revision).toBe(SHA);
    expect(buildInfo.sourceUrl).toBe('https://fork.example/tree/head');
  });

  it('keeps the license and claims no source url when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { buildInfo, loadBuildInfo } = await freshBuildInfo();
    await loadBuildInfo();
    expect(buildInfo.license).toBe('AGPL-3.0-or-later');
    expect(buildInfo.sourceUrl === null || buildInfo.sourceUrl.startsWith('http')).toBe(true);
  });

  it('ignores a payload that does not declare this project license', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '9.9.9', revision: SHA, license: 'MIT', sourceUrl: 'https://evil.example/x' }),
    })));
    const { buildInfo, loadBuildInfo } = await freshBuildInfo();
    await loadBuildInfo();
    expect(buildInfo.version).not.toBe('9.9.9');
    expect(buildInfo.sourceUrl).not.toBe('https://evil.example/x');
  });
});
