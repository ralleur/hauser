/* Pulse-Action (docs/02 Reconciliation-Feedback): fügt bei jedem Anstieg von
   `seq` kurzzeitig eine CSS-Klasse hinzu und entfernt sie nach `ms` wieder —
   für Toggle-Wobble (200 ms) und den Stepper-Wert-Crossfade (300 ms). Reflow
   zwischen remove/add startet die Keyframe-Animation zuverlässig neu (auch bei
   zwei Widersprüchen kurz hintereinander). Kein Flash beim Mount: die Start-seq
   wird nur gemerkt. Motion bleibt CSS-seitig auf transform/opacity begrenzt. */

export interface PulseParams { seq: number; cls: string; ms: number }

export function pulse(node: HTMLElement, params: PulseParams) {
  let last = params.seq;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    update(next: PulseParams) {
      if (next.seq === last) return;
      last = next.seq;
      node.classList.remove(next.cls);
      void node.offsetWidth; // Reflow erzwingen → Animation-Neustart
      node.classList.add(next.cls);
      clearTimeout(timer);
      timer = setTimeout(() => node.classList.remove(next.cls), next.ms);
    },
    destroy() { clearTimeout(timer); },
  };
}
