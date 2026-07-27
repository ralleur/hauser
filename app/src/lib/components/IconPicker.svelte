<script lang="ts">
  import Icon from './Icon.svelte';
  import { searchIcons, type IconCategory, type IconEntry } from '../state/icon-catalog.ts';
  import { loadRecentIcons } from '../state/icon-recents.ts';

  import { m } from '../../paraglide/messages.js';
  let {
    currentIcon,
    onSelect,
    onReset,
    onClose,
  }: {
    currentIcon: string;
    onSelect: (id: string) => void;
    onReset: () => void;
    onClose: () => void;
  } = $props();

  const tabs: readonly { id: IconCategory | 'recent'; label: string }[] = [
    { id: 'all', label: m.icon_all() },
    { id: 'recent', label: m.icon_recent() },
    { id: 'light', label: m.icon_light() },
    { id: 'switch', label: m.icon_switches() },
    { id: 'climate', label: m.icon_climate() },
    { id: 'media', label: 'Media' },
    { id: 'system', label: m.icon_navigation() },
  ];

  let query = $state('');
  let debouncedQuery = $state('');
  let activeTab = $state<IconCategory | 'recent'>('all');
  let focusedIndex = $state(0);
  let searchInput = $state<HTMLInputElement>();
  let recentIds = $state(loadRecentIcons());
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => { requestAnimationFrame(() => searchInput?.focus()); });

  function onSearchInput(event: Event) {
    query = (event.currentTarget as HTMLInputElement).value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { debouncedQuery = query; focusedIndex = 0; }, 70);
  }

  const results = $derived.by((): readonly IconEntry[] => {
    if (activeTab === 'recent') {
      const recent = new Set(recentIds);
      return searchIcons(debouncedQuery, 'all', 5_200).filter((icon) => recent.has(icon.id));
    }
    return searchIcons(debouncedQuery, activeTab, 480);
  });

  function choose(id: string) {
    onSelect(id);
  }

  function onGridKeydown(event: KeyboardEvent) {
    if (!results.length) return;
    const columns = window.matchMedia('(max-width: 560px)').matches ? 4 : 6;
    let next = focusedIndex;
    if (event.key === 'ArrowRight') next++;
    else if (event.key === 'ArrowLeft') next--;
    else if (event.key === 'ArrowDown') next += columns;
    else if (event.key === 'ArrowUp') next -= columns;
    else if (event.key === 'Enter') { event.preventDefault(); choose(results[focusedIndex]?.id ?? currentIcon); return; }
    else return;
    event.preventDefault();
    focusedIndex = Math.max(0, Math.min(results.length - 1, next));
    document.querySelector<HTMLElement>(`[data-icon-index="${focusedIndex}"]`)?.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="icon-picker-layer" role="dialog" aria-modal="true" aria-label={m.icon_pick()}>
  <button class="icon-picker-scrim" type="button" aria-label={m.icon_close()} onclick={onClose}></button>
  <section class="icon-picker-panel">
    <header class="icon-picker-header">
      <div>
        <p class="caps-label">{m.icon_device_symbol()}</p>
        <h2>{m.icon_pick()}</h2>
      </div>
      <button class="ld-close pressable" type="button" aria-label={m.icon_close()} onclick={onClose}>×</button>
    </header>

    <label class="icon-search">
      <span class="sr-only">{m.icon_search()}</span>
      <Icon name="i-search" />
      <input bind:this={searchInput} value={query} oninput={onSearchInput} type="search" placeholder={m.icon_search_placeholder()} autocomplete="off" />
    </label>

    <div class="icon-tabs" role="tablist" aria-label="Icon-Kategorie">
      {#each tabs as tab (tab.id)}
        <button type="button" role="tab" aria-selected={activeTab === tab.id}
                class:is-active={activeTab === tab.id} onclick={() => { activeTab = tab.id; focusedIndex = 0; }}>
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="icon-picker-actions">
      <button class="icon-reset pressable" type="button" onclick={onReset}>{m.icon_default()}</button>
      <span aria-live="polite">{results.length}{results.length === 480 ? '+' : ''} Treffer</span>
    </div>

    {#if results.length}
      <div class="icon-grid" role="radiogroup" aria-label="Suchergebnisse" tabindex="-1" onkeydown={onGridKeydown}>
        {#each results as icon, index (icon.id)}
          <button class="icon-option pressable" type="button" role="radio"
                  aria-checked={currentIcon === icon.id} aria-label={icon.name}
                  tabindex={index === focusedIndex ? 0 : -1} data-icon-index={index}
                  onclick={() => choose(icon.id)} onfocus={() => (focusedIndex = index)}>
            <Icon name={icon.id} />
            <span>{icon.name}</span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="icon-empty">{m.icon_no_matches()}</p>
    {/if}
  </section>
</div>
