// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('./CameraFeed.svelte', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/room-controls.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

describe('camera feed app interaction', () => {
  it('disables browser viewport zoom', () => {
    expect(html).toMatch(/name="viewport"[^>]*maximum-scale=1[^>]*user-scalable=no/);
  });

  it('spielt den Livestream und hält die Standbilder als Rückfall', () => {
    expect(component).toContain("backend.getCameraStreamPath?.(id)");
    expect(component).toContain('attachHls(element, url)');
    /* Standbilder laufen nur, solange kein Video liefert. */
    expect(component).toMatch(/const url = snapshotUrl;\s*\n\s*if \(videoReady\) return;/);
  });

  it('opens the live image on tap and closes it on double tap', () => {
    expect(component).toContain('onclick={openFullscreen}');
    expect(component).toContain('frame.requestFullscreen()');
    expect(component).toMatch(/use:doubletap=\{\{ enabled: fullscreen, onDoubleTap: closeFullscreen \}\}/);
    expect(component).toContain('document.exitFullscreen()');
    expect(css).toMatch(/\.camera-feed-frame:fullscreen\s*\{[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%/);
    expect(css).toMatch(
      /\.camera-feed-frame:fullscreen img,\s*\.camera-feed-frame:fullscreen video\s*\{\s*object-fit:\s*contain/,
    );
  });
});