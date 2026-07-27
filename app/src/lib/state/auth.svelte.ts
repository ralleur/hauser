/* ============================================
   Auth-Zustand für die UI (ADR-018) — der Login-Gate über dem HaBackend. Nur
   relevant, wenn das echte HA-Backend läuft; gegen FakeBackend bleibt `needsToken`
   dauerhaft false. Der Token wird NIE hier gehalten, nur an das Backend
   (localStorage) durchgereicht — nie ins Repo/Build (Leitplanke docs/04).
   ============================================ */

import { backend } from '../adapter/runtime.svelte.ts';
import { HaBackend } from '../adapter/ha-backend.ts';

const ha = backend instanceof HaBackend ? backend : null;

const state = $state({
  usingHa: ha !== null,
  needsToken: ha ? !ha.hasToken() : false,
  invalid: false,
});

// Auth-Fehler (Token abgelaufen/ungültig) → Login erneut zeigen (docs/04).
ha?.onAuthError(() => { state.needsToken = true; state.invalid = true; });

export function authState() {
  return state;
}

/* Einstellungen → „Zugangstoken erneuern": zeigt den Login-Screen erneut.
   No-op gegen das FakeBackend (dort gibt es keinen Token). */
export function requestToken(): void {
  if (!ha) return;
  state.invalid = false;
  state.needsToken = true;
}

export function submitToken(token: string): void {
  const t = token.trim();
  if (!t || !ha) return;
  state.invalid = false;
  state.needsToken = false;
  ha.setToken(t);
}
