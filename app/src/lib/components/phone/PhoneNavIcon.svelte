<script lang="ts">
  import type { PhoneNavTarget } from '../../state/phone-nav-order.svelte.ts';

  let { id }: { id: PhoneNavTarget | 'more' } = $props();
</script>

{#if id === 'home'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M9.5 20v-6h5v6" /></svg>
{:else if id === 'calendar'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14a1 1 0 0 1 1 1V20H4V5.5a1 1 0 0 1 1-1ZM8 2v5m8-5v5M4 9h16" /></svg>
{:else if id === 'media'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12M9 18a3 2 0 1 1-6 0 3 2 0 0 1 6 0Zm10-2a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z" /></svg>
{:else if id === 'shopping'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14l-1 13H6L5 7Zm3 0V5a4 4 0 0 1 8 0v2" /></svg>
{:else if id === 'reminders'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6zM9 9h6m-6 4h6" /></svg>
{:else if id === 'energy'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></svg>
{:else if id === 'ablage'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM3 4h18v3H3zm6 7h6" /></svg>
{:else if id === 'system'}
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></svg>
{:else}
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
{/if}
