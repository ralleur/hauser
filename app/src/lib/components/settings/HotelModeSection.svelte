<script lang="ts">
  /* ── Einstellungen · Hotel Mode (Betrieb und Aufenthalte) ──
     Alles, was ein Ferienapartment betreibt, ohne JSON zu bearbeiten:
     Aktivierung, PIN, Kalender, Checkout, manueller Aufenthalt und die
     Kioskcheckliste. Die Geräte-Allowlist folgt in einer eigenen Sektion.

     Gespeichert wird über den vorhandenen ETag-/atomaren Household-Pfad; ein
     Entwurf, den der v4-Parser ablehnt, wird gar nicht erst gesendet. */
  import { onMount } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import {
    clearHotelOverride,
    hotelSettings,
    inspectHotelActivation,
    loadHotelSettings,
    loadHotelStay,
    resetHotelCheckout,
    saveHotelMode,
    setHotelOverride,
    setHotelPin,
  } from '../../state/hotel-settings.svelte.ts';
  import {
    draftFromHotelMode,
    draftToHotelMode,
    hotelActivationBlockers,
    validateHotelModeDraft,
    type HotelActivationBlocker,
    type HotelModeDraft,
    type HotelModeDraftField,
  } from './hotel-mode-settings.ts';
  import { HOTEL_PIN_MIN_LENGTH, pinReadyToSubmit } from '../../hotel-mode-ui.ts';
  import { hotelSession, refreshHotelSession } from '../../state/hotel-session.svelte.ts';

  let draft = $state<HotelModeDraft>(draftFromHotelMode(undefined));
  let newPin = $state('');
  let currentPin = $state('');
  let overrideDays = $state(1);
  let saved = $state(false);

  const emptyAccess = { rooms: [], scenes: [], scripts: [] };
  const guestAccess = $derived(hotelSettings.hotelMode?.guestAccess ?? emptyAccess);
  const issues = $derived(validateHotelModeDraft(draft));
  const pinConfigured = $derived(hotelSession.configured);
  const checkoutMarker = $derived(
    (hotelSettings.stay?.checkout ?? null) as Record<string, unknown> | null,
  );
  const checkoutNotice = $derived.by(() => {
    const notice = checkoutMarker?.notice as Record<string, unknown> | undefined;
    if (!notice) return null;
    return [notice.event, notice.scene].filter((code) => typeof code === 'string').join(', ') || null;
  });
  const blockers = $derived(hotelActivationBlockers(draft, {
    pinConfigured,
    guestAccess,
    preflightReady: hotelSettings.activation?.ok === true,
  }));

  onMount(() => {
    void loadHotelSettings().then(() => {
      draft = draftFromHotelMode(hotelSettings.hotelMode ?? undefined);
      return Promise.all([loadHotelStay(), refreshHotelSession()]);
    });
  });

  function issueFor(field: HotelModeDraftField): boolean {
    return issues.some((issue) => issue.field === field);
  }

  function checkLabel(id: string): string {
    switch (id) {
      case 'kiosk': return m.settings_hotel_check_kiosk();
      case 'pin': return m.settings_hotel_check_pin();
      case 'policy': return m.settings_hotel_check_policy();
      case 'proxy': return m.settings_hotel_check_proxy();
      case 'calendar': return m.settings_hotel_check_calendar();
      default: return id;
    }
  }

  function blockerText(blocker: HotelActivationBlocker): string {
    switch (blocker) {
      case 'DRAFT_INVALID': return m.settings_hotel_blocker_draft();
      case 'PIN_MISSING': return m.settings_hotel_blocker_pin();
      case 'KIOSK_UNCONFIRMED': return m.settings_hotel_blocker_kiosk();
      case 'NO_GUEST_ACCESS': return m.settings_hotel_blocker_access();
      case 'PREFLIGHT_PENDING': return m.settings_hotel_blocker_preflight();
    }
  }

  async function save(): Promise<void> {
    if (issues.length > 0) return;
    saved = await saveHotelMode(draftToHotelMode(draft, guestAccess));
    if (saved) draft = draftFromHotelMode(hotelSettings.hotelMode ?? undefined);
  }

  async function submitPin(): Promise<void> {
    if (!pinReadyToSubmit(newPin)) return;
    if (await setHotelPin(newPin, currentPin === '' ? null : currentPin)) {
      newPin = '';
      currentPin = '';
    }
  }

  async function submitOverride(): Promise<void> {
    const days = Math.min(Math.max(Math.round(overrideDays), 1), 14);
    await setHotelOverride(null, Date.now() + days * 24 * 60 * 60 * 1000);
  }
