// @ts-expect-error Native Node test without @types/node.
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { dirname, join, relative, sep } from 'node:path';
// @ts-expect-error Native Node test without @types/node.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Sprach-Lint (Paket 2, docs/20): Die Oberfläche spricht die eingestellte
   Sprache — deutsche Texte gehören nach `messages/*.json`, nicht in den Code.
   Als Nachweis dient der Umlaut: ein hartcodierter String mit ä/ö/ü/ß ist
   verlässlich deutsch. Kommentare sind ausgenommen (die Codebasis kommentiert
   auf Deutsch), ebenso die Suchbegriffe der Einstellungs-Registry, die auf
   deutsche Eingaben passen sollen.

   Zwei Ausnahmen bleiben bewusst deutsch:
   — ganze Dateien in ALLOWED_FILES (Demo-/Seed-Daten, Legacy-Haushalt,
     deutsche LLM-Vorlagen, die Werkstatt-Funktion „KI-Anpassung“),
   — einzelne Zeilen mit `i18n-ignore` im Kommentar (Transliteration,
     Systemprompts). */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_FILES: Readonly<Record<string, string>> = {
  'lib/state/ambient-copy.ts': 'deutsche Tageskommentar-Vorlagen und LLM-Systemprompt; andere Sprachen laufen über generateLocalizedAmbientCopy',
  'lib/state/library-seed.ts': 'Demo-Bibliothek',
  'lib/state/app.svelte.ts': 'Seed- und Demo-Daten',
  'lib/state/fake-discovery-catalog.ts': 'Demo-Daten',
  'lib/adapter/fake-backend.ts': 'Demo-Backend',
  'lib/demo/demo-mode.ts': 'Demo-Daten',
  'lib/config/legacy-household-data.ts': 'Legacy-Haushalt',
  'lib/config/neutral-runtime.ts': 'nur vom Neutral-Harness genutzt',
  'lib/room-images/room-image-prompt-policy-v1.ts': 'deutscher Bildprompt',
  'lib/state/ai-customizing.ts': 'Werkstatt-Funktion „KI-Anpassung“ mit deutschem Agentenprotokoll',
  'lib/state/ai-customizing.svelte.ts': 'Werkstatt-Funktion „KI-Anpassung“ mit deutschem Agentenprotokoll',
  'lib/components/ai/AiChat.svelte': 'Werkstatt-Funktion „KI-Anpassung“',
  'lib/components/ai/AiCustomizingPane.svelte': 'Werkstatt-Funktion „KI-Anpassung“',
  'lib/components/ai/AiNewFeatureDialog.svelte': 'Werkstatt-Funktion „KI-Anpassung“',
  'neutral/NeutralHarness.svelte': 'Test-Harness, nicht Teil der Oberfläche',
  'lib/components/SimulationPanel.svelte': 'Werkstatt-Simulator hinter einer versteckten Geste, kein Teil der Oberfläche',
};

/* Die KI-Werkstatt bleibt im Public-Export außen vor (tools/public-export).
   Dort fehlen diese Dateien deshalb zu Recht — ihre Ausnahme ist dann nicht
   veraltet, sondern gehört zu einer Fassung, die es öffentlich nicht gibt. */
const WORKSHOP_ONLY = new Set([
  'lib/state/ai-customizing.ts',
  'lib/state/ai-customizing.svelte.ts',
  'lib/components/ai/AiChat.svelte',
  'lib/components/ai/AiCustomizingPane.svelte',
  'lib/components/ai/AiNewFeatureDialog.svelte',
]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'paraglide') sourceFiles(path, found);
    } else if ((path.endsWith('.svelte') || path.endsWith('.ts')) && !path.endsWith('.test.ts')) {
      found.push(path);
    }
  }
  return found;
}

/* Kommentare und Suchbegriffe ausblenden, aber die Zeilenzahl erhalten. */
const blank = (match: string) => match.replace(/[^\n]/g, ' ');
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) => before + blank(match.slice(before.length)))
    .replace(/keywords:\s*\[[\s\S]*?\]/g, blank);
}

describe('Sprach-Lint', () => {
  it('findet keine hartcodierten deutschen Strings außerhalb der Ausnahmen', () => {
    const findings: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const id = relative(SRC, path).split(sep).join('/');
      if (id in ALLOWED_FILES) continue;
      const raw = readFileSync(path, 'utf8').split('\n');
      withoutComments(raw.join('\n')).split('\n').forEach((line, index) => {
        if (!/[äöüÄÖÜß]/.test(line)) return;
        if (raw[index].includes('i18n-ignore')) return;
        findings.push(`src/${id}:${index + 1}: ${raw[index].trim()}`);
      });
    }
    expect(findings).toEqual([]);
  });

  it('führt keine Ausnahme für eine Datei, die es nicht mehr gibt', () => {
    const ids = new Set(sourceFiles(SRC).map((path) => relative(SRC, path).split(sep).join('/')));
    expect(Object.keys(ALLOWED_FILES).filter((id) => !ids.has(id) && !WORKSHOP_ONLY.has(id))).toEqual([]);
  });
});
