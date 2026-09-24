/* Lage eines Elements innerhalb des App-Rahmens als CSS-Variablen (--lite-x,
   --lite-y). Glass Lite ersetzt den Backdrop-Blur der Notizen-Scheiben durch
   eine vorgerechnete, unscharfe Kopie des Hintergrundbilds; damit dessen
   Ausschnitt exakt unter der Scheibe liegt, muss das Stylesheet wissen, wo die
   Scheibe im Rahmen sitzt (styles/on-image.css, Abschnitt Glass Lite).

   Gemessen über die offsetParent-Kette, nicht über getBoundingClientRect:
   die Kette kennt keine Transformationen, deshalb stimmt der Wert auch
   während der Einblend-Animation des Screens. Neu bei Größenänderung. */

export function liteBackdrop(node: HTMLElement) {
  const measure = () => {
    let x = 0;
    let y = 0;
    let el: HTMLElement | null = node;
    while (el && !el.classList.contains('app')) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    node.style.setProperty('--lite-x', `${x}px`);
    node.style.setProperty('--lite-y', `${y}px`);
  };
  measure();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(node);
  window.addEventListener('resize', measure);
  return {
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    },
  };
}
