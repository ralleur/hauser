<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import Icon from '../Icon.svelte';
  import ClimatePill from '../ClimatePill.svelte';
  import { centralClimate } from '../../state/climate-central.svelte.ts';
  import {
    shouldConfirmHomeOff,
    switchableHomeEntityIds,
    turnOffHomeExceptBedroom,
  } from '../../state/commands.ts';
  import { longpress } from '../../actions/longpress.ts';
  import { whenEditable } from '../../state/edit-mode.svelte.ts';
  import {
    quickActionActive, quickBarItems, quickEdit, quickSpan, runQuickAction, type QuickItem,
  } from '../../state/phone-quick-bar.svelte.ts';
  import { fmtTemp } from '../../format.ts';
  import { offerUndo } from '../../state/undo.svelte.ts';
  import { createPhoneSettingsLoader } from '../../state/phone-lazy-loader.ts';
  import { m } from '../../../paraglide/messages.js';

  let { online }: { online: boolean } = $props();

  /* Die Leiste gehört dir (wie die iOS-App): vier Felder, belegt im
     Layout-Blatt; die Temperatur erscheint nur, wenn es etwas zu steuern gibt. */
  const items = $derived(quickBarItems().filter((item) =>
    (item.kind !== 'climate' && item.kind !== 'climateCompact') || centralClimate.hasClimate));

  function openEdit(item: QuickItem): void {
    quickEdit.id = item.id;
  }
  function onAction(item: QuickItem): void {
    if (item.steps.length === 0) { whenEditable(() => openEdit(item))(); return; }
    runQuickAction(item);
  }

  /* Die kompakte Temperatur zeigt den Hausdurchschnitt; ein Tipp legt die
     Pille mit Minus und Plus über die Leiste. */
  let compactOpen = $state(false);
  $effect(() => {
    if (!compactOpen) return;
    const timer = setTimeout(() => { compactOpen = false; }, 8000);
    return () => clearTimeout(timer);
  });
  const settingsLoader = createPhoneSettingsLoader();

  /* Der Befehl geht sofort raus; der Rückgängig-Streifen hält fünf Sekunden
     lang den Weg zurück offen (Paket 6). Die Rückfrage vor der eingestellten
     Uhrzeit bleibt — sie ist eine bewusste Sperre, kein Bestätigungsritual. */
  function homeOffWithUndo(): void {
    offerUndo({ kind: 'all-off' }, switchableHomeEntityIds(), turnOffHomeExceptBedroom);
  }

  function finishHomeOff(confirmBefore: string | null): void {
    if (shouldConfirmHomeOff(new Date(), confirmBefore)
      && !window.confirm(m.phone_off_confirm())) return;
    homeOffWithUndo();
  }

  function onHomeOff(): void {
    void settingsLoader.load('settings', ({ settingsValues }) => {
      finishHomeOff(settingsValues.offConfirmBefore);
    }).catch(() => {
      if (window.confirm(m.phone_off_confirm_nocfg())) homeOffWithUndo();
    });
  }
</script>

{#if items.length > 0}
  <div class="phone-quick-actions">
    {#each items as item (item.id)}
      {#if item.kind === 'off'}
        <button class="phone-quick-action is-off pressable" type="button" disabled={!online}
                aria-label={m.phone_all_off_label()} onclick={onHomeOff}>
          <!-- Nur das Zeichen, ohne Wort (Owner-Wunsch 2026-09-14); den Text trägt
               das aria-label. -->
          <Icon name="i-power" cls="icon icon-md" />
        </button>
      {:else if item.kind === 'climate'}
        <div class="phone-quick-slot" style:grid-column={`span ${quickSpan(item)}`}>
          <ClimatePill label={m.phone_climate_central()}
                       coolerLabel={m.phone_climate_colder()}
                       warmerLabel={m.phone_climate_warmer()}
                       {online} />
        </div>
      {:else if item.kind === 'climateCompact'}
        <div class="phone-quick-slot is-compact">
          {#if compactOpen}
            <div class="phone-quick-popover">
              <ClimatePill label={m.phone_climate_central()}
                           coolerLabel={m.phone_climate_colder()}
                           warmerLabel={m.phone_climate_warmer()}
                           {online} />
            </div>
          {/if}
          <button class="phone-quick-action is-compact pressable" type="button"
                  aria-label={m.quick_climate_compact()} aria-expanded={compactOpen}
                  onclick={() => { compactOpen = !compactOpen; }}>
            <Icon name="i-thermometer" cls="icon icon-md" />
            <span class="phone-quick-temp num">{centralClimate.currentValue === null ? '–' : `${fmtTemp(centralClimate.currentValue)}°`}</span>
          </button>
        </div>
      {:else}
        <button class="phone-quick-action is-custom pressable" type="button"
                class:is-active={quickActionActive(item)} class:is-empty={item.steps.length === 0}
                class:is-bare={!item.name} disabled={!online && item.steps.length > 0}
                aria-pressed={item.steps.length === 1 ? quickActionActive(item) : undefined}
                aria-label={item.name || m.quick_action()}
                use:longpress={{ onLongPress: whenEditable(() => openEdit(item)) }}
                onclick={() => onAction(item)}>
          <Icon name={item.steps.length === 0 ? 'i-plus' : item.icon} cls="icon icon-md" />
          {#if item.name}<span>{item.name}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}
