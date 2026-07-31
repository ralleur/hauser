<script lang="ts">
  /* ── Darstellung · Erscheinungsbild ── */
  import Icon from '../Icon.svelte';
  import { appearanceMode, setAppearanceMode } from '../../state/theme.svelte.ts';
  import type { AppearanceMode } from '../../state/appearance-mode.ts';
  import { AVAILABLE_LOCALES, changeLocale, localeLabel, localeState } from '../../state/locale.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const mode = $derived(appearanceMode());
  const APPEARANCE_MODES: AppearanceMode[] = [
    'auto', 'interface-light', 'interface-dark', 'fixed-light', 'fixed-dark',
  ];

  function labelForMode(value: AppearanceMode): string {
    if (value === 'auto') return m.appearance_mode_auto();
    if (value === 'interface-light') return m.appearance_mode_interface_light();
    if (value === 'interface-dark') return m.appearance_mode_interface_dark();
    if (value === 'fixed-light') return m.appearance_mode_fixed_day();
    return m.appearance_mode_fixed_evening();
  }

  function iconForMode(value: AppearanceMode): string {
    if (value === 'auto') return 'i-brightness-auto';
    return value === 'interface-light' || value === 'fixed-light'
      ? 'i-white-balance-sunny'
      : 'i-weather-night';
  }

  function isFixed(value: AppearanceMode): boolean {
    return value === 'fixed-light' || value === 'fixed-dark';
  }
</script>

<div class="settings-group">
  <div class="settings-row is-stacked" data-setting-id="theme-mode">
    <div class="settings-row-text">
      <span class="settings-row-label">{m.appearance_title()}</span>
      <span class="settings-row-sub">{m.appearance_hint()}</span>
    </div>
    <div class="settings-seg appearance-mode-seg" role="radiogroup" aria-label={m.appearance_title()}>
      {#each APPEARANCE_MODES as appearanceOption (appearanceOption)}
        <button class="settings-seg-btn pressable" type="button" role="radio"
                aria-checked={mode === appearanceOption}
                class:is-active={mode === appearanceOption}
                onclick={() => setAppearanceMode(appearanceOption)}>
          <Icon name={iconForMode(appearanceOption)} cls="icon icon-sm" />
          {#if isFixed(appearanceOption)}
            <Icon name="i-lock" cls="icon icon-sm" />
          {/if}
          {labelForMode(appearanceOption)}
        </button>
      {/each}
    </div>
  </div>

  <div class="settings-row is-stacked" data-setting-id="ui-language">
    <div class="settings-row-text">
      <span class="settings-row-label">{m.language_setting()}</span>
      <span class="settings-row-sub">{m.language_setting_hint()}</span>
    </div>
    <div class="settings-seg" role="radiogroup" aria-label={m.language_setting()}>
      {#each AVAILABLE_LOCALES as loc (loc)}
        <button class="settings-seg-btn pressable" type="button" role="radio"
                aria-checked={localeState.current === loc}
                class:is-active={localeState.current === loc}
                onclick={() => changeLocale(loc)}>{localeLabel(loc)}</button>
      {/each}
    </div>
  </div>
</div>
