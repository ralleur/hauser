type ScheduleTimeout = (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export interface HaRetryController {
  beforeStart(): void;
  schedule(): void;
  reset(): void;
}

/**
 * Kapselt HA-Backoff, Timer und den einen Online-Listener. Das Modul wird erst
 * über den bestehenden Post-Paint-Import geladen; die Retry-Zustandsmaschine
 * vergrößert dadurch nicht den Phone-Startup-Graphen.
 */
export function createHaRetryController(
  retry: () => void,
  scheduleTimeout: ScheduleTimeout = setTimeout,
): HaRetryController {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onlineListening = false;
  const onlineTarget = typeof window === 'undefined' ? null : window;

  function beforeStart(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function trigger(): void {
    beforeStart();
    retry();
  }

  function schedule(): void {
    if (timer !== null) return;
    const delay = Math.min(RETRY_BASE_MS * (2 ** attempt), RETRY_MAX_MS);
    attempt += 1;
    timer = scheduleTimeout(trigger, delay);
    if (!onlineListening && onlineTarget) {
      onlineTarget.addEventListener('online', trigger);
      onlineListening = true;
    }
  }

  function reset(): void {
    beforeStart();
    attempt = 0;
    if (onlineListening) onlineTarget?.removeEventListener('online', trigger);
    onlineListening = false;
  }

  return { beforeStart, schedule, reset };
}
