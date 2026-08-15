<script lang="ts">
  /* ── Sektionskopf einer Einstellungskarte ──
     Das Standardmuster für jede Gruppe im Detailbereich: getönte Icon-Kachel,
     Titel, optionale Erklärzeile — innerhalb der Karte, nicht als
     freistehendes caps-Label darüber.

     Der Tint folgt der Registry (SettingsTint), damit Sidebar-Kachel und
     Kartenkopf derselben Sektion dieselbe Farbe tragen. */
  import Icon from '../Icon.svelte';
  import type { SettingsTint } from '../../state/settings-registry.ts';

  let {
    icon,
    title,
    sub,
    tint = 'neutral',
  }: {
    icon: string;
    title: string;
    sub?: string;
    tint?: SettingsTint;
  } = $props();
</script>

<div class="settings-card-head">
  <span class="settings-icon-tile tint-{tint}"><Icon name={icon} cls="icon icon-md" /></span>
  <span class="settings-card-head-text">
    <span class="settings-card-title">{title}</span>
    {#if sub}<span class="settings-card-sub">{sub}</span>{/if}
  </span>
</div>
