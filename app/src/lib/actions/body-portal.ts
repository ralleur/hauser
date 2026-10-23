// SPDX-License-Identifier: AGPL-3.0-only
/** Image dialogs can open from transformed room/settings surfaces. */
export function bodyPortal(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy() { node.remove(); } };
}
