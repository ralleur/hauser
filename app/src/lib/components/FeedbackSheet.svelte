<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<script lang="ts">
  /* Rückmeldung (docs/23 R40): zwei Tipps und ein Satz. Was automatisch
     mitgeht, steht unter dem Textfeld — nichts reist unsichtbar. */
  import { onMount } from 'svelte';
  import { m } from '../../paraglide/messages.js';
  import { IS_DEMO } from '../demo/demo-mode.ts';
  import { buildInfo, loadBuildInfo } from '../state/build-info.svelte.ts';
  import { localeLabel } from '../state/locale.svelte.ts';
  import { closeFeedback, feedbackClientInfo, sendFeedback, type FeedbackKind, type FeedbackOutcome } from '../state/feedback.svelte.ts';

  let kind = $state<FeedbackKind>('problem');
  let text = $state('');
  let contact = $state('');
  let phase = $state<'edit' | 'sending' | FeedbackOutcome>('edit');
  let textarea = $state<HTMLTextAreaElement | null>(null);

  onMount(() => {
    void loadBuildInfo();
    textarea?.focus();
  });

  const info = $derived(feedbackClientInfo());
  const attached = $derived(m.feedback_attached({
    version: buildInfo.version ?? '—',
    language: localeLabel(info.language),
    viewport: info.viewport || '—',
    connection: info.connection,
  }));

  async function send() {
    if (!text.trim() || phase === 'sending') return;
    phase = 'sending';
    phase = await sendFeedback({ kind, text: text.trim(), contact: contact.trim() });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') closeFeedback();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fb-scrim" role="presentation"
     onclick={(event) => { if (event.target === event.currentTarget) closeFeedback(); }}>
  <div class="fb" role="dialog" aria-modal="true" aria-labelledby="fb-title">
    <header class="fb-head">
      <h2 id="fb-title">{m.feedback_title()}</h2>
      <button class="secondary-btn pressable" type="button" onclick={closeFeedback}>{m.common_close()}</button>
    </header>

    {#if phase === 'sent'}
      <p class="fb-result">{m.feedback_sent()}</p>
      {#if IS_DEMO}<p class="fb-note">{m.feedback_demo_hint()}</p>{/if}
    {:else}
      <div class="fb-kind" role="radiogroup" aria-label={m.feedback_title()}>
        <button class="fb-pill pressable" class:is-active={kind === 'problem'} type="button"
                role="radio" aria-checked={kind === 'problem'} onclick={() => { kind = 'problem'; }}>{m.feedback_kind_problem()}</button>
        <button class="fb-pill pressable" class:is-active={kind === 'wish'} type="button"
                role="radio" aria-checked={kind === 'wish'} onclick={() => { kind = 'wish'; }}>{m.feedback_kind_wish()}</button>
      </div>

      <textarea class="fb-text" bind:this={textarea} bind:value={text} rows="4" maxlength="2000"
                placeholder={kind === 'problem' ? m.feedback_placeholder_problem() : m.feedback_placeholder_wish()}></textarea>

      <label class="fb-contact">
        <span>{m.feedback_contact_label()}</span>
        <input type="text" inputmode="email" autocomplete="off" maxlength="300"
               bind:value={contact} placeholder={m.feedback_contact_placeholder()} />
      </label>

      <p class="fb-note">{attached}</p>

      {#if phase === 'failed'}<p class="fb-result is-error">{m.feedback_failed()}</p>{/if}
      {#if phase === 'too-many'}<p class="fb-result is-error">{m.feedback_too_many()}</p>{/if}

      <footer class="fb-foot">
        <button class="primary-btn pressable" type="button" disabled={!text.trim() || phase === 'sending'} onclick={send}>
          {phase === 'sending' ? m.feedback_sending() : m.feedback_send()}
        </button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .fb-scrim {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
  }

  .fb {
    display: grid;
    gap: var(--space-3, 12px);
    width: min(94vw, 34rem);
    max-height: 88vh;
    overflow-y: auto;
    padding: var(--space-5, 20px);
    border-radius: var(--radius-lg, 16px);
    background: var(--color-surface-1, #16181d);
    color: var(--color-text-primary, #fff);
  }

  .fb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4, 16px);
  }

  .fb-head h2 {
    margin: 0;
    font-size: var(--font-size-title, 1.25rem);
  }

  .fb-kind {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2, 8px);
  }

  .fb-pill {
    min-height: var(--touch-min, 44px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.16));
    border-radius: var(--radius-md, 12px);
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .fb-pill.is-active {
    border-color: var(--color-accent, #7cc4ff);
    background: color-mix(in srgb, var(--color-accent, #7cc4ff) 18%, transparent);
  }

  .fb-text,
  .fb-contact input {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-3, 12px);
    border: 1px solid var(--color-border, rgba(255, 255, 255, 0.16));
    border-radius: var(--radius-md, 12px);
    background: var(--color-surface-2, rgba(255, 255, 255, 0.06));
    color: inherit;
    font: inherit;
    resize: vertical;
  }

  .fb-contact {
    display: grid;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-small, 0.875rem);
    opacity: 0.85;
  }

  .fb-note {
    margin: 0;
    font-size: var(--font-size-small, 0.875rem);
    opacity: 0.6;
  }

  .fb-result {
    margin: 0;
    font-size: var(--font-size-body, 1rem);
  }

  .fb-result.is-error {
    color: var(--color-danger, #ff8a80);
  }

  .fb-foot {
    display: flex;
    justify-content: flex-end;
  }
</style>
