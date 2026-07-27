<script lang="ts">
  /* ── System · Wartung ──
     Caches (unkritisch, ohne Rückfrage) getrennt von destruktiven Resets
     (zweistufige Bestätigung, danach Neuladen nötig). */
  import Icon from '../Icon.svelte';
  import { clearCache, resetStored, isCleared, isConfirming } from '../../state/settings-actions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
</script>

<h3 class="caps-label settings-group-label">{m.sys_caches()}</h3>
<div class="settings-group">
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
      <span class="settings-row-label">Kalender-Cache</span>
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
      <span class="settings-row-label">Icon-Verlauf</span>
      <span class="settings-row-sub">{m.sys_icon_cache_hint()}</span>
    </div>
    <button class="secondary-btn pressable" type="button"
            onclick={() => clearCache('cache-icons', ['hmi:recent-icons'])}>
      {isCleared('cache-icons') ? m.sys_cleared() : m.sys_clear()}
    </button>
  </div>
</div>

<h3 class="caps-label settings-group-label">{m.sys_reset()}</h3>
<div class="settings-group">
  <div class="settings-row" data-setting-id="reset-devices">
    <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_device_names_icons()}</span>
      <span class="settings-row-sub">{m.sys_device_names_hint()}</span>
    </div>
    <button class="secondary-btn danger-btn pressable" type="button"
            onclick={() => resetStored('reset-devices', ['hmi:device-config', 'hmi:light-icon-overrides'])}>
      {isConfirming('reset-devices') ? m.sys_reset_confirm() : isCleared('reset-devices') ? m.sys_reset_done() : m.sys_reset()}
    </button>
  </div>

  <div class="settings-row" data-setting-id="reset-scenes">
    <span class="settings-row-icon"><Icon name="i-restore" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_scenes()}</span>
      <span class="settings-row-sub">{m.sys_scenes_hint()}</span>
    </div>
    <button class="secondary-btn danger-btn pressable" type="button"
            onclick={() => resetStored('reset-scenes', ['hmi:scene-config'])}>
      {isConfirming('reset-scenes') ? m.sys_reset_confirm() : isCleared('reset-scenes') ? m.sys_reset_done() : m.sys_reset()}
    </button>
  </div>
</div>

<div class="settings-group">
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
