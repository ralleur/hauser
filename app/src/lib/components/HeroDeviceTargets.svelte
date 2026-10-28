<script lang="ts">
  import '../../styles/hero-device-targets.css';
  /* ── Geräte im Bild bedienen (Owner 2026-10-19) ──
     Jedes Gerät mit einer Stelle im Raumbild (Raum konfigurieren → Geräte
     zuweisen) bekommt hier eine unsichtbare Trefferfläche: Lampen ihre
     Lichtzone, alle anderen einen Punkt in Fingergröße. Ein Tipp wirkt wie
     ein Tipp auf die Kachel, langes Halten öffnet das Detail wie an der
     Kachel. Ein weicher Ring bestätigt den Tipp.

     Die Ebene liegt über der freien Trefferfläche der Bühne (deren langer
     Druck öffnet die Konfiguration), aber unter den Kontrollflächen: wo die
     Karte das Bild verdeckt, gehört der Finger der Karte. Sie bildet dieselbe
     Bildfläche nach wie das Raumbild (`.hero-image-space`), damit die Stellen
     genau dort liegen, wo sie im Editor gesetzt wurden. */
  import { appState } from '../state/app.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { roomLightPlacements } from '../state/immersion-light.svelte.ts';
  import { placementRotation, placementRy } from '../state/immersion-light.ts';
  import { heroParallax } from '../state/hero-parallax.svelte.ts';
  import { isLamp, tapDevice } from '../state/device-tap.ts';
  import { openDeviceDetail, openRoomClimate } from '../state/overlay.svelte.ts';
  import { climateEntityId } from '../state/entities.ts';
  import { roomImageDevices } from '../state/room-image-devices.ts';
  import { longpress } from '../actions/longpress.ts';
  import type { Light } from '../state/app.svelte.ts';

  /* Bildsteuerung: ein Tipp (Panel) bzw. Doppeltipp (Telefon) auf eine
     freie Stelle zeigt für einen Moment Zonen, Punkte und Namen; die Dauer
     hält der Aufrufer. */
  let { reveal = false, phone = false, position }: {
    reveal?: boolean;
    phone?: boolean;
    /** Tatsächlich gezeigter Bildausschnitt, auch beim Projekt-Fallback. */
    position?: string;
  } = $props();
  const phoneFocus = $derived((position ?? '50% 50%').split(' ').map((value) => parseFloat(value) / 100));

  const room = $derived(appState.rooms.find((candidate) => candidate.id === appState.currentRoom));
  const heroConfig = $derived(roomHeroConfig(appState.currentRoom));
  const placements = $derived(roomLightPlacements(room?.id));
  const targets = $derived(roomImageDevices(room)
    .filter((device) => placements[device.entityId])
    .map((device) => ({ device, placement: placements[device.entityId], lamp: isLamp(device) })));

  let flash = $state<{ id: string; seq: number } | null>(null);

  function tap(device: Light): void {
    if (!room) return;
    if (device.entityId === climateEntityId(room.id)) openRoomClimate(room.id);
    else tapDevice(room.id, device);
    flash = { id: device.entityId, seq: (flash?.seq ?? 0) + 1 };
  }
  function hold(device: Light): void {
    if (!room) return;
    if (device.entityId === climateEntityId(room.id)) openRoomClimate(room.id, 'settings');
    else openDeviceDetail(room.id, device.id);
  }
</script>

{#if room && targets.length > 0}
  <div class="room-hero-targets" class:is-revealed={reveal} class:is-phone={phone} style:--hero-parallax={`${heroParallax.offsetPx}px`}>
    <div class="hero-image-space"
         style:--hero-focus-x={phone ? phoneFocus[0] : heroConfig?.focus.panel.x ?? 0.5}
         style:--hero-focus-y={phone ? phoneFocus[1] : heroConfig?.focus.panel.y ?? 0.5}>
      {#each targets as target (target.device.entityId)}
        <button class="hero-device-target" class:is-lamp={target.lamp} type="button"
                aria-label={target.device.name}
                style:left={`${target.placement.x * 100}%`} style:top={`${target.placement.y * 100}%`}
                style:width={target.lamp ? `${target.placement.radius * 200}%` : undefined}
                style:aspect-ratio={target.lamp ? `${target.placement.radius} / ${placementRy(target.placement)}` : undefined}
                style:rotate={target.lamp ? `${placementRotation(target.placement)}deg` : undefined}
                use:longpress={{ onLongPress: () => hold(target.device) }}
                onclick={() => tap(target.device)}>
          {#if flash?.id === target.device.entityId}
            {#key flash.seq}<span class="hero-device-flash" aria-hidden="true"></span>{/key}
          {/if}
        </button>
      {/each}
      {#each targets as target (target.device.entityId)}
        <span class="hero-device-label" class:is-lamp={target.lamp} aria-hidden="true"
              style:left={`${target.placement.x * 100}%`} style:top={`${target.placement.y * 100}%`}>{target.device.name}</span>
      {/each}
    </div>
  </div>
{/if}
