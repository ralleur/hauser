<script lang="ts">
  import { m } from '../../paraglide/messages.js';
  /* Geräte-Kachel (ehem. LightCard, B-xx): reduzierte Kachel für ALLE
     Overlay-Kategorien. Schaltbare Kategorien (light/switch/fan) togglen per Tap
     und öffnen das Detail per Long-Press; nicht-schaltbare (temp/info/media)
     öffnen das Detail direkt per Tap (Entscheidung Stufe 1). Der Zustand lebt
     im Icon-Feld; info/temp/media tragen zusätzlich eine kleine Wert-Zeile. */
  import Icon from './Icon.svelte';
  import { fittext } from '../actions/fittext.ts';
  import { coverCommand, mergedDevice, devicePending, deviceUnconfirmed, deviceReconcile } from '../state/commands.ts';
  import { coverHasTileButtons, tapDevice, tapToggles } from '../state/device-tap.ts';
  import { pulse } from '../actions/pulse.ts';
  import { longpress } from '../actions/longpress.ts';
  import { openDeviceDetail } from '../state/overlay.svelte.ts';
  import { binaryLabel, fmtSensor } from '../state/info-display.ts';
  import { fmtTemp } from '../format.ts';
  import type { Light } from '../state/app.svelte.ts';
  import type {
    LightValue, SwitchValue, ClimateValue, SensorValue, MediaValue, FanValue, CoverValue, LockValue, AlarmValue,
    WaterHeaterValue, NumberValue, SelectValue,
  } from '../adapter/types.ts';
  import { fanSpinDuration, fanPresetLabel } from '../state/fan-presets.ts';
  import { alarmStateLabel, coverStateLabel, lockStateLabel } from '../state/device-labels.ts';
  import { lightLevel } from '../state/light-presets.ts';

  interface Props { roomId: string; device: Light }
  const { roomId, device }: Props = $props();

  const category = $derived(device.category ?? 'light');
  /* Tap = Hauptaktion (R28): Licht/Schalter/Ventilator/Befeuchter schalten,
     Rollo fährt auf oder zu, Sauger und Mäher starten oder kehren heim, der
     Taster drückt. Schloss, Ventil und Alarm öffnen bewusst nur das Detail —
     ein versehentlicher Tap darf keine Tür entriegeln. */
  const toggles = $derived(tapToggles(device));

  const cur = $derived(mergedDevice(roomId, device));
  const pending = $derived(devicePending(device.entityId));

  // „Aktiv"-Zustand des Icon-Felds je Kategorie (sensor bleibt neutral).
  const isOn = $derived.by(() => {
    if (!cur) return false;
    if (category === 'temp') return (cur as ClimateValue).hvac !== 'off';
    if (category === 'media') return (cur as MediaValue).playing;
    if (category === 'info' && device.domain === 'sensor') return false;
    if (category === 'lock') return (cur as LockValue).locked;
    if (category === 'alarm') return (cur as AlarmValue).state !== 'disarmed';
    if (category === 'number' || category === 'select' || category === 'button') return false;
    return !!(cur as SwitchValue).on;
  });

  /* Ein laufender Ventilator dreht sein Symbol; das Tempo folgt der Stufe
     (null = steht still, dann keine Animation). */
  const spin = $derived(category === 'fan' ? fanSpinDuration(cur as FanValue | undefined) : null);

  /* Dimmbare Lampe: die Helligkeit färbt das Symbolfeld, damit 20 % und 100 %
     auf einen Blick auseinandergehen. */
  const level = $derived.by(() => {
    if (category !== 'light') return null;
    const value = cur as LightValue | undefined;
    return lightLevel(value?.brightness, !!value?.on, !!device.dimmable);
  });

  /* Wert-Zeile der nicht-schaltbaren Kategorien (Kachel-Ebene 1, kein Detail).
     null = kein Messwert; die Zeile bleibt dann leer statt einen Strich zu
     zeigen (R3, docs/23). */
  const stateLine = $derived.by(() => {
    if (toggles) return null;
    if (category === 'temp') {
      const c = cur as ClimateValue | undefined;
      return c ? `${fmtTemp(c.target)}° ${m.climate_target()}` : null;
    }
    if (category === 'media') {
      const media = cur as MediaValue | undefined;
      if (!media) return null;
      return media.playing ? (media.track ?? m.dev_playing()) : m.dev_paused();
    }
    if (category === 'lock') {
      const lock = cur as LockValue | undefined;
      return lock ? lockStateLabel(lock.state) : null;
    }
    if (category === 'valve') {
      const valve = cur as CoverValue | undefined;
      return valve ? coverStateLabel(valve.on, valve.moving) : null;
    }
    if (category === 'alarm') {
      const alarm = cur as AlarmValue | undefined;
      return alarm ? alarmStateLabel(alarm.state) : null;
    }
    if (category === 'water_heater') {
      const heater = cur as WaterHeaterValue | undefined;
      if (!heater) return null;
      return heater.mode ? `${fmtTemp(heater.target)}° ${fanPresetLabel(heater.mode)}` : `${fmtTemp(heater.target)}°`;
    }
    if (category === 'number') {
      const n = cur as NumberValue | undefined;
      return fmtSensor(n?.value, n?.unit);
    }
    if (category === 'select') {
      const sel = cur as SelectValue | undefined;
      return sel?.option ?? null;
    }
    if (device.domain === 'binary_sensor') {
      const s = cur as SwitchValue | undefined;
      return s ? binaryLabel(device.deviceClass, s.on) : null;
    }
    const s = cur as SensorValue | undefined;
    return fmtSensor(s?.value, s?.unit ?? device.unit);
  });

  /* Sensor-Kacheln zeigen nur ihren Wert, solange der Schalter im Detail den
     Namen nicht dazuholt — ohne Messwert bleibt der Name, sonst stünde die
     Kachel leer (R3). Der Name bleibt als Vorlesetext an der Kachel. */
  const valueOnly = $derived(category === 'info' && !device.showName && stateLine !== null);

  /* Rollo mit Tasten auf der Kachel (`ralleur/hauser#39`, Owner 2026-10-19):
     drei Ansichten, im Gerätedetail reihum umschaltbar. „large“ (Standard)
     ist eine Kachel breit und zwei hoch, Hoch und Runter untereinander, Stopp
     daneben; „compact“ bleibt eine normale Kachel, die Tasten ersetzen Name
     und Zustand; „plain“ ist die alte Kachel, die per Tipp auf- und zufährt.
     Symbol (und Name) öffnen das Detail mit dem Positionsbalken. */
  const coverValue = $derived(category === 'cover' ? cur as CoverValue | undefined : undefined);
  const coverMode = $derived(coverHasTileButtons(coverValue, device) ? device.coverTile ?? 'large' : 'plain');
  const coverLine = $derived.by(() => {
    if (!coverValue) return '';
    const label = coverStateLabel(coverValue.on, coverValue.moving);
    return coverValue.supportsPosition ? `${label} · ${Math.round(coverValue.position)} %` : label;
  });

  /* Dieselbe Regel wie ein Tipp aufs Gerät im Raumbild (device-tap.ts). */
  function onTap() {
    tapDevice(roomId, device);
  }

  /* Widerspruch (docs/02): on-Toggle → Wobble (zurückspringen) — nur bei
     schaltbaren Kategorien relevant. */
  let toggleWobble = $state(0);
  let seenSeq = 0;
  $effect(() => {
    if (!toggles) return;
    const ev = deviceReconcile(device.entityId);
    if (!ev || ev.seq <= seenSeq) return;
    seenSeq = ev.seq;
    const o = ev.optimistic as Partial<LightValue>;
    const s = ev.server as LightValue;
    if (o.on !== undefined && o.on !== s.on) toggleWobble++;
  });

  /* Konfidenz (Paket 6): bleibt das Echo eine Sekunde aus, pulsiert die Kachel
     einmal — derselbe Wobble-Token, nur ohne Rücksprung. */
  let echoWobble = $state(0);
  let wasUnconfirmed = false;
  $effect(() => {
    const unconfirmed = deviceUnconfirmed(device.entityId);
    if (unconfirmed && !wasUnconfirmed) echoWobble++;
    wasUnconfirmed = unconfirmed;
  });
