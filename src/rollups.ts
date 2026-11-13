import type { AreaSections, EntityState } from "./sections";

export const ROLLUP_ORDER = [
  "climate",
  "lights",
  "media",
  "switches",
  "occupancy",
  "openings",
  "satellites",
  "helpers",
  "automations",
] as const;

export type RollupId = (typeof ROLLUP_ORDER)[number];

export function emptyRollupDotClass(id: RollupId): string {
  return `area-dot-${id}-empty`;
}

export interface SectionRollup {
  id: RollupId;
  title: string;
  icon: string;
  iconColor: string;
  color: string;
  active: number;
  total: number;
  word: "On" | "Open";
}

const MEDIA_ACTIVE = new Set(["on", "playing", "paused", "buffering"]);
const BINARY_DOMAINS = new Set(["input_boolean", "switch", "binary_sensor"]);

const META: Record<RollupId, Omit<SectionRollup, "id" | "active" | "total">> = {
  climate: {
    title: "Climate",
    icon: "mdi:thermometer",
    iconColor: "light-blue",
    color: "rgb(3, 169, 244)",
    word: "On",
  },
  lights: {
    title: "Lights",
    icon: "mdi:lightbulb",
    iconColor: "amber",
    color: "rgb(255, 193, 7)",
    word: "On",
  },
  media: {
    title: "Media players",
    icon: "mdi:play-circle",
    iconColor: "purple",
    color: "rgb(146, 107, 199)",
    word: "On",
  },
  switches: {
    title: "Switches",
    icon: "mdi:toggle-switch",
    iconColor: "teal",
    color: "rgb(0, 150, 136)",
    word: "On",
  },
  occupancy: {
    title: "Occupancy",
    icon: "mdi:account",
    iconColor: "green",
    color: "rgb(76, 175, 80)",
    word: "On",
  },
  openings: {
    title: "Doors and windows",
    icon: "mdi:door",
    iconColor: "blue",
    color: "rgb(33, 150, 243)",
    word: "Open",
  },
  satellites: {
    title: "Kiosk & Satellites",
    icon: "mdi:tablet-dashboard",
    iconColor: "indigo",
    color: "rgb(63, 81, 181)",
    word: "On",
  },
  helpers: {
    title: "Helpers",
    icon: "mdi:cog",
    iconColor: "grey",
    color: "rgb(158, 158, 158)",
    word: "On",
  },
  automations: {
    title: "Automations",
    icon: "mdi:flash",
    iconColor: "yellow",
    color: "rgb(255, 235, 59)",
    word: "On",
  },
};

export function sectionRollups(
  sections: AreaSections,
  states: Record<string, EntityState | undefined>,
): SectionRollup[] {
  const rollups: SectionRollup[] = [];
  const add = (id: RollupId, active: number, total: number) => {
    if (total <= 0) return;
    rollups.push({ id, ...META[id], active, total });
  };

  const climate = sections.climate.filter(isOnOffEntity);
  add("climate", countActive(climate, states, isOn), climate.length);
  add("lights", countActive(sections.lights, states, isOn), sections.lights.length);
  add("media", countActive(sections.mediaPlayers, states, isMediaOn), sections.mediaPlayers.length);
  add("switches", countActive(sections.switches, states, isOn), sections.switches.length);
  add(
    "occupancy",
    countActive(
      sections.occupancy.map((item) => item.entityId),
      states,
      isOn,
    ),
    sections.occupancy.length,
  );
  add("openings", countActive(sections.openings, states, isOpeningActive), sections.openings.length);

  let satellitesOn = 0;
  for (const item of sections.satellites) {
    const alarm = item.alarmEntityId ? states[item.alarmEntityId]?.state : undefined;
    const led = item.ledEntityId ? states[item.ledEntityId]?.state : undefined;
    if (alarm === "on" || (alarm !== "on" && led === "on")) satellitesOn += 1;
  }
  add("satellites", satellitesOn, sections.satellites.length);

  const helpers = sections.helpers.filter(isOnOffEntity);
  add("helpers", countActive(helpers, states, isOn), helpers.length);
  add("automations", countActive(sections.automations, states, isOn), sections.automations.length);
  return rollups;
}

export function rollupLabel(rollup: SectionRollup): string {
  return `${rollup.title} ${rollup.active}/${rollup.total} ${rollup.word}`;
}

export function rollupDotClass(rollup: SectionRollup): string {
  return `area-dot-${rollup.id}-${rollup.active > 0 ? "on" : "off"}`;
}

export function rollupDotStyles(rollups: SectionRollup[]): string {
  const shape = [
    '.bubble-sub-button[class*="area-dot-"].hidden,',
    '.bubble-sub-button[class*="area-dot-"] {',
    "  display: flex !important;",
    "  width: 14px !important;",
    "  min-width: 14px !important;",
    "  max-width: 14px !important;",
    "  height: 14px !important;",
    "  min-height: 14px !important;",
    "  padding: 0 !important;",
    "  margin: 0 !important;",
    "  border: none !important;",
    "  border-radius: 50% !important;",
    "  flex: 0 0 14px !important;",
    "  overflow: hidden !important;",
    "  color: transparent !important;",
    "  --bubble-sub-button-height: 14px;",
    "}",
    '.bubble-sub-button[class*="area-dot-"] .bubble-sub-button-icon,',
    '.bubble-sub-button[class*="area-dot-"] ha-icon,',
    '.bubble-sub-button[class*="area-dot-"] .bubble-sub-button-name-container {',
    "  display: none !important;",
    "}",
  ];
  const empty = [
    '.bubble-sub-button[class*="area-dot-"][class*="-empty"] {',
    "  opacity: 0 !important;",
    "  visibility: hidden !important;",
    "  pointer-events: none !important;",
    "  background: transparent !important;",
    "  box-shadow: none !important;",
    "}",
  ];
  const colors = rollups.map((rollup) => {
    const cls = `.bubble-sub-button.${rollupDotClass(rollup)}`;
    if (rollup.active > 0) {
      return `${cls} { background: ${rollup.color} !important; box-shadow: none !important; }`;
    }
    return `${cls} { background: transparent !important; box-shadow: inset 0 0 0 1.5px ${rollup.color} !important; }`;
  });
  return [...shape, ...empty, ...colors].join("\n");
}

function isOnOffEntity(entityId: string): boolean {
  return BINARY_DOMAINS.has(entityId.split(".")[0] ?? "");
}

function isOn(_entityId: string, value: string): boolean {
  return value === "on";
}

function isMediaOn(_entityId: string, value: string): boolean {
  return MEDIA_ACTIVE.has(value);
}

function isOpeningActive(entityId: string, value: string): boolean {
  if (entityId.startsWith("cover.")) return value === "open" || value === "opening";
  return value === "on";
}

function countActive(
  ids: string[],
  states: Record<string, EntityState | undefined>,
  active: (entityId: string, value: string) => boolean,
): number {
  let count = 0;
  for (const id of ids) {
    if (active(id, states[id]?.state ?? "")) count += 1;
  }
  return count;
}
