import { afterEach, describe, expect, it, vi } from 'vitest';
import { longpress } from './longpress.ts';

type Handler = (event: any) => void;

class TestNode {
  private listeners = new Map<string, { handler: Handler; capture: boolean }[]>();

  addEventListener(type: string, handler: Handler, options?: AddEventListenerOptions | boolean) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { handler, capture }]);
  }

  removeEventListener(type: string, handler: Handler, options?: EventListenerOptions | boolean) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l.handler !== handler || l.capture !== capture),
    );
  }

  dispatch(type: string, init: Record<string, unknown> = {}) {
    let defaultPrevented = false;
    let propagationStopped = false;
    let immediateStopped = false;
    const event = {
      button: 0,
      clientX: 0,
      clientY: 0,
      type,
      ...init,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => { propagationStopped = true; },
      stopImmediatePropagation: () => { immediateStopped = true; propagationStopped = true; },
      get defaultPrevented() { return defaultPrevented; },
      get propagationStopped() { return propagationStopped; },
      get immediateStopped() { return immediateStopped; },
    };
    const listeners = this.listeners.get(type) ?? [];
    for (const { handler } of listeners.filter((l) => l.capture)) {
      if (immediateStopped) break;
      handler(event);
    }
    // Same-target bubble listeners still run after stopPropagation(); only
    // stopImmediatePropagation() suppresses the Svelte onclick on the same node.
    for (const { handler } of listeners.filter((l) => !l.capture)) {
      if (immediateStopped) break;
      handler(event);
    }
    return event;
  }
}

afterEach(() => vi.useRealTimers());

describe('longpress action', () => {
  it('feuert nach dem konfigurierten Delay', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const node = new TestNode();
    longpress(node as unknown as HTMLElement, { onLongPress: fired, ms: 120 });

    node.dispatch('pointerdown');
    vi.advanceTimersByTime(119);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledOnce();
  });

  it('bricht bei Bewegung über der Toleranz ab', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const node = new TestNode();
    longpress(node as unknown as HTMLElement, { onLongPress: fired, ms: 120 });

    node.dispatch('pointerdown', { clientX: 10, clientY: 10 });
    node.dispatch('pointermove', { clientX: 21, clientY: 10 });
    vi.advanceTimersByTime(120);

    expect(fired).not.toHaveBeenCalled();
  });

  it('schluckt den unmittelbar folgenden Click nach einem Long-Press', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const click = vi.fn();
    const node = new TestNode();
    longpress(node as unknown as HTMLElement, { onLongPress: fired, ms: 50 });
    node.addEventListener('click', click);

    node.dispatch('pointerdown');
    vi.advanceTimersByTime(50);
    const event = node.dispatch('click');

    expect(fired).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(click).not.toHaveBeenCalled();
  });
});
