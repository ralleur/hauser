<script lang="ts">
  import { onDestroy } from 'svelte';
  import '../../../styles/room-images.css';
  import { m } from '../../../paraglide/messages.js';
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
  let codeCopied = $state(false);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => { void load(); });
  onDestroy(() => {
    if (pollTimer) clearTimeout(pollTimer);
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  // Das Panel wird auch über http:// im LAN ausgeliefert; dort fehlt
  // navigator.clipboard, deshalb der execCommand-Rückfallweg.
  async function copyCode(code: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const field = document.createElement('textarea');
        field.value = code;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.append(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('copy rejected');
      }
      codeCopied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { codeCopied = false; }, 2_000);
    } catch {
      error = m.rimg_access_err_copy();
    }
  }

  function update(next: RoomImageAccessStatus) {
    access = next;
    onchange?.(next);
  }

  async function load() {
    try { update(await getRoomImageAccess()); } catch { error = m.rimg_access_err_load(); }
  }

  async function saveKey() {
    if (!apiKey.trim() || busy) return;
    busy = true; error = null;
    try {
      update(await saveRoomImageApiKey(apiKey));
      apiKey = '';
    } catch { error = m.rimg_access_err_save(); }
    finally { busy = false; }
  }

  async function startLogin() {
    if (busy) return;
    busy = true; error = null;
    try {
      login = await startRoomImageChatGptLogin();
      window.open(login.verificationUrl, '_blank', 'noopener,noreferrer');
      schedulePoll();
    } catch { error = m.rimg_access_err_login_start(); }
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
    } catch {
      error = m.rimg_access_err_login_finish();
      login = null;
    }
  }

  async function disconnect() {
    busy = true; error = null;
    try { update(await clearRoomImageAccess()); login = null; }
    catch { error = m.rimg_access_err_clear(); }
    finally { busy = false; }
  }
</script>

<section class="room-image-access" aria-labelledby="room-image-access-title">
  <div>
    <span class="caps-label">{m.rimg_access_label()}</span>
    <h3 id="room-image-access-title">{access.configured ? m.rimg_access_connected() : m.rimg_access_choose()}</h3>
    <p>{access.mode === 'chatgpt' ? m.rimg_access_chatgpt_plan() : access.mode === 'api_key' ? m.rimg_access_api_key() : m.rimg_access_intro()}</p>
  </div>

  {#if access.configured}
    <button class="secondary-btn pressable" type="button" disabled={busy} onclick={disconnect}>{m.rimg_access_change()}</button>
  {:else}
    <div class="room-image-access-options">
      <article>
        <h4>{m.rimg_access_signin()}</h4>
        <p>{m.rimg_access_signin_hint()}</p>
        <button class="primary-btn pressable" type="button" disabled={busy || Boolean(login)} onclick={startLogin}>{m.rimg_access_open_chatgpt()}</button>
        {#if login}
          <div class="room-image-device-code" aria-live="polite">
            <span>{m.rimg_access_code_hint()}</span>
            <button class="room-image-device-code-copy pressable" type="button"
                    aria-label={m.rimg_access_copy_label({ code: login.userCode })}
                    onclick={() => copyCode(login!.userCode)}>
              <strong>{login.userCode}</strong>
              <span aria-hidden="true">{codeCopied ? m.rimg_access_copied() : m.rimg_access_copy()}</span>
            </button>
            <a href={login.verificationUrl} target="_blank" rel="noreferrer">{m.rimg_access_open_page()}</a>
            <small>{m.rimg_access_waiting()}</small>
          </div>
        {/if}
      </article>
      <article>
        <h4>{m.rimg_access_api_key()}</h4>
        <p>{m.rimg_access_key_hint()}</p>
        <label>
          <span>{m.rimg_access_key_label()}</span>
          <input type="password" autocomplete="off" spellcheck="false" bind:value={apiKey} placeholder="sk-…" />
        </label>
        <button class="secondary-btn pressable" type="button" disabled={busy || !apiKey.trim()} onclick={saveKey}>{m.rimg_access_key_save()}</button>
      </article>
    </div>
  {/if}
  {#if error}<p class="room-image-alert is-error" role="alert">{error}</p>{/if}
</section>
