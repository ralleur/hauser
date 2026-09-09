<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Schnellzugriff der Telefonleiste einrichten (Long-Press auf den
     Urlaubsknopf, analog CentralClimateEdit). Zwei Entscheidungen, in der
     Reihenfolge, in der sie zusammenhängen: erst das Gerät, dann sein Symbol —
     das Symbol schlägt sich aus dem Gerät vor und wird nur überschrieben, wenn
     der Nutzer das ausdrücklich will. */
  import Icon from './Icon.svelte';
  import { deviceManager } from '../state/device-manager.svelte.ts';
  import {
    phoneActionEdit,
    closePhoneActionEdit,
    finishPhoneActionEditClose,
  } from '../state/overlay.svelte.ts';
  import {
    PHONE_ACTION_DOMAINS,
    phoneActionConfig,
    phoneActionIcon,
    setPhoneActionEntity,
    setPhoneActionIcon,
    suggestedPhoneActionIcon,
  } from '../state/phone-action.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  const allowed = new Set<string>(PHONE_ACTION_DOMAINS);

  /* Nach Bereich gruppiert, innerhalb alphabetisch: dieselbe Ordnung, in der
     der Nutzer seine Wohnung denkt. Geräte ohne Bereich sammeln sich zuletzt. */
  const groups = $derived.by(() => {
    const byArea = new Map<string, { entityId: string; name: string }[]>();
    for (const item of deviceManager.catalog) {
      if (!allowed.has(item.domain)) continue;
      const area = item.area ?? '';
      const list = byArea.get(area) ?? [];
      list.push({ entityId: item.entityId, name: item.name });
      byArea.set(area, list);
    }
    return [...byArea.entries()]
      .map(([area, items]) => ({
        area,
        items: items.sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => (
        left.area === '' ? 1 : right.area === '' ? -1 : left.area.localeCompare(right.area)
      ));
  });

  const currentIcon = $derived(phoneActionIcon());
  const usesOwnIcon = $derived(phoneActionConfig.icon !== null);

  let pickerOpen = $state(false);
  let IconPickerComponent = $state<typeof import('./IconPicker.svelte').default | null>(null);

  async function openPicker(): Promise<void> {
    IconPickerComponent ??= (await import('./IconPicker.svelte')).default;
    pickerOpen = true;
  }

  function chooseIcon(id: string): void {
    setPhoneActionIcon(id);
    void import('../state/icon-recents.ts').then(({ rememberRecentIcon }) => rememberRecentIcon(id));
    pickerOpen = false;
  }

  function resetIcon(): void {
    setPhoneActionIcon(null);
    pickerOpen = false;
  }

  // animationend-Fallback (deckt prefers-reduced-motion: 0ms ab)
  $effect(() => {
    if (phoneActionEdit.mode !== 'closing') return;
    const t = setTimeout(finishPhoneActionEditClose, 250);
    return () => clearTimeout(t);
  });

  // Initial-Fokus beim Öffnen (A11y): einmal auf das Panel.
  let panelEl = $state<HTMLElement>();
  $effect(() => {
    if (phoneActionEdit.mode === 'open' && panelEl) panelEl.focus();
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (pickerOpen) { pickerOpen = false; return; }
    if (phoneActionEdit.mode === 'open') closePhoneActionEdit();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="room-edit phone-action-edit" class:is-open={phoneActionEdit.mode === 'open'}
     class:is-closing={phoneActionEdit.mode === 'closing'} hidden={phoneActionEdit.mode === 'hidden'}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions
       — Scrim ist bewusst kein Button (Tap außerhalb schließt, docs/07) -->
  <div class="overlay-scrim" onclick={() => closePhoneActionEdit()}></div>
  <div class="room-edit-panel overlay-panel" role="dialog" aria-modal="true"
       aria-label={m.phone_action_title()} tabindex="-1" bind:this={panelEl}
       onanimationend={(e) => { if (phoneActionEdit.mode === 'closing' && e.target === e.currentTarget) finishPhoneActionEditClose(); }}>
    <header class="ld-header">
      <h2 class="ld-title">{m.phone_action_title()}</h2>
      <button class="ld-close pressable" type="button" aria-label={m.common_close()}
              onclick={() => closePhoneActionEdit()}>×</button>
    </header>

    <div class="ld-body">
      <p class="pae-intro">{m.phone_action_desc()}</p>

      <div class="pae-card">
        <label class="pae-field">
          <span class="caps-label">{m.phone_action_device()}</span>
          <select class="pae-select" value={phoneActionConfig.entityId ?? ''}
                  onchange={(event) => setPhoneActionEntity(event.currentTarget.value || null)}>
            <option value="">{m.phone_action_device_default()}</option>
            {#if phoneActionConfig.entityId && !deviceManager.catalog.some((item) => item.entityId === phoneActionConfig.entityId)}
              <option value={phoneActionConfig.entityId}>{phoneActionConfig.entityId}</option>
            {/if}
            {#each groups as group (group.area)}
              <optgroup label={group.area === '' ? m.phone_action_area_none() : group.area}>
                {#each group.items as item (item.entityId)}
                  <option value={item.entityId}>{item.name}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
        </label>

        <div class="pae-field">
          <span class="caps-label">{m.phone_action_icon()}</span>
          <div class="pae-icon-row">
            <span class="pae-icon-preview" aria-hidden="true">
              <Icon name={currentIcon} cls="icon icon-md" />
            </span>
            <button class="pae-button pressable" type="button" onclick={openPicker}>
              {m.phone_action_icon_choose()}
            </button>
          </div>
          <span class="pae-icon-state">
            {usesOwnIcon ? m.phone_action_icon_own() : m.phone_action_icon_suggested()}
          </span>
          {#if usesOwnIcon}
            <button class="pae-reset pressable" type="button" onclick={resetIcon}>
              {m.phone_action_icon_reset()}
            </button>
          {/if}
        </div>
      </div>

      <p class="pae-note">
        {phoneActionConfig.entityId ? m.phone_action_note_device() : m.phone_action_note_default()}
      </p>
    </div>
  </div>
</div>

<!-- Bewusst außerhalb des animierten Panels: ein position:fixed-Kind darin
     hinge an dessen Containing Block. Der Picker ist ein eigenes Modal. -->
{#if pickerOpen && IconPickerComponent}
  {@const Picker = IconPickerComponent}
  <Picker currentIcon={currentIcon} onSelect={chooseIcon} onReset={resetIcon}
          onClose={() => (pickerOpen = false)} />
{/if}

<style>
  .pae-intro {
    margin: 0 0 var(--space-4);
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  /* Eine Karte, zwei Felder in der Reihenfolge ihrer Abhängigkeit — dasselbe
     Maß wie die Klimakarte, damit beide Overlays gleich sitzen. */
  .pae-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-0);
  }

  .pae-field {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
    min-width: 0;
  }

  .pae-select {
    min-height: var(--touch-min);
    min-width: 0;
    max-width: 100%;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
  }

  /* Symbol links, Wahl rechts, der Zustand als eigene Zeile darunter: auf
     390 px bleibt so jedes Wort ganz, statt in drei Zeilen zu zerfallen. */
  .pae-icon-row {
    display: grid;
    grid-template-columns: auto auto;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }

  .pae-icon-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--touch-min);
    height: var(--touch-min);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
  }

  /* Auf 390 px teilen sich Vorschau, Zustand und Knopf eine Zeile — der
     Zustand ist der einzige Teil, der umbrechen darf. Abschneiden käme hier
     einer Lüge gleich: „Vorschlag" und „Eigenes Symbol" beginnen verschieden,
     enden aber beide im Nichts. */
  .pae-icon-state {
    min-width: 0;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .pae-button,
  .pae-reset {
    min-height: var(--touch-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font: inherit;
  }

  .pae-reset {
    justify-self: start;
    background: none;
    color: var(--color-text-secondary);
  }

  .pae-note {
    margin: var(--space-4) 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }
</style>
