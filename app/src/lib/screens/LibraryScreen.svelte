<script lang="ts">
  import { tick } from 'svelte';

  import MediaCard from '../components/MediaCard.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { m } from '../../paraglide/messages.js';
  import {
    libraryShelves, libraryStatus, libraryError, isLoggingIn, jellyfinLogin, retryLoad,
  } from '../state/library.svelte.ts';
  import {
    categoryFromLabel, categoryItems, searchLibrary, type LibraryCategory,
  } from '../state/library-view.ts';

  const status = $derived(libraryStatus());
  let { phone = false, titleAnchor = $bindable() }: { phone?: boolean; titleAnchor?: HTMLHeadingElement } = $props();
  const shelves = $derived(libraryShelves());
  let category = $state<LibraryCategory | null>(null);
  let searchOpen = $state(false);
  let query = $state('');
  let searchInput = $state<HTMLInputElement>();

  type ViewTransitionDocument = Document & {
    startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> };
  };

  const activeShelf = $derived(category
    ? shelves.find((shelf) => categoryFromLabel(shelf.label) === category)
    : null);
  const activeItems = $derived(category
    ? categoryItems(category, shelves, appState.library.items)
    : []);
  const results = $derived(searchLibrary(appState.library.items, query));

  let username = $state('');
  let password = $state('');

  function onLogin(e: SubmitEvent) {
    e.preventDefault();
    void jellyfinLogin(username, password);
    password = '';
  }

  function changeView(update: () => void | Promise<void>): Promise<void> {
    const doc = document as ViewTransitionDocument;
    if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update();
      return tick();
    }
    return doc.startViewTransition(update).finished;
  }

  function cardTransitionName(id: string): string {
    return `library-card-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  }

  function nameCards(root: ParentNode, ids: ReadonlySet<string>) {
    root.querySelectorAll<HTMLElement>('.media-card[data-item]').forEach((card) => {
      const id = card.dataset.item;
      if (id && ids.has(id)) {
        card.style.viewTransitionName = cardTransitionName(id);
        card.style.setProperty('view-transition-class', 'library-shared-card');
      }
    });
  }

  function nameEnteringCards(root: ParentNode, sharedIds: ReadonlySet<string>) {
    root.querySelectorAll<HTMLElement>('.media-card[data-item]').forEach((card) => {
      const id = card.dataset.item;
      if (!id || sharedIds.has(id)) return;
      card.style.viewTransitionName = `library-enter-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      card.style.setProperty('view-transition-class', 'library-enter-card');
    });
  }

  function clearTransitionNames() {
    document.querySelectorAll<HTMLElement>('.library-shelf, .media-card[data-item]').forEach((element) => {
      element.style.viewTransitionName = '';
      element.style.removeProperty('view-transition-class');
    });
  }

  function scrollToTop() {
    (document.querySelector<HTMLElement>('.phone-library')
      ?? document.querySelector<HTMLElement>('.screen.is-active')
      ?? document.querySelector<HTMLElement>('.screen.is-entering'))?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  async function openCategory(label: string) {
    scrollToTop();
    clearTransitionNames();
    const next = categoryFromLabel(label);
    const selected = document.querySelector<HTMLElement>(`.library-shelf[data-category="${next}"]`);
    const sharedIds = new Set((shelves.find((s) => categoryFromLabel(s.label) === next)?.list ?? []).map((i) => i.id));
    if (selected) nameCards(selected, sharedIds);
    document.querySelectorAll<HTMLElement>('.library-shelf').forEach((shelf) => {
      if (shelf !== selected) shelf.style.viewTransitionName = `library-exit-${shelf.dataset.category}`;
    });

    await changeView(async () => {
      category = categoryFromLabel(label);
      searchOpen = false;
      query = '';
      await tick();
      const expanded = document.querySelector<HTMLElement>('.library-expanded');
      if (expanded) {
        nameCards(expanded, sharedIds);
        nameEnteringCards(expanded, sharedIds);
      }
    });
    clearTransitionNames();
  }

  async function closeExpanded() {
    if (!category) {
      void changeView(() => { searchOpen = false; query = ''; });
      return;
    }
    const closing = category;
    scrollToTop();
    clearTransitionNames();
    const previewIds = new Set((shelves.find((s) => categoryFromLabel(s.label) === closing)?.list ?? []).map((i) => i.id));
    const expanded = document.querySelector<HTMLElement>('.library-expanded');
    if (expanded) nameCards(expanded, previewIds);

    await changeView(async () => {
      category = null;
      searchOpen = false;
      query = '';
      await tick();
      document.querySelectorAll<HTMLElement>('.library-shelf').forEach((shelf) => {
        if (shelf.dataset.category === closing) nameCards(shelf, previewIds);
        else shelf.style.viewTransitionName = `library-return-${shelf.dataset.category}`;
      });
    });
    clearTransitionNames();
  }

  async function openSearch() {
    scrollToTop();
    await changeView(() => {
      category = null;
      searchOpen = true;
    });
    searchInput?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && (category || searchOpen)) closeExpanded();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="screen-inner library-screen" class:phone-page={phone} class:phone-library={phone}>
  <header class="library-header">
    {#if category}
      <button class="library-view-title pressable" type="button" onclick={closeExpanded}
              aria-label={`${activeShelf?.label ?? m.library_category()} schließen`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        <span>{activeShelf?.label}</span>
      </button>
    {:else if searchOpen}
      <div class="library-search-wrap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        <input bind:this={searchInput} bind:value={query} class="library-search-input"
               type="search" enterkeyhint="search" autocomplete="off" spellcheck="false"
               placeholder={m.library_search_hint()} aria-label={m.library_search()} />
        <button class="search-close pressable" type="button" onclick={closeExpanded} aria-label={m.library_search_close()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </div>
    {:else}
      <h1 class="screen-title library-main-title" bind:this={titleAnchor} tabindex="-1">{m.library_title()}</h1>
      {#if status === 'ready'}
        <button class="library-search-button pressable" type="button" onclick={openSearch}
                aria-label={m.library_search()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
        </button>
      {/if}
    {/if}
  </header>

  {#if status === 'ready'}
    <div class="library-stage">
      {#if searchOpen}
        <section class="library-expanded" aria-label={m.library_results()}>
          {#if query.trim() === ''}
            <p class="library-empty">{m.library_search_placeholder()}</p>
          {:else if results.length}
            <p class="library-result-count">{results.length} {results.length === 1 ? m.library_hits() : m.library_hits()}</p>
            <div class="library-grid">
              {#each results as item (item.id)}<MediaCard {item} />{/each}
            </div>
          {:else}
            <p class="library-empty">Keine Treffer für „{query.trim()}“.</p>
          {/if}
        </section>
      {:else if category}
        <section class="library-expanded" aria-label={activeShelf?.label}>
          {#if activeItems.length}
            <div class="library-grid">
              {#each activeItems as item (item.id)}<MediaCard {item} />{/each}
            </div>
          {:else}
            <p class="library-empty">{m.library_empty()}</p>
          {/if}
        </section>
      {:else}
        <div class="library-overview">
          {#each shelves as shelf (shelf.label)}
            {#if shelf.list.length}
              <section class="shelf library-shelf" data-category={categoryFromLabel(shelf.label)}>
                <button class="caps-label shelf-label shelf-button pressable" type="button"
                        onclick={() => openCategory(shelf.label)} aria-label={`${shelf.label} vollständig anzeigen`}>
                  <span>{shelf.label}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </button>
                <div class="shelf-row">
                  {#each shelf.list as item (item.id)}<MediaCard {item} />{/each}
                </div>
              </section>
            {/if}
          {/each}
        </div>
      {/if}
    </div>

  {:else if status === 'loading'}
    <div class="lib-skeleton" aria-busy="true" aria-label={m.library_loading()}>
      {#each ['Weiterschauen', m.library_recent()] as label (label)}
        <section class="shelf">
          <h2 class="caps-label shelf-label">{label}</h2>
          <div class="shelf-row">
            {#each Array(6) as _, i (i)}<span class="skeleton-poster"></span>{/each}
          </div>
        </section>
      {/each}
    </div>

  {:else if status === 'needs-login'}
    <div class="lib-gate">
      <form class="login-card" onsubmit={onLogin}>
        <h2 class="login-title">{m.library_connect()}</h2>
        <p class="login-hint">Melde dich mit deinem Jellyfin-Konto an. Die Anmeldung bleibt lokal im Browser (Token), damit Weiterschauen und Resume gerätebezogen funktionieren.</p>
        {#if libraryError()}<p class="login-error" role="alert">{libraryError()}</p>{/if}
        <input class="login-input" type="text" autocomplete="username" spellcheck="false"
               placeholder={m.library_username()} aria-label="Jellyfin-Benutzername" bind:value={username} />
        <input class="login-input" type="password" autocomplete="current-password"
               placeholder={m.library_password()} aria-label="Jellyfin-Passwort" bind:value={password} />
        <button class="login-submit pressable" type="submit" disabled={username.trim() === '' || isLoggingIn()}>
          {isLoggingIn() ? m.library_connecting() : m.library_signin()}
        </button>
      </form>
    </div>

  {:else}
    <div class="lib-gate">
      <div class="login-card">
        <h2 class="login-title">{m.library_unreachable()}</h2>
        <p class="login-hint">{libraryError() ?? m.library_no_response()}</p>
        <button class="login-submit pressable" type="button" onclick={retryLoad}>{m.library_retry()}</button>
      </div>
    </div>
  {/if}
</div>
