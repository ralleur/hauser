/* Kartenstil (Owner-Entscheidung 2026-09-12): Karten, die auf einem Bild
   liegen — Raumblatt am Telefon, Kontrollfläche auf der Bühne des Panels —
   sind dunkles Glas; Karten auf Fläche bleiben Standard. Wer den alten Stil
   möchte, schaltet hier zurück: dann sind auch die Flächen auf Bildern
   Standardkarten. Gerätelokal wie das Erscheinungsbild; das Attribut an der
   Wurzel schaltet die Token-Ebene in styles/on-image.css. */

export type CardStyle = 'glass' | 'standard';

const CARD_STYLE_KEY = 'hmi:card-style';

function loadCardStyle(): CardStyle {
  if (typeof localStorage === 'undefined') return 'glass';
  try {
    return localStorage.getItem(CARD_STYLE_KEY) === 'standard' ? 'standard' : 'glass';
  } catch { return 'glass'; }
}

const state = $state<{ style: CardStyle }>({ style: loadCardStyle() });

function apply(style: CardStyle): void {
  if (typeof document === 'undefined') return;
  if (style === 'standard') document.documentElement.dataset.cardStyle = 'standard';
  else delete document.documentElement.dataset.cardStyle;
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