</script>

<!-- Gesamte Kachel = Button. Schaltbare Kategorien spiegeln an/aus über
     aria-pressed; nicht-schaltbare öffnen das Detail (kein pressed-State).
     Icon dekorativ (aria-hidden), der Name trägt die Beschriftung. -->
{#if coverMode !== 'plain' && coverValue}
<div class="light-tile cover-tile" class:is-large={coverMode === 'large'} class:is-compact={coverMode === 'compact'}
     class:is-on={isOn} class:has-stop={coverValue.supportsStop} role="group" aria-label={device.name}>
  <button class="cover-tile-main pressable" type="button"
          aria-label={coverMode === 'compact' ? `${device.name}: ${coverLine}` : undefined}
          use:longpress={{ enabled: true, onLongPress: () => openDeviceDetail(roomId, device.id) }}
          onclick={() => openDeviceDetail(roomId, device.id)}>
    <span class="light-tile-icon" aria-hidden="true">
      <Icon name={device.icon ?? 'i-bulb'} />
      {#if pending}<span class="pending-dot" aria-hidden="true"></span>{/if}
    </span>
    {#if coverMode === 'large'}
      <span class="light-tile-label">
        <span class="light-tile-name" use:fittext={{ text: device.name }}>{device.name}</span>
        <span class="light-tile-state num">{coverLine}</span>
      </span>
    {/if}
  </button>
  {#if coverValue.supportsOpen}
    <button class="cover-tile-btn is-up pressable" type="button" aria-label={m.dev_open()}
            class:is-active={coverValue.moving === 'opening'}
            onclick={() => coverCommand(device.entityId, 'cover', 'open')}><Icon name="i-arrow-up" /></button>
  {/if}
  {#if coverValue.supportsStop}
    <button class="cover-tile-btn is-stop pressable" type="button" aria-label={m.dev_stop()}
            onclick={() => coverCommand(device.entityId, 'cover', 'stop')}><Icon name="i-stop" /></button>
  {/if}
  {#if coverValue.supportsClose}
    <button class="cover-tile-btn is-down pressable" type="button" aria-label={m.dev_close()}
            class:is-active={coverValue.moving === 'closing'}
            onclick={() => coverCommand(device.entityId, 'cover', 'close')}><Icon name="i-arrow-down" /></button>
  {/if}
</div>
{:else}
<button class="light-tile pressable" type="button"
        class:is-on={isOn} class:is-value-only={valueOnly} aria-pressed={toggles ? isOn : undefined}
        aria-label={valueOnly ? `${device.name}: ${stateLine}` : undefined}
        use:pulse={{ seq: toggleWobble + echoWobble, cls: 'is-wobble', ms: 200 }}
        use:longpress={{ enabled: true, onLongPress: () => openDeviceDetail(roomId, device.id) }}
        onclick={onTap}>
  <span class="light-tile-icon" class:is-spinning={spin !== null}
        style={spin !== null ? `--fan-spin:${spin}` : level !== null ? `--light-level:${level}` : undefined}
        aria-hidden="true">
    <Icon name={device.icon ?? 'i-bulb'} />
    {#if pending}<span class="pending-dot" aria-hidden="true"></span>{/if}
  </span>
  <span class="light-tile-label">
    {#if valueOnly}
      <!-- Lange Werte werden kleiner statt abgeschnitten (wie die Namen). -->
      <span class="light-tile-value num" use:fittext={{ text: stateLine ?? '' }}>{stateLine}</span>
    {:else}
      <!-- Lange Gerätenamen werden kleiner statt abgeschnitten. -->
      <span class="light-tile-name" use:fittext={{ text: device.name }}>{device.name}</span>
      {#if stateLine !== null}<span class="light-tile-state num" use:fittext={{ text: stateLine }}>{stateLine}</span>{/if}
    {/if}
  </span>
</button>
{/if}
