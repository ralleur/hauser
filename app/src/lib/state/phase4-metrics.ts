export const PHASE4_PRESS_BUDGET_MS = 16;

export type PressLatencySample = {
  valueMs: number;
  passed: boolean;
  target: string;
  at: number;
};

export type PressLatencySummary = {
  count: number;
  maxMs: number;
  failures: number;
};

export function assessPressLatency(valueMs: number, budgetMs = PHASE4_PRESS_BUDGET_MS) {
  return {
    valueMs,
    budgetMs,
    passed: valueMs < budgetMs,
  };
}

export function formatPressLatency(sample: PressLatencySample | null): string {
  if (!sample) return 'press —';
  const mark = sample.passed ? '✓' : '⚠';
  return `press ${sample.valueMs.toFixed(1)} ms ${mark} ${sample.target}`;
}

export function summarizePressLatencies(samples: PressLatencySample[]): PressLatencySummary {
  if (samples.length === 0) return { count: 0, maxMs: 0, failures: 0 };
  return {
    count: samples.length,
    maxMs: Math.max(...samples.map((sample) => sample.valueMs)),
    failures: samples.filter((sample) => !sample.passed).length,
  };
}

export function formatPressSummary(summary: PressLatencySummary): string {
  if (summary.count === 0) return 'n=0';
  return `n=${summary.count} · max ${summary.maxMs.toFixed(1)} ms · fail ${summary.failures}`;
}
