import { cameraPopupEvents } from './camera-popup-events.ts';
// SPDX-License-Identifier: AGPL-3.0-only
import { CameraPopupMatcher, parseCameraPopupRules, type CameraPopupRule } from './camera-popup.ts';
const KEY = 'hmi:camera-popups:v1';
function read() { try { return parseCameraPopupRules(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return {}; } }
const matcher = new CameraPopupMatcher();
export const cameraPopup = $state({ rules: read(), active: null as null | { camera: string; label: string; seconds: number; nonce: number } });
let nonce = 0;
export function setCameraPopupRule(camera: string, rule: CameraPopupRule) {
  cameraPopup.rules = parseCameraPopupRules({ ...cameraPopup.rules, [camera]: rule });
  matcher.reset();
  if (cameraPopup.active?.camera === camera) cameraPopup.active = null;
  try { localStorage.setItem(KEY, JSON.stringify(cameraPopup.rules)); } catch { /* Current session remains usable. */ }
}
export function cameraPopupWatchIds(): string[] {
  return Object.entries(cameraPopup.rules).flatMap(([camera, rule]) => rule.enabled && rule.trigger ? [camera, rule.trigger] : []);
}
export function resetCameraPopupTriggers() { matcher.reset(); }
export function noteCameraPopupState(id: string, state: string | undefined) {
  if (!Object.values(cameraPopup.rules).some(rule => rule.enabled && rule.trigger === id)) return;
  const camera = matcher.update(id, state, cameraPopup.rules);
  if (!camera || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  const rule = cameraPopup.rules[camera];
  cameraPopup.active = { camera, label: rule.label || camera, seconds: rule.seconds, nonce: ++nonce };
}

cameraPopupEvents.state = noteCameraPopupState;
cameraPopupEvents.reset = resetCameraPopupTriggers;
