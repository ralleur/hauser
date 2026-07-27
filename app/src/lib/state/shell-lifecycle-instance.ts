import { endTransition } from './nav.svelte.ts';
import { createShellLifecycle } from './shell-lifecycle.ts';

export const shellLifecycle = createShellLifecycle(endTransition);
