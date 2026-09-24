import { describe, expect, it } from 'vitest';
import { canAddQuick, defaultQuickBar, parseQuickBar, usedFields, type QuickItem } from './phone-quick-bar.svelte.ts';

const item = (kind: QuickItem['kind'], extra: Partial<QuickItem> = {}): QuickItem => ({ id: kind, kind, name: '', icon: 'i-power', steps: [], ...extra });

describe('Schnellaktions-Leiste (wie die iOS-App)', () => {
  it('hat vier Felder: die zentrale Temperatur nimmt zwei, alles andere eines', () => {
    expect(usedFields([item('off'), item('climate')])).toBe(3);
    expect(canAddQuick([item('off'), item('climate')], 'action')).toBe(true);
    expect(canAddQuick([item('off'), item('climate'), item('action', { id: 'a' })], 'action')).toBe(false);
    expect(canAddQuick([item('action', { id: 'a' }), item('action', { id: 'b' }), item('action', { id: 'c' })], 'climate')).toBe(false);
  });

  it('kennt „Alles aus" und die Temperatur je nur einmal', () => {
    expect(canAddQuick([item('off')], 'off')).toBe(false);
    expect(canAddQuick([item('climateCompact')], 'climate')).toBe(false);
    expect(canAddQuick([item('climate')], 'climateCompact')).toBe(false);
  });

  it('liest eine kaputte gespeicherte Leiste, ohne aus ihrem Maß zu brechen', () => {
    expect(parseQuickBar(null)).toBeNull();
    expect(parseQuickBar('kaputt')).toBeNull();
    expect(parseQuickBar('{"kind":"off"}')).toBeNull();
    const parsed = parseQuickBar(JSON.stringify([
      { id: 'x', kind: 'off' }, { id: 'x', kind: 'off' }, null, { kind: 'rakete' },
      { id: 'c', kind: 'climate' },
      { id: 'a', kind: 'action', name: 'Ein viel zu langer Name', icon: '../../etc', steps: [
        { kind: 'device', entityId: 'light.flur', mode: 'on' },
        { kind: 'device', entityId: 'kein entity' },
        { kind: 'scene', roomId: 'flur', sceneId: 'abend' },
        { kind: 'vacation' }, 'müll',
      ] },
      { id: 'b', kind: 'action' },
    ]))!;
    expect(parsed.map((entry) => entry.kind)).toEqual(['off', 'climate', 'action']);
    expect(parsed[2].name).toHaveLength(14);
    expect(parsed[2].icon).toBe('i-lightning-bolt');
    expect(parsed[2].steps).toEqual([
      { kind: 'device', entityId: 'light.flur', mode: 'on' },
      { kind: 'scene', roomId: 'flur', sceneId: 'abend', mode: 'toggle' },
      { kind: 'vacation', mode: 'toggle' },
    ]);
  });

  it('übernimmt den alten rechten Knopf: ein Gerät wird ein eigener Knopf, ein laufender Urlaub bleibt schaltbar', () => {
    expect(defaultQuickBar({ entityId: null, icon: null }, false).map((entry) => entry.kind)).toEqual(['off', 'climate']);
    const device = defaultQuickBar({ entityId: 'switch.kaffee', icon: 'i-coffee' }, false);
    expect(device[2]).toMatchObject({ kind: 'action', icon: 'i-coffee', steps: [{ kind: 'device', entityId: 'switch.kaffee', mode: 'toggle' }] });
    expect(defaultQuickBar({ entityId: null, icon: null }, true)[2]).toMatchObject({ kind: 'action', steps: [{ kind: 'vacation' }] });
  });
});
