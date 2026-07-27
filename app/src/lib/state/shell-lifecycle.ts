export interface ShellLifecycle {
  register(closePresentation: () => void): () => void;
  prepareChange(): void;
}

export function createShellLifecycle(endPresentationTransition: () => void): ShellLifecycle {
  let activeClose: (() => void) | null = null;
  return {
    register(closePresentation) {
      activeClose = closePresentation;
      return () => {
        if (activeClose === closePresentation) activeClose = null;
      };
    },
    prepareChange() {
      activeClose?.();
      endPresentationTransition();
    },
  };
}
