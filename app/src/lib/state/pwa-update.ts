export interface PwaUpdateCoordinator {
  readonly pending: boolean;
  requestActivation(): void;
  setSafeToActivate(safe: boolean): void;
}

export function createPwaUpdateCoordinator(
  activate: () => Promise<void>,
  initiallySafe = false,
): PwaUpdateCoordinator {
  let pending = false;
  let safe = initiallySafe;
  let activating = false;
  let retryBlocked = false;

  const flush = () => {
    if (!pending || !safe || activating || retryBlocked) return;
    activating = true;
    pending = false;
    void activate().catch(() => {
      pending = true;
      retryBlocked = true;
    }).finally(() => {
      activating = false;
      flush();
    });
  };

  return {
    get pending() { return pending; },
    requestActivation() {
      pending = true;
      flush();
    },
    setSafeToActivate(next) {
      if (next !== safe) retryBlocked = false;
      safe = next;
      flush();
    },
  };
}