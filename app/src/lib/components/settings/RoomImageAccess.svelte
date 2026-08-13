<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    clearRoomImageAccess,
    getRoomImageAccess,
    pollRoomImageChatGptLogin,
    saveRoomImageApiKey,
    startRoomImageChatGptLogin,
    type RoomImageAccessStatus,
    type RoomImageChatGptLogin,
  } from '../../state/room-image-access.ts';

  let { onchange }: { onchange?: (status: RoomImageAccessStatus) => void } = $props();
  let access = $state<RoomImageAccessStatus>({ configured: false, mode: null, source: null });
  let apiKey = $state('');
  let login = $state<RoomImageChatGptLogin | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => { void load(); });
  onDestroy(() => { if (pollTimer) clearTimeout(pollTimer); });

  function update(next: RoomImageAccessStatus) {
    access = next;
    onchange?.(next);
  }

  async function load() {
    try { update(await getRoomImageAccess()); } catch (cause) { error = cause instanceof Error ? cause.message : 'Zugang konnte nicht geladen werden.'; }
  }

  async function saveKey() {
    if (!apiKey.trim() || busy) return;
    busy = true; error = null;
    try {
      update(await saveRoomImageApiKey(apiKey));
      apiKey = '';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'API-Key konnte nicht gespeichert werden.'; }
    finally { busy = false; }
  }

  async function startLogin() {
    if (busy) return;
    busy = true; error = null;
    try {
      login = await startRoomImageChatGptLogin();
      window.open(login.verificationUrl, '_blank', 'noopener,noreferrer');
      schedulePoll();
    } catch (cause) { error = cause instanceof Error ? cause.message : 'ChatGPT-Login konnte nicht gestartet werden.'; }
    finally { busy = false; }
  }

  function schedulePoll() {
    if (!login) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void pollLogin(), login.intervalSeconds * 1000);
  }

  async function pollLogin() {
    if (!login) return;
    try {
      const result = await pollRoomImageChatGptLogin(login.loginId);
      if (result === 'connected') {
        login = null;
        update(await getRoomImageAccess());
      } else schedulePoll();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'ChatGPT-Login konnte nicht abgeschlossen werden.';
      login = null;
    }
  }

  async function disconnect() {
    busy = true; error = null;
    try { update(await clearRoomImageAccess()); login = null; }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Zugang konnte nicht entfernt werden.'; }
    finally { busy = false; }
  }
</script>

<section class="room-image-access" aria-labelledby="room-image-access-title">
  <div>
    <span class="caps-label">OpenAI-Zugang</span>
    <h3 id="room-image-access-title">{access.configured ? 'Verbunden' : 'Zugang auswählen'}</h3>
    <p>{access.mode === 'chatgpt' ? 'ChatGPT-Abo' : access.mode === 'api_key' ? 'OpenAI API-Key' : 'Nutze dein ChatGPT-Abo oder einen API-Key.'}</p>
  </div>

  {#if access.configured}
    <button class="secondary-btn pressable" type="button" disabled={busy} onclick={disconnect}>Zugang ändern</button>
  {:else}
    <div class="room-image-access-options">
      <article>
        <h4>Mit ChatGPT anmelden</h4>
        <p>Einfachster Weg für Nutzer mit ChatGPT-Abo. Das Passwort bleibt bei OpenAI.</p>
        <button class="primary-btn pressable" type="button" disabled={busy || Boolean(login)} onclick={startLogin}>ChatGPT öffnen</button>
        {#if login}
          <div class="room-image-device-code" aria-live="polite">
            <span>Code bei OpenAI eingeben</span>
            <strong>{login.userCode}</strong>
            <a href={login.verificationUrl} target="_blank" rel="noreferrer">Anmeldeseite öffnen</a>
            <small>Hauser wartet automatisch auf die Bestätigung.</small>
          </div>
        {/if}
      </article>
      <article>
        <h4>OpenAI API-Key</h4>
        <p>Für eigene API-Abrechnung. Der Key wird nur serverseitig gespeichert.</p>
        <label>
          <span>API-Key</span>
          <input type="password" autocomplete="off" spellcheck="false" bind:value={apiKey} placeholder="sk-…" />
        </label>
        <button class="secondary-btn pressable" type="button" disabled={busy || !apiKey.trim()} onclick={saveKey}>API-Key speichern</button>
      </article>
    </div>
  {/if}
  {#if error}<p class="room-image-alert is-error" role="alert">{error}</p>{/if}
</section>
