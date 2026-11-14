/**
 * Parsing and serialization stay pure. Persistence is Home Assistant frontend
 * user data in user-data.ts.
 */
export const PINNED_KEY_PREFIX = "area-card-pinned:";

const SECTION_TITLE = "custom:area-card-section-title";
const LIGHT_ROW = "custom:area-card-light-row";

export function pinnedKey(areaId: string): string {
  return `${PINNED_KEY_PREFIX}${areaId}`;
}

export type PinMode = "hidden" | "always" | "when-on";

/** Always pins and while-on pins for one area. An id is in at most one list. */
export interface AreaPins {
  always: string[];
  whenOn: string[];
}

function emptyPins(): AreaPins {
  return { always: [], whenOn: [] };
}

function pinEntry(entry: unknown): { id: string; mode: "always" | "when-on" } | null {
  if (typeof entry === "string") return entry.length > 0 ? { id: entry, mode: "always" } : null;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const id = (entry as { id?: unknown }).id;
  const mode = (entry as { mode?: unknown }).mode;
  if (typeof id !== "string" || id.length === 0) return null;
  if (mode === "when-on" || mode === "always") return { id, mode };
  return null;
}

/**
 * A JSON string is parsed, then treated like an array. An already-parsed array
 * uses the same rules. Strings are always-pins. `{ id, mode: "when-on" | "always" }`
 * is a pin object. The last entry for an id wins, in first-seen order, and that
 * id stays in only one list. Null, undefined, bad JSON, and non-arrays are empty.
 */
export function parseAreaPins(raw: unknown): AreaPins {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length === 0) return emptyPins();
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptyPins();
    }
  }
  if (!Array.isArray(parsed)) return emptyPins();
  const modes = new Map<string, "always" | "when-on">();
  const order: string[] = [];
  for (const entry of parsed) {
    const pin = pinEntry(entry);
    if (!pin) continue;
    if (!modes.has(pin.id)) order.push(pin.id);
    modes.set(pin.id, pin.mode);
  }
  const pins = emptyPins();
  for (const id of order) {
    if (modes.get(id) === "when-on") pins.whenOn.push(id);
    else pins.always.push(id);
  }
  return pins;
}

/** Stored pin value. Strings only when every pin is always. */
export function serializeAreaPins(pins: AreaPins): Array<string | { id: string; mode: "when-on" }> {
  if (pins.whenOn.length === 0) return [...pins.always];
  return [...pins.always, ...pins.whenOn.map((id) => ({ id, mode: "when-on" as const }))];
}

/** Always if the id is in that list, otherwise while on, otherwise hidden. */
export function pinMode(pins: AreaPins, entityId: string): PinMode {
  if (pins.always.includes(entityId)) return "always";
  if (pins.whenOn.includes(entityId)) return "when-on";
  return "hidden";
}

