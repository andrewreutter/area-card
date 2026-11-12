/** Private element and script names. Never the stock Bubble or Mushroom tags. */
export const BUBBLE_ELEMENT = "area-card-bubble";
export const BUBBLE_SCRIPT = "area-card-bubble.js";
export const MUSHROOM_SCRIPT = "area-card-mushroom.js";

export function mushroomCardType(name: string): string {
  return `custom:area-card-mushroom-${name}`;
}

export function areaHash(areaId: string): string {
  return `#area-${areaId}`;
}
