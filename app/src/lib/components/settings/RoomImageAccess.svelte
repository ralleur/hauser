<script lang="ts">
  import { onDestroy } from 'svelte';
  import '../../../styles/room-images.css';
  import { m } from '../../../paraglide/messages.js';
  import {
    clearRoomImageAccess,
    getRoomImageAccess,
    pollRoomImageChatGptLogin,
    saveRoomImageApiKey,
    saveRoomImageCloudflare,
    startRoomImageChatGptLogin,
    validCloudflareAccountId,
    type RoomImageAccessStatus,
    type RoomImageChatGptLogin,
  } from '../../state/room-image-access.ts';

  /* Eine Frage nach der anderen (R55), damit niemand vor vier Optionen steht:
     ChatGPT-Abo? Cloudflare-Konto? Sonst selbst zeichnen lassen. `onmanual`
     meldet dem Assistenten den letzten Weg — der braucht keinen Zugang. */
  let { onchange, onmanual, onclose }: { onchange?: (status: RoomImageAccessStatus) => void; onmanual?: () => void; onclose?: () => void } = $props();
  let access = $state<RoomImageAccessStatus>({ configured: false, mode: null, source: null, valid: null });
  /* Ein grüner Punkt, der stimmt (R15, docs/23): Eine abgelaufene Anmeldung
     sieht in der Datei aus wie eine gültige. Sagt der Server, dass sie nicht
     mehr trägt, sagt es die Karte auch — und zeigt die Anmeldung sofort,
     statt sie hinter „Zugang ändern" zu verstecken. */
  const expired = $derived(access.configured && access.valid === false);
  type Question = 'chatgpt' | 'cloudflare' | 'manual';
  let question = $state<Question>('chatgpt');
  let connecting = $state<Question | null>(null);
  /* Mit stehendem Zugang bleiben die Fragen hinter „Weg ändern" — wer ChatGPT
     hat, sieht sonst nie, dass es Cloudflare und Selbstzeichnen gibt. Die
     Fragen laufen dann ohne Trennen: ChatGPT behalten, wechseln oder selbst
     zeichnen. */
  let choosing = $state(false);
  const connected = $derived(access.configured && !expired);
  let apiKey = $state('');
  let cloudflareAccount = $state('');
  let cloudflareToken = $state('');
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
    if (next.configured && next.valid !== false) choosing = false;
    onchange?.(next);
  }

  function keep() {
    choosing = false;
    connecting = null;
    question = 'chatgpt';
    onclose?.();
  }

  async function load() {
    try { update(await getRoomImageAccess()); } catch { error = m.rimg_access_err_load(); }
  }

  function next(from: Question) {
    connecting = null;
    error = null;
    question = from === 'chatgpt' ? 'cloudflare' : 'manual';
  }

  function back() {
    error = null;
    /* Mitten im Verbinden führt Zurück erst zur Frage, nicht gleich eine Frage weiter zurück. */
    if (connecting) { connecting = null; return; }
    question = question === 'manual' ? 'cloudflare' : 'chatgpt';
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

  const cloudflareReady = $derived(validCloudflareAccountId(cloudflareAccount) && cloudflareToken.trim().length >= 20);
  async function saveCloudflare() {
    if (!cloudflareReady || busy) return;
    busy = true; error = null;
    try {
      update(await saveRoomImageCloudflare(cloudflareAccount.trim().toLowerCase(), cloudflareToken.trim()));
      cloudflareToken = '';
    } catch (failure) { error = failure instanceof Error && failure.message ? failure.message : m.rimg_access_err_cloudflare(); }
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
    try { update(await clearRoomImageAccess()); login = null; question = 'chatgpt'; connecting = null; choosing = false; }
    catch { error = m.rimg_access_err_clear(); }
    finally { busy = false; }
  }

  function modeLabel(mode: RoomImageAccessStatus['mode']): string {
    if (mode === 'chatgpt') return m.rimg_access_chatgpt_plan();
    if (mode === 'api_key') return m.rimg_access_api_key();
    if (mode === 'cloudflare') return m.rimg_access_cloudflare();
    return m.rimg_access_intro();
  }
</script>

<section class="room-image-access" class:is-choosing={!connected || choosing} aria-labelledby="room-image-access-title">
  <div>
    <span class="caps-label">{m.rimg_way_label()}</span>
    <h3 id="room-image-access-title">
      {expired ? m.rimg_access_expired() : access.configured ? m.rimg_access_connected() : m.rimg_way_title()}
    </h3>
    <p>{expired ? m.rimg_access_expired_hint() : modeLabel(access.mode)}</p>
  </div>

  {#if connected && !choosing}
    <div class="room-image-way-actions">
      <button class="primary-btn pressable" type="button" disabled={busy} onclick={() => { choosing = true; question = 'chatgpt'; connecting = null; }}>{m.rimg_way_change()}</button>
      <button class="secondary-btn pressable" type="button" disabled={busy} onclick={disconnect}>{m.rimg_way_disconnect()}</button>
    </div>
  {:else}
    <div class="room-image-way" role="group" aria-label={m.rimg_way_title()}>
      {#if question === 'chatgpt'}
        <h4>{m.rimg_way_q_chatgpt()}</h4>
        <p>{m.rimg_way_q_chatgpt_hint()}</p>
        {#if connected && connecting !== 'chatgpt'}
          <div class="room-image-way-actions">
            <button class="primary-btn pressable" type="button" onclick={keep}>{m.rimg_way_keep()}</button>
            <button class="secondary-btn pressable" type="button" onclick={() => next('chatgpt')}>{m.rimg_way_no()}</button>
          </div>
        {:else if connecting === 'chatgpt'}
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
        {:else}
          <div class="room-image-way-actions">
            <button class="primary-btn pressable" type="button" onclick={() => { connecting = 'chatgpt'; error = null; }}>{m.rimg_way_yes_connect()}</button>
            <button class="secondary-btn pressable" type="button" onclick={() => next('chatgpt')}>{m.rimg_way_no()}</button>
          </div>
        {/if}
      {:else if question === 'cloudflare'}
        <h4>{m.rimg_way_q_cloudflare()}</h4>
        <p>{m.rimg_way_q_cloudflare_hint()}</p>
        {#if connecting === 'cloudflare'}
          <div class="room-image-access-options">
            <article class="is-wide">
              <p>{m.rimg_way_cloudflare_help()}</p>
              <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">{m.rimg_way_cloudflare_token_link()}</a>
              <label>
                <span>{m.rimg_way_cloudflare_account()}</span>
                <input type="text" autocomplete="off" spellcheck="false" autocapitalize="off" bind:value={cloudflareAccount} placeholder="0123456789abcdef0123456789abcdef" />
              </label>
              {#if cloudflareAccount && !validCloudflareAccountId(cloudflareAccount)}
                <small class="room-image-way-error">{m.rimg_way_cloudflare_account_err()}</small>
              {/if}
              <label>
                <span>{m.rimg_way_cloudflare_token()}</span>
                <input type="password" autocomplete="off" spellcheck="false" bind:value={cloudflareToken} />
              </label>
              <button class="primary-btn pressable" type="button" disabled={busy || !cloudflareReady} onclick={saveCloudflare}>{m.rimg_way_connect()}</button>
            </article>
          </div>
        {:else}
          <div class="room-image-way-actions">
            <button class="primary-btn pressable" type="button" onclick={() => { connecting = 'cloudflare'; error = null; }}>{m.rimg_way_yes_connect()}</button>
            <button class="secondary-btn pressable" type="button" onclick={() => next('cloudflare')}>{m.rimg_way_no()}</button>
          </div>
          <a class="room-image-way-link" href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noreferrer">{m.rimg_way_cloudflare_signup()}</a>
        {/if}
      {:else}
        <h4>{m.rimg_way_manual_title()}</h4>
        <p>{m.rimg_way_manual_hint()}</p>
        <div class="room-image-way-actions">
          <button class="primary-btn pressable" type="button" onclick={() => onmanual?.()}>{m.rimg_way_manual_go()}</button>
        </div>
      {/if}
      {#if question !== 'chatgpt' || connecting}
        <button class="room-image-way-back pressable" type="button" onclick={back}>{m.rimg_way_back()}</button>
      {:else if connected}
        <button class="room-image-way-back pressable" type="button" onclick={keep}>{m.rimg_way_back()}</button>
      {/if}
    </div>
  {/if}
  {#if error}<p class="room-image-alert is-error" role="alert">{error}</p>{/if}
</section>
