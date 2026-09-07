// @ts-expect-error Native Node test without @types/node.
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-expect-error Native Node test without @types/node.
import { dirname, join, relative, sep } from 'node:path';
// @ts-expect-error Native Node test without @types/node.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Schriftrollen-Lint (R6, docs/23; Tabelle in docs/01-design-system.md):
   Inter steuert, Instrument Serif erzählt, Caveat coacht. Die Handschrift
   gehört allein dem Coach — die gekritzelten Tipps über der Demo. Überall
   sonst wäre sie eine dritte Stimme in einem Bild, das mit zweien auskommt. */

const SRC = dirname(fileURLToPath(import.meta.url)).replace(`${sep}lib`, '');

/* Der Coach: Font-Deklaration und Tipp-Ebene wohnen in derselben Datei. */
const COACH_FILES = new Set(['styles/demo.css']);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'paraglide') sourceFiles(path, found);
    } else if (/\.(svelte|css|ts)$/.test(path) && !path.endsWith('.test.ts')) {
      found.push(path);
    }
  }
  return found;
}

describe('Schriftrollen', () => {
  it('Caveat spricht nur im Coach', () => {
    const files = sourceFiles(SRC);
    /* Beweis, dass der Lint wirklich liest: die Coach-Datei liegt im Fund. */
    expect(files.some((path: string) => path.endsWith(join('styles', 'demo.css')))).toBe(true);
    const strays: string[] = [];
    for (const path of files) {
      const rel = relative(SRC, path).split(sep).join('/');
      if (COACH_FILES.has(rel)) continue;
      if (readFileSync(path, 'utf8').includes('Caveat')) strays.push(rel);
    }
    expect(strays).toEqual([]);
  });
});
