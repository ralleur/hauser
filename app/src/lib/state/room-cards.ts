/* SPDX-License-Identifier: AGPL-3.0-only */

/* Wo die Karten eines Raums stehen (wie die iOS-App): eine Kamera steht vor dem
   Kachelraster, wenn sie in der Gerätereihenfolge des Raums vor der ersten
   Kachel liegt — sonst dahinter. Die Reihenfolge ist die, die man in der
   Raum-Konfiguration zieht; eine eigene Einstellung braucht es nicht. */
export function cardsAroundTiles<T extends { entityId: string }>(
  order: readonly { entityId: string }[],
  cards: readonly T[],
  tiles: readonly { entityId: string }[],
): { before: T[]; after: T[] } {
  const index = new Map(order.map((device, position) => [device.entityId, position]));
  const at = (entityId: string) => index.get(entityId) ?? order.length;
  const firstTile = tiles.length ? Math.min(...tiles.map((tile) => at(tile.entityId))) : order.length;
  return {
    before: cards.filter((card) => at(card.entityId) < firstTile),
    after: cards.filter((card) => at(card.entityId) >= firstTile),
  };
}
