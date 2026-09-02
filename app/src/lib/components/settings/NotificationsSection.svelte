<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import LaundrySection from './LaundrySection.svelte';
  import { runtime } from '../../adapter/runtime.svelte.ts';
  import type { NotificationHistoryEntry } from '../../adapter/types.ts';
  import { IS_DEMO } from '../../demo/demo-mode.ts';
  import { deviceManager } from '../../state/device-manager.svelte.ts';
  import { LAUNDRY_ENTITIES } from '../../state/entities.ts';
  import type { EntityCatalogItem } from '../../state/fake-discovery-catalog.ts';
  import { notifications } from '../../state/notifications.svelte.ts';
  import { notificationRules } from '../../state/notification-rules.svelte.ts';
  import { settingsUi } from '../../state/settings.svelte.ts';
  import {
    NOTIFICATION_CATEGORIES,
    categoryById,
    categoryColor,
    ruleFromSource,
  } from '../../state/notification-categories.ts';
  import {
    NOTIFICATION_COLORS,
    NOTIFICATION_DELAY_OPTIONS,
    activeRuleCount,
    testNotificationIdFor,
    type NotificationCategoryId,
    type NotificationColor,
    type NotificationRule,
    type NotificationTrigger,
  } from '../../state/notification-rules.ts';

  let selected = $state<NotificationCategoryId>('laundry');
  let expanded = $state(true);
  let historyOpen = $state(false);
  /* undefined = noch nicht geladen, null = ohne Home Assistant nicht verfügbar */
  let history = $state<NotificationHistoryEntry[] | null | undefined>(undefined);
  let historyLoading = $state(false);
  let addSource = $state('');
  let testBusy = $state(false);

  $effect(() => { void notificationRules.load(); });

  /* Sprung aus der Suche: „Wäsche" landet in dieser Sektion, muss dort aber
     auch die passende Kategorie aufschlagen — sonst zeigt der Detailbereich
     weiter das zuletzt Gewählte und das Sprungziel bleibt ungerendert. */
  $effect(() => {
    void settingsUi.highlightSeq;
    if (settingsUi.highlight !== 'laundry') return;
    selected = 'laundry';
    expanded = true;
  });

  const category = $derived(categoryById(selected));
  const activeColor = $derived(categoryColor(selected, notificationRules.draftColors));
  const rules = $derived(notificationRules.draft.filter((rule) => rule.category === selected));
  const sources = $derived(category.sources(deviceManager.catalog));
  const freeSources = $derived(sources.filter((source) => !rules.some((rule) => rule.entityId === source.entityId)));
  const dateFormat = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  function colorLabel(color: NotificationColor): string {
    switch (color) {
      case 'info': return m.settings_notifications_color_info();
      case 'success': return m.settings_notifications_color_success();
      case 'warning': return m.settings_notifications_color_warning();
      case 'critical': return m.settings_notifications_color_critical();
      default: return m.settings_notifications_color_neutral();
    }
  }

  function countLabel(id: NotificationCategoryId): string {
    const count = activeRuleCount(notificationRules.draft, id);
    if (count === 0) return m.settings_notifications_rules_none();
    if (count === 1) return m.settings_notifications_rules_one();
    return m.settings_notifications_rules_many({ count });
  }

  function select(id: NotificationCategoryId): void {
    selected = id;
    expanded = true;
    addSource = '';
  }

  function sourceOptions(rule: NotificationRule): EntityCatalogItem[] {
    const current = sources.find((source) => source.entityId === rule.entityId);
    return current ? [current, ...freeSources] : freeSources;
  }

  function delayed(rule: NotificationRule): NotificationTrigger[] {
    return rule.triggers.filter((trigger) => trigger.delayMinutes > 0);
  }

  function numeric(rule: NotificationRule): NotificationTrigger[] {
    return rule.triggers.filter((trigger) => trigger.kind !== 'state');
  }

  function unitFor(rule: NotificationRule): string {
    return deviceManager.catalog.find((source) => source.entityId === rule.entityId)?.unit ?? '';
  }

  function laundryMode(rule: NotificationRule): 'existing' | 'blueprint' {
    const adapter = rule.id === 'laundry_washer' ? LAUNDRY_ENTITIES.washer : LAUNDRY_ENTITIES.dryer;
    return adapter?.cycleMarkerEntityId ? 'blueprint' : 'existing';
  }

  function ruleHint(rule: NotificationRule): string {
    if (rule.id === 'laundry_washer') return m.notif_hint_washer();
    if (rule.id === 'laundry_dryer') return m.notif_hint_dryer();
    return m.settings_notifications_rule_hint();
  }

  function changeSource(rule: NotificationRule, entityId: string): void {
    const source = sources.find((entry) => entry.entityId === entityId);
    if (source) notificationRules.setSource(rule.id, category, source);
  }

  function addRule(): void {
    const source = freeSources.find((entry) => entry.entityId === addSource) ?? freeSources[0];
    if (!source) return;
    notificationRules.add(ruleFromSource(category, source));
    addSource = '';
  }

  async function test(): Promise<void> {
    if (testBusy) return;
    testBusy = true;
    const id = testNotificationIdFor(selected);
    const title = m.settings_notifications_test_title();
    const message = m.settings_notifications_test_message({ category: category.label });
    try {
      const delivered = await runtime.createPersistentNotification(id, title, message);
      if (!delivered) {
        notifications.pushLocal({
          id, source: 'test', sourceLabel: m.notif_source_test(), type: activeColor, title, message,
          icon: category.icon, priority: 40, createdAt: Date.now(), dedupeKey: id,
        });
      }
    } finally {
      testBusy = false;
    }
  }

  async function toggleHistory(): Promise<void> {
    historyOpen = !historyOpen;
    if (!historyOpen || history !== undefined || historyLoading) return;
    historyLoading = true;
    try {
      history = await runtime.getNotificationHistory(Date.now() - 7 * 86_400_000);
    } catch {
      history = null;
    } finally {
      historyLoading = false;
    }
  }

  const statusText = $derived.by(() => {
    const status = notificationRules.status;
    switch (status.kind) {
      case 'saving': return m.settings_notifications_saving();
      case 'saved': return m.settings_notifications_saved({
        created: status.created, updated: status.updated, deleted: status.deleted,
      });
      case 'ha-error': return m.settings_notifications_error_ha({ reason: status.message });
      case 'error': return status.reason === 'invalid'
        ? m.settings_notifications_error_invalid()
        : m.settings_notifications_error_save();
      default: return notificationRules.dirty
        ? m.settings_notifications_unsaved()
        : m.settings_notifications_unchanged();
    }
  });
  const statusIsError = $derived(notificationRules.status.kind === 'error' || notificationRules.status.kind === 'ha-error');
