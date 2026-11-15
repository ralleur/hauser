<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import Icon from './Icon.svelte';
  let { value, label, onconfirm, onclose }: { value: string; label: string; onconfirm: (value: string) => void; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let dial = $state<HTMLDivElement>();
  let hour = $state(untrack(() => value.split(':')[0]));
  let minute = $state(untrack(() => value.split(':')[1]));
  let part = $state<'hour' | 'minute'>('hour');
  let keyboard = $state(false);
  let dragging = false;
  const valid = $derived(/^\d{1,2}$/.test(hour) && Number(hour) < 24 && /^\d{1,2}$/.test(minute) && Number(minute) < 60);
  const selected = $derived(Number(part === 'hour' ? hour : minute));
  const angle = $derived(selected * (part === 'hour' ? 30 : 6));
  const inner = $derived(part === 'hour' && (selected === 0 || selected > 12));
  const digits = (v: string) => v.padStart(2, '0');
  const numbers = $derived(part === 'hour' ? Array.from({ length: 24 }, (_, i) => i) : Array.from({ length: 12 }, (_, i) => i * 5));
  onMount(() => { dialog.showModal(); return () => dialog.close(); });
  function pick(number: number) {
    if (part === 'hour') { hour = String(number).padStart(2, '0'); part = 'minute'; }
    else minute = String(number).padStart(2, '0');
  }
  function position(number: number) {
    const inner = part === 'hour' && (number === 0 || number > 12);
    const angle = number * (part === 'hour' ? 30 : 6) * Math.PI / 180;
    const radius = inner ? 28 : 41;
    return `left:${50 + Math.sin(angle) * radius}%;top:${50 - Math.cos(angle) * radius}%;`;
  }
  function point(event: PointerEvent) {
    const box = dial!.getBoundingClientRect(), dx = event.clientX - box.left - box.width / 2, dy = event.clientY - box.top - box.height / 2;
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    if (part === 'minute') minute = String(Math.round(angle / 6) % 60).padStart(2, '0');
    else {
      const index = Math.round(angle / 30) % 12;
      hour = String(Math.hypot(dx, dy) < box.width * .34 ? index === 0 ? 0 : index + 12 : index || 12).padStart(2, '0');
    }
  }
  function down(event: PointerEvent) { if (!event.isPrimary) return; event.preventDefault(); dragging = true; dial!.setPointerCapture(event.pointerId); point(event); }
  function up(event: PointerEvent) { if (!dragging) return; point(event); dragging = false; if (part === 'hour') part = 'minute'; }
  function confirm() { if (valid) onconfirm(`${digits(hour)}:${digits(minute)}`); }
</script>

<dialog bind:this={dialog} class="time-picker" aria-label={label} oncancel={(event) => { event.preventDefault(); onclose(); }} onclick={(event) => { if (event.target === dialog) onclose(); }} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); confirm(); } }}>
  <div class="time-picker-form">
    <div class="time-picker-body">
      <div class="time-picker-readout">
        <h2>{label}</h2>
        {#if keyboard}
          <div class="time-picker-inputs">
            <label><span>{m.time_picker_hours()}</span><input aria-label={m.time_picker_hours()} type="text" inputmode="numeric" maxlength="2" bind:value={hour} oninput={(e) => { hour = e.currentTarget.value.replace(/\D/g, ''); }} /></label>
            <span aria-hidden="true">:</span>
            <label><span>{m.time_picker_minutes()}</span><input aria-label={m.time_picker_minutes()} type="text" inputmode="numeric" maxlength="2" bind:value={minute} oninput={(e) => { minute = e.currentTarget.value.replace(/\D/g, ''); }} /></label>
          </div>
        {:else}
          <div class="time-picker-value num">
            <button type="button" class:is-active={part === 'hour'} aria-label={m.time_picker_hours()} aria-pressed={part === 'hour'} onclick={() => { part = 'hour'; }}>{digits(hour)}</button><span>:</span><button type="button" class:is-active={part === 'minute'} aria-label={m.time_picker_minutes()} aria-pressed={part === 'minute'} onclick={() => { part = 'minute'; }}>{digits(minute)}</button>
          </div>
        {/if}
        <p class="time-picker-hint">{keyboard ? m.time_picker_input() : part === 'hour' ? m.time_picker_hours() : m.time_picker_minutes()}</p>
      </div>
      {#if !keyboard}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div bind:this={dial} class="time-picker-dial" role="group" aria-label={part === 'hour' ? m.time_picker_hours() : m.time_picker_minutes()} onpointerdown={down} onpointermove={(event) => { if (dragging) point(event); }} onpointerup={up} onpointercancel={() => { dragging = false; }}>
          <svg viewBox="0 0 100 100" aria-hidden="true"><g transform={`rotate(${angle},50,50)`}><line x1="50" y1="50" x2="50" y2={inner ? 22 : 9} /><circle cx="50" cy={inner ? 22 : 9} r="6.6" /></g><circle cx="50" cy="50" r="1.2" /></svg>
          {#each numbers as number}
            <button type="button" class="time-picker-number" class:is-selected={number === selected} style={position(number)} aria-label={`${number} ${part === 'hour' ? m.time_picker_hours() : m.time_picker_minutes()}`} aria-pressed={number === selected} onclick={(e) => { if (e.detail === 0) pick(number); }}>{part === 'minute' || number === 0 ? String(number).padStart(2, '0') : number}</button>
          {/each}
        </div>
      {/if}
    </div>
    <footer>
      <div class="time-picker-modes" role="group" aria-label={m.time_picker_input()}>
        <button type="button" class:is-active={keyboard} aria-label={m.time_picker_input()} aria-pressed={keyboard} onclick={() => { keyboard = true; }}><Icon name="i-keyboard-outline" cls="icon icon-lg" /></button>
        <button type="button" class:is-active={!keyboard} aria-label={m.time_picker_dial()} aria-pressed={!keyboard} onclick={() => { keyboard = false; }}><Icon name="i-clock-outline" cls="icon icon-lg" /></button>
      </div>
      <div class="time-picker-actions"><button class="secondary-btn pressable" type="button" onclick={onclose}>{m.rem_edit_cancel()}</button><button class="primary-btn pressable" type="button" onclick={confirm} disabled={!valid}>{m.time_picker_confirm()}</button></div>
    </footer>
  </div>
</dialog>

<style>
  .time-picker { position: fixed; inset: 0; margin: auto; color: var(--color-text-primary); padding: 0; width: min(var(--time-picker-width), calc(100vw - var(--space-8))); max-height: calc(100dvh - var(--space-8)); overflow: auto; border: 1px solid var(--overlay-border); border-radius: var(--radius-2xl); background: var(--glass-face, var(--overlay-panel-background)); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: var(--elevation-overlay-shadow); }
  .time-picker::backdrop { background: var(--overlay-scrim); }
  .time-picker-form { padding: var(--space-6); }
  .time-picker-body { display: flex; align-items: center; justify-content: space-around; gap: var(--space-6); }
  .time-picker-readout { flex: 1; min-width: 0; }
  h2 { color: var(--color-text-secondary); font-size: var(--text-lg); font-weight: var(--font-weight-medium); margin: 0 0 var(--space-6); }
  .time-picker-value, .time-picker-inputs { display: flex; align-items: center; justify-content: center; font-size: var(--text-4xl); line-height: var(--leading-tight); }
  .time-picker-value button { color: var(--color-text-primary); background: none; border: 0; padding: var(--space-1); font: inherit; min-height: var(--touch-min); border-radius: var(--radius-md); }
  .time-picker-value button.is-active { color: var(--color-accent-warm); }
  .time-picker-inputs label { min-width: 0; }
  .time-picker-inputs label span { display: block; font-size: var(--text-sm); color: var(--color-text-secondary); }
  .time-picker-inputs input { width: 100%; text-align: center; font: inherit; background: var(--overlay-control-background); color: var(--color-text-primary); border: 1px solid var(--overlay-border); border-radius: var(--radius-lg); }
  .time-picker-hint { color: var(--color-text-secondary); margin-top: var(--space-4); font-size: var(--text-sm); text-align: center; }
  .time-picker-dial { width: var(--time-picker-dial-size); aspect-ratio: 1; position: relative; flex: none; touch-action: none; border-radius: var(--radius-full); border: 1px solid var(--overlay-border); background: var(--overlay-control-background); }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  svg line { stroke: var(--color-text-primary); stroke-width: .6; }
  svg circle { fill: var(--color-text-primary); }
  svg g circle { fill: var(--color-accent-warm); fill-opacity: var(--time-picker-selection-opacity); stroke: var(--color-accent-warm); stroke-width: .5; }
  .time-picker-number { position: absolute; transform: translate(-50%, -50%); width: var(--touch-min); height: var(--touch-min); display: grid; place-items: center; border: 0; padding: 0; background: none; color: var(--color-text-primary); font-size: var(--text-lg); border-radius: var(--radius-full); touch-action: none; }
  .time-picker-number.is-selected { color: var(--color-text-primary); font-weight: var(--font-weight-semibold); }
  footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-top: var(--space-5); padding-top: var(--space-5); border-top: 1px solid var(--overlay-border); }
  .time-picker-modes { display: flex; border: 1px solid var(--overlay-border); border-radius: var(--radius-full); background: var(--overlay-control-background); }
  .time-picker-modes button { display: grid; place-items: center; min-width: var(--touch-min); min-height: var(--touch-min); padding: var(--space-2) var(--space-4); border-radius: inherit; background: transparent; color: var(--color-text-secondary); border: 1px solid transparent; }
  .time-picker-modes button.is-active { border-color: var(--color-accent-warm); color: var(--color-accent-warm); background: color-mix(in srgb, var(--color-accent-warm) 20%, transparent); }
  .time-picker-actions { display: flex; gap: var(--space-3); }
  .time-picker-actions button { border-radius: var(--radius-full); border: 1px solid var(--overlay-border); background: var(--glass-face, var(--overlay-control-background)); color: var(--color-text-primary); box-shadow: var(--pill-edge); }
  .time-picker-actions .primary-btn { border-color: var(--color-accent-warm); color: var(--color-accent-warm); background: color-mix(in srgb, var(--color-accent-warm) 20%, var(--glass-face, var(--overlay-control-background))); }
  @media (max-width: 600px) { .time-picker { width: calc(100vw - var(--space-6)); } .time-picker-form { padding: var(--space-4); } .time-picker-body { flex-direction: column; gap: var(--space-3); } h2 { margin-bottom: var(--space-2); text-align: center; } .time-picker-value, .time-picker-inputs { font-size: var(--text-3xl); } .time-picker-dial { width: min(var(--time-picker-dial-size), calc(100vw - var(--space-8)), 46dvh); } .time-picker-number { font-size: var(--text-base); width: var(--touch-min); height: var(--touch-min); } footer { flex-wrap: wrap; justify-content: center; } }
</style>
