<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import { hideMarkerLines } from '../../state/ai-customizing.ts';
  import {
    aiChat,
    aiChatBusy,
    aiHealth,
    closeAiSession,
    sendAiMessage,
    setAiDraft,
  } from '../../state/ai-customizing.svelte.ts';

  let listEl = $state<HTMLElement>();
  let infoOpen = $state(false);

  const busy = $derived(aiChatBusy());
  const canSend = $derived(aiHealth.status === 'ok' && !busy && !aiChat.pendingChoice);

  /* Bei neuen Nachrichten/Deltas ans Ende scrollen */
  $effect(() => {
    void aiChat.messages.length;
    void aiChat.streamText;
    void aiChat.activity;
    void tick().then(() => listEl?.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' }));
  });

  function onSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void sendAiMessage(aiChat.draft);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) void sendAiMessage(aiChat.draft);
    }
  }
</script>

<div class="ai-chat">
  <div class="ai-chat-head">
    <div class="settings-row-text">
      <span class="settings-row-label">
        {aiChat.featureName ?? (aiChat.sessionId ? 'Neues Feature' : 'Neue Anpassung beschreiben')}
      </span>
      <span class="settings-row-sub">
        {#if aiChat.rolledBack}Dieses Feature wurde zurückgerollt.
        {:else if aiChat.sessionId}Verfeinerungen laufen in dieser Session weiter.
        {:else}Die erste Nachricht startet eine neue Feature-Session.{/if}
      </span>
    </div>
    {#if aiChat.rolledBack}
      <span class="settings-row-badge is-offline">Zurückgerollt</span>
    {/if}
    {#if aiChat.sessionId}
      <button class="secondary-btn pressable" type="button" disabled={busy}
              onclick={() => closeAiSession()}>Neues Feature</button>
    {/if}
    <button class="ai-info-btn pressable" type="button"
            aria-label="Informationen zur AI-Anpassung"
            aria-expanded={infoOpen}
            aria-controls="ai-customizing-info"
            onclick={() => { infoOpen = !infoOpen; }}>
      <Icon name="i-information-outline" cls="icon icon-md" />
    </button>
    {#if infoOpen}
      <div class="ai-info-popup" id="ai-customizing-info" role="status">
        Der Agent entwickelt die Anpassung direkt im App-Code, prüft sie und deployt sie — nach dem Neuladen ist sie live. Eine Session gehört immer genau zu einem Feature.
      </div>
    {/if}
  </div>

  {#if aiChat.messages.length || aiChat.streaming || aiChat.loading}
    <div class="ai-chat-messages" bind:this={listEl} aria-live="polite">
      {#if aiChat.loading}
        <p class="ai-activity">Verlauf wird geladen…</p>
      {/if}
      {#each aiChat.messages as msg, i (i)}
        {#if msg.text}
          <div class="ai-msg" class:is-user={msg.role === 'user'}>
          <div class="ai-msg-bubble">{msg.text}</div>
          {#if msg.markers.length}
            <div class="ai-msg-chips">
              {#each msg.markers as marker, j (j)}
                {#if marker.type === 'deployed'}
                  <span class="ai-chip is-ok"><Icon name="i-check-circle-outline" cls="icon icon-sm" /> Deployt</span>
                {:else if marker.type === 'failed'}
                  <span class="ai-chip is-error"><Icon name="i-alert-circle-outline" cls="icon icon-sm" /> Fehlgeschlagen{marker.stage ? ` (${marker.stage})` : ''}</span>
                {:else if marker.type === 'rolled_back'}
                  <span class="ai-chip"><Icon name="i-restore" cls="icon icon-sm" /> Zurückgerollt</span>
                {/if}
              {/each}
            </div>
          {/if}
          </div>
        {/if}
      {/each}
      {#if aiChat.debug && aiChat.streaming && hideMarkerLines(aiChat.streamText).trim()}
        <div class="ai-msg">
          <div class="ai-msg-bubble">{hideMarkerLines(aiChat.streamText)}</div>
        </div>
      {/if}
      {#if aiChat.activity}
        <p class="ai-activity">
          <svg class="ai-activity-cog" viewBox="0 0 96 96" aria-hidden="true">
            <path class="ai-activity-cog-spinner" fill="currentColor" d="M44.152,5.942h7.698c.772,1.692,1.379,4.604,1.96,8.603.115.76.224,1.578.318,2.404 3.144.634,6.116,1.745,8.842,3.261.596-.565,1.197-1.123,1.765-1.638 2.979-2.678,5.462-4.596,7.112-5.386l5.848,4.82c-.481,1.796-1.972,4.712-4.05,8.153-.409.662-.845,1.367-1.299,2.07 1.956,2.476,3.533,5.255,4.691,8.248.828-.033,1.647-.078,2.417-.093 1.169-.033,2.294-.054,3.345-.054 2.519,0,4.61.117,5.858.455l1.354,7.694c-1.649,1.163-5.322,2.482-9.636,3.886-.384.123-.811.247-1.214.379-.079,3.52-.729,6.891-1.849,10.039.043.033.09.07.132.102 3.955,3.204,6.89,5.6,8.67,7.046l-3.867,6.567c-3.753-1.479-7.146-2.806-10.242-4.036-.051-.021-.089-.043-.145-.064-2.316,2.792-5.105,5.151-8.223,7 .003.053.015.109.027.163.658,3.311,1.285,6.602,2.064,10.612l-7.19,2.564c-1.939-3.573-3.511-6.427-5.093-9.392-.033-.056-.06-.104-.081-.151-1.747.305-3.531.5-5.364.5-1.834,0-3.618-.195-5.363-.5-.023.048-.049.096-.082.151-1.583,2.965-3.154,5.819-5.086,9.393l-7.199-2.564c.791-4.012,1.407-7.303,2.065-10.613.013-.054.025-.11.036-.163-3.125-1.849-5.915-4.208-8.231-7-.045.021-.094.043-.139.064-3.099,1.23-6.506,2.547-10.253,4.024l-3.862-6.546c3.137-2.555,6.073-4.945,8.671-7.056.045-.031.089-.068.134-.102-1.122-3.148-1.773-6.52-1.851-10.039-.403-.132-.829-.256-1.213-.379-4.307-1.403-7.969-2.975-9.616-4.138l1.283-7.271c1.45-.396,4.062-.604,7.142-.604.685,0,1.393.011,2.116.031.765.015,1.585.06,2.414.093 1.155-2.993,2.74-5.772,4.689-8.248-.452-.703-.888-1.408-1.288-2.07-2.088-3.44-3.541-6.394-4.025-8.189l5.812-4.784c1.663.79,4.135,2.708,7.112,5.386.568.515,1.17,1.073,1.774,1.638 2.718-1.516,5.689-2.626,8.832-3.261.107-.827.205-1.644.318-2.404.581-3.999,1.187-6.911,1.959-8.603m0-6c-2.349,0-4.482,1.371-5.458,3.508-.876,1.918-1.553,4.576-2.212,8.729-.808.266-1.604.559-2.391.88-3.085-2.689-5.442-4.381-7.363-5.293-.819-.39-1.699-.581-2.573-.581-1.366,0-2.719.466-3.814,1.368l-5.811,4.784c-1.819,1.497-2.593,3.92-1.98,6.195.693,2.57,2.403,5.847,3.944,8.488-.471.762-.915,1.541-1.332,2.337-.244-.003-.486-.004-.726-.004-3.804,0-6.738.274-8.72.814-2.241.611-3.927,2.46-4.331,4.747l-1.283,7.271c-.404,2.288.55,4.603,2.448,5.943 2.204,1.556,5.757,3.018,8.632,4.055.158,1.158.37,2.309.635,3.448-1.802,1.466-3.72,3.027-5.72,4.656-2.3,1.873-2.886,5.146-1.378,7.701l3.862,6.546c1.106,1.875,3.099,2.952,5.169,2.952.735,0,1.479-.136,2.199-.419 1.671-.659,3.274-1.286,4.812-1.887.61-.239,1.212-.474,1.803-.705.998.945,2.05,1.837,3.152,2.671-.095.491-.191.987-.288,1.492-.324,1.679-.664,3.442-1.045,5.373-.575,2.917,1.072,5.815,3.873,6.813l7.199,2.564c.662.235,1.343.349,2.013.349 2.151,0,4.206-1.162,5.279-3.147.746-1.38,1.438-2.652,2.098-3.865.389-.715.767-1.41,1.138-2.095.682.042,1.353.062,2.018.062.664,0,1.335-.021,2.017-.062.475.873.959,1.763,1.465,2.691.564,1.035,1.154,2.118,1.783,3.276 1.075,1.979,3.127,3.139,5.274,3.139.671,0,1.352-.113,2.015-.35l7.19-2.564c2.794-.996,4.439-3.885,3.874-6.796l-.718-3.71c-.212-1.094-.415-2.145-.614-3.171 1.101-.833,2.15-1.724,3.147-2.668.972.383,1.971.775,2.999,1.18l3.614,1.421c.719.283,1.463.419,2.197.419 2.073,0,4.066-1.078,5.172-2.956l3.867-6.567c1.506-2.558.916-5.831-1.387-7.702l-1.921-1.562c-1.062-.863-2.328-1.896-3.791-3.084.262-1.129.472-2.269.63-3.416 4.521-1.546,6.971-2.642,8.653-3.828 1.898-1.339,2.854-3.654,2.451-5.942l-1.354-7.694c-.403-2.293-2.096-4.146-4.343-4.753-1.697-.459-3.987-.663-7.425-.663-.611,0-1.261.006-1.961.019-.415-.791-.855-1.566-1.323-2.323 2.115-3.614,3.419-6.392,3.975-8.466.609-2.271-.164-4.688-1.979-6.184l-5.848-4.82c-1.096-.903-2.45-1.37-3.817-1.37-.88,0-1.765.193-2.59.588-1.247.597-3.332,1.79-7.345,5.285-.787-.321-1.585-.614-2.392-.88-.654-4.137-1.332-6.802-2.212-8.729-.976-2.137-3.108-3.508-5.458-3.508z" />
            <path fill="currentColor" d="M48.001,36C54.618,36,60,41.383,60,48c0,6.616-5.382,11.999-11.999,11.999S36,54.616,36,48C36,41.383,41.384,36,48.001,36M48,30c-9.94,0-18,8.059-18,18,0,9.94,8.06,18,18,18s18-8.06,18-18C66,38.059,57.94,30,48,30z" />
          </svg>
          {aiChat.debug ? aiChat.technicalActivity ?? aiChat.activity : aiChat.activity}
        </p>
      {/if}
    </div>
  {/if}

  {#if aiChat.deployed}
    <div class="ai-card is-ok" role="status">
      <Icon name="i-check-circle-outline" cls="icon icon-md" />
      <span class="ai-card-text">Die Änderung ist live — nach dem Neuladen ist sie sichtbar.</span>
      <button class="secondary-btn pressable" type="button" onclick={() => location.reload()}>Jetzt neu laden</button>
    </div>
  {/if}
  {#if aiChat.failed}
    <div class="ai-card is-error" role="alert">
      <Icon name="i-alert-circle-outline" cls="icon icon-md" />
      <span class="ai-card-text">
        Checks fehlgeschlagen{aiChat.failed.stage ? ` (${aiChat.failed.stage})` : ''} — es wurde nichts deployt.
        {#if aiChat.debug}{aiChat.failed.detail}{/if}
      </span>
    </div>
  {/if}
  {#if aiChat.error}
    <div class="ai-card is-error" role="alert">
      <Icon name="i-alert-circle-outline" cls="icon icon-md" />
      <span class="ai-card-text">{aiChat.debug ? aiChat.error : 'Die Anpassung konnte gerade nicht abgeschlossen werden.'}</span>
    </div>
  {/if}

  <form class="ai-chat-form" onsubmit={onSubmit}>
    <textarea class="settings-input ai-chat-input" rows="2"
              placeholder="Gewünschte Anpassung beschreiben — z. B. „Der Energie-Screen soll ohne Hintergrund den ganzen Platz nutzen.“"
              aria-label="Anpassungswunsch"
              value={aiChat.draft}
              oninput={(e) => setAiDraft(e.currentTarget.value)}
              onkeydown={onKeydown}
              disabled={busy || !!aiChat.pendingChoice}></textarea>
    <button class="primary-btn pressable" type="submit" disabled={!canSend || !aiChat.draft.trim()}>
      {aiChatBusy() ? 'Agent arbeitet…' : 'Senden'}
    </button>
  </form>
</div>
