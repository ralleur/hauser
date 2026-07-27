import { describe, expect, it } from 'vitest';
import { defaultHaUrl } from './runtime.svelte.ts';

describe('Home Assistant endpoint selection', () => {
  it('uses the public HTTPS/WSS-capable endpoint for an HTTPS PWA', () => {
    expect(defaultHaUrl('https:')).toBe('https://homeassistant.example.com');
  });

  it('keeps the direct LAN endpoint for an HTTP/LAN origin', () => {
    expect(defaultHaUrl('http:')).toBe('http://homeassistant.local:8123');
  });
});
