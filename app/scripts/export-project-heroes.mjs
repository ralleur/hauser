/* ── Mitgelieferte Raumbilder aus einem echten Haushalt erzeugen ──

   Die Bilder unter `public/hero/` sind das, was ein neuer Haushalt vor dem
   ersten eigenen Bild sieht — und die Grundlage der Demo. Sie entstehen nicht
   von Hand, sondern aus einem gepflegten Bildkatalog: Wer die Standardlinie
   erneuert, erstellt die Sets im Assistenten, weist sie den Räumen zu und
   ruft dieses Skript.

   Aufruf (Pfade wie im Betrieb, sonst per Umgebung):
     node scripts/export-project-heroes.mjs \
       --catalog "<datenordner>/room-images/assets.json" \
       --assets  "<datenordner>/assets" \
       --household "<datenordner>/household.json" \
       [--extra kinderzimmer=<assetId>] [--dry-run]

   `--extra` nimmt ein Bildset mit, das noch keinem Raum zugewiesen ist.

   Geschrieben werden je Raum die Bildvarianten und, einmal für alle,
   `regions.json` mit den erkannten Flächen: Ohne sie zöge im Standardbild kein
   Regen im Fenster, und der Standardsatz könnte weniger als ein eigener. */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_HERO = join(HERE, '..', 'public', 'hero');

/* Katalogname → Dateiname im Zielordner, je Raum. */
const VARIANTS = [
  ['light', 'light.avif', (room) => `${room}-light.avif`],
  ['dark', 'dark.avif', (room) => `${room}-dark.avif`],
  ['darkOff', 'dark-off.avif', (room) => `${room}-dark-off.avif`],
  ['overcast', 'overcast.avif', (room) => `${room}-overcast.avif`],
];
/* Die Phone-Ableitungen entstehen beim Bauen aus genau diesen Vollbildern
   (`npm run hero:phone`) und sind deshalb nicht eingecheckt — hier gibt es
   nichts zu kopieren. */

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const catalogPath = arg('catalog');
const assetRoot = arg('assets');
const householdPath = arg('household');
const dryRun = process.argv.includes('--dry-run');
if (!catalogPath || !assetRoot || !householdPath) {
  console.error('Es fehlen --catalog, --assets oder --household.');
  process.exit(64);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const household = JSON.parse(readFileSync(householdPath, 'utf8'));
const entries = new Map(catalog.assets.map((asset) => [asset.assetId, asset]));

const zuordnung = new Map();
for (const room of household.rooms ?? []) {
  const assetId = room.hero?.assetId;
  if (assetId) zuordnung.set(room.id, assetId);
}
for (let index = process.argv.indexOf('--extra'); index >= 0; index = process.argv.indexOf('--extra', index + 1)) {
  const value = process.argv[index + 1] ?? '';
  const [room, assetId] = value.split('=');
  if (room && assetId) zuordnung.set(room, assetId);
}

if (!dryRun) mkdirSync(PUBLIC_HERO, { recursive: true });

const regionen = {};
let kopiert = 0;
for (const [room, assetId] of [...zuordnung].sort()) {
  const entry = entries.get(assetId);
  if (!entry || entry.status !== 'active') {
    console.error(`  ${room}: Bildset ${assetId} fehlt oder ist nicht aktiv — übersprungen.`);
    continue;
  }
  const geschrieben = [];
  for (const [key, quelle, ziel] of VARIANTS) {
    const from = join(assetRoot, 'room-images', assetId, quelle);
    if (!entry.files?.[key] || !existsSync(from)) continue;
    if (!dryRun) copyFileSync(from, join(PUBLIC_HERO, ziel(room)));
    geschrieben.push(ziel(room));
    kopiert += 1;
  }
  const flaechen = entry.regions?.regions ?? [];
  if (flaechen.length > 0) regionen[room] = flaechen;
  console.log(`  ${room.padEnd(14)} ← ${assetId.slice(0, 12)}…  ${geschrieben.length} Dateien, ${flaechen.length} Flächen`);
}

if (!dryRun) {
  writeFileSync(join(PUBLIC_HERO, 'regions.json'), `${JSON.stringify(regionen, null, 2)}\n`);
}
console.log(`${dryRun ? '[Probelauf] ' : ''}${kopiert} Bilddateien, Flächen für ${Object.keys(regionen).length} Räume.`);
