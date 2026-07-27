<script lang="ts">
  /* ── System · Zustand ──
     Reine Diagnoseanzeige der Smart-Home-Dienste. Die Erreichbarkeit der
     Integrationen selbst steht in „Verbindungen · Dienste“ — hier geht es um
     die Dienste hinter Home Assistant (Zigbee, MQTT, Tunnel, …). */
  import { appState, SERVICE_STATUS } from '../../state/app.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<h3 class="caps-label settings-group-label">{m.sys_services()}</h3>
<div class="settings-group" data-setting-id="service-health">
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
