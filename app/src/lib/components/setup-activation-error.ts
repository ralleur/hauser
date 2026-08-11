export type SetupActivationErrorMessageKey =
  | 'setup_ha_activation_auth_failed'
  | 'setup_ha_activation_unreachable'
  | 'setup_ha_activation_http_error'
  | 'setup_activate_failed';

export function setupActivationErrorMessageKey(code: unknown): SetupActivationErrorMessageKey {
  switch (code) {
    case 'SETUP_HOME_ASSISTANT_AUTH_FAILED':
      return 'setup_ha_activation_auth_failed';
    case 'SETUP_HOME_ASSISTANT_UNREACHABLE':
      return 'setup_ha_activation_unreachable';
    case 'SETUP_HOME_ASSISTANT_HTTP_ERROR':
      return 'setup_ha_activation_http_error';
    default:
      return 'setup_activate_failed';
  }
}
