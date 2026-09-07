<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Gekritzelte Tipps der Demo (demo-hints.ts): fixe Ebene über der Shell,
     die genau einen Tipp zeigt — Text in Handschrift, Schlaufe ums Ziel,
     Pfeil dazwischen. Das Ziel wird alle 250 ms im DOM nachgeschlagen, weil
     Räume und Kacheln erst nach dem ersten Paint entstehen und beim Blättern
     wandern; ein Beobachter je Element wäre mehr Code für dasselbe Ergebnis.
     Nichts wird gespeichert: jeder Aufruf der Demo beginnt die Tour von vorn,
     denn wer sie einmal weggetippt hat, soll sie beim nächsten Besuch wieder
     vorfinden. Ein Tipp auf das Demo-Badge startet sie mittendrin neu. */
  import { onMount } from 'svelte';
  import { DEMO_HINTS, hashSeed, roughArrow, roughLoop, somethingCovers, type DemoHint, type HintSide } from './demo-hints.ts';
  import { uiMode } from '../state/ui-mode.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  const GAP = 64;
  const MARGIN = 12;
  /* Oben bleibt die Statusleiste frei. */
  const TOP_MARGIN = 60;

  type Rect = { x: number; y: number; width: number; height: number };
  type Current = { hint: DemoHint; side: HintSide; gap: number; rect: Rect };

  let finished = $state<string[]>([]);
  /* Wann die Geste eines nachwirkenden Tipps zuerst als gelungen galt. */
  const doneSince = new Map<string, number>();
  let dismissed = $state(false);
  /* Die Tour beginnt erst, wenn eine Hand die Oberfläche sucht: Der erste
     Blick gehört dem Bild, nicht einer Sprechblase. Ein Tipp irgendwohin
     startet sie; das Badge startet sie neu. */
  let touched = $state(false);
  let current = $state<Current | null>(null);
  let bubbleWidth = $state(0);
  let bubbleHeight = $state(0);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);

  function markFinished(id: string): void {
    if (!finished.includes(id)) finished = [...finished, id];
  }

  function skip(): void {
    if (current) markFinished(current.hint.id);
    current = null;
  }

  function dismissAll(): void {
    dismissed = true;
    current = null;
  }

  function replay(): void {
    touched = true;
    finished = [];
    doneSince.clear();
    dismissed = false;
  }

  function sameRect(a: Rect, b: Rect): boolean {
    return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
      && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
  }

  /* Riesige Ziele (die freie Hero-Fläche) bekommen statt einer Schlaufe um
     alles nur einen Fleck in ihrer Mitte — „halte hier". */
  const SPOT = { width: 140, height: 80 };

  function locate(hint: DemoHint): { side: HintSide; gap: number; rect: Rect } | null {
    /* Ohne Ziel schwebt der Tipp mittig — die Blase zentriert sich über
       einem Punkt, Schlaufe und Pfeil entfallen. */
    if (hint.targets.length === 0) {
      return { side: 'above', gap: 0, rect: { x: viewportWidth / 2, y: viewportHeight / 2, width: 0, height: 0 } };
    }
    for (const target of hint.targets) {
      const el = document.querySelector<HTMLElement>(target.selector);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > viewportHeight || r.left > viewportWidth) continue;
      if (r.width * r.height > viewportWidth * viewportHeight * 0.35) {
        return { side: target.side, gap: target.gap ?? GAP, rect: {
          x: r.x + r.width / 2 - SPOT.width / 2, y: r.y + r.height / 2 - SPOT.height / 2, ...SPOT,
        } };
      }
      return { side: target.side, gap: target.gap ?? GAP, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    }
    return null;
  }

  /* Erledigt wird erst geprüft, wenn ein Tipp an der Reihe ist: „Sonne wieder
     an" gälte sonst schon beim Start als geschafft, weil Bearbeiten da noch
     aktiv ist. Die Prüfung läuft auch, während ein Overlay den Tipp verdeckt —
     genau dann hat die Geste ja gerade geklappt. */
  function tick(): void {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    /* Nur im Panel: auf dem Telefon liegen die Ziele in Sheets und Rastern,
       wo Schlaufe und Pfeil mehr verdecken als erklären. */
    if (!touched || dismissed || uiMode.effective !== 'panel') { current = null; return; }
    for (const hint of DEMO_HINTS) {
      if (finished.includes(hint.id)) continue;
      if (hint.when && !hint.when()) continue;
      if (hint.done()) {
        const since = doneSince.get(hint.id) ?? Date.now();
        doneSince.set(hint.id, since);
        if (!hint.lingerMs || Date.now() - since >= hint.lingerMs) { markFinished(hint.id); continue; }
      }
      if (somethingCovers()) { current = null; return; }
      const found = locate(hint);
      if (!found) continue;
      if (current?.hint.id === hint.id && current.side === found.side && sameRect(current.rect, found.rect)) return;
      current = { hint, ...found };
      return;
    }
    current = null;
  }

  onMount(() => {
    const timer = setInterval(tick, 250);
    tick();
    /* Das Badge ist sonst unanklickbar (pointer-events: none) — in der Demo
       mit Tipps wird es zum Knopf, der die Tour neu startet. */
    const badge = document.querySelector<HTMLElement>('.demo-badge');
    badge?.classList.add('has-hints');
    badge?.setAttribute('title', m.demo_hint_replay());
    badge?.addEventListener('click', replay);
    const wake = () => { touched = true; };
    document.addEventListener('pointerdown', wake, { once: true, capture: true });
    return () => {
      clearInterval(timer);
      document.removeEventListener('pointerdown', wake, { capture: true });
      badge?.classList.remove('has-hints');
      badge?.removeEventListener('click', replay);
    };
  });

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

  const OPPOSITE: Record<HintSide, HintSide> = { above: 'below', below: 'above', left: 'right', right: 'left' };

  function positionFor(rect: Rect, side: HintSide, gap: number): { x: number; y: number } {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let x = cx - bubbleWidth / 2;
    let y = cy - bubbleHeight / 2;
    if (side === 'above') y = rect.y - gap - bubbleHeight;
    else if (side === 'below') y = rect.y + rect.height + gap;
    else if (side === 'left') x = rect.x - gap - bubbleWidth;
    else x = rect.x + rect.width + gap;
    return { x, y };
  }

  function fits(pos: { x: number; y: number }): boolean {
    return pos.x >= MARGIN && pos.y >= TOP_MARGIN
      && pos.x + bubbleWidth <= viewportWidth - MARGIN
      && pos.y + bubbleHeight <= viewportHeight - MARGIN;
  }

  /* Sprechblase neben dem Ziel: die gewünschte Seite zuerst, sonst die
     gegenüberliegende, sonst irgendeine, auf der sie ganz ins Bild passt.
     Passt keine, wird die gewünschte in den Bildschirm geschoben. */
  const placement = $derived.by(() => {
    if (!current) return { x: 0, y: 0, side: 'above' as HintSide };
    const { rect, side, gap } = current;
    if (floating) {
      return { x: rect.x - bubbleWidth / 2, y: rect.y - bubbleHeight / 2, side };
    }
    const order: HintSide[] = [side, OPPOSITE[side], 'above', 'below', 'left', 'right'];
    for (const candidate of order) {
      /* Der große Abstand gilt nur für die gewünschte Seite — ausweichend
         reicht der normale. */
      const pos = positionFor(rect, candidate, candidate === side ? gap : GAP);
      if (fits(pos)) return { ...pos, side: candidate };
    }
    const pos = positionFor(rect, side, GAP);
    return {
      x: clamp(pos.x, MARGIN, viewportWidth - bubbleWidth - MARGIN),
      y: clamp(pos.y, TOP_MARGIN, viewportHeight - bubbleHeight - MARGIN),
      side,
    };
  });

  const seed = $derived(current ? hashSeed(current.hint.id) : 0);
  const floating = $derived(current !== null && current.hint.targets.length === 0);
  const isLast = $derived(current !== null && DEMO_HINTS[DEMO_HINTS.length - 1].id === current.hint.id);

  const loopPath = $derived(current && !floating ? roughLoop(current.rect, seed) : '');

  /* Pfeil von der Blasenkante, die dem Ziel zugewandt ist, bis kurz vor die
     Schlaufe. */
  const arrowPath = $derived.by(() => {
    if (!current || !bubbleWidth || floating) return '';
    const { rect } = current;
    const { side } = placement;
    const b = { x: placement.x, y: placement.y, width: bubbleWidth, height: bubbleHeight };
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const to = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const pad = 16;
    if (side === 'above') { from.y = b.y + b.height + 4; to.y = rect.y - pad; }
    else if (side === 'below') { from.y = b.y - 4; to.y = rect.y + rect.height + pad; }
    else if (side === 'left') { from.x = b.x + b.width + 4; to.x = rect.x - pad; }
    else { from.x = b.x - 4; to.x = rect.x + rect.width + pad; }
    return roughArrow(from, to, seed);
  });
