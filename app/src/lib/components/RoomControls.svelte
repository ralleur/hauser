<script lang="ts">
  import '../../styles/room-controls.css';
  /* ── RoomControls (B-13): Steuer-Details des gewählten Raums im linken Panel.
     Reihenfolge Szenen → Licht → Klima. Die Klima-Kachel ist verschlankt: statt
     doppeltem Ziel-Quadrat + Stepper + Modus-Zeile nur noch die Ist-Temperatur
     plus EINE Pille (wie das TabBar-Klima-Dock: blau = kälter, rot = wärmer),
     die die Zieltemperatur des Raums setzt. ── */
  import Icon from './Icon.svelte';
  import DeviceTile from './DeviceTile.svelte';
  import CameraFeed from './CameraFeed.svelte';
  import { HVAC_MODES, type Room } from '../state/app.svelte.ts';
  import { mergedClimate, climateReconcile, stepTarget, setHvac, roomTemperature } from '../state/commands.ts';
  import { SCENES, type SceneId } from '../state/scene-config.ts';
  import { applyScene, openSceneEdit } from '../state/scene-manager.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { pulse } from '../actions/pulse.ts';
  import { fmtTemp } from '../format.ts';
  import type { ClimateValue } from '../adapter/types.ts';
  import { roomCameraEntityId } from '../state/entities.ts';

  import { m } from '../../paraglide/messages.js';
  let { room }: { room: Room } = $props();

  const climate = $derived(mergedClimate(room.id));
  /* Ist-Temperatur mit Fallback-Kette (dedizierter Sensor > Thermostat-Ist >
     nichts) — kein Mock mehr. null wird explizit als nicht verfügbar gezeigt. */
  const temp = $derived(roomTemperature(room.id));
  const cameraEntityId = $derived(roomCameraEntityId(room.id));

  /* Klima-Widerspruch (docs/02): Ziel ist ein Stepper (diskret) → 300-ms-
     Korrektur als Opacity-Crossfade des Werts. */
  let tempCorrect = $state(0);
  let seenSeq = 0;
  $effect(() => {
    const ev = climateReconcile(room.id);
    if (!ev || ev.seq <= seenSeq) return;
    seenSeq = ev.seq;
    const o = ev.optimistic as Partial<ClimateValue>;
    const s = ev.server as ClimateValue;
    if (o.target !== undefined && o.target !== s.target) tempCorrect++;
  });

  /* Tap wendet die Szene an (echte Einzel-Commands, state/scene-manager);
     Long-Press öffnet den Szenen-Editor (Mitglieder anpassen). */
  function onSceneTap(sceneId: SceneId, e: MouseEvent) {
    applyScene(room.id, sceneId);
    const btn = e.currentTarget as HTMLElement;
    btn.classList.remove('is-success');
    void btn.offsetWidth;
    btn.classList.add('is-success');
  }
</script>

<div class="room-controls">
  <section class="detail-section">
    <div class="scene-row">
      {#each SCENES as s (s.id)}
        <button class="scene-btn pressable" type="button"
                use:longpress={{ onLongPress: () => openSceneEdit(room.id, s.id) }}
                onclick={(e) => onSceneTap(s.id, e)}>
          {s.label}<span class="scene-check"><Icon name="i-check" cls="icon icon-md" /></span>
        </button>
      {/each}
    </div>
  </section>

  <section class="detail-section">
    <div class="light-list">
      {#each room.lights as device (device.id)}
        <DeviceTile roomId={room.id} {device} />
      {/each}
    </div>
  </section>

  {#if cameraEntityId}
    <section class="detail-section">
      <CameraFeed entityId={cameraEntityId} label="Balkon" />
    </section>
  {/if}

  {#if climate}
    <section class="detail-section">
      <span class="caps-label">{m.climate_temperature()}</span>
      <div class="climate-card">
        <div class="climate-warning" class:is-visible={room.windowOpen}>
          <Icon name="i-window" cls="icon icon-md" /><span>{m.room_window_open()}</span>
        </div>
        <div class="climate-hero">
          <span class="climate-temp num" class:is-unavailable={temp === null}>
            {#if temp !== null}
              {fmtTemp(temp)}<span class="unit">°C</span>
            {:else}
              {m.media_unavailable()}
            {/if}
          </span>
          <div class="climate-pills">
            <!-- Zieltemperatur des Raums als Pille (identisch zum TabBar-Klima-Dock). -->
            <div class="climate-dock room-climate-pill" aria-label="Zieltemperatur {room.name}">
              <button class="cd-key cd-key-down pressable" type="button" aria-label={m.room_temp_down()}
                      onclick={() => stepTarget(room.id, -0.5)}><Icon name="i-chevron-down" cls="icon cd-chevron" /></button>
              <div class="cd-readout">
                <span class="cd-value num" use:pulse={{ seq: tempCorrect, cls: 'is-correct-fade', ms: 300 }}>{fmtTemp(climate.target)}°</span>
                <span class="cd-sub">{m.climate_target()}</span>
              </div>
              <button class="cd-key cd-key-up pressable" type="button" aria-label={m.room_temp_up()}
                      onclick={() => stepTarget(room.id, 0.5)}><Icon name="i-chevron-up" cls="icon cd-chevron" /></button>
            </div>
            <!-- Modus als zweite Pille, gleiche Breite: 3 Segmente zur Auswahl. -->
            <div class="mode-pill" role="radiogroup" aria-label="Modus">
              {#each HVAC_MODES as m (m.id)}
                <button class="mode-seg pressable" type="button" role="radio" data-mode={m.id}
                        aria-label={m.label} aria-checked={climate.hvac === m.id} class:is-active={climate.hvac === m.id}
                        onclick={() => setHvac(room.id, m.id)}>
                  <Icon name={m.icon} cls="icon icon-md" />
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </section>
  {/if}
</div>
