<script lang="ts">
  /* ── Darstellung · Ambient & Standby ──
     Alles, was das Panel im Ruhezustand zeigt — einschließlich des
     KI-Tageskommentars. Der stand vorher unter „KI · Funktionen“; wer den
     Text im Standby sucht, sucht ihn beim Standby, nicht unter der Technik,
     die ihn erzeugt. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { requestAmbient, requestAmbientPreview, requestDeepNightPreview } from '../../state/ambient.svelte.ts';
  import { parseAmbientMapCoordinate, type AmbientMapPlace } from '../../state/ambient-map-client.ts';
  import {
    settingsValues,
    setAmbientCityMap,
    setAmbientDeepNight,
    setAmbientHeroText,
  } from '../../state/settings.svelte.ts';
  import { aiHealth } from '../../state/ai-health.svelte.ts';
  import { AMBIENT_LLM_DEFAULT_MODEL } from '../../state/ambient-copy-client.ts';
  import {
  ambientMap,
  ensureAmbientMapStatus,
  locateAmbientMapDevice,
  regenerateAmbientMap,
  searchAmbientMapPlaces,
  selectAmbientMapPlace,
  submitManualMapLocation,
  useHomeAssistantMapLocation,
} from '../../state/ambient-map.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  /* „offline“ und „unauthorized“ heißen beide: der Schalter unten läuft ins
     Leere. Das wird an der Zeile ausgewiesen, statt es den Nutzer an einem
     stillen Fehlschlag merken zu lassen. */
  const accessMissing = $derived(aiHealth.status === 'offline' || aiHealth.status === 'unauthorized');

  /* ── Stadtplan-Hintergrund (docs/18 §7.2) ──
     Die Einstellungen sind die einzige Stelle, die Quelle und Label kennt;
     deshalb der Adminstatus. Der Abruf startet sofort, blockiert aber nichts —
     die Sektion ist ohne ihn vollständig bedienbar. */
  $effect(() => { ensureAmbientMapStatus({ immediate: true, admin: true }); });

  let manualOpen = $state(false);
  let manualLatitude = $state('');
  let manualLongitude = $state('');

  const mapBusy = $derived(ambientMap.busy || ambientMap.locating);
  const hasMap = $derived(ambientMap.assetUrl !== null);

  const mapStateText = $derived(
    ambientMap.state === 'ready' ? m.sys_map_state_ready()
      : ambientMap.state === 'error' ? m.sys_map_state_error()
        : ambientMap.state === 'queued' || ambientMap.state === 'running' ? m.sys_map_state_pending()
          : m.sys_map_state_empty(),
  );

  const mapStateIcon = $derived(
    ambientMap.state === 'ready' ? 'i-map-check'
      : ambientMap.state === 'error' ? 'i-alert-circle-outline'
        : ambientMap.state === 'queued' || ambientMap.state === 'running' ? 'i-refresh'
          : 'i-information-outline',
  );

  /* Quelle und automatisch gewählter Radius — beides erst, wenn ein Asset
     wirklich existiert. Koordinaten liefert der Server bewusst nie. */
  const mapDetail = $derived.by(() => {
    const parts: string[] = [];
    if (ambientMap.source === 'home_assistant') parts.push(m.sys_map_source_home_assistant());
    else if (ambientMap.source === 'browser') parts.push(m.sys_map_source_browser());
    else if (ambientMap.source === 'manual') parts.push(m.sys_map_source_manual());
    if (ambientMap.label) parts.push(ambientMap.label);
    if (ambientMap.radiusMetres !== null) parts.push(m.sys_map_radius({ radius: ambientMap.radiusMetres }));
    return parts.join(' · ');
  });

  const mapProblem = $derived.by(() => {
    /* Ein gescheiterter Auftrag ist kein `problem` der Anfrage, sondern ein
       Ergebnis des Jobs. Ohne die Ursache stünde hier nur „Erzeugung
       fehlgeschlagen" — der häufigste Fall ist aber ein nicht erreichbares
       Home Assistant, und das ist behebbar, wenn man es weiß. */
    if (!ambientMap.problem && ambientMap.state === 'error') {
      if (ambientMap.errorCode?.startsWith('AMBIENT_MAP_HA_')) {
        return m.sys_map_error_home_assistant();
      }
      /* Overpass ist ein von Freiwilligen betriebener Dienst und faellt
         regelmaessig aus. Das ist kein Fehler der Eingabe und schon gar keiner
         der Anlage — der Hinweis sagt das und raet zum spaeteren Versuch. */
      if (ambientMap.errorCode === 'UPSTREAMS_FAILED'
          || ambientMap.errorCode === 'RESPONSE_TOO_LARGE'
          || ambientMap.errorCode === 'INVALID_JSON') {
        return m.sys_map_error_upstream();
      }
    }
    switch (ambientMap.problem) {
      case 'status_unavailable': return m.sys_map_error_status();
      case 'unavailable': return m.sys_map_error_unavailable();
      case 'request_failed': return m.sys_map_error_request();
      case 'admin_required': return m.sys_map_error_admin();
      case 'home_assistant_unavailable': return m.sys_map_error_home_assistant();
      case 'invalid_coordinates': return m.sys_map_error_coordinates();
      case 'search_failed': return m.sys_map_error_search();
      case 'search_rate_limited': return m.sys_map_error_search_rate();
      case 'geolocation_denied': return m.sys_map_error_geo_denied();
      case 'geolocation_unavailable': return m.sys_map_error_geo_unavailable();
      case 'geolocation_timeout': return m.sys_map_error_geo_timeout();
      case 'geolocation_insecure': return m.sys_map_error_geo_insecure();
      default: return '';
    }
  });

  /* Was das Formular verstanden hat — geraetelokal und fluechtig, nie zum
     Server und nie in den Status. Ohne diese Rueckmeldung sieht man einer
     verrutschten Eingabe nicht an, dass sie verrutscht ist: der Status nennt
     bewusst nur „Quelle: manuell", die Koordinaten bleiben privat. */
  let acceptedCoords = $state<string | null>(null);
  let searchTerm = $state('');

  /* Entprellt im Client: gesucht wird erst, wenn die Eingabe ruht. Echtes
     Autocomplete bei jedem Tastendruck wuerde Nominatims Nutzungsrichtlinie
     verletzen — ein von Freiwilligen betriebener Dienst vertraegt das nicht. */
  function onSearchInput(event: Event): void {
    searchTerm = (event.currentTarget as HTMLInputElement).value;
    searchAmbientMapPlaces(searchTerm);
  }

  function onPlacePick(place: AmbientMapPlace): void {
    searchTerm = place.label;
    acceptedCoords = `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`;
    selectAmbientMapPlace(place);
  }

  function onManualSubmit(event: SubmitEvent): void {
    event.preventDefault();
    const lat = parseAmbientMapCoordinate(manualLatitude);
    const lon = parseAmbientMapCoordinate(manualLongitude);
    acceptedCoords = lat === null || lon === null
      ? null
      : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    submitManualMapLocation(manualLatitude, manualLongitude);
  }
