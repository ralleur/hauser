/* ── Overlay-Zustandsmaschine des Szenen-Editors ──
   hidden → open → closing, analog roomEdit (overlay.svelte.ts).

   Bewusst getrennt vom scene-manager: die Shells (Phone und Panel) müssen nur
   wissen, OB das Overlay offen ist, um den lazy geladenen Editor zu rendern.
   Läge der Zustand weiter im Manager, zöge dieser Blick die komplette
   Szenen-Logik in den Startup-Chunk — gemessen 4 KiB gzip, die den kombinierten
   Phone-Startup über sein Budget hoben (docs/03).

   Das Verlassen muss die Live-Vorschau zurücknehmen, was Manager-Wissen ist.
   Statt hier darauf zu importieren, meldet der Manager beim Laden seinen Hook
   an — er ist geladen, sobald der Editor je offen war, und ohne offenen Editor
   gibt es auch keine Vorschau zurückzunehmen. */

import type { SceneId } from './scene-config.ts';

export const sceneEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
  roomId: '',
  sceneId: 'gemuetlich' as SceneId,
});

let onLeave: (() => void) | null = null;

/** Der Szenen-Manager hängt hier das Zurücknehmen der Vorschau ein. */
export function setSceneEditLeaveHook(hook: () => void): void {
  onLeave = hook;
}

export function openSceneEdit(roomId: string, sceneId: SceneId): void {
  sceneEdit.roomId = roomId;
  sceneEdit.sceneId = sceneId;
  sceneEdit.mode = 'open';
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hauser:scene-edit-open'));
}

export function closeSceneEdit(instant = false): void {
  if (sceneEdit.mode === 'hidden' || sceneEdit.mode === 'closing') return;
  // Verlassen heißt: die Vorschau zurücknehmen — die Szene ist konfiguriert,
  // nicht angewendet.
  onLeave?.();
  sceneEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishSceneEditClose(): void {
  if (sceneEdit.mode === 'closing') sceneEdit.mode = 'hidden';
}
