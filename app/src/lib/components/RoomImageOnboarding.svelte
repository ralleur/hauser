<script lang="ts">
  /* ── Onboarding-Karte für Raumbilder ──
     Ein Raum ohne zugewiesenes Bild zeigt rechts neben den Kontrollflächen,
     wofür der Assistent da ist: Vorher/Nachher, die drei Schritte und die
     drei Wege weiter (generieren, aus der Bibliothek wählen, schließen).
     Assistent und Bibliothek werden erst beim Öffnen nachgeladen — die
     Home-Ansicht bleibt schlank. ── */
  import Icon from './Icon.svelte';
  import { appState } from '../state/app.svelte.ts';
  import { roomHeroConfig } from '../state/room-hero-config.svelte.ts';
  import { ROOM_IMAGE_WIZARD_ENABLED } from '../config/product-capabilities.ts';
  import { createRetryableLazyLoader } from '../state/lazy-loader.ts';
  import { settingsValues, setRoomOnboardHidden } from '../state/settings.svelte.ts';
  import { m } from '../../paraglide/messages.js';

  const ASSET_BASE = import.meta.env.BASE_URL;

  const dialogLoader = createRetryableLazyLoader({
    wizard: () => import('./settings/RoomImageWizard.svelte'),
    library: () => import('./settings/RoomImageLibrary.svelte'),
  });

  let dismissed = $state<Record<string, boolean>>({});
  let wizardOpen = $state(false);
  let libraryOpen = $state(false);

  const roomId = $derived(appState.currentRoom);
  const visible = $derived(
    ROOM_IMAGE_WIZARD_ENABLED
    && !settingsValues.roomOnboardHidden
    && !!roomId
    && roomHeroConfig(roomId) === null
    && !dismissed[roomId as string],
  );

  function dismiss(): void {
    if (roomId) dismissed = { ...dismissed, [roomId]: true };
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
      <label class="room-onboard-hide">
        <input type="checkbox" checked={settingsValues.roomOnboardHidden}
               onchange={(event) => setRoomOnboardHidden(event.currentTarget.checked)} />
        <span>{m.room_onboard_hide()}</span>
      </label>
    </footer>
  </aside>
{/if}

{#if wizardOpen}
  {#await dialogLoader.load('wizard') then loaded}
    {@const RoomImageWizard = loaded.default}
    <RoomImageWizard open={wizardOpen} onclose={() => wizardOpen = false} />
  {/await}
{/if}

{#if libraryOpen && roomId}
  {#await dialogLoader.load('library') then loaded}
    {@const RoomImageLibrary = loaded.default}
    <RoomImageLibrary open={libraryOpen} targetRoomId={roomId}
                      onclose={() => libraryOpen = false}
                      onassigned={dismiss} />
  {/await}
{/if}
