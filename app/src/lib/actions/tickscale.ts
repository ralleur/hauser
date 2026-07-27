/* TickScale-Action (Hauser-Regler): Pointer-Drag über eine Leiter kleiner
   Rechtecke → Wert in [min,max]. Vertikal ist oben = max (hell/kühl oben),
   horizontal ist links = min. Wie der ValueSlider (docs/02): der Finger führt
   während des Drags, erst der Release ist `final` (→ Command). Zusätzlich
   Tastatur (role=slider, Pfeile/Home/End) für Barrierefreiheit — jeder Tasten-
   druck committet sofort (final). Die Optik (gefüllte/aktive Ticks) rendert die
   Komponente reaktiv aus `value`; die Action macht nur Input + Pointer-Capture. */

export interface TickScaleParams {
  value: number;
  min: number;
  max: number;
  step?: number;       // Rundung der Pointer-Position (default 1)
  keyStep?: number;    // Schrittweite pro Pfeiltaste (default step)
  orientation?: 'vertical' | 'horizontal';
  onChange: (val: number, final: boolean) => void;
  disabled?: boolean;
}

export function tickscale(node: HTMLElement, params: TickScaleParams) {
  let p = params;
  const step = () => p.step ?? 1;
  const keyStep = () => p.keyStep ?? p.step ?? 1;
  const vertical = () => (p.orientation ?? 'vertical') === 'vertical';

  const clampRound = (v: number) => {
    const s = step();
    const snapped = Math.round(v / s) * s;
    return Math.max(p.min, Math.min(p.max, snapped));
  };

  const valFromEvent = (e: PointerEvent) => {
    const rect = node.getBoundingClientRect();
    const frac = vertical()
      ? 1 - (e.clientY - rect.top) / Math.max(1, rect.height)  // oben = max
      : (e.clientX - rect.left) / Math.max(1, rect.width);     // links = min
    return clampRound(p.min + Math.max(0, Math.min(1, frac)) * (p.max - p.min));
  };

  let dragging = false;

  const onDown = (e: PointerEvent) => {
    if (p.disabled || e.button !== 0) return;
    dragging = true;
    node.classList.add('is-dragging');
    try { node.setPointerCapture(e.pointerId); } catch { /* noop */ }
    p.onChange(valFromEvent(e), false);
  };
  const onMove = (e: PointerEvent) => { if (dragging) p.onChange(valFromEvent(e), false); };
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    node.classList.remove('is-dragging');
    p.onChange(valFromEvent(e), true); // Release → Command (docs/02)
  };

  const onKey = (e: KeyboardEvent) => {
    if (p.disabled) return;
    const up = vertical() ? 'ArrowUp' : 'ArrowRight';
    const down = vertical() ? 'ArrowDown' : 'ArrowLeft';
    let next: number | null = null;
    if (e.key === up || e.key === 'PageUp') next = clampRound(p.value + keyStep());
    else if (e.key === down || e.key === 'PageDown') next = clampRound(p.value - keyStep());
    else if (e.key === 'Home') next = p.min;
    else if (e.key === 'End') next = p.max;
    if (next === null) return;
    e.preventDefault();
    if (next !== p.value) p.onChange(next, true);
  };

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  node.addEventListener('keydown', onKey);

  return {
    update(next: TickScaleParams) { p = next; },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', end);
      node.removeEventListener('pointercancel', end);
      node.removeEventListener('keydown', onKey);
    },
  };
}
