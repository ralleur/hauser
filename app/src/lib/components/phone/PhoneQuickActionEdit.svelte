<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Bearbeitungsblatt eines eigenen Schnellaktions-Knopfs (wie die iOS-App):
     Name, Zeichen und was ein Tipp auslöst — Szenen, Geräte aus beliebigen
     Räumen und den Urlaubsmodus, der Reihe nach. Jede Änderung gilt sofort. */
  import Icon from '../Icon.svelte';
  import { appState } from '../../state/app.svelte.ts';
  import { VACATION_MODE_ENTITY } from '../../state/entities.ts';
  import { PHONE_ACTION_DOMAINS } from '../../state/phone-action.svelte.ts';
  import { scenes } from '../../state/scene-manager.svelte.ts';
  import {
    QUICK_ICONS, QUICK_NAME_MAX, quickBarItems, quickEdit, removeQuickItem, updateQuickItem,
    type QuickStep, type QuickStepMode,
  } from '../../state/phone-quick-bar.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const item = $derived(quickBarItems().find((entry) => entry.id === quickEdit.id) ?? null);
  let adding = $state<'scenes' | 'devices'>('scenes');
  let query = $state('');
  let dialog = $state<HTMLElement>();
  $effect(() => { dialog?.focus(); });

  function close(): void { quickEdit.id = null; }
  function onScrim(event: MouseEvent) { if (event.target === event.currentTarget) close(); }
  function onKeydown(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); close(); } }

  function update(change: (steps: QuickStep[]) => QuickStep[]): void {
    if (!item) return;
    updateQuickItem(item.id, (entry) => ({ ...entry, steps: change(entry.steps) }));
  }
  const stepKey = (step: QuickStep) => [step.kind, step.roomId ?? '', step.sceneId ?? '', step.entityId ?? ''].join('|');
  const has = (step: QuickStep) => item?.steps.some((existing) => stepKey(existing) === stepKey(step)) ?? false;
  function add(step: QuickStep): void { if (!has(step)) update((steps) => [...steps, step]); }
  function remove(step: QuickStep): void { update((steps) => steps.filter((existing) => stepKey(existing) !== stepKey(step))); }
  const NEXT_MODE: Record<QuickStepMode, QuickStepMode> = { toggle: 'on', on: 'off', off: 'toggle' };
  function cycle(step: QuickStep): void {
    update((steps) => steps.map((existing) => (stepKey(existing) === stepKey(step) ? { ...existing, mode: NEXT_MODE[existing.mode] } : existing)));
  }
  const modeLabel = (mode: QuickStepMode) => (mode === 'on' ? m.quick_mode_on() : mode === 'off' ? m.quick_mode_off() : m.quick_mode_toggle());

  /* Ein Schritt in Worten: Name und wo er hingehört. */
  function label(step: QuickStep): { name: string; meta: string; icon: string } | null {
    if (step.kind === 'vacation') return { name: m.quick_vacation(), meta: m.quick_household(), icon: 'i-umbrella-beach' };
    if (step.kind === 'scene') {
      const room = appState.rooms.find((entry) => entry.id === step.roomId);
      const scene = room ? scenes(room.id).find((entry) => entry.id === step.sceneId) : undefined;
      return room && scene ? { name: scene.label, meta: m.quick_scene_meta({ room: room.name }), icon: 'i-creation' } : null;
    }
    for (const room of appState.rooms) {
      const device = room.lights.find((light) => light.entityId === step.entityId);
      if (device) return { name: device.name, meta: room.name, icon: device.icon ?? 'i-power' };
    }
    return null;
  }

  const sceneOptions = $derived(appState.rooms.flatMap((room) => scenes(room.id).map((scene) => ({
    step: { kind: 'scene', roomId: room.id, sceneId: scene.id, mode: 'toggle' } as QuickStep,
    name: scene.label,
    meta: room.name,
  }))));
  const deviceOptions = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    return appState.rooms.flatMap((room) => room.lights
      .filter((light) => PHONE_ACTION_DOMAINS.includes((light.domain ?? light.entityId.split('.')[0]) as never))
      .filter((light) => !needle || light.name.toLocaleLowerCase().includes(needle) || room.name.toLocaleLowerCase().includes(needle))
      .map((light) => ({
        step: { kind: 'device', entityId: light.entityId, mode: 'toggle' } as QuickStep,
        name: light.name,
        meta: room.name,
        icon: light.icon ?? 'i-power',
      })))
      .filter((option, index, all) => all.findIndex((other) => other.step.entityId === option.step.entityId) === index)
      .slice(0, 40);
  });
