<script lang="ts">
  import { onMount } from 'svelte';
  import { backend } from '../adapter/runtime.svelte.ts';
  import { cameraPopup, setCameraPopupRule } from '../state/camera-popup.svelte.ts';
  import { defaultCameraPopupRule, type CameraPopupRule } from '../state/camera-popup.ts';
  import { m } from '../../paraglide/messages.js';
  let { entityId, label, onclose }: { entityId: string; label: string; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let sources = $state<{ entityId: string; name: string }[]>([]);
  let loading = $state(true);
  const rule = $derived(cameraPopup.rules[entityId] ?? defaultCameraPopupRule());
  function update(patch: Partial<CameraPopupRule>) { setCameraPopupRule(entityId, { ...rule, ...patch, label }); }
  onMount(() => {
    dialog.showModal();
    let cancelled = false;
    void (backend.listCameraPopupStates?.() ?? Promise.resolve([])).then(items => { if (!cancelled) sources = items
      .filter(item => /^(binary_sensor|event|input_boolean)\./.test(item.entity_id))
      .map(item => ({ entityId: item.entity_id, name: item.attributes.friendly_name ?? item.entity_id }))
      .sort((a, b) => a.name.localeCompare(b.name)); })
      .catch(() => {}).finally(() => { if (!cancelled) loading = false; });
    return () => { cancelled = true; dialog.close(); };
  });
</script>
<dialog bind:this={dialog!} onclose={onclose} aria-label={m.camera_popup_title()}>
  <h2>{label} · {m.camera_popup_title()}</h2>
  <label><input type="checkbox" checked={rule.enabled} onchange={e => update({ enabled: e.currentTarget.checked })} /> {m.camera_popup_enable()}</label>
  {#if rule.enabled}
    <label>{m.camera_popup_trigger()}
      <select value={rule.trigger} disabled={loading} onchange={e => update({ trigger: e.currentTarget.value })}>
        <option value="">{m.camera_popup_choose()}</option>
        {#each sources as source (source.entityId)}<option value={source.entityId}>{source.name} · {source.entityId}</option>{/each}
        {#if rule.trigger && !sources.some(s => s.entityId === rule.trigger)}<option value={rule.trigger}>{rule.trigger}</option>{/if}
      </select>
    </label>
    <label>{m.camera_popup_duration({ seconds: rule.seconds })}
      <input type="range" min="5" max="120" step="5" value={rule.seconds} oninput={e => update({ seconds: Number(e.currentTarget.value) })} />
    </label>
    {#if !rule.trigger}<p role="status">{m.camera_popup_required()}</p>{/if}
    {#if !loading && !sources.length}<p role="status">{m.camera_popup_empty()}</p>{/if}
  {/if}
  <p>{m.camera_popup_hint()}</p>
  <button class="secondary-btn pressable" onclick={onclose}>{m.camera_popup_done()}</button>
</dialog>
<style>
  dialog { max-width: calc(100vw - var(--space-6)); border: none; border-radius: var(--radius-xl); padding: var(--space-6); background: var(--color-surface-1); color: var(--color-text-primary); }
  dialog::backdrop { background: var(--overlay-scrim); }
  h2 { font-size: var(--text-lg); margin: 0 0 var(--space-4); }
  label { display: block; margin-block: var(--space-4); }
  select, input[type="range"] { display: block; width: 100%; margin-top: var(--space-2); }
  select { color: inherit; background: var(--color-surface-2); padding: var(--space-3); border-radius: var(--radius-md); }
  p { color: var(--color-text-secondary); max-width: 45ch; }
</style>
