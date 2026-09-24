/* Das Stresshaus denkt sich neue Fälle aus (Zwei-Tage-Lauf, tools/stresshaus-lauf.sh).

   Claude liest die bekannten Stolperfallen (hostile-home.ts), die bisher
   ausgedachten Szenarien und was sich seit dem letzten Lauf im Code geändert
   hat — und erfindet daraus neue, realistische Haushalte, die Hauser noch
   nicht gesehen hat. Schwerpunkt ist das frisch Gebaute: was eine Änderung
   mitzieht, soll im nächsten Lauf gleich unter Druck stehen.

   Claude bekommt nur Lese-Werkzeuge. Die Antwort ist ein JSON-Feld von
   Szenarien; was die Form verfehlt, fällt heraus. Ergebnis landet als Datei im
   Szenario-Ordner und wird ab dann in jedem Lauf mitgespielt.

     node scripts/stresshaus/invent.mjs --out <datei.json> --szenarien <ordner> [--seit <git-datum>] */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = join(APP, '..');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const OUT = arg('out');
const SCENARIO_DIR = arg('szenarien');
const SINCE = arg('seit') ?? '3 days ago';
const MAX_SCENARIOS = 12;
const MAX_ENTITIES = 40;

if (!OUT) { console.error('--out fehlt'); process.exit(64); }

const known = SCENARIO_DIR && existsSync(SCENARIO_DIR)
  ? readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return [JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8'))].flat().map((s) => `- ${s.name}: ${s.warum ?? ''}`); } catch { return []; }
  })
  : [];
const changes = execFileSync('git', ['log', `--since=${SINCE}`, '--no-merges', '--format=- %s', '--', 'app/src', 'app/server', 'app/server.mjs'], { cwd: REPO, encoding: 'utf8' }).trim();
const files = execFileSync('git', ['log', `--since=${SINCE}`, '--no-merges', '--name-only', '--format=', '--', 'app/src', 'app/server', 'app/server.mjs'], { cwd: REPO, encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f, i, all) => all.indexOf(f) === i).slice(0, 40).join('\n');

