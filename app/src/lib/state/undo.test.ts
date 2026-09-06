import { describe, expect, it } from 'vitest';
import { mergedLight, setBrightness } from './commands.ts';
import { lightEntityId } from './entities.ts';
import { dismissUndo, offerUndo, runUndo, undoOffer } from './undo.svelte.ts';

/* Undo statt Bestätigen (Paket 6): der Eingriff geht sofort raus, die
   Rücknahme ist ein zweiter Befehl über dieselbe Command-Queue. */
describe('Rückgängig-Fenster', () => {
  const ROOM = 'wohnzimmer';
  const LIGHT = 'kugellampen';
  const entityId = lightEntityId(ROOM, LIGHT);

  it('nimmt den Eingriff auf den Zustand davor zurück', () => {
    dismissUndo();
    setBrightness(ROOM, LIGHT, 80);

    offerUndo({ kind: 'scene', scene: 'Test' }, [entityId], () => setBrightness(ROOM, LIGHT, 10));
    expect(undoOffer.active).toBe(true);
    expect(mergedLight(ROOM, LIGHT)).toMatchObject({ brightness: 10 });

    runUndo();
    expect(undoOffer.active).toBe(false);
    expect(mergedLight(ROOM, LIGHT)).toMatchObject({ on: true, brightness: 80 });
  });

  it('fasst eine Serie mit gleichem Schlüssel zu einem Schritt zusammen', () => {
    dismissUndo();
    setBrightness(ROOM, LIGHT, 50);

    offerUndo({ kind: 'scene', scene: 'Serie' }, [entityId], () => setBrightness(ROOM, LIGHT, 60), 'serie');
    offerUndo({ kind: 'scene', scene: 'Serie' }, [entityId], () => setBrightness(ROOM, LIGHT, 70), 'serie');

    runUndo();
    expect(mergedLight(ROOM, LIGHT)).toMatchObject({ brightness: 50 });
  });

  it('verwirft das Angebot beim Schließen', () => {
    dismissUndo();
    setBrightness(ROOM, LIGHT, 30);
    offerUndo({ kind: 'scene', scene: 'Test' }, [entityId], () => setBrightness(ROOM, LIGHT, 40));

    dismissUndo();
    expect(undoOffer.active).toBe(false);
    expect(mergedLight(ROOM, LIGHT)).toMatchObject({ brightness: 40 });
  });
});
