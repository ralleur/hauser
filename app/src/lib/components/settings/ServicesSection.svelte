<script lang="ts">
  /* ── Verbindungen · Dienste ──
     Eine Integrationskarte je angebundenem System. Alle Karten folgen
     demselben Aufbau: Status-Punkt, Adresse, Anmeldezustand, Aktionen.

     Vorher lagen diese Angaben über vier Sektionen verstreut (Home Assistant
     in „Verbindungen“ + „Status“, Jellyfin in „Bibliothek“, iCloud in
     „Kalender“); Ablage und Songwerkstatt fehlten ganz. Hier ist die eine
     Stelle, an der die Frage „was hängt dran und läuft es?“ beantwortet wird.
     Was aus einem Dienst *angezeigt* wird, bleibt bewusst in „Inhalte“. */
  import Icon from '../Icon.svelte';
  import { connection } from '../../state/connection.svelte.ts';
  import { authState, requestToken } from '../../state/auth.svelte.ts';
  import { HA_URL, HA_URL_DEFAULT } from '../../adapter/runtime.svelte.ts';
  import { jellyfin, JELLYFIN_URL_DEFAULT } from '../../adapter/jellyfin.ts';
  import { jellyfinLogin, isLoggingIn, libraryError, usingLiveLibrary } from '../../state/library.svelte.ts';
  import { settingsUi, settingsValues, setHaUrl, setJellyfinUrl, icloudSetup, setupICloudCalendar } from '../../state/settings.svelte.ts';
  import { refreshFamilyCalendar } from '../../state/calendar.svelte.ts';
  import { serviceProbes, probeLocalServices } from '../../state/service-probes.svelte.ts';
  import { confirmThen, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const conn = $derived(connection());
  const auth = authState();

  /* Die beiden lokalen Dienste einmal beim Öffnen der Sektion prüfen. */
  $effect(() => { void probeLocalServices(); });

  /* ── Jellyfin-Session (localStorage ist nicht reaktiv → Spiegel) ── */
  let jfSession = $state(jellyfin.hasSession());
  let jfUser = $state('');
  let jfPassword = $state('');

  async function onJellyfinLogin(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await jellyfinLogin(jfUser.trim(), jfPassword);
    jfPassword = '';
    jfSession = jellyfin.hasSession();
    if (jfSession) jfUser = '';
  }

  function jellyfinLogout(): void {
    confirmThen('jf-session', () => {
      void jellyfin.logout();
      jfSession = false;
      settingsUi.needsReload = true;
    });
  }

  /* ── iCloud über den HA-Config-Flow ── */
  let icloudUser = $state('');
  let icloudPassword = $state('');

  async function onICloudSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await setupICloudCalendar(icloudUser, icloudPassword);
    icloudPassword = '';
    if (icloudSetup.result?.ok) {
      icloudUser = '';
      void refreshFamilyCalendar();
    }
  }

  const ablageDot = $derived(
    serviceProbes.ablage.state === 'checking' ? 'dot-degraded'
      : serviceProbes.ablage.state === 'ok' && serviceProbes.ablage.configured ? 'dot-online'
      : serviceProbes.ablage.state === 'ok' ? 'dot-degraded'
      : serviceProbes.ablage.state === 'error' ? 'dot-offline'
      : 'dot-degraded',
  );

  const ablageLabel = $derived(
    serviceProbes.ablage.state === 'checking' ? m.sys_service_checking()
      : serviceProbes.ablage.state === 'error' ? m.sys_service_unreachable()
      : !serviceProbes.ablage.configured ? m.sys_service_not_configured()
      : serviceProbes.ablage.unlocked ? m.sys_service_unlocked()
      : m.sys_service_locked(),
  );

  const songsDot = $derived(
    serviceProbes.songs.state === 'ok' ? 'dot-online'
      : serviceProbes.songs.state === 'error' ? 'dot-offline'
      : 'dot-degraded',
  );

  const songsLabel = $derived(
    serviceProbes.songs.state === 'ok' ? m.sys_service_reachable()
      : serviceProbes.songs.state === 'error' ? m.sys_service_unreachable()
      : m.sys_service_checking(),
  );
</script>

<h3 class="caps-label settings-group-label">{m.sys_group_services_ha()}</h3>
<div class="settings-group">
  <div class="settings-row" data-setting-id="connection-status">
    <span class="dot {conn.dot}"></span>
    <div class="settings-row-text">
      <span class="settings-row-label">Home Assistant</span>
      <span class="settings-row-sub">{settingsValues.demoMode ? m.sys_demo_mode_note() : HA_URL}</span>
    </div>
    <span class="settings-row-value">{conn.label}</span>
  </div>

  <div class="settings-row is-stacked" data-setting-id="ha-url">
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_address()}</span>
      <span class="settings-row-sub">{m.sys_default_hint({ value: HA_URL_DEFAULT })}</span>
    </div>
    <input class="settings-input num" type="url" placeholder={HA_URL_DEFAULT}
           aria-label={m.sys_ha_address()} autocomplete="off" spellcheck="false"
           value={settingsValues.haUrl}
           onchange={(e) => setHaUrl(e.currentTarget.value)} />
  </div>

  <div class="settings-row" data-setting-id="ha-token">
    <span class="settings-row-icon"><Icon name="i-key-variant" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_token()}</span>
      <span class="settings-row-sub">{auth.usingHa ? m.sys_token_reopen() : m.sys_demo_no_function()}</span>
    </div>
    <button class="secondary-btn pressable" type="button" disabled={!auth.usingHa}
            onclick={() => requestToken()}>{m.sys_renew()}</button>
  </div>
