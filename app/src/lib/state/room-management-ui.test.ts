import { describe, expect, it } from 'vitest';
import setupWizard from '../components/SetupWizard.svelte?raw';
import panelRoomSelector from '../components/PanelRoomSelector.svelte?raw';
import homeScreen from '../screens/HomeScreen.svelte?raw';
import phoneFeed from '../components/phone/PhoneHomeFeed.svelte?raw';
import phoneRoomCard from '../components/phone/RoomSummaryCard.svelte?raw';

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
});
