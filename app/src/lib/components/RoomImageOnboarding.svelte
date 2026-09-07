<script lang="ts">
  /* ── Onboarding-Karte für Raumbilder ──
     Ein Raum ohne zugewiesenes Bild zeigt rechts neben den Kontrollflächen,
     wofür der Assistent da ist: Vorher/Nachher, die drei Schritte und die
     drei Wege weiter (generieren, aus der Bibliothek wählen, schließen).

     Sie erscheint genau einmal pro Gerät (Paket 3); danach steht der Weg zum
     Assistenten dauerhaft unter „Räume & Geräte" in den Einstellungen. Ein
     Haken „nicht mehr anzeigen" wäre daneben eine Lüge — die Karte kommt so
     oder so nicht wieder.

     Owner-Entscheidung 2026-09-04: „klein" aus dem Planpunkt meinte die
     Häufigkeit, nicht den Inhalt. Das Bildpaar erklärt die Funktion; ohne es
     bleibt eine Textanzeige. Assistent und Bibliothek werden erst beim Öffnen
     nachgeladen — die Home-Ansicht bleibt schlank. ── */
  import Icon from './Icon.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { ROOM_IMAGE_WIZARD_ENABLED } from '../config/product-capabilities.ts';
  import { createRetryableLazyLoader } from '../state/lazy-loader.ts';
  import { settingsValues, setRoomOnboardHidden } from '../state/settings.svelte.ts';

  const ASSET_BASE = import.meta.env.BASE_URL;
  import { m } from '../../paraglide/messages.js';

  /* Zwei Lader statt einem: Beide Dialoge haben eigene Eigenschaften, und ein
     gemeinsamer Lader zwingt sie in einen Typ — dann verliert der eine, was
     der andere braucht. */
  const wizardLoader = createRetryableLazyLoader({
    wizard: () => import('./settings/RoomImageWizard.svelte'),
  });
  const libraryLoader = createRetryableLazyLoader({
    library: () => import('./settings/RoomImageLibrary.svelte'),
  });

  /* Der Stand beim Betreten der Ansicht. Die Karte merkt sich selbst, dass sie
     dran war — ohne diese Kopie würde sie im selben Atemzug verschwinden. */
  const seenBefore = settingsValues.roomOnboardHidden;
  let dismissed = $state(false);
  let wizardOpen = $state(false);
  let libraryOpen = $state(false);

  const roomId = $derived(appState.currentRoom);
  /* In der Demo fehlt die Karte ganz: Besucher sollen zuerst das Bild sehen,
     nicht ein Panel, das es halb verdeckt. Den Assistenten gibt es dort nicht. */
  const visible = $derived(
    ROOM_IMAGE_WIZARD_ENABLED
    && import.meta.env?.VITE_DEMO !== '1'
    && !seenBefore
    && !dismissed
    && !!roomId
    && roomHeroConfig(roomId) === null,
  );

  $effect(() => {
    if (visible && !settingsValues.roomOnboardHidden) setRoomOnboardHidden(true);
  });

  function dismiss(): void {
    dismissed = true;
  }
</script>

{#if visible}
  <aside class="room-onboard" aria-label={m.room_onboard_title()}>
    <div class="room-onboard-body">
      <h2 class="room-onboard-title">{m.room_onboard_title()}</h2>
      <p class="room-onboard-text">{m.room_onboard_text()}</p>

      <div class="room-onboard-teaser">
        <figure>
          <figcaption>{m.rimg_before()}</figcaption>
          <img src={`${ASSET_BASE}wizard/before.webp`} alt="" loading="lazy" />
        </figure>
        <span class="room-onboard-arrow" aria-hidden="true">
          <Icon name="i-arrow-right" cls="icon icon-md" />
        </span>
        <figure>
          <figcaption>{m.rimg_after()}</figcaption>
          <img src={`${ASSET_BASE}wizard/after.webp`} alt="" loading="lazy" />
        </figure>
      </div>

      <ol class="room-onboard-steps">
        <li>
          <span class="room-onboard-step-icon"><Icon name="i-link-variant" cls="icon icon-lg" /></span>
          <span class="room-onboard-step-num num">1</span>
          <span class="room-onboard-step-label">{m.room_onboard_step_connect()}</span>
        </li>
        <li>
          <span class="room-onboard-step-icon"><Icon name="i-camera" cls="icon icon-lg" /></span>
          <span class="room-onboard-step-num num">2</span>
          <span class="room-onboard-step-label">{m.room_onboard_step_photo()}</span>
        </li>
        <li>
          <span class="room-onboard-step-icon"><Icon name="i-creation" cls="icon icon-lg" /></span>
          <span class="room-onboard-step-num num">3</span>
          <span class="room-onboard-step-label">{m.room_onboard_step_generate()}</span>
        </li>
      </ol>
    </div>

    <footer class="room-onboard-actions">
      <button class="primary-btn pressable" type="button" onclick={() => wizardOpen = true}>
        {m.room_onboard_generate()}
        <Icon name="i-creation" cls="icon icon-sm" />
      </button>
      <button class="secondary-btn pressable" type="button" onclick={() => libraryOpen = true}>
        {m.room_onboard_manual()}
      </button>
      <button class="secondary-btn pressable" type="button" onclick={dismiss}>
        {m.room_onboard_dismiss()}
      </button>
    </footer>
  </aside>
{/if}

{#if wizardOpen}
  {#await wizardLoader.load('wizard') then loaded}
    {@const RoomImageWizard = loaded.default}
    <RoomImageWizard open={wizardOpen} {roomId} onclose={() => wizardOpen = false} />
  {/await}
{/if}

{#if libraryOpen && roomId}
  {#await libraryLoader.load('library') then loaded}
    {@const RoomImageLibrary = loaded.default}
    <RoomImageLibrary open={libraryOpen} targetRoomId={roomId}
                      onclose={() => libraryOpen = false}
                      onassigned={dismiss} />
  {/await}
{/if}
