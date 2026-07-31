/* ============================================
   Auth-Zustand für die UI (ADR-018) — der Login-Gate über dem HaBackend. Nur
   relevant, wenn das echte HA-Backend läuft; gegen FakeBackend bleibt `needsToken`
   dauerhaft false. Der Token wird NIE hier gehalten, nur an das Backend
   (localStorage) durchgereicht — nie ins Repo/Build (Leitplanke docs/04).
   ============================================ */

import { backend } from '../adapter/runtime.svelte.ts';
import { HaBackend } from '../adapter/ha-backend.ts';
import type { AuthRequiredReason } from '../adapter/types.ts';

let ha = backend instanceof HaBackend ? backend : null;

const state = $state({
  usingHa: ha !== null,
  needsToken: ha ? !ha.hasToken() : false,
  invalid: false,
});

function onAuthError(reason: AuthRequiredReason): void {
  state.needsToken = true;
  state.invalid = reason === 'invalid-auth';
}

// Auth-Fehler (Token abgelaufen/ungültig) → Login erneut zeigen (docs/04).
ha?.onAuthError(onAuthError);

export function authState() {
  return state;
}

/** Nach dem zentralen Config-Sync erneut aus dem Backend-Storage lesen. So kann
 * die Shell sofort rendern, ohne dass ein Millisekunden später geladener Token
 * sie dauerhaft im vorläufigen Login-Zustand festhält. */
export function syncAuthState(): void {
  ha = backend instanceof HaBackend ? backend : null;
  ha?.onAuthError(onAuthError);
  state.usingHa = ha !== null;
  state.needsToken = ha ? !ha.hasToken() : false;
  if (!state.needsToken) state.invalid = false;
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
