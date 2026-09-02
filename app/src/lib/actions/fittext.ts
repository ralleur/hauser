/* Schrift-Einpassung: statt einen zu langen Namen abzuschneiden, verkleinert
   diese Action die Schrift so weit, bis er in seine Zeilen passt — bis zu einer
   Untergrenze, damit nichts unlesbar wird. Darunter greift wieder die
   Kürzung des Stylesheets.

   Maßstab ist die Höhe, die das Stylesheet dem Text ohnehin einräumt (z. B.
   zwei Zeilen): Sie bleibt das Budget. Wird die Schrift kleiner, passen in
   dasselbe Budget mehr Zeilen — die Kürzungsgrenze wächst deshalb mit. Ein
   langer Name landet so in drei kleineren statt zwei abgeschnittenen Zeilen,
   ohne dass die Kachel höher wird.

   Neu berechnet wird bei Größenänderung und bei jedem Text-Wechsel — dafür
   reicht der Text als Parameter, sein Vergleich stößt die Aktualisierung an.
   Stil analog longpress.ts. */

export interface FitTextParams {
  /** Auslöser für die Neuberechnung: der dargestellte Text. */
  text?: string;
  /** Kleinste zulässige Schriftgröße in px. */
  min?: number;
}

const STEP = 0.5; // px je Schritt — fein genug, um kaum sichtbar zu bleiben

export function fittext(node: HTMLElement, params: FitTextParams = {}) {
  let min = params.min ?? 10;
  let last = params.text;
  let frame = 0;
  let adjusting = false;

  const fit = () => {
    adjusting = true;
    node.style.fontSize = '';
    node.style.removeProperty('-webkit-line-clamp');
    node.style.removeProperty('line-clamp');
    const style = getComputedStyle(node);
    const base = Number.parseFloat(style.fontSize) || 16;
    const lineRatio = (Number.parseFloat(style.lineHeight) || base * 1.3) / base;
    /* Budget = die Höhe, die der Text im Stylesheet bekommt. Sie legt fest,
       wie viele kleinere Zeilen erlaubt sind; ob der Text hineinpasst, sagt
       dagegen die tatsächlich sichtbare Höhe. */
    const budget = node.clientHeight;
    const clipped = () => (
      node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
    );

    let size = base;
    while (size - STEP >= min && clipped()) {
      size -= STEP;
      const lines = Math.max(1, Math.floor(budget / (size * lineRatio)));
      node.style.fontSize = `${size}px`;
      node.style.setProperty('-webkit-line-clamp', String(lines));
      node.style.setProperty('line-clamp', String(lines));
    }
    // Passt der Text ohnehin, bleiben die Stufen des Stylesheets stehen.
    if (size === base) {
      node.style.fontSize = '';
      node.style.removeProperty('-webkit-line-clamp');
      node.style.removeProperty('line-clamp');
    }
    adjusting = false;
  };

  const schedule = () => {
    if (adjusting) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(node);
  schedule();

  return {
    update(next: FitTextParams) {
      min = next.min ?? 10;
      if (next.text === last) return;
      last = next.text;
      schedule();
    },
    destroy() {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
