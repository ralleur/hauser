<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Wetter über dem Lockscreen (B-01B, Paket 9): eine einzige dekorative
     Schicht hinter Uhr, Wochenband und Zetteln. Bewusst ohne Canvas und ohne
     rAF — die Tropfen und Flocken sind gekachelte Verläufe, die der Compositor
     verschiebt. Kein Pointer-Ziel, kein Layout, keine Arbeit pro Frame im
     Hauptthread. Sie kommt mit dem Standby und geht mit ihm. */
  import { heroWeatherDurationMs, type HeroWeatherLayer } from '../state/hero-weather.ts';

  /* `clip` begrenzt die Schicht auf ein Fenster (Paket 13). Ohne clip füllt
     sie die ganze Fläche — so hängt sie im Standby. */
  const { layer, clip = null }: { layer: HeroWeatherLayer; clip?: string | null } = $props();

  const durationMs = $derived(heroWeatherDurationMs(layer));
</script>

<div class="hero-weather" class:is-window={clip !== null} aria-hidden="true"
     data-kind={layer.kind}
     style:clip-path={clip ?? undefined}
     style:--hero-weather-intensity={layer.intensity}
     style:--hero-weather-duration={`${durationMs}ms`}>
  <div class="hero-weather-veil"></div>
  {#if !layer.still}
    <div class="hero-weather-fall is-near"></div>
    <div class="hero-weather-fall is-far"></div>
  {/if}
</div>

<style>
  /* Die Tropfen nehmen die Schriftfarbe der Oberfläche, nicht hart Weiß:
     auf dem hellen Lockscreen wäre weiß auf weiß unsichtbar, im Dunkeln zu
     grell. Genau wie der Stadtplan-Layer, der dieselbe Farbe als Maske nutzt.
     Schnee ist die Ausnahme (Owner 2026-09-06): Flocken sind weiß und fast
     deckend, mit einem hauchdünnen kühlen Rand, der sie auf hellem Grund
     hält — schwarze Flocken lesen sich als Ruß, nicht als Schnee. */
  .hero-weather {
    --hero-weather-ink-strong: color-mix(in srgb, var(--color-text-primary) calc(42% * var(--hero-weather-intensity)), transparent);
    --hero-weather-ink: color-mix(in srgb, var(--color-text-primary) calc(34% * var(--hero-weather-intensity)), transparent);
    --hero-weather-ink-soft: color-mix(in srgb, var(--color-text-primary) calc(26% * var(--hero-weather-intensity)), transparent);
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    /* Im Standby hinter dem Inhalt, wie der Stadtplan: die Uhr bleibt die
       Hauptsache. Über dem Raumbild kehrt die Bühne das um (--hero-weather-z),
       dort liegt die Schicht über den Bildebenen und unter dem Lampenlicht. */
    z-index: var(--hero-weather-z, -1);
  }

  /* Im Fenster gelten andere Maße als über der ganzen Bühne (Paket 13). Ein
     Fenster ist ein paar hundert Pixel breit; die für den Vollbild-Standby
     gewählte Kachel legt darin gerade zwei, drei Tropfen ab, und die sind bei
     einem Drittel Deckkraft vor einer detailreichen Hausfassade unsichtbar.
     Deshalb hier: kleinere Kachel, kräftigere Spur, dafür fast kein Schleier —
     die Trübung trägt bereits die trübe Bildvariante. */
  .hero-weather.is-window {
    --hero-weather-ink-strong: color-mix(in srgb, var(--color-text-primary) calc(78% * var(--hero-weather-intensity)), transparent);
    --hero-weather-ink: color-mix(in srgb, var(--color-text-primary) calc(64% * var(--hero-weather-intensity)), transparent);
    --hero-weather-ink-soft: color-mix(in srgb, var(--color-text-primary) calc(48% * var(--hero-weather-intensity)), transparent);
  }

  .hero-weather.is-window[data-kind='rain'] .hero-weather-fall {
    background-image:
      radial-gradient(ellipse 1.4px 9px at 18% 12%, var(--hero-weather-ink-strong), transparent),
      radial-gradient(ellipse 1.4px 11px at 63% 38%, var(--hero-weather-ink), transparent),
      radial-gradient(ellipse 1.2px 8px at 41% 71%, var(--hero-weather-ink-soft), transparent),
      radial-gradient(ellipse 1.4px 10px at 86% 84%, var(--hero-weather-ink), transparent);
    background-size: 52px 66px, 74px 92px, 61px 78px, 87px 104px;
  }

  .hero-weather.is-window[data-kind='snow'] .hero-weather-fall {
    background-size: 78px 78px, 104px 104px, 87px 87px;
  }

  .hero-weather.is-window .hero-weather-veil {
    opacity: calc(var(--hero-weather-intensity) * 0.12);
  }

  /* Schleier: die eigentliche Aussage. Bei „bewölkt" steht er allein. */
  .hero-weather-veil {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(140, 160, 180, 0.30), rgba(90, 105, 125, 0.12));
    opacity: calc(var(--hero-weather-intensity) * 0.34);
  }

  .hero-weather[data-kind='snow'] .hero-weather-veil {
    background: linear-gradient(180deg, rgba(220, 230, 245, 0.30), rgba(180, 195, 215, 0.10));
  }

  /* Zwei gekachelte Ebenen ziehen mit unterschiedlichem Tempo durchs Bild —
     das gibt Tiefe, ohne eine einzige Partikelrechnung. Die Ebene ist deutlich
     größer als der Ausschnitt: sie kippt für den Schräganflug und darf dabei an
     keiner Kante hervorschauen. */
  .hero-weather-fall {
    position: absolute;
    left: -25%;
    top: -110%;
    width: 150%;
    height: 220%;
    will-change: transform;
    animation: hero-weather-fall var(--hero-weather-duration) linear infinite;
  }

  .hero-weather-fall.is-far {
    opacity: 0.45;
    animation-duration: calc(var(--hero-weather-duration) * 1.7);
  }

  /* Regen als einzelne kurze Tropfenspuren, nicht als durchgehende Linien:
     ein `repeating-linear-gradient` zieht Striche über das ganze Bild und sieht
     aus wie ein Kratzer auf dem Glas. Jede Kachel trägt ein paar weiche
     Ellipsen; vier Kachelgrößen übereinander ergeben Streuung ohne Muster. */
  .hero-weather[data-kind='rain'] {
    --hero-weather-tilt: 11deg;
  }

  .hero-weather[data-kind='rain'] .hero-weather-fall {
    background-image:
      radial-gradient(ellipse 1px 8px at 18% 12%, var(--hero-weather-ink-strong), transparent),
      radial-gradient(ellipse 1px 10px at 63% 38%, var(--hero-weather-ink), transparent),
      radial-gradient(ellipse 1px 7px at 41% 71%, var(--hero-weather-ink-soft), transparent),
      radial-gradient(ellipse 1px 9px at 86% 84%, var(--hero-weather-ink), transparent);
    background-size: 120px 150px, 170px 210px, 140px 180px, 200px 240px;
  }

  .hero-weather[data-kind='snow'] {
    /* Deckkraft hängt nur schwach am Wind: Schnee ist auch bei Windstille
       weiß, nicht grau. */
    --hero-weather-flake: rgba(255, 255, 255, calc(0.6 + 0.4 * var(--hero-weather-intensity)));
    --hero-weather-flake-soft: rgba(255, 255, 255, calc(0.45 + 0.35 * var(--hero-weather-intensity)));
    --hero-weather-flake-rim: rgba(110, 130, 158, calc(0.3 + 0.4 * var(--hero-weather-intensity)));
  }

  .hero-weather[data-kind='snow'] .hero-weather-fall {
    background-image:
      radial-gradient(circle at 20% 15%, var(--hero-weather-flake) 0 2.1px, var(--hero-weather-flake-rim) 2.7px 3.2px, transparent 3.8px),
      radial-gradient(circle at 70% 45%, var(--hero-weather-flake-soft) 0 3.1px, var(--hero-weather-flake-rim) 3.7px 4.3px, transparent 4.9px),
      radial-gradient(circle at 45% 80%, var(--hero-weather-flake) 0 2.1px, var(--hero-weather-flake-rim) 2.7px 3.2px, transparent 3.8px);
    background-size: 180px 180px, 240px 240px, 200px 200px;
  }

  /* Neigung und Fall in einem Transform: der Compositor bekommt eine einzige
     Eigenschaft, und die Kachel schließt über die halbe Höhe nahtlos.

     Die Bewegung läuft von 0 nach unten, nicht von oben nach 0. Andersherum
     stand die Ebene zu Beginn jedes Durchlaufs mit ihrer Unterkante genau auf
     der Oberkante der Bühne: Es schneite dann nur im oberen Teil des Bildes
     und die untere Hälfte blieb leer, bis der Durchlauf fast vorbei war. So
     herum deckt die Ebene die Fläche zu jedem Zeitpunkt ganz ab. */
  @keyframes hero-weather-fall {
    from { transform: rotate(var(--hero-weather-tilt, 0deg)) translate3d(0, 0, 0); }
    to { transform: rotate(var(--hero-weather-tilt, 0deg)) translate3d(0, 50%, 0); }
  }

  /* Ohne Bewegung bleibt der Schleier — die Schicht selbst entfällt bereits
     in der Zuordnung, diese Regel hält den Vertrag auch bei spätem Wechsel. */
  @media (prefers-reduced-motion: reduce) {
    .hero-weather-fall { animation: none; }
  }
</style>
