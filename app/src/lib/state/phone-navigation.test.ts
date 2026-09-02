// @ts-expect-error Vitest runs in Node; production app types intentionally exclude Node globals.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import phoneShell from '../shells/PhoneAppShell.svelte?raw';

import bottomNav from '../components/phone/PhoneBottomNav.svelte?raw';
import moreSheet from '../components/phone/MoreSheet.svelte?raw';
import phoneNavIcon from '../components/phone/PhoneNavIcon.svelte?raw';
import mainEntry from '../../main.ts?raw';
import {
  PHONE_MAIN_TARGETS,
  canonicalTargetForMain,
  createHistoryMarkerGenerator,
  createPhoneModalLifecycle,
  createPhoneLayerController,
  mainAreaForScreen,
  initialMediaTarget,
  rememberMediaTarget,
  restorePhoneFocus,
  wrappedFocusIndex,
} from './phone-navigation.svelte.ts';

const climateControls = readFileSync(new URL('../../styles/climate-controls.css', import.meta.url), 'utf8');

class FakeBrowser {
  private states: unknown[] = [{ page: 'before' }];
  private index = 0;
  private listeners = new Set<(event: PopStateEvent) => void>();
  private pendingPops = 0;
  pushes = 0;
  backs = 0;

  constructor(private readonly asynchronousPop = false) {}

