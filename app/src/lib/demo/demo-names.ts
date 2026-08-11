import { m } from '../../paraglide/messages.js';

/* Der Raum-Seed trägt die Raumnamen des Haushalts, für den diese HMI gebaut
   wurde. In der öffentlichen Demo werden Räume und sichtbare Leuchten deshalb
   mit neutralen Präsentationsnamen versehen. Produktion und der zugrunde
   liegende Household-/Entity-Vertrag bleiben unangetastet. */
export function applyDemoNames(
  rooms: { id: string; name: string; lights?: { name: string }[] }[],
): void {
  if (import.meta.env.VITE_DEMO !== '1') return;

  const room: Record<string, () => string> = {
    wohnzimmer: m.demo_room_wohnzimmer, kinderzimmer: m.demo_room_kinderzimmer,
    schlafzimmer: m.demo_room_schlafzimmer, bad: m.demo_room_bad,
    kueche: m.demo_room_kueche, flur: m.demo_room_flur,
  };
  const light: Readonly<Record<string, string>> = {
    Kugellampen: 'Main lights',
    Esstisch: 'Dining pendant',
    'Kugellampe TV': 'Floor lamp',
    'Kugellampe Fenster': 'Window lamp',
    Bett: 'Bedside lights',
    Schreibtisch: 'Desk lamp',
    Spiegellicht: 'Mirror light',
    'LED-Leiste': 'Counter lights',
  };

  for (const item of rooms) {
    if (room[item.id]) item.name = room[item.id]();
    for (const entity of item.lights ?? []) entity.name = light[entity.name] ?? entity.name;
  }
}