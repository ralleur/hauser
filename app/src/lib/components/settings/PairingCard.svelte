<script lang="ts">
  /* Kopplung der Companion-App (Plan 21, Stufe 0): Einmalcode als QR-Code,
     dazu die Liste gekoppelter Geräte mit Widerruf. Der QR-Renderer wird
     wie in DeviceAddress erst hier nachgeladen. */
  import { onMount } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import { loadDevices, pairingUi, revokeDevice, startPairing, stopPairing, writeRoomTag } from '../../state/pairing.svelte.ts';
  import { nativeBridge } from '../../native/bridge.ts';
  import { ROOM_SEED } from '../../config/household-runtime-data.ts';

  const canWriteTags = !!nativeBridge().nfc;
  let tagRoom = $state(ROOM_SEED[0]?.id ?? '');
  let tagState = $state<'idle' | 'writing' | 'done' | 'failed'>('idle');
  async function writeTag() {
    if (!tagRoom) return;
    tagState = 'writing';
    tagState = (await writeRoomTag(tagRoom)) ? 'done' : 'failed';
  }
  import { getLocale } from '../../../paraglide/runtime.js';

  let qrMarkup = $state('');
  let now = $state(Date.now());

  const expired = $derived(!!pairingUi.active && pairingUi.active.expiresAt <= now);

  onMount(() => {
    void loadDevices();
    if (pairingUi.autoStart) {
      pairingUi.autoStart = false;
      void startPairing();
    }
    const tick = setInterval(() => { now = Date.now(); }, 1000);
    return () => { clearInterval(tick); stopPairing(); };
  });

  $effect(() => {
    const link = pairingUi.active?.link;
    if (!link) { qrMarkup = ''; return; }
    let cancelled = false;
    void (async () => {
      try {
        const { default: qrcode } = await import('qrcode-generator');
        const code = qrcode(0, 'M');
        code.addData(link);
        code.make();
        if (!cancelled) qrMarkup = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch { /* Ohne QR bleibt der Code zum Abtippen. */ }
    })();
    return () => { cancelled = true; };
  });

  function expiresLabel(at: number): string {
    return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  }

  function seenLabel(device: { lastSeenAt: string | null; lastSeenVia: 'lan' | 'remote' | null }): string {
    if (!device.lastSeenAt) return m.sys_app_pairing_never();
    const when = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(device.lastSeenAt));
    return device.lastSeenVia === 'remote'
      ? m.sys_app_pairing_last_seen_remote({ when })
      : m.sys_app_pairing_last_seen_lan({ when });
  }
</script>

<div class="settings-row is-stacked" data-setting-id="app-pairing">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_app_pairing_title()}</span>
    <span class="settings-row-sub">{m.sys_app_pairing_hint()}</span>
  </div>

  {#if pairingUi.active && !expired}
    <div class="pairing">
      {#if qrMarkup}
        <div class="pairing-qr" role="img" aria-label={m.sys_app_pairing_qr_label()}>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html qrMarkup}
        </div>
      {/if}
      <div class="pairing-text">
        <p class="pairing-scan">{m.sys_app_pairing_scan()}</p>
        <code class="pairing-code">{pairingUi.active.code}</code>
        <p class="pairing-expires">{m.sys_app_pairing_expires({ time: expiresLabel(pairingUi.active.expiresAt) })}</p>
        <button type="button" class="pairing-button pressable" onclick={() => stopPairing()}>{m.sys_app_pairing_done()}</button>
      </div>
    </div>
  {:else}
    {#if expired}
      <p class="pairing-expires">{m.sys_app_pairing_expired()}</p>
    {/if}
    {#if pairingUi.error}
      <p class="pairing-expires">{m.sys_app_pairing_error()}</p>
    {/if}
    {#if pairingUi.noStay}
      <p class="pairing-expires">{m.sys_app_pairing_no_stay()}</p>
    {/if}
    <div class="pairing-actions">
      <button type="button" class="pairing-button pressable" disabled={pairingUi.loading} onclick={() => void startPairing()}>
        {m.sys_app_pair_button()}
      </button>
      <button type="button" class="pairing-button pressable" disabled={pairingUi.loading} onclick={() => void startPairing(true)}>
        {m.sys_app_pair_guest_button()}
      </button>
    </div>
  {/if}
</div>

{#if canWriteTags && ROOM_SEED.length}
  <div class="settings-row is-stacked" data-setting-id="app-nfc">
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_app_nfc_title()}</span>
      <span class="settings-row-sub">{m.sys_app_nfc_hint()}</span>
    </div>
    <div class="pairing-actions">
      <select class="settings-input" bind:value={tagRoom} aria-label={m.sys_app_nfc_room()}>
        {#each ROOM_SEED as room (room.id)}
          <option value={room.id}>{room.name}</option>
        {/each}
      </select>
      <button type="button" class="pairing-button pressable" disabled={tagState === 'writing'} onclick={() => void writeTag()}>
        {tagState === 'done' ? m.sys_app_nfc_done() : tagState === 'failed' ? m.sys_app_nfc_failed() : m.sys_app_nfc_write()}
      </button>
    </div>
  </div>
{/if}

<div class="settings-row is-stacked" data-setting-id="app-devices">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_app_pairing_devices()}</span>
  </div>
  {#if pairingUi.devices.length === 0}
    <p class="pairing-expires">{m.sys_app_pairing_none()}</p>
  {:else}
    <ul class="pairing-devices">
      {#each pairingUi.devices as device (device.id)}
        <li class="pairing-device">
          <div class="pairing-device-text">
            <span class="pairing-device-name">{device.name}</span>
            <span class="pairing-device-sub">{device.guest ? m.sys_app_pairing_guest_badge() : device.platform} · {seenLabel(device)}</span>
          </div>
          <button type="button" class="pairing-button pressable" onclick={() => void revokeDevice(device.id)}>{m.sys_app_pairing_revoke()}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pairing { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
  .pairing-qr { width: min(220px, 70%); background: #fff; padding: var(--space-2); border-radius: var(--radius-md); }
  .pairing-qr :global(svg) { display: block; width: 100%; height: auto; }
  .pairing-text { display: grid; gap: var(--space-2); flex: 1 1 200px; }
  .pairing-scan, .pairing-expires { margin: 0; color: var(--color-text-secondary); line-height: var(--leading-relaxed); }
  .pairing-code { font-family: var(--font-family-mono); font-size: var(--font-size-xl); letter-spacing: 0.12em; color: var(--color-text-primary); }
  .pairing-button { min-height: var(--touch-preferred); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0 var(--space-4); background: var(--color-surface-0); color: var(--color-text-primary); font: inherit; font-weight: var(--font-weight-semibold); cursor: pointer; justify-self: start; }
  .pairing-button:disabled { opacity: 0.5; cursor: default; }
  .pairing-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .pairing-devices { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .pairing-device { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .pairing-device-text { display: grid; }
  .pairing-device-name { color: var(--color-text-primary); }
  .pairing-device-sub { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
</style>
