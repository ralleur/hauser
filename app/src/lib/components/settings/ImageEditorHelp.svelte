<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  let { text }: { text: string } = $props();
  const id = $props.id();
</script>
<button class="image-help" type="button" popovertarget={id} aria-label={m.img_help()}>i</button>
<div {id} popover="auto" class="image-help-popover">
  <p>{text}</p><button class="secondary-btn" type="button" popovertarget={id} popovertargetaction="hide">{m.common_close()}</button>
</div>
<style>
  .image-help { align-self: flex-start; width: var(--touch-min); height: var(--touch-min); border: 1px solid var(--color-border); border-radius: var(--radius-full); background: var(--overlay-control-background); color: var(--color-text-primary); font: inherit; font-style: italic; cursor: pointer; }
  .image-help-popover { max-width: min(calc(var(--space-8) * 7), calc(100vw - var(--space-6))); padding: var(--space-5); border: 1px solid var(--image-workspace-border); border-radius: var(--radius-lg); background: var(--image-workspace-background); color: var(--image-workspace-foreground); box-shadow: var(--elevation-overlay-shadow); }
  p { white-space: pre-line; margin-top: 0; }
  .secondary-btn { color: inherit; background: var(--image-workspace-control); border-color: var(--image-workspace-border); }
</style>
