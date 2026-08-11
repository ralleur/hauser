import { describe, expect, it } from 'vitest';
import { setupActivationErrorMessageKey } from './setup-activation-error.ts';

describe('setup activation error messages', () => {
  it.each([
    ['SETUP_HOME_ASSISTANT_AUTH_FAILED', 'setup_ha_activation_auth_failed'],
    ['SETUP_HOME_ASSISTANT_UNREACHABLE', 'setup_ha_activation_unreachable'],
    ['SETUP_HOME_ASSISTANT_HTTP_ERROR', 'setup_ha_activation_http_error'],
    ['SETUP_UNKNOWN_ERROR', 'setup_activate_failed'],
  ])('maps %s to %s', (code, expectedKey) => {
    expect(setupActivationErrorMessageKey(code)).toBe(expectedKey);
  });
});
