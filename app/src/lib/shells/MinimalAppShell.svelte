<script lang="ts">
  import { onMount } from 'svelte';
  import './minimal-app-shell.css';
  import {
    MINIMAL_SHELL_VIEWS,
    type MinimalShellView,
  } from './minimal-shell-navigation.ts';

  let activeView = $state<MinimalShellView>(MINIMAL_SHELL_VIEWS[0]!);

  onMount(() => {
    void import('./minimal-shell-cache.ts').then(({ hydrateMinimalShellCache }) => hydrateMinimalShellCache(), () => {});
  });
</script>

<div class="minimal-shell" data-shell="minimal" data-view={activeView.id}>
  <header class="minimal-shell__status" role="status">Smart Home · Lokal bereit</header>

  <main class="minimal-shell__main">
    <section
      id="minimal-view"
      class="minimal-shell__intro"
      aria-labelledby={`minimal-tab-${activeView.id}`}
      aria-live="polite"
    >
      <h1>{activeView.title}</h1>
      <span>{activeView.summary}</span>
      <p class="minimal-shell__details">{activeView.details}</p>
    </section>
  </main>

  <nav class="minimal-shell__nav" aria-label="Hauptnavigation">
    {#each MINIMAL_SHELL_VIEWS as view}
      <button
        id={`minimal-tab-${view.id}`}
        type="button"
        class:is-active={activeView.id === view.id}
        aria-current={activeView.id === view.id ? 'page' : undefined}
        aria-controls="minimal-view"
        onclick={() => { activeView = view; }}
      >
        {view.label}
      </button>
    {/each}
  </nav>
</div>
