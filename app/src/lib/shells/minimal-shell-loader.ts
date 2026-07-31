import { mount } from 'svelte';

/** The only module graph needed for the provisional, backend-free first paint. */
export async function mountMinimalShell(target: HTMLElement): Promise<Record<string, any>> {
  const { default: MinimalAppShell } = await import('./MinimalAppShell.svelte');
  return mount(MinimalAppShell, { target });
}
