/* B-27 C: Ein wartender Service Worker wird der sichtbaren App nicht mehr
   aufgezwungen, sondern angeboten. Bewusst ein eigenes, winziges Modul: die
   Phone-Shell braucht nur dieses Flag, nicht die Lifecycle-Registrierung —
   und der Startgraph traegt keinen Workbox-Import mehr als noetig. */
export const pwaUpdatePrompt = $state({ pending: false });

let activateWaiting: (() => void) | null = null;

/** Meldet einen wartenden Worker, den der Benutzer selbst uebernehmen darf. */
export function offerPwaUpdate(activate: () => void): void {
  activateWaiting = activate;
  pwaUpdatePrompt.pending = true;
}

/** Tap auf den Hinweis: der wartende Worker uebernimmt und die Seite laedt neu. */
export function applyPwaUpdate(): void {
  pwaUpdatePrompt.pending = false;
  const activate = activateWaiting;
  activateWaiting = null;
  activate?.();
}