  get state() { return this.states[this.index]; }
  pushState(state: unknown) {
    this.states.splice(this.index + 1, Infinity);
    this.states.push(state);
    this.index += 1;
    this.pushes += 1;
  }
  back() {
    this.backs += 1;
    if (this.asynchronousPop) {
      this.pendingPops += 1;
      return;
    }
    if (this.index > 0) this.index -= 1;
    const event = { state: this.state } as PopStateEvent;
    for (const listener of [...this.listeners]) listener(event);
  }
  addEventListener(_type: 'popstate', listener: (event: PopStateEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'popstate', listener: (event: PopStateEvent) => void) {
    this.listeners.delete(listener);
  }
  listenerCount() { return this.listeners.size; }
  stack() { return [...this.states]; }
  currentIndex() { return this.index; }
  flushNextPop() {
    if (this.pendingPops === 0) throw new Error('No pending popstate event');
    this.pendingPops -= 1;
    if (this.index > 0) this.index -= 1;
    const event = { state: this.state } as PopStateEvent;
    for (const listener of [...this.listeners]) listener(event);
  }
}


describe('phone navigation mapping', () => {
  it('keeps the exact main-target order and canonical mapping', () => {
    expect(PHONE_MAIN_TARGETS.map(({ id, label }) => [id, label])).toEqual([
      ['home', 'Home'],
      ['calendar', 'Kalender'],
      ['media', 'Media'],
      ['more', 'Mehr'],
    ]);
    expect(canonicalTargetForMain('home', 'library')).toBe('home');
    expect(canonicalTargetForMain('calendar', 'library')).toBe('calendar');
    expect(canonicalTargetForMain('media', 'media')).toBe('media');
    expect(canonicalTargetForMain('media', 'library')).toBe('library');
    expect(canonicalTargetForMain('more', 'library')).toBeNull();
  });

  it.each([
    ['home', 'home'], ['calendar', 'calendar'], ['media', 'media'],
    ['library', 'media'], ['library-detail', 'media'],
    ['energy', 'more'], ['notes', 'more'], ['ablage', 'more'], ['system', 'more'],
  ] as const)('maps canonical %s to active main area %s', (screen, area) => {
    expect(mainAreaForScreen(screen)).toBe(area);
  });

  it('remembers only valid media roots and initially uses audio', () => {
    expect(rememberMediaTarget('media', 'home')).toBe('media');
    expect(rememberMediaTarget('media', 'library-detail')).toBe('library');
    expect(rememberMediaTarget('library', 'energy')).toBe('library');
    expect(rememberMediaTarget('library', 'media')).toBe('media');
  });

  it('starts the grouped media target on library when active config has no audio module', () => {
    expect(initialMediaTarget([{ id: 'home' }, { id: 'library' }])).toBe('library');
    expect(initialMediaTarget([{ id: 'home' }, { id: 'media' }, { id: 'library' }])).toBe('media');
  });
});

describe('phone history marker generation', () => {
  it('uses a shared session generation to distinguish same-tick fresh factories without runtime entropy', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const unavailable = {
      storage,
      random: () => { throw new Error('Math.random unavailable'); },
      now: () => 42,
      performanceNow: () => { throw new Error('Performance unavailable'); },
    };

    const firstReload = createHistoryMarkerGenerator(unavailable);
    const secondReload = createHistoryMarkerGenerator(unavailable);

    expect(firstReload()).not.toBe(secondReload());
    expect([...values.keys()]).toEqual(['__hmiPhoneMoreMarkerGeneration.v1']);
  });

  it('uses randomUUID before all fallback sources', () => {
    const getRandomValues = vi.fn();
    const marker = createHistoryMarkerGenerator({
      randomUUID: () => 'owned-uuid',
      getRandomValues,
      now: () => 42,
      reloadEntropy: 'reload-a',
    });

    expect(marker()).toBe('more-owned-uuid');
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('uses getRandomValues when randomUUID is unavailable or throws', () => {
    const getRandomValues = vi.fn((words: Uint32Array) => {
      words.set([1, 2, 3, 4]);
      return words;
    });
    const marker = createHistoryMarkerGenerator({
      randomUUID: () => { throw new Error('UUID unavailable'); },
      getRandomValues,
      now: () => 42,
      reloadEntropy: 'reload-a',
    });

    expect(marker()).toBe('more-r-0000001000000200000030000004');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('remains fail-safe when Web Crypto is missing or throws', () => {
    const missingCrypto = createHistoryMarkerGenerator({
      now: () => 42,
      reloadEntropy: 'reload-a',
    });
    const throwingCrypto = createHistoryMarkerGenerator({
      randomUUID: () => { throw new Error('UUID unavailable'); },
      getRandomValues: () => { throw new Error('RNG unavailable'); },
      now: () => 42,
      reloadEntropy: 'reload-b',
    });

    expect(missingCrypto()).toBe('more-f-16-reload-a-1');
    expect(missingCrypto()).toBe('more-f-16-reload-a-2');
    expect(throwingCrypto()).toBe('more-f-16-reload-b-1');
  });

  it('keeps fallback markers distinct across fresh module loads in the same clock tick', () => {
    const firstReload = createHistoryMarkerGenerator({ now: () => 42, reloadEntropy: 'reload-a' });
    const secondReload = createHistoryMarkerGenerator({ now: () => 42, reloadEntropy: 'reload-b' });

    expect(firstReload()).not.toBe(secondReload());
  });

  it('returns a string marker when every entropy source and the clock throw', () => {
    const unavailableSources = {
      randomUUID: () => { throw new Error('UUID unavailable'); },
      getRandomValues: () => { throw new Error('RNG unavailable'); },
      random: () => { throw new Error('Math.random unavailable'); },

      now: () => { throw new Error('Date unavailable'); },
      performanceNow: () => { throw new Error('Performance unavailable'); },
    };

    expect(createHistoryMarkerGenerator(unavailableSources)()).toMatch(/^more-f-/);
  });

  it('remains fail-safe when injected session storage access and methods throw', () => {
    const throwingStorageGetter = createHistoryMarkerGenerator({
      get storage(): never { throw new Error('storage getter unavailable'); },
      random: () => { throw new Error('Math.random unavailable'); },
      now: () => { throw new Error('Date unavailable'); },
      performanceNow: () => { throw new Error('Performance unavailable'); },
    });
    const throwingGetItem = createHistoryMarkerGenerator({
      storage: {
        getItem: () => { throw new Error('getItem unavailable'); },
        setItem: () => { throw new Error('setItem unavailable'); },
      },
      random: () => { throw new Error('Math.random unavailable'); },
      now: () => { throw new Error('Date unavailable'); },
      performanceNow: () => { throw new Error('Performance unavailable'); },
    });
    const throwingSetItem = createHistoryMarkerGenerator({
      storage: {
        getItem: () => '7',
        setItem: () => { throw new Error('setItem unavailable'); },
      },
      random: () => { throw new Error('Math.random unavailable'); },
      now: () => { throw new Error('Date unavailable'); },
      performanceNow: () => { throw new Error('Performance unavailable'); },
    });

    expect(throwingStorageGetter()).toEqual(expect.stringMatching(/^more-f-/));
    expect(throwingGetItem()).toEqual(expect.stringMatching(/^more-f-/));
    expect(throwingSetItem()).toEqual(expect.stringMatching(/^more-f-/));
  });


  it('keeps production module loads distinct in one tick via Math.random without Web Crypto', async () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(42);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.125).mockReturnValueOnce(0.75);

    try {
      vi.resetModules();
      const firstModule = await import('./phone-navigation.svelte.ts');
      const firstBrowser = new FakeBrowser();
      firstModule.createPhoneLayerController(firstBrowser, vi.fn()).open();

      vi.resetModules();
      const secondModule = await import('./phone-navigation.svelte.ts');
      const secondBrowser = new FakeBrowser();
      secondModule.createPhoneLayerController(secondBrowser, vi.fn()).open();

      expect(firstBrowser.state).not.toEqual(secondBrowser.state);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('imports and opens through the production adapter when every global source getter throws', async () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
    const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      get: () => { throw new Error('crypto getter unavailable'); },
    });
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      get: () => { throw new Error('performance getter unavailable'); },
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => { throw new Error('sessionStorage getter unavailable'); },
    });
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random unavailable'); });
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('date unavailable'); });

    try {
      vi.resetModules();
      const productionModule = await import('./phone-navigation.svelte.ts');
      const browser = new FakeBrowser();
      const controller = productionModule.createPhoneLayerController(browser, vi.fn());

      expect(controller.open()).toBe(true);
      expect(Object.values(browser.state as Record<string, unknown>))
        .toContainEqual(expect.stringMatching(/^more-f-.+/));
    } finally {
      vi.restoreAllMocks();
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      else delete (globalThis as { crypto?: Crypto }).crypto;
      if (performanceDescriptor) Object.defineProperty(globalThis, 'performance', performanceDescriptor);
      else delete (globalThis as { performance?: Performance }).performance;
      if (sessionStorageDescriptor) Object.defineProperty(globalThis, 'sessionStorage', sessionStorageDescriptor);
      else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    }
  });
});

