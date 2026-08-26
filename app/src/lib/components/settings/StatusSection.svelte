<script lang="ts">
  /* ── System · Zustand ──
     Produktiv ausschließlich verifizierbare Live-Daten: eigener HA-
     Verbindungszustand und echte `update.*`-Entitäten. Die ausführliche
     erfundene Diensteliste bleibt auf die klar markierte Demo beschränkt. */
  import { appState, SERVICE_STATUS } from '../../state/app.svelte.ts';
  import { connection } from '../../state/connection.svelte.ts';
  import { systemStatus } from '../../state/system-status.svelte.ts';
  import { IS_DEMO } from '../../demo/demo-mode.ts';
  import { m } from '../../../paraglide/messages.js';
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { buildInfo, loadBuildInfo } from '../../state/build-info.svelte.ts';
  import { licenseSourceView } from '../../config/build-info.ts';

  /* Lizenz und Quellcode der laufenden Fassung (AGPL §13). Bewusst hier in der
     Systemübersicht und ohne Adminschutz — die Auskunft gehört jedem Benutzer,
     auch später in einer Gastoberfläche. */
  const license = $derived(licenseSourceView(buildInfo));
  const conn = $derived(connection());
  const licenseTextUrl = `${import.meta.env.BASE_URL}legal/agpl-3.0.txt`;

  $effect(() => { void loadBuildInfo(); });

  function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
</script>

<div class="settings-group" data-setting-id="service-health">
  <SettingsCardHead icon="i-heart-pulse" tint="success" title={m.sys_services()} />
  {#if IS_DEMO}
    {#each appState.system.services as svc (svc.id)}
      {@const st = SERVICE_STATUS[svc.status]}
      <div class="settings-row">
        <span class="dot {st.dot}"></span>
        <div class="settings-row-text">
          <span class="settings-row-label">{svc.name}</span>
          <span class="settings-row-sub num">{svc.detail}</span>
        </div>
        <span class="settings-row-badge is-{svc.status}">{st.label}</span>
      </div>
    {/each}
  {:else}
    <div class="settings-row">
      <span class="dot {conn.dot}"></span>
      <div class="settings-row-text">
        <span class="settings-row-label">Home Assistant</span>
        <span class="settings-row-sub">{m.sys_services_live_hint()}</span>
      </div>
      <span class="settings-row-badge" class:is-degraded={!conn.online && !conn.disconnected}
            class:is-offline={conn.disconnected}>{conn.label}</span>
    </div>
  {/if}
</div>

<div class="settings-group" data-setting-id="update-list">
  <SettingsCardHead icon="i-download" tint="neutral" title={m.sys_card_updates()} />
  {#each systemStatus.updates as u (u.entityId)}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-download" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{u.name}</span>
      </div>
      <span class="settings-row-value num">{u.installedVersion} <span class="settings-arrow">→</span> {u.latestVersion}</span>
    </div>
  {:else}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-check-circle-outline" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">
          {systemStatus.loading
            ? m.sys_updates_loading()
            : systemStatus.failed
              ? m.sys_updates_failed()
              : conn.online ? m.sys_updates_none() : m.sys_updates_offline()}
        </span>
      </div>
    </div>
  {/each}
</div>
<p class="settings-note">{m.sys_updates_note()}</p>

<div class="settings-group" data-setting-id="license-source">
  <SettingsCardHead icon="i-scale-balance" tint="neutral"
                    title={m.sys_license_source()} sub={m.sys_license_source_hint()} />
  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-scale-balance" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_license()}</span>
    </div>
    <span class="settings-row-value num">{license.license}</span>
    <button class="secondary-btn pressable" type="button"
            onclick={() => openExternal(licenseTextUrl)}>{m.sys_view_license()}</button>
  </div>

  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-tag-outline" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_app_version()}</span>
    </div>
    <span class="settings-row-value num">{license.version ?? m.sys_build_unknown()}</span>
  </div>

  <!-- Kurze SHA als Wert, vollständige SHA darunter: sie ist der einzige
       belastbare Zeiger auf den Corresponding Source und muss lesbar und
       markierbar bleiben. -->
  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-source-branch" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_revision()}</span>
      <span class="settings-row-sub num">{license.revision ?? m.sys_revision_hint()}</span>
    </div>
    <span class="settings-row-value num">{license.revisionShort ?? m.sys_build_unknown()}</span>
  </div>

  <div class="settings-row">
    <span class="settings-row-icon"><Icon name="i-code-tags" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_source_code()}</span>
      <span class="settings-row-sub">{license.sourceUrl ?? m.sys_source_missing()}</span>
    </div>
    {#if license.sourceUrl}
      <button class="secondary-btn pressable" type="button"
              onclick={() => openExternal(license.sourceUrl!)}>{m.sys_view_source()}</button>
    {/if}
  </div>
</div>
