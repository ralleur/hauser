<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Diagnoseansicht (Paket 10): dreimal auf das Logo. Zeigt, was sich sonst
     nur erahnen lässt — Bildrate, Verbindungsalter, Alter und Trefferzahl der
     Snapshots, dazu Version und Revision aus derselben Quelle wie die
     Build-Info in den Einstellungen. Kein Menüeintrag, kein Startpfad. */
  import { onMount } from 'svelte';
  import { runtime } from '../adapter/runtime.svelte.ts';
  import { connection } from '../state/connection.svelte.ts';
  import { snapshotStats } from '../data/query-cache.ts';
  import { buildInfo, loadBuildInfo } from '../state/build-info.svelte.ts';
  import { licenseSourceView } from '../config/build-info.ts';
  import { diagnostics } from '../state/hidden-gestures.svelte.ts';
  import RegionDebugView from './RegionDebugView.svelte';
  import { m } from '../../paraglide/messages.js';

  const conn = $derived(connection());
  const license = $derived(licenseSourceView(buildInfo));

  let fps = $state(0);
  let now = $state(Date.now());
  let stats = $state(snapshotStats());

  onMount(() => {
    void loadBuildInfo();
    let frames = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(time: number) {
      frames += 1;
      if (time - last >= 1000) {
        fps = Math.round((frames * 1000) / (time - last));
        frames = 0;
        last = time;
      }
      raf = requestAnimationFrame(tick);
    });
    const id = setInterval(() => {
      now = Date.now();
      stats = snapshotStats();
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  });

  function ageLabel(at: number): string {
    if (!at) return '—';
    const seconds = Math.max(0, Math.round((now - at) / 1000));
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${Math.round(seconds / 3600)} h`;
  }

  const hits = $derived(stats.reduce((sum, stat) => sum + stat.hits, 0));
  const misses = $derived(stats.reduce((sum, stat) => sum + stat.misses, 0));
  const freshest = $derived(stats.reduce((best, stat) => Math.max(best, stat.updatedAt), 0));
</script>

<div class="diag-scrim" role="presentation"
     onclick={(event) => { if (event.target === event.currentTarget) diagnostics.active = false; }}>
  <div class="diag" role="dialog" aria-modal="true" aria-label={m.diag_title()}>
    <header class="diag-head">
      <h2>{m.diag_title()}</h2>
      <button class="secondary-btn pressable" type="button"
              onclick={() => { diagnostics.active = false; }}>{m.common_close()}</button>
    </header>
    <dl class="diag-list">
      <div><dt>{m.diag_fps()}</dt><dd class="num">{fps || '—'}</dd></div>
      <div><dt>{m.diag_connection()}</dt><dd class="num">{conn.label} · {ageLabel(runtime.connectionSince)}</dd></div>
      <div><dt>{m.diag_snapshot_age()}</dt><dd class="num">{ageLabel(freshest)}</dd></div>
      <div><dt>{m.diag_cache_hits()}</dt><dd class="num">{hits} / {hits + misses}</dd></div>
      <div><dt>{m.diag_version()}</dt><dd class="num">{license.version ?? '—'}</dd></div>
      <div><dt>{m.diag_revision()}</dt><dd class="num">{license.revisionShort ?? '—'}</dd></div>
    </dl>
    <RegionDebugView />
  </div>
</div>

<style>
  .diag-scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
  }

  .diag {
    min-width: min(90vw, 26rem);
    max-width: min(94vw, 34rem);
    max-height: 88vh;
    overflow-y: auto;
    padding: var(--space-5, 20px);
    border-radius: var(--radius-lg, 16px);
    background: var(--color-surface-1, #16181d);
    color: var(--color-text-primary, #fff);
  }

  .diag-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4, 16px);
    margin-bottom: var(--space-4, 16px);
  }

  .diag-head h2 {
    margin: 0;
    font-size: var(--font-size-title, 1.25rem);
  }

  .diag-list {
    display: grid;
    gap: var(--space-2, 8px);
    margin: 0;
  }

  .diag-list > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4, 16px);
  }

  .diag-list dt {
    opacity: 0.7;
  }

  .diag-list dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
