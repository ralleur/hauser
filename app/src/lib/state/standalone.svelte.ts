/* ── Standalone-Erkennung (Home-Screen-Web-App) ──
   Läuft die App als installierte Home-Screen-App (ohne Safari-Chrome)?
   - iOS/iPadOS meldet das über das nicht-standardisierte `navigator.standalone`.
   - Der Standard-Weg ist die `display-mode: standalone` Media-Query (Chrome/Android,
     neuere Safari). Beides ODER-verknüpft deckt iPadOS 17 zuverlässig ab.
   Reines Lese-Signal — kein Netzwerk, kein Backend. */

const mql =
  typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia('(display-mode: standalone)')
    : null;

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  // `standalone` existiert nur auf iOS/iPadOS-Safari.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || (mql?.matches ?? false);
}

/** Reaktiv: true, sobald die App im Standalone-/Kiosk-Modus läuft. */
export const standalone = $state({ active: detect() });

// display-mode kann sich zur Laufzeit ändern (z. B. Fenster-Modus wechselt am
// Desktop); auf iPadOS praktisch statisch, aber billig und korrekt zu beobachten.
mql?.addEventListener?.('change', (e) => {
  standalone.active = e.matches || (window.navigator as { standalone?: boolean }).standalone === true;
});
