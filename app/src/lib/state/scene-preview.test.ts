import { describe, expect, it, vi } from 'vitest';
import { runtime } from '../adapter/runtime.svelte.ts';
import type { Command } from '../adapter/types.ts';
import { appState } from './app.svelte.ts';
import { deviceManager } from './device-manager.svelte.ts';
import { addToScene, previewScene, restoreScenePreview, scenes } from './scene-manager.svelte.ts';

/* simon42, Cpt.Hardy, 0.47.0: Nach dem Szenen-Editor blieb eine Lampe an. Die
   HA-Lichtgruppe stand neben ihren Lampen im Raum; ihr Sammelwert „an“ schaltete
   beim Zurückstellen auch die Lampe wieder ein, die vorher aus war. */
describe('Szenen-Vorschau stellt eine Lichtgruppe über ihre Lampen zurück', () => {
  it('lässt die Gruppe unberührt und stellt jede Lampe einzeln zurück', () => {
    const room = appState.rooms.find((r) => r.lights.filter((l) => l.entityId.startsWith('light.')).length >= 2)!;
    const [a, b] = room.lights.filter((l) => l.entityId.startsWith('light.')).map((l) => l.entityId);
    const group = 'light.stresshaus_gruppe';
    const sceneId = scenes(room.id)[0]!.id;
    const known = new Set(deviceManager.catalog.map((item) => item.entityId));
    deviceManager.catalog = [
      ...deviceManager.catalog,
      ...[a, b].filter((id) => !known.has(id)).map((entityId) => ({ entityId, domain: 'light' as const, name: entityId })),
      { entityId: group, domain: 'light', name: 'Alle Lichter', capabilities: { dimmable: true, members: [a, b, 'light.gibt_es_nicht'] } },
    ];
    runtime.store.set(a, { on: true, brightness: 80 });
    runtime.store.set(b, { on: false, brightness: 0 });
    runtime.store.set(group, { on: true, brightness: 80 });
    addToScene(room.id, sceneId, group);

    previewScene(room.id, sceneId);
    const sent: Command[] = [];
    const dispatch = vi.spyOn(runtime, 'dispatch').mockImplementation((command) => { sent.push(command); });
    restoreScenePreview();
    dispatch.mockRestore();

    expect(sent.find((command) => command.entityId === group)).toBeUndefined();
    expect(sent.find((command) => command.entityId === a)?.service).toBe('turn_on');
    expect(sent.find((command) => command.entityId === b)?.service).toBe('turn_off');
  });
});
