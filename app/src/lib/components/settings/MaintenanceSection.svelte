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
  import { apiPath } from '../../api/client.ts';

  /* Sichern und wiederherstellen: die Datei kommt vom Server und geht an ihn
     zurück. Nach dem Einspielen startet er neu; die Seite wartet auf ihn und
     lädt dann selbst. */
  const backupAvailable = import.meta.env.VITE_DEMO !== '1';
  let restoreInput = $state<HTMLInputElement | null>(null);
  let restoreFile = $state<File | null>(null);
  let restoreState = $state<'idle' | 'sending' | 'restarting' | 'failed'>('idle');
  let restoreMessage = $state('');

  function pickRestoreFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    restoreFile = input.files?.[0] ?? null;
    restoreState = 'idle';
    input.value = '';
  }

  async function waitForRestart() {
    const deadline = Date.now() + 90_000;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    while (Date.now() < deadline) {
      try {
        const response = await fetch(apiPath('health'), { cache: 'no-store' });
        if (response.ok) { location.reload(); return; }
      } catch { /* Server ist noch unterwegs */ }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    location.reload();
  }

  async function applyRestore() {
    if (!restoreFile) return;
    restoreState = 'sending';
    try {
      const response = await fetch(apiPath('backupRestore'), { method: 'POST', body: restoreFile });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
      restoreState = 'restarting';
      restoreFile = null;
      await waitForRestart();
    } catch (error) {
      restoreState = 'failed';
      restoreMessage = error instanceof Error ? error.message : String(error);
    }
  }
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

{#if backupAvailable}
<div class="settings-group">
  <SettingsCardHead icon="i-archive-arrow-down" tint="neutral"
                    title={m.sys_card_backup()} sub={m.sys_card_backup_hint()} />

  <div class="settings-row" data-setting-id="backup">
    <span class="settings-row-icon"><Icon name="i-archive-arrow-down" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_backup_download()}</span>
      <span class="settings-row-sub">{m.sys_backup_download_hint()}</span>
    </div>
    <a class="secondary-btn pressable" href={apiPath('backup')} download>{m.sys_backup_save()}</a>
  </div>

  <div class="settings-row" data-setting-id="backup-restore">
    <span class="settings-row-icon"><Icon name="i-archive-arrow-up" cls="icon icon-md" /></span>
    <div class="settings-row-text">
      <span class="settings-row-label">{m.sys_backup_restore()}</span>
      <span class="settings-row-sub" role="status">
        {#if restoreState === 'restarting'}{m.sys_backup_restarting()}
        {:else if restoreState === 'failed'}{m.sys_backup_failed({ message: restoreMessage })}
        {:else if restoreFile}{m.sys_backup_confirm({ name: restoreFile.name })}
        {:else}{m.sys_backup_restore_hint()}{/if}
      </span>
    </div>
    <input bind:this={restoreInput} type="file" accept=".hauser,application/gzip" hidden onchange={pickRestoreFile} />
    {#if restoreFile && restoreState !== 'sending'}
      <button class="secondary-btn pressable" type="button" onclick={() => { restoreFile = null; }}>{m.sys_backup_cancel()}</button>
      <button class="secondary-btn pressable" type="button" onclick={applyRestore}>{m.sys_backup_apply()}</button>
    {:else}
      <button class="secondary-btn pressable" type="button" disabled={restoreState === 'sending' || restoreState === 'restarting'}
              onclick={() => restoreInput?.click()}>{m.sys_backup_choose()}</button>
    {/if}
  </div>
</div>
{/if}
