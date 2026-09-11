<script lang="ts">
  import '../../styles/room-controls.css';
  import { whenEditable } from '../state/edit-mode.svelte.ts';
  /* ── RoomControls (B-13): Steuer-Details des gewählten Raums im linken Panel.
     Reihenfolge Szenen → Licht → Klima. ── */
  import Icon from './Icon.svelte';
  import DeviceTile from './DeviceTile.svelte';
  import CameraFeed from './CameraFeed.svelte';
  import ClimateCard from './ClimateCard.svelte';
  import { type Room } from '../state/app.svelte.ts';
  import { mergedClimate, roomTemperature } from '../state/commands.ts';
  import { climateInline, climateTileShows } from '../state/room-display-config.svelte.ts';
  import { type SceneId } from '../state/scene-config.ts';
  import { applySceneWithUndo, openSceneEdit, scenes, isSceneActive } from '../state/scene-manager.svelte.ts';
  import { longpress } from '../actions/longpress.ts';
  import { fittext } from '../actions/fittext.ts';
  import { openRoomEdit, openRoomClimate } from '../state/overlay.svelte.ts';
  import { fmtTemp } from '../format.ts';
  import { cameraPopouts } from '../state/camera-popouts.svelte.ts';

  import { m } from '../../paraglide/messages.js';
  /* `compactClimate` (Panel): Klima ist eine Kachel unter den Geräten, die
     Steuerung liegt im Overlay — außer der Raum will die Karte in der Leiste. */
  let { room, compactClimate = false }: { room: Room; compactClimate?: boolean } = $props();

  const climate = $derived(mergedClimate(room.id));
  const climateAsTile = $derived(compactClimate && !climateInline(room.id));
  const temp = $derived(roomTemperature(room.id));
  /* Wert-Zeile der Klima-Kachel: Soll, Ist oder beides (Einstellung je Raum). */
  const climateLine = $derived.by(() => {
    if (!climate) return '';
    const shows = climateTileShows(room.id);
    const target = `${fmtTemp(climate.target)}° ${m.climate_target()}`;
    const current = temp !== null ? `${fmtTemp(temp)}° ${m.climate_current()}` : null;
    if (shows === 'target' || current === null) return target;
    if (shows === 'current') return current;
    /* Beides in Kachelbreite: erst Soll, dann Ist — die Wörter trägt nur
       der Vorlesetext, sonst schneidet die Kachel ab. */
    return `${fmtTemp(climate.target)}° · ${fmtTemp(temp!)}°`;
  });
  const roomScenes = $derived(scenes(room.id));
  /* Die Demo hat Kameras ohne Bild. Eine Kachel, die nur „kein Bild" sagt,
     widerspricht „Schwäche mit Würde" — im Demo-Build fehlt sie. Die
     Haushaltskonfiguration bleibt unverändert, damit ihre Parität hält. */
  const IS_DEMO_BUILD = import.meta.env?.VITE_DEMO === '1';
  const cameraDevices = $derived(IS_DEMO_BUILD ? [] : room.lights.filter((device) => device.category === 'camera' && !cameraPopouts.has(device.entityId)));
  const tileDevices = $derived(room.lights.filter((device) => device.category !== 'camera'));

  /* Tap wendet die Szene an (echte Einzel-Commands, state/scene-manager);
     Long-Press öffnet den Szenen-Editor (Mitglieder anpassen). */
  function onSceneTap(sceneId: SceneId, e: MouseEvent) {
    applySceneWithUndo(room.id, sceneId);
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
                  use:longpress={{ onLongPress: whenEditable(() => openSceneEdit(room.id, s.id)) }}
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
      {#if climate && climateAsTile}
        <!-- Klima als Kachel in Gerätegröße: Tap öffnet die Steuerung, langer
             Druck die Einstellungen der Kachel (Owner-Entscheidung 2026-09-11). -->
        <button class="light-tile climate-tile pressable" type="button" class:is-on={climate.hvac !== 'off'}
                aria-label={`${m.cat_temp()} ${room.name}: ${fmtTemp(climate.target)}° ${m.climate_target()}${temp !== null ? `, ${fmtTemp(temp)}° ${m.climate_current()}` : ''}`}
                use:longpress={{ onLongPress: whenEditable(() => openRoomClimate(room.id, 'settings')) }}
                onclick={() => openRoomClimate(room.id, 'control')}>
          <span class="light-tile-icon" aria-hidden="true"><Icon name="i-thermometer" /></span>
          <span class="light-tile-label">
            <span class="light-tile-name">{m.cat_temp()}</span>
            <span class="light-tile-state num" use:fittext={{ text: climateLine }}>{climateLine}</span>
          </span>
        </button>
      {/if}
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

  {#if climate && !climateAsTile}
    <section class="detail-section climate-section">
      <ClimateCard {room} stacked={compactClimate}
                   onLongPress={compactClimate ? whenEditable(() => openRoomClimate(room.id, 'settings')) : undefined} />
    </section>
  {/if}
</div>
