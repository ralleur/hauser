/* ── Overlay-Zustandsmaschine der zentralen Klimasteuerung ──
   hidden → open → closing, analog sceneEdit (scene-edit-overlay.svelte.ts).

   Getrennt von climate-central-config: die Shells müssen nur wissen, OB das
   Overlay offen ist, um den lazy geladenen Editor zu rendern. Die Pille liegt
   im Startup-Pfad beider Shells — hier landet deshalb nur der Schalter, nicht
   die Konfigurationsoberfläche mit Gerätekatalog. */

export const centralClimateEdit = $state({
  mode: 'hidden' as 'hidden' | 'open' | 'closing',
});

export function openCentralClimateEdit(): void {
  centralClimateEdit.mode = 'open';
}

export function closeCentralClimateEdit(instant = false): void {
  if (centralClimateEdit.mode === 'hidden' || centralClimateEdit.mode === 'closing') return;
  centralClimateEdit.mode = instant ? 'hidden' : 'closing';
}

export function finishCentralClimateEditClose(): void {
  if (centralClimateEdit.mode === 'closing') centralClimateEdit.mode = 'hidden';
}
