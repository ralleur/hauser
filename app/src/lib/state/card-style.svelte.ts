/* Kartenstil (Owner-Entscheidung 2026-09-12): Karten, die auf einem Bild
   liegen — Raumblatt am Telefon, Kontrollfläche auf der Bühne des Panels —
   sind dunkles Glas; Karten auf Fläche bleiben Standard. Wer den alten Stil
   möchte, schaltet hier zurück: dann sind auch die Flächen auf Bildern
   Standardkarten. Gerätelokal wie das Erscheinungsbild; das Attribut an der
   Wurzel schaltet die Token-Ebene in styles/on-image.css.

   Glass Lite (Owner-Entscheidung 2026-09-13): derselbe Look mit weniger
   Rechenarbeit — Blur nur auf der obersten Fläche und mit kleinerem Radius,
   darunter statische Scheiben. Für Geräte, auf denen das volle Glas ruckelt
   (iPad Pro 2018). Die Wurzel trägt dann `data-card-style="glass-lite"`; alle
   Glas-Regeln (`:not([data-card-style="standard"])`) gelten weiter, die
   Lite-Regeln liegen darüber. */

export type CardStyle = 'glass' | 'glass-lite' | 'standard';
const CARD_STYLES: readonly CardStyle[] = ['glass', 'glass-lite', 'standard'];

export function normalizeCardStyle(value: unknown): CardStyle {
  return CARD_STYLES.includes(value as CardStyle) ? value as CardStyle : 'glass';
}

const CARD_STYLE_KEY = 'hmi:card-style';

function loadCardStyle(): CardStyle {
  if (typeof localStorage === 'undefined') return 'glass';
  try {
    return normalizeCardStyle(localStorage.getItem(CARD_STYLE_KEY));
  } catch { return 'glass'; }
}

const state = $state<{ style: CardStyle }>({ style: loadCardStyle() });

function apply(style: CardStyle): void {
  if (typeof document === 'undefined') return;
  if (style === 'glass') delete document.documentElement.dataset.cardStyle;
  else document.documentElement.dataset.cardStyle = style;
}

export function cardStyle(): CardStyle {
  return state.style;
}

export function setCardStyle(style: CardStyle): void {
  state.style = style;
  apply(style);
  if (typeof localStorage === 'undefined') return;
  try {
    if (style === 'glass') localStorage.removeItem(CARD_STYLE_KEY);
    else localStorage.setItem(CARD_STYLE_KEY, style);
  } catch { /* best-effort */ }
}

apply(state.style);
