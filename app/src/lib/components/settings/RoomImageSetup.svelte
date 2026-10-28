<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import RoomObjectEditor from './RoomObjectEditor.svelte';
  import RoomImageWizard from './RoomImageWizard.svelte';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  import { normalizeHeroRoom, PROJECT_OVERCAST_ROOMS, roomImageAssetUrl } from '../room-hero-assets.ts';
  import { energyAssetUrl, energyOvercastUrl } from '../energy-hero-assets.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { loadRoomImageLibrary, type RoomImageLibraryAsset } from '../../state/room-image-library-client.ts';
  import type { RoomBackgroundVariant } from '../../state/room-background-client.ts';
  import { fadeOffLamps, setFadeOffLamps } from '../../state/room-display-config.svelte.ts';

  let { roomId, devices, onarrange }: { roomId: string; devices?: Snippet; onarrange?: () => void } = $props();
  let mode = $state<'devices' | 'windows' | 'objects'>(untrack(() => devices ? 'devices' : 'windows'));
  let objectsReady = $state(false);
  let wizardOpen = $state(false);
  let variant = $state<RoomBackgroundVariant>('light');
  let weather = $state<'off' | 'rain' | 'snow'>('off');
  let asset = $state<RoomImageLibraryAsset | null>(null);
  const exterior = $derived(roomId === EXTERIOR_HERO_ID);
  const config = $derived(roomHeroConfig(roomId));
  const variants = $derived<RoomBackgroundVariant[]>(exterior ? ['light', 'dark', 'overcast'] : ['light', 'dark', 'dark-off', 'overcast']);
  const keys = { light: 'light', dark: 'dark', 'dark-off': 'darkOff', overcast: 'overcast' } as const;
  const imageUrl = $derived.by(() => {
    if (asset?.assetId === config?.assetId && asset) return asset.variants[keys[variant]] ?? asset.variants.light;
    if (config) return roomImageAssetUrl(config.assetId, `${variant === 'overcast' ? 'light' : variant}.avif`);
    return defaultUrl(variant);
  });
  function defaultUrl(value: RoomBackgroundVariant): string {
    if (exterior) return value === 'overcast' ? energyOvercastUrl(import.meta.env.BASE_URL, null)
      : energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: { day: value === 'light' }, fallbackTheme: 'light' });
    const room = normalizeHeroRoom(roomId);
    return `${import.meta.env.BASE_URL}hero/${room}-${value === 'overcast' && !PROJECT_OVERCAST_ROOMS.has(room) ? 'light' : value}.avif`;
  }
  function variantName(value: RoomBackgroundVariant): string {
    return value === 'light' ? m.rimg_manual_v_light() : value === 'dark' ? (exterior ? m.rimg_manual_v_night() : m.rimg_manual_v_dark())
      : value === 'dark-off' ? m.rimg_manual_v_dark_off() : m.rimg_manual_v_overcast();
  }
  $effect(() => { if (mode !== 'devices') objectsReady = true; });
  $effect(() => {
    const id = config?.assetId;
    void wizardOpen;
    let current = true;
    asset = null;
    if (id) void loadRoomImageLibrary().then(library => { if (current) asset = library.assets.find(item => item.assetId === id) ?? null; }).catch(() => {});
    return () => { current = false; };
  });
</script>

