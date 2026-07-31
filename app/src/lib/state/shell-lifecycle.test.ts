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

  it('keeps inactive panel screens and optional layers behind literal lazy boundaries', () => {
    for (const component of [
      'EnergyScreen', 'CalendarScreen', 'NotesScreen', 'MediaScreen', 'SongsScreen',
      'LibraryScreen', 'LibraryDetailScreen', 'SystemScreen', 'AblageScreen',
      'DeviceDetail', 'RoomEdit', 'SceneEdit', 'LayoutConfigDialog', 'AmbientLayer', 'Hud',
    ]) {
      expect(panelShell).not.toMatch(new RegExp(`^\\s*import\\s+${component}\\s+from`, 'm'));
      expect(panelShell).toContain(`import('../${component === 'AblageScreen' || [
        'DeviceDetail', 'RoomEdit', 'SceneEdit', 'LayoutConfigDialog', 'AmbientLayer', 'Hud',
      ].includes(component) ? 'components' : 'screens'}/${component}.svelte')`);
    }
    expect(panelShell).toContain('visiblePanelScreens');
    expect(panelShell).toContain("screen.id === 'home'");
  });

  it('binds panel shell cleanup to deactivating the panel-only HUD', () => {
    expect(panelShell).toMatch(/import\s*\{\s*hud\s*\}\s*from\s*['"]\.\.\/state\/hud\.svelte\.ts['"]/);
    expect(panelShell).toMatch(/shellLifecycle\.register\(\(\)\s*=>\s*\{[\s\S]*?hud\.active\s*=\s*false;[\s\S]*?\}\)\)/);
  });

  it('makes every panel screen and layer seam retryable without retaining rejected promises', () => {
    expect(panelShell).toContain("from '../state/lazy-loader.ts'");
    expect(panelShell).not.toMatch(/const\s+(screenPromises|layerPromises)\s*=\s*new Map/);
    expect(panelShell).toMatch(/retryScreen/);
    expect(panelShell).toMatch(/retryLayer/);
    expect(panelShell).toMatch(/closeLayer/);
    expect((panelShell.match(/\{:catch\}/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(panelShell).toMatch(/loadScreen\([^)]*screenRetryVersions/);
    expect(panelShell).toMatch(/loadLayer\([^)]*layerRetryVersions/);
  });
});