</script>

{#snippet ruleCard(rule: NotificationRule)}
  <article class="notif-rule" class:is-off={!rule.enabled} aria-labelledby="notif-rule-{rule.id}">
    <header class="notif-rule-head">
      <span class="settings-icon-tile tint-warm notif-rule-icon"><Icon name={category.icon} cls="icon icon-sm" /></span>
      <div class="settings-row-text">
        <h4 id="notif-rule-{rule.id}" class="settings-row-label">{rule.name}</h4>
        <span class="settings-row-sub">{ruleHint(rule)}</span>
      </div>
      <label class="notif-switch">
        <span class="settings-row-sub">{m.settings_notifications_enabled()}</span>
        <button class="settings-switch pressable" type="button" role="switch"
                aria-label={`${rule.name}: ${m.settings_notifications_enabled()}`}
                aria-checked={rule.enabled}
                onclick={() => notificationRules.setEnabled(rule.id, !rule.enabled)}>
          <span class="settings-switch-knob"></span>
        </button>
      </label>
    </header>

    <div class="notif-field">
      <span class="settings-row-label">{m.settings_notifications_entity()}</span>
      {#if category.id === 'laundry'}
        <div class="notif-entity-static">
          <Icon name="i-home-assistant" cls="icon icon-sm" />
          <code>{rule.entityId}</code>
        </div>
      {:else}
        <select class="settings-input notif-select" value={rule.entityId}
                onchange={(event) => changeSource(rule, event.currentTarget.value)}>
          {#each sourceOptions(rule) as source (source.entityId)}
            <option value={source.entityId}>{source.name} · {source.entityId}</option>
          {/each}
        </select>
      {/if}
    </div>

    {#if category.id === 'laundry'}
      <div class="notif-field">
        <span class="settings-row-label">{m.settings_notifications_setup_mode()}</span>
        <span class="settings-row-sub">
          {laundryMode(rule) === 'blueprint'
            ? m.settings_laundry_blueprint_mode()
            : m.settings_laundry_existing_mode()}
        </span>
      </div>
    {/if}

    <div class="notif-field">
      <span class="settings-row-label">{m.settings_notifications_states()}</span>
      <div class="settings-chips">
        {#each rule.triggers as trigger (trigger.key)}
          <button class="settings-chip notif-chip pressable" class:is-on={trigger.enabled}
                  class:is-timed={trigger.delayMinutes > 0} type="button" aria-pressed={trigger.enabled}
                  onclick={() => notificationRules.setTriggerEnabled(rule.id, trigger.key, !trigger.enabled)}>
            <span class="notif-chip-dot" aria-hidden="true"></span>
            <span>
              {trigger.label}
              {#if trigger.delayMinutes > 0}
                · {m.notif_minutes_short({ minutes: trigger.delayMinutes })}
              {/if}
            </span>
            <span class="notif-chip-state num">{trigger.enabled ? 'on' : 'off'}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if numeric(rule).length}
      <div class="notif-inline-grid">
        {#each numeric(rule) as trigger (trigger.key)}
          <label class="notif-field">
            <span class="settings-row-label">{trigger.label} · {m.settings_notifications_threshold()}</span>
            <span class="notif-threshold">
              <input class="settings-input num" type="number" step="any" value={trigger.value}
                     oninput={(event) => notificationRules.setThreshold(rule.id, trigger.key, event.currentTarget.valueAsNumber)} />
              {#if unitFor(rule)}<span class="notif-unit">{unitFor(rule)}</span>{/if}
            </span>
          </label>
        {/each}
      </div>
    {/if}

    {#if category.id === 'custom'}
      <label class="notif-field">
        <span class="settings-row-label">{m.settings_notifications_custom_state()}</span>
        <input class="settings-input num" autocomplete="off" spellcheck="false"
               value={rule.triggers.find((trigger) => trigger.kind === 'state')?.to?.[0] ?? ''}
               onchange={(event) => notificationRules.setCustomState(rule.id, event.currentTarget.value)} />
      </label>
    {/if}

    <div class="notif-rule-foot">
      {#if delayed(rule).length}
        <label class="notif-delay">
          <Icon name="i-clock-outline" cls="icon icon-sm" />
          <span class="settings-row-sub">{m.settings_notifications_delay()}</span>
          <select class="settings-input notif-select num" value={delayed(rule)[0].delayMinutes}
                  onchange={(event) => notificationRules.setDelay(rule.id, Number(event.currentTarget.value))}>
            {#each NOTIFICATION_DELAY_OPTIONS as minutes (minutes)}
              <option value={minutes}>{m.notif_minutes_short({ minutes })}</option>
            {/each}
          </select>
        </label>
      {/if}
      {#if category.userRules}
        <button class="secondary-btn pressable notif-remove" type="button" onclick={() => notificationRules.remove(rule.id)}>
          <Icon name="i-close" cls="icon icon-sm" />
          {m.settings_notifications_remove_rule()}
        </button>
      {/if}
    </div>
  </article>
{/snippet}

<section data-setting-id="notifications" aria-labelledby="settings-notifications-title">
  <span id="settings-notifications-title" hidden>{m.settings_section_notifications_label()}</span>

  <div class="notif-grid" role="tablist" aria-label={m.settings_section_notifications_label()}>
    {#each NOTIFICATION_CATEGORIES as entry (entry.id)}
      <button class="notif-cat pressable" class:is-active={entry.id === selected} type="button" role="tab"
              aria-selected={entry.id === selected} onclick={() => select(entry.id)}>
        <span class="settings-icon-tile tint-warm"><Icon name={entry.icon} cls="icon icon-md" /></span>
        <span class="notif-cat-text">
          <strong>{entry.label}</strong>
          <span>{entry.description}</span>
        </span>
        <span class="notif-badge" class:is-on={activeRuleCount(notificationRules.draft, entry.id) > 0}>
          {countLabel(entry.id)}
        </span>
      </button>
    {/each}
  </div>

  <div class="settings-group notif-detail" role="tabpanel">
    <header class="notif-detail-head">
      <SettingsCardHead icon={category.icon} tint="warm" title={category.label} sub={category.description} />
      <div class="notif-detail-actions">
        <button class="primary-btn pressable" type="button" disabled={testBusy} onclick={() => void test()}>
          <Icon name="i-send" cls="icon icon-sm" />
          {m.settings_notifications_test()}
        </button>
        <button class="secondary-btn pressable notif-toggle" type="button" aria-expanded={expanded}
                aria-label={expanded ? m.settings_notifications_collapse() : m.settings_notifications_expand()}
                onclick={() => (expanded = !expanded)}>
          <Icon name={expanded ? 'i-chevron-up' : 'i-chevron-down'} cls="icon icon-sm" />
        </button>
      </div>
    </header>

    {#if expanded}
      <div class="notif-field notif-colors">
        <span class="settings-row-label">{m.settings_notifications_color()}</span>
        <span class="settings-row-sub">{m.settings_notifications_color_hint()}</span>
        <div class="settings-chips" role="radiogroup" aria-label={m.settings_notifications_color()}>
          {#each NOTIFICATION_COLORS as color (color)}
            <button class="settings-chip notif-swatch pressable" type="button" role="radio"
                    class:is-on={activeColor === color}
                    aria-checked={activeColor === color}
                    onclick={() => notificationRules.setColor(selected, color)}>
              <span class="notif-swatch-dot is-{color}" aria-hidden="true"></span>
              <span>{colorLabel(color)}</span>
            </button>
          {/each}
        </div>
      </div>

      {#if rules.length === 0}
        <p class="settings-form-msg">
          {category.id === 'laundry' ? m.settings_notifications_laundry_missing() : m.settings_notifications_no_rules()}
        </p>
      {/if}
      <div class="notif-rules">
        {#each rules as rule (rule.id)}
          {@render ruleCard(rule)}
        {/each}
      </div>

      {#if category.id === 'laundry'}
        <!-- Die Wäsche-Einrichtung wohnt hier, seit die eigene Sektion entfallen
             ist: Entität, Blueprint und Vorschau gehören zu diesen Regeln. -->
        <div class="notif-setup">
          <h4 class="settings-row-label">{m.settings_notifications_laundry_setup()}</h4>
          <LaundrySection embedded />
        </div>
      {/if}

      {#if category.userRules}
        {#if freeSources.length}
          <div class="notif-add">
            <select class="settings-input notif-select" bind:value={addSource} aria-label={m.settings_notifications_entity()}>
              <option value="">{m.settings_notifications_entity_placeholder()}</option>
              {#each freeSources as source (source.entityId)}
                <option value={source.entityId}>{source.name} · {source.entityId}</option>
              {/each}
            </select>
            <button class="secondary-btn pressable" type="button" onclick={addRule}>
              <Icon name="i-plus" cls="icon icon-sm" />
              {m.settings_notifications_add_rule()}
            </button>
          </div>
        {:else if rules.length > 0 || sources.length === 0}
          <p class="settings-form-msg">{m.settings_notifications_no_sources()}</p>
        {/if}
      {/if}
    {/if}

    <footer class="notif-foot">
      <div class="notif-legend">
        <span><span class="notif-chip-dot is-change" aria-hidden="true"></span>{m.settings_notifications_legend_change()}</span>
        <span><span class="notif-chip-dot is-timed" aria-hidden="true"></span>{m.settings_notifications_legend_timed()}</span>
      </div>
      <div class="notif-save">
        <span class="settings-row-sub" class:is-error={statusIsError} role="status">{statusText}</span>
        <button class="primary-btn pressable" type="button"
                disabled={!notificationRules.dirty || notificationRules.status.kind === 'saving'}
                onclick={() => void notificationRules.save()}>
          <Icon name="i-content-save" cls="icon icon-sm" />
          {m.settings_notifications_save()}
        </button>
      </div>
    </footer>
    {#if IS_DEMO}
      <p class="settings-form-msg">{m.settings_notifications_demo()}</p>
    {/if}
  </div>

  <!-- Verlauf unterhalb der Regeln: nachschlagen, nicht konfigurieren. -->
  <div class="settings-group notif-history" data-setting-id="notifications-history">
    <div class="notif-top">
      <p class="settings-form-msg notif-top-hint">{m.settings_notifications_history_hint()}</p>
      <button class="secondary-btn pressable" type="button"
              aria-expanded={historyOpen} onclick={() => void toggleHistory()}>
        <Icon name="i-history" cls="icon icon-sm" />
        {m.settings_notifications_history()}
      </button>
    </div>
    {#if historyOpen}
      <div class="notif-history-body" role="region" aria-label={m.settings_notifications_history()}>
      {#if historyLoading}
        <p class="settings-form-msg" role="status">…</p>
      {:else if history === null}
        <p class="settings-form-msg">{m.settings_notifications_history_unavailable()}</p>
      {:else if !history || history.length === 0}
        <p class="settings-form-msg">{m.settings_notifications_history_empty()}</p>
      {:else}
        <ul class="notif-history-list">
          {#each history as entry (entry.when + entry.entityId)}
            <li>
              <span class="notif-history-when num">{dateFormat.format(entry.when)}</span>
              <span class="notif-history-name">{entry.name}</span>
              <span class="settings-row-sub">{entry.message}</span>
            </li>
          {/each}
        </ul>
      {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .notif-top,
  .notif-detail-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  /* `.settings-group` ist eine Flex-Spalte; die Kopfzeile des Verlaufs
     braucht deshalb explizit die Zeilenrichtung. */
  .notif-top {
    flex-direction: row;
    align-items: center;
  }

  .notif-top-hint {
    flex: 1 1 auto;
    min-width: 12rem;
    margin: 0;
  }

  .notif-detail-actions,
  .notif-add,
  .notif-save,
  .notif-delay,
  .notif-switch,
  .notif-threshold,
  .notif-entity-static {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .notif-history {
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
  }

  .notif-history-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .notif-history-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .notif-history-list li {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 var(--space-3);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--color-border);
  }

  .notif-history-list li .settings-row-sub { grid-column: 2; }
  .notif-history-when { color: var(--color-text-secondary); font-size: var(--text-sm); }
  .notif-history-name { font-weight: 600; }

  .notif-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }

  .notif-cat {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    min-height: var(--touch-min);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    text-align: left;
  }

  .notif-cat.is-active {
    border-color: var(--color-accent-warm);
    box-shadow: 0 0 0 1px var(--color-accent-warm) inset;
  }

  .notif-cat-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .notif-cat-text span {
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .notif-badge {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .notif-badge.is-on {
    border-color: color-mix(in srgb, var(--color-accent-warm) 40%, transparent);
    background: color-mix(in srgb, var(--color-accent-warm) 12%, transparent);
    color: var(--color-accent-warm);
  }

  /* `.settings-group` bringt bewusst kein Innenmaß mit — sonst sitzt jede Zeile
     doppelt eingerückt. Hier tragen die Kinder aber keines, also übernimmt es
     die Gruppe und der Kartenkopf gibt seines ab. */
  .notif-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
    padding: var(--space-4) var(--space-5) var(--space-5);
  }

  .notif-detail-head :global(.settings-card-head) { padding: 0; }

  .notif-toggle { padding-inline: var(--space-3); }

  .notif-rules {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: var(--space-4);
  }

  .notif-rule {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
  }

  .notif-rule.is-off > :not(.notif-rule-head) { opacity: 0.55; }

  .notif-rule-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .notif-rule-head .settings-row-text { flex: 1 1 auto; min-width: 0; }
  .notif-rule-icon { flex: 0 0 auto; }

  .notif-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .notif-select { width: 100%; }
  .notif-add .notif-select { flex: 1 1 16rem; width: auto; }

  .notif-entity-static code {
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
  }

  .notif-colors .settings-row-sub { margin-bottom: var(--space-1); }

  .notif-swatch { cursor: pointer; }

  .notif-swatch.is-on {
    border-color: var(--color-text-secondary);
    box-shadow: 0 0 0 1px var(--color-text-secondary) inset;
  }

  /* Dieselben Token wie der Kachelrand, damit die Auswahl zeigt, was ankommt. */
  .notif-swatch-dot {
    width: var(--space-3);
    height: var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-text-secondary);
  }

  .notif-swatch-dot.is-info { background: var(--color-info); }
  .notif-swatch-dot.is-success { background: var(--color-success); }
  .notif-swatch-dot.is-warning { background: var(--color-warning); }
  .notif-swatch-dot.is-critical { background: var(--color-error); }

  .notif-setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }

  .notif-setup h4 { margin: 0; }

  .notif-chip { cursor: pointer; }

  .notif-chip.is-on {
    border-color: color-mix(in srgb, var(--color-accent-warm) 45%, transparent);
    background: color-mix(in srgb, var(--color-accent-warm) 12%, transparent);
  }

  .notif-chip-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    margin-right: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-text-secondary);
  }

  .notif-chip.is-on .notif-chip-dot,
  .notif-chip-dot.is-change { background: var(--color-success, #3a9d5d); }
  .notif-chip.is-timed .notif-chip-dot,
  .notif-chip-dot.is-timed { background: var(--color-accent-warm); }
  .notif-chip:not(.is-on) .notif-chip-dot { background: var(--color-text-secondary); opacity: 0.5; }

  .notif-chip-state {
    padding: 0 var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .notif-inline-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
  }

  .notif-threshold .settings-input { flex: 1 1 6rem; }
  .notif-unit { color: var(--color-text-secondary); font-size: var(--text-sm); }

  .notif-rule-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  .notif-delay .notif-select { width: auto; }

  .notif-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  .notif-legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  .notif-legend > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .notif-save .is-error { color: var(--color-danger, #c0392b); }

  .primary-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