const prompt = `Du erfindest Testfälle für das „Stresshaus" von Hauser, einem Wandpanel und einer Telefon-App für Home Assistant.

Das Stresshaus ist ein nachgebautes Home Assistant voller echter Stolperfallen. Ein Crawler richtet Hauser dagegen ein und klickt jede Ansicht, jedes Gerät, jede Einstellung durch — im Browser und in der iOS-App. Ziel: Abstürze und Fehler finden, bevor ein Nutzer sie trifft.

Die festen Fälle stehen in app/src/lib/stresshaus/hostile-home.ts (lies die Datei; dort steht auch der Katalog der gewürfelten Macken). Wiederhole nichts davon.

Bisher ausgedachte Szenarien (nicht wiederholen):
${known.join('\n') || '- noch keine'}

Was sich seit dem letzten Lauf geändert hat (Commits):
${changes || '- nichts'}

Geänderte Dateien:
${files || '- keine'}

Deine Aufgabe: Erfinde ${MAX_SCENARIOS} neue Szenarien. Mindestens die Hälfte zielt auf das, was sich geändert hat — lies die geänderten Dateien und überlege, welche echten Home-Assistant-Daten genau diesen Code brechen könnten (Vorausschau: was zieht die Änderung mit?). Der Rest erkundet Kombinationen, die noch niemand probiert hat: Funktionen und Optionen zusammen, die einzeln harmlos sind (ein Sensor zugleich im Raum, in der Energie und in einer Szene; ein Raum voller Geräte ohne Namen; ein Kalender über den Jahreswechsel; Sommerzeitwechsel; Integrationen, die Attribute als Zahl-Strings liefern; Entitäten, deren Domain wechselt).

Regeln:
- Realistisch: nur Daten, die echte Integrationen so liefern können. entity_id immer im Format domain.objekt (Kleinbuchstaben, Ziffern, _).
- Verwende nur diese Domains: light, switch, sensor, binary_sensor, climate, media_player, cover, fan, input_boolean, vacuum, camera, valve, lock, humidifier, water_heater, lawn_mower, alarm_control_panel, siren, remote, number, input_number, select, input_select, button, input_button, calendar, todo, weather, person.
- Höchstens ${MAX_ENTITIES} Entitäten je Szenario. Neue Bereiche mit eigener area_id, sonst eine der vorhandenen (wohnzimmer, kuche, bad, buro, flur, keller, schlafzimmer, kinderzimmer, wintergarten).
- Jedes Szenario nennt in „warum", welche echte Situation oder Integration es nachbildet und welche Stelle in Hauser es treffen soll.

Antworte NUR mit einem JSON-Feld, ohne Erklärung davor oder danach, in dieser Form:
[
  {
    "name": "kurzer eindeutiger Name",
    "warum": "ein Satz",
    "areas": [{ "area_id": "neuer_bereich", "name": "Neuer Bereich" }],
    "devices": [{ "id": "dev_x", "area_id": "neuer_bereich", "name": "Gerät" }],
    "entities": [
      { "entity_id": "light.beispiel", "state": "on", "attributes": { "friendly_name": "Beispiel", "brightness": 12 }, "area_id": "neuer_bereich" }
    ],
    "calendarEvents": { "calendar.familie": [{ "start": "2026-12-31T23:30:00+01:00", "end": "2027-01-01T00:30:00+01:00", "summary": "Silvester", "uid": "x" }] },
    "todoItems": { "todo.einkaufsliste": [{ "uid": "u1", "summary": "Milch", "status": "needs_action" }] }
  }
]
Striktes JSON: Zahlen ohne Unterstriche (250000, nicht 250_000), keine Kommentare, kein Komma vor einer schließenden Klammer.
Felder außer name, warum und entities sind optional. Entitäten dürfen zusätzlich "device_id", "name", "hidden_by", "disabled_by", "entity_category", "noRegistry" oder "noState" tragen.`;

/* Nachsichtig lesen: Claude schreibt gern Zahlen wie im Code (`250_000`) oder
   ein Komma zu viel. Außerhalb von Zeichenketten fallen beide weg. */
function lenient(json) {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += json[++i] ?? ''; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '_' && /\d/.test(json[i - 1] ?? '') && /\d/.test(json[i + 1] ?? '')) continue;
    if (c === ',' && /^\s*[}\]]/.test(json.slice(i + 1))) continue;
    out += c;
  }
  return out;
}

function extractJson(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('keine JSON-Liste in der Antwort');
  return JSON.parse(lenient(text.slice(start, end + 1)));
}

function valid(scenario) {
  if (!scenario || typeof scenario.name !== 'string' || !Array.isArray(scenario.entities)) return false;
  scenario.entities = scenario.entities
    .filter((e) => e && typeof e.entity_id === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(e.entity_id) && e.state !== undefined)
    .slice(0, MAX_ENTITIES);
  return scenario.entities.length > 0 || Object.keys(scenario.calendarEvents ?? {}).length > 0 || Object.keys(scenario.todoItems ?? {}).length > 0;
}

const output = execFileSync('claude', [
  '-p', prompt,
  '--output-format', 'text',
  '--allowedTools', 'Read', 'Grep', 'Glob',
], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 30 * 60_000 });
writeFileSync(`${OUT}.antwort.txt`, output);

const scenarios = extractJson(output).filter(valid).slice(0, MAX_SCENARIOS)
  .map((s) => ({ ...s, erfunden: new Date().toISOString().slice(0, 10) }));
if (!scenarios.length) { console.error('Keine gültigen Szenarien in der Antwort'); process.exit(1); }
writeFileSync(OUT, `${JSON.stringify(scenarios, null, 2)}\n`);
console.log(`${scenarios.length} neue Szenarien: ${scenarios.map((s) => s.name).join(' · ')}`);