<section class="image-setup" aria-label={m.img_setup()}>
    <div class="image-segments setup-modes" role="group" aria-label={m.img_setup()}>
      {#if devices}<button type="button" aria-pressed={mode === 'devices'} onclick={() => mode = 'devices'}>{m.img_devices()}</button>{/if}
      <button type="button" aria-pressed={mode === 'windows'} onclick={() => mode = 'windows'}>{m.img_windows()}</button>
      <button type="button" aria-pressed={mode === 'objects'} onclick={() => mode = 'objects'}>{m.img_surfaces()}</button>
    </div>
  {#if devices}
    <div class="setup-host device-settings" hidden={mode !== 'devices'}>
      <div class="re-row">
        <span class="re-label"><span class="re-name">{m.img_fade_off_lamps()}</span></span>
        <button class="re-toggle pressable" type="button" role="switch"
                aria-label={m.img_fade_off_lamps()} aria-checked={fadeOffLamps(roomId)}
                class:is-on={fadeOffLamps(roomId)} onclick={() => setFadeOffLamps(roomId, !fadeOffLamps(roomId))}>
          <span class="re-toggle-knob"></span>
        </button>
      </div>
      {@render devices()}
    </div>
  {/if}
  {#if objectsReady}
    <div class="setup-host" hidden={mode === 'devices'}>
      <RoomObjectEditor {roomId} embedded helpText={mode === 'windows' ? `${m.img_preview_hint()}\n\n${!config ? m.img_defaults_hint() : ''}` : ''} windowOnly={mode === 'windows'} {imageUrl} fallbackUrl={defaultUrl(variant)} weather={mode === 'windows' ? weather : 'off'} title={mode === 'windows' ? m.img_windows() : m.img_surfaces()} imageAlt={m.room_background_preview()} savingText={m.room_background_saving()} onclose={() => {}}>
        {#snippet controls()}
          {#if mode === 'windows'}
            <div class="preview-controls">
              <strong>{m.img_preview()}</strong>
              <div class="image-segments" role="group" aria-label={m.rimg_manage_versions()}>{#each variants as option}<button type="button" aria-pressed={variant === option} onclick={() => variant = option}>{variantName(option)}</button>{/each}</div>
              <span>{m.img_weather_preview()}</span>
              <div class="image-segments" role="group" aria-label={m.img_weather_preview()}>
                <button type="button" aria-pressed={weather === 'off'} onclick={() => weather = 'off'}>{m.img_weather_off()}</button>
                <button type="button" aria-pressed={weather === 'rain'} onclick={() => weather = 'rain'}>{m.img_rain()}</button>
                <button type="button" aria-pressed={weather === 'snow'} onclick={() => weather = 'snow'}>{m.img_snow()}</button>
              </div>
              {#if config}<button class="secondary-btn" type="button" onclick={() => wizardOpen = true}>{m.rimg_manage_versions()}</button>{/if}
            </div>
          {/if}
          {#if exterior && onarrange}<button class="secondary-btn pressable" type="button" onclick={onarrange}>{m.energy_menu_arrange()}</button>{/if}
        {/snippet}
      </RoomObjectEditor>
    </div>
  {/if}

</section>
{#if wizardOpen}<RoomImageWizard open {roomId} initialWay="manual" onclose={() => wizardOpen = false} />{/if}

<style>
  .image-setup { display: grid; gap: var(--space-4); color: var(--color-text-primary); }
  .setup-host[hidden] { display: none; }
  .device-settings { display: grid; gap: var(--space-4); }
  .image-segments { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .image-segments button { min-height: var(--touch-min); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-full); background: var(--color-surface-2); color: var(--color-text-primary); font: inherit; cursor: pointer; }
  .image-segments button[aria-pressed='true'] { background: var(--color-surface-inverse); color: var(--color-text-on-inverse); border-color: var(--color-accent-warm); }
  .setup-modes { padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); }
  .preview-controls { display: grid; gap: var(--space-3); }
  :global(.image-setup .re-immersion-editor) { --re-immersion-chrome: calc(var(--space-6) * 4 + var(--touch-min) * 3 + var(--space-5) * 2 + var(--space-4)); height: calc(100dvh - var(--re-immersion-chrome)); }
  @media (max-width: 760px) {
    :global(.image-setup .re-immersion-editor) { height: auto; }
    :global(.image-setup .re-immersion-stage) { grid-row: 1; }
    :global(.image-setup .re-immersion-lights) { grid-row: 2; }
    .setup-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-1); }
    .setup-modes button { padding: var(--space-2); font-size: var(--text-sm); overflow-wrap: anywhere; }
  }
</style>
