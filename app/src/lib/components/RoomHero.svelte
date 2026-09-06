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
  import { inDuskBand } from '../state/dusk.ts';
  import { heroParallax } from '../state/hero-parallax.svelte.ts';
  import { simulation } from '../state/simulation.svelte.ts';
  import {
    loadRoomHero,
    resolveRoomHero,
    type HeroImageCandidate,
  } from './room-hero-assets.ts';
  import { decodeHeroImageOffThread } from './hero-image-decoder.ts';
  import { outdoor, refreshWeather } from '../state/weather.svelte.ts';
  import { heroWeatherLayer, resolvedWeatherCondition } from '../state/hero-weather.ts';
  import {
    loadRoomRegionsOnce, regionClipPaths, roomHasOvercast, roomRegions,
  } from '../state/room-regions.svelte.ts';
  import type { RoomImageRegion } from '../state/room-image-library-client.ts';
  import { prefersReducedMotion } from '../motion/index.ts';
  import { settingsValues } from '../state/settings.svelte.ts';
  import type { Component } from 'svelte';

  const base = import.meta.env.BASE_URL;
  /* Spiegelt `--duration-dusk` mit etwas Luft: nur zum Abräumen der Klasse. */
  const DIM_RESET_MS = 1300;

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
  /* Ob das Zimmer im Dunkeln liegt, entscheiden alle Lampen des Raums — nicht
     nur die, die im Bild eine Position haben. Die Position bestimmt, wo ein
     Lichtschein liegt; ob überhaupt Licht brennt, hat damit nichts zu tun.
     Vorher hing beides an derselben Liste: Wer keine Lampe im Bild platziert
     hatte, sah abends immer die beleuchtete Nachtfassung, nie `dark-off`.

     Kennt Hauser im Raum gar keine Lampe, bleibt es bei der beleuchteten
     Fassung — „keine bekannte Lampe" heißt nicht „dunkel".

     Der Werkstatt-Simulator kann „alle Lichter aus" erzwingen, auch dort. */
  const roomLightsOff = $derived.by(() => {
    const lights = room?.lights ?? [];
    if (lights.length === 0) return false;
    return lights.every((device) => (mergedDevice(room?.id ?? '', device) as LightValue | undefined)?.on !== true);
  });
  const allAssignedLightsOff = $derived(simulation.lightsOff ?? roomLightsOff);
  const showImmersion = $derived(appState.heroSun?.day === false && !allAssignedLightsOff);
  /* Trübes Wetter (Paket 13): Hat das Bildset eine trübe Fassung, zeigt die
     Bühne sie bei Regen und Schnee statt des Sonnenbildes — dann trägt sie das
     Wetter im Fenster, und beides zusammen ergibt einen Blick nach draußen.

     Bei bloßer Bewölkung bleibt bewusst das helle Bild stehen (Owner-
     Entscheidung 2026-09-06). Die graue Wirklichkeit sieht man ohnehin aus dem
     Fenster; Hauser noch einmal grau dazuzustellen gewinnt nichts. Der Raum in
     schönem Licht ist dann die bessere Antwort. */
  const dullOutside = $derived.by(() => {
    const condition = resolvedWeatherCondition(
      simulation.weather,
      typeof location === 'undefined' ? '' : location.search,
      outdoor.condition,
    );
    return condition === 'rainy' || condition === 'snowy';
  });
  const overcast = $derived(dullOutside && roomHasOvercast(appState.currentRoom));

  const targetHero = $derived(resolveRoomHero({
    target: 'panel',
    baseUrl: base,
    roomId: appState.currentRoom,
    config: heroConfig,
    sun: appState.heroSun,
    fallbackTheme: appState.theme,
    allAssignedLightsOff,
    overcast,
  }));

  /* ── Dämmerung (Paket 4) ──
     Innerhalb des Bandes um den Horizont existieren beide Tageszustände
     gleichzeitig: das dominante Bild trägt der Doppelpuffer wie bisher, das
     Gegenstück liegt als eigene Ebene darüber und wird direkt vom Sonnenstand
     ausgeblendet. Außerhalb des Bandes gibt es diese Ebene nicht — dann
     dekodiert die Bühne genau ein Bild, wie vor Paket 4. */
  const dusk = $derived(appState.heroDusk);
  const duskActive = $derived(inDuskBand(dusk));
  const dayDominant = $derived(appState.heroSun?.day ?? appState.theme === 'light');
  const counterHero = $derived(duskActive
    ? resolveRoomHero({
      target: 'panel',
      baseUrl: base,
      roomId: appState.currentRoom,
      config: heroConfig,
      sun: { day: !dayDominant },
      fallbackTheme: appState.theme,
      allAssignedLightsOff,
    })
    : null);
  /* Deckkraft des Gegenstücks, damit die Summe beider Ebenen über das ganze
     Band hinweg ein volles Bild ergibt. */
  const counterOpacity = $derived(dayDominant ? 1 - dusk : dusk);

  // Doppelpuffer: die dekodierte Zielauflösung wird in die hintere Ebene gelegt,
  // dann tauscht ausschließlich die Opacity-Klasse die Sichtbarkeit.
  let layerA = $state<HeroImageCandidate | null>(null);
  let layerB = $state<HeroImageCandidate | null>(null);
  let front = $state<'a' | 'b'>('a');
  let request = 0;
  let requested = '';
  let counterLayer = $state<HeroImageCandidate | null>(null);
  let counterRequest = 0;
  let counterRequested = '';

  /* Nachdimmen (Paket 4): geht das letzte Licht im Raum aus, sinkt das Bild
     über `--duration-dusk` in den unbeleuchteten Zustand, statt umzuklappen.
     Der umgekehrte Weg bleibt kurz — Licht an ist ein Schaltvorgang, kein
     Abendlicht. Die Klasse räumt sich selbst wieder ab, damit ein späterer
     Raumwechsel wieder im normalen Tempo läuft. */
  let dimming = $state(false);
  let dimmingTimer: ReturnType<typeof setTimeout> | undefined;
  let lastVariant: string | null = null;

  function resolutionKey(resolution: { userCandidate: HeroImageCandidate | null; projectFallback: HeroImageCandidate | null }): string {
    return [
      resolution.userCandidate?.url,
      resolution.userCandidate?.position,
      resolution.projectFallback?.url,
    ].join('|');
  }

  $effect(() => {
    const resolution = targetHero;
    const key = resolutionKey(resolution);
    if (key === requested) return;
    requested = key;
    const currentRequest = ++request;
    const dimNow = resolution.variant === 'dark-off' && lastVariant === 'dark';
    lastVariant = resolution.variant;

    void loadRoomHero(resolution, decodeHeroImageOffThread, () => request === currentRequest).then((candidate) => {
      if (!candidate || request !== currentRequest) return;
      clearTimeout(dimmingTimer);
      dimming = dimNow;
      if (dimNow) dimmingTimer = setTimeout(() => { dimming = false; }, DIM_RESET_MS);
      if (front === 'a') {
        layerB = candidate;
        front = 'b';
      } else {
        layerA = candidate;
        front = 'a';
      }
    });
  });

  /* Die Dämmerungsebene lädt nur im Band und verschwindet mit ihm — und über
     denselben Worker wie die Hauptebene (Paket 5), sonst dekodierte
     ausgerechnet das zweite Vollbild wieder auf dem Hauptthread. */
  $effect(() => {
    const resolution = counterHero;
    if (!resolution) {
      counterRequested = '';
      counterLayer = null;
      return;
    }
    const key = resolutionKey(resolution);
    if (key === counterRequested) return;
    counterRequested = key;
    const currentRequest = ++counterRequest;

    void loadRoomHero(resolution, decodeHeroImageOffThread, () => counterRequest === currentRequest).then((candidate) => {
      if (counterRequest !== currentRequest) return;
      counterLayer = candidate;
    });
  });

  /* ── Wetter im Fenster (Paket 13) ──
     Über dem Raumbild zieht Wetter nur dort, wo das Bildset ein Fenster
     kennt — sonst gar nicht. Der Schleier bleibt dem Standby vorbehalten:
     hier geht es um den Blick nach draußen, nicht um die Stimmung im Raum.
     Die Polygone kommen aus dem Katalog, die Schicht selbst erst bei Bedarf. */
  const windowClips = $derived(regionClipPaths(roomRegions(appState.currentRoom, 'window')));
  const weatherLayer = $derived.by(() => {
    if (!settingsValues.ambientWeather || windowClips.length === 0) return null;
    const condition = resolvedWeatherCondition(
      simulation.weather,
      typeof location === 'undefined' ? '' : location.search,
      outdoor.condition,
    );
    const resolved = heroWeatherLayer(condition, outdoor.windSpeed, prefersReducedMotion());
    /* Der bloße Schleier hat im Fenster nichts zu suchen — er würde die Scheibe
       einfärben, nicht das Wetter zeigen. */
    return resolved && !resolved.still ? resolved : null;
  });
  let HeroWeather = $state<Component<{ layer: NonNullable<typeof weatherLayer>; clip?: string | null }> | null>(null);
  /* Die Bibliothek trägt beides: die Fenster und die Frage, ob es eine trübe
     Fassung gibt. Sie wird einmal geholt, unabhängig vom Standby-Schalter. */
  $effect(() => {
    void loadRoomRegionsOnce();
    void refreshWeather();
  });
  $effect(() => {
    if (!weatherLayer || HeroWeather) return;
    void import('./HeroWeatherLayer.svelte')
      .then((loaded) => { HeroWeather = loaded.default; })
      .catch(() => { /* rein dekorativ: ohne Schicht bleibt die Bühne, wie sie ist */ });
  });

  /* Erkannte Flächen einblenden (Paket 13): nur auf Wunsch aus dem Simulator,
     deshalb erst dann geladen. Ohne Erkennung bleibt die Bühne unberührt. */
  const overlayRegions = $derived(simulation.regions ? roomRegions(appState.currentRoom) : []);
  let RegionOverlay = $state<Component<{ regions: readonly RoomImageRegion[] }> | null>(null);
  $effect(() => {
    if (overlayRegions.length === 0 || RegionOverlay) return;
    void import('./RegionOverlay.svelte')
      .then((loaded) => { RegionOverlay = loaded.default; })
      .catch(() => { /* Werkstatt-Werkzeug: fehlt es, fehlt nur die Einblendung */ });
  });

  $effect(() => () => clearTimeout(dimmingTimer));
