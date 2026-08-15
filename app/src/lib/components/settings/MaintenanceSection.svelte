<script lang="ts">
  /* ── System · Wartung & Diagnose ──
     Caches (unkritisch, ohne Rückfrage) getrennt von destruktiven Resets
     (zweistufige Bestätigung, danach Neuladen nötig).

     Der Demo-Schalter steht hier: er ist ein Werkzeug für Entwicklung und
     Vorführung, keine Alltagseinstellung — und die einzige Stelle, an der
     „echte Dienste oder simulierte Daten?“ global entschieden wird. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { clearCache, isCleared } from '../../state/settings-actions.svelte.ts';
  import { settingsValues, setDemoMode } from '../../state/settings.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<div class="settings-group">
  <SettingsCardHead icon="i-database-refresh" tint="neutral"
                    title={m.sys_caches()} sub={m.sys_card_caches()} />

  <div class="settings-row" data-setting-id="cache-ha">
    <span class="settings-row-icon"><Icon name="i-database-refresh" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_entity_cache()}</span>
      <span class="settings-row-sub">{m.sys_entity_cache_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button"
            onclick={() => clearCache('cache-ha', ['hmi:ha-cache'])}>
      {isCleared('cache-ha') ? m.sys_cleared() : m.sys_clear()}
    </button>
  </div>

  <div class="settings-row" data-setting-id="cache-calendar">
    <span class="settings-row-icon"><Icon name="i-database-refresh" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_calendar_cache()}</span>
      <span class="settings-row-sub">{m.sys_calendar_cache_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button"
            onclick={() => clearCache('cache-calendar', ['hmi:calendar-familie-cache'])}>
      {isCleared('cache-calendar') ? m.sys_cleared() : m.sys_clear()}
    </button>
  </div>

  <div class="settings-row" data-setting-id="cache-icons">
    <span class="settings-row-icon"><Icon name="i-database-refresh" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_icon_cache()}</span>
      <span class="settings-row-sub">{m.sys_icon_cache_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button"
            onclick={() => clearCache('cache-icons', ['hmi:recent-icons'])}>
      {isCleared('cache-icons') ? m.sys_cleared() : m.sys_clear()}
    </button>
  </div>
</div>

<div class="settings-group">
  <SettingsCardHead icon="i-wrench" tint="neutral"
                    title={m.sys_card_app()} sub={m.sys_card_app_hint()} />

  <div class="settings-row" data-setting-id="demo-mode">
    <span class="settings-row-icon"><Icon name="i-television-play" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_demo_mode()}</span>
      <span class="settings-row-sub">{m.sys_backend_demo_hint()}</span>
    </div>
    <button class="settings-switch pressable" type="button" role="switch"
            aria-checked={settingsValues.demoMode} aria-label={m.sys_demo_mode()}
            onclick={() => setDemoMode(!settingsValues.demoMode)}>
      <span class="settings-switch-knob"></span>
    </button>
  </div>

  <div class="settings-row" data-setting-id="reload-app">
    <span class="settings-row-icon"><Icon name="i-refresh" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_reload_app()}</span>
      <span class="settings-row-sub">{m.sys_reload_app_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button" onclick={() => location.reload()}>{m.sys_reload()}</button>
  </div>
</div>
<p class="settings-note">{m.sys_maintenance_note()}</p>
