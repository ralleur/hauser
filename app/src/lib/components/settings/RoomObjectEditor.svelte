<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import ImageEditorHelp from './ImageEditorHelp.svelte';
  import HeroWeatherLayer from '../HeroWeatherLayer.svelte';
  import { prefersReducedMotion } from '../../motion/index.ts';
  import { regionClipPaths } from '../../state/room-regions.svelte.ts';
  import { m } from '../../../paraglide/messages.js';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { EXTERIOR_HERO_ID } from '../../config/household-config.ts';
  import { energyAssetUrl, EXTERIOR_HERO_RATIO } from '../energy-hero-assets.ts';
  import { normalizeHeroRoom, roomImageAssetUrl } from '../room-hero-assets.ts';
  import { loadRoomRegionsOnce, reloadRoomRegions, roomRegions } from '../../state/room-regions.svelte.ts';
  import { setDefaultRoomObjects } from '../../state/room-display-config.svelte.ts';
  import { setRoomImageRegions, type RoomImageRegion, type RoomImageRegionKind } from '../../state/room-image-library-client.ts';
  import { OBJECT_KINDS, rectangle, freehand, validShape, moveCorner, type Point } from '../../room-images/object-shapes.ts';

  let { roomId, title, imageAlt, savingText, initialKind = 'window', embedded = false, windowOnly, imageUrl, fallbackUrl, weather = 'off', controls, helpText = '', initialRegions, onsave, onclose }: {
    initialKind?: RoomImageRegionKind; roomId: string; title: string; imageAlt: string; savingText: string;
    embedded?: boolean; windowOnly?: boolean; imageUrl?: string; fallbackUrl?: string;
    weather?: 'off' | 'rain' | 'snow'; controls?: Snippet; helpText?: string; initialRegions?: RoomImageRegion[]; onsave?: (regions: RoomImageRegion[]) => void; onclose: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let stage: HTMLDivElement;
  let regions = $state<RoomImageRegion[]>([]);
  let selected = $state<number | null>(null);
  let tool = $state<'select' | 'freehand' | 'rectangle'>('select');
  let kind = $state<RoomImageRegionKind>(untrack(() => windowOnly === false ? 'floor' : initialKind));
  let stroke = $state<Point[]>([]);
  let undo = $state<RoomImageRegion[] | null>(null);
  let moving: number | null = null;
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let baseline = $state('[]');
  let saved = $state(false);
  const dirty = $derived(JSON.stringify(regions) !== baseline);
  const visibleRegions = $derived(regions.map((region, index) => ({ region, index })).filter(({ region }) => windowOnly === undefined || (region.kind === 'window') === windowOnly));
  const kinds = $derived(OBJECT_KINDS.filter(value => windowOnly === undefined || (value === 'window') === windowOnly));
  const editingRoom = untrack(() => roomId);
  const assetId = roomHeroConfig(editingRoom)?.assetId;
  const exterior = editingRoom === EXTERIOR_HERO_ID;
  const clips = $derived(exterior ? [null] : regionClipPaths(regions.filter(region => region.kind === 'window')));
  const imageKey = 'project:' + (exterior ? 'exterior' : normalizeHeroRoom(editingRoom));
  const defaultImageUrl = assetId ? roomImageAssetUrl(assetId, 'light.avif') : exterior ? energyAssetUrl({ baseUrl: import.meta.env.BASE_URL, sun: { day: true }, fallbackTheme: 'light' }) : `${import.meta.env.BASE_URL}hero/${normalizeHeroRoom(editingRoom)}-light.avif`;
  const labels: Record<RoomImageRegionKind, () => string> = {
    window: m.rimg_object_window, floor: m.rimg_object_floor, seating: m.rimg_object_seating,
    table: m.rimg_object_table, desk: m.rimg_object_desk, bed: m.rimg_object_bed, tv: m.rimg_object_tv,
    mirror: m.rimg_object_mirror, bath: m.rimg_object_bath, appliance: m.rimg_object_appliance,
    bin: m.rimg_object_bin, toy: m.rimg_object_toy, solar: m.rimg_object_solar,
  };
  const clone = (list: RoomImageRegion[]) => list.map(r => ({...r, points: r.points.map(p => ({...p}))}));
  onMount(() => {
    if (!embedded) dialog?.showModal();
    void loadRoomRegionsOnce().then(() => {
      regions = clone(initialRegions ?? roomRegions(editingRoom)); baseline = JSON.stringify(regions); selected = visibleRegions[0]?.index ?? null; loading = false;
    });
  });
  $effect(() => {
    const onlyWindows = windowOnly;
    untrack(() => {
      kind = onlyWindows === false ? 'floor' : initialKind;
      tool = 'select'; stroke = [];
      if (selected === null || !visibleRegions.some(item => item.index === selected)) selected = visibleRegions[0]?.index ?? null;
    });
  });
  function point(event: PointerEvent): Point {
    const rect = stage.getBoundingClientRect();
    return { x: Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)), y: Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) };
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || tool === 'select' || loading || saving) return;
    event.preventDefault(); event.stopPropagation(); stage.setPointerCapture(event.pointerId);
    stroke = [point(event)];
  }
  function move(event: PointerEvent) {
    if (moving !== null && selected !== null) {
      event.preventDefault();
      regions[selected] = {...regions[selected], points: moveCorner(regions[selected].points, moving, point(event))};
    } else if (stroke.length) {
      const p = point(event), last = stroke.at(-1)!;
      if (tool === 'rectangle') stroke = [stroke[0], p];
      else if (Math.hypot(last.x-p.x,last.y-p.y)>.003) stroke.push(p);
    }
  }
  function up(event: PointerEvent) {
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (moving !== null) { moving = null; return; }
    if (!stroke.length) return;
    const points = tool === 'rectangle' ? rectangle(stroke[0],point(event)) : freehand([...stroke,point(event)]);
    stroke = [];
    if (regions.length >= 24) { error=m.rimg_objects_limit(); return; }
    if (!validShape(points)) { error=m.rimg_objects_invalid(); return; }
    undo = clone(regions); regions.push({kind,points}); selected=regions.length-1; tool='select'; error=null;
  }
  function remove() {
    if (selected === null) return;
    undo=clone(regions); regions.splice(selected,1); selected=visibleRegions[0]?.index ?? null;
  }
  async function save() {
    if (saving || loading) return;
    saving=true; error=null;
    try {
      if (onsave) onsave(clone(regions));
      else if (assetId) { await setRoomImageRegions(assetId,regions); await reloadRoomRegions(); }
      else setDefaultRoomObjects(editingRoom,imageKey,clone(regions));
      baseline = JSON.stringify(regions); saved = true;
      if (!embedded) onclose();
    } catch (failure) { error=failure instanceof Error ? failure.message : m.rimg_regions_failed(); }
    finally { saving=false; }
  }
  const polygon = (points: Point[]) => points.map(p=>`${p.x*100},${p.y*100}`).join(' ');