</script>

{#if item}
  <div class="more-sheet-scrim pqe-scrim" role="presentation" onclick={onScrim}>
    <div class="more-sheet pqe" role="dialog" aria-modal="true" aria-label={item.name || m.quick_action()}
         tabindex="-1" bind:this={dialog} onkeydown={onKeydown}>
      <header>
        <div class="more-sheet-heading"><h2>{item.name || m.quick_action()}</h2></div>
        <div class="more-sheet-header-actions">
          <button class="more-sheet-action pressable" type="button" aria-label={m.common_close()} onclick={close}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19" /></svg>
          </button>
        </div>
      </header>

      <section class="pqe-section">
        <span class="caps-label">{m.quick_name()}</span>
        <input class="pqe-input" type="text" maxlength={QUICK_NAME_MAX} placeholder={m.quick_name_placeholder()}
               value={item.name} autocomplete="off" spellcheck="false"
               oninput={(event) => updateQuickItem(item.id, (entry) => ({ ...entry, name: event.currentTarget.value.slice(0, QUICK_NAME_MAX) }))} />
        <p class="pqe-hint">{m.quick_name_hint()}</p>
      </section>

      <section class="pqe-section">
        <span class="caps-label">{m.quick_icon()}</span>
        <div class="pqe-icons" role="radiogroup" aria-label={m.quick_icon()}>
          {#each QUICK_ICONS as icon (icon)}
            <button class="pqe-icon pressable" type="button" role="radio" aria-checked={item.icon === icon} aria-label={icon.slice(2)}
                    onclick={() => updateQuickItem(item.id, (entry) => ({ ...entry, icon }))}>
              <Icon name={icon} cls="icon icon-md" />
            </button>
          {/each}
        </div>
      </section>

      <section class="pqe-section">
        <span class="caps-label">{m.quick_triggers()}</span>
        {#if item.steps.length === 0}
          <p class="pqe-hint">{m.quick_triggers_empty()}</p>
        {:else}
          <ul class="pqe-list">
            {#each item.steps as step (stepKey(step))}
              {@const text = label(step)}
              <li class="pqe-row">
                <span class="pqe-row-icon" aria-hidden="true"><Icon name={text?.icon ?? 'i-help'} cls="icon icon-md" /></span>
                <span class="pqe-row-label">
                  <span class="pqe-row-name">{text?.name ?? m.quick_gone()}</span>
                  {#if text}<small>{text.meta}</small>{/if}
                </span>
                {#if step.kind === 'device'}
                  <button class="pqe-mode pressable" type="button" aria-label={m.quick_mode_label({ mode: modeLabel(step.mode) })}
                          onclick={() => cycle(step)}>{modeLabel(step.mode)}</button>
                {/if}
                <button class="pqe-remove pressable" type="button" aria-label={m.quick_remove()} onclick={() => remove(step)}>
                  <Icon name="i-minus" cls="icon icon-sm" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="pqe-section">
        <span class="caps-label">{m.quick_add()}</span>
        <div class="pls-pill" role="radiogroup" aria-label={m.quick_add()}>
          <button class="pls-seg pressable" type="button" role="radio" aria-checked={adding === 'scenes'} onclick={() => (adding = 'scenes')}>{m.quick_scenes()}</button>
          <button class="pls-seg pressable" type="button" role="radio" aria-checked={adding === 'devices'} onclick={() => (adding = 'devices')}>{m.quick_devices()}</button>
        </div>
        {#if adding === 'devices'}
          <input class="pqe-input" type="search" placeholder={m.quick_search()} bind:value={query} autocomplete="off" spellcheck="false" />
        {/if}
        <ul class="pqe-list">
          {#if adding === 'scenes'}
            {#if VACATION_MODE_ENTITY}
              {@const vacation = { kind: 'vacation', mode: 'toggle' } as QuickStep}
              <li><button class="pqe-row is-option pressable" type="button" disabled={has(vacation)} onclick={() => add(vacation)}>
                <span class="pqe-row-icon" aria-hidden="true"><Icon name="i-umbrella-beach" cls="icon icon-md" /></span>
                <span class="pqe-row-label"><span class="pqe-row-name">{m.quick_vacation()}</span><small>{m.quick_household()}</small></span>
                <Icon name={has(vacation) ? 'i-check' : 'i-plus'} cls="icon icon-sm" />
              </button></li>
            {/if}
            {#each sceneOptions as option (stepKey(option.step))}
              <li><button class="pqe-row is-option pressable" type="button" disabled={has(option.step)} onclick={() => add(option.step)}>
                <span class="pqe-row-icon" aria-hidden="true"><Icon name="i-creation" cls="icon icon-md" /></span>
                <span class="pqe-row-label"><span class="pqe-row-name">{option.name}</span><small>{option.meta}</small></span>
                <Icon name={has(option.step) ? 'i-check' : 'i-plus'} cls="icon icon-sm" />
              </button></li>
            {/each}
          {:else}
            {#each deviceOptions as option (stepKey(option.step))}
              <li><button class="pqe-row is-option pressable" type="button" disabled={has(option.step)} onclick={() => add(option.step)}>
                <span class="pqe-row-icon" aria-hidden="true"><Icon name={option.icon} cls="icon icon-md" /></span>
                <span class="pqe-row-label"><span class="pqe-row-name">{option.name}</span><small>{option.meta}</small></span>
                <Icon name={has(option.step) ? 'i-check' : 'i-plus'} cls="icon icon-sm" />
              </button></li>
            {/each}
          {/if}
        </ul>
      </section>

      <button class="pqe-delete pressable" type="button" onclick={() => { removeQuickItem(item.id); close(); }}>{m.quick_remove()}</button>
    </div>
  </div>
{/if}

<style>
  /* Über dem Layout-Blatt, aus dem es geöffnet wird. */
  .pqe-scrim { z-index: 5; }
  .pqe { display: flex; flex-direction: column; gap: var(--space-4); }
  .pqe-section { display: flex; flex-direction: column; gap: var(--space-2); }
  .pqe-input {
    min-height: var(--touch-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font: inherit;
  }
  .pqe-hint { margin: 0; font-size: var(--text-sm); color: var(--color-text-tertiary); }
  .pqe-icons { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-2); }
  .pqe-icon {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
  }
  .pqe-icon[aria-checked='true'] { background: var(--accent-light-on-fill); color: var(--accent-light-on-icon); border-color: transparent; }
  .pqe-list { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .pqe-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 56px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
  }
  .pqe-row.is-option:disabled { opacity: 0.55; }
  .pqe-row-icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--color-surface-3, var(--color-surface-1)); }
  .pqe-row-label { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pqe-row-name { overflow-wrap: anywhere; }
  .pqe-row-label small { font-size: var(--text-xs); color: var(--color-text-secondary); }
  .pqe-mode {
    flex: none;
    min-height: 34px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    color: var(--color-accent-warm);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
  }
  .pqe-remove {
    flex: none;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 1px solid color-mix(in srgb, var(--color-error) 50%, transparent);
    border-radius: 50%;
    color: var(--color-error);
  }
  .pqe-delete {
    min-height: var(--touch-min);
    border-radius: var(--radius-full);
    color: var(--color-error);
    font-weight: var(--font-weight-medium);
  }
</style>
