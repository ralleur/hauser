import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { dirname, join } from 'node:path';
// @ts-expect-error Native Node test without @types/node.
import { fileURLToPath } from 'node:url';
// @ts-expect-error Native Node ESM server contract.
import { API_ROUTES, UPSTREAM_API_PATHS, literalCoveredByContract, matchApiRoute, routePattern } from '../../../server/api-contract.mjs';
// @ts-expect-error Native Node ESM generator.
import { GENERATED_PATH, renderContract } from '../../../scripts/generate-api-contract.mjs';
import { API_ROUTES as GENERATED_ROUTES } from './contract.generated.ts';
import { apiPath } from './client.ts';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'paraglide') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function apiLiterals(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/['"`](\/api\/[A-Za-z0-9/_.-]*)/g)) found.add(match[1]);
  return [...found];
}

const serverSources = [
  join(appRoot, 'server.mjs'),
  ...readdirSync(join(appRoot, 'server'))
    .filter((entry: string) => entry.endsWith('.mjs') && entry !== 'api-contract.mjs')
    .map((entry: string) => join(appRoot, 'server', entry)),
];

const clientSources = walk(join(appRoot, 'src', 'lib'))
  .filter((file: string) => (file.endsWith('.ts') || file.endsWith('.svelte')) && !file.includes('.test.'))
  .filter((file: string) => !file.endsWith('contract.generated.ts'));

describe('API-Vertrag', () => {
  it('hat eindeutige Kennungen und Pfade', () => {
    const ids = API_ROUTES.map((route: { id: string }) => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = API_ROUTES.map((route: { methods: string[]; path: string }) => `${route.methods.join(',')} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('deckt jedes /api-Literal im Serverquelltext ab', () => {
    const uncovered: string[] = [];
    for (const file of serverSources) {
      for (const literal of apiLiterals(readFileSync(file, 'utf8'))) {
        if (literal === '/api/' || literal === '/api') continue;
        if (!literalCoveredByContract(literal)) uncovered.push(`${file.split('/').slice(-2).join('/')}: ${literal}`);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it('deckt jedes /api-Literal in der Oberfläche ab', () => {
    const uncovered: string[] = [];
    for (const file of clientSources) {
      const source = readFileSync(file, 'utf8');
      for (const literal of apiLiterals(source)) {
        if (literal === '/api/' || literal === '/api') continue;
        /* Aufrufe an fremde Dienste (Hermes, Home Assistant direkt) tragen ihre
           Basis-URL voran und stehen deshalb nicht als `'/api/...'`-Literal. */
        if (!literalCoveredByContract(literal)) uncovered.push(`${file.split('/').slice(-2).join('/')}: ${literal}`);
      }
    }
    expect(uncovered).toEqual([]);
  });

  it('kennt nur Fremdpfade, die im Serverquelltext vorkommen', () => {
    const serverText = serverSources.map((file: string) => readFileSync(file, 'utf8')).join('\n');
    for (const upstream of UPSTREAM_API_PATHS) expect(serverText).toContain(upstream);
  });

  it('ist in contract.generated.ts ohne Drift abgebildet', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderContract());
    expect(Object.keys(GENERATED_ROUTES)).toEqual(API_ROUTES.map((route: { id: string }) => route.id));
  });

  it('matcht Pfadmuster segmentweise', () => {
    expect(routePattern('/api/room-image-jobs/:jobId/previews/:candidateId').test('/api/room-image-jobs/a1/previews/c2')).toBe(true);
    expect(routePattern('/api/room-image-jobs/:jobId').test('/api/room-image-jobs/a1/publish')).toBe(false);
    expect(matchApiRoute('GET', '/api/health')?.id).toBe('health');
    expect(matchApiRoute('DELETE', '/api/health')).toBeNull();
    expect(matchApiRoute('POST', '/api/reminders/123e4567-e89b-12d3-a456-426614174000/complete')?.id).toBe('reminderComplete');
  });

  it('baut Pfade mit Parametern und Query über den Client', () => {
    expect(apiPath('health')).toBe('/api/health');
    expect(apiPath('reminderComplete', { id: 'a/b' })).toBe('/api/reminders/a%2Fb/complete');
    expect(apiPath('ablageDocuments', undefined, { query: 'Police', page: 2, empty: undefined })).toBe('/api/ablage/documents?query=Police&page=2');
    expect(() => apiPath('roomImageJob', {} as never)).toThrow(/jobId/);
  });
});
