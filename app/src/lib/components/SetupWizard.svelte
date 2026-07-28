<script lang="ts">
  import { discoverHomeAssistant } from '../config/setup-discovery.ts';
  import { parseHouseholdConfig } from '../config/household-config.ts';
  import {
    buildSetupHouseholdSuggestion,
    canMoveSetupEntity,
    moveSetupEntity,
    omitSetupEntity,
    type SetupHouseholdSuggestion,
  } from '../config/setup-household.ts';

  let haUrl = $state('http://homeassistant.local:8123');
  let token = $state('');
  let status = $state<'idle' | 'connecting' | 'ready' | 'activating' | 'error'>('idle');
  let message = $state('');
  let suggestion = $state<SetupHouseholdSuggestion | null>(null);
  let omittedCount = $state(0);

  async function connectAndScan(): Promise<void> {
    if (!haUrl.trim() || !token.trim()) {
      status = 'error';
      message = 'Adresse und Long-Lived Access Token werden benötigt.';
      return;
    }
    status = 'connecting';
    message = '';
    suggestion = null;
    omittedCount = 0;
    try {
      const snapshot = await discoverHomeAssistant(haUrl, token);
      suggestion = buildSetupHouseholdSuggestion(snapshot);
      status = 'ready';
      message = `${suggestion.config.rooms.length} Räume und ${suggestion.config.rooms.reduce((sum, room) => sum + room.visibleEntities.length, 0)} relevante Entitäten gefunden.`;
    } catch (error) {
      status = 'error';
      message = error instanceof Error
        ? error.message
        : 'Home Assistant konnte nicht verbunden werden.';
    }
  }

  function moveEntity(entityId: string, event: Event): void {
    if (!suggestion) return;
    const targetRoomId = (event.currentTarget as HTMLSelectElement).value;
    suggestion.config = moveSetupEntity(suggestion.config, entityId, targetRoomId);
  }

  function omitEntity(entityId: string): void {
    if (!suggestion) return;
    const next = omitSetupEntity(suggestion.config, entityId);
    if (next === suggestion.config) return;
    suggestion.config = next;
    omittedCount += 1;
  }

  async function activate(): Promise<void> {
    if (!suggestion) return;
    const parsed = parseHouseholdConfig(suggestion.config);
    if (!parsed.ok) {
      const issue = parsed.issues[0];
      status = 'error';
      message = `${issue.path}: ${issue.message}`;
      return;
    }
    status = 'activating';
    message = '';
    try {
      const response = await fetch('/api/setup/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          haUrl: haUrl.trim(),
          haToken: token,
          householdConfig: suggestion.config,
        }),
      });
      const payload = await response.json() as { message?: string; issue?: { path?: string; message?: string } };
      if (!response.ok) {
        const issue = payload.issue?.path ? ` ${payload.issue.path}: ${payload.issue.message ?? ''}` : '';
        throw new Error(`${payload.message ?? 'Die Aktivierung ist fehlgeschlagen.'}${issue}`.trim());
      }
      token = '';
      location.reload();
    } catch (error) {
      status = 'error';
      message = error instanceof Error ? error.message : 'Die Aktivierung ist fehlgeschlagen.';
    }
  }
</script>

<svelte:head><title>Hauser einrichten</title></svelte:head>

