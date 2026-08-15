<script lang="ts">
  import { phoneNavOrder, navTargetLabel, type PhoneNavTarget } from '../../state/phone-nav-order.svelte.ts';
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
</script>

<nav class="phone-bottom-nav" aria-label="Hauptnavigation">
  {#each phoneNavOrder.order.slice(0, 3) as id (id)}
    <button class="phone-nav-target pressable" class:is-active={active === id} type="button" aria-current={active === id ? 'page' : undefined} onclick={(event) => onselect(id, event.currentTarget)}>
      <PhoneNavIcon {id} />
      <span>{navTargetLabel(id)}</span>
    </button>
  {/each}
  {#if phoneNavOrder.order.length > 3}
    <button bind:this={moreButton} class="phone-nav-target pressable" class:is-active={active === 'more'} type="button" aria-current={active === 'more' ? 'page' : undefined} aria-haspopup="dialog" aria-expanded={moreOpen} onclick={(event) => onselect('more', event.currentTarget)}>
      <PhoneNavIcon id="more" />
      <span>Mehr</span>
    </button>
  {/if}
</nav>