</div>

<h3 class="caps-label settings-group-label">{m.sys_group_services_media()}</h3>
<div class="settings-group">
  <div class="settings-row is-stacked" data-setting-id="jf-url">
    <div class="settings-row-text">
      <span class="settings-row-label">Jellyfin-Adresse</span>
      <span class="settings-row-sub">{m.sys_default_hint({ value: JELLYFIN_URL_DEFAULT })}</span>
    </div>
    <input class="settings-input num" type="url" placeholder={JELLYFIN_URL_DEFAULT}
           aria-label="Jellyfin-Adresse" autocomplete="off" spellcheck="false"
           value={settingsValues.jellyfinUrl}
           onchange={(e) => setJellyfinUrl(e.currentTarget.value)} />
  </div>

  {#if jfSession}
    <div class="settings-row" data-setting-id="jf-session">
      <span class="settings-row-icon"><Icon name="i-key-variant" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{m.sys_signed_in()}</span>
        <span class="settings-row-sub">{m.sys_session_hint()}</span>
      </div>
      <button class="secondary-btn danger-btn pressable" type="button" onclick={jellyfinLogout}>
        {isConfirming('jf-session') ? m.sys_signout_confirm() : m.sys_signout()}
      </button>
    </div>
  {:else}
    <form class="settings-row is-stacked" data-setting-id="jf-session" onsubmit={onJellyfinLogin}>
      <div class="settings-row-text">
        <span class="settings-row-label">{m.sys_jellyfin_signin()}</span>
        <span class="settings-row-sub">{usingLiveLibrary ? m.sys_signin_local_hint() : m.sys_library_demo_hint()}</span>
      </div>
      <div class="settings-form-grid">
        <input class="settings-input" type="text" placeholder={m.library_username()}
               aria-label="Jellyfin-Benutzername" autocomplete="username" spellcheck="false"
               bind:value={jfUser} disabled={!usingLiveLibrary || isLoggingIn()} />
        <input class="settings-input" type="password" placeholder={m.library_password()}
               aria-label="Jellyfin-Passwort" autocomplete="current-password"
               bind:value={jfPassword} disabled={!usingLiveLibrary || isLoggingIn()} />
        <button class="secondary-btn pressable" type="submit"
                disabled={!usingLiveLibrary || isLoggingIn() || !jfUser.trim() || !jfPassword}>
          {isLoggingIn() ? m.sys_signing_in() : m.library_signin()}
        </button>
      </div>
      {#if libraryError()}
        <p class="settings-form-msg is-error" role="alert">{libraryError()}</p>
      {/if}
    </form>
  {/if}

  <div class="settings-row" data-setting-id="jf-device">
    <span class="settings-row-icon"><Icon name="i-server" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_device_id()}</span>
      <span class="settings-row-sub">{m.sys_device_id_hint()}</span>
    </div>
    <span class="settings-row-value num">{jellyfin.deviceId}</span>
  </div>

  <form class="settings-row is-stacked" data-setting-id="icloud-setup" onsubmit={onICloudSubmit}>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_icloud_connect()}</span>
      <span class="settings-row-sub">{m.sys_icloud_hint()}</span>
    </div>
    <div class="settings-form-grid">
      <input class="settings-input" type="email" placeholder={m.sys_apple_id_label()}
             aria-label={m.sys_apple_id()} autocomplete="off" spellcheck="false"
             bind:value={icloudUser} disabled={icloudSetup.running} />
      <input class="settings-input" type="password" placeholder={m.sys_app_password()}
             aria-label={m.sys_app_password()} autocomplete="off"
             bind:value={icloudPassword} disabled={icloudSetup.running} />
      <button class="secondary-btn pressable" type="submit"
              disabled={icloudSetup.running || !icloudUser.trim() || !icloudPassword || settingsValues.demoMode}>
        {icloudSetup.running ? m.sys_setting_up() : m.sys_setup()}
      </button>
    </div>
    {#if settingsValues.demoMode}
      <p class="settings-form-msg">{m.sys_demo_no_function_ha()}</p>
    {:else if icloudSetup.result}
      <p class="settings-form-msg" class:is-ok={icloudSetup.result.ok} class:is-error={!icloudSetup.result.ok} role="status">
        {icloudSetup.result.message}
      </p>
    {/if}
  </form>
</div>

<h3 class="caps-label settings-group-label">{m.sys_group_services_private()}</h3>
<div class="settings-group">
  <div class="settings-row" data-setting-id="ablage-status">
    <span class="dot {ablageDot}"></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.settings_entry_ablage_status_label()}</span>
      <span class="settings-row-sub">{m.sys_ablage_hint()}</span>
    </div>
    <span class="settings-row-value">{ablageLabel}</span>
  </div>

  <div class="settings-row" data-setting-id="songs-status">
    <span class="dot {songsDot}"></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.settings_entry_songs_status_label()}</span>
      <span class="settings-row-sub">{m.sys_songs_hint()}</span>
    </div>
    <span class="settings-row-value">{songsLabel}</span>
  </div>
</div>
