import { describe, expect, it } from 'vitest';
import setupWizard from '../components/SetupWizard.svelte?raw';
import panelRoomSelector from '../components/PanelRoomSelector.svelte?raw';
import homeScreen from '../screens/HomeScreen.svelte?raw';
import phoneFeed from '../components/phone/PhoneHomeFeed.svelte?raw';
import phoneRoomCard from '../components/phone/RoomSummaryCard.svelte?raw';
import roomsDevicesSection from '../components/settings/RoomsDevicesSection.svelte?raw';
import roomListEditor from '../components/settings/RoomListEditor.svelte?raw';

describe('room management UI contracts', () => {
  it('keeps all room edits inside the atomic setup draft until activation', () => {
    expect(setupWizard).toMatch(/const config = addSetupRoom[\s\S]*suggestion = \{ \.\.\.suggestion, config \}/);
    expect(setupWizard).toMatch(/const config = moveSetupRoom[\s\S]*suggestion = \{ \.\.\.suggestion, config \}/);
    expect(setupWizard).toMatch(/removeSetupRoom\(suggestion\.config/);
    expect(setupWizard).toMatch(/deleteDestination === '__omit__'/);
    expect(setupWizard).toContain("fetch('/api/setup/activate'");
    expect(setupWizard).toContain("method: 'POST'");
    expect(setupWizard).not.toMatch(/Home Assistant Areas|\/api\/config\/area_registry/);
  });

  it('projects the canonical ordered room list through bounded 2x3 panel pages', () => {
    expect(homeScreen).toMatch(/<PanelRoomSelector/);
    expect(panelRoomSelector).toMatch(/panelRoomPages\(rooms\)/);
    expect(panelRoomSelector).toMatch(/inert=\{multiPage && pageIndex !== currentPage\}/);
    expect(panelRoomSelector).toMatch(/scrollToPage\(currentPage [+-] 1\)/);
  });

  it('keeps the phone room feed ordered, scrollable and resilient to long names', () => {
    expect(phoneFeed).toMatch(/\{#each rooms as room \(room\.id\)\}/);
    expect(phoneRoomCard).toMatch(/title=\{summary\.name\}/);
  });

  it('renders room management directly and keeps the destructive rescan at the bottom', () => {
    expect(roomsDevicesSection).toContain('<SetupWizard mode="reconfigure" embedded after={cards} />');
    expect(roomsDevicesSection).not.toContain('openHouseholdSetup');
    // Neu einlesen ist die dritte Reset-Kachel — unterhalb von Liste,
    // Speichern und Raumbildern, nicht zwischen den Räumen.
    expect(roomsDevicesSection.indexOf('m.sys_room_images()')).toBeLessThan(
      roomsDevicesSection.indexOf('m.settings_rooms_devices_scan_label()'),
    );
    expect(setupWizard).toContain('m.settings_rooms_devices_save()');
    expect(setupWizard).toMatch(/catch \(error\) \{\s+suggestion = previousSuggestion;/);
  });

  it('does not block embedded room saves on an incomplete Jellyfin session', () => {
    expect(setupWizard).toContain('if (!embedded && jellyfinEnabled && !jellyfinSession)');
    expect(setupWizard).toContain("disabled={status === 'activating' || (!embedded && jellyfinEnabled && !jellyfinSession)}");
  });

  it('refreshes the active household cache before leaving after a room save', () => {
    expect(setupWizard).toContain("import { refreshHouseholdConfigRuntimeCache } from '../config/household-config-runtime.ts'");
    /* Der Cache muss vor dem Verlassen aktualisiert sein. Das Verlassen raeumt
       zusaetzlich den Entwurfszwischenstand ab — die Reihenfolge bleibt
       verbindlich, der Block dazwischen nicht mehr einzeilig. */
    expect(setupWizard).toMatch(
      /await refreshHouseholdConfigRuntimeCache\(\);\s+if \(reconfigure\) \{[^}]*returnToDashboard\(\);/,
    );
  });

  /* Ein Sektionswechsel darf unfertige Raumaenderungen nicht still verwerfen —
     aber ein wiederhergestellter Entwurf darf den Serverstand auch nicht
     stillschweigend verdecken. Deshalb Hinweis und Verwerfen-Weg. */
  it('keeps an unfinished room draft across a section remount and offers a way out', () => {
    expect(setupWizard).toMatch(/let reconfigureDraft: ReconfigureDraft \| null = null;/);
    expect(setupWizard).toMatch(/if \(reconfigureDraft\) \{/);
    expect(setupWizard).toMatch(/draftRestored = true;/);
    expect(setupWizard).toMatch(/\{#if draftRestored\}/);
    expect(setupWizard).toMatch(/m\.setup_draft_restored\(\)/);
    expect(setupWizard).toMatch(/onclick=\{\(\) => void discardDraft\(\)\}/);
    // Verwerfen laedt den Serverstand neu, statt nur das Flag zu loeschen.
    expect(setupWizard).toMatch(/async function discardDraft[\s\S]*?reconfigureDraft = null;[\s\S]*?await loadCurrentSetup\(\);/);
    // Erfolgreiches Speichern raeumt Entwurf und Hinweis ab.
    expect(setupWizard).toMatch(/reconfigureDraft = null;\s+draftRestored = false;/);
  });

  it('shows every room with its current image, device count and drag handle', () => {
    expect(roomListEditor).toContain('resolveRoomHero({');
    expect(roomListEditor).toContain('m.settings_rooms_devices_configure()');
    expect(roomListEditor).toContain('m.settings_rooms_devices_rename()');
    expect(roomListEditor).toContain("<Icon name=\"i-dots-grid\"");
    expect(roomListEditor).toMatch(/onpointerdown=\{\(event\) => startDrag\(event, room\.id\)\}/);
    expect(roomListEditor).toContain('onreorder(dragRoomId, to)');
    // Ohne Zeigegerät bleibt die Reihenfolge über die Pfeiltasten erreichbar.
    expect(roomListEditor).toContain("if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;");
    expect(roomListEditor).toMatch(/\.room-handle \{ cursor: grab; touch-action: none; \}/);
  });

  it('keeps the first-run wizard on its own expandable list', () => {
    expect(setupWizard).toContain("let expandedRoomId = $state<string | null>(null)");
    expect(setupWizard).toContain('class:expanded={expandedRoomId === room.id}');
    expect(setupWizard).toMatch(/\.room-list \{[^}]*overflow: hidden;[^}]*border:/);
    expect(setupWizard).toMatch(/\.room-card \+ \.room-card \{ border-top:/);
  });

  it('opens the shared room overlay from the embedded settings list', () => {
    // In den Einstellungen führt „Geräte konfigurieren“ in dasselbe Overlay wie
    // der Longpress vom Home-Screen; Entitätenpflege gibt es dort nicht mehr.
    expect(setupWizard).toContain("import { openRoomEdit } from '../state/overlay.svelte.ts'");
    expect(setupWizard).toContain('onopen={openRoomEdit}');
    expect(setupWizard).toContain('{#if embedded}');
    expect(roomListEditor).toContain('onopen(room.id)');
  });
});
