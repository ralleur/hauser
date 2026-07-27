import { describe, expect, it, vi } from 'vitest';
import { tickscale } from './tickscale.ts';

type Handler = (event: any) => void;

class TestClassList {
  private classes = new Set<string>();
  add(cls: string) { this.classes.add(cls); }
  remove(cls: string) { this.classes.delete(cls); }
  contains(cls: string) { return this.classes.has(cls); }
}

class TestNode {
  private listeners = new Map<string, Handler[]>();
  readonly classList = new TestClassList();
  capturedPointer: number | null = null;

  constructor(private rect: { left: number; top: number; width: number; height: number }) {}

  addEventListener(type: string, handler: Handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  removeEventListener(type: string, handler: Handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((h) => h !== handler));
  }

  getBoundingClientRect() { return this.rect; }
  setPointerCapture(pointerId: number) { this.capturedPointer = pointerId; }

  dispatch(type: string, init: Record<string, unknown> = {}) {
    let defaultPrevented = false;
    const event = {
      button: 0,
      clientX: this.rect.left,
      clientY: this.rect.top,
      pointerId: 1,
      key: '',
      ...init,
      preventDefault: () => { defaultPrevented = true; },
      get defaultPrevented() { return defaultPrevented; },
    };
    for (const handler of this.listeners.get(type) ?? []) handler(event);
    return event;
  }
}

describe('tickscale action', () => {
  it('clamped Pointer-Werte: vertikal oben=max und unten=min', () => {
    const onChange = vi.fn();
    const node = new TestNode({ left: 0, top: 0, width: 40, height: 100 });
    tickscale(node as unknown as HTMLElement, { value: 50, min: 1, max: 100, orientation: 'vertical', onChange });

    node.dispatch('pointerdown', { clientY: -50 });
    expect(onChange).toHaveBeenLastCalledWith(100, false);

    node.dispatch('pointermove', { clientY: 150 });
    expect(onChange).toHaveBeenLastCalledWith(1, false);

    node.dispatch('pointerup', { clientY: 150 });
    expect(onChange).toHaveBeenLastCalledWith(1, true);
    expect(node.classList.contains('is-dragging')).toBe(false);
  });

  it('rundet Pointer-Werte auf step und horizontal gilt links=min', () => {
    const onChange = vi.fn();
    const node = new TestNode({ left: 0, top: 0, width: 100, height: 40 });
    tickscale(node as unknown as HTMLElement, { value: 0, min: 0, max: 100, step: 10, orientation: 'horizontal', onChange });

    node.dispatch('pointerdown', { clientX: 0 });
    expect(onChange).toHaveBeenLastCalledWith(0, false);

    node.dispatch('pointermove', { clientX: 44 });
    expect(onChange).toHaveBeenLastCalledWith(40, false);
  });

  it('Keyboard: Pfeile, Home und End committen final', () => {
    const onChange = vi.fn();
    const node = new TestNode({ left: 0, top: 0, width: 40, height: 100 });
    const action = tickscale(node as unknown as HTMLElement, {
      value: 50,
      min: 0,
      max: 100,
      step: 1,
      keyStep: 5,
      orientation: 'vertical',
      onChange,
    });

    const arrow = node.dispatch('keydown', { key: 'ArrowUp' });
    expect(arrow.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(55, true);

    action.update({ value: 55, min: 0, max: 100, step: 1, keyStep: 5, orientation: 'vertical', onChange });
    node.dispatch('keydown', { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0, true);

    action.update({ value: 0, min: 0, max: 100, step: 1, keyStep: 5, orientation: 'vertical', onChange });
    node.dispatch('keydown', { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(100, true);
  });
});
