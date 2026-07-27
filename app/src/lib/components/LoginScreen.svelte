<script lang="ts">
  /* Login-Gate (ADR-018): Token-Eingabe für das echte HA. Erscheint nur, wenn das
     HaBackend läuft und kein (gültiger) Token in localStorage liegt. Der Token
     wird an das Backend durchgereicht (localStorage) — nie ins Repo/Build. */
  import { authState, submitToken } from '../state/auth.svelte.ts';

  const auth = authState();
  let token = $state('');

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    submitToken(token);
    token = '';
  }
</script>

<div class="login-gate" role="dialog" aria-modal="true" aria-labelledby="login-title">
  <form class="login-card" onsubmit={onSubmit}>
    <h1 id="login-title" class="login-title">Home Assistant verbinden</h1>
    <p class="login-hint">
      Long-Lived Access Token aus deinem HA-Profil (Sicherheit → „Long-Lived
      Access Tokens" → Token erstellen). Er bleibt lokal im Browser.
    </p>

    {#if auth.invalid}
      <p class="login-error" role="alert">Token ungültig oder abgelaufen — bitte neu eingeben.</p>
    {/if}

    <input
      class="login-input"
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="eyJhbGciOi…"
      aria-label="Long-Lived Access Token"
      bind:value={token}
    />

    <button class="login-submit pressable" type="submit" disabled={token.trim() === ''}>
      Verbinden
    </button>
  </form>
</div>
