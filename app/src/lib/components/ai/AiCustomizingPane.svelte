<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import AiChat from './AiChat.svelte';
  import AiNewFeatureDialog from './AiNewFeatureDialog.svelte';
  import {
    aiChat,
    aiChatBusy,
    aiSessions,

    loadAiSessions,
    openAiSection,
    requestAiRollback,
    resumeAiSession,

  } from '../../state/ai-customizing.svelte.ts';

  onMount(() => {
    openAiSection();
  });


  /* Zweistufige Bestätigung für Rollbacks (Muster: SystemScreen.confirmThen) */
  let confirmId = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  function confirmThen(id: string, action: () => void): void {
    if (confirmId === id) {
      confirmId = null;
      if (confirmTimer) clearTimeout(confirmTimer);
      action();
      return;
    }
    confirmId = id;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => { confirmId = null; }, 4000);
  }

  function fmtDate(value: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
</script>

<h3 class="caps-label settings-group-label">Feature-Chat</h3>
<div class="settings-group" data-setting-id="ai-chat">
  <AiChat />
</div>

<h3 class="caps-label settings-group-label">Feature-Verlauf</h3>
<div class="settings-group" data-setting-id="ai-history">
  {#if aiSessions.list.length === 0}
    <div class="settings-row">
      <span class="settings-row-icon"><Icon name="i-history" cls="icon icon-md" /></span>
      <div class="settings-row-text">
        <span class="settings-row-label">
          {aiSessions.loading ? 'Verlauf wird geladen…' : aiSessions.error ?? 'Noch keine Features'}
        </span>
        <span class="settings-row-sub">
          {aiSessions.loading || aiSessions.error ? '' : 'Jede abgeschlossene Feature-Session erscheint hier — mit der Möglichkeit zum Rollback.'}
        </span>
      </div>
      {#if aiSessions.error}
        <button class="secondary-btn pressable" type="button" onclick={() => void loadAiSessions()}>Erneut laden</button>
      {/if}
    </div>
  {:else}
    {#each aiSessions.list as session (session.id)}
      <div class="settings-row" class:is-active-session={session.id === aiChat.sessionId}>
        <span class="settings-row-icon"><Icon name="i-creation" cls="icon icon-md" /></span>
        <div class="settings-row-text">
          <span class="settings-row-label">{session.title}</span>
          <span class="settings-row-sub num">{fmtDate(session.lastActive)}</span>
        </div>
        {#if session.status === 'rolled_back'}
          <span class="settings-row-badge is-offline">{session.statusLabel}</span>
        {:else if session.id === aiChat.sessionId}
          <span class="settings-row-badge">Geöffnet</span>
        {/if}
        {#if session.id !== aiChat.sessionId}
          <button class="secondary-btn pressable" type="button"
                  disabled={aiChatBusy()}
                  onclick={() => void resumeAiSession(session.id)}>Öffnen</button>
        {/if}
        {#if session.status !== 'rolled_back'}
          <button class="secondary-btn danger-btn pressable" type="button"
                  disabled={aiChatBusy()}
                  onclick={() => confirmThen(`rollback-${session.id}`, () => void requestAiRollback(session.id))}>
            {confirmId === `rollback-${session.id}` ? 'Wirklich zurückrollen?' : 'Rollback'}
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>
<p class="settings-note">Rollback macht alle Commits eines Features rückgängig und deployt den Stand davor — der Verlauf der Session bleibt erhalten.</p>

<AiNewFeatureDialog />
