import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node test without @types/node.
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import shellSource from './MinimalAppShell.svelte?raw';
import { MINIMAL_SHELL_VIEWS } from './minimal-shell-navigation.ts';

const shellStyles = readFileSync(new URL('./minimal-app-shell.css', import.meta.url), 'utf8');
const cacheSource = readFileSync(new URL('./minimal-shell-cache.ts', import.meta.url), 'utf8');

describe('minimal app shell local fallback', () => {
  it('provides three distinct, informative local views', () => {
    expect(MINIMAL_SHELL_VIEWS.map(({ id }) => id)).toEqual(['home', 'rooms', 'system']);
    expect(new Set(MINIMAL_SHELL_VIEWS.map(({ title }) => title)).size).toBe(3);
    expect(new Set(MINIMAL_SHELL_VIEWS.map(({ summary }) => summary)).size).toBe(3);
    expect(MINIMAL_SHELL_VIEWS.every(({ details }) => details.split(' · ').length >= 2)).toBe(true);

    expect(MINIMAL_SHELL_VIEWS.find(({ id }) => id === 'home')?.title).toBe('Lokales Dashboard');
    expect(MINIMAL_SHELL_VIEWS.find(({ id }) => id === 'rooms')?.details)
      .toBe('Wohnbereich · Schlafbereich · Außenbereich');
    expect(MINIMAL_SHELL_VIEWS.find(({ id }) => id === 'system')?.title).toBe('Verbindung wird geprüft');
  });

  it('uses activeView in the visible main render path and exposes real tab state', () => {
    expect(shellSource).toMatch(/<main[^>]*>[\s\S]*\{activeView\.title\}[\s\S]*\{activeView\.summary\}[\s\S]*\{activeView\.details\}/);
    expect(shellSource).toMatch(/onclick=\{\(\) => \{ activeView = view; \}\}/);
    expect(shellSource).toMatch(/aria-current=\{activeView\.id === view\.id \? 'page' : undefined\}/);
    expect(shellSource).toContain('id={`minimal-tab-${view.id}`}');
    expect(shellSource).toContain('aria-controls="minimal-view"');
    expect(shellSource).toContain('id="minimal-view"');
    expect(shellSource).toContain('aria-labelledby={`minimal-tab-${activeView.id}`}');
  });

  it('hydrates only Home from a literal post-mount local-cache import', () => {
    expect(shellSource).toMatch(
      /onMount\(\(\) => \{[\s\S]*?import\('\.\/minimal-shell-cache\.ts'\)[\s\S]*?hydrateMinimalShellCache/,
    );
    expect(cacheSource).toContain("shell.dataset.view !== 'home'");
    expect(cacheSource).toContain('${snapshot.deviceCount} Geräte im letzten Stand');
    expect(cacheSource).toContain('${snapshot.lightsOn} Lichter an');
    expect(cacheSource).toContain('Letzter lokaler Stand');
    expect(cacheSource).toContain('Daten können veraltet sein');
    expect(shellSource).not.toContain('snapshot');
    expect(() => compile(shellSource, { filename: 'MinimalAppShell.svelte', generate: 'client' })).not.toThrow();
  });

  it('exposes bounded status targets without replacing local navigation', () => {
    expect(shellSource).toContain('class="minimal-shell__status" role="status"');
    expect(cacheSource).toContain('header.textContent = status.title');
    expect(cacheSource).toContain("shell?.dataset.view !== 'system'");
    expect(cacheSource).toContain('summary.textContent = status.message');
    expect(cacheSource).toContain('details.textContent = `${status.code} · Lokale Navigation verfügbar`');
    expect(shellSource).toMatch(/<nav[\s\S]*?MINIMAL_SHELL_VIEWS[\s\S]*?<button/);
    expect(`${shellSource}\n${cacheSource}`).not.toMatch(/\{@html|innerHTML/);
  });

  it('stays outside productive state/runtime graphs and uses existing design tokens', () => {
    const importedPaths = [...shellSource.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)]
      .map((match) => match[1]);
    expect(importedPaths).toEqual([
      'svelte',
      './minimal-app-shell.css',
      './minimal-shell-navigation.ts',
    ]);

    for (const source of [shellSource, JSON.stringify(MINIMAL_SHELL_VIEWS)]) {
      for (const forbidden of [
        'DeviceManager',
        'household-runtime',
        'home-assistant',
        'runtime.svelte',
        'app.svelte',
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

    for (const forbidden of [
      'fetch(',
      'XMLHttpRequest',
      'WebSocket',
      'DeviceManager',
      'household-runtime',
      'home-assistant',
      'runtime.svelte',
      'App.svelte',
    ]) {
      expect(cacheSource).not.toContain(forbidden);
    }
  });
});
