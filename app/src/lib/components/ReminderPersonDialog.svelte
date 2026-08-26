<script lang="ts">
  /* Bewohner der Pinnwand anlegen oder umbenennen. Ohne personId legt der
     Dialog eine neue Person an, mit personId benennt er sie um — Name und
     Zettelfarbe sind in beiden Fällen dieselben zwei Felder. */
  import { m } from '../../paraglide/messages.js';
  import { POSTIT_COLORS, personLabel, postitStyle } from '../state/reminder-persons.ts';
  import {
    addReminderPerson, reminderPersons, renameReminderPerson,
  } from '../state/reminder-persons.svelte.ts';

  let { personId = null, onclose }: { personId?: string | null; onclose: () => void } = $props();

  const existing = $derived(personId
    ? reminderPersons.list.find((person) => person.id === personId) ?? null
    : null);

  let name = $state('');
  let color = $state(POSTIT_COLORS[0].id);
  let error = $state<string | null>(null);
  let initialized = false;

  $effect(() => {
    if (initialized) return;
    initialized = true;
    if (!existing) return;
    name = personLabel(existing);
    color = existing.color;
  });

  function colorName(id: string): string {
    switch (id) {
      case 'gelb': return m.rem_color_yellow();
      case 'gruen': return m.rem_color_green();
      case 'gelbgruen': return m.rem_color_lime();
      case 'blau': return m.rem_color_blue();
      case 'rosa': return m.rem_color_pink();
      case 'orange': return m.rem_color_orange();
      case 'flieder': return m.rem_color_violet();
      default: return m.rem_color_grey();
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    if (existing) renameReminderPerson(existing.id, name, color);
    else if (!addReminderPerson(name, color)) {
      error = m.rem_person_error();
      return;
    }
    onclose();
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onclose(); }} />

<div class="rem-edit-backdrop" role="presentation"
     onclick={(event) => { if (event.target === event.currentTarget) onclose(); }}>
  <div role="dialog" aria-modal="true" aria-labelledby="rem-person-title">
    <form class="rem-edit-dialog" onsubmit={save}>
      <h2 id="rem-person-title">{existing ? m.rem_person_edit_title() : m.rem_person_new_title()}</h2>
      <label>
        <span>{m.rem_person_name()}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" maxlength="40" bind:value={name} autocomplete="off" autofocus />
      </label>
      <fieldset class="rem-person-colors">
        <legend>{m.rem_person_color()}</legend>
        {#each POSTIT_COLORS as swatch (swatch.id)}
          <label class="rem-person-swatch" style={postitStyle(swatch.id)}>
            <input type="radio" name="postit-color" value={swatch.id} bind:group={color} />
            <span class="rem-person-swatch-dot" aria-hidden="true"></span>
            <span class="rem-person-swatch-name">{colorName(swatch.id)}</span>
          </label>
        {/each}
      </fieldset>
      {#if error}<p class="notes-add-error" role="alert">{error}</p>{/if}
      <div class="rem-edit-actions">
        <button class="secondary-btn pressable" type="button" onclick={onclose}>{m.rem_edit_cancel()}</button>
        <button class="primary-btn pressable" type="submit" disabled={!name.trim()}>{m.rem_edit_save()}</button>
      </div>
    </form>
  </div>
</div>