</script>

{#if current}
  {#key current.hint.id}
    <div class="demo-hints" aria-live="polite">
      {#if !floating}
        <svg class="demo-hints-ink" width={viewportWidth} height={viewportHeight} viewBox={`0 0 ${viewportWidth} ${viewportHeight}`} aria-hidden="true">
          <path class="demo-hints-loop" d={loopPath} pathLength="1" />
          <path class="demo-hints-arrow" d={arrowPath} pathLength="1" />
        </svg>
      {/if}
      <div class="demo-hints-bubble" class:is-floating={floating} role="note"
           style:transform={`translate(${placement.x}px, ${placement.y}px)`}
           bind:clientWidth={bubbleWidth} bind:clientHeight={bubbleHeight}>
        <p class="demo-hints-text">{current.hint.text()}</p>
        <div class="demo-hints-actions">
          {#if isLast}
            <button class="demo-hints-btn" type="button" onclick={dismissAll}>{m.demo_hint_finish()}</button>
          {:else}
            <button class="demo-hints-btn" type="button" onclick={skip}>{m.demo_hint_next()}</button>
            <button class="demo-hints-btn is-quiet" type="button" onclick={dismissAll}>{m.demo_hint_done()}</button>
          {/if}
        </div>
      </div>
    </div>
  {/key}
{/if}
