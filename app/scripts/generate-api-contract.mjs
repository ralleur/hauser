#!/usr/bin/env node
/* Erzeugt `src/lib/api/contract.generated.ts` aus `server/api-contract.mjs`.

   Aufruf: node scripts/generate-api-contract.mjs            # schreibt die Datei
           node scripts/generate-api-contract.mjs --check    # Exit 1 bei Drift

   Der Browser-Client (`src/lib/api/client.ts`) baut auf der erzeugten Datei
   auf; der Vertrag selbst bleibt die einzige Quelle. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { API_CONTRACT_VERSION, API_ROUTES } from '../server/api-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GENERATED_PATH = resolve(root, 'src/lib/api/contract.generated.ts');

export function renderContract() {
  const responseTypes = [...new Set(API_ROUTES.map((route) => route.response).filter(Boolean))].sort();
  const lines = [];
  lines.push('/* GENERIERT aus server/api-contract.mjs — nicht von Hand ändern.');
  lines.push('   Neu erzeugen mit: node scripts/generate-api-contract.mjs */');
  lines.push('');
  if (responseTypes.length) {
    lines.push(`import type { ${responseTypes.join(', ')} } from './types.ts';`);
    lines.push('');
  }
  lines.push(`export const API_CONTRACT_VERSION = ${API_CONTRACT_VERSION};`);
  lines.push('');
  lines.push("export type ApiMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';");
  lines.push("export type ApiAccess = 'public' | 'origin' | 'admin' | 'session' | 'guest';");
  lines.push('');
  lines.push('export const API_ROUTES = {');
  for (const route of API_ROUTES) {
    const methods = route.methods.map((m) => `'${m}'`).join(', ');
    lines.push(`  ${route.id}: { methods: [${methods}], path: '${route.path}', area: '${route.area}', access: '${route.access}' },`);
  }
  lines.push('} as const;');
  lines.push('');
  lines.push('export type ApiRouteId = keyof typeof API_ROUTES;');
  lines.push('export type ApiRoutePath<Id extends ApiRouteId> = (typeof API_ROUTES)[Id][\'path\'];');
  lines.push('');
  lines.push('/** Antworttypen der Leserouten; Routen ohne Eintrag liefern `unknown`. */');
  lines.push('export interface ApiResponses {');
  for (const route of API_ROUTES) {
    if (route.response) lines.push(`  ${route.id}: ${route.response};`);
  }
  lines.push('}');
  lines.push('');
  lines.push('export type ApiResponse<Id extends ApiRouteId> = Id extends keyof ApiResponses ? ApiResponses[Id] : unknown;');
  return `${lines.join('\n')}\n`;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const rendered = renderContract();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(GENERATED_PATH, 'utf8'); } catch { current = ''; }
    if (current !== rendered) {
      console.error('contract.generated.ts ist nicht aktuell: node scripts/generate-api-contract.mjs ausführen.');
      process.exit(1);
    }
    console.log('contract.generated.ts ist aktuell.');
  } else {
    writeFileSync(GENERATED_PATH, rendered);
    console.log(`geschrieben: ${GENERATED_PATH} (${API_ROUTES.length} Routen)`);
  }
}
