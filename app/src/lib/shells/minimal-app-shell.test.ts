import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import shellSource from './MinimalAppShell.svelte?raw';

const shellStyles = readFileSync(new URL('./minimal-app-shell.css', import.meta.url), 'utf8');
const statusSource = readFileSync(new URL('./minimal-shell-status.ts', import.meta.url), 'utf8');

describe('minimal app shell clock fallback', () => {
  it('shows clock, date and week band instead of a copied dashboard', () => {
    expect(shellSource).toMatch(/<main[^>]*class="minimal-shell__stage"[\s\S]*\{view\.time\}[\s\S]*\{view\.date\}/);
    expect(shellSource).toMatch(/\{#each view\.week as day \(day\.key\)\}/);
    expect(shellSource).toContain('weekday: \'short\'');
    expect(shellSource).toContain('length: WEEK_DAYS');
    // Die Dashboard-Kopie ist weg: keine Tabs, keine erfundenen Ansichten.
    for (const gone of ['minimal-shell__nav', 'activeView', 'MINIMAL_SHELL_VIEWS', 'aria-current']) {
      expect(shellSource).not.toContain(gone);
    }
    expect(() => compile(shellSource, { filename: 'MinimalAppShell.svelte', generate: 'client' })).not.toThrow();
  });

  it('keeps the clock going without any backend call', () => {
    expect(shellSource).toMatch(/setInterval\(refresh, TICK_MS\)/);
    for (const resume of ['visibilitychange', 'focus', 'pageshow']) {
      expect(shellSource).toContain(resume);
    }
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage']) {
      expect(shellSource).not.toContain(forbidden);
    }
  });

  it('keeps the cause in one sentence and the only way back', () => {
    expect(shellSource).toContain('class="minimal-shell__cause"');
    expect(shellSource).toContain('{m.minimal_cause_unknown()}');
    expect(shellSource).toContain('location.reload()');
    expect(shellSource).toContain('{m.minimal_reload()}');
    expect(statusSource).toContain('cause.textContent = status.message');
    expect(`${shellSource}\n${statusSource}`).not.toMatch(/\{@html|innerHTML/);
  });

  it('stays outside productive state/runtime graphs and uses existing design tokens', () => {
    const importedPaths = [...shellSource.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    expect(importedPaths).toEqual([
      'svelte',
      './minimal-app-shell.css',
      '../../paraglide/messages.js',
      '../../paraglide/runtime.js',
    ]);

    for (const source of [shellSource, statusSource]) {
      for (const forbidden of [
        'DeviceManager',
        'household-runtime',
        'home-assistant',
        'runtime.svelte',
        'app.svelte',
        'App.svelte',
        'callService',
        'sendCommand',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }

    expect(shellStyles).toContain('var(--color-border)');
    expect(shellStyles).toContain('var(--font-weight-semibold)');
    expect(shellStyles).not.toContain('var(--color-border-subtle)');
    expect(shellStyles).not.toContain('var(--font-semibold)');
  });
});
