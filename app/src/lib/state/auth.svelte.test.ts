import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Reason = 'missing-token' | 'invalid-auth';

  class MockHaBackend {
    token = false;
    authCallback: ((reason: Reason) => void) | null = null;

    hasToken(): boolean { return this.token; }
    onAuthError(cb: (reason: Reason) => void): void { this.authCallback = cb; }
    setToken(token: string): void { this.token = token.length > 0; }
    emitAuth(reason: Reason): void { this.authCallback?.(reason); }
  }

  return { MockHaBackend, backend: new MockHaBackend() };
});

vi.mock('../adapter/ha-backend.ts', () => ({ HaBackend: mocks.MockHaBackend }));
vi.mock('../adapter/runtime.svelte.ts', () => ({ backend: mocks.backend }));

import { authState, syncAuthState } from './auth.svelte.ts';

beforeEach(() => {
  mocks.backend.token = false;
  const state = authState();
  state.invalid = false;
  syncAuthState();
});

describe('Home-Assistant-Authentifizierung', () => {
  it('behandelt einen fehlenden Token als normale Ersteinrichtung', () => {
    mocks.backend.emitAuth('missing-token');

    expect(authState()).toMatchObject({ usingHa: true, needsToken: true, invalid: false });
  });

  it('markiert ausschließlich ERR_INVALID_AUTH als ungültige Anmeldung', () => {
    mocks.backend.emitAuth('invalid-auth');

    expect(authState()).toMatchObject({ usingHa: true, needsToken: true, invalid: true });
  });
});
