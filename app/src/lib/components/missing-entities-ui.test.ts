// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const state = (name: string) => readFileSync(new URL(`../state/${name}`, import.meta.url), 'utf8');
const style = (name: string) => readFileSync(new URL(`../../styles/${name}`, import.meta.url), 'utf8');
const message = (locale: string) => JSON.parse(
  readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8'),
) as Record<string, string>;

describe('missing entity UI contract', () => {
  it('makes DeviceTile visibly unavailable and disables tap plus long-press', () => {
    const source = component('DeviceTile.svelte');
    expect(source).toContain('runtime.isEntityAvailable');
    expect(source).toContain('class:is-unavailable={!available}');
    expect(source).toContain('disabled={!available}');
    expect(source).toMatch(/longpress=\{\{ enabled: available,/);
    expect(source).toContain('m.media_unavailable()');
  });

  it('keeps DeviceDetail closable while disabling entity controls and rename', () => {
    const source = component('DeviceDetail.svelte');
    expect(source).toContain('runtime.isEntityAvailable');
    expect(source).toContain('class:is-unavailable={!available}');
    expect(source).toContain('m.entity_unavailable_repair_hint()');
    expect(source).toMatch(/ld-title-button[\s\S]*?disabled=\{!available\}/);
    expect(source).toMatch(/ld-power[\s\S]*?disabled=\{!available\}/);
    expect(source).toMatch(/<TickScale[\s\S]*?disabled=\{!available\}/);
    expect(source).toMatch(/mode-seg pressable[\s\S]*?disabled=\{!available\}/);
    expect(source).not.toMatch(/ld-close[^>]*disabled=\{!available\}/);
  });

  it('applies the unavailable climate gate in shared RoomControls', () => {
    const source = component('RoomControls.svelte');
    expect(source).toContain('runtime.isEntityAvailable');
    expect(source).toContain('class:is-unavailable={!climateAvailable}');
    expect(source).toContain('m.entity_unavailable_repair_hint()');
    expect(source.match(/disabled=\{!climateAvailable\}/g)).toHaveLength(3);
  });

  it('excludes unavailable lights and climate mode from PanelRoomSelector summaries', () => {
    const source = component('PanelRoomSelector.svelte');
    expect(source).toMatch(/filter\(\(light\) =>[\s\S]*?runtime\.isEntityAvailable/);
    expect(source).toContain('const climateAvailable =');
    expect(source).toMatch(/const mode = climate && climateAvailable/);
  });

  it('gates existing media, camera, energy, and laundry consumers explicitly', () => {
    expect(state('media.svelte.ts')).toContain('runtime.isEntityAvailable(entityId)');
    expect(state('energy.svelte.ts')).toContain('!runtime.isEntityAvailable(eid)');
    expect(component('CameraFeed.svelte')).toContain('!runtime.isEntityAvailable(entityId)');
    expect(component('NotificationLayer.svelte')).toContain('runtime.isEntityAvailable(entityId)');
  });

  it('styles tile, detail, and shared climate state as dashed and dimmed', () => {
    const appCss = style('app.css');
    const roomCss = style('room-controls.css');
    expect(appCss).toMatch(/\.light-tile\.is-unavailable\s*\{[\s\S]*?border-style:\s*dashed;[\s\S]*?opacity:/);
    expect(appCss).toMatch(/\.light-detail-panel\.is-unavailable\s*\{[\s\S]*?border-style:\s*dashed;/);
    expect(roomCss).toMatch(/\.climate-card\.is-unavailable\s*\{[\s\S]*?border-style:\s*dashed;[\s\S]*?opacity:/);
  });

  it('keeps all six catalogs key-identical with an availability label and repair route', () => {
    const locales = ['de', 'en', 'fr', 'it', 'pl', 'pt'];
    const catalogs = locales.map(message);
    const referenceKeys = Object.keys(catalogs[0]).sort();
    for (const catalog of catalogs) {
      expect(Object.keys(catalog).sort()).toEqual(referenceKeys);
      expect(catalog.entity_unavailable_repair_hint).toContain('→');
    }
    expect(catalogs[0].media_unavailable).toBe('Nicht verfügbar');
    expect(catalogs[0].entity_unavailable_repair_hint).toContain('Räume & Geräte');
  });
});
