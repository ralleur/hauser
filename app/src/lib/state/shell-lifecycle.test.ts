import { describe, expect, it, vi } from 'vitest';
import panelShell from '../shells/PanelAppShell.svelte?raw';
import { createShellLifecycle } from './shell-lifecycle.ts';

describe('shell presentation lifecycle', () => {
  it('closes only registered presentation state and preserves domain state', () => {
    const domain = { screen: 'library-detail', libraryId: 'movie-7', input: 'draft', commandPending: true };
    const close = vi.fn();
    const endTransition = vi.fn();
    const lifecycle = createShellLifecycle(endTransition);
    const unregister = lifecycle.register(close);
    lifecycle.prepareChange();
    expect(close).toHaveBeenCalledTimes(1);
    expect(endTransition).toHaveBeenCalledTimes(1);
    expect(domain).toEqual({ screen: 'library-detail', libraryId: 'movie-7', input: 'draft', commandPending: true });
    unregister();
    lifecycle.prepareChange();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('supports exactly one active shell cleanup registration', () => {
    const first = vi.fn();
    const second = vi.fn();
    const lifecycle = createShellLifecycle(vi.fn());
    lifecycle.register(first);
    lifecycle.register(second);
    lifecycle.prepareChange();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('binds panel shell cleanup to deactivating the panel-only HUD', () => {
    expect(panelShell).toMatch(/import\s*\{\s*hud\s*\}\s*from\s*['"]\.\.\/state\/hud\.svelte\.ts['"]/);
    expect(panelShell).toMatch(/shellLifecycle\.register\(\(\)\s*=>\s*\{[\s\S]*?hud\.active\s*=\s*false;[\s\S]*?\}\)\)/);
  });
});
