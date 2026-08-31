<script lang="ts">
  /* B-08E11: Die eine Adresse, unter der Handy und Tablet Hauser öffnen.
     Bewusst `location.origin` statt eines aus HA-Hostname und Port geratenen
     Werts: gezeigt wird genau die Herkunft, über die diese Seite gerade
     nachweislich erreichbar war. Der QR-Code wird erst hier nachgeladen und
     gehört nie in den Startpfad. */
  import { onMount } from 'svelte';
  import { m } from '../../paraglide/messages.js';

  let { address = typeof location === 'undefined' ? '' : location.origin }: { address?: string } = $props();

  let qrMarkup = $state('');
  let copied = $state(false);

  onMount(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { default: qrcode } = await import('qrcode-generator');
        const code = qrcode(0, 'M');
        code.addData(address);
        code.make();
        if (!cancelled) qrMarkup = code.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch { /* Ohne QR-Code bleiben Adresse und Kopieren nutzbar. */ }
    })();
    return () => { cancelled = true; };
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch { /* Ohne Zwischenablage bleibt die sichtbare Adresse maßgeblich. */ }
  }
</script>

<div class="device-address">
  <p class="hint">{m.device_address_hint()}</p>
  <div class="row">
    <code class="address">{address}</code>
    <button type="button" class="copy" onclick={() => void copy()}>
      {copied ? m.device_address_copied() : m.device_address_copy()}
    </button>
  </div>
  {#if qrMarkup}
    <div class="qr" role="img" aria-label={m.device_address_qr_label({ address })}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html qrMarkup}
    </div>
  {/if}
</div>

<style>
  .device-address { display: grid; gap: var(--space-3); }
  .hint { margin: 0; color: var(--color-text-secondary); line-height: var(--leading-relaxed); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
  .address { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-0); color: var(--color-text-primary); font-family: var(--font-family-mono); overflow-wrap: anywhere; }
  .copy { min-height: var(--touch-preferred); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 0 var(--space-4); background: var(--color-surface-0); color: var(--color-text-primary); font: inherit; font-weight: var(--font-weight-semibold); cursor: pointer; }
  .qr { width: min(180px, 60%); background: #fff; padding: var(--space-2); border-radius: var(--radius-md); }
  .qr :global(svg) { display: block; width: 100%; height: auto; }
</style>
