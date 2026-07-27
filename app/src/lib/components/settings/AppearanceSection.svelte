<script lang="ts">
  /* ── Darstellung · Erscheinungsbild ── */
  import Icon from '../Icon.svelte';
  import { setThemeMode, themeMode, themeOverrideUntil } from '../../state/theme.svelte.ts';
  import { AVAILABLE_LOCALES, changeLocale, localeLabel, localeState } from '../../state/locale.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const mode = $derived(themeMode());

  const THEME_MODES = [
    { id: 'auto', label: m.sys_automatic(), icon: 'i-brightness-auto' },
    { id: 'light', label: m.sys_light(), icon: 'i-white-balance-sunny' },
    { id: 'dark', label: m.sys_dark(), icon: 'i-weather-night' },
  ] as const;

  function fmtUntil(ts: number): string {
    const d = new Date(ts);
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${d.getDate() !== new Date().getDate() ? 'morgen ' : ''}${time} Uhr`;
  }
</script>

<div class="settings-group">
  <div class="settings-row is-stacked" data-setting-id="theme-mode">
    <div class="settings-row-text">
      <span class="settings-row-label">{m.appearance_title()}</span>
      <span class="settings-row-sub">{m.appearance_hint()}</span>
    </div>
    <div class="settings-seg" role="radiogroup" aria-label={m.appearance_title()}>
      {#each THEME_MODES as themeOption (themeOption.id)}
        <button class="settings-seg-btn pressable" type="button" role="radio"
                aria-checked={mode === themeOption.id}
                class:is-active={mode === themeOption.id}
                onclick={() => setThemeMode(themeOption.id)}>
          <Icon name={themeOption.icon} cls="icon icon-sm" />{themeOption.label}
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
{#if mode !== 'auto'}
  <p class="settings-note">{m.appearance_manual_note({ until: fmtUntil(themeOverrideUntil()) })}</p>
{/if}
