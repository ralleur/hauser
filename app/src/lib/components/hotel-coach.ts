/* ── Reine Regeln des Lern-Overlays ──
   Erkannt wird zentral über die interaktive Semantik des DOM, nicht durch
   Sonderlogik in jedem Control: Was als Bedienelement markiert ist, blendet das
   Overlay aus; ein Tipp auf nicht interaktiven Hintergrund blendet es wieder
   ein — auch nach vorheriger korrekter Benutzung.

   Das Overlay fängt selbst keine Pointer-Events ab und speichert keinen
   dauerhaften Onboarding-Status (docs/hotel-mode-plan.md §5). */

/**
 * Zentrale interaktive Semantik. `data-control` ist der ausdrückliche Marker
 * für Elemente, die bedienbar sind, ohne eine der Standardrollen zu tragen.
 */
export const HOTEL_COACH_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="checkbox"]',
  '[role="tab"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[data-control]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Nur das Nötige vom DOM, damit die Regel ohne Browser prüfbar bleibt. */
export interface HotelCoachTarget {
  closest(selectors: string): unknown;
}

function coachTarget(value: unknown): HotelCoachTarget | null {
  return value !== null
    && typeof value === 'object'
    && typeof (value as HotelCoachTarget).closest === 'function'
    ? value as HotelCoachTarget
    : null;
}

/** Ob das Pointer-Ziel innerhalb eines echten Bedienelements liegt. */
export function isHotelControlTarget(target: unknown): boolean {
  const element = coachTarget(target);
  if (!element) return false;
  const match = element.closest(HOTEL_COACH_CONTROL_SELECTOR);
  return match !== null && match !== undefined;
}

/**
 * Nächste Sichtbarkeit nach einem Pointerereignis. Ein Bedienelement blendet
 * sofort aus — ohne auf eine Home-Assistant-Antwort zu warten; Hintergrund
 * blendet wieder ein.
 */
export function nextCoachVisibility(target: unknown): boolean {
  return !isHotelControlTarget(target);
}
