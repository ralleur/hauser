<script lang="ts">
  /* Fernzugriff: Zustand des Tunnels, einmaliger Tailscale-Login (Link und
     QR), eigene Adresse als Alternative. Der QR-Renderer wird nachgeladen. */
  import { onMount } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import { loadRemoteStatus, remoteUi, resetRemote, setOwnRemoteUrl } from '../../state/remote.svelte.ts';

  let qrMarkup = $state('');

  onMount(() => {
    void loadRemoteStatus();
    const tick = setInterval(() => { void loadRemoteStatus(); }, 5000);
    return () => clearInterval(tick);
  });

  $effect(() => {
    const link = remoteUi.status?.authUrl;
    if (!link) { qrMarkup = ''; return; }
    let cancelled = false;
    void (async () => {
      try {
        const { default: qrcode } = await import('qrcode-generator');
        const code = qrcode(0, 'M');
        code.addData(link);
        code.make();
        if (!cancelled) qrMarkup = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch { /* Link bleibt */ }
    })();
    return () => { cancelled = true; };
  });

  const stateLabel = $derived.by(() => {
    const s = remoteUi.status;
    if (!s) return m.sys_remote_state_checking();
    switch (s.state) {
      case 'unavailable': return m.sys_remote_state_unavailable();
      case 'starting': return m.sys_remote_state_starting();
      case 'needs-login': return m.sys_remote_state_needs_login();
      case 'running': return m.sys_remote_state_running({ url: s.url ?? '' });
      case 'funnel-error': return m.sys_remote_state_funnel_error();
      default: return m.sys_remote_state_stopped();
    }
  });
</script>

<div class="settings-row is-stacked" data-setting-id="remote-access">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_remote_title()}</span>
    <span class="settings-row-sub">{m.sys_remote_hint()}</span>
  </div>
  <p class="remote-state">{stateLabel}</p>
  {#if remoteUi.status?.state === 'needs-login' && remoteUi.status.authUrl}
    <div class="remote-login">
      {#if qrMarkup}
        <div class="remote-qr" role="img" aria-label={m.sys_remote_login_qr()}>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html qrMarkup}
        </div>
      {/if}
      <div class="remote-login-text">
        <p class="remote-state">{m.sys_remote_login_hint()}</p>
        <a class="remote-button pressable" href={remoteUi.status.authUrl} target="_blank" rel="noreferrer">{m.sys_remote_login_button()}</a>
      </div>
    </div>
  {/if}
  {#if remoteUi.status?.state === 'funnel-error'}
    <p class="remote-error">{remoteUi.status.error}</p>
    <p class="remote-state">{m.sys_remote_funnel_hint()}</p>
  {/if}
  {#if remoteUi.status?.enabled && remoteUi.status.state !== 'starting'}
    <button type="button" class="remote-button pressable" onclick={() => void resetRemote()}>{m.sys_remote_reset()}</button>
  {/if}
</div>

<div class="settings-row is-stacked" data-setting-id="remote-own-url">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_remote_own_url()}</span>
    <span class="settings-row-sub">{m.sys_remote_own_url_hint()}</span>
  </div>
  <input class="settings-input" type="url" placeholder="https://haus.example.org"
         aria-label={m.sys_remote_own_url()} autocomplete="off" spellcheck="false"
         value={remoteUi.ownUrl}
         onchange={(e) => setOwnRemoteUrl(e.currentTarget.value)} />
</div>

<style>
  .remote-state, .remote-error { margin: 0; color: var(--color-text-secondary); line-height: var(--leading-relaxed); overflow-wrap: anywhere; }
  .remote-error { color: var(--color-danger, #c0392b); }
  .remote-login { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
  .remote-qr { width: min(180px, 60%); background: #fff; padding: var(--space-2); border-radius: var(--radius-md); }
  .remote-qr :global(svg) { display: block; width: 100%; height: auto; }
  .remote-login-text { display: grid; gap: var(--space-2); flex: 1 1 200px; }
  .remote-button { display: inline-flex; align-items: center; min-height: var(--touch-preferred); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0 var(--space-4); background: var(--color-surface-0); color: var(--color-text-primary); font: inherit; font-weight: var(--font-weight-semibold); cursor: pointer; text-decoration: none; justify-self: start; }
</style>
