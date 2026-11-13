const ROOM_SEPARATOR = "(?:[\\s\\-\\u2013\\u2014:|\\u00b7\\u2022]+|$)";

/** Drop a leading room name from an entity title. Exact and unrelated titles stay put. */
export function stripRoomName(title: string, roomName: string): string {
  const room = roomName.trim();
  if (!room || !title) return title;
  const pattern = new RegExp(`^${escapeRegExp(room)}${ROOM_SEPARATOR}`, "i");
  const match = pattern.exec(title);
  if (!match || match[0].length === title.length) return title;
  const rest = title.slice(match[0].length).trim();
  return rest || title;
}

/**
 * True when `name` contains `roomName` as a whole phrase.
 * A longer area name that also appears wins, so "Bedroom" does not claim "Master Bedroom".
 */
export function matchesRoomPhrase(name: string, roomName: string, areaNames: readonly string[] = []): boolean {
  const room = roomName.trim();
  if (!room || !containsPhrase(name, room)) return false;
  for (const other of areaNames) {
    const candidate = other.trim();
    if (!candidate || candidate.toLowerCase() === room.toLowerCase()) continue;
    if (candidate.length <= room.length) continue;
    if (!containsPhrase(candidate, room)) continue;
    if (containsPhrase(name, candidate)) return false;
  }
  return true;
}

function containsPhrase(name: string, phrase: string): boolean {
  const words = phrase.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return false;
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9])${words.join("\\s+")}(?:[^A-Za-z0-9]|$)`, "i");
  return pattern.test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