</script>

{#snippet editor()}
  <fieldset disabled={loading || saving} class="re-immersion-editor image-object-editor">
    <aside class="re-immersion-lights">
      <ImageEditorHelp text={`${m.rimg_objects_hint()}\n\n${helpText}`} />
      {@render controls?.()}
      <div class="tools" role="group" aria-label={title}>
        <button type="button" class="secondary-btn" class:chosen={tool==='select'} aria-pressed={tool==='select'} onclick={()=>{tool='select';stroke=[];}}>{m.rimg_objects_select()}</button>
        <button type="button" class="secondary-btn" class:chosen={tool!=='select'} aria-pressed={tool!=='select'} onclick={()=>{tool='rectangle';stroke=[];}}>{m.img_create_object()}</button>
      </div>
      {#if tool!=='select'}
        <div class="tools create-tools" role="group" aria-label={m.img_create_object()}>
          <button type="button" class="secondary-btn" class:chosen={tool==='freehand'} aria-pressed={tool==='freehand'} onclick={()=>{tool='freehand';stroke=[];}}>{m.rimg_objects_freehand()}</button>
          <button type="button" class="secondary-btn" class:chosen={tool==='rectangle'} aria-pressed={tool==='rectangle'} onclick={()=>{tool='rectangle';stroke=[];}}>{m.rimg_objects_rectangle()}</button>
        </div>
      {/if}
      <button type="button" class="secondary-btn" disabled={selected === null} onclick={remove}>{m.rimg_objects_remove()}</button>
      {#if tool!=='select' && kinds.length > 1}<label>{m.rimg_objects_new()}<select bind:value={kind}>{#each kinds as k}<option value={k}>{labels[k]()}</option>{/each}</select></label>{/if}
      <strong>{m.rimg_objects_list()}</strong>
      {#if visibleRegions.length===0}<p class="editor-hint">{m.rimg_objects_empty()}</p>{/if}
      <div class="objects">{#each visibleRegions as {region,index}}
        <button type="button" class="secondary-btn" class:chosen={selected===index} aria-pressed={selected===index} onclick={()=>{selected=index;tool='select';}}>{labels[region.kind]?.() ?? region.kind} {index+1}</button>
      {/each}</div>
      {#if selected!==null && regions[selected]}
        {#if kinds.length > 1}<label>{m.rimg_objects_type()}<select value={regions[selected].kind} onchange={(event)=>{if(selected!==null){undo=clone(regions);regions[selected]={...regions[selected],kind:event.currentTarget.value as RoomImageRegionKind};}}}>{#each kinds as k}<option value={k}>{labels[k]()}</option>{/each}</select></label>{/if}
      {/if}
      <footer>
        {#if windowOnly === true || (!embedded && initialKind === 'window')}<button type="button" class="secondary-btn" disabled={!regions.some(region => region.kind === 'window')} onclick={() => { undo = clone(regions); regions = regions.filter(region => region.kind !== 'window'); selected = visibleRegions[0]?.index ?? null; }}>{m.rimg_manual_windows_clear()}</button>{/if}
        <button type="button" class="secondary-btn" disabled={!undo} onclick={()=>{if(undo){const current=clone(regions);regions=undo;undo=current;selected=visibleRegions[0]?.index ?? null;}}}>{m.rimg_objects_undo()}</button>
        <button type="button" class="primary-btn" disabled={!dirty || saving} onclick={save}>{saving ? savingText : m.rimg_objects_save()}</button>
      </footer>
      {#if error}<p role="alert">{error}</p>{:else if dirty}<p class="editor-hint" role="status">{m.img_setup_unsaved()}</p>{:else if saved}<p class="editor-hint" role="status">{m.img_setup_saved()}</p>{/if}
    </aside>
    <div bind:this={stage} class="re-immersion-stage object-stage" style:aspect-ratio={exterior ? EXTERIOR_HERO_RATIO : undefined} role="application" aria-label={title}
         onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={()=>{moving=null;stroke=[];}}>
      <img src={imageUrl ?? defaultImageUrl} alt={imageAlt} draggable="false" onerror={(event) => { const image = event.currentTarget as HTMLImageElement; const fallback = new URL(fallbackUrl ?? defaultImageUrl, location.href).href; if (image.src !== fallback) image.src = fallback; }} />
      {#if weather !== 'off'}{#each clips as clip}<HeroWeatherLayer layer={{ kind: weather, intensity: 0.75, still: prefersReducedMotion() }} {clip} />{/each}{/if}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {#each visibleRegions as {region,index}}<polygon class:chosen={selected===index} points={polygon(region.points)} />{/each}
        {#if stroke.length}<polygon class="draft" points={polygon(tool==='rectangle' ? rectangle(stroke[0],stroke.at(-1)!) : stroke)} />{/if}
      </svg>
      {#if tool==='select'}
        {#each visibleRegions as {region,index}}
          <button type="button" class="hit" aria-label={`${labels[region.kind]?.() ?? region.kind} ${index+1}`} style:clip-path={`polygon(${region.points.map(p=>`${p.x*100}% ${p.y*100}%`).join(',')})`} onclick={()=>selected=index}></button>
        {/each}
        {#if selected!==null && regions[selected] && visibleRegions.some(item => item.index === selected)}
          {#each regions[selected].points as p,index}
            <button type="button" class="corner" aria-label={m.rimg_objects_point({count:index+1})} style:left={`${p.x*100}%`} style:top={`${p.y*100}%`}
              onpointerdown={(event)=>{if(event.button!==0) return;event.stopPropagation();undo=clone(regions);moving=index;stage.setPointerCapture(event.pointerId);}}
              onkeydown={(event)=>{
                const delta=({ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]} as Record<string,number[]>)[event.key];
                if (!delta || selected===null) return;event.preventDefault();undo=clone(regions);
                regions[selected]={...regions[selected],points:moveCorner(regions[selected].points,index,{x:p.x+delta[0],y:p.y+delta[1]})};
              }}><span></span></button>
          {/each}
        {/if}
      {/if}
    </div>
  </fieldset>
{/snippet}

{#if embedded}
  {@render editor()}
{:else}
  <dialog bind:this={dialog} aria-labelledby="objects-title" oncancel={(event) => { event.preventDefault(); if (!saving) onclose(); }} onkeydown={(event) => { if (event.key==='Escape') event.stopPropagation(); }}>
    <header><h2 id="objects-title">{title}</h2><button type="button" class="secondary-btn" disabled={saving} onclick={onclose}>{m.rimg_objects_cancel()}</button></header>
    {@render editor()}
  </dialog>
{/if}

<style>
  dialog { width: calc(100vw - var(--space-8)); max-width: calc(var(--space-8) * 36); max-height: calc(100dvh - var(--space-8)); overflow: auto; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-0); color: var(--color-text-primary); }
  dialog::backdrop { background: var(--overlay-scrim); }
  header,footer,.tools,.objects { display:flex; gap:var(--space-2); flex-wrap:wrap; align-items:center; }
  header { justify-content:space-between; margin-bottom:var(--space-4); }
  fieldset { border:0; padding:0; margin:0; min-width:0; }
  .editor-hint { margin:0; color:var(--color-text-secondary); font-size:var(--text-sm); }
  label { display:grid; gap:var(--space-2); }
  select { width:100%; min-height:var(--touch-min); font:inherit; color:var(--color-text-primary); background:var(--overlay-control-background); border:1px solid var(--color-border); border-radius:var(--radius-md); padding:var(--space-2); }
  .object-stage { --hero-weather-z: 0; touch-action:none; user-select:none; isolation:isolate; }
  .object-stage img { display:block; position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:var(--radius-xl); pointer-events:none; }
  svg,.hit { position:absolute; inset:0; width:100%; height:100%; }
  svg { pointer-events:none; z-index:1; border-radius:var(--radius-xl); }
  polygon { fill:var(--color-accent-cool); fill-opacity:.15; stroke:var(--color-accent-cool); stroke-width:.25; }
  polygon.chosen { fill:var(--color-accent-warm); stroke:var(--color-accent-warm); }
  polygon.draft { fill:none; stroke:var(--color-text-primary); stroke-dasharray:1; }
  .hit { background:none; border:0; z-index:2; }
  .corner { position:absolute; transform:translate(-50%,-50%); width:var(--touch-min); height:var(--touch-min); display:grid; place-items:center; padding:0; border:0; background:none; touch-action:none; z-index:3; }
  .corner span { width:var(--space-3); height:var(--space-3); border:2px solid var(--color-accent-warm); border-radius:var(--radius-full); background:var(--color-surface-inverse); }
  .image-object-editor button.secondary-btn.chosen { background:var(--color-surface-inverse); color:var(--color-text-on-inverse); border-color:var(--color-accent-warm); }
  .image-object-editor .primary-btn { background:var(--color-surface-inverse); color:var(--color-text-on-inverse); border:1px solid var(--color-accent-warm); }
</style>
