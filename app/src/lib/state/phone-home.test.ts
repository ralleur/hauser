import { describe, expect, it } from 'vitest';
import phoneShell from '../shells/PhoneAppShell.svelte?raw';
import phoneHome from '../components/phone/PhoneHomeFeed.svelte?raw';
import phoneQuickActions from '../components/phone/PhoneQuickActions.svelte?raw';
import roomCard from '../components/phone/RoomSummaryCard.svelte?raw';
import roomSheet from '../components/phone/RoomControlSheet.svelte?raw';
import roomControls from '../components/RoomControls.svelte?raw';
import phoneHomeState from './phone-home.ts?raw';
import type { Room } from './app.svelte.ts';
import {
  accessibleRoomSummary,
  currentClimateTemperature,
  phoneHeroUrl,
  projectPhoneRooms,
  reconcilePhoneRoomLayer,
  validPhoneRoom,
  type PhoneHomeReaders,
} from './phone-home.ts';

const rooms: Room[] = [
  {
    id: 'living', name: 'Wohnzimmer', presence: true, windowOpen: true,
    lights: [
      { id: 'ceiling', entityId: 'light.ceiling', name: 'Decke', dimmable: true },
      { id: 'lamp', entityId: 'light.lamp', name: 'Lampe', dimmable: false },
    ],
  },
  { id: 'empty', name: 'Flur', presence: false, windowOpen: false, lights: [] },
];

function readers(overrides: Partial<PhoneHomeReaders> = {}): PhoneHomeReaders {
  return {
    temperature: (roomId) => roomId === 'living' ? 21.4 : null,
    light: (_roomId, lightId) => lightId === 'ceiling' ? { on: true, brightness: 70 } : undefined,
    climate: () => null,
    ...overrides,
  };
}

describe('phone home room projection', () => {
  it('builds the visible day/night card asset and preserves the unknown-room fallback', async () => {
    // B-27 D6: Phone laedt die Ableitung, nicht die Vollfassung.
    await expect(phoneHeroUrl('/', 'wohnzimmer', 'light')).resolves.toBe('/hero/wohnzimmer-light-phone.avif');
    await expect(phoneHeroUrl('/app', 'bad', 'dark')).resolves.toBe('/app/hero/bad-dark-phone.avif');
    await expect(phoneHeroUrl('/', 'garage', 'light')).resolves.toBeNull();
  });

  it('preserves room order and projects merged temperature/light/security values', () => {
    expect(projectPhoneRooms(rooms, readers())).toEqual([
      {
        id: 'living', name: 'Wohnzimmer', temperature: 21.4,
        lightsOn: 1, lightsKnown: 1, lightsTotal: 2,
        windowOpen: true, presence: true, climateAvailable: false,
      },
      {
        id: 'empty', name: 'Flur', temperature: null,
        lightsOn: 0, lightsKnown: 0, lightsTotal: 0,
        windowOpen: false, presence: false, climateAvailable: false,
      },
    ]);
  });

  it('derives the central current temperature only from rooms with climate data', () => {
    const projected = projectPhoneRooms(rooms, readers({
      climate: (roomId) => roomId === 'living' ? { current: 21, target: 20, hvac: 'heat' } : null,
    }));
    expect(currentClimateTemperature(projected)).toBe(21.4);
    expect(currentClimateTemperature(projected.map((room) => ({ ...room, climateAvailable: false })))).toBeNull();
    expect(phoneQuickActions).toContain('m.climate_current()');
    expect(phoneQuickActions).toContain('m.climate_target()');
  });

  it('tolerates missing readers and values without inventing room state', () => {
    const missing = projectPhoneRooms(rooms, readers({
      temperature: () => { throw new Error('not delivered'); },
      light: () => undefined,
      climate: () => undefined,
    }));
    expect(missing[0]).toMatchObject({ temperature: null, lightsOn: 0, lightsKnown: 0, lightsTotal: 2 });
    expect(accessibleRoomSummary(missing[0])).toContain('Keine Temperaturdaten');
    expect(accessibleRoomSummary(missing[0])).toContain('1 Fenster offen');
    expect(accessibleRoomSummary(missing[1])).toContain('Keine Lichter');
  });

  it('accepts only configured room ids for the canonical room context', () => {
    expect(validPhoneRoom(rooms, 'living')?.name).toBe('Wohnzimmer');
    expect(validPhoneRoom(rooms, 'missing')).toBeUndefined();
    expect(validPhoneRoom(rooms, null)).toBeUndefined();
  });
});

