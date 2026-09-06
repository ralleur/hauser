/* ── Der Server denkt voraus (Paket 11, docs/20) ──

   Nachts, wenn niemand hinschaut, wird fertig gemacht, was tagsüber Wartezeit
   wäre: der Stadtplan neu gerendert, fehlende Phone-Ableitungen der Raumbilder
   nachgezogen, die Energiestatistik der Vorwoche als Datei abgelegt.

   Der Lauf ist bewusst genügsam: jede Aufgabe ist einzeln abschaltbar, jede
   darf fehlschlagen, ohne die anderen zu verhindern, und das Ergebnis steht
   als kleine Zusammenfassung bereit (Health, Diagnose). Ausgelöst wird über
   einen Timer, nicht über eine Anfrage — der Auslöser gehört dem Server. */

export const NIGHTLY_HOUR = 3;
export const NIGHTLY_MINUTE = 30;

/** Millisekunden bis zum nächsten nächtlichen Lauf. */
export function msUntilNightly(now, hour = NIGHTLY_HOUR, minute = NIGHTLY_MINUTE) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Montag 00:00 der Vorwoche bis Montag 00:00 dieser Woche. */
export function previousWeekRange(now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const weekday = (start.getDay() + 6) % 7; // Montag = 0
  start.setDate(start.getDate() - weekday - 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * Führt die angemeldeten Aufgaben nacheinander aus und fasst zusammen, was
 * dabei herauskam. Ein Fehler wird notiert, nicht geworfen.
 * @param {{ name: string, run: () => Promise<unknown> }[]} tasks
 */
export async function runPrecompute(tasks, now = () => Date.now()) {
  const at = now();
  const results = [];
  for (const task of tasks) {
    try {
      const detail = await task.run();
      results.push({ name: task.name, ok: true, detail: detail ?? null });
    } catch (error) {
      results.push({
        name: task.name,
        ok: false,
        detail: error instanceof Error ? error.message : 'unbekannter Fehler',
      });
    }
  }
  return { at, ok: results.every((entry) => entry.ok), tasks: results };
}

/**
 * Hängt den nächtlichen Lauf an einen Timer. Rückgabe beendet ihn wieder.
 * Der Timer hält den Prozess nicht wach (`unref`) — ein Server, der beendet
 * wird, soll nicht auf die Nacht warten.
 */
export function scheduleNightly(tasks, {
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onResult = () => {},
} = {}) {
  let handle = null;
  let stopped = false;

  function arm() {
    if (stopped) return;
    handle = setTimer(() => {
      void runPrecompute(tasks).then((result) => {
        onResult(result);
        arm();
      });
    }, msUntilNightly(now()));
    handle?.unref?.();
  }

  arm();
  return () => {
    stopped = true;
    if (handle) clearTimer(handle);
    handle = null;
  };
}
