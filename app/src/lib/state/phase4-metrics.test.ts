import { describe, expect, it } from 'vitest';
import {
  PHASE4_PRESS_BUDGET_MS,
  assessPressLatency,
  formatPressLatency,
  summarizePressLatencies,
} from './phase4-metrics.ts';

describe('phase4 press latency metrics', () => {
  it('uses the Phase 4 <16 ms pressed-state budget', () => {
    expect(PHASE4_PRESS_BUDGET_MS).toBe(16);
    expect(assessPressLatency(15.9).passed).toBe(true);
    expect(assessPressLatency(16).passed).toBe(false);
  });

  it('formats the latest pointerdown to pressed-paint latency for the HUD', () => {
    expect(formatPressLatency({ valueMs: 8.24, passed: true, target: 'Home', at: 1000 })).toBe('press 8.2 ms ✓ Home');
    expect(formatPressLatency({ valueMs: 19.9, passed: false, target: 'Dimmer', at: 1000 })).toBe('press 19.9 ms ⚠ Dimmer');
  });

  it('summarizes sample count, max latency, and failures', () => {
    expect(summarizePressLatencies([])).toEqual({ count: 0, maxMs: 0, failures: 0 });
    expect(summarizePressLatencies([
      { valueMs: 7.2, passed: true, target: 'A', at: 1 },
      { valueMs: 17.4, passed: false, target: 'B', at: 2 },
      { valueMs: 12.1, passed: true, target: 'C', at: 3 },
    ])).toEqual({ count: 3, maxMs: 17.4, failures: 1 });
  });
});
