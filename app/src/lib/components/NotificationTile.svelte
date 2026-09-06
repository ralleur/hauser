<script lang="ts">
  import Icon from './Icon.svelte';
  import { relativeDuration, type HmiNotification } from '../state/notifications.ts';

  import { m } from '../../paraglide/messages.js';
  let { item, now, ondismiss, onactivate }:
    { item: HmiNotification; now: number; ondismiss: () => void; onactivate?: () => void } = $props();
  let tile = $state<HTMLElement | null>(null);
  let drag = $state(0);
  let startX = 0;
  let startedAt = 0;
  let captured = false;
  let dragging = $state(false);
  let dismissing = $state(false);
  const confettiPieces = Array.from({ length: 12 }, (_, index) => index + 1);
  const elapsed = $derived(relativeDuration(item.createdAt, now));
  const sourceLabel = $derived(item.sourceLabel ?? (item.source.endsWith('washer')
    ? m.notif_washer()
    : item.source.endsWith('dryer') ? m.notif_dryer() : item.source));
  const celebratesDismissal = $derived(item.source === 'laundry:washer' || item.source === 'laundry:dryer');
  /* Nur Meldungen mit Zielort sind antippbar. Eine Kachel, die überall klickbar
     aussieht und nirgendwo hinführt, ist schlimmer als eine stumme. */
  const openable = $derived(Boolean(item.action && onactivate));

  function activate(): void {
    if (!openable || dismissing) return;
    /* Nach einer Wischgeste ist der Klick nur deren Ausklang. */
    if (drag > 4) return;
    onactivate?.();
  }

  function dismiss(): void {
    if (dismissing) return;
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!celebratesDismissal || reducedMotion) {
      ondismiss();
      return;
    }
    drag = 0;
    dragging = false;
    dismissing = true;
  }

  /* Ab hier gilt es als Wischen, nicht mehr als Tippen. */
  const DRAG_THRESHOLD_PX = 6;

  function pointerdown(event: PointerEvent): void {
    /* Ohne diese Ausnahme fängt die Hülle den Zeiger ein, und der Browser
       stellt den folgenden Klick ihr statt dem Quittieren-Knopf zu — mit der
       Maus war der Knopf dadurch tot und nur die Wischgeste blieb. */
    if (event.target instanceof Element && event.target.closest('.notification-dismiss')) return;
    startX = event.clientX;
    startedAt = performance.now();
    dragging = true;
  }

  function pointermove(event: PointerEvent): void {
    if (!dragging) return;
    const distance = Math.max(0, event.clientX - startX);
    /* Der Zeiger wird erst eingefangen, wenn wirklich gewischt wird. Fing die
       Hülle ihn schon beim Aufsetzen ein, ging der Klick an sie statt an den
       Knopf darunter — am Tablet unauffällig, mit der Maus tot. */
    if (!captured && distance >= DRAG_THRESHOLD_PX) {
      captured = true;
      tile?.setPointerCapture(event.pointerId);
    }
    if (!captured) return;
    drag = distance;
  }

  function pointerup(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (captured) {
      const elapsedMs = Math.max(1, performance.now() - startedAt);
      const velocity = drag / elapsedMs;
      if (tile && (drag >= tile.clientWidth * 0.3 || velocity > 0.3)) dismiss();
      else drag = 0;
      tile?.releasePointerCapture(event.pointerId);
      captured = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions
     — die Hülle erfasst nur die optionale Wischgeste; die Quittierung bleibt per Button tastaturbedienbar. -->
<div bind:this={tile} class="notification-tile-shell" class:is-dragging={dragging} class:is-dismissing={dismissing}
     style={`--notification-drag:${drag}px`}
     onpointerdown={pointerdown} onpointermove={pointermove} onpointerup={pointerup} onpointercancel={pointerup}>
  <article class="notification-tile is-{item.type}" class:is-dismissing={dismissing}
           class:is-openable={openable}
           onanimationend={(event) => {
             if (dismissing && event.target === event.currentTarget && event.animationName === 'notification-pop') ondismiss();
           }}>
    <!-- Ein Knopf über der ganzen Kachel statt einer klickbaren Hülle: So
         bleibt die Tastatur bedient, der Quittieren-Knopf liegt darüber, und
         die Vorlesehilfe hört ein Ziel statt eines Artikels. -->
    {#if openable}
      <button class="notification-open" type="button" aria-label={m.notif_open({ title: item.title })}
              onclick={activate}></button>
    {/if}
    <div class="notification-icon"><Icon name={item.icon ?? 'i-bell'} cls="icon icon-xl" /></div>
    <div class="notification-copy">
      <span class="notification-source"><span class="notification-dot"></span>{sourceLabel}</span>
      <strong>{item.title}</strong>
      {#if item.message}<span class="notification-message">{item.message}</span>{/if}
      <span class="notification-time num">{item.state === 'done' ? m.notif_ago() : m.notif_since()} {elapsed}</span>
    </div>
    <button class="notification-dismiss pressable" type="button" aria-label={m.notif_dismiss({ title: item.title })}
            disabled={dismissing}
            onclick={(event) => { event.stopPropagation(); dismiss(); }}><Icon name="i-close" cls="icon icon-md" /></button>
  </article>
  {#if dismissing}
    <div class="notification-confetti" aria-hidden="true">
      {#each confettiPieces as piece}
        <span class="notification-confetti-piece piece-{piece}"></span>
      {/each}
    </div>
  {/if}
</div>