describe('phone layer history controller', () => {
  it('uses a distinct owned marker for every controller instance', () => {
    const firstBrowser = new FakeBrowser();
    const secondBrowser = new FakeBrowser();
    createPhoneLayerController(firstBrowser, vi.fn()).open();
    createPhoneLayerController(secondBrowser, vi.fn()).open();
    expect(firstBrowser.state).not.toEqual(secondBrowser.state);
  });

  it('queues exactly one rapid reopen until an asynchronous owned close has popped', () => {
    const browser = new FakeBrowser(true);
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);

    expect(controller.open()).toBe(true);
    expect(controller.close('close')).toBe(true);
    expect(controller.open()).toBe(true);
    expect(controller.open()).toBe(false);
    expect(browser.pushes).toBe(1);
    expect(browser.currentIndex()).toBe(1);

    browser.flushNextPop();

    expect(browser.pushes).toBe(2);
    expect(browser.currentIndex()).toBe(1);
    expect(controller.isOpen()).toBe(true);
    expect(browser.listenerCount()).toBe(1);
    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'close'], [true, 'open']]);

    expect(controller.close('escape')).toBe(true);
    browser.flushNextPop();
    expect(browser.currentIndex()).toBe(0);
    expect(browser.listenerCount()).toBe(0);
  });

  it('reopens over a foreign state without pushing there, then closes and consumes its marker on later Back', () => {
    const browser = new FakeBrowser(true);
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);

    controller.open();
    browser.pushState({ owner: 'foreign' });
    expect(controller.close('close')).toBe(true);
    expect(controller.open()).toBe(true);
    expect(controller.open()).toBe(false);
    expect(browser.pushes).toBe(2);
    expect(browser.currentIndex()).toBe(2);
    expect(controller.isOpen()).toBe(true);

    browser.back();
    browser.flushNextPop();
    expect(browser.currentIndex()).toBe(1);
    expect(browser.backs).toBe(2);
    expect(controller.isOpen()).toBe(false);
    expect(changes.mock.calls).toEqual([
      [true, 'open'], [false, 'close'], [true, 'open'], [false, 'back'],
    ]);

    browser.flushNextPop();
    expect(browser.currentIndex()).toBe(0);
    expect(browser.listenerCount()).toBe(0);
    expect(changes).toHaveBeenCalledTimes(4);
  });

  it('consumes an owned marker reached later below a foreign state without reopening or closing twice', () => {
    const browser = new FakeBrowser(true);
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);

    controller.open();
    browser.pushState({ owner: 'foreign' });

    expect(controller.close('close')).toBe(true);
    expect(controller.close('close')).toBe(false);
    expect(browser.stack()).toHaveLength(3);
    expect(browser.currentIndex()).toBe(2);
    expect(browser.listenerCount()).toBe(1);
    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'close']]);

    browser.back();
    browser.flushNextPop();

    expect(browser.backs).toBe(2);
    expect(browser.currentIndex()).toBe(1);
    expect(controller.isOpen()).toBe(false);
    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'close']]);
    expect(browser.listenerCount()).toBe(1);

    browser.flushNextPop();
    expect(browser.state).toEqual({ page: 'before' });
    expect(browser.listenerCount()).toBe(0);
  });

  it('opens without touching canonical state and pushes at most one layer entry', () => {
    const browser = new FakeBrowser();
    const canonical = { screen: 'energy' };
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);
    expect(controller.open()).toBe(true);
    expect(controller.open()).toBe(false);
    expect(canonical.screen).toBe('energy');
    expect(browser.pushes).toBe(1);
    expect(browser.listenerCount()).toBe(1);
  });

  it('Back closes once and removes its listener', () => {
    const browser = new FakeBrowser();
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);
    controller.open();
    browser.back();
    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'back']]);
    expect(controller.isOpen()).toBe(false);
    expect(browser.listenerCount()).toBe(0);
  });

  it('Back from a foreign state closes and automatically skips the reached owned marker', () => {
    const browser = new FakeBrowser(true);
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);
    controller.open();
    browser.pushState({ owner: 'foreign' });

    browser.back();
    browser.flushNextPop();

    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'back']]);
    expect(browser.backs).toBe(2);
    expect(browser.currentIndex()).toBe(1);
    expect(browser.listenerCount()).toBe(1);

    browser.flushNextPop();
    expect(browser.listenerCount()).toBe(0);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('waits for asynchronous popstate before completing a direct explicit close', () => {
    const browser = new FakeBrowser(true);
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);
    controller.open();

    expect(controller.close('escape')).toBe(true);
    expect(controller.close('escape')).toBe(false);
    expect(browser.currentIndex()).toBe(1);
    expect(browser.listenerCount()).toBe(1);

    browser.flushNextPop();
    expect(browser.listenerCount()).toBe(0);
    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'escape']]);
  });

  it.each(['escape', 'scrim', 'close', 'toggle', 'selection'] as const)(
    '%s uses the same idempotent close state and leaves no dead history entry',
    (reason) => {
      const browser = new FakeBrowser();
      const changes = vi.fn();
      const controller = createPhoneLayerController(browser, changes);
      controller.open();
      expect(controller.close(reason)).toBe(true);
      expect(controller.close(reason)).toBe(false);
      expect(browser.backs).toBe(1);
      expect(browser.state).toEqual({ page: 'before' });
      expect(browser.listenerCount()).toBe(0);
      expect(changes.mock.calls).toEqual([[true, 'open'], [false, reason]]);
    },
  );

  it('destroy closes the layer and cleans the popstate listener', () => {
    const browser = new FakeBrowser();
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);
    controller.open();
    controller.destroy();
    expect(controller.isOpen()).toBe(false);
    expect(browser.state).toEqual({ page: 'before' });
    expect(browser.listenerCount()).toBe(0);
    expect(changes).toHaveBeenLastCalledWith(false, 'unmount');
  });

  it('uses bounded fail-safe teardown when destroy cannot reach an owned marker below foreign state', () => {
    const browser = new FakeBrowser(true);
    const changes = vi.fn();
    const controller = createPhoneLayerController(browser, changes);
    controller.open();
    browser.pushState({ owner: 'foreign' });

    controller.destroy();

    expect(controller.isOpen()).toBe(false);
    expect(controller.open()).toBe(false);
    expect(browser.backs).toBe(0);
    expect(browser.currentIndex()).toBe(2);
    expect(browser.stack()).toHaveLength(3);
    expect(browser.listenerCount()).toBe(0);
    expect(changes.mock.calls).toEqual([[true, 'open'], [false, 'unmount']]);
  });
});