<main class="setup-shell">
  <section class="setup-card" aria-labelledby="setup-title">
    <p class="eyebrow">Hauser · Ersteinrichtung</p>
    <h1 id="setup-title">Home Assistant verbinden</h1>
    <p class="intro">Hauser liest Räume und relevante Entitäten ein und erstellt daraus eine validierte erste Konfiguration. Es werden noch keine Geräte gesteuert.</p>

    <form onsubmit={(event) => { event.preventDefault(); void connectAndScan(); }}>
      <label>
        <span>Home-Assistant-Adresse</span>
        <input type="url" bind:value={haUrl} autocomplete="url" spellcheck="false" required />
      </label>
      <label>
        <span>Long-Lived Access Token</span>
        <input type="password" bind:value={token} autocomplete="off" required />
        <small>In Home Assistant: Profil → Sicherheit → Long-Lived Access Tokens. Der Token wird erst bei der Aktivierung serverseitig in <code>/data</code> gespeichert.</small>
      </label>
      <button class="primary" type="submit" disabled={status === 'connecting' || status === 'activating'}>
        {status === 'connecting' ? 'Verbinde und scanne …' : 'Verbindung testen und Räume scannen'}
      </button>
    </form>

    {#if message}
      <p class:error={status === 'error'} class="message" role={status === 'error' ? 'alert' : 'status'}>{message}</p>
    {/if}

    {#if suggestion}
      <div class="preview">
        <div class="preview-heading">
          <div>
            <p class="eyebrow">Vorschau</p>
            <h2>Gefundene Räume</h2>
          </div>
          {#if suggestion.inferredRooms}<span class="warning">Aus Entity-Namen abgeleitet</span>{/if}
        </div>
        <div class="room-list">
          {#each suggestion.config.rooms as room (room.id)}
            <section class="room-card" aria-labelledby={`room-${room.id}`}>
              <div class="room-heading">
                <label class="room-title">
                  <span class="sr-only">Raumname</span>
                  <input id={`room-${room.id}`} bind:value={room.name} required />
                </label>
                <span>{room.visibleEntities.length} Entitäten</span>
              </div>
              {#if room.visibleEntities.length > 0}
                <div class="entity-list">
                  {#each room.visibleEntities as entity (entity.entityId)}
                    <div class="entity-editor">
                      <label>
                        <span class="sr-only">Anzeigename für {entity.entityId}</span>
                        <input class="entity-name" bind:value={entity.name} required />
                      </label>
                      <label>
                        <span class="sr-only">Raum für {entity.name}</span>
                        <select value={room.id} onchange={(event) => moveEntity(entity.entityId, event)}>
                          {#each suggestion.config.rooms as targetRoom (targetRoom.id)}
                            <option
                              value={targetRoom.id}
                              disabled={!canMoveSetupEntity(suggestion.config, entity.entityId, targetRoom.id)}
                            >{targetRoom.name}</option>
                          {/each}
                        </select>
                      </label>
                      <button class="secondary" type="button" onclick={() => omitEntity(entity.entityId)}>Auslassen</button>
                      <small>{entity.entityId} · {entity.role}</small>
                    </div>
                  {/each}
                </div>
              {:else}
                <small>Keine Kernentitäten vorgeschlagen.</small>
              {/if}
            </section>
          {/each}
        </div>
        {#if suggestion.ignoredEntityIds.length + omittedCount > 0}
          <p class="ignored">{suggestion.ignoredEntityIds.length + omittedCount} nicht eindeutig zuordenbare, deaktivierte oder von dir ausgelassene Entitäten werden nicht übernommen.</p>
        {/if}
        <button class="primary" type="button" onclick={() => void activate()} disabled={status === 'activating'}>
          {status === 'activating' ? 'Aktiviere …' : 'Konfiguration bestätigen und Dashboard starten'}
        </button>
      </div>
    {/if}
  </section>
</main>

<style>
  .setup-shell { min-height: 100dvh; display: grid; place-items: center; padding: var(--space-6); background: var(--color-surface-0); color: var(--color-text-primary); font-family: var(--font-family); }
  .setup-card { width: min(calc(var(--space-8) * 12), 100%); padding: var(--space-8); border: 1px solid var(--color-border); border-radius: var(--radius-xl); background: var(--color-surface-1); box-shadow: var(--elevation-overlay-shadow); }
  .eyebrow { margin: 0 0 var(--space-2); color: var(--color-text-secondary); font-size: var(--text-xs); font-weight: var(--font-weight-semibold); letter-spacing: var(--tracking-caps); text-transform: uppercase; }
  h1, h2 { margin: 0; font-weight: var(--font-weight-semibold); letter-spacing: var(--tracking-snug); }
  h1 { font-size: var(--text-2xl); }
  h2 { font-size: var(--text-lg); }
  .intro { margin: var(--space-3) 0 var(--space-6); color: var(--color-text-secondary); line-height: var(--leading-relaxed); }
  form { display: grid; gap: var(--space-4); }
  label { display: grid; gap: var(--space-2); font-weight: 600; }
  input, select { min-height: var(--touch-preferred); padding: 0 var(--space-4); border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-0); color: var(--color-text-primary); font: inherit; }
  input:focus, select:focus { outline: 2px solid var(--color-accent-warm); outline-offset: 2px; }
  small, .ignored { color: var(--color-text-secondary); font-weight: var(--font-weight-normal); line-height: var(--leading-normal); }
  code { font-family: var(--font-family-mono); }
  button { min-height: var(--touch-preferred); border: 0; border-radius: var(--radius-md); padding: 0 var(--space-5); font: inherit; font-weight: var(--font-weight-semibold); cursor: pointer; }
  button:disabled { opacity: .55; cursor: wait; }
  .primary { background: var(--color-accent-warm); color: var(--color-text-on-accent); }
  .secondary { border: 1px solid var(--color-border); background: var(--color-surface-1); color: var(--color-text-secondary); }
  .message { margin: var(--space-4) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-2); }
  .message.error { color: var(--color-error); }
  .preview { margin-top: var(--space-7); padding-top: var(--space-6); border-top: 1px solid var(--color-border); }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
  .warning { padding: var(--space-2) var(--space-3); border-radius: var(--radius-full); background: color-mix(in srgb, var(--color-warning) 18%, transparent); color: var(--color-warning); font-size: var(--text-xs); }
  .room-list { display: grid; gap: var(--space-3); margin: var(--space-4) 0; }
  .room-card { display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-0); }
  .room-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-4); }
  .room-title input { width: 100%; font-weight: var(--font-weight-semibold); }
  .entity-list { display: grid; gap: var(--space-2); }
  .entity-editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(calc(var(--space-8) * 2), 0.7fr) auto; align-items: center; gap: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--color-border); }
  .entity-editor label, .entity-editor input, .entity-editor select { width: 100%; }
  .entity-editor small { grid-column: 1 / -1; overflow-wrap: anywhere; }
  .ignored { margin: 0 0 var(--space-4); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  @media (max-width: 640px) { .setup-shell { padding: var(--space-3); align-items: start; } .setup-card { padding: var(--space-5); border-radius: var(--radius-lg); } .preview-heading { align-items: flex-start; flex-direction: column; } .entity-editor { grid-template-columns: 1fr; } .entity-editor small { grid-column: 1; } }
</style>
