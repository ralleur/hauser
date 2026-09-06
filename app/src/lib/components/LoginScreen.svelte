<script lang="ts">
  import { m } from '../../paraglide/messages.js';
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
    <h1 id="login-title" class="login-title">{m.login_title()}</h1>
    <p class="login-hint">{m.login_hint()}</p>

    {#if auth.invalid}
      <p class="login-error" role="alert">{m.login_error()}</p>
    {/if}

    <input
      class="login-input"
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="eyJhbGciOi…"
      aria-label={m.login_token_label()}
      bind:value={token}
    />

    <button class="login-submit pressable" type="submit" disabled={token.trim() === ''}>
      {m.login_submit()}
    </button>
  </form>
</div>