describe('phone layer focus helpers', () => {
  it('keeps modal blocking until the current outer outro ends and ignores stale completions', () => {
    const released = vi.fn();
    const lifecycle = createPhoneModalLifecycle(released);

    const first = lifecycle.open();
    expect(lifecycle.isBlocking()).toBe(true);
    expect(lifecycle.beginClose()).toBe(first);
    const second = lifecycle.open();
    expect(lifecycle.finishOutro(first)).toBe(false);
    expect(released).not.toHaveBeenCalled();
    expect(lifecycle.beginClose()).toBe(second);
    expect(lifecycle.finishOutro(first)).toBe(false);
    expect(lifecycle.finishOutro(second)).toBe(true);
    expect(lifecycle.finishOutro(second)).toBe(false);
    expect(lifecycle.isBlocking()).toBe(false);
    expect(released).toHaveBeenCalledOnce();
  });

  it('wraps Tab and Shift+Tab inside the focus trap', () => {
    expect(wrappedFocusIndex(2, 3, false)).toBe(0);
    expect(wrappedFocusIndex(0, 3, true)).toBe(2);
    expect(wrappedFocusIndex(1, 3, false)).toBe(2);
    expect(wrappedFocusIndex(-1, 3, false)).toBe(0);
  });

  it('returns focus to a connected trigger or a controlled fallback', () => {
    const trigger = { isConnected: true, focus: vi.fn() };
    const fallback = { isConnected: true, focus: vi.fn() };
    expect(restorePhoneFocus(trigger, fallback)).toBe('trigger');
    expect(trigger.focus).toHaveBeenCalledOnce();
    trigger.isConnected = false;
    expect(restorePhoneFocus(trigger, fallback)).toBe('fallback');
    expect(fallback.focus).toHaveBeenCalledOnce();
  });
});