</script>

<section data-setting-id="hotel-mode" aria-labelledby="settings-hotel-title">
  <div class="settings-group">
    <SettingsCardHead icon="i-bed" tint="cool"
                      title={m.settings_hotel_title()} sub={m.settings_hotel_intro()} />
  </div>
  <span id="settings-hotel-title" hidden>{m.settings_hotel_title()}</span>

  {#if hotelSettings.error}
    <p class="settings-form-msg is-error" role="alert">{hotelSettings.error}</p>
  {/if}

  <!-- ── Betrieb ── -->
  <div class="settings-group" data-setting-id="hotel-activation">
    <SettingsCardHead icon="i-power" tint="warm" title={m.settings_hotel_activation()} />
    <div class="settings-row">
      <div class="settings-row-text">
        <span class="settings-row-label">{m.settings_hotel_enabled()}</span>
        <span class="settings-row-sub">{m.settings_hotel_enabled_hint()}</span>
      </div>
      <button class="settings-switch pressable" type="button" role="switch"
              aria-checked={draft.enabled} aria-label={m.settings_hotel_enabled()}
              disabled={blockers.length > 0 && !draft.enabled}
              onclick={() => { draft.enabled = !draft.enabled; }}>
        <span class="settings-switch-knob"></span>
      </button>
    </div>
    {#if blockers.length > 0}
      <ul class="hotel-blockers" data-testid="hotel-activation-blockers">
        {#each blockers as blocker (blocker)}
          <li>{blockerText(blocker)}</li>
        {/each}
      </ul>
    {/if}

    <!-- Der Aktivierungscheck ruft Gerätepfad und Kalender wirklich ab. -->
    <div class="hotel-save">
      <button class="secondary-btn pressable" type="button" disabled={hotelSettings.busy}
              onclick={inspectHotelActivation}>{m.settings_hotel_preflight_run()}</button>
    </div>
    {#if hotelSettings.activation}
      <ul class="hotel-blockers" data-testid="hotel-activation-checks">
        {#each hotelSettings.activation.checks as check (check.id)}
          <li>{check.ok ? '✓' : '✗'} {checkLabel(check.id)}{#if check.code} — {check.code}{/if}</li>
        {/each}
      </ul>
    {/if}

    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_kiosk()}</span>
      <span class="settings-row-sub">{m.settings_hotel_kiosk_hint()}</span>
      <input type="checkbox" bind:checked={draft.kioskAcknowledged} />
    </label>
  </div>

  <!-- ── Admin-PIN ── -->
  <div class="settings-group" data-setting-id="hotel-pin">
    <SettingsCardHead icon="i-lock" tint="neutral"
                      title={m.settings_hotel_pin()} sub={m.settings_hotel_pin_hint()} />
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_pin_current()}</span>
      <input class="settings-input num" type="password" inputmode="numeric" autocomplete="off"
             bind:value={currentPin} />
    </label>
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_pin_new()}</span>
      <input class="settings-input num" type="password" inputmode="numeric" autocomplete="off"
             minlength={HOTEL_PIN_MIN_LENGTH} bind:value={newPin} />
    </label>
    <button class="secondary-btn pressable" type="button"
            disabled={!pinReadyToSubmit(newPin) || hotelSettings.busy}
            onclick={submitPin}>{m.settings_hotel_pin_save()}</button>
  </div>

  <!-- ── Kalender und Aufenthaltszeiten ── -->
  <div class="settings-group" data-setting-id="hotel-calendar">
    <SettingsCardHead icon="i-calendar" tint="cool"
                      title={m.settings_hotel_calendar()} sub={m.settings_hotel_calendar_hint()} />
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_calendar_entity()}</span>
      <input class="settings-input num" class:is-invalid={issueFor('calendarEntityId')}
             placeholder="calendar.apartment_stays" autocomplete="off" spellcheck="false"
             bind:value={draft.calendarEntityId} />
    </label>
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_timezone()}</span>
      <input class="settings-input num" class:is-invalid={issueFor('timeZone')}
             placeholder="Europe/Berlin" autocomplete="off" spellcheck="false"
             bind:value={draft.timeZone} />
    </label>
    <div class="hotel-grid">
      <label class="hotel-field">
        <span class="settings-row-label">{m.settings_hotel_checkin()}</span>
        <input class="settings-input num" type="time" class:is-invalid={issueFor('allDayCheckIn')}
               bind:value={draft.allDayCheckIn} />
      </label>
      <label class="hotel-field">
        <span class="settings-row-label">{m.settings_hotel_checkout_time()}</span>
        <input class="settings-input num" type="time" class:is-invalid={issueFor('allDayCheckOut')}
               bind:value={draft.allDayCheckOut} />
      </label>
    </div>
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_welcome()}</span>
      <span class="settings-row-sub">{m.settings_hotel_welcome_hint()}</span>
      <input type="checkbox" bind:checked={draft.useDescriptionAsWelcome} />
    </label>
  </div>

  <!-- ── Checkout ── -->
  <div class="settings-group" data-setting-id="hotel-checkout">
    <SettingsCardHead icon="i-exit-run" tint="warm"
                      title={m.settings_hotel_checkout()} sub={m.settings_hotel_checkout_hint()} />
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_checkout_enabled()}</span>
      <input type="checkbox" bind:checked={draft.checkoutEnabled} />
    </label>
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_checkout_scene()}</span>
      <span class="settings-row-sub">{m.settings_hotel_checkout_scene_hint()}</span>
      <input class="settings-input num" class:is-invalid={issueFor('checkoutSceneEntityId')}
             placeholder="scene.apartment_after_checkout" autocomplete="off" spellcheck="false"
             bind:value={draft.checkoutSceneEntityId} />
    </label>
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_idle()}</span>
      <input class="settings-input num" type="number" min="1" max="120" step="1"
             class:is-invalid={issueFor('adminIdleTimeoutMinutes')}
             bind:value={draft.adminIdleTimeoutMinutes} />
    </label>
  </div>

  <footer class="hotel-save">
    <button class="primary-btn pressable" type="button"
            disabled={issues.length > 0 || hotelSettings.busy || !hotelSettings.loaded}
            onclick={save}>{m.settings_hotel_save()}</button>
    {#if saved}<span class="settings-form-msg" role="status">{m.settings_hotel_saved()}</span>{/if}
  </footer>

  <!-- ── Manueller Aufenthalt ── -->
  <div class="settings-group" data-setting-id="hotel-override">
    <SettingsCardHead icon="i-account-clock" tint="neutral"
                      title={m.settings_hotel_override()} sub={m.settings_hotel_override_hint()} />
    <label class="hotel-field">
      <span class="settings-row-label">{m.settings_hotel_override_days()}</span>
      <input class="settings-input num" type="number" min="1" max="14" step="1" bind:value={overrideDays} />
    </label>
    <div class="hotel-save">
      <button class="secondary-btn pressable" type="button" disabled={hotelSettings.busy}
              onclick={submitOverride}>{m.settings_hotel_override_start()}</button>
      <button class="secondary-btn pressable" type="button" disabled={hotelSettings.busy}
              onclick={clearHotelOverride}>{m.settings_hotel_override_clear()}</button>
    </div>
    {#if hotelSettings.stay}
      <p class="settings-form-msg" data-testid="hotel-stay-status">
        {m.settings_hotel_stay_status()}: {String(hotelSettings.stay.status ?? '—')}
      </p>
    {/if}
  </div>

  <!-- ── Checkout-Markierung ── -->
  <div class="settings-group" data-setting-id="hotel-checkout-marker">
    <SettingsCardHead icon="i-exit-run" tint="neutral"
                      title={m.settings_hotel_checkout_marker()} sub={m.settings_hotel_checkout_marker_hint()} />
    {#if checkoutMarker}
      <p class="settings-form-msg" data-testid="hotel-checkout-marker">
        {new Date(Number(checkoutMarker.checkedOutAt ?? 0)).toLocaleString()}
      </p>
      {#if checkoutNotice}
        <!-- Ereignis- und Szenenfehler sieht ausdrücklich nur der Admin. -->
        <p class="settings-form-msg is-error" role="alert" data-testid="hotel-checkout-notice">
          {m.settings_hotel_checkout_notice()}: {checkoutNotice}
        </p>
      {/if}
      <div class="hotel-save">
        <button class="secondary-btn pressable" type="button" disabled={hotelSettings.busy}
                onclick={resetHotelCheckout}>{m.settings_hotel_checkout_reset()}</button>
      </div>
    {:else}
      <p class="settings-form-msg">{m.settings_hotel_checkout_marker_none()}</p>
    {/if}
  </div>

</section>

<style>
  .hotel-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
  }

  .hotel-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .hotel-blockers {
    margin: 0;
    padding: var(--space-2) var(--space-4) var(--space-3) var(--space-7);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .hotel-save {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .is-invalid {
    border-color: var(--color-error);
  }
</style>
