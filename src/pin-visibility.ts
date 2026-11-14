import type { AreaPins } from "./pinned-entities";

/** How long a while-on row stays up after it turns off. Every domain, not only media. */
export const PIN_STICKY_MS = 120_000;

export interface PinStickyState {
  active: boolean;
  until?: number;
}

/** Missing, blank, unknown, and unavailable are inactive for every domain. */
export function entityPinActive(entityId: string, state: string | undefined): boolean {
  if (typeof state !== "string" || state.length === 0 || state === "unknown" || state === "unavailable") return false;
  const domain = entityId.split(".")[0];
  if (domain === "media_player") return state === "playing" || state === "on" || state === "buffering";
  if (domain === "cover") return state === "open" || state === "opening";
  return state === "on";
}

export function pinStickyKey(areaId: string, entityId: string): string {
  return `${areaId}\0${entityId}`;
}

/**
 * Always ids are included. A while-on id is included while it is active, and for
 * one sticky window after it falls inactive. A reload starts from an empty map,
 * so a paused player stays hidden until it plays again. The returned map has
 * only this area's current while-on ids.
 */
export function visiblePinnedIds(
  pins: AreaPins,
  stateOf: (entityId: string) => string | undefined,
  sticky: ReadonlyMap<string, PinStickyState>,
  areaId: string,
  now: number,
): { ids: string[]; sticky: Map<string, PinStickyState>; deadline?: number } {
  const ids = [...pins.always];
  const seen = new Set(pins.always);
  const next = new Map<string, PinStickyState>();
  let deadline: number | undefined;
  const note = (until: number) => {
    if (deadline === undefined || until < deadline) deadline = until;
  };

  for (const entityId of pins.whenOn) {
    const key = pinStickyKey(areaId, entityId);
    const active = entityPinActive(entityId, stateOf(entityId));
    const previous = sticky.get(key);
    if (active) {
      next.set(key, { active: true });
      if (!seen.has(entityId)) {
        seen.add(entityId);
        ids.push(entityId);
      }
      continue;
    }
    if (previous?.active) {
      const until = now + PIN_STICKY_MS;
      next.set(key, { active: false, until });
      note(until);
      if (!seen.has(entityId)) {
        seen.add(entityId);
        ids.push(entityId);
      }
      continue;
    }
    if (previous?.until !== undefined && now < previous.until) {
      next.set(key, { active: false, until: previous.until });
      note(previous.until);
      if (!seen.has(entityId)) {
        seen.add(entityId);
        ids.push(entityId);
      }
      continue;
    }
    next.set(key, { active: false });
  }

  return deadline === undefined ? { ids, sticky: next } : { ids, sticky: next, deadline };
}
