<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Icon from './Icon.svelte';
  import TimePicker from './TimePicker.svelte';
  let { value = $bindable(), label, disabled = false }: { value: string; label: string; disabled?: boolean } = $props();
  let open = $state(false);
</script>
<button class="settings-input time-field pressable" type="button" {disabled} aria-label={`${label}: ${value}`} aria-haspopup="dialog" onclick={() => { open = true; }}>
  <span class="num">{value}</span><Icon name="i-clock-outline" cls="icon icon-md" />
</button>
{#if open}<TimePicker {value} {label} onclose={() => { open = false; }} onconfirm={(next) => { value = next; open = false; }} />{/if}
<style>
  .time-field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); width: calc(var(--space-8) * 2); min-height: var(--touch-min); color: var(--color-text-primary); }
</style>
