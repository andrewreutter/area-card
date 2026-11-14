/** Private element and script names. Never the stock Bubble or Mushroom tags. */
export const BUBBLE_ELEMENT = "area-card-bubble";
export const BUBBLE_CARD_TYPE = "custom:area-card-bubble";
export const BUBBLE_SCRIPT = "area-card-bubble.js";
export const MUSHROOM_SCRIPT = "area-card-mushroom.js";

/**
 * Popup row grid inside the bubble shadow root.
 * The vendor prefix replaces the substring `bubble-card`, so Bubble's
 * `bubble-cards-grid-container` is emitted as `area-card-bubbles-grid-container`.
 */
export const BUBBLE_CARDS_GRID = "area-card-bubbles-grid-container";

export function mushroomCardType(name: string): string {
  return `custom:area-card-mushroom-${name}`;
}

export function areaHash(areaId: string): string {
  return `#area-${areaId}`;
}
