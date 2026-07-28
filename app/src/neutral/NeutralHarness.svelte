<script lang="ts">
  import type { LightValue } from '../lib/adapter/types.ts';
  import type { NeutralRuntimeResult } from '../lib/config/neutral-runtime.ts';

  let { result }: { result: NeutralRuntimeResult } = $props();
  let values = $state<Record<string, unknown>>({});

  $effect(() => {
    if (result.status !== 'ready') return;
    result.backend.subscribe((entityId, value) => {
      values[entityId] = value;
    });
  });

  const firstLight = $derived(result.status === 'ready'
    ? result.model.rooms
      .flatMap(({ visibleEntities }) => visibleEntities)
      .find(({ role }) => role === 'light')
    : undefined);

  function lightIsOn(entityId: string): boolean {
    return Boolean((values[entityId] as LightValue | undefined)?.on);
  }

  function toggleFirstLight(): void {
    if (result.status !== 'ready' || !firstLight) return;
    result.backend.callService('light', 'toggle', firstLight.entityId, {});
  }
</script>

{#if result.status === 'error'}
  <main
    class="harness error"
    data-testid="neutral-error"
    data-status="error"
    data-error-code={result.code}
  >
    <p class="eyebrow">Neutral household harness</p>
    <h1>Konfiguration nicht verfügbar</h1>
    <p data-testid="neutral-error-code">{result.code}</p>
    <p>{result.message}</p>
  </main>
{:else}
  <main
    class="harness"
    data-testid="neutral-harness"
    data-status="ready"
    data-backend="fake"
  >
    <header>
      <p class="eyebrow">Isolierter Akzeptanz-Harness</p>
      <h1>Neutraler Haushalt</h1>
      <dl class="facts">
        <div>
          <dt>Config-ID</dt>
          <dd data-testid="household-id">{result.configId}</dd>
        </div>
        <div>
          <dt>Backend</dt>
          <dd data-testid="backend-type">{result.backendType}</dd>
        </div>
      </dl>
    </header>

    <section aria-labelledby="orders-title">
      <h2 id="orders-title">Semantische Reihenfolgen</h2>
      <p
        data-testid="room-order"
        data-room-order={result.model.rooms.map(({ id }) => id).join(',')}
      >
        Räume: {result.model.rooms.map(({ id }) => id).join(', ')}
      </p>
      <p
        data-testid="navigation-order"
        data-navigation-order={result.model.navigation.map(({ id }) => id).join(',')}
      >
        Navigation: {result.model.navigation.map(({ id }) => id).join(', ')}
      </p>
    </section>

    {#if firstLight}
      <section aria-labelledby="control-title">
        <h2 id="control-title">FakeBackend-Echo</h2>
        <p
          data-testid="light-value"
          data-entity-id={firstLight.entityId}
          data-light-on={String(lightIsOn(firstLight.entityId))}
        >
          {firstLight.name}: {lightIsOn(firstLight.entityId) ? 'an' : 'aus'}
        </p>
        <button
          type="button"
          data-testid="light-toggle"
          data-entity-id={firstLight.entityId}
          aria-pressed={lightIsOn(firstLight.entityId)}
          onclick={toggleFirstLight}
        >
          {firstLight.name} umschalten
        </button>
      </section>
    {/if}

    <section aria-labelledby="rooms-title">
      <h2 id="rooms-title">Sichtbare Entitäten je Raum</h2>
      <div class="rooms">
        {#each result.model.rooms as room}
          <article data-testid="room" data-room-id={room.id}>
            <h3>{room.name} <span>{room.id}</span></h3>
            {#if room.visibleEntities.length === 0}
              <p data-testid="room-empty">Keine sichtbaren Entitäten</p>
            {:else}
              <ul>
                {#each room.visibleEntities as entity}
                  <li
                    data-testid="visible-entity"
                    data-room-id={room.id}
                    data-entity-id={entity.entityId}
                    data-entity-role={entity.role}
                  >
                    <strong>{entity.name}</strong>
                    <span>{entity.entityId}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  </main>
{/if}

<style>
  .harness {
    display: grid;
    gap: var(--space-6);
    min-height: 100dvh;
    padding: var(--space-6);
    background: var(--color-surface-0);
    color: var(--color-text-primary);
  }

  .error {
    align-content: center;
  }

  header,
  section,
  article {
    display: grid;
    gap: var(--space-3);
  }

  section,
  article,
  .facts > div {
    padding: var(--space-4);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
  }

  .eyebrow,
  dt,
  article h3 span,
  li span {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
  }

  .eyebrow,
  dt {
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
  }

  h1 {
    font-size: var(--text-2xl);
    line-height: var(--leading-tight);
  }

  h2 {
    font-size: var(--text-lg);
  }

  h3 {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-md);
  }

  .facts,
  .rooms {
    display: grid;
    gap: var(--space-4);
  }

  .facts > div {
    gap: var(--space-1);
  }

  ul {
    display: grid;
    gap: var(--space-2);
    list-style: none;
  }

  li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding-block: var(--space-2);
  }

  button {
    min-height: var(--touch-min);
    padding: var(--space-3) var(--space-4);
    border: none;
    border-radius: var(--radius-lg);
    background: var(--color-accent-warm);
    color: var(--color-text-on-accent);
    font: inherit;
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-out);
  }

  button:active {
    background: var(--color-accent-warm-hover);
  }

  button:focus-visible {
    outline: var(--space-1) solid var(--color-accent-cool);
    outline-offset: var(--space-1);
  }
</style>
