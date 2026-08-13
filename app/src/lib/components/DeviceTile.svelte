<script lang="ts">
  /* Geräte-Kachel (ehem. LightCard, B-xx): reduzierte Kachel für ALLE
     Overlay-Kategorien. Schaltbare Kategorien (light/switch) togglen per Tap
     und öffnen das Detail per Long-Press; nicht-schaltbare (temp/info/media)
     öffnen das Detail direkt per Tap (Entscheidung Stufe 1). Der Zustand lebt
     im Icon-Feld; info/temp/media tragen zusätzlich eine kleine Wert-Zeile. */
  import Icon from './Icon.svelte';
  import { mergedDevice, devicePending, deviceReconcile, toggleDevice } from '../state/commands.ts';
  import { pulse } from '../actions/pulse.ts';
  import { longpress } from '../actions/longpress.ts';
  import { openDeviceDetail } from '../state/overlay.svelte.ts';
  import { binaryLabel, fmtSensor } from '../state/info-display.ts';
  import { fmtTemp } from '../format.ts';
  import type { Light } from '../state/app.svelte.ts';
  import type { LightValue, SwitchValue, ClimateValue, SensorValue, MediaValue } from '../adapter/types.ts';

  interface Props { roomId: string; device: Light }
  const { roomId, device }: Props = $props();

  const category = $derived(device.category ?? 'light');
  const toggles = $derived(category === 'light' || category === 'switch');

  const cur = $derived(mergedDevice(roomId, device));
  const pending = $derived(devicePending(device.entityId));

  // „Aktiv"-Zustand des Icon-Felds je Kategorie (sensor bleibt neutral).
  const isOn = $derived.by(() => {
    if (!cur) return false;
    if (category === 'temp') return (cur as ClimateValue).hvac !== 'off';
    if (category === 'media') return (cur as MediaValue).playing;
    if (category === 'info' && device.domain === 'sensor') return false;
    return !!(cur as SwitchValue).on;
  });

  // Wert-Zeile der nicht-schaltbaren Kategorien (Kachel-Ebene 1, kein Detail).
  const stateLine = $derived.by(() => {
    if (toggles) return null;
    if (category === 'temp') {
      const c = cur as ClimateValue | undefined;
      return c ? `${fmtTemp(c.target)}° Ziel` : '—';
    }
    if (category === 'media') {
      const m = cur as MediaValue | undefined;
      if (!m) return '—';
      return m.playing ? (m.track ?? 'Läuft') : 'Pausiert';
    }
    if (device.domain === 'binary_sensor') {
      const s = cur as SwitchValue | undefined;
      return s ? binaryLabel(device.deviceClass, s.on) : '—';
    }
    const s = cur as SensorValue | undefined;
    return fmtSensor(s?.value, s?.unit ?? device.unit);
  });

  function onTap() {
    if (toggles) toggleDevice(roomId, device);
    else openDeviceDetail(roomId, device.id);
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
</script>

<!-- Gesamte Kachel = Button. Schaltbare Kategorien spiegeln an/aus über
     aria-pressed; nicht-schaltbare öffnen das Detail (kein pressed-State).
     Icon dekorativ (aria-hidden), der Name trägt die Beschriftung. -->
<button class="light-tile pressable" type="button"
        class:is-on={isOn} aria-pressed={toggles ? isOn : undefined}
        use:pulse={{ seq: toggleWobble, cls: 'is-wobble', ms: 200 }}
        use:longpress={{ enabled: true, onLongPress: () => openDeviceDetail(roomId, device.id) }}
        onclick={onTap}>
  <span class="light-tile-icon" aria-hidden="true">
    <Icon name={device.icon ?? 'i-bulb'} />
    {#if pending}<span class="pending-dot" aria-hidden="true"></span>{/if}
  </span>
  <span class="light-tile-label">
    <span class="light-tile-name">{device.name}</span>
    {#if stateLine !== null}<span class="light-tile-state num">{stateLine}</span>{/if}
  </span>
</button>
