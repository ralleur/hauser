import { describe, expect, it, vi } from 'vitest';
import { publishMinimalShellConfigStatus } from './minimal-shell-status.ts';

function statusRoot() {
  const cause = { textContent: '' };
  const shell = {
    querySelector: vi.fn(() => cause),
  };
  const root = {
    querySelector: vi.fn(() => shell),
  } as unknown as Pick<Document, 'querySelector'>;
  return { root, shell, cause };
}

describe('minimal shell config status seam', () => {
  it.each([
    ['HOUSEHOLD_CONFIG_INVALID_JSON', 'HOUSEHOLD_CONFIG_INVALID', 'Die Haushaltskonfiguration ist fehlerhaft.'],
    ['HOUSEHOLD_CONFIG_NOT_READABLE', 'HOUSEHOLD_CONFIG_UNAVAILABLE', 'Der Server hat die Konfiguration nicht geliefert.'],
    ['HOUSEHOLD_CONFIG_UNSUPPORTED_NAVIGATION', 'HOUSEHOLD_CONFIG_UNSUPPORTED', 'Diese Fassung versteht die Konfiguration nicht.'],
    ['HOUSEHOLD_CONFIG_VALIDATION_FAILED', 'HOUSEHOLD_CONFIG_VALIDATION_FAILED', 'Die sichere Prüfung ist ausgefallen.'],
  ])('maps %s to one controlled sentence under the clock', (input, code, message) => {
    const dom = statusRoot();

    const status = publishMinimalShellConfigStatus(input, dom.root);

    expect(status).toMatchObject({ code, message });
    // Keine Zeile über lokale Nutzbarkeit mehr — nur die Ursache (R2).
    expect(status.message).not.toMatch(/lokal|Lokal/);
    expect(dom.shell.querySelector).toHaveBeenCalledWith('.minimal-shell__cause');
    expect(dom.cause.textContent).toBe(message);
  });

  it('never exposes malformed codes or raw errors', () => {
    const secret = 'token=very-secret\nError: /private/config.json';
    const dom = statusRoot();
    const status = publishMinimalShellConfigStatus(secret, dom.root);

    expect({ ...status }).toEqual({
      code: 'HOUSEHOLD_CONFIG_UNAVAILABLE',
      message: 'Der Server hat die Konfiguration nicht geliefert.',
    });
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(JSON.stringify(status)).not.toMatch(/very-secret|private\/config/);
    expect(dom.cause.textContent).not.toMatch(/very-secret|private\/config/);
  });
});
