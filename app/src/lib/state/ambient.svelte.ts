/* ── Manueller Standby-Trigger (B-06) ──
   Der Standby-Button in der Status-Bar versetzt das Panel sofort in den
   Ambient-/Idle-Zustand — ohne auf den Inaktivitäts-Timer zu warten. Kein
   neuer Screen, kein eigener Zustand: der Trigger ist nur ein Zähler, auf den
   AmbientLayer reaktiv mit demselben showAmbient() antwortet wie auf den
   Timeout. Wecken (Tap) und Timer-Verhalten bleiben unverändert. */

export const ambientRequest = $state({
  seq: 0,
  mode: 'normal' as 'normal' | 'preview' | 'deep-night-preview',
  /* Bildschirmpunkt des auslösenden Knopfs: von dort zieht sich beim
     manuellen Sperren der Ring zusammen. Der Timer hat keinen Punkt. */
  origin: null as { x: number; y: number } | null,
});
export const ambientState = $state({ active: false });

export function setAmbientActive(active: boolean): void {
  ambientState.active = active;
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('hmi:ambient-change', { detail: { active } }));
  }
}

export function requestAmbient(origin: { x: number; y: number } | null = null): void {
  ambientRequest.mode = 'normal';
  ambientRequest.origin = origin;
  ambientRequest.seq++;
}

/** Mitte eines Knopfs als Ursprung — auch bei Tastatur-Auslösung sinnvoll. */
export function originOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Vorschau aus den Einstellungen heraus: zeigt den Standby einschließlich
 * Stadtplan, auch wenn dessen Schalter noch aus ist — sonst zeigt eine
 * Vorschau nicht das, was sie ankündigt. Der nächste Tap kehrt an die Stelle
 * zurück, von der sie gestartet wurde, statt wie ein echter Standby nach Home
 * zu wecken. */
export function requestAmbientPreview(): void {
  ambientRequest.mode = 'preview';
  ambientRequest.origin = null;
  ambientRequest.seq++;
}

/** Zeigt denselben Deep-Night-Zustand wie die Zeitautomatik, unabhängig von
 * Uhrzeit und Schalter. Der nächste Tap beendet die Vorschau wie jeden Standby. */
export function requestDeepNightPreview(): void {
  ambientRequest.mode = 'deep-night-preview';
  ambientRequest.origin = null;
  ambientRequest.seq++;
}
