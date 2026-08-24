<script lang="ts">
  /* ── Neutrale Oberfläche außerhalb eines Aufenthalts ──
     Kein Name, keine Buchung, keine nächste Anreise und keine Gerätesteuerung
     (docs/hotel-mode-plan.md §3). Bewusst ohne Runtime-, State- oder
     Backendimport: dieser Zustand darf gar keine Steuerdaten laden.

     Die Lizenz- und Quellcodeauskunft bleibt hier ausdrücklich erreichbar —
     sie gehört jedem Benutzer der laufenden Fassung (AGPL §13), nicht nur dem
     Admin. Der dezente Admin-Einstieg folgt in H07. */
  import { m } from '../../paraglide/messages.js';
  import { buildInfo, loadBuildInfo } from '../state/build-info.svelte.ts';
  import { licenseSourceView } from '../config/build-info.ts';

  const license = $derived(licenseSourceView(buildInfo));
  const licenseTextUrl = `${import.meta.env.BASE_URL}legal/agpl-3.0.txt`;

  $effect(() => { void loadBuildInfo(); });
</script>

<main class="hotel-neutral" data-shell="hotel-neutral" data-hotel-surface="inactive">
  <div class="hotel-neutral__center">
    <h1>{m.hotel_neutral_title()}</h1>
    <p>{m.hotel_neutral_hint()}</p>
  </div>

  <footer class="hotel-neutral__legal">
    <span class="hotel-neutral__legal-item">
      {license.license}{#if license.version} · {license.version}{/if}
    </span>
    <a class="hotel-neutral__legal-link" href={licenseTextUrl} rel="noopener noreferrer">
      {m.sys_view_license()}
    </a>
    {#if license.sourceUrl}
      <a class="hotel-neutral__legal-link" href={license.sourceUrl} rel="noopener noreferrer" target="_blank">
        {m.sys_view_source()}
      </a>
    {/if}
  </footer>
</main>

<style>
  .hotel-neutral {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: var(--space-7);
    padding: var(--space-6);
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    font-family: var(--font-family);
  }

  .hotel-neutral__center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
  }

  h1 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: var(--leading-tight);
  }

  p {
    margin: 0;
    max-width: 34ch;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .hotel-neutral__legal {
    position: absolute;
    bottom: max(var(--space-5), env(safe-area-inset-bottom));
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-4);
    font-size: var(--text-2xs);
    color: var(--color-text-tertiary);
  }

  .hotel-neutral__legal-link {
    color: var(--color-text-secondary);
    text-decoration: none;
    border-bottom: 1px solid var(--color-border);
  }
</style>
