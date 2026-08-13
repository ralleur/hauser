<script lang="ts">
  /* Geräte-Detail (zweite Ebene, docs/07): EIN Modal für alle Overlay-Kategorien,
     per Long-Press (bzw. Tap bei nicht-schaltbaren Kacheln) geöffnet. Die Shell
     (Scrim, Panel, Header mit Symbol-Picker, Zustandsmaschine) ist das bisherige
     LightDetail-Muster; der Body verzweigt nach Kategorie:
     light = Helligkeit/Farbtemp/Farbe · switch = Ein/Aus · temp = Solltemp+Modus ·
     info = read-only Wert/Zustand · media = Play/Pause + Lautstärke (Stufe 1). */
  import Icon from './Icon.svelte';

  import TickScale from './TickScale.svelte';
  import { appState, COLOR_TEMP_MIN, COLOR_TEMP_MAX, HVAC_MODES, ROOM_SEED, type Light } from '../state/app.svelte.ts';
  import {
    mergedDevice, devicePending, deviceReconcile,
    toggleDevice, setBrightness, setColorTemp, setColor,
    setClimateTarget, setClimateHvac, toggleMediaEntity, setMediaVolume,
  } from '../state/commands.ts';
  import { deviceDetail, closeDeviceDetail, finishDeviceDetailClose } from '../state/overlay.svelte.ts';
  import { pulse } from '../actions/pulse.ts';
  import { LIGHT_COLOR_SWATCHES, tempTint, climateTint } from '../state/light-presets.ts';
  import { defaultIconFor, iconForDevice, persistLightIconOverride, resetLightIconOverride } from '../state/light-icons.ts';

  import { binaryLabel, fmtSensor } from '../state/info-display.ts';
  import { renameDevice } from '../state/device-manager.svelte.ts';
  import { fmtTemp } from '../format.ts';
  import type { LightValue, SwitchValue, ClimateValue, SensorValue, MediaValue } from '../adapter/types.ts';

  import { m } from '../../paraglide/messages.js';
  const roomId = $derived(deviceDetail.roomId);
  const deviceId = $derived(deviceDetail.deviceId);
  const device = $derived<Light | undefined>(
    appState.rooms.find((r) => r.id === roomId)?.lights.find((l) => l.id === deviceId),
  );
  const category = $derived(device?.category ?? 'light');
  const entityId = $derived(device?.entityId ?? '');

  // Gemergte Sicht (Server bzw. pending Intent); undefined tolerieren —
  // frisch eingeblendete Geräte haben ggf. noch keinen Wert (commands.ts).
  const cur = $derived(device ? mergedDevice(roomId, device) : undefined);
  const light = $derived(category === 'light' ? (cur as LightValue | undefined) : undefined);
  const sw = $derived(category === 'switch' || (category === 'info' && device?.domain === 'binary_sensor') ? (cur as SwitchValue | undefined) : undefined);
  const climate = $derived(category === 'temp' ? (cur as ClimateValue | undefined) : undefined);
  const sensor = $derived(category === 'info' && device?.domain === 'sensor' ? (cur as SensorValue | undefined) : undefined);
  const media = $derived(category === 'media' ? (cur as MediaValue | undefined) : undefined);
  const pending = $derived(!!device && devicePending(entityId));

  // Tap auf den Namen schaltet in einen kompakten Inline-Editor. Im Live-Betrieb
  // schreibt der Adapter in die HA Entity Registry, damit alle Browser denselben
  // Namen sehen; die lokale Config bleibt Cache/Fake-Fallback.
  let editingName = $state(false);
  let nameDraft = $state('');
  let nameError = $state('');
  let nameInput = $state<HTMLInputElement>();
  function beginNameEdit() {
    nameDraft = device?.name ?? '';
    nameError = '';
    editingName = true;
    requestAnimationFrame(() => { nameInput?.focus(); nameInput?.select(); });
  }
  async function saveName() {
    if (!editingName) return;
    const normalized = nameDraft.trim().replace(/\s+/g, ' ');
    if (!normalized || !device || normalized === device.name) { editingName = false; return; }
    nameError = '';
    try {
      await renameDevice(entityId, normalized);
      editingName = false;
    } catch (error) {
      nameError = error instanceof Error ? error.message : m.dev_name_save_failed();
    }
  }
  function onNameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); void saveName(); }
    if (event.key === 'Escape') { event.preventDefault(); editingName = false; nameError = ''; }
  }

  // „Aktiv"-Zustand fürs Piktogramm/den Power-Button je Kategorie.
  const isActive = $derived.by(() => {
    if (light) return light.on;
    if (sw) return sw.on;
    if (climate) return climate.hvac !== 'off';
    if (media) return media.playing;
    return false;
  });

  /* Kelvin-Range des Geräts (B-16B): HA meldet min/max_color_temp_kelvin —
     die Skala folgt dem Gerät statt der fixen UI-Range. Fallback = globale
     Konstanten (Seed-Lichter im Fake/Offline ohne gemeldete Range); eine
     degenerierte Range (min ≥ max) fällt ebenfalls zurück. */
  const tempRange = $derived.by(() => {
    const min = device?.colorTempMin ?? COLOR_TEMP_MIN;
    const max = device?.colorTempMax ?? COLOR_TEMP_MAX;
    return min < max ? { min, max } : { min: COLOR_TEMP_MIN, max: COLOR_TEMP_MAX };
  });

  // Drag-Puffer: der Finger führt, erst der Release dispatcht (docs/02 Slider).
  let dragBri = $state<number | null>(null);
  let dragTemp = $state<number | null>(null);
  let dragTarget = $state<number | null>(null);
  let dragVol = $state<number | null>(null);
  let brightnessIntro = $state(0);
  let previousDetailMode = deviceDetail.mode;
  const briDisplay = $derived(dragBri ?? (light?.on ? light.brightness : 0));
  const tempDisplay = $derived(
    Math.min(tempRange.max, Math.max(tempRange.min, dragTemp ?? light?.colorTemp ?? 2700)),
  );
  const targetDisplay = $derived(dragTarget ?? climate?.target ?? 20);
  const volDisplay = $derived(dragVol ?? media?.volume ?? 0);

  $effect(() => {
    const mode = deviceDetail.mode;
    if (mode === 'open' && previousDetailMode !== 'open') brightnessIntro += 1;
    previousDetailMode = mode;
  });

  function onBrightness(val: number, final: boolean) {
    dragBri = final ? null : val;
    if (final) setBrightness(roomId, deviceId, val);
  }
  function onTemp(val: number, final: boolean) {
    dragTemp = final ? null : val;
    if (final) setColorTemp(roomId, deviceId, val);
  }
  function onTarget(val: number, final: boolean) {
    dragTarget = final ? null : val;
    if (final) setClimateTarget(entityId, val);
  }
  function onVolume(val: number, final: boolean) {
    dragVol = final ? null : val;
    if (final) setMediaVolume(entityId, val);
  }

  // Primäraktion im Header: light/switch = Schalten, media = Play/Pause.
  const hasPower = $derived(category === 'light' || category === 'switch' || category === 'media');
  function onPower() {
    if (!device) return;
    if (category === 'media') toggleMediaEntity(entityId);
    else toggleDevice(roomId, device);
  }

  // Toggle-Widerspruch → Wobble (docs/02), analog Kachel.
  let toggleWobble = $state(0);
  let seenSeq = 0;
  $effect(() => {
    if (!device) return;
    const ev = deviceReconcile(entityId);
    if (!ev || ev.seq <= seenSeq) return;
    seenSeq = ev.seq;
    const o = ev.optimistic as Partial<LightValue & MediaValue>;
    const s = ev.server as LightValue & MediaValue;
    if (o.on !== undefined && o.on !== s.on) toggleWobble++;
    if (o.playing !== undefined && o.playing !== s.playing) toggleWobble++;
  });

  // Symbol-Picker: vollständiger Tabler-Outline-Katalog (B-22).
  let pickerOpen = $state(false);
  let IconPickerComponent = $state<any>(null);
  async function togglePicker() {
    if (pickerOpen) { pickerOpen = false; return; }
    IconPickerComponent ??= (await import('./IconPicker.svelte')).default;
    pickerOpen = true;
  }
  const currentIcon = $derived(device?.icon ?? defaultIconFor(category));
  const seedIconRaw = $derived(
    ROOM_SEED.find((r) => r.id === roomId)?.lights.find((l) => l.id === deviceId)?.icon,
  );
  function setIcon(id: string) {
    if (device) {
      device.icon = id; // mutiert das reaktive appState-Objekt
      persistLightIconOverride(entityId, id);
      void import('../state/icon-recents.ts').then(({ rememberRecentIcon }) => rememberRecentIcon(id));
    }
    pickerOpen = false;
  }
  function resetIcon() {
    if (device) {
      resetLightIconOverride(entityId);
      device.icon = iconForDevice(entityId, category, seedIconRaw);
    }
    pickerOpen = false;
  }
  // Beim Geräte-Wechsel schließen (der Picker gehört zum einzelnen Gerät).
  $effect(() => { void deviceDetail.deviceId; pickerOpen = false; editingName = false; });

  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (deviceDetail.mode !== 'closing') return;
    pickerOpen = false;
    const t = setTimeout(finishDeviceDetailClose, 250);
    return () => clearTimeout(t);
  });

  // Initial-Fokus beim Öffnen (A11y): einmal auf das Panel.
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (deviceDetail.mode === 'open' && panelEl) panelEl.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && pickerOpen) { pickerOpen = false; return; }
    if (e.key === 'Escape' && deviceDetail.mode === 'open') closeDeviceDetail();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="light-detail" class:is-open={deviceDetail.mode === 'open'}
     class:is-closing={deviceDetail.mode === 'closing'} hidden={deviceDetail.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closeDeviceDetail()}></div>
  <div class="light-detail-panel overlay-panel" role="dialog" aria-modal="true"
       aria-label={device?.name ?? m.dev_device()} tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (deviceDetail.mode === 'closing' && e.target === e.currentTarget) finishDeviceDetailClose(); }}>
    {#if device}
      {#key deviceId}
        <header class="ld-header">
          <!-- Piktogramm: Tap öffnet die Symbol-Auswahl (nicht der Schalter) -->
          <button class="ld-symbol pressable" class:is-on={isActive} type="button"
                  aria-haspopup="true" aria-expanded={pickerOpen}
                  aria-label={m.dev_change_icon()} onclick={togglePicker}>
            <Icon name={currentIcon} />
          </button>
          {#if editingName}
            <input class="ld-title ld-title-input" aria-label={m.dev_change_name()} maxlength="80"
                   aria-describedby={nameError ? 'device-name-error' : undefined}
                   bind:this={nameInput} bind:value={nameDraft}
                   onkeydown={onNameKeydown} onblur={() => void saveName()} />
          {:else}
            <button class="ld-title ld-title-button pressable" type="button"
                    aria-label={`${device.name} umbenennen`} onclick={beginNameEdit}>{device.name}</button>
          {/if}
          {#if hasPower}
            <!-- Primäraktion: Schalten bzw. Play/Pause (die Skalen schalten nie aus) -->
            <button class="ld-power pressable" class:is-on={isActive} type="button"
                    aria-pressed={isActive}
                    aria-label={category === 'media' ? `${device.name} Wiedergabe umschalten` : `${device.name} schalten`}
                    use:pulse={{ seq: toggleWobble, cls: 'is-wobble', ms: 200 }}
                    onclick={onPower}>
              <Icon name={category === 'media' ? (media?.playing ? 'i-pause' : 'i-play') : 'i-power'} />
              {#if pending}<span class="pending-dot" aria-hidden="true"></span>{/if}
            </button>
          {/if}
          <button class="ld-close pressable" type="button" aria-label={m.common_close()}
                  onclick={() => closeDeviceDetail()}>×</button>
        </header>
        {#if nameError}<p id="device-name-error" class="ld-name-error" role="alert">{nameError}</p>{/if}

        <div class="ld-body">
          {#if category === 'light'}
            {#if device.dimmable}
              <section class="ld-section ld-brightness">
                <span class="caps-label">{m.dev_brightness()}</span>
                {#key `${deviceId}-${brightnessIntro}`}
                  <TickScale ariaLabel={m.dev_brightness()} orientation="vertical" mode="fill" intro
                             value={briDisplay} min={0} max={100} step={1} keyStep={5}
                             onInput={onBrightness} format={(v) => `${Math.round(v)}%`} />
                {/key}
              </section>
            {/if}

            {#if device.colorTemp}
              <section class="ld-section">
                <span class="caps-label">{m.dev_color_temp()}</span>
                <TickScale ariaLabel={m.dev_color_temp()} orientation="horizontal" mode="gradient"
                           value={tempDisplay} min={tempRange.min} max={tempRange.max}
                           step={50} keyStep={100} tint={tempTint}
                           onInput={onTemp} format={(v) => `${Math.round(v)} K`} />
                <div class="ld-scale-ends"><span>{m.dev_warm()}</span><span>{m.dev_cool()}</span></div>
              </section>
            {/if}

            {#if device.color}
              <section class="ld-section">
                <span class="caps-label">{m.dev_color()}</span>
                <div class="swatch-grid" role="radiogroup" aria-label={m.dev_color()}>
                  {#each LIGHT_COLOR_SWATCHES as swatch (swatch.hex)}
                    <button class="swatch pressable" type="button" role="radio"
                            aria-checked={light?.color === swatch.hex} aria-label={swatch.name}
                            style="--sw:{swatch.hex}" onclick={() => setColor(roomId, deviceId, swatch.hex)}>
                      <span class="swatch-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                  {#if device.colorTemp}
                    <!-- Zurück in den Weiß-/Temperatur-Modus -->
                    <button class="swatch swatch-white pressable" type="button" role="radio"
                            aria-checked={light?.color == null} aria-label={m.dev_white()}
                            onclick={() => setColorTemp(roomId, deviceId, tempDisplay)}>
                      <span class="swatch-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/if}
                </div>
              </section>
            {/if}
          {:else if category === 'switch'}
            <section class="ld-section">
              <span class="caps-label">{m.dev_state()}</span>
              <p class="ld-big-value">{sw ? (sw.on ? m.dev_on() : m.dev_off()) : '—'}</p>
            </section>
          {:else if category === 'temp'}
            <section class="ld-section">
              <span class="caps-label">{m.dev_target_temp()}</span>
              <TickScale ariaLabel={m.dev_target_temp()} orientation="horizontal" mode="gradient"
                         value={targetDisplay} min={16} max={26} step={0.5} keyStep={1}
                         tint={climateTint}
                         onInput={onTarget} format={(v) => `${fmtTemp(v)} °C`} />
              <div class="ld-scale-ends"><span>16°</span><span>26°</span></div>
            </section>
            <section class="ld-section">
              <span class="caps-label">{m.dev_mode()}</span>
              <div class="mode-pill" role="radiogroup" aria-label={m.dev_mode()}>
                {#each HVAC_MODES as m (m.id)}
                  <button class="mode-seg pressable" type="button" role="radio" data-mode={m.id}
                          aria-label={m.label} aria-checked={climate?.hvac === m.id}
                          class:is-active={climate?.hvac === m.id}
                          onclick={() => setClimateHvac(entityId, m.id)}>
                    <Icon name={m.icon} cls="icon icon-md" />
                  </button>
                {/each}
              </div>
            </section>
          {:else if category === 'info'}
            <section class="ld-section">
              <span class="caps-label">{device.domain === 'binary_sensor' ? m.dev_state() : m.dev_reading()}</span>
              {#if device.domain === 'binary_sensor'}
                <p class="ld-big-value">{sw ? binaryLabel(device.deviceClass, sw.on) : '—'}</p>
              {:else}
                <p class="ld-big-value num">{fmtSensor(sensor?.value, sensor?.unit ?? device.unit)}</p>
              {/if}
              <p class="ld-meta">{device.entityId}</p>
            </section>
          {:else if category === 'media'}
            <section class="ld-section">
              <span class="caps-label">{m.dev_playback()}</span>
              <p class="ld-big-value">{media?.track ?? (media?.playing ? m.dev_playing() : m.dev_paused())}</p>
              {#if media?.artist}<p class="ld-meta">{media.artist}</p>{/if}
            </section>
            <section class="ld-section">
              <span class="caps-label">{m.dev_volume()}</span>
              <TickScale ariaLabel={m.dev_volume()} orientation="horizontal" mode="fill"
                         value={volDisplay} min={0} max={100} step={1} keyStep={5}
                         onInput={onVolume} format={(v) => `${Math.round(v)}%`} />
            </section>
          {/if}
        </div>
      {/key}
    {/if}
  </div>
</div>

<!-- Bewusst außerhalb von .light-detail-panel: Ein position:fixed-Kind innerhalb
     des animierten/transformierten Panels würde an dessen Containing Block und
     Overflow gebunden. Der Picker ist ein eigenes viewportweites Modal. -->
{#if pickerOpen && IconPickerComponent}
  <IconPickerComponent {currentIcon} onSelect={setIcon} onReset={resetIcon} onClose={() => (pickerOpen = false)} />
{/if}
