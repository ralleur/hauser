<script lang="ts">
  /* ── Werkstatt-Simulator (Paket 4) ──
     Fünfmal auf die Uhr tippen öffnet dieses Feld. Es fährt die Dämmerung von
     Hand oder im Zeitraffer durch und erzwingt „alle Lichter aus", damit sich
     Überblendung und Nachdimmen beurteilen lassen, ohne auf Sonnenuntergang
     und Abendrunde zu warten. Vor allem beantwortet es die eine Frage, die man
     KI-erzeugten Bildpaaren ansieht: liegen Tag- und Nachtfassung deckungs-
     gleich übereinander?

     Bewusst deutschsprachig und ohne Übersetzung: das ist Werkstatt-Werkzeug
     hinter einer versteckten Geste, kein Teil der Oberfläche (siehe die
     Ausnahmeliste in `i18n-hardcoded-strings.test.ts`). */
  import { appState } from '../state/app.svelte.ts';
  import { simulator } from '../state/hud.svelte.ts';
  import {
    clearSimulation,
    setRegionOverlay,
    setSimulatedDusk,
    setSimulatedLightsOff,
    setSimulatedWeather,
    simulation,
    type SimulatedWeatherChoice,
  } from '../state/simulation.svelte.ts';
  import { roomRegions } from '../state/room-regions.svelte.ts';

  /* Ein Durchlauf dauert so lange wie das echte Band durch 60 — lang genug, um
     die Bewegung zu sehen, kurz genug, um sie mehrmals anzusehen. */
  const RUN_MS = 20_000;

  let running = $state<'sunset' | 'sunrise' | null>(null);
  let frame: number | undefined;

  const dusk = $derived(simulation.dusk ?? appState.heroDusk);
  const percent = $derived(Math.round(dusk * 100));

  /* Dieselben vier Lagen wie `?weather=`, dazu „aus" — nur ohne Neuladen.
     Der Wert bleibt der Schlüssel der Wetterlogik, deutsch ist nur das
     Schild darauf. */
  const WEATHER: readonly { value: SimulatedWeatherChoice; label: string }[] = [
    { value: 'sunny', label: 'Klar' },
    { value: 'cloudy', label: 'Bewölkt' },
    { value: 'rainy', label: 'Regen' },
    { value: 'snowy', label: 'Schnee' },
    { value: 'off', label: 'Aus' },
  ];

  /* Was die Erkennung in diesem Raum gefunden hat, nach Art gezählt. Steht
     beim Schalter, damit man vor dem Einblenden weiß, ob überhaupt etwas da
     ist — ein Raum ohne Erkennung sieht sonst aus wie ein Fehler. */
  const regionSummary = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const region of roomRegions(appState.currentRoom)) {
      counts.set(region.kind, (counts.get(region.kind) ?? 0) + 1);
    }
    return [...counts.entries()].map(([kind, count]) => `${kind} ${count}`).join(' · ');
  });

  /* Welche Dateien gerade übereinanderliegen — beim Beurteilen eines Bildpaars
     will man wissen, ob man das Projektbild oder das eigene sieht. */
  let layers = $state<string[]>([]);
  $effect(() => {
    void dusk;
    void simulation.lightsOff;
    void appState.currentRoom;
    const read = () => {
      layers = [...document.querySelectorAll('.room-hero .hero-layer')]
        .filter((el) => Number(getComputedStyle(el).opacity) > 0.01)
        .map((el) => {
          const match = getComputedStyle(el).backgroundImage.match(/[^/"]+\.avif/);
          const opacity = Number(getComputedStyle(el).opacity).toFixed(2);
          return `${match ? match[0] : '—'} · ${opacity}`;
        });
    };
    const id = setTimeout(read, 60);
    return () => clearTimeout(id);
  });

  function stop(): void {
    running = null;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function run(direction: 'sunset' | 'sunrise'): void {
    stop();
    running = direction;
    const from = direction === 'sunset' ? 1 : 0;
    const to = direction === 'sunset' ? 0 : 1;
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / RUN_MS);
      setSimulatedDusk(from + (to - from) * progress);
      if (progress >= 1) { stop(); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  function jump(value: number): void {
    stop();
    setSimulatedDusk(value);
  }

  function close(): void {
    stop();
    clearSimulation();
    simulator.active = false;
  }

  $effect(() => stop);
</script>

<aside class="sim-panel" aria-label="Werkstatt-Simulator">
  <header class="sim-head">
    <span class="sim-title">Simulator</span>
    <button class="sim-close pressable" type="button" onclick={close} aria-label="Simulator schließen">✕</button>
  </header>

  <div class="sim-row">
    <label class="sim-label" for="sim-dusk">
      Dämmerung
      <span class="sim-value num">{percent} %</span>
    </label>
    <input id="sim-dusk" class="sim-slider" type="range" min="0" max="1" step="0.01"
           value={dusk}
           oninput={(event) => jump(event.currentTarget.valueAsNumber)} />
  </div>

  <div class="sim-buttons">
    <button class="sim-btn pressable" type="button" onclick={() => jump(1)}>Tag</button>
    <button class="sim-btn pressable" type="button" onclick={() => jump(0.5)}>Mitte</button>
    <button class="sim-btn pressable" type="button" onclick={() => jump(0)}>Nacht</button>
  </div>

  <div class="sim-buttons">
    <button class="sim-btn pressable" type="button" class:is-active={running === 'sunset'}
            onclick={() => (running === 'sunset' ? stop() : run('sunset'))}>
      {running === 'sunset' ? 'Stopp' : 'Sonnenuntergang 20 s'}
    </button>
    <button class="sim-btn pressable" type="button" class:is-active={running === 'sunrise'}
            onclick={() => (running === 'sunrise' ? stop() : run('sunrise'))}>
      {running === 'sunrise' ? 'Stopp' : 'Sonnenaufgang 20 s'}
    </button>
  </div>

  <div class="sim-row">
    <label class="sim-check">
      <input type="checkbox" checked={simulation.lightsOff === true}
             onchange={(event) => setSimulatedLightsOff(event.currentTarget.checked ? true : null)} />
      Letztes Licht aus (Nachdimmen auf dark-off)
    </label>
  </div>

  <div class="sim-row">
    <span class="sim-label">Wetter</span>
    <div class="sim-buttons is-wrap">
      {#each WEATHER as entry (entry.value)}
        <button class="sim-btn pressable" type="button"
                class:is-active={simulation.weather === entry.value}
                onclick={() => setSimulatedWeather(simulation.weather === entry.value ? null : entry.value)}>
          {entry.label}
        </button>
      {/each}
    </div>
    <p class="sim-hint">
      {simulation.weather === null ? 'Echte Messung' : 'Von Hand gesetzt — nochmal tippen hebt auf'}
    </p>
  </div>

  <div class="sim-row">
    <label class="sim-check">
      <input type="checkbox" checked={simulation.regions}
             onchange={(event) => setRegionOverlay(event.currentTarget.checked)} />
      Erkannte Flächen einblenden
    </label>
    <p class="sim-hint num">{regionSummary || 'Für diesen Raum ist nichts erkannt'}</p>
  </div>

  <ul class="sim-layers num">
    {#each layers as layer (layer)}<li>{layer}</li>{/each}
  </ul>

  <button class="sim-btn sim-reset pressable" type="button" onclick={clearSimulation}>
    Zurück zur Wirklichkeit
  </button>
</aside>
