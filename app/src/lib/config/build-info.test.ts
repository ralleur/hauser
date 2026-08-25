import { describe, expect, it } from 'vitest';
import {
  HAUSER_LICENSE,
  buildProvenanceProblems,
  licenseSourceView,
  mergeBuildInfo,
  normalizeRevision,
  normalizeSourceUrl,
  normalizeVersion,
  parseBuildInfo,
  resolveBuildInfo,
} from './build-info.ts';

const SHA = 'a'.repeat(39) + '7';

describe('normalizeVersion', () => {
  it('accepts release and pre-release versions', () => {
    expect(normalizeVersion('0.4.0')).toBe('0.4.0');
    expect(normalizeVersion(' 0.4.0-beta.6 ')).toBe('0.4.0-beta.6');
  });

  it('rejects empty, partial and non-string values', () => {
    for (const value of ['', 'v0.4.0', '0.4', 'unknown', null, 42]) {
      expect(normalizeVersion(value)).toBeNull();
    }
  });
});

describe('normalizeRevision', () => {
  it('accepts a full sha1 or sha256 commit id', () => {
    expect(normalizeRevision(SHA)).toBe(SHA);
    expect(normalizeRevision(SHA.toUpperCase())).toBe(SHA);
    expect(normalizeRevision('b'.repeat(64))).toBe('b'.repeat(64));
  });

  it('rejects short, dirty and placeholder revisions', () => {
    for (const value of ['', 'unknown', SHA.slice(0, 12), `${SHA}-dirty`, 'z'.repeat(40), null]) {
      expect(normalizeRevision(value)).toBeNull();
    }
  });
});

describe('normalizeSourceUrl', () => {
  it('keeps a configured fork url unchanged', () => {
    const forkUrl = 'https://git.example.org/fork/hauser/-/tree/abc';
    expect(normalizeSourceUrl(forkUrl)).toBe(forkUrl);
  });

  it('allows http only for local development', () => {
    expect(normalizeSourceUrl('http://localhost:4173/source')).toBe('http://localhost:4173/source');
    expect(normalizeSourceUrl('http://127.0.0.1:4173/source')).toBe('http://127.0.0.1:4173/source');
  });

  it('rejects foreign schemes, credentials, control characters and oversized values', () => {
    for (const value of [
      '',
      'ftp://example.com/source',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://user:secret@example.com/source',
      'https://example.com/so urce',
      'https://example.com/sou\u0000rce',
      `https://example.com/${'a'.repeat(300)}`,
      'not a url',
      null,
    ]) {
      expect(normalizeSourceUrl(value)).toBeNull();
    }
  });
});

describe('resolveBuildInfo', () => {
  it('always reports the project license and drops unusable values', () => {
    expect(resolveBuildInfo({ version: '0.4.0-beta.6', revision: SHA, sourceUrl: 'https://example.com/x' }))
      .toEqual({ version: '0.4.0-beta.6', revision: SHA, license: HAUSER_LICENSE, sourceUrl: 'https://example.com/x' });
    expect(resolveBuildInfo({ version: '', revision: 'unknown', sourceUrl: '' }))
      .toEqual({ version: null, revision: null, license: HAUSER_LICENSE, sourceUrl: null });
    expect(resolveBuildInfo(null))
      .toEqual({ version: null, revision: null, license: HAUSER_LICENSE, sourceUrl: null });
  });
});

describe('parseBuildInfo', () => {
  it('reads a served payload', () => {
    expect(parseBuildInfo({ version: '1.0.0', revision: SHA, license: HAUSER_LICENSE, sourceUrl: 'https://example.com/s' }))
      .toEqual({ version: '1.0.0', revision: SHA, license: HAUSER_LICENSE, sourceUrl: 'https://example.com/s' });
  });

  it('rejects payloads that do not declare this project license', () => {
    expect(parseBuildInfo({ version: '1.0.0', license: 'MIT' })).toBeNull();
    expect(parseBuildInfo(null)).toBeNull();
    expect(parseBuildInfo('AGPL-3.0-only')).toBeNull();
  });
});

describe('mergeBuildInfo', () => {
  const embedded = resolveBuildInfo({ version: '0.4.0', revision: SHA, sourceUrl: 'https://upstream.example/tree/x' });

  it('keeps embedded values when the server configures nothing', () => {
    const served = resolveBuildInfo({ version: '0.4.0', revision: '', sourceUrl: '' });
    expect(mergeBuildInfo(embedded, served)).toEqual(embedded);
    expect(mergeBuildInfo(embedded, null)).toEqual(embedded);
  });

  it('lets the deployment override the source url', () => {
    const served = resolveBuildInfo({ sourceUrl: 'https://fork.example/tree/y' });
    expect(mergeBuildInfo(embedded, served).sourceUrl).toBe('https://fork.example/tree/y');
    expect(mergeBuildInfo(embedded, served).revision).toBe(SHA);
  });
});

describe('buildProvenanceProblems', () => {
  it('passes a complete release build', () => {
    const info = resolveBuildInfo({ version: '0.4.0', revision: SHA, sourceUrl: 'https://example.com/tree/x' });
    expect(buildProvenanceProblems(info)).toEqual([]);
  });

  it('fails closed without version, full revision or public source url', () => {
    expect(buildProvenanceProblems(resolveBuildInfo({})))
      .toEqual(['version', 'revision', 'sourceUrl']);
    expect(buildProvenanceProblems(resolveBuildInfo({ version: '0.4.0', revision: SHA.slice(0, 12), sourceUrl: 'https://example.com/x' })))
      .toEqual(['revision']);
    expect(buildProvenanceProblems(resolveBuildInfo({ version: '0.4.0', revision: SHA, sourceUrl: 'http://localhost:4173/src' })))
      .toEqual(['sourceUrl']);
  });
});

describe('licenseSourceView', () => {
  it('shortens the revision and keeps the full one', () => {
    const view = licenseSourceView(resolveBuildInfo({ version: '0.4.0', revision: SHA, sourceUrl: 'https://example.com/x' }));
    expect(view).toEqual({
      license: HAUSER_LICENSE,
      version: '0.4.0',
      revision: SHA,
      revisionShort: SHA.slice(0, 12),
      sourceUrl: 'https://example.com/x',
      publishable: true,
    });
  });

  it('offers no source link for a development build', () => {
    const view = licenseSourceView(resolveBuildInfo({ version: '0.4.0' }));
    expect(view.sourceUrl).toBeNull();
    expect(view.revisionShort).toBeNull();
    expect(view.publishable).toBe(false);
    expect(view.license).toBe(HAUSER_LICENSE);
  });
});
