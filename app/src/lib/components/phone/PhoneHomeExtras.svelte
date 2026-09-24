<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Was das Zuhause des Telefons nach dem ersten Bild dazubekommt (wie die
     iOS-App): der Gruß zu Geburtstag, Feiertag und erstem Schnee — oben, nicht
     über einem offenen Raum — und das Blatt eines eigenen Schnellaktions-
     Knopfs. Eigener Baustein, damit der Telefonstart so schlank bleibt. */
  import type { Component } from 'svelte';
  import { currentMoment, initMoments } from '../../state/moments.svelte.ts';
  import { quickEdit } from '../../state/phone-quick-edit.svelte.ts';

  let { currentRoom }: { currentRoom: string | null } = $props();

  initMoments();
  const momentVisible = $derived(currentMoment() !== null && currentRoom === null);
  let MomentCelebration = $state<Component<{ placement?: 'panel' | 'phone' }> | null>(null);
  $effect(() => {
    if (!momentVisible || MomentCelebration) return;
    void import('../MomentCelebration.svelte')
      .then((module) => { MomentCelebration = module.default; })
      .catch(() => { /* ohne Gruß weiter */ });
  });

  let QuickActionEdit = $state<Component | null>(null);
  $effect(() => {
    if (!quickEdit.id || QuickActionEdit) return;
    void import('./PhoneQuickActionEdit.svelte')
      .then((module) => { QuickActionEdit = module.default; })
      .catch(() => { quickEdit.id = null; });
  });
</script>

{#if MomentCelebration && momentVisible}
  <MomentCelebration placement="phone" />
{/if}
{#if QuickActionEdit && quickEdit.id}
  <QuickActionEdit />
{/if}
