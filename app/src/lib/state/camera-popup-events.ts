// SPDX-License-Identifier: AGPL-3.0-only
export const cameraPopupEvents: {
  state?: (id: string, state: string | undefined) => void;
  reset?: () => void;
} = {};
