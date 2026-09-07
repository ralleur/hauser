<script lang="ts">
  /* Eine Uhr geht nie aus (R2): Fehlt der Haushalt oder das Backend, zeigt das
     Panel trotzdem Uhrzeit, Datum und die kommenden Tage — im Stil des
     Standby. Kein nachgebautes Dashboard, keine Zeile über lokale
     Nutzbarkeit. Unten, klein: die Ursache in einem Satz und der Weg zurück.

     Alles kommt aus der Gerätezeit; diese Shell fragt nichts ab und lädt
     keine produktiven Module. */
  import { onMount } from 'svelte';
  import './minimal-app-shell.css';
  import { m } from '../../paraglide/messages.js';
  import { getLocale, baseLocale } from '../../paraglide/runtime.js';

  const WEEK_DAYS = 7;
  const TICK_MS = 10_000;

  function locale(): string {
    try { return getLocale(); } catch { return baseLocale; }
  }

  function snapshot() {
    const tag = locale();
    const now = new Date();
    return {
      time: now.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' }),
      date: now.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' }),
      week: Array.from({ length: WEEK_DAYS }, (_, offset) => {
        const day = new Date(now);
        day.setDate(day.getDate() + offset);
        return {
          key: `${day.getMonth()}-${day.getDate()}`,
          weekday: day.toLocaleDateString(tag, { weekday: 'short' }).replace('.', ''),
          dayOfMonth: day.getDate(),
          today: offset === 0,
        };
      }),
    };
  }

  let view = $state(snapshot());
  const refresh = () => { view = snapshot(); };

  onMount(() => {
    const id = setInterval(refresh, TICK_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  });

  /* Der einzige Ausweg aus dieser Ansicht: neu laden. Sie erscheint, wenn die
     Haushaltskonfiguration fehlt oder nicht gilt — beides kann sich mit einem
     zweiten Versuch erledigt haben. */
  function reload(): void {
    location.reload();
  }
</script>

<div class="minimal-shell" data-shell="minimal">
  <main class="minimal-shell__stage">
    <div class="minimal-shell__clock num" role="status" aria-live="off">{view.time}</div>
    <div class="minimal-shell__date">{view.date}</div>
  </main>

  <section class="minimal-shell__week" aria-hidden="true">
    {#each view.week as day (day.key)}
      <div class="minimal-shell__week-day" class:is-today={day.today}>
        <span class="minimal-shell__week-name">{day.weekday}</span>
        <span class="minimal-shell__week-num num">{day.dayOfMonth}</span>
      </div>
    {/each}
  </section>

  <!-- Ursache in einem Satz, direkt daneben der Weg zurück. Den Satz
       ersetzt publishMinimalShellConfigStatus, sobald die Prüfung einen
       Grund kennt. -->
  <footer class="minimal-shell__recovery">
    <p class="minimal-shell__cause">{m.minimal_cause_unknown()}</p>
    <button class="minimal-shell__reload" type="button" onclick={reload}>{m.minimal_reload()}</button>
  </footer>
</div>