</script>

<div class="room-hero" class:is-dimming={dimming} aria-hidden="true"
     style:--hero-parallax={`${heroParallax.offsetPx}px`}>
  <div class="hero-layer" class:is-front={front === 'a'}
       style:background-image={layerA ? `url("${layerA.url}")` : undefined}
       style:background-position={layerA?.position}></div>
  <div class="hero-layer" class:is-front={front === 'b'}
       style:background-image={layerB ? `url("${layerB.url}")` : undefined}
       style:background-position={layerB?.position}></div>
  {#if counterLayer}
    <div class="hero-layer is-dusk"
         style:opacity={counterOpacity}
         style:background-image={`url("${counterLayer.url}")`}
         style:background-position={counterLayer.position}></div>
  {/if}
  <!-- Alles, was in Bildkoordinaten liegt (Fenster, Flächen), gehört in diesen
       Rahmen: Er bildet exakt die Fläche nach, die das Raumbild nach dem
       `cover`-Zuschnitt einnimmt. Über der ganzen Bühne gezeichnet, säßen die
       Polygone dort, wo das Bild gerade abgeschnitten ist. -->
  {#if (RegionOverlay && overlayRegions.length > 0) || (HeroWeather && weatherLayer)}
    <div class="hero-image-space"
         style:--hero-focus-x={heroConfig?.focus.panel.x ?? 0.5}
         style:--hero-focus-y={heroConfig?.focus.panel.y ?? 0.5}>
      {#if HeroWeather && weatherLayer}
        {#each windowClips as clip, index (index)}
          <HeroWeather layer={weatherLayer} {clip} />
        {/each}
      {/if}
      {#if RegionOverlay && overlayRegions.length > 0}
        <RegionOverlay regions={overlayRegions} />
      {/if}
    </div>
  {/if}
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
