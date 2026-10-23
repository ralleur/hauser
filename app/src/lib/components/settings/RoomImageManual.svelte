<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import Icon from '../Icon.svelte';
  import RoomObjectEditor from './RoomObjectEditor.svelte';
  import { appState } from '../../state/app.svelte.ts';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { loadRoomImageLibrary, setRoomImageRegions, type RoomImageLibraryAsset, type RoomImageRegion } from '../../state/room-image-library-client.ts';
  import { resetRoomBackgroundVariant, uploadRoomBackgroundVariant, type RoomBackgroundVariant as Variant } from '../../state/room-background-client.ts';
  import { reloadRoomRegions } from '../../state/room-regions.svelte.ts';
  import { buildRoomImagePrompt } from '../../room-images/room-image-prompt-policy-v1.ts';

  let { roomId, onapplied }: { roomId: string; onapplied?: () => void } = $props();
  type Draft = { file: File; url: string };
  const keys = { light: 'light', dark: 'dark', 'dark-off': 'darkOff', overcast: 'overcast' } as const;
  const providers = [
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Gemini', url: 'https://gemini.google.com/app' },
    { name: 'Bing', url: 'https://www.bing.com/images/create' },
  ];
  const exterior = $derived(roomId === EXTERIOR_HERO_ID);
  const roomName = $derived(exterior ? m.img_exterior() : appState.rooms.find(room => room.id === roomId)?.name ?? roomId);
  const variants = $derived<Variant[]>(exterior ? ['light', 'dark', 'overcast'] : ['light', 'dark', 'dark-off', 'overcast']);
  let assets = $state<RoomImageLibraryAsset[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let checking = $state(false);
  let staged = $state<Partial<Record<Variant, Draft>>>({});
  let resets = $state<Variant[]>([]);
  let prepare = $state<Variant | null>(null);
  let provider = $state(0);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let uploadFor = $state<Variant>('light');
  let input = $state<HTMLInputElement>();
  let sourceInput = $state<HTMLInputElement>();
  let source = $state<Draft | null>(null);
  let objectsOpen = $state(false);
  let draftRegions = $state<RoomImageRegion[] | null>(null);
  const config = $derived(roomHeroConfig(roomId));
  const asset = $derived(assets.find(entry => entry.assetId === config?.assetId) ?? null);
  const manualSet = $derived(asset?.assetId.startsWith('manual_') ?? false);
  const readyCount = $derived(variants.filter(ready).length);
  const changed = $derived(Object.keys(staged).length > 0 || resets.length > 0 || draftRegions !== null);
  const dayUrl = $derived(staged.light?.url ?? asset?.variants.light ?? null);

  $effect(() => { void roomId; void load(); });
  async function load() {
    try { assets = (await loadRoomImageLibrary()).assets; error = null; }
    catch (failure) { error = failure instanceof Error ? failure.message : m.rimg_lib_err_load(); }
    finally { loaded = true; }
  }
  function name(variant: Variant): string {
    return variant === 'light' ? m.rimg_manual_v_light() : variant === 'dark' ? (exterior ? m.rimg_manual_v_night() : m.rimg_manual_v_dark()) : variant === 'dark-off' ? m.rimg_manual_v_dark_off() : m.rimg_manual_v_overcast();
  }
  function ready(variant: Variant): boolean {
    return !!staged[variant] || resets.includes(variant) || !!asset?.variants[keys[variant]] && (!manualSet || variant === 'light' || !!asset?.manual?.own.includes(keys[variant]));
  }
  function url(variant: Variant): string | null { return staged[variant]?.url ?? (ready(variant) ? asset?.variants[keys[variant]] ?? null : null); }
  function pick(variant: Variant) { uploadFor = variant; input?.click(); }
  function valid(file: File): boolean { return ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) && file.size > 0 && file.size <= 12_582_912; }
  async function stage(variant: Variant, file: File) {
    if (busy || checking) return;
    error = null;
    if (!valid(file)) { error = m.rimg_err_file_type(); return; }
    checking = true;
    const preview = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = preview; await image.decode();
      if (staged[variant]) URL.revokeObjectURL(staged[variant]!.url);
      staged[variant] = { file, url: preview };
      resets = resets.filter(item => item !== variant);
      prepare = null;
    } catch { URL.revokeObjectURL(preview); error = m.rimg_err_file_type(); }
    finally { checking = false; }
  }
  function chosen(event: Event) { const field = event.currentTarget as HTMLInputElement; const file = field.files?.[0]; field.value = ''; if (file) void stage(uploadFor, file); }
  function drop(variant: Variant, event: DragEvent) { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file) void stage(variant, file); }
  function derive(variant: Variant) {
    if (staged[variant]) { URL.revokeObjectURL(staged[variant]!.url); delete staged[variant]; }
    if (!resets.includes(variant)) resets = [...resets, variant];
  }
  function removeDraft(variant: Variant) {
    if (staged[variant]) URL.revokeObjectURL(staged[variant]!.url);
    delete staged[variant]; resets = resets.filter(item => item !== variant);
  }
  function chooseSource(event: Event) {
    const field = event.currentTarget as HTMLInputElement; const file = field.files?.[0]; field.value = '';
    if (!file) return;
    if (!valid(file)) { error = m.rimg_err_file_type(); return; }
    if (source) URL.revokeObjectURL(source.url);
    source = { file, url: URL.createObjectURL(file) };
  }
  function wording(variant: Variant): string {
    const spec = { stylePreset: exterior ? 'hauser-exterior-v1' as const : 'hauser-room-v1' as const, declutter: 'light' as const, tone: 'neutral' as const, preserveFeatures: ['windows' as const, 'doors' as const, 'built_ins' as const] };
    return variant === 'light' ? `${buildRoomImagePrompt('composition', spec)} ${buildRoomImagePrompt('style-light', spec)}` : buildRoomImagePrompt(variant, spec);
  }
  async function copy(variant: Variant) {
    try {
      const text = wording(variant);
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea'); field.value = text; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select();
        const done = document.execCommand('copy'); field.remove(); if (!done) throw new Error('copy rejected');
      }
      copied = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => copied = false, 2500);
    }
    catch { error = m.rimg_access_err_copy(); }
  }
  async function apply() {
    if (busy || checking || !changed || readyCount !== variants.length || !dayUrl) return;
    busy = true; error = null;
    let writes = 0;
    const previousRegions = draftRegions ?? asset?.regions?.regions;
    try {
      const createSet = !!staged.light || !manualSet;
      // Read every retained version before a new day image replaces the old set.
      if (createSet) {
        for (const variant of variants) {
          if (staged[variant] || resets.includes(variant)) continue;
          const existing = asset?.variants[keys[variant]];
          if (!existing) throw new Error(m.rimg_manual_light_first());
          const response = await fetch(existing); if (!response.ok) throw new Error(m.rimg_lib_err_load());
          const file = new File([await response.blob()], `hauser-${variant}.avif`, { type: 'image/avif' });
          staged[variant] = { file, url: URL.createObjectURL(file) };
        }
      }
      for (const variant of variants) {
        const draft = staged[variant];
        if (draft) { await uploadRoomBackgroundVariant(roomId, variant, draft.file, 'manual'); writes++; }
        else if (resets.includes(variant) && !createSet) { await resetRoomBackgroundVariant(roomId, variant as Exclude<Variant, 'light'>); writes++; }
      }
      const current = roomHeroConfig(roomId);
      if (current && previousRegions) await setRoomImageRegions(current.assetId, previousRegions);
      await reloadRoomRegions();
      for (const draft of Object.values(staged)) if (draft) URL.revokeObjectURL(draft.url);
      staged = {}; resets = []; draftRegions = null;
      await load(); onapplied?.();
    } catch (failure) {
      error = `${writes > 0 ? m.img_manual_partial() + ' ' : ''}${failure instanceof Error ? failure.message : m.room_background_failed()}`;
    } finally { busy = false; }
  }
  onDestroy(() => { for (const draft of Object.values(staged)) if (draft) URL.revokeObjectURL(draft.url); if (source) URL.revokeObjectURL(source.url); clearTimeout(copyTimer); });
