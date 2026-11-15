<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  let { value = $bindable(''), input = $bindable(), id, disabled = false, describedby, slots = 4 }: {
    value?: string; input?: HTMLInputElement; id: string; disabled?: boolean; describedby?: string; slots?: number;
  } = $props();
</script>
<div class="pin-field">
  <div class="pin-digits" aria-hidden="true">
    {#each Array(Math.min(12, Math.max(slots, value.length))) as _, i}<span class:is-filled={i < value.length}>{i < value.length ? '●' : ''}</span>{/each}
  </div>
  <input bind:this={input} {id} type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12"
         {disabled} aria-describedby={describedby} value={value} oninput={(event) => { value = event.currentTarget.value.replace(/[^0-9]/g, '').slice(0, 12); event.currentTarget.value = value; }} />
</div>
<style>
  .pin-field { position: relative; width: 100%; }
  .pin-digits { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .pin-digits span { display: grid; place-items: center; flex: 1; min-width: var(--space-5); height: var(--touch-preferred); border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: var(--glass-fill); color: var(--glass-text); }
  .pin-field input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: text; }
  .pin-field:focus-within .pin-digits span { border-color: var(--color-accent-warm); }
</style>
