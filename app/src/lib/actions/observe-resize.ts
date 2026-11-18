// SPDX-License-Identifier: AGPL-3.0-only

/** Layoutänderungen erst nach der ResizeObserver-Auslieferung anwenden.
 * Sonst kann das Messen eines Kindes den beobachteten Elternrahmen erneut
 * verändern und „undelivered notifications“ auslösen. */
export function observeResize(measure: () => void, ...nodes: Element[]): () => void {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
  });
  nodes.forEach((node) => observer.observe(node));
  return () => { observer.disconnect(); cancelAnimationFrame(frame); };
}