describe('phone source and accessibility boundaries', () => {
  it('renders the navigation and sheet without forbidden feature or panel imports', () => {
    expect(phoneShell).toMatch(/<PhoneBottomNav/);
    expect(phoneShell).toMatch(/<MoreSheetComponent/);
    expect(phoneShell).toMatch(/shellLifecycle\.register/);
    expect(phoneShell).not.toMatch(/hero-layout\.css/);
    expect(mainEntry).toMatch(/import '\.\/styles\/climate-controls\.css'/);
    expect(climateControls).toMatch(/\.climate-dock[\s\S]*border-radius:\s*var\(--radius-full\)/);
    expect(climateControls).toMatch(/\.cd-key-down[\s\S]*var\(--color-accent-cool\)/);
    expect(climateControls).toMatch(/\.cd-key-up[\s\S]*var\(--color-error\)/);
    expect(phoneShell).not.toMatch(/inert=\{modalBlocking\}/);
    expect(phoneShell).not.toMatch(/aria-hidden=\{modalBlocking\}/);
    expect(phoneShell).toMatch(/const closingGeneration = modalLifecycle\.beginClose\(\)/);
    expect(phoneShell).toMatch(/outroGeneration = closingGeneration/);
    expect(phoneShell).toMatch(/finishOutro\(outroGeneration\)/);
    expect(phoneShell).toMatch(/setTimeout\(\(\) => handleOuterOutroEnd\(\), 240\)/);
    expect(phoneShell).toMatch(/clearTimeout\(modalReleaseTimer\)/);
    expect(phoneShell).not.toMatch(/<RoomControlSheet[^>]*\{outroGeneration\}/);
    expect(phoneShell).not.toMatch(/<MoreSheet[^>]*\{outroGeneration\}/);
    expect(phoneShell).toMatch(/onouteroutroend=\{handleOuterOutroEnd\}/);
    for (const source of [phoneShell, bottomNav, moreSheet, phoneNavIcon]) {
      for (const forbidden of ['PanelAppShell', 'StatusBar', 'TabBar.svelte', 'RoomHero', 'PlayerLayer', 'hls.js', 'IconPicker', 'icon-recents']) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it('shows retry recovery for feature CSS and every productive phone await seam', () => {
    expect(phoneShell).toMatch(/featureStylesFailed/);
    expect(phoneShell).toMatch(/retryFeatureStyles/);
    expect(phoneShell).toContain("styles: () => import('../../styles/app.css')");
    expect(phoneShell).toMatch(/phoneScreenFailed[\s\S]*retryPhoneScreen/);
    expect(phoneShell).toMatch(/createLatestPhoneLoader\(PHONE_SCREEN_LOADERS\)/);
    expect(phoneShell).not.toMatch(/from ['"]\.\.\/state\/lazy-loader\.ts['"]/);
    expect(phoneShell).toMatch(/loadPhoneFeature\('room-edit',[\s\S]*\{:catch\}[\s\S]*closeRoomEdit/);
    expect((phoneShell.match(/\{:catch\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('renders three ordered targets plus fixed More and puts every remaining target in the sheet', () => {
    // Abgeschaltete Module fallen vorher heraus; die gespeicherte Reihenfolge
    // bleibt die Quelle der ersten drei Ziele.
    expect(bottomNav).toMatch(/phoneNavOrder\.order\.filter\(\(id\) => phoneTargetVisible\(id\)\)/);
    expect(bottomNav).toMatch(/visibleOrder\.slice\(0, 3\)/);
    expect(bottomNav).toMatch(/bind:this=\{moreButton\}/);
    expect(bottomNav).toContain('<span>{m.nav_more()}</span>');
    expect(moreSheet).toMatch(/role="dialog"/);
    expect(moreSheet).toMatch(/aria-modal="true"/);
    expect(moreSheet).toMatch(/event\.target\s*!==\s*event\.currentTarget/);
    // Auch hier zählt die sichtbare Reihenfolge: abgeschaltete Module fallen
    // heraus, die gespeicherte Reihenfolge bleibt bestehen.
    expect(moreSheet).toMatch(/visibleOrder\.slice\(3\)/);
    expect(moreSheet).toMatch(/\{#each visibleOrder as id, index \(id\)\}/);
    expect(moreSheet).toMatch(/phoneNavOrder\.order\.filter\(\(id\) => phoneTargetVisible\(id\)\)/);
    expect(moreSheet).toContain('m.phone_arrange_end() : m.phone_arrange_start()');
    expect(bottomNav).toContain('<PhoneNavIcon {id} />');
    expect(moreSheet).toContain('<PhoneNavIcon {id} />');
    expect(moreSheet).toMatch(/<header[^>]*>[\s\S]*more-arrange-toggle[\s\S]*more-sheet-close[\s\S]*<\/header>/);
    expect(moreSheet).not.toContain('more-sheet-target more-arrange-toggle');
    expect(moreSheet).toMatch(/moveNavTarget\(id, -1\)/);
    expect(moreSheet).toMatch(/moveNavTarget\(id, 1\)/);
  });

  it('keeps the conditional sheet mounted for token-driven scrim and sheet exit motion', () => {
    expect(moreSheet).toMatch(/out:scrimExit/);
    expect(moreSheet).toMatch(/out:sheetExit/);
    expect(moreSheet).toMatch(/opacity:\$\{t\}/);
    expect(moreSheet).toMatch(/transform:translateY/);
    expect(moreSheet).not.toMatch(/filter:|backdrop-filter:/);
  });

  it('releases the modal boundary only from the outer scrim outro end', () => {
    expect(moreSheet).toMatch(/onouteroutroend/);
    expect(moreSheet).toMatch(/function outerOutroEnd\(event: CustomEvent<null>\)/);
    expect(moreSheet).toMatch(/event\.target\s*!==\s*event\.currentTarget/);
    expect(moreSheet).toMatch(/onoutroend=\{outerOutroEnd\}/);
  });

  it('makes the real Svelte sheet exit motion-safe and keeps matchMedia failures non-fatal', () => {
    expect(moreSheet).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(moreSheet).toMatch(/try\s*\{[\s\S]*matchMedia[\s\S]*\}\s*catch\s*\{/);
    expect(moreSheet).toMatch(/duration:\s*reducedMotion\s*\?\s*0\s*:/);
    expect(moreSheet).toMatch(/function scrimExit[\s\S]*duration:\s*reducedMotion\s*\?\s*0\s*:/);
    expect(moreSheet).toMatch(/css:\s*reducedMotion\s*\?\s*\(t:\s*number\)\s*=>\s*`opacity:\$\{t\}`\s*:\s*\(t:\s*number\)\s*=>[\s\S]*transform:translateY/);
  });
});
