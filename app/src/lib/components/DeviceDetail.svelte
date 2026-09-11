<script lang="ts">
  /* Geräte-Detail (zweite Ebene, docs/07): EIN Modal für alle Overlay-Kategorien,
     per Long-Press (bzw. Tap bei nicht-schaltbaren Kacheln) geöffnet. Die Shell
     (Scrim, Panel, Header mit Symbol-Picker, Zustandsmaschine) ist das bisherige
     LightDetail-Muster; der Body verzweigt nach Kategorie:
     light = Helligkeit/Farbtemp/Farbe · switch = Ein/Aus · fan = Stufe/Modus/
     Oszillation/Richtung · temp = Solltemp+Modus · info = read-only Wert/Zustand ·
     media = Play/Pause + Lautstärke (Stufe 1). */
  import Icon from './Icon.svelte';

  import TickScale from './TickScale.svelte';
  import { appState, COLOR_TEMP_MIN, COLOR_TEMP_MAX, HVAC_MODES, HVAC_MODES_ALL, ROOM_SEED, type Light } from '../state/app.svelte.ts';
  import {
    mergedDevice, devicePending, deviceUnconfirmed, deviceReconcile,
    toggleDevice, setBrightness, setColorTemp, setColor,
    setClimateTarget, setClimateHvac, setClimateFanMode, setClimatePreset, setClimateSwing,
    toggleMediaEntity, setMediaVolume,
    setFanPercentage, setFanPreset, setFanOscillating, setFanDirection,
    coverCommand, setCoverPosition, setCoverTilt, vacuumCommand, setVacuumFanSpeed, lockCommand,
    setHumidifierTarget, setHumidifierMode, setWaterHeaterTarget, setWaterHeaterMode, setWaterHeaterOn,
    mowerCommand, alarmCommand, setNumberValue, selectOption, pressButton, type AlarmAction,
  } from '../state/commands.ts';
  import { deviceDetail, closeDeviceDetail, finishDeviceDetailClose } from '../state/overlay.svelte.ts';
  import { pulse } from '../actions/pulse.ts';
  import { LIGHT_COLOR_SWATCHES, tempTint, climateTint, lightLevel } from '../state/light-presets.ts';
  import { fanPresetIcon, fanPresetLabel, fanSpinDuration } from '../state/fan-presets.ts';
  import { alarmStateLabel, coverStateLabel, lockStateLabel, modeIcon, mowerStateLabel, vacuumStateLabel } from '../state/device-labels.ts';
  import { intlLocale } from '../state/locale.svelte.ts';
  import { defaultIconFor, iconForDevice, persistLightIconOverride, resetLightIconOverride } from '../state/light-icons.ts';

  import { binaryLabel, fmtSensor } from '../state/info-display.ts';
  import { renameDevice, setDeviceShowName } from '../state/device-manager.svelte.ts';
  import { fmtTemp } from '../format.ts';
  import type {
    LightValue, SwitchValue, ClimateValue, SensorValue, MediaValue, FanValue, CoverValue, VacuumValue, LockValue,
    HumidifierValue, WaterHeaterValue, MowerValue, AlarmValue, NumberValue, SelectValue, ButtonValue,
  } from '../adapter/types.ts';

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
  const fan = $derived(category === 'fan' ? (cur as FanValue | undefined) : undefined);
  /* R28: die übrigen steuerbaren Domänen, je eine gemergte Sicht. */
  const cover = $derived(category === 'cover' || category === 'valve' ? (cur as CoverValue | undefined) : undefined);
  const coverDomain = $derived<'cover' | 'valve'>(category === 'valve' ? 'valve' : 'cover');
  const vacuum = $derived(category === 'vacuum' ? (cur as VacuumValue | undefined) : undefined);
  const lock = $derived(category === 'lock' ? (cur as LockValue | undefined) : undefined);
  const humidifier = $derived(category === 'humidifier' ? (cur as HumidifierValue | undefined) : undefined);
  const heater = $derived(category === 'water_heater' ? (cur as WaterHeaterValue | undefined) : undefined);
  const mower = $derived(category === 'mower' ? (cur as MowerValue | undefined) : undefined);
  const alarm = $derived(category === 'alarm' ? (cur as AlarmValue | undefined) : undefined);
  const numberValue = $derived(category === 'number' ? (cur as NumberValue | undefined) : undefined);
  const select = $derived(category === 'select' ? (cur as SelectValue | undefined) : undefined);
  const button = $derived(category === 'button' ? (cur as ButtonValue | undefined) : undefined);
  const numberDomain = $derived<'number' | 'input_number'>(device?.domain === 'input_number' ? 'input_number' : 'number');
  const selectDomain = $derived<'select' | 'input_select'>(device?.domain === 'input_select' ? 'input_select' : 'select');
  const buttonDomain = $derived<'button' | 'input_button'>(device?.domain === 'input_button' ? 'input_button' : 'button');
  /* Klima: Modi und Grenzen kommen vom Thermostat; ohne Meldung die Grundmodi
     und 16–26 °C wie bisher. */
  const hvacModes = $derived.by(() => {
    const reported = climate?.hvacModes;
    return reported?.length ? HVAC_MODES_ALL.filter((mode) => reported.includes(mode.id)) : HVAC_MODES;
  });
  const climateRange = $derived({ min: climate?.minTemp ?? 16, max: climate?.maxTemp ?? 26 });
  /* Alarm: der Code wird nur abgefragt, wenn das Gerät einen verlangt. */
  let alarmCode = $state('');
  const alarmActions = $derived.by((): Array<{ id: AlarmAction; label: string; icon: string; state: string }> => {
    if (!alarm) return [];
    const list: Array<{ id: AlarmAction; label: string; icon: string; state: string }> = [
      { id: 'disarm', label: m.dev_disarm(), icon: 'i-shield-off', state: 'disarmed' },
    ];
    if (alarm.supportsArmHome) list.push({ id: 'arm_home', label: m.dev_arm_home(), icon: 'i-shield-home', state: 'armed_home' });
    if (alarm.supportsArmAway) list.push({ id: 'arm_away', label: m.dev_arm_away(), icon: 'i-shield-lock', state: 'armed_away' });
    if (alarm.supportsArmNight) list.push({ id: 'arm_night', label: m.dev_arm_night(), icon: 'i-weather-night', state: 'armed_night' });
    if (alarm.supportsArmVacation) list.push({ id: 'arm_vacation', label: m.dev_arm_vacation(), icon: 'i-palm-tree', state: 'armed_vacation' });
    if (alarm.supportsArmCustom) list.push({ id: 'arm_custom_bypass', label: m.dev_arm_custom(), icon: 'i-shield-half-full', state: 'armed_custom_bypass' });
    return list;
  });
  function onAlarm(action: AlarmAction) {
    const needsCode = alarm?.codeFormat !== null && (action === 'disarm' || alarm?.codeArmRequired);
    alarmCommand(entityId, action, needsCode ? alarmCode || null : null);
    alarmCode = '';
  }
  const pressedAtLabel = $derived(
    button?.pressedAt ? new Date(button.pressedAt).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' }) : null,
  );
  function fmtUnit(value: number, unit: string | null | undefined, digits = 1): string {
    const num = value.toLocaleString(intlLocale(), { maximumFractionDigits: digits });
    return unit ? `${num} ${unit}` : num;
  }
  /* null = kein Messwert; dann bleibt die Zeile weg (R3, docs/23). */
  const reading = $derived(fmtSensor(sensor?.value, sensor?.unit ?? device?.unit));
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
    if (fan) return fan.on;
    if (sw) return sw.on;
    if (climate) return climate.hvac !== 'off';
    if (media) return media.playing;
    if (cover) return cover.on;
    if (vacuum) return vacuum.on;
    if (lock) return lock.locked;
    if (humidifier) return humidifier.on;
    if (heater) return heater.on;
    if (mower) return mower.on;
    if (alarm) return alarm.state !== 'disarmed';
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
  let dragFanSpeed = $state<number | null>(null);
  let dragPosition = $state<number | null>(null);
  let dragTilt = $state<number | null>(null);
  let dragHumidity = $state<number | null>(null);
  let dragHeater = $state<number | null>(null);
  let dragNumber = $state<number | null>(null);
  const positionDisplay = $derived(dragPosition ?? cover?.position ?? 0);
  const tiltDisplay = $derived(dragTilt ?? cover?.tilt ?? 0);
  const humidityDisplay = $derived(dragHumidity ?? humidifier?.target ?? 50);
  const heaterDisplay = $derived(dragHeater ?? heater?.target ?? 50);
  const numberDisplay = $derived(dragNumber ?? numberValue?.value ?? numberValue?.min ?? 0);
  function onPosition(val: number, final: boolean) {
    dragPosition = final ? null : val;
    if (final) setCoverPosition(entityId, coverDomain, val);
  }
  function onTilt(val: number, final: boolean) {
    dragTilt = final ? null : val;
    if (final) setCoverTilt(entityId, val);
  }
  function onHumidity(val: number, final: boolean) {
    dragHumidity = final ? null : val;
    if (final) setHumidifierTarget(entityId, val);
  }
  function onHeater(val: number, final: boolean) {
    dragHeater = final ? null : val;
    if (final) setWaterHeaterTarget(entityId, val);
  }
  function onNumber(val: number, final: boolean) {
    dragNumber = final ? null : val;
    if (final) setNumberValue(entityId, numberDomain, val);
  }
  let brightnessIntro = $state(0);
  let previousDetailMode = deviceDetail.mode;
  const briDisplay = $derived(dragBri ?? (light?.on ? light.brightness : 0));
  const tempDisplay = $derived(
    Math.min(tempRange.max, Math.max(tempRange.min, dragTemp ?? light?.colorTemp ?? 2700)),
  );
  const targetDisplay = $derived(dragTarget ?? climate?.target ?? 20);
  const volDisplay = $derived(dragVol ?? media?.volume ?? 0);
  // Aus = 0 %, damit die Leiter denselben Zusammenhang zeigt wie die Helligkeit.
  const fanSpeedDisplay = $derived(dragFanSpeed ?? (fan?.on ? fan.percentage : 0));
  // Läuft der Ventilator, dreht sich sein Piktogramm im Tempo der Stufe.
  const fanSpin = $derived(fanSpinDuration(fan));
  // Dimmbare Lampe: die Helligkeit färbt das Piktogramm (wie auf der Kachel).
  const lightIconLevel = $derived(lightLevel(briDisplay, !!light?.on, !!device?.dimmable));

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
  function onFanSpeed(val: number, final: boolean) {
    dragFanSpeed = final ? null : val;
    if (final) setFanPercentage(entityId, val);
  }

  // Primäraktion im Header: light/switch = Schalten, media = Play/Pause.
  const hasPower = $derived(
    category === 'light' || category === 'switch' || category === 'fan' || category === 'media'
    || category === 'humidifier' || (category === 'water_heater' && !!heater?.supportsOnOff),
  );
  function onPower() {
    if (!device) return;
    if (category === 'media') toggleMediaEntity(entityId);
    else if (category === 'water_heater') setWaterHeaterOn(entityId, !heater?.on);
    else toggleDevice(roomId, device);
  }

  /* Konfidenz (Paket 6): eine Sekunde ohne State-Echo → ein einzelner Puls. */
  let echoWobble = $state(0);
  let wasUnconfirmed = false;
  $effect(() => {
    const unconfirmed = !!device && deviceUnconfirmed(entityId);
    if (unconfirmed && !wasUnconfirmed) echoWobble++;
    wasUnconfirmed = unconfirmed;
  });

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
          <button class="ld-symbol pressable" class:is-on={isActive}
                  class:is-spinning={fanSpin !== null}
                  style={fanSpin !== null
                    ? `--fan-spin:${fanSpin}`
                    : lightIconLevel !== null ? `--light-level:${lightIconLevel}` : undefined} type="button"
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
                    use:pulse={{ seq: toggleWobble + echoWobble, cls: 'is-wobble', ms: 200 }}
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
            <!-- Ohne bekannten Zustand keine Zeile mit Strich (R3, docs/23). -->
            {#if sw}
              <section class="ld-section">
                <span class="caps-label">{m.dev_state()}</span>
                <p class="ld-big-value">{sw.on ? m.dev_on() : m.dev_off()}</p>
              </section>
            {/if}
          {:else if category === 'fan'}
            {#if fan?.supportsSpeed}
              <section class="ld-section ld-brightness">
                <span class="caps-label">{m.dev_fan_speed()}</span>
                {#key `${deviceId}-${brightnessIntro}`}
                  <TickScale ariaLabel={m.dev_fan_speed()} orientation="vertical" mode="fill" intro
                             value={fanSpeedDisplay} min={0} max={100} step={1} keyStep={5}
                             onInput={onFanSpeed} format={(v) => `${Math.round(v)}%`} />
                {/key}
              </section>
            {/if}

            {#if fan?.supportsPreset && fan.presetModes.length}
              <section class="ld-section">
                <span class="caps-label">{m.dev_mode()}</span>
                <div class="choice-grid" role="radiogroup" aria-label={m.dev_mode()}>
                  {#each fan.presetModes as preset (preset)}
                    <button class="choice-card pressable" type="button" role="radio"
                            aria-checked={fan.presetMode === preset}
                            onclick={() => setFanPreset(entityId, preset)}>
                      <Icon name={fanPresetIcon(preset)} cls="icon icon-md" />
                      <span class="choice-label">{fanPresetLabel(preset)}</span>
                      <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}

            {#if fan?.supportsOscillate}
              <section class="ld-section">
                <span class="caps-label">{m.dev_oscillation()}</span>
                <div class="choice-pill" role="radiogroup" aria-label={m.dev_oscillation()}>
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={fan.oscillating} aria-label={m.dev_on()}
                          onclick={() => setFanOscillating(entityId, true)}>
                    <Icon name="i-arrow-oscillating" cls="icon icon-md" />
                    <span>{m.dev_on_short()}</span>
                  </button>
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={!fan.oscillating} aria-label={m.dev_off()}
                          onclick={() => setFanOscillating(entityId, false)}>
                    <Icon name="i-arrow-oscillating-off" cls="icon icon-md" />
                    <span>{m.dev_off_short()}</span>
                  </button>
                </div>
              </section>
            {/if}

            {#if fan?.supportsDirection}
              <section class="ld-section">
                <span class="caps-label">{m.dev_fan_direction()}</span>
                <div class="choice-pill" role="radiogroup" aria-label={m.dev_fan_direction()}>
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={fan.direction === 'forward'}
                          onclick={() => setFanDirection(entityId, 'forward')}>
                    <Icon name="i-rotate-right" cls="icon icon-md" />
                    <span>{m.dev_fan_forward()}</span>
                  </button>
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={fan.direction === 'reverse'}
                          onclick={() => setFanDirection(entityId, 'reverse')}>
                    <Icon name="i-rotate-left" cls="icon icon-md" />
                    <span>{m.dev_fan_reverse()}</span>
                  </button>
                </div>
              </section>
            {/if}
          {:else if category === 'temp'}
            <section class="ld-section">
              <span class="caps-label">{m.dev_target_temp()}</span>
              <TickScale ariaLabel={m.dev_target_temp()} orientation="horizontal" mode="gradient"
                         value={Math.min(climateRange.max, Math.max(climateRange.min, targetDisplay))}
                         min={climateRange.min} max={climateRange.max} step={0.5} keyStep={1}
                         tint={climateTint}
                         onInput={onTarget} format={(v) => `${fmtTemp(v)} °C`} />
              <div class="ld-scale-ends"><span>{fmtTemp(climateRange.min)}°</span><span>{fmtTemp(climateRange.max)}°</span></div>
            </section>
            <section class="ld-section">
              <span class="caps-label">{m.dev_mode()}</span>
              <div class="mode-pill" role="radiogroup" aria-label={m.dev_mode()}>
                {#each hvacModes as mode (mode.id)}
                  <button class="mode-seg pressable" type="button" role="radio" data-mode={mode.id}
                          aria-label={mode.label} aria-checked={climate?.hvac === mode.id}
                          class:is-active={climate?.hvac === mode.id}
                          onclick={() => setClimateHvac(entityId, mode.id)}>
                    <Icon name={mode.icon} cls="icon icon-md" />
                  </button>
                {/each}
              </div>
            </section>
            {#if climate?.fanModes?.length}
              <section class="ld-section">
                <span class="caps-label">{m.dev_fan_mode()}</span>
                <div class="choice-grid" role="radiogroup" aria-label={m.dev_fan_mode()}>
                  {#each climate.fanModes as mode (mode)}
                    <button class="choice-card pressable" type="button" role="radio"
                            aria-checked={climate.fanMode === mode}
                            onclick={() => setClimateFanMode(entityId, mode)}>
                      <Icon name={modeIcon(mode, 'i-fan')} cls="icon icon-md" />
                      <span class="choice-label">{fanPresetLabel(mode)}</span>
                      <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
            {#if climate?.presetModes?.length}
              <section class="ld-section">
                <span class="caps-label">{m.dev_preset()}</span>
                <div class="choice-grid" role="radiogroup" aria-label={m.dev_preset()}>
                  {#each climate.presetModes as mode (mode)}
                    <button class="choice-card pressable" type="button" role="radio"
                            aria-checked={climate.presetMode === mode}
                            onclick={() => setClimatePreset(entityId, mode)}>
                      <Icon name={modeIcon(mode, 'i-thermometer')} cls="icon icon-md" />
                      <span class="choice-label">{fanPresetLabel(mode)}</span>
                      <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
            {#if climate?.swingModes?.length}
              <section class="ld-section">
                <span class="caps-label">{m.dev_swing()}</span>
                <div class="choice-grid" role="radiogroup" aria-label={m.dev_swing()}>
                  {#each climate.swingModes as mode (mode)}
                    <button class="choice-card pressable" type="button" role="radio"
                            aria-checked={climate.swingMode === mode}
                            onclick={() => setClimateSwing(entityId, mode)}>
                      <Icon name={modeIcon(mode, 'i-arrow-oscillating')} cls="icon icon-md" />
                      <span class="choice-label">{fanPresetLabel(mode)}</span>
                      <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
          {:else if category === 'cover' || category === 'valve'}
            {#if cover}
              <section class="ld-section">
                <span class="caps-label">{m.dev_state()}</span>
                <p class="ld-big-value">{coverStateLabel(cover.on, cover.moving)}</p>
              </section>
              <section class="ld-section">
                <div class="action-row" role="group" aria-label={device.name}>
                  {#if cover.supportsOpen}
                    <button class="action-btn pressable" type="button" onclick={() => coverCommand(entityId, coverDomain, 'open')}>
                      <Icon name="i-arrow-up" cls="icon icon-md" /><span>{m.dev_open()}</span>
                    </button>
                  {/if}
                  {#if cover.supportsStop}
                    <button class="action-btn pressable" type="button" onclick={() => coverCommand(entityId, coverDomain, 'stop')}>
                      <Icon name="i-stop" cls="icon icon-md" /><span>{m.dev_stop()}</span>
                    </button>
                  {/if}
                  {#if cover.supportsClose}
                    <button class="action-btn pressable" type="button" onclick={() => coverCommand(entityId, coverDomain, 'close')}>
                      <Icon name="i-arrow-down" cls="icon icon-md" /><span>{m.dev_close()}</span>
                    </button>
                  {/if}
                </div>
              </section>
              {#if cover.supportsPosition}
                <section class="ld-section ld-brightness">
                  <span class="caps-label">{m.dev_position()}</span>
                  {#key `${deviceId}-${brightnessIntro}`}
                    <TickScale ariaLabel={m.dev_position()} orientation="vertical" mode="fill" intro
                               value={positionDisplay} min={0} max={100} step={1} keyStep={5}
                               onInput={onPosition} format={(v) => `${Math.round(v)}%`} />
                  {/key}
                </section>
              {/if}
              {#if cover.supportsTilt}
                <section class="ld-section">
                  <span class="caps-label">{m.dev_tilt()}</span>
                  <TickScale ariaLabel={m.dev_tilt()} orientation="horizontal" mode="fill"
                             value={tiltDisplay} min={0} max={100} step={1} keyStep={5}
                             onInput={onTilt} format={(v) => `${Math.round(v)}%`} />
                </section>
              {/if}
            {/if}
          {:else if category === 'vacuum'}
            {#if vacuum}
              <section class="ld-section">
                <span class="caps-label">{m.dev_state()}</span>
                <p class="ld-big-value">{vacuumStateLabel(vacuum.state)}</p>
                {#if vacuum.battery !== null}<p class="ld-meta num">{m.dev_battery()} {vacuum.battery} %</p>{/if}
              </section>
              <section class="ld-section">
                <div class="action-row" role="group" aria-label={device.name}>
                  {#if vacuum.supportsStart}
                    <button class="action-btn pressable" type="button" onclick={() => vacuumCommand(entityId, 'start')}>
                      <Icon name="i-play" cls="icon icon-md" /><span>{m.dev_start()}</span>
                    </button>
                  {/if}
                  {#if vacuum.supportsPause}
                    <button class="action-btn pressable" type="button" onclick={() => vacuumCommand(entityId, 'pause')}>
                      <Icon name="i-pause" cls="icon icon-md" /><span>{m.dev_pause()}</span>
                    </button>
                  {/if}
                  {#if vacuum.supportsStop}
                    <button class="action-btn pressable" type="button" onclick={() => vacuumCommand(entityId, 'stop')}>
                      <Icon name="i-stop" cls="icon icon-md" /><span>{m.dev_stop()}</span>
                    </button>
                  {/if}
                  {#if vacuum.supportsReturn}
                    <button class="action-btn pressable" type="button" onclick={() => vacuumCommand(entityId, 'return_to_base')}>
                      <Icon name="i-home-import-outline" cls="icon icon-md" /><span>{m.dev_return_home()}</span>
                    </button>
                  {/if}
                  {#if vacuum.supportsLocate}
                    <button class="action-btn pressable" type="button" onclick={() => vacuumCommand(entityId, 'locate')}>
                      <Icon name="i-crosshairs-gps" cls="icon icon-md" /><span>{m.dev_locate()}</span>
                    </button>
                  {/if}
                </div>
              </section>
              {#if vacuum.supportsFanSpeed && vacuum.fanSpeeds.length}
                <section class="ld-section">
                  <span class="caps-label">{m.dev_suction()}</span>
                  <div class="choice-grid" role="radiogroup" aria-label={m.dev_suction()}>
                    {#each vacuum.fanSpeeds as speed (speed)}
                      <button class="choice-card pressable" type="button" role="radio"
                              aria-checked={vacuum.fanSpeed === speed}
                              onclick={() => setVacuumFanSpeed(entityId, speed)}>
                        <Icon name={modeIcon(speed, 'i-fan')} cls="icon icon-md" />
                        <span class="choice-label">{fanPresetLabel(speed)}</span>
                        <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/if}
            {/if}
          {:else if category === 'lock'}
            {#if lock}
              <section class="ld-section">
                <span class="caps-label">{m.dev_state()}</span>
                <p class="ld-big-value">{lockStateLabel(lock.state)}</p>
              </section>
              <section class="ld-section">
                <div class="choice-pill" role="radiogroup" aria-label={m.dev_state()}>
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={lock.locked}
                          onclick={() => lockCommand(entityId, 'lock')}>
                    <Icon name="i-lock" cls="icon icon-md" />
                    <span>{m.dev_lock()}</span>
                  </button>
                  <button class="choice-seg pressable" type="button" role="radio"
                          aria-checked={!lock.locked}
                          onclick={() => lockCommand(entityId, 'unlock')}>
                    <Icon name="i-lock-open-variant" cls="icon icon-md" />
                    <span>{m.dev_unlock()}</span>
                  </button>
                </div>
              </section>
              {#if lock.supportsOpen}
                <section class="ld-section">
                  <div class="action-row" role="group" aria-label={device.name}>
                    <button class="action-btn pressable" type="button" onclick={() => lockCommand(entityId, 'open')}>
                      <Icon name="i-door-open" cls="icon icon-md" /><span>{m.dev_unlatch()}</span>
                    </button>
                  </div>
                </section>
              {/if}
            {/if}
          {:else if category === 'humidifier'}
            {#if humidifier}
              <section class="ld-section ld-brightness">
                <span class="caps-label">{m.dev_target_humidity()}</span>
                {#key `${deviceId}-${brightnessIntro}`}
                  <TickScale ariaLabel={m.dev_target_humidity()} orientation="vertical" mode="fill" intro
                             value={Math.min(humidifier.maxHumidity, Math.max(humidifier.minHumidity, humidityDisplay))}
                             min={humidifier.minHumidity} max={humidifier.maxHumidity} step={1} keyStep={5}
                             onInput={onHumidity} format={(v) => `${Math.round(v)}%`} />
                {/key}
                {#if humidifier.current !== null}<p class="ld-meta num">{m.dev_current_humidity()} {fmtUnit(humidifier.current, '%', 0)}</p>{/if}
              </section>
              {#if humidifier.supportsModes && humidifier.modes.length}
                <section class="ld-section">
                  <span class="caps-label">{m.dev_mode()}</span>
                  <div class="choice-grid" role="radiogroup" aria-label={m.dev_mode()}>
                    {#each humidifier.modes as mode (mode)}
                      <button class="choice-card pressable" type="button" role="radio"
                              aria-checked={humidifier.mode === mode}
                              onclick={() => setHumidifierMode(entityId, mode)}>
                        <Icon name={modeIcon(mode, 'i-air-humidifier')} cls="icon icon-md" />
                        <span class="choice-label">{fanPresetLabel(mode)}</span>
                        <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/if}
            {/if}
          {:else if category === 'water_heater'}
            {#if heater}
              {#if heater.supportsTarget}
                <section class="ld-section">
                  <span class="caps-label">{m.dev_target_temp()}</span>
                  <TickScale ariaLabel={m.dev_target_temp()} orientation="horizontal" mode="gradient"
                             value={Math.min(heater.maxTemp, Math.max(heater.minTemp, heaterDisplay))}
                             min={heater.minTemp} max={heater.maxTemp} step={0.5} keyStep={1}
                             tint={climateTint}
                             onInput={onHeater} format={(v) => `${fmtTemp(v)} °C`} />
                  <div class="ld-scale-ends"><span>{fmtTemp(heater.minTemp)}°</span><span>{fmtTemp(heater.maxTemp)}°</span></div>
                  {#if heater.current !== null}<p class="ld-meta num">{m.climate_current_temperature()} {fmtTemp(heater.current)} °C</p>{/if}
                </section>
              {/if}
              {#if heater.supportsModes && heater.modes.length}
                <section class="ld-section">
                  <span class="caps-label">{m.dev_operation_mode()}</span>
                  <div class="choice-grid" role="radiogroup" aria-label={m.dev_operation_mode()}>
                    {#each heater.modes as mode (mode)}
                      <button class="choice-card pressable" type="button" role="radio"
                              aria-checked={heater.mode === mode}
                              onclick={() => setWaterHeaterMode(entityId, mode)}>
                        <Icon name={modeIcon(mode, 'i-water-boiler')} cls="icon icon-md" />
                        <span class="choice-label">{fanPresetLabel(mode)}</span>
                        <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/if}
            {/if}
          {:else if category === 'mower'}
            {#if mower}
              <section class="ld-section">
                <span class="caps-label">{m.dev_state()}</span>
                <p class="ld-big-value">{mowerStateLabel(mower.state)}</p>
              </section>
              <section class="ld-section">
                <div class="action-row" role="group" aria-label={device.name}>
                  {#if mower.supportsStart}
                    <button class="action-btn pressable" type="button" onclick={() => mowerCommand(entityId, 'start_mowing')}>
                      <Icon name="i-play" cls="icon icon-md" /><span>{m.dev_mow()}</span>
                    </button>
                  {/if}
                  {#if mower.supportsPause}
                    <button class="action-btn pressable" type="button" onclick={() => mowerCommand(entityId, 'pause')}>
                      <Icon name="i-pause" cls="icon icon-md" /><span>{m.dev_pause()}</span>
                    </button>
                  {/if}
                  {#if mower.supportsDock}
                    <button class="action-btn pressable" type="button" onclick={() => mowerCommand(entityId, 'dock')}>
                      <Icon name="i-home-import-outline" cls="icon icon-md" /><span>{m.dev_dock()}</span>
                    </button>
                  {/if}
                </div>
              </section>
            {/if}
          {:else if category === 'alarm'}
            {#if alarm}
              <section class="ld-section">
                <span class="caps-label">{m.dev_state()}</span>
                <p class="ld-big-value">{alarmStateLabel(alarm.state)}</p>
              </section>
              {#if alarm.codeFormat !== null}
                <section class="ld-section">
                  <label class="caps-label" for="alarm-code">{m.dev_alarm_code()}</label>
                  <input id="alarm-code" class="ld-code-input num" type="password" autocomplete="one-time-code"
                         inputmode={alarm.codeFormat === 'number' ? 'numeric' : 'text'}
                         bind:value={alarmCode} />
                </section>
              {/if}
              <section class="ld-section">
                <span class="caps-label">{m.dev_mode()}</span>
                <div class="choice-grid" role="radiogroup" aria-label={m.dev_mode()}>
                  {#each alarmActions as action (action.id)}
                    <button class="choice-card pressable" type="button" role="radio"
                            aria-checked={alarm.state === action.state}
                            onclick={() => onAlarm(action.id)}>
                      <Icon name={action.icon} cls="icon icon-md" />
                      <span class="choice-label">{action.label}</span>
                      <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
          {:else if category === 'number'}
            {#if numberValue}
              <section class="ld-section">
                <span class="caps-label">{m.dev_value()}</span>
                <TickScale ariaLabel={m.dev_value()} orientation="horizontal" mode="fill"
                           value={Math.min(numberValue.max, Math.max(numberValue.min, numberDisplay))}
                           min={numberValue.min} max={numberValue.max} step={numberValue.step} keyStep={numberValue.step}
                           onInput={onNumber} format={(v) => fmtUnit(v, numberValue?.unit, 2)} />
                <div class="ld-scale-ends"><span>{fmtUnit(numberValue.min, numberValue.unit, 2)}</span><span>{fmtUnit(numberValue.max, numberValue.unit, 2)}</span></div>
              </section>
            {/if}
          {:else if category === 'select'}
            {#if select}
              <section class="ld-section">
                <span class="caps-label">{m.dev_option()}</span>
                <div class="choice-grid" role="radiogroup" aria-label={m.dev_option()}>
                  {#each select.options as option (option)}
                    <button class="choice-card pressable" type="button" role="radio"
                            aria-checked={select.option === option}
                            onclick={() => selectOption(entityId, selectDomain, option)}>
                      <span class="choice-label">{option}</span>
                      <span class="choice-check" aria-hidden="true"><Icon name="i-check" /></span>
                    </button>
                  {/each}
                </div>
              </section>
            {/if}
          {:else if category === 'button'}
            <section class="ld-section">
              <div class="action-row" role="group" aria-label={device.name}>
                <button class="action-btn pressable" type="button" onclick={() => pressButton(entityId, buttonDomain)}>
                  <Icon name="i-gesture-tap" cls="icon icon-md" /><span>{m.dev_press()}</span>
                </button>
              </div>
              {#if pressedAtLabel}<p class="ld-meta num">{m.dev_last_pressed()} {pressedAtLabel}</p>{/if}
            </section>
          {:else if category === 'info'}
            <section class="ld-section">
              <!-- Überschrift und Wert nur, wenn es einen Messwert gibt; die
                   Entität nennen wir immer (R3, docs/23). -->
              {#if device.domain === 'binary_sensor'}
                {#if sw}
                  <span class="caps-label">{m.dev_state()}</span>
                  <p class="ld-big-value">{binaryLabel(device.deviceClass, sw.on)}</p>
                {/if}
              {:else if reading !== null}
                <span class="caps-label">{m.dev_reading()}</span>
                <p class="ld-big-value num">{reading}</p>
              {/if}
              <p class="ld-meta">{device.entityId}</p>
            </section>
            <!-- Die Kachel zeigt nur den Wert; wer den Namen braucht, holt ihn
                 hier dazu (Owner-Entscheidung 2026-09-11). -->
            <section class="ld-section ld-switch-row">
              <span id="device-show-name-label">{m.dev_show_name()}</span>
              <button class="re-toggle pressable" type="button" role="switch"
                      aria-checked={!!device.showName} class:is-on={!!device.showName}
                      aria-labelledby="device-show-name-label"
                      onclick={() => setDeviceShowName(entityId, !device.showName)}>
                <span class="re-toggle-knob"></span>
              </button>
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
