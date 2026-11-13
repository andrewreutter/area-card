/** localStorage is already per origin, so the floor id does not need a hass URL. */
export const FLOOR_EXPANDED_KEY_PREFIX = "area-card-floor-expanded:";

export function floorExpandedKey(floorId: string): string {
  return `${FLOOR_EXPANDED_KEY_PREFIX}${floorId}`;
}

/** Missing or unrecognized values keep the card's default, which is expanded. */
export function parseFloorExpanded(stored: string | null | undefined, fallback = true): boolean {
  if (stored === "true") return true;
  if (stored === "false") return false;
  return fallback;
}

export function readFloorExpanded(storage: Pick<Storage, "getItem"> | undefined, floorId: string): boolean {
  if (!storage) return true;
  try {
    return parseFloorExpanded(storage.getItem(floorExpandedKey(floorId)));
  } catch {
    return true;
  }
}

export function writeFloorExpanded(
  storage: Pick<Storage, "setItem"> | undefined,
  floorId: string,
  expanded: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(floorExpandedKey(floorId), expanded ? "true" : "false");
  } catch {
    // A blocked or full localStorage should not stop the chevron from toggling.
  }
}

export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
