// SPDX-License-Identifier: AGPL-3.0-only
/* Dialoge bei Platzmangel als Ganzes verkleinern, niemals über ihre bisherige
   Größe hinaus. Lange Listen bleiben ab 75 % scrollbar und damit lesbar.
   CSS zoom hält Layout, Hitboxen und Pointer-Koordinaten zusammen. */
export function fitOverlay(node: HTMLElement, minScale = 0.75) {
  const container = node.parentElement!;
  const original = {
    zoom: node.style.zoom,
    width: node.style.width,
    maxHeight: node.style.maxHeight,
  };
  let frame = 0;

  const measure = () => {
    frame = 0;
    const bounds = getComputedStyle(container);
    const width = container.clientWidth - parseFloat(bounds.paddingLeft) - parseFloat(bounds.paddingRight);
    const height = container.clientHeight - parseFloat(bounds.paddingTop) - parseFloat(bounds.paddingBottom);
    if (width <= 0 || height <= 0) return;

    // Jedes Mal von der Originalgröße ausgehen: Rotation und Inhaltswechsel
    // dürfen den vorherigen Skalierungsfaktor nicht erneut multiplizieren.
    node.style.zoom = '1';
    node.style.width = original.width;
    node.style.maxHeight = 'none';
    const naturalWidth = node.offsetWidth;
    const naturalHeight = node.offsetHeight;
    if (!naturalWidth || !naturalHeight) return;

    const scale = Math.min(1, width / naturalWidth, Math.max(minScale, height / naturalHeight));
    node.style.width = `${naturalWidth}px`;
    node.style.zoom = String(scale);
    node.style.maxHeight = `${height / scale}px`;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(container);
  resize.observe(node);
  const content = new MutationObserver(schedule);
  content.observe(node, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', schedule);
  measure();

  return {
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      content.disconnect();
      window.removeEventListener('resize', schedule);
      Object.assign(node.style, original);
    },
  };
}
