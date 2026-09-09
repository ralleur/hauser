import { describe, expect, it } from 'vitest';
// @ts-expect-error Native Node ESM Servermodul.
import { notificationAutomationSpecs, parseNotificationPush, NOTIFICATION_PUSH_URL } from '../../server/notification-rules.mjs';

const rule = {
  id: 'washer', name: 'Wäsche', category: 'laundry', entityId: 'sensor.washer', enabled: true,
  triggers: [{ key: 'done', label: 'fertig', enabled: true, kind: 'state', delayMinutes: 0, to: ['off'] }],
};

describe('Push an das Telefon', () => {
  it('nimmt nur gültige notify-Dienste an', () => {
    expect(parseNotificationPush({ service: 'notify.mobile_app_sams_iphone' })).toEqual({ service: 'notify.mobile_app_sams_iphone' });
    expect(parseNotificationPush({ service: 'light.turn_on' })).toEqual({ service: null });
    expect(parseNotificationPush(null)).toEqual({ service: null });
  });

  it('gibt den Dienst und den hauser://-Link als Blueprint-Eingaben weiter', () => {
    const without = notificationAutomationSpecs([rule]);
    expect(without[0].config.use_blueprint.input.notify_service).toBeUndefined();
    const withPush = notificationAutomationSpecs([rule], { service: 'notify.mobile_app_x' });
    expect(withPush[0].config.use_blueprint.input.notify_service).toBe('notify.mobile_app_x');
    expect(withPush[0].config.use_blueprint.input.notify_url).toBe(NOTIFICATION_PUSH_URL);
  });
});