</script>

<input bind:this={input} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif" onchange={chosen} />
<input bind:this={sourceInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/avif" onchange={chooseSource} />
<section class="manual-workspace" aria-label={m.img_manual_title()}>
  {#if prepare === null}
    <header class="manual-heading"><div><h2>{m.img_manual_title()}</h2><p>{m.img_manual_intro()}</p></div><strong>{m.img_manual_ready_count({ ready: readyCount, total: variants.length })}</strong></header>
    <progress max={variants.length} value={readyCount} aria-label={m.img_manual_ready_count({ ready: readyCount, total: variants.length })}></progress>
    <div class="manual-grid">
      {#each variants as variant}
        {@const preview = url(variant)}
        <article class="variant-card">
          <header><h3>{name(variant)}</h3><span class="variant-status" class:is-ready={ready(variant)}>{ready(variant) ? '✓' : '○'} {resets.includes(variant) ? m.img_automatic() : ready(variant) ? m.img_manual_ready() : m.img_manual_missing()}</span>
            <details class="variant-menu"><summary aria-label={m.img_manual_actions({ variant: name(variant) })}>•••</summary><div>
              {#if preview}<a href={preview} download={`hauser-${roomId}-${variant}.avif`}>{m.img_manual_download()}</a>{/if}
              {#if variant !== 'light'}<button type="button" disabled={!dayUrl || busy} onclick={() => derive(variant)}>{m.rimg_manual_derive_again()}</button>{/if}
              {#if staged[variant] || resets.includes(variant)}<button type="button" disabled={busy} onclick={() => removeDraft(variant)}>{m.img_manual_discard()}</button>{/if}
            </div></details>
          </header>
          <div class="variant-picture" role="group" aria-label={m.img_manual_upload_for({ variant: name(variant) })} ondragover={event => event.preventDefault()} ondrop={event => drop(variant, event)}>
            {#if preview}<button type="button" class="picture-button" disabled={busy || checking || !loaded} onclick={() => pick(variant)} aria-label={m.img_manual_upload_for({ variant: name(variant) })}><img src={preview} alt={name(variant)} /></button>
            {:else}<div class="upload-placeholder"><Icon name="i-image" cls="icon icon-xl" /><button class="primary-btn" type="button" disabled={busy || checking || !loaded} onclick={() => pick(variant)}>{m.rimg_manual_upload()}</button><small>{m.img_manual_drop()}</small></div>{/if}
          </div>
          <footer>{#if preview}<button class="text-btn" type="button" disabled={busy || checking} onclick={() => pick(variant)}>{m.rimg_manual_replace()}</button>{/if}<button class="text-btn" type="button" disabled={busy || checking} onclick={() => { prepare = variant; copied = false; }}>{m.img_manual_prepare()} ↗</button></footer>
        </article>
      {/each}
    </div>
    <p class="format-hint">{m.rimg_manual_result_hint()}</p>
    <footer class="manual-apply"><div>{readyCount === variants.length ? m.img_manual_review() : m.img_manual_remaining({ count: variants.length - readyCount })}</div><button class="primary-btn" type="button" disabled={busy || checking || !changed || readyCount !== variants.length} onclick={apply}>{busy ? m.room_background_saving() : m.img_manual_apply({ room: roomName })}</button></footer>
  {:else}
    {@const reference = prepare === 'light' ? source?.url ?? dayUrl : dayUrl}
    <button class="text-btn manual-back" type="button" disabled={busy} onclick={() => prepare = null}>← {m.img_manual_all()}</button>
    <header class="manual-heading"><div><span class="caps-label">{roomName}</span><h2>{m.img_manual_prepare_variant({ variant: name(prepare) })}</h2><p>{m.img_manual_same_room()}</p></div></header>
    <div class="prepare-grid">
      <section class="prepare-source">
        <h3><span class="step-number">1</span>{m.img_manual_template()}</h3>
        {#if reference}<img class="reference-picture" src={reference} alt={prepare === 'light' ? m.rimg_manual_step_input() : m.rimg_manual_v_light()} /><a class="secondary-btn" href={reference} download={prepare === 'light' && source ? source.file.name : `hauser-${roomId}-template.avif`}>{m.img_manual_download()}</a>{:else}<div class="upload-placeholder"><Icon name="i-image" cls="icon icon-xl" /><p>{prepare === 'light' ? m.rimg_manual_input_light() : m.rimg_manual_light_first()}</p></div>{/if}
        {#if prepare === 'light'}<button class="secondary-btn" type="button" onclick={() => sourceInput?.click()}>{m.img_manual_choose_photo()}</button>{/if}
        {#if !exterior}<button class="text-btn" type="button" disabled={!dayUrl} onclick={() => objectsOpen = true}>▦ {m.img_manual_windows_optional()}</button>{/if}
      </section>
      <div class="prepare-result">
        <section><h3><span class="step-number">2</span>{m.img_manual_at_provider()}</h3>
          <div class="provider-choice" role="group" aria-label={m.img_manual_at_provider()}>{#each providers as option,index}<button class="secondary-btn" type="button" aria-pressed={provider === index} onclick={() => provider = index}>{option.name}</button>{/each}</div>
          <p>{prepare === 'light' ? m.rimg_manual_wording_light() : m.rimg_manual_wording_other()}</p>
          <details class="prompt-preview"><summary>{m.img_manual_show_prompt()}</summary><pre>{wording(prepare)}</pre></details>
          <div class="prompt-actions"><button class="primary-btn" type="button" onclick={() => prepare && copy(prepare)}>{copied ? m.rimg_manual_copied() : m.img_manual_copy_prompt()}</button><a class="secondary-btn" href={providers[provider].url} target="_blank" rel="noreferrer">{m.img_manual_open_provider({ provider: providers[provider].name })} ↗</a></div>
          <small>{m.img_manual_external_note()}</small>
        </section>
        <section><h3><span class="step-number">3</span>{m.img_manual_upload_result()}</h3><div class="upload-placeholder result-drop" role="group" aria-label={m.img_manual_upload_result()} ondragover={event => event.preventDefault()} ondrop={event => prepare && drop(prepare,event)}><Icon name="i-image" cls="icon icon-xl" /><button class="primary-btn" type="button" disabled={checking} onclick={() => prepare && pick(prepare)}>{m.img_manual_upload_finished()}</button><small>{m.img_manual_drop()}</small></div><p>{m.img_manual_review()}</p></section>
      </div>
    </div>
  {/if}
  {#if error}<p role="alert" class="manual-error">{error}</p>{:else if checking}<p role="status">{m.img_manual_checking()}</p>{/if}
</section>
{#if objectsOpen && dayUrl}<RoomObjectEditor {roomId} imageUrl={dayUrl} initialRegions={draftRegions ?? asset?.regions?.regions ?? []} onsave={regions => draftRegions = regions} initialKind="window" windowOnly title={m.img_windows()} imageAlt={m.room_background_preview()} savingText={m.room_background_saving()} onclose={() => objectsOpen = false} />{/if}

<style>
  .manual-workspace { display: grid; gap: var(--space-4); min-width: 0; }
  .manual-heading,.manual-apply,.variant-card > header,.variant-card > footer { display:flex; justify-content:space-between; align-items:center; gap:var(--space-3); }
  .manual-heading { align-items:flex-start; }
  .manual-heading h2 { font-size:var(--text-xl); margin:0 0 var(--space-2); }
  .manual-heading p { margin:0; color:var(--color-text-secondary); }
  progress { width:100%; height:var(--space-2); accent-color:var(--color-accent-warm); }
  .manual-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-4); }
  .variant-card { min-width:0; padding:var(--space-3); border:1px solid var(--color-border); border-radius:var(--radius-lg); background:var(--color-surface-1); }
  .variant-card > header { margin-bottom:var(--space-3); }
  .variant-card h3 { margin:0; flex:1; font-size:var(--text-lg); }
  .variant-status { font-size:var(--text-sm); color:var(--color-text-secondary); }
  .variant-status.is-ready { color:var(--color-accent-warm); }
  .variant-picture { height:clamp(calc(var(--space-8) * 2), calc((100dvh - var(--space-8) * 8) / 2), calc(var(--space-8) * 4)); overflow:hidden; border-radius:var(--radius-md); }
  .picture-button { display:block; width:100%; height:100%; border:0; padding:0; background:none; cursor:pointer; }
  .picture-button img { width:100%; height:100%; object-fit:cover; }
  .upload-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-3); width:100%; height:100%; padding:var(--space-4); border:1px dashed var(--color-border); border-radius:var(--radius-md); text-align:center; }
  .variant-card > footer { flex-wrap:wrap; margin-top:var(--space-2); }
  .variant-card > footer .text-btn:last-child { margin-inline-start:auto; }
  .variant-menu { position:relative; }
  .variant-menu summary { min-width:var(--touch-min); min-height:var(--touch-min); display:grid; place-items:center; cursor:pointer; list-style:none; }
  .variant-menu > div { position:absolute; inset-inline-end:0; top:100%; z-index:3; min-width:calc(var(--space-8) * 4); display:grid; padding:var(--space-2); border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--image-workspace-background); }
  .variant-menu :is(button,a) { text-align:start; padding:var(--space-3); min-height:var(--touch-min); color:inherit; border:0; background:none; font:inherit; }
  .manual-apply { position:sticky; bottom:calc(var(--space-6) * -1); padding:var(--space-4) 0; border-top:1px solid var(--color-border); background:var(--image-workspace-panel); }
  small,.format-hint { color:var(--color-text-secondary); }
  .format-hint { font-size:var(--text-sm); text-align:center; margin:0; }
  .prepare-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-6); }
  .prepare-source,.prepare-result,.prepare-result > section { display:grid; align-content:start; gap:var(--space-4); min-width:0; }
  .prepare-result { padding-inline-start:var(--space-5); border-inline-start:1px solid var(--color-border); }
  .prepare-result > section + section { border-top:1px solid var(--color-border); padding-top:var(--space-5); }
  .reference-picture { width:100%; max-height:45dvh; object-fit:contain; border-radius:var(--radius-lg); }
  .prepare-grid h3 { display:flex; align-items:center; gap:var(--space-3); margin:0; }
  .step-number { display:grid; place-items:center; flex:none; width:var(--touch-min); height:var(--touch-min); border-radius:var(--radius-full); background:var(--color-accent-warm); color:var(--color-text-on-accent); }
  .provider-choice,.prompt-actions { display:flex; gap:var(--space-2); flex-wrap:wrap; }
  .provider-choice button { flex:1; }
  .provider-choice button[aria-pressed='true'] { border-color:var(--color-accent-warm); background:var(--color-surface-inverse); color:var(--color-text-on-inverse); }
  .prompt-actions > * { flex:1; }
  .prompt-preview { padding:var(--space-3); background:var(--color-surface-2); border-radius:var(--radius-md); }
  .prompt-preview summary { min-height:var(--touch-min); cursor:pointer; }
  pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:var(--text-sm); max-height:25dvh; overflow:auto; }
  .result-drop { min-height:calc(var(--space-8) * 3); }
  .manual-back { justify-self:start; }
  .manual-error { color:var(--color-error); }
  @media (max-width:760px) { .manual-heading { flex-wrap:wrap; } .manual-heading h2 { font-size:var(--text-2xl); } .manual-grid { gap:var(--space-2); } .variant-card h3 { font-size:var(--text-sm); min-height:0; } .variant-card { padding:var(--space-2); } .variant-card > header { flex-wrap:wrap; } .variant-menu { margin-inline-start:auto; } .variant-picture { height:auto; aspect-ratio:1; } .variant-picture .primary-btn { font-size:var(--text-sm); padding:var(--space-2); } .variant-card > footer .text-btn { font-size:var(--text-sm); } .prepare-grid { grid-template-columns:1fr; } .prepare-result { padding:0; border:0; } .manual-apply { flex-direction:column; align-items:stretch; bottom:calc(var(--space-4) * -1); } }
</style>