/** Hidden becomes always, always becomes while on, and while on becomes hidden. */
export function cyclePin(pins: AreaPins, entityId: string): AreaPins {
  const mode = pinMode(pins, entityId);
  const always = pins.always.filter((id) => id !== entityId);
  const whenOn = pins.whenOn.filter((id) => id !== entityId);
  if (mode === "hidden") always.push(entityId);
  else if (mode === "always") whenOn.push(entityId);
  return { always, whenOn };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Entity id a popup row can be pinned by.
 * Section titles and the Status chips card are not rows. A light row pins its inner card.
 */
export function pinEntityId(config: Record<string, unknown> | null | undefined): string | null {
  if (!config) return null;
  const type = config.type;
  if (type === SECTION_TITLE) return null;
  if (typeof type === "string" && type.endsWith("chips-card")) return null;
  if (type === LIGHT_ROW) {
    const card = config.card;
    if (typeof card !== "object" || card === null) return null;
    return nonEmptyString((card as Record<string, unknown>).entity);
  }
  return nonEmptyString(config.entity);
}

/** Popup order, original card objects, first entity id only. */
export function selectPinnedCards(
  cards: readonly Record<string, unknown>[],
  pinned: readonly string[],
): Record<string, unknown>[] {
  const wanted = new Set(pinned);
  const seen = new Set<string>();
  const selected: Record<string, unknown>[] = [];
  for (const card of cards) {
    const id = pinEntityId(card);
    if (!id || !wanted.has(id) || seen.has(id)) continue;
    seen.add(id);
    selected.push(card);
  }
  return selected;
}

/**
 * How a pinned card is drawn under the area button.
 * `half` shares a row. `expanded-full` is a half-width card stretched because
 * it has no partner. `full` was already full width and stays on its own row.
 */
export type PinnedLayoutWidth = "half" | "expanded-full" | "full";

export interface PinnedLayoutCard {
  config: Record<string, unknown>;
  width: PinnedLayoutWidth;
}

export interface PinnedLayoutRow {
  cards: PinnedLayoutCard[];
}

/** Where a pinned card sits against the area button and the other pinned cards. */
export interface PinnedEdge {
  first: boolean;
  last: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Square every corner that meets the area button or another pinned card.
 * Outer bottom corners are omitted so each bottom card keeps its own radius.
 * A pill radius on the stack clips a tall card.
 */
export function pinnedEdgeRadius(edge: PinnedEdge): string {
  const parts = [
    "border-top-left-radius:0 !important",
    "border-top-right-radius:0 !important",
  ];
  if (!(edge.last && edge.left)) parts.push("border-bottom-left-radius:0 !important");
  if (!(edge.last && edge.right)) parts.push("border-bottom-right-radius:0 !important");
  return parts.join(";");
}

function pinnedBody(config: Record<string, unknown>): Record<string, unknown> {
  if (config.type !== LIGHT_ROW) return config;
  const card = config.card;
  if (typeof card !== "object" || card === null || Array.isArray(card)) return config;
  return card as Record<string, unknown>;
}

function gridRows(config: Record<string, unknown>): unknown {
  const grid = config.grid_options;
  if (typeof grid !== "object" || grid === null || Array.isArray(grid)) return undefined;
  return (grid as { rows?: unknown }).rows;
}

function controlFlag(config: Record<string, unknown>, key: string): boolean {
  return config[key] === true;
}

/**
 * Two visual rows under the name.
 * A dimmable light or a cover with its control, or a card that declares
 * `grid_options.rows === 2`. A light row is judged by the card inside it.
 */
export function isDoubleTallPinnedCard(config: Record<string, unknown>): boolean {
  const body = pinnedBody(config);
  if (gridRows(config) === 2 || (body !== config && gridRows(body) === 2)) return true;
  const type = body.type;
  if (typeof type !== "string") return false;
  if (type.endsWith("light-card")) {
    return (
      controlFlag(body, "show_brightness_control") ||
      controlFlag(body, "show_color_temp_control") ||
      controlFlag(body, "show_color_control")
    );
  }
  if (type.endsWith("cover-card")) {
    return (
      controlFlag(body, "show_position_control") ||
      controlFlag(body, "show_buttons_control") ||
      controlFlag(body, "show_tilt_position_control")
    );
  }
  return false;
}

/**
 * Half-width, double-tall, and stretched because it has no partner.
 * A paired half and a card that was already full width stay stacked.
 */
export function pinnedRowsSideBySide(config: Record<string, unknown>, width: PinnedLayoutWidth): boolean {
  return width === "expanded-full" && isDoubleTallPinnedCard(config);
}

/**
 * Name row and control row as two equal columns, one row tall.
 * A single slotted row still fills the card. Controls stay visible.
 */
export function pinnedSideBySideStyles(): string {
  return [
    ".container {",
    "  flex-direction: row !important;",
    "  flex-wrap: nowrap !important;",
    "  align-items: center !important;",
    "  overflow: visible !important;",
    "}",
    ".container > ::slotted(area-card-mushroom-state-item),",
    ".container > ::slotted(.actions) {",
    "  flex: 1 1 0% !important;",
    "  min-width: 0 !important;",
    "  max-width: none !important;",
    "  overflow: visible !important;",
    "}",
    ".container > ::slotted(.actions) {",
    "  padding-top: 0 !important;",
    "  padding-bottom: 0 !important;",
    "  padding-left: 0 !important;",
    "  --control-spacing: var(--spacing);",
    "  --control-height: var(--icon-size);",
    "}",
  ].join("\n");
}

/** Keeps the slider and buttons from being clipped by the card that owns them. */
export function pinnedSideBySideHostStyles(): string {
  return [
    "ha-card {",
    "  overflow: visible !important;",
    "  height: auto !important;",
    "}",
    "area-card-mushroom-state-item {",
    "  flex: 1 1 0% !important;",
    "  min-width: 0 !important;",
    "  max-width: none !important;",
    "}",
    ".actions {",
    "  overflow: visible !important;",
    "  flex: 1 1 0% !important;",
    "  min-width: 0 !important;",
    "  max-width: none !important;",
    "  align-items: center !important;",
    "  padding-top: 0 !important;",
    "  padding-bottom: 0 !important;",
    "  padding-left: 0 !important;",
    "  --control-spacing: var(--spacing);",
    "  --control-height: var(--icon-size);",
    "}",
  ].join("\n");
}

/**
 * Two columns for a card whose rows are direct children of ha-card.
 * A third block wraps instead of becoming another column.
 */
export function pinnedSideBySideGridStyles(): string {
  return [
    "ha-card {",
    "  display: grid !important;",
    "  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;",
    "  grid-auto-flow: row !important;",
    "  align-items: center !important;",
    "  overflow: visible !important;",
    "  height: auto !important;",
    "}",
    "ha-card > * {",
    "  min-width: 0 !important;",
    "  overflow: visible !important;",
    "}",
  ].join("\n");
}

/** Half of a Bubble popup row. Anything else, including a missing grid, is full width. */
function isHalfWidthPinnedCard(config: Record<string, unknown>): boolean {
  const grid = config.grid_options;
  if (typeof grid !== "object" || grid === null || Array.isArray(grid)) return false;
  return (grid as { columns?: unknown }).columns === 6;
}

/**
 * Pack pinned cards for the collapsed stack, in popup order.
 * Two consecutive half-width cards share a row. A full-width card always takes
 * its own row and breaks a pair. A half left without a partner expands.
 * Card objects are returned as-is so the popup keeps `grid_options.columns === 6`.
 */
export function layoutPinnedCards(cards: readonly Record<string, unknown>[]): PinnedLayoutRow[] {
  const rows: PinnedLayoutRow[] = [];
  let index = 0;
  while (index < cards.length) {
    const config = cards[index];
    if (!isHalfWidthPinnedCard(config)) {
      rows.push({ cards: [{ config, width: "full" }] });
      index += 1;
      continue;
    }
    const next = cards[index + 1];
    if (next && isHalfWidthPinnedCard(next)) {
      rows.push({
        cards: [
          { config, width: "half" },
          { config: next, width: "half" },
        ],
      });
      index += 2;
      continue;
    }
    rows.push({ cards: [{ config, width: "expanded-full" }] });
    index += 1;
  }
  return rows;
}
