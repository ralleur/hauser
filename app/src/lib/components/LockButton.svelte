<script lang="ts">
  import Icon from './Icon.svelte';
  import { longpress } from '../actions/longpress.ts';
  import { requestAmbient } from '../state/ambient.svelte.ts';
  import { setClassicLockButton } from '../state/settings.svelte.ts';

  let { variant }: { variant: 'large' | 'titlebar' } = $props();
  let menuOpen = $state(false);
  let root: HTMLElement;

  const moveToTitlebar = () => {
    menuOpen = false;
    setClassicLockButton(true);
  };

  const makeLarge = () => {
    menuOpen = false;
    setClassicLockButton(false);
  };

  const closeOutside = (event: PointerEvent) => {
    if (menuOpen && !root.contains(event.target as Node)) menuOpen = false;
  };
</script>

<svelte:document onpointerdown={closeOutside} />

<span class="lock-control" class:is-large={variant === 'large'} bind:this={root}>
  <button class:standby-fab={variant === 'large'} class:standby-btn={variant === 'titlebar'}
          class="pressable" type="button"
          aria-label="Standby — Ambient-Bildschirm sofort anzeigen"
          aria-haspopup="menu" aria-expanded={menuOpen}
          use:longpress={{ onLongPress: () => { menuOpen = true; } }}
          onclick={requestAmbient}>
    <Icon name="i-power" cls={variant === 'large' ? 'icon icon-xl' : 'icon icon-md'} />
  </button>

  {#if menuOpen}
    <div class="lock-position-menu" class:from-titlebar={variant === 'titlebar'} role="menu">
      <button class="lock-position-option pressable" type="button" role="menuitem"
              onclick={variant === 'large' ? moveToTitlebar : makeLarge}>
        {variant === 'large' ? 'Lockbutton in die Titelleiste verschieben' : 'Großer Lockbutton'}
      </button>
    </div>
  {/if}
</span>
