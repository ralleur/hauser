<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* ── Ablage · Paperless ──
     Adresse und API-Token, analog zur Jellyfin-Karte. Beides landet in der
     geteilten Konfiguration; der Server liest es für den Ablage-Proxy, ohne
     Neustart. Der Token wird nach dem Speichern nicht mehr angezeigt — die
     Zeile sagt nur noch, dass einer hinterlegt ist.

     Die PIN, die den Ablage-Screen sperrt, bleibt bewusst außen vor: sie liegt
     im Schlüsselbund des Servers und ist kein Dienst-Zugang. */
  import Icon from '../Icon.svelte';
  import { settingsValues, setPaperlessToken, setPaperlessUrl } from '../../state/settings.svelte.ts';
  import { probeLocalServices } from '../../state/service-probes.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const PAPERLESS_URL_DEFAULT = 'http://127.0.0.1:8000';

  let tokenDraft = $state('');
  let saved = $state(false);

  function saveToken(): void {
    setPaperlessToken(tokenDraft);
    tokenDraft = '';
    saved = true;
    void probeLocalServices();
  }
</script>

<div class="settings-row is-stacked" data-setting-id="paperless-url">
  <div class="settings-row-text">
    <span class="settings-row-label">{m.sys_paperless_url()}</span>
    <span class="settings-row-sub">{m.sys_default_hint({ value: PAPERLESS_URL_DEFAULT })}</span>
  </div>
  <input class="settings-input num" type="url" placeholder={PAPERLESS_URL_DEFAULT}
         aria-label={m.sys_paperless_url()} autocomplete="off" spellcheck="false"
         value={settingsValues.paperlessUrl}
         onchange={(event) => { setPaperlessUrl(event.currentTarget.value); void probeLocalServices(); }} />
</div>

<div class="settings-row is-stacked" data-setting-id="paperless-token">
  <div class="settings-row-text">
    <span class="settings-row-label">
      <Icon name="i-key-variant" cls="icon icon-sm" />
      {m.sys_paperless_token()}
    </span>
    <span class="settings-row-sub">
      {settingsValues.paperlessTokenSet ? m.sys_paperless_token_set() : m.sys_paperless_token_hint()}
    </span>
  </div>
  <div class="settings-form-grid">
    <input class="settings-input" type="password" inputmode="text" autocomplete="off"
           spellcheck="false" aria-label={m.sys_paperless_token()}
           placeholder={settingsValues.paperlessTokenSet ? '••••••••' : ''}
           bind:value={tokenDraft} />
    <button class="secondary-btn pressable" type="button" disabled={!tokenDraft.trim()}
            onclick={saveToken}>{m.sys_paperless_save()}</button>
    {#if settingsValues.paperlessTokenSet}
      <button class="secondary-btn danger-btn pressable" type="button"
              onclick={() => { setPaperlessToken(''); saved = false; void probeLocalServices(); }}>
        {m.sys_signout()}
      </button>
    {/if}
  </div>
  {#if saved}
    <p class="settings-form-msg is-ok" role="status">{m.sys_paperless_saved()}</p>
  {/if}
</div>
