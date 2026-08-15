<script lang="ts">
  /* ── Darstellung · Erscheinungsbild & Sprache ──
     Referenzsektion für das Einstellungs-Muster: Karte mit Kopf (Icon-Kachel,
     Titel, Erklärzeile), darunter der Wähler.

     Zwei Wähler-Typen, bewusst unterschieden:
       · Auswahlkarten (.settings-options) für die Erscheinungsbild-Modi — sie
         brauchen je eine Erklärung, weil „UI dunkel“ und „Abend fix“ sonst
         nicht unterscheidbar sind.
       · Chips (.settings-chips) für Sprachen — der Wert erklärt sich selbst,
         und sechs Sprachen passen als Chips auch auf ein Phone. */
  import Icon from '../Icon.svelte';
  import SettingsCardHead from './SettingsCardHead.svelte';
  import { appearanceMode, setAppearanceMode } from '../../state/theme.svelte.ts';
  import type { AppearanceMode } from '../../state/appearance-mode.ts';
  import { AVAILABLE_LOCALES, changeLocale, localeLabel, localeState } from '../../state/locale.svelte.ts';
  import { m } from '../../../paraglide/messages.js';

  const mode = $derived(appearanceMode());

  /* Die beiden `fixed-*`-Modi koppeln Interface und Raumbilder dauerhaft an
     eine Tageszeit. Sie bleiben wählbar, treten aber als „erweitert“ zurück —
     wer sie nicht sucht, soll sie nicht mit „Hell“/„Dunkel“ verwechseln. */
  const APPEARANCE_MODES: readonly {
    id: AppearanceMode;
    icon: string;
    label: () => string;
    desc: () => string;
    advanced: boolean;
  }[] = [
    { id: 'auto', icon: 'i-brightness-auto', advanced: false,
      label: () => m.appearance_mode_auto(), desc: () => m.appearance_mode_auto_desc() },
    { id: 'interface-light', icon: 'i-white-balance-sunny', advanced: false,
      label: () => m.appearance_mode_interface_light(), desc: () => m.appearance_mode_interface_light_desc() },
    { id: 'interface-dark', icon: 'i-weather-night', advanced: false,
      label: () => m.appearance_mode_interface_dark(), desc: () => m.appearance_mode_interface_dark_desc() },
    /* Tageszeit-Glyph statt Schloss: zwei identische Schlösser wären nicht
       unterscheidbar. Das Schloss trägt die Ecke — es markiert „fixiert“, der
       Glyph sagt weiterhin, worauf fixiert wird. */
    { id: 'fixed-light', icon: 'i-white-balance-sunny', advanced: true,
      label: () => m.appearance_mode_fixed_day(), desc: () => m.appearance_mode_fixed_day_desc() },
    { id: 'fixed-dark', icon: 'i-weather-night', advanced: true,
      label: () => m.appearance_mode_fixed_evening(), desc: () => m.appearance_mode_fixed_evening_desc() },
  ];
</script>

<div class="settings-group" data-setting-id="theme-mode">
  <SettingsCardHead icon="i-palette" tint="warm"
                    title={m.appearance_title()} sub={m.appearance_hint()} />
  <div class="settings-row is-stacked">
    <div class="settings-options" role="radiogroup" aria-label={m.appearance_title()}>
      {#each APPEARANCE_MODES as option (option.id)}
        <button class="settings-option pressable" type="button" role="radio"
                aria-checked={mode === option.id}
                class:is-active={mode === option.id}
                class:is-advanced={option.advanced}
                onclick={() => setAppearanceMode(option.id)}>
          <span class="settings-option-glyph"><Icon name={option.icon} cls="icon" /></span>
          <span class="settings-option-label">{option.label()}</span>
          <span class="settings-option-desc">{option.desc()}</span>
          {#if mode === option.id}
            <span class="settings-option-check"><Icon name="i-check" cls="icon" /></span>
          {:else if option.advanced}
            <span class="settings-option-mark"><Icon name="i-lock" cls="icon" /></span>
          {/if}
        </button>
      {/each}
    </div>
  </div>
</div>

<div class="settings-group" data-setting-id="ui-language">
  <SettingsCardHead icon="i-translate" tint="cool"
                    title={m.language_setting()} sub={m.language_setting_hint()} />
  <div class="settings-row is-stacked">
    <div class="settings-chips" role="radiogroup" aria-label={m.language_setting()}>
      {#each AVAILABLE_LOCALES as loc (loc)}
        <button class="settings-chip pressable" type="button" role="radio"
                aria-checked={localeState.current === loc}
                class:is-active={localeState.current === loc}
                onclick={() => changeLocale(loc)}>
          {localeLabel(loc)}
          {#if localeState.current === loc}<Icon name="i-check" cls="icon" />{/if}
        </button>
      {/each}
    </div>
  </div>
</div>
