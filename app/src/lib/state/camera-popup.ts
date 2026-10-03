// SPDX-License-Identifier: AGPL-3.0-only
export interface CameraPopupRule { enabled: boolean; trigger: string; seconds: number; label: string }
export const defaultCameraPopupRule = (): CameraPopupRule => ({ enabled: false, trigger: '', seconds: 30, label: '' });
export function parseCameraPopupRules(value: unknown): Record<string, CameraPopupRule> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, CameraPopupRule> = {};
  for (const [camera, raw] of Object.entries(value)) {
    if (!camera.startsWith('camera.') || !raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const trigger = typeof row.trigger === 'string' && /^(binary_sensor|event|input_boolean)\.[\w]+$/.test(row.trigger) ? row.trigger : '';
    out[camera] = { enabled: row.enabled === true, trigger,
      seconds: typeof row.seconds === 'number' && Number.isFinite(row.seconds) ? Math.max(5, Math.min(120, Math.round(row.seconds))) : 30,
      label: typeof row.label === 'string' ? row.label : camera };
  }
  return out;
}
export function cameraPopupFires(id: string, previous: string | undefined, next: string | undefined): boolean {
  const valid = (value: string | undefined) => !!value && !['unknown', 'unavailable'].includes(value);
  return valid(previous) && valid(next) && previous !== next
    && (id.startsWith('event.') || (previous === 'off' && next === 'on'));
}
export class CameraPopupMatcher {
  private states = new Map<string, string>();
  reset() { this.states.clear(); }
  update(id: string, next: string | undefined, rules: Record<string, CameraPopupRule>): string | null {
    const previous = this.states.get(id);
    if (next === undefined) this.states.delete(id); else this.states.set(id, next);
    if (!cameraPopupFires(id, previous, next)) return null;
    return Object.keys(rules).sort().find((camera) => rules[camera].enabled && rules[camera].trigger === id) ?? null;
  }
}
