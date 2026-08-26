<script lang="ts">
  import LockButton from './LockButton.svelte';
  import { settingsValues } from '../state/settings.svelte.ts';
  import { nav } from '../state/nav.svelte.ts';
</script>

<!-- ── Standby-FAB: prominenter Lock-Button unten rechts, auf allen Screens.
     Langes Halten bietet den direkten Wechsel in die Titelleiste an.
     Auf dem Ambient-Screen unerreichbar — der Layer (z-50) liegt darüber. -->
{#if !settingsValues.classicLockButton && nav.screen !== 'system'}
  <LockButton variant="large" />
{/if}
