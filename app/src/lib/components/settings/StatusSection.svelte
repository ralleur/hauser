<script lang="ts">
  /* ── System · Zustand ──
     Reine Diagnoseanzeige der Smart-Home-Dienste. Die Erreichbarkeit der
     Integrationen selbst steht in „Verbindungen · Dienste“ — hier geht es um
     die Dienste hinter Home Assistant (Zigbee, MQTT, Tunnel, …). */
  import { appState, SERVICE_STATUS } from '../../state/app.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
</script>

<div class="settings-group" data-setting-id="service-health">
  <SettingsCardHead icon="i-heart-pulse" tint="success" title={m.sys_services()} />
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
</div>

<div class="settings-group" data-setting-id="update-list">
  <SettingsCardHead icon="i-download" tint="neutral" title={m.sys_card_updates()} />
  {#each appState.system.updates as u (u.name)}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-download" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">{u.name}</span>
      </div>
      <span class="settings-row-value num">{u.from} <span class="settings-arrow">→</span> {u.to}</span>
    </div>
  {/each}
</div>
<p class="settings-note">{m.sys_updates_note()}</p>
