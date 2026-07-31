<script lang="ts">
  /* ── Room-Hero (B-13): Vollbild-Bühne hinter dem Home-Screen. Der Hintergrund
     zeigt die Comic-Collage (kein Raum gewählt) bzw. den selektierten Raum, in
     der jeweiligen Tag/Nacht-Variante (`appState.theme` folgt sun.sun, docs/07).

     Performance (docs/03, 144 Hz = 6,9 ms/Frame): Wechsel als reiner
     Opacity-Crossfade zweier gestapelter Ebenen — nur `opacity` animiert,
     Compositor-only, kein Layout/Paint, kein Live-`backdrop-filter`. Das neue
     Bild wird per `Image.decode()` fertig dekodiert, BEVOR es eingeblendet wird,
     damit der Crossfade nicht auf einen Decode-Hitch trifft. ── */
  import { appState } from '../state/app.svelte.ts';
  import type { LightValue } from '../adapter/types.ts';
  import { mergedDevice } from '../state/commands.ts';
  import { roomLightPlacements } from '../state/immersion-light.svelte.ts';
  import { heroAssetUrl } from './room-hero-assets.ts';

  const base = import.meta.env.BASE_URL;

  // Der Theme-Controller projiziert Sonnenautomatik beziehungsweise fixierten
  // Tag/Abend einmalig in appState.heroSun; Panel und Phone lesen denselben Wert.
  const room = $derived(appState.rooms.find((candidate) => candidate.id === appState.currentRoom));
  const placements = $derived(roomLightPlacements(room?.id));
  const assignedLights = $derived((room?.lights ?? []).filter((light) => placements[light.entityId]));
  const renderedLights = $derived(assignedLights.map((device) => {
    const value = mergedDevice(room?.id ?? '', device) as LightValue | undefined;
    return { device, placement: placements[device.entityId], value };
  }));
  const allAssignedLightsOff = $derived(assignedLights.length > 0 && renderedLights.every(({ value }) => value?.on !== true));
  const showImmersion = $derived(appState.heroSun?.day === false && !allAssignedLightsOff);
  const targetUrl = $derived(heroAssetUrl({
    baseUrl: base,
    roomId: appState.currentRoom,
    sun: appState.heroSun,
    fallbackTheme: appState.theme,
    allAssignedLightsOff,
  }));

  // Doppelpuffer: eine Ebene vorne (sichtbar), eine hinten. Neues Bild lädt in
  // die hintere Ebene, nach decode() wird die Sichtbarkeit getauscht.
  let layerA = $state('');
  let layerB = $state('');
  let front = $state<'a' | 'b'>('a');
  let shown = '';

  $effect(() => {
    const url = targetUrl;
    if (url === shown) return;
    shown = url;
    const img = new Image();
    img.src = url;
    const swap = () => {
      // Zwischenzeitlicher Zielwechsel? Dann diesen Swap verwerfen.
      if (shown !== url) return;
      if (front === 'a') { layerB = url; front = 'b'; }
      else { layerA = url; front = 'a'; }
    };
    img.decode().then(swap).catch(swap);
  });
</script>

<div class="room-hero" aria-hidden="true">
  <div class="hero-layer" class:is-front={front === 'a'}
       style:background-image={layerA ? `url("${layerA}")` : undefined}></div>
  <div class="hero-layer" class:is-front={front === 'b'}
       style:background-image={layerB ? `url("${layerB}")` : undefined}></div>
  <svg class="immersion-light-layer" class:is-visible={showImmersion}
       viewBox="0 0 3392 2400" preserveAspectRatio="xMidYMid slice">
    <defs>
      {#each renderedLights as light, index (light.device.entityId)}
        <radialGradient id={`immersion-light-${index}`}>
          <stop offset="0" stop-color={light.value?.color ?? 'var(--light-temp-warm)'} stop-opacity="0.7" />
          <stop offset="0.35" stop-color={light.value?.color ?? 'var(--light-temp-warm)'} stop-opacity="0.28" />
          <stop offset="1" stop-color={light.value?.color ?? 'var(--light-temp-warm)'} stop-opacity="0" />
        </radialGradient>
      {/each}
    </defs>
    {#each renderedLights as light, index (light.device.entityId)}
      <circle
        class:is-on={light.value?.on === true}
        cx={light.placement.x * 3392}
        cy={light.placement.y * 2400}
        r={light.placement.radius * 3392}
        fill={`url(#immersion-light-${index})`}
        style:--light-opacity={(light.value?.brightness ?? 100) / 100}
      />
    {/each}
  </svg>
</div>
