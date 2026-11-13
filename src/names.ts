const ROOM_SEPARATOR = "(?:[\\s\\-\\u2013\\u2014:|]+|$)";

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
