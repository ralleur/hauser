<script lang="ts">
  import '../../styles/room-controls.css';
  /* ── RoomControls (B-13): Steuer-Details des gewählten Raums im linken Panel.
     Reihenfolge Szenen → Licht → Klima. ── */
  import Icon from './Icon.svelte';
  import DeviceTile from './DeviceTile.svelte';
  import CameraFeed from './CameraFeed.svelte';
  import { HVAC_MODES, type Room } from '../state/app.svelte.ts';
  import { mergedClimate, climateReconcile, stepTarget, setHvac, roomTemperature, roomHumidity } from '../state/commands.ts';
  import { type SceneId } from '../state/scene-config.ts';
  import { applyScene, openSceneEdit, scenes, isSceneActive } from '../state/scene-manager.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { openRoomEdit } from '../state/overlay.svelte.ts';
  import { pulse } from '../actions/pulse.ts';
  import { fmtTemp } from '../format.ts';
  import type { ClimateValue } from '../adapter/types.ts';
  import { cameraPopouts } from '../state/camera-popouts.svelte.ts';

  import { m } from '../../paraglide/messages.js';
  let { room }: { room: Room } = $props();

  const climate = $derived(mergedClimate(room.id));
  /* Ist-Temperatur mit Fallback-Kette (dedizierter Sensor > Thermostat-Ist >
     nichts) — kein Mock mehr. null wird explizit als nicht verfügbar gezeigt. */
  const temp = $derived(roomTemperature(room.id));
  const humidity = $derived(roomHumidity(room.id));
  const roomScenes = $derived(scenes(room.id));
  const cameraDevices = $derived(room.lights.filter((device) => device.category === 'camera' && !cameraPopouts.has(device.entityId)));
  const tileDevices = $derived(room.lights.filter((device) => device.category !== 'camera'));

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
  {#if roomScenes.length > 0}
    <section class="detail-section">
      <div class="scene-row">
        {#each roomScenes as s (s.id)}
          {@const active = isSceneActive(room.id, s.id)}
          <button class="scene-btn pressable" type="button" class:is-active={active}
                  aria-pressed={active}
                  use:longpress={{ onLongPress: () => openSceneEdit(room.id, s.id) }}
                  onclick={(e) => onSceneTap(s.id, e)}>
            {s.label}<span class="scene-check"><Icon name="i-check" cls="icon icon-md" /></span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <section class="detail-section">
    <div class="light-list">
      {#each tileDevices as device (device.id)}
        <DeviceTile roomId={room.id} {device} />
      {:else}
        <!-- Schlecht gepflegter Raum in HA: statt einer leeren Fläche eine
             Kachel im Geräte-Stil, die den Raum-Editor öffnet (wie Long-Press). -->
        <button class="light-tile is-placeholder pressable" type="button"
                onclick={() => openRoomEdit(room.id)}>
          <span class="light-tile-icon" aria-hidden="true"><Icon name="i-plus" /></span>
          <span class="light-tile-label">
            <span class="light-tile-name">{m.room_add_device()}</span>
          </span>
        </button>
      {/each}
    </div>
  </section>

  {#each cameraDevices as camera (camera.entityId)}
    <section class="detail-section">
      <CameraFeed
        entityId={camera.entityId}
        label={camera.name}
        titlebarVisible={cameraPopouts.titlebarVisible(camera.entityId)}
        onpopout={() => cameraPopouts.open(camera.entityId, camera.name, room.id)}
        ontoggletitlebar={() => cameraPopouts.toggleTitlebar(camera.entityId)}
      />
    </section>
  {/each}

  {#if climate}
    <section class="detail-section climate-section">
      <div class="climate-card">
        <div class="climate-warning" class:is-visible={room.windowOpen}>
          <Icon name="i-window" cls="icon icon-md" /><span>{m.room_window_open()}</span>
        </div>
        <div class="climate-current">
          <span class="climate-current-label">{m.climate_current()}</span>
          <span class="climate-temp num" class:is-unavailable={temp === null}>
            {#if temp !== null}
              {fmtTemp(temp)}<span class="unit">°<span class="unit-c">C</span></span>
            {:else}
              {m.media_unavailable()}
            {/if}
          </span>
          <div class="climate-current-meta">
            <Icon name="i-thermometer" cls="icon icon-xl" />
            <span>
              <strong>{m.climate_current_temperature()}</strong>
              <span class="climate-current-room-label">{m.climate_room_temperature()}</span>
              {#if humidity !== null}
                <small>{Math.round(humidity)} % {m.room_display_humidity()}</small>
              {/if}
            </span>
          </div>
        </div>

        <div class="climate-controller" aria-label="{m.climate_target_temperature()} {room.name}">
          <div class="climate-target-panel">
            <span class="climate-controller-label">{m.climate_target_temperature()}</span>
            <div class="climate-target-control">
              <button class="climate-step climate-step-down pressable" type="button" aria-label={m.room_temp_down()}
                      onclick={() => stepTarget(room.id, -0.5)}>
                <Icon name="i-chevron-down" cls="icon icon-xl climate-step-panel-icon" />
                <Icon name="i-minus" cls="icon icon-xl climate-step-phone-icon" />
              </button>
              <span class="climate-target-value num" use:pulse={{ seq: tempCorrect, cls: 'is-correct-fade', ms: 300 }}>{fmtTemp(climate.target)}°</span>
              <button class="climate-step climate-step-up pressable" type="button" aria-label={m.room_temp_up()}
                      onclick={() => stepTarget(room.id, 0.5)}>
                <Icon name="i-chevron-up" cls="icon icon-xl climate-step-panel-icon" />
                <Icon name="i-plus" cls="icon icon-xl climate-step-phone-icon" />
              </button>
            </div>
          </div>
          <div class="climate-mode-selector" role="radiogroup" aria-label={m.climate_mode_label()}>
            {#each HVAC_MODES as mode (mode.id)}
              <button class="climate-mode pressable" type="button" role="radio" data-mode={mode.id}
                      aria-label={mode.label} aria-checked={climate.hvac === mode.id} class:is-active={climate.hvac === mode.id}
                      onclick={() => setHvac(room.id, mode.id)}>
                <Icon name={mode.icon} cls="icon icon-xl" />
                <span>{mode.label}</span>
              </button>
            {/each}
          </div>
        </div>
      </div>
    </section>
  {/if}
</div>
