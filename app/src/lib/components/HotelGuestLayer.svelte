<script lang="ts">
  /* ── Gastebene über der laufenden Raumansicht ──
     Zuerst der Welcome Screen, nach dem Antippen das Lern-Overlay. Beides liegt
     als eigene Ebene über der unveränderten Hauser-Oberfläche — kein Control
     und keine Shell muss dafür angepasst werden. */
  import HotelCheckoutButton from './HotelCheckoutButton.svelte';
  import HotelCoachOverlay from './HotelCoachOverlay.svelte';
  import HotelWelcomeScreen from './HotelWelcomeScreen.svelte';
  import type { HotelWelcomeView } from './hotel-welcome.ts';

  let { view, checkoutEnabled = false }:
    { view: HotelWelcomeView; checkoutEnabled?: boolean } = $props();

  let entered = $state(false);
</script>

{#if entered}
  <HotelCoachOverlay />
  {#if checkoutEnabled}
    <HotelCheckoutButton />
  {/if}
{:else}
  <HotelWelcomeScreen {view} onEnter={() => { entered = true; }} />
{/if}
