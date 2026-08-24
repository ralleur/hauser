<script lang="ts">
  import { phoneNavOrder, navTargetLabel, type PhoneNavTarget } from '../../state/phone-nav-order.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import PhoneNavIcon from './PhoneNavIcon.svelte';

  let {
    active,
    moreOpen,
    onselect,
    moreButton = $bindable(),
  }: {
    active: PhoneNavTarget | 'more';
    moreOpen: boolean;
    onselect: (target: PhoneNavTarget | 'more', trigger: HTMLButtonElement) => void;
    moreButton?: HTMLButtonElement;
  } = $props();

  const mainTargets = $derived(phoneNavOrder.order.slice(0, 3));
  const activeIndex = $derived(active === 'more' ? 3 : Math.max(mainTargets.indexOf(active), 0));
</script>

<nav class="phone-bottom-nav" aria-label={m.nav_main()}>
  <span class="phone-nav-indicator-track" style:--phone-nav-active-index={activeIndex} aria-hidden="true">
    <span class="phone-nav-indicator"></span>
  </span>
  {#each mainTargets as id, index (id)}
    <button class="phone-nav-target pressable" class:is-active={active === id} style:grid-column={index + 1} style:grid-row="1" type="button" aria-current={active === id ? 'page' : undefined} onclick={(event) => onselect(id, event.currentTarget)}>
      <PhoneNavIcon {id} />
      <span>{navTargetLabel(id)}</span>
    </button>
  {/each}
  {#if phoneNavOrder.order.length > 3}
    <button bind:this={moreButton} class="phone-nav-target pressable" class:is-active={active === 'more'} style:grid-column="4" style:grid-row="1" type="button" aria-current={active === 'more' ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={moreOpen} onclick={(event) => onselect('more', event.currentTarget)}>
      <PhoneNavIcon id="more" />
      <span>{m.nav_more()}</span>
    </button>
  {/if}
</nav>
