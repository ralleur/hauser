import {
  assessPressLatency,
  type PressLatencySample,
} from './phase4-metrics.ts';

const MAX_PRESS_SAMPLES = 80;

type Phase4MetricsState = {
  pressSamples: PressLatencySample[];
  latestPress: PressLatencySample | null;
};

export const phase4Metrics = $state<Phase4MetricsState>({
  pressSamples: [],
  latestPress: null,
});

function describePressTarget(el: HTMLElement): string {
  return (
    el.getAttribute('aria-label') ||
    el.dataset.nav ||
    el.dataset.item ||
    el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 32) ||
    el.className.toString().split(/\s+/)[0] ||
    el.tagName.toLowerCase()
  );
}

export function recordPressLatency(valueMs: number, target: string, at = Date.now()) {
  const assessed = assessPressLatency(valueMs);
  const sample: PressLatencySample = {
    valueMs: Number(assessed.valueMs.toFixed(1)),
    passed: assessed.passed,
    target,
    at,
  };
  phase4Metrics.latestPress = sample;
  phase4Metrics.pressSamples = [...phase4Metrics.pressSamples.slice(-(MAX_PRESS_SAMPLES - 1)), sample];
  return sample;
}

export function measurePressedPaint(el: HTMLElement, startedAt: number, raf = requestAnimationFrame) {
  const target = describePressTarget(el);
  raf((paintAt) => {
    // Wenn der Nutzer vor dem nächsten Frame loslässt, wurde der Pressed-State
    // real nicht sichtbar. Für Phase 4 bewusst nur gehaltene/gerenderte Presses messen.
    if (!el.classList.contains('is-pressed')) return;
    recordPressLatency(paintAt - startedAt, target);
  });
}

export function resetPhase4Metrics() {
  phase4Metrics.pressSamples = [];
  phase4Metrics.latestPress = null;
}
