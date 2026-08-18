import { describe, expect, it } from 'vitest';
import phoneReminders from '../components/phone/PhoneReminders.svelte?raw';

describe('phone reminder freshness status', () => {
  it('keeps reminder rows visible while marking failed refreshes as stale', () => {
    expect(phoneReminders).toMatch(
      /\{#if reminders\.error\}\s*<p class="phone-calendar-status is-error" role="status">\{m\.phone_reminders_stale\(\)\}<\/p>\s*\{\/if\}/,
    );
    expect(phoneReminders).toMatch(
      /\{\/if\}\s*\{#each PERSON_ORDER as person \(person\)\}[\s\S]*\{#each row\.open as item \(item\.id\)\}/,
    );
  });

  it('guards the only error status directly so null renders no status', () => {
    const staleStatus = '<p class="phone-calendar-status is-error" role="status">{m.phone_reminders_stale()}</p>';
    expect(phoneReminders.split(staleStatus)).toHaveLength(2);
    expect(phoneReminders).toContain(`{#if reminders.error}\n    ${staleStatus}\n  {/if}`);
  });
});
