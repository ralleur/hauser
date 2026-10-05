<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { m } from '../../../paraglide/messages.js';
  import { roomHeroConfig } from '../../state/room-hero-config.svelte.ts';
  import { normalizeHeroRoom } from '../room-hero-assets.ts';
  import { loadRoomRegionsOnce, reloadRoomRegions, roomRegions } from '../../state/room-regions.svelte.ts';
  import { setDefaultRoomObjects } from '../../state/room-display-config.svelte.ts';
  import { setRoomImageRegions, type RoomImageRegion, type RoomImageRegionKind } from '../../state/room-image-library-client.ts';
  import { OBJECT_KINDS, rectangle, freehand, validShape, moveCorner, type Point } from '../../room-images/object-shapes.ts';

  let { roomId, title, imageAlt, savingText, onclose }: { roomId: string; title: string; imageAlt: string; savingText: string; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let stage: HTMLDivElement;
  let regions = $state<RoomImageRegion[]>([]);
  let selected = $state<number | null>(null);
  let tool = $state<'select' | 'freehand' | 'rectangle'>('select');
  let kind = $state<RoomImageRegionKind>('window');
  let stroke = $state<Point[]>([]);
  let undo = $state<RoomImageRegion[] | null>(null);
  let moving: number | null = null;
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  const editingRoom = untrack(() => roomId);
  const assetId = roomHeroConfig(editingRoom)?.assetId;
  const imageKey = 'project:' + normalizeHeroRoom(editingRoom);
  const imageUrl = assetId ? `/assets/room-images/${assetId}/light.avif` : `${import.meta.env.BASE_URL}hero/${normalizeHeroRoom(editingRoom)}-light.avif`;
  const labels: Record<RoomImageRegionKind, () => string> = {
    window: m.rimg_object_window, floor: m.rimg_object_floor, seating: m.rimg_object_seating,
    table: m.rimg_object_table, desk: m.rimg_object_desk, bed: m.rimg_object_bed, tv: m.rimg_object_tv,
    mirror: m.rimg_object_mirror, bath: m.rimg_object_bath, appliance: m.rimg_object_appliance,
    bin: m.rimg_object_bin, toy: m.rimg_object_toy, solar: m.rimg_object_solar,
  };
  const clone = (list: RoomImageRegion[]) => list.map(r => ({...r, points: r.points.map(p => ({...p}))}));
  onMount(() => {
    dialog.showModal();
    void loadRoomRegionsOnce().then(() => {
      regions = clone(roomRegions(editingRoom)); selected = regions.length ? 0 : null; loading = false;
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
    undo=clone(regions); regions.splice(selected,1); selected=regions.length ? Math.min(selected,regions.length-1) : null;
  }
  async function save() {
    if (saving || loading) return;
    saving=true; error=null;
    try {
      if (assetId) { await setRoomImageRegions(assetId,regions); await reloadRoomRegions(); }
      else setDefaultRoomObjects(editingRoom,imageKey,clone(regions));
      onclose();
    } catch (failure) { error=failure instanceof Error ? failure.message : m.rimg_regions_failed(); }
    finally { saving=false; }
  }
  const polygon = (points: Point[]) => points.map(p=>`${p.x*100},${p.y*100}`).join(' ');
</script>

<dialog bind:this={dialog} aria-labelledby="objects-title" oncancel={(e) => { e.preventDefault(); if (!saving) onclose(); }} onkeydown={(e) => { if (e.key==='Escape') e.stopPropagation(); }}>
  <header><h2 id="objects-title">{title}</h2><button class="secondary-btn" disabled={saving} onclick={onclose}>{m.rimg_objects_cancel()}</button></header>
  <p>{m.rimg_objects_hint()}</p>
  <fieldset disabled={loading || saving}>
    <div class="tools">
      <button class="secondary-btn" class:chosen={tool==='select'} onclick={()=>{tool='select';stroke=[];}}>{m.rimg_objects_select()}</button>
      <button class="secondary-btn" class:chosen={tool==='freehand'} onclick={()=>{tool='freehand';stroke=[];}}>{m.rimg_objects_freehand()}</button>
      <button class="secondary-btn" class:chosen={tool==='rectangle'} onclick={()=>{tool='rectangle';stroke=[];}}>{m.rimg_objects_rectangle()}</button>
      {#if tool!=='select'}<label>{m.rimg_objects_new()}<select bind:value={kind}>{#each OBJECT_KINDS as k}<option value={k}>{labels[k]()}</option>{/each}</select></label>{/if}
    </div>
    <div bind:this={stage} class="stage room-image-windows-stage" role="application" aria-label={title}
         onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={()=>{moving=null;stroke=[];}}>
      <img src={imageUrl} alt={imageAlt} draggable="false" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {#each regions as region,index}<polygon class:chosen={selected===index} points={polygon(region.points)} />{/each}
        {#if stroke.length}<polygon class="draft" points={polygon(tool==='rectangle' ? rectangle(stroke[0],stroke.at(-1)!) : stroke)} />{/if}
      </svg>
      {#if tool==='select'}
        {#each regions as region,index}
          <button class="hit" aria-label={`${labels[region.kind]?.() ?? region.kind} ${index+1}`} style:clip-path={`polygon(${region.points.map(p=>`${p.x*100}% ${p.y*100}%`).join(',')})`} onclick={()=>selected=index}></button>
        {/each}
        {#if selected!==null && regions[selected]}
          {#each regions[selected].points as p,index}
            <button class="corner" aria-label={m.rimg_objects_point({count:index+1})} style:left={`${p.x*100}%`} style:top={`${p.y*100}%`}
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
    <h3>{m.rimg_objects_list()}</h3>
    {#if regions.length===0}<p>{m.rimg_objects_empty()}</p>{/if}
    <div class="objects">{#each regions as region,index}
      <button class="secondary-btn" class:chosen={selected===index} aria-pressed={selected===index} onclick={()=>{selected=index;tool='select';}}>{labels[region.kind]?.() ?? region.kind} {index+1}</button>
    {/each}</div>
    {#if selected!==null && regions[selected]}
      <label>{m.rimg_objects_type()}<select value={regions[selected].kind} onchange={(event)=>{if(selected!==null){undo=clone(regions);regions[selected]={...regions[selected],kind:event.currentTarget.value as RoomImageRegionKind};}}}>{#each OBJECT_KINDS as k}<option value={k}>{labels[k]()}</option>{/each}</select></label>
      <button class="secondary-btn" onclick={remove}>{m.rimg_objects_remove()}</button>
    {/if}
    <footer>
      <button class="secondary-btn" disabled={!undo} onclick={()=>{if(undo){const current=clone(regions);regions=undo;undo=current;selected=regions.length?0:null;}}}>{m.rimg_objects_undo()}</button>
      <button class="primary-btn" onclick={save}>{saving ? savingText : m.rimg_objects_save()}</button>
    </footer>
  </fieldset>
  {#if error}<p role="alert">{error}</p>{/if}
</dialog>

<style>
  dialog { width: calc(100vw - var(--space-8)); max-width: calc(var(--space-8) * 28); max-height: calc(100dvh - var(--space-8)); overflow: auto; padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-0); color: var(--color-text-primary); }
  dialog::backdrop { background: var(--overlay-scrim); }
  header,footer,.tools,.objects { display:flex; gap:var(--space-3); flex-wrap:wrap; align-items:center; }
  header,footer { justify-content:space-between; }
  fieldset { border:0; padding:0; min-width:0; }
  label { display:flex; gap:var(--space-2); align-items:center; padding-block:var(--space-3); }
  select { color:var(--color-text-primary); background:var(--color-surface-2); padding:var(--space-2); }
  .stage { width:100%; position:relative; margin-block:var(--space-4); touch-action:none; user-select:none; aspect-ratio:auto; background:none; }
  .stage img { display:block; width:100%; height:auto; pointer-events:none; }
  svg,.hit { position:absolute; inset:0; width:100%; height:100%; }
  svg { pointer-events:none; }
  polygon { fill:var(--color-accent-cool); fill-opacity:.15; stroke:var(--color-accent-cool); stroke-width:.25; }
  polygon.chosen { fill:var(--color-accent-warm); stroke:var(--color-accent-warm); }
  polygon.draft { fill:none; stroke:var(--color-text-primary); stroke-dasharray:1; }
  .hit { background:none; border:0; }
  .corner { position:absolute; transform:translate(-50%,-50%); width:var(--touch-min); height:var(--touch-min); display:grid; place-items:center; padding:0; border:0; background:none; touch-action:none; }
  .corner span { width:var(--space-3); height:var(--space-3); border:2px solid var(--color-accent-warm); border-radius:var(--radius-full); background:var(--color-surface-0); }
  button.chosen { outline:2px solid var(--color-accent-warm); }
  footer { margin-top:var(--space-5); }
</style>
