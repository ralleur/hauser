import { m } from '../../paraglide/messages.js';

export interface MinimalShellConfigStatus {
  code: 'HOUSEHOLD_CONFIG_INVALID' | 'HOUSEHOLD_CONFIG_UNSUPPORTED' | 'HOUSEHOLD_CONFIG_UNAVAILABLE' | 'HOUSEHOLD_CONFIG_VALIDATION_FAILED';
  message: string;
}

const INVALID_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_INVALID',
  get message() { return m.minimal_cause_invalid(); },
};
const UNSUPPORTED_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_UNSUPPORTED',
  get message() { return m.minimal_cause_unsupported(); },
};
const UNAVAILABLE_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_UNAVAILABLE',
  get message() { return m.minimal_cause_unavailable(); },
};
const VALIDATION_STATUS: MinimalShellConfigStatus = {
  code: 'HOUSEHOLD_CONFIG_VALIDATION_FAILED',
  get message() { return m.minimal_cause_validation(); },
};

/* Die Ursache in einem Satz — mehr sagt die Uhr-Ansicht nicht. Sie ersetzt den
   allgemeinen Satz unter dem Wochenband, sobald die Prüfung einen Grund kennt. */
export function publishMinimalShellConfigStatus(
  code: unknown,
  root: Pick<Document, 'querySelector'> | null = typeof document === 'undefined' ? null : document,
): MinimalShellConfigStatus {
  const status = code === 'HOUSEHOLD_CONFIG_INVALID' || code === 'HOUSEHOLD_CONFIG_INVALID_JSON'
    ? INVALID_STATUS
    : typeof code === 'string' && [
      'HOUSEHOLD_CONFIG_AMBIGUOUS_ROOM_ROLE',
      'HOUSEHOLD_CONFIG_MEDIA_TARGET_REQUIRED',
      'HOUSEHOLD_CONFIG_HOME_MODULE_REQUIRED',
      'HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION',
      'HOUSEHOLD_CONFIG_DUPLICATE_NAVIGATION_TARGET',
      'HOUSEHOLD_CONFIG_HOME_NAVIGATION_REQUIRED',
      'HOUSEHOLD_CONFIG_SONG_TARGETS_MISSING',
      'HOUSEHOLD_CONFIG_PROJECTION_FAILED',
    ].includes(code)
      ? UNSUPPORTED_STATUS
      : code === 'HOUSEHOLD_CONFIG_VALIDATION_FAILED' || code === 'HOUSEHOLD_CONFIG_VALIDATION_SCHEDULING_FAILED'
        ? VALIDATION_STATUS
        : UNAVAILABLE_STATUS;
  const shell = root?.querySelector<HTMLElement>('[data-shell="minimal"]');
  const cause = shell?.querySelector<HTMLElement>('.minimal-shell__cause');
  if (cause) cause.textContent = status.message;
  return status;
}
