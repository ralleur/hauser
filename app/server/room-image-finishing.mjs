/* ── Feinschliff eines frisch veröffentlichten Bildsets (Paket 13) ──

   Nach dem Wizard fehlen einem Set noch zwei Dinge, die beide einen
   Anbieteraufruf kosten: die erkannten Flächen (Fenster, Boden, Möbel) und die
   trübe Bildvariante. Bisher holte das erst der nächtliche Nachzug — wer sechs
   Räume neu anlegt, wartet damit Nächte. Deshalb hängt der Feinschliff jetzt
   direkt hinter der Veröffentlichung.

   Drei Eigenschaften, die hier wichtig sind:

   — **Nach dem Publish, nicht darin.** Der Publish-Vorgang ist transaktional;
     ein hängender Modellaufruf darf ihn nicht aufhalten und ein Fehlschlag ihn
     nicht rückgängig machen. Der Wizard meldet „gespeichert", der Feinschliff
     läuft danach.
   — **Einer nach dem anderen.** Sechs Räume hintereinander ergäben sonst
     zwölf gleichzeitige Anbieteraufrufe; die enden in 429ern.
   — **Wiederholbar.** Was schon im Katalog steht, wird übersprungen. Ein
     zweiter Anlauf (Replay des Publish, erneuter Aufruf) kostet nichts.

   Was hier scheitert, bleibt liegen und wird vom nächtlichen Lauf erneut
   versucht — dieses Netz bleibt bewusst gespannt. */

/** @typedef {'pending' | 'running' | 'done' | 'already' | 'failed' | 'skipped'} FinishStep */

export function createRoomImageFinisher({
  assetStore,
  detectRegions,
  deriveOvercast,
  now = () => Date.now(),
} = {}) {
  /** assetId → Zustand des letzten Laufs, für Diagnose und Health. */
  const states = new Map();
  /** assetId → laufender Durchgang, damit ein zweiter Aufruf sich anhängt. */
  const running = new Map();
  /* Eine einzige Kette: der nächste Durchgang startet, wenn der vorige steht. */
  let queue = Promise.resolve();

  function activeEntry(assetId) {
    try { return assetStore?.activeEntry(assetId) ?? null; } catch { return null; }
  }

  async function step(state, key, has, run) {
    if (has) { state[key] = 'already'; return; }
    state[key] = 'running';
    let result;
    try { result = await run(); } catch { result = { ok: false, code: 'FINISH_FAILED' }; }
    state[key] = result?.ok ? 'done' : 'failed';
    if (!result?.ok) state.codes[key] = result?.code ?? 'FINISH_FAILED';
  }

  async function run(assetId) {
    const state = {
      assetId, status: 'running', startedAt: now(), finishedAt: null,
      regions: 'pending', overcast: 'pending', codes: {},
    };
    states.set(assetId, state);
    const entry = activeEntry(assetId);
    if (!entry) {
      state.status = 'done'; state.regions = 'skipped'; state.overcast = 'skipped';
      state.finishedAt = now();
      return state;
    }
    /* Erst die Flächen: sie sind der Grund für den Feinschliff. Die trübe
       Variante ist Beiwerk und darf hinten anstehen. */
    if (typeof detectRegions === 'function') {
      await step(state, 'regions', !!entry.regions, () => detectRegions(assetId));
    } else state.regions = 'skipped';
    if (typeof deriveOvercast === 'function') {
      await step(state, 'overcast', !!entry.files?.overcast, () => deriveOvercast(assetId));
    } else state.overcast = 'skipped';
    state.status = 'done';
    state.finishedAt = now();
    return state;
  }

  /** Stößt den Feinschliff an. Mehrfachaufrufe für dasselbe Set teilen sich
      einen Durchgang; verschiedene Sets laufen nacheinander. */
  function finish(assetId) {
    const inFlight = running.get(assetId);
    if (inFlight) return inFlight;
    const started = queue.then(() => run(assetId)).catch(() => states.get(assetId) ?? null);
    queue = started;
    running.set(assetId, started);
    void started.finally(() => {
      if (running.get(assetId) === started) running.delete(assetId);
    });
    return started;
  }

  return {
    finish,
    /** Zustand des letzten Laufs für ein Set — null, wenn nie gelaufen. */
    state: (assetId) => states.get(assetId) ?? null,
    /** Sets, deren Feinschliff gerade läuft oder wartet. */
    pending: () => [...running.keys()],
    /** Wartet, bis nichts mehr in der Kette hängt — für Tests und Abschaltung. */
    idle: () => queue.then(() => undefined, () => undefined),
  };
}