</script>

<div class="settings-group">
  <SettingsCardHead icon="i-sleep" tint="cool"
                    title={m.sys_card_standby()} sub={m.sys_card_standby_hint()} />

  <div class="settings-row" data-setting-id="standby-now">
    <span class="settings-row-icon"><Icon name="i-sleep" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_standby()}</span>
      <span class="settings-row-sub">{m.sys_standby_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button" onclick={() => requestAmbient()}>{m.sys_start_now()}</button>
  </div>

  <div class="settings-row" data-setting-id="ambient-deep-night">
    <span class="settings-row-icon"><Icon name="i-weather-night" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_deep_night()}</span>
      <span class="settings-row-sub">{m.sys_deep_night_hint()}</span>
    </div>
    <div class="settings-row-actions">
      <button class="secondary-btn pressable" type="button"
              onclick={requestDeepNightPreview}>{m.sys_preview()}</button>
      <button class="settings-switch pressable" type="button" role="switch"
              aria-checked={settingsValues.ambientDeepNight}
              aria-label={m.sys_deep_night_toggle()}
              onclick={() => setAmbientDeepNight(!settingsValues.ambientDeepNight)}>
        <span class="settings-switch-knob"></span>
      </button>
    </div>
  </div>

  <div class="settings-row" data-setting-id="ambient-hero-text">
    <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_ai_hero_text()}</span>
      <span class="settings-row-sub">
        {accessMissing ? m.sys_ai_needs_access() : AMBIENT_LLM_DEFAULT_MODEL}
      </span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.ambientHeroText}
            aria-label={m.sys_ai_hero_text()}
            onclick={() => setAmbientHeroText(!settingsValues.ambientHeroText)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>
</div>

<!-- ── Stadtplan-Hintergrund ──
     Der Schalter ist gerätelokal, Standort und Asset sind zentral. Kein
     Schritt blockiert: der Server nimmt einen Auftrag an und antwortet sofort;
     die Statuszeile folgt, ohne dass hier irgendetwas wartet. -->
<div class="settings-group">
  <SettingsCardHead icon="i-map" tint="cool"
                    title={m.sys_map_card()} sub={m.sys_map_card_hint()} />

  <div class="settings-row" data-setting-id="ambient-city-map">
    <span class="settings-row-icon"><Icon name="i-map" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_map_toggle()}</span>
      <span class="settings-row-sub">{m.sys_map_toggle_hint()}</span>
    </div>
    <div class="settings-row-actions">
      <button class="secondary-btn pressable" type="button"
              onclick={() => requestAmbientPreview()}>{m.sys_preview()}</button>
      <button class="settings-switch pressable" type="button" role="switch"
              aria-checked={settingsValues.ambientCityMap}
              aria-label={m.sys_map_toggle()}
              onclick={() => setAmbientCityMap(!settingsValues.ambientCityMap)}>
        <span class="settings-switch-knob"></span>
      </button>
    </div>
  </div>

  <div class="settings-row">
    <span class="settings-row-icon"><Icon name={mapStateIcon} cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{mapStateText}</span>
      {#if mapDetail}<span class="settings-row-sub">{mapDetail}</span>{/if}
    </div>
  </div>

  {#if mapProblem}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-alert-circle-outline" cls="icon icon-md" /></span>
      <p class="settings-form-msg is-error" role="status">{mapProblem}</p>
    </div>
  {/if}

  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-home-assistant" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_map_use_home_assistant()}</span>
      <span class="settings-row-sub">{m.sys_map_use_home_assistant_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button" disabled={mapBusy}
            onclick={useHomeAssistantMapLocation}>{m.sys_apply()}</button>
  </div>

  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-crosshairs-gps" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_map_locate_device()}</span>
      <span class="settings-row-sub">{m.sys_map_locate_device_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button" disabled={mapBusy}
            onclick={locateAmbientMapDevice}>
      {ambientMap.locating ? m.sys_map_locating() : m.sys_apply()}
    </button>
  </div>

  <!-- Ortssuche: der bequemste Weg zu einem Standort. Koordinaten bleiben als
       Rueckfall darunter, falls die Suche nichts findet oder ausfaellt. -->
  <div class="settings-row is-stacked" data-setting-id="ambient-city-map-search">
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_map_search()}</span>
      <span class="settings-row-sub">{m.sys_map_search_hint()}</span>
    </div>
    <input
      class="settings-input"
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder={m.sys_map_search_placeholder()}
      aria-label={m.sys_map_search()}
      value={searchTerm}
      oninput={onSearchInput}
      disabled={mapBusy}
    />
    {#if ambientMap.searching}
      <p class="settings-row-sub" role="status">{m.sys_map_searching()}</p>
    {:else if ambientMap.searchResults.length > 0}
      <ul class="map-search-results">
        {#each ambientMap.searchResults as place (place.label)}
          <li>
            <button class="secondary-btn pressable" type="button"
                    disabled={mapBusy} onclick={() => onPlacePick(place)}>
              {place.label}
            </button>
          </li>
        {/each}
      </ul>
    {:else if searchTerm.trim().length >= 3}
      <p class="settings-row-sub" role="status">{m.sys_map_search_empty()}</p>
    {/if}
  </div>

  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-map-marker" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_map_manual()}</span>
      <span class="settings-row-sub">{m.sys_map_manual_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button"
            aria-expanded={manualOpen} aria-label={m.sys_map_manual()}
            onclick={() => { manualOpen = !manualOpen; }}>
      <Icon name={manualOpen ? 'i-chevron-up' : 'i-chevron-down'} cls="icon icon-md" />
    </button>
  </div>

  {#if manualOpen}
    <form class="settings-row is-stacked" onsubmit={onManualSubmit}>
      <div class="settings-form-grid">
        <input class="settings-input" type="text" inputmode="decimal"
               placeholder="49.6069" aria-label={m.sys_map_latitude()}
               autocomplete="off" spellcheck="false"
               bind:value={manualLatitude} disabled={mapBusy} />
        <input class="settings-input" type="text" inputmode="decimal"
               placeholder="6.5508" aria-label={m.sys_map_longitude()}
               autocomplete="off" spellcheck="false"
               bind:value={manualLongitude} disabled={mapBusy} />
        <button class="secondary-btn pressable" type="submit"
                disabled={mapBusy || !manualLatitude.trim() || !manualLongitude.trim()}>
          {m.sys_apply()}
        </button>
      </div>
      {#if acceptedCoords}
        <p class="settings-row-sub" role="status">
          {m.sys_map_coords_accepted({ coords: acceptedCoords })}
        </p>
      {/if}
    </form>
  {/if}

  {#if hasMap}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-refresh" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{m.sys_map_regenerate()}</span>
        <span class="settings-row-sub">{m.sys_map_regenerate_hint()}</span>
      </div>
      <button class="secondary-btn pressable" type="button" disabled={mapBusy}
              onclick={regenerateAmbientMap}>{m.sys_start_now()}</button>
    </div>
  {/if}
</div>

<p class="settings-note">{m.sys_map_privacy()}</p>

<!-- Die Namensnennung steht hier und nicht im Standby: der ist eine dekorative
     Flaeche ohne Bedienung, und OpenStreetMaps Richtlinie erlaubt fuer solche
     nicht-interaktiven Werke die Nennung an der Stelle, wo Credits ueblich sind.
     Deshalb bewusst als eigener, sichtbarer Absatz mit Link auf die
     Copyright-Seite — nicht als beilaeufige Fussnote. -->
<p class="settings-note settings-note-license">
  {m.sys_map_license()}
  <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">openstreetmap.org/copyright</a>
</p>
