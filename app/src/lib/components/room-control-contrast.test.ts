// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(new URL('../../styles/app.css', import.meta.url), 'utf8');
const phoneCss = readFileSync(new URL('../../styles/phone-shell.css', import.meta.url), 'utf8');

describe('room control surface contrast', () => {
  it('renders device and room-scene controls on the overlay control layer', () => {
    expect(appCss).toMatch(/\.light-tile\s*\{[\s\S]*?border:\s*1px solid var\(--overlay-border\)[\s\S]*?background:\s*var\(--overlay-control-background\)/);
    expect(appCss).toMatch(/\.room-controls \.scene-btn\s*\{[\s\S]*?border:\s*1px solid var\(--overlay-border\)[\s\S]*?background:\s*var\(--overlay-control-background\)/);
    expect(appCss).not.toMatch(/(?<!room-controls )\.scene-btn\s*\{[\s\S]*?background:\s*var\(--overlay-control-background\)/);
  });

  it('uses the same glass hierarchy for the phone room sheet and close control', () => {
    expect(phoneCss).toMatch(/\.room-sheet\s*\{[\s\S]*?background:\s*var\(--overlay-panel-background\)[\s\S]*?-webkit-backdrop-filter:/);
    expect(phoneCss).toMatch(/\.room-sheet-close\s*\{[\s\S]*?background:\s*var\(--overlay-control-background\)/);
  });
});
