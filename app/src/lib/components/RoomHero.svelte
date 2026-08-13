<script lang="ts">
  /* ── Room-Hero (B-13): Vollbild-Bühne hinter dem Home-Screen.

     Performance (docs/03, 144 Hz = 6,9 ms/Frame): Wechsel als reiner
     Opacity-Crossfade zweier gestapelter Ebenen. User- und Projektbilder werden
     vor dem Einblenden dekodiert; bei doppeltem Fehler bleibt die letzte gültige
     Ebene beziehungsweise die neutrale Fläche sichtbar. ── */
  import { appState } from '../state/app.svelte.ts';
  import type { LightValue } from '../adapter/types.ts';
  import { mergedDevice } from '../state/commands.ts';
  import { roomLightPlacements } from '../state/immersion-light.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import {
    loadRoomHero,
    resolveRoomHero,
    type HeroImageCandidate,
  } from './room-hero-assets.ts';

  const base = import.meta.env.BASE_URL;

  // Herozuweisungen leben getrennt von den Device-Manager-Raumobjekten. Diese
  // bleiben ausschließlich für Licht-/Immersionsdaten zuständig.
  const room = $derived(appState.rooms.find((candidate) => candidate.id === appState.currentRoom));
  const heroConfig = $derived(roomHeroConfig(appState.currentRoom));
  const placements = $derived(roomLightPlacements(room?.id));
  const assignedLights = $derived((room?.lights ?? []).filter((light) => placements[light.entityId]));
  const renderedLights = $derived(assignedLights.map((device) => {
    const value = mergedDevice(room?.id ?? '', device) as LightValue | undefined;
    return { device, placement: placements[device.entityId], value };
  }));
  const allAssignedLightsOff = $derived(assignedLights.length > 0 && renderedLights.every(({ value }) => value?.on !== true));
  const showImmersion = $derived(appState.heroSun?.day === false && !allAssignedLightsOff);
  const targetHero = $derived(resolveRoomHero({
    target: 'panel',
    baseUrl: base,
    roomId: appState.currentRoom,
    config: heroConfig,
    sun: appState.heroSun,
    fallbackTheme: appState.theme,
    allAssignedLightsOff,
  }));

  // Doppelpuffer: die dekodierte Zielauflösung wird in die hintere Ebene gelegt,
  // dann tauscht ausschließlich die Opacity-Klasse die Sichtbarkeit.
  let layerA = $state<HeroImageCandidate | null>(null);
  let layerB = $state<HeroImageCandidate | null>(null);
  let front = $state<'a' | 'b'>('a');
  let request = 0;
  let requested = '';

  $effect(() => {
    const resolution = targetHero;
    const key = [
      resolution.userCandidate?.url,
      resolution.userCandidate?.position,
      resolution.projectFallback?.url,
    ].join('|');
    if (key === requested) return;
    requested = key;
    const currentRequest = ++request;

    void loadRoomHero(resolution, undefined, () => request === currentRequest).then((candidate) => {
      if (!candidate || request !== currentRequest) return;
      if (front === 'a') {
        layerB = candidate;
        front = 'b';
      } else {
        layerA = candidate;
        front = 'a';
      }
    });
  });
</script>

<div class="room-hero" aria-hidden="true">
  <div class="hero-layer" class:is-front={front === 'a'}
       style:background-image={layerA ? `url("${layerA.url}")` : undefined}
       style:background-position={layerA?.position}></div>
  <div class="hero-layer" class:is-front={front === 'b'}
       style:background-image={layerB ? `url("${layerB.url}")` : undefined}
       style:background-position={layerB?.position}></div>
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
