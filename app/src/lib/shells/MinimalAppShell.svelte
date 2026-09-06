<script lang="ts">
  import { onMount } from 'svelte';
  import './minimal-app-shell.css';
  import {
    MINIMAL_SHELL_VIEWS,
    type MinimalShellView,
  } from './minimal-shell-navigation.ts';
  import { m } from '../../paraglide/messages.js';

  let activeView = $state<MinimalShellView>(MINIMAL_SHELL_VIEWS[0]!);

  onMount(() => {
    void import('./minimal-shell-cache.ts').then(({ hydrateMinimalShellCache }) => hydrateMinimalShellCache(), () => {});
  });

  /* Der einzige Ausweg aus dieser Ansicht: neu laden. Sie erscheint, wenn die
     Haushaltskonfiguration fehlt oder nicht gilt — beides kann sich mit einem
     zweiten Versuch erledigt haben. */
  function reload(): void {
    location.reload();
  }
</script>

<div class="minimal-shell" data-shell="minimal" data-view={activeView.id}>
  <header class="minimal-shell__status" role="status">{m.minimal_status_ready()}</header>

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

    <!-- Ursache in einem Satz, direkt daneben der Weg zurück. Den Satz
         ersetzt publishMinimalShellConfigStatus, sobald die Prüfung einen
         Grund kennt. -->
    <div class="minimal-shell__recovery">
      <p class="minimal-shell__cause">{m.minimal_system_summary()}</p>
      <button class="minimal-shell__reload" type="button" onclick={reload}>{m.minimal_reload()}</button>
    </div>
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