describe('phone home source, command and modal boundaries', () => {
  it('branches the real feed through the canonical reactive phone projection', () => {
    expect(phoneShell).toMatch(/\{#if\s+target\.area\s*===\s*'home'\}/);
    expect(phoneShell).not.toMatch(/\{#if\s+nav\.screen\s*===\s*'home'\}/);
    expect(phoneShell).toMatch(/<PhoneHomeFeed/);
    expect(phoneShell).toMatch(/m\.phone_view_preparing\(\)/);
  });

  it('keeps cards as one accessible primary control and uses no hero/panel imports', () => {
    expect((roomCard.match(/<button/g) ?? [])).toHaveLength(1);
    expect(roomCard).toMatch(/aria-label=/);
    for (const source of [phoneShell, phoneHome, roomCard, roomSheet]) {
      for (const forbidden of ['RoomHero.svelte', 'HomeScreen', 'PanelAppShell', 'hls.js', 'IconPicker', 'icon-recents']) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it('uses the shared resolver/loader and reactive assignment store without importing panel UI', () => {
    expect(phoneHome).toMatch(/const heroVariant = \$derived/);
    expect(phoneHome).toContain('appState.heroSun');
    expect(phoneHome).not.toContain('runtime.merged(SUN_ENTITY)');
    expect(phoneHome).toMatch(/<RoomSummaryCard[^>]*\{heroVariant\}/);
    expect(phoneHomeState).toContain("from '../components/room-hero-assets.ts'");
    expect(phoneHomeState).toContain('resolveRoomHero');
    expect(roomCard).toContain('roomHeroConfig(summary.id)');
    expect(roomCard).toContain('resolvePhoneHero');
    expect(roomCard).toContain('loadRoomHero');
    expect(roomCard).toContain('style:--phone-room-focus');
  });

  it('reuses the tablet room controls 1:1 and never calls a backend directly', () => {
    // Eine Erfahrung aus einem Guss: das Sheet rendert dieselbe RoomControls-
    // Komponente wie die Tablet-Seitenleiste (inkl. Long-Press-Overlays),
    // statt eigene Phone-Controls zu duplizieren.
    expect(roomSheet).toMatch(/<RoomControls\s+\{room\}\s*\/>/);
    expect(roomControls).toMatch(/import '\.\.\/\.\.\/styles\/room-controls\.css'/);
    expect(roomSheet).not.toMatch(/toggleLight|setBrightness|stepTarget|setHvac|applyScene/);
    expect(roomSheet).not.toMatch(/callService|sendCommand|runtime\.dispatch|home-assistant/);
    expect(roomSheet).toMatch(/import\('\.\.\/DeviceDetail\.svelte'\)[\s\S]*<DeviceDetail\s*\/>/);
    expect(roomSheet).toMatch(/import\('\.\.\/SceneEdit\.svelte'\)[\s\S]*<SceneEdit\s*\/>/);
    expect(phoneShell).toMatch(/<RoomEdit\s*\/>/);
    // Long-Press auf der Raum-Kachel öffnet denselben Raum-Geräte-Editor
    // wie der Long-Press auf die Raum-Kachel der Tablet-Ansicht.
    expect(roomCard).toMatch(/use:longpress=\{\{ onLongPress: \(\) => openRoomEdit\(summary\.id\) \}\}/);
  });

  it('keeps the mobile vacation action enabled as a bidirectional toggle', () => {
    expect(phoneQuickActions).toMatch(/onclick=\{toggleVacationMode\}/);
    expect(phoneQuickActions).toMatch(/disabled=\{!online\}/);
    expect(phoneQuickActions).not.toMatch(/disabled=\{!online \|\| vacationActive\}/);
    expect(phoneQuickActions).toContain('vacationActive ? m.phone_vacation_off_label() : m.phone_vacation_on_label()');
  });

  it('implements the shared modal lifecycle, focus trap, close paths and outer outro', () => {
    expect(roomSheet).toMatch(/role="dialog"/);
    expect(roomSheet).toMatch(/aria-modal="true"/);
    expect(roomSheet).toMatch(/event\.target\s*!==\s*event\.currentTarget/);
    expect(roomSheet).toMatch(/event\.key\s*===\s*'Escape'/);
    expect(roomSheet).toContain('wrappedFocusIndex');
    expect(roomSheet).toMatch(/out:scrimExit/);
    expect(roomSheet).toMatch(/out:sheetExit/);
    expect(roomSheet).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(phoneShell).toMatch(/createPhoneLayerController/);
    expect(phoneShell).not.toMatch(/inert=\{modalBlocking\}/);
  });

  it('closes the stacked tablet overlays with the lazy room-control closure', () => {
    expect(roomSheet).toMatch(/onDestroy\(\(\) => \{[\s\S]*closeDeviceDetail\(true\)/);
    expect(roomSheet).toMatch(/onDestroy\(\(\) => \{[\s\S]*closeSceneEdit\(true\)/);
    // Das Geräte-Detail bleibt exklusiv in der Raum-Sheet-Closure. Der Szenen-
    // Editor ist zusätzlich aus dem Raum-Editor erreichbar („Szenen anpassen")
    // und aktiviert seinen Shell-Host erst bei Bedarf — aber nur, solange kein
    // Raum-Sheet offen ist, das ihn selbst mitbringt.
    expect(phoneShell).not.toContain('deviceDetail');
    expect(phoneShell).toContain("addEventListener('hauser:scene-edit-open'");
    expect(phoneShell).toMatch(/\{#if !roomOpen && featureStylesReady && SceneEditComponent\}/);
  });

  it('recovers failed room and nested overlay chunks with retry and close actions', () => {
    expect(phoneShell).toMatch(/loadPhoneFeature\('room',[\s\S]*\{:catch\}[\s\S]*retryPhoneFeature[\s\S]*closeLayer\('close'\)/);
    expect(roomSheet).toMatch(/loadNestedLayer\('device',[\s\S]*\{:catch\}/);
    expect(roomSheet).toMatch(/loadNestedLayer\('scene',[\s\S]*\{:catch\}/);
    expect(roomSheet).toMatch(/retryNestedLayer\(id\)/);
    expect(roomSheet).toMatch(/closeNestedLayer\(id\)/);
    expect(roomSheet).toMatch(/closeDeviceDetail\(true\)/);
    expect(roomSheet).toMatch(/closeSceneEdit\(true\)/);
  });

  it('reconciles mount and dynamic room removal through one bounded controller lifecycle', () => {
    expect(reconcilePhoneRoomLayer(rooms, 'living', null, false, false)).toBe('open-current');
    expect(reconcilePhoneRoomLayer(rooms, 'living', 'room', true, true)).toBe('none');
    expect(reconcilePhoneRoomLayer(rooms, 'missing', null, false, false)).toBe('clear-stale');
    expect(reconcilePhoneRoomLayer(rooms, 'missing', 'room', true, true)).toBe('close-missing');

    expect(phoneShell).toMatch(/const action = reconcilePhoneRoomLayer/);
    expect(phoneShell).toMatch(/action === 'open-current'[\s\S]*openLayer\('room'\)/);
    expect(phoneShell).toMatch(/action === 'clear-stale'[\s\S]*appState\.currentRoom = null/);
    const recoveryBranch = phoneShell.match(/else if \(action === 'close-missing'\) \{([\s\S]*?)\n    \}/)?.[1] ?? '';
    expect(recoveryBranch).toMatch(/controller\.close\('navigation'\)/);
    expect(recoveryBranch).not.toMatch(/modalLifecycle\.finishOutro/);
    expect(recoveryBranch).not.toMatch(/activeLayer\s*=\s*null/);
    expect(phoneShell).toMatch(/onouteroutroend=\{handleOuterOutroEnd\}/);
    expect(phoneShell).toMatch(/restoreFocusToTitle \? null[\s\S]*restorePhoneFocus\(trigger, titleAnchor/);
  });

});
