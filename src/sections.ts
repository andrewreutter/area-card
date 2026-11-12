export interface RegistryEntry {
  entity_id: string;
  area_id?: string | null;
  device_id?: string | null;
  platform?: string | null;
  entity_category?: string | null;
  hidden_by?: string | null;
  hidden?: boolean | null;
  disabled_by?: string | null;
  device_class?: string | null;
  original_device_class?: string | null;
}

export interface DeviceEntry {
  id: string;
  area_id?: string | null;
  manufacturer?: string | null;
  name?: string | null;
}

export interface EntityState {
  entity_id?: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface AreaEntry {
  area_id?: string;
  name?: string;
  icon?: string | null;
}

export interface ClassifierHass {
  states?: Record<string, EntityState>;
  entities?: Record<string, RegistryEntry> | RegistryEntry[];
  devices?: Record<string, DeviceEntry> | DeviceEntry[];
  areas?: Record<string, AreaEntry>;
}

export interface OccupancyItem {
  entityId: string;
  pressureEntityId?: string;
}

export interface SatelliteItem {
  entityId: string;
  ledEntityId?: string;
}

export interface AreaSections {
  status: string[];
  lights: string[];
  mediaPlayers: string[];
  switches: string[];
  occupancy: OccupancyItem[];
  openings: string[];
  satellites: SatelliteItem[];
  helpers: string[];
  selects: string[];
  automations: string[];
}

const OCCUPANCY_CLASSES = new Set(["occupancy", "motion", "presence", "chair", "bed"]);
const OPENING_CLASSES = new Set(["door", "window", "opening", "garage_door"]);

export function emptySections(): AreaSections {
  return {
    status: [],
    lights: [],
    mediaPlayers: [],
    switches: [],
    occupancy: [],
    openings: [],
    satellites: [],
    helpers: [],
    selects: [],
    automations: [],
  };
}

export function areaDisplay(hass: ClassifierHass, areaId: string): { name: string; icon: string } {
  const area = hass.areas?.[areaId];
  return {
    name: area?.name || areaId,
    icon: area?.icon || "mdi:door",
  };
}

export function classifyArea(hass: ClassifierHass, areaId: string): AreaSections {
  const devices = deviceMap(hass.devices);
  const states = hass.states ?? {};
  const entries = registryEntries(hass).filter((entry) => {
    if (!entry.entity_id || !states[entry.entity_id]) return false;
    if (isHidden(entry)) return false;
    return areaOf(entry, devices) === areaId;
  });

  const pressureByDevice = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.device_id) continue;
    if (!isPressureReading(entry.entity_id, deviceClass(entry, states[entry.entity_id]))) continue;
    const existing = pressureByDevice.get(entry.device_id);
    if (!existing || entry.entity_id < existing) {
      pressureByDevice.set(entry.device_id, entry.entity_id);
    }
  }

  const sections = emptySections();

  for (const entry of entries) {
    const id = entry.entity_id;
    const domain = id.split(".")[0] ?? "";
    const state = states[id];
    const dc = deviceClass(entry, state);
    const device = entry.device_id ? devices[entry.device_id] : undefined;
    const suppressed = isDiagnosticOrConfig(entry);

    if (isPressureReading(id, dc)) continue;

    if (domain === "automation") {
      sections.automations.push(id);
      continue;
    }

    if (domain === "assist_satellite") {
      sections.satellites.push({
        entityId: id,
        ledEntityId: companionLed(entry.device_id, entries),
      });
      continue;
    }

    if (isLedSwitch(id)) {
      sections.helpers.push(id);
      continue;
    }

    if (entry.platform === "template") {
      sections.helpers.push(id);
      continue;
    }

    if (domain === "light") {
      if (suppressed || isSatelliteLed(id, device)) continue;
      sections.lights.push(id);
      continue;
    }

    if (domain === "media_player") {
      if (suppressed) continue;
      sections.mediaPlayers.push(id);
      continue;
    }

    if (domain === "switch") {
      if (suppressed || isKioskSatellite(device)) continue;
      sections.switches.push(id);
      continue;
    }

    if (domain === "cover") {
      if (suppressed) continue;
      sections.openings.push(id);
      continue;
    }

    if (domain === "input_select") {
      sections.selects.push(id);
      continue;
    }

    if (domain === "input_boolean" || domain === "timer") {
      sections.helpers.push(id);
      continue;
    }

    if (domain === "binary_sensor") {
      if (suppressed) continue;
      if (dc && OPENING_CLASSES.has(dc)) {
        sections.openings.push(id);
        continue;
      }
      if ((dc && OCCUPANCY_CLASSES.has(dc)) || mentionsChairOrBed(id, friendlyName(state))) {
        sections.occupancy.push({
          entityId: id,
          pressureEntityId: entry.device_id ? pressureByDevice.get(entry.device_id) : undefined,
        });
        continue;
      }
      sections.status.push(id);
      continue;
    }

    if (domain === "sensor" && (dc === "temperature" || dc === "humidity")) {
      if (suppressed) continue;
      sections.status.push(id);
    }
  }

  sections.status = sortIds(sections.status, states);
  sections.lights = sortIds(sections.lights, states);
  sections.mediaPlayers = sortIds(sections.mediaPlayers, states);
  sections.switches = sortIds(sections.switches, states);
  sections.openings = sortIds(sections.openings, states);
  sections.helpers = sortIds(sections.helpers, states);
  sections.selects = sortIds(sections.selects, states);
  sections.automations = sortIds(sections.automations, states);
  sections.occupancy.sort((a, b) => compareIds(a.entityId, b.entityId, states));
  sections.satellites.sort((a, b) => compareIds(a.entityId, b.entityId, states));
  return sections;
}

export function membershipKey(areaId: string, name: string, icon: string, sections: AreaSections): string {
  const occupancy = sections.occupancy
    .map((item) => `${item.entityId}=${item.pressureEntityId ?? ""}`)
    .join(",");
  const satellites = sections.satellites
    .map((item) => `${item.entityId}=${item.ledEntityId ?? ""}`)
    .join(",");
  return [
    areaId,
    name,
    icon,
    sections.status.join(","),
    sections.lights.join(","),
    sections.mediaPlayers.join(","),
    sections.switches.join(","),
    occupancy,
    sections.openings.join(","),
    satellites,
    sections.helpers.join(","),
    sections.selects.join(","),
    sections.automations.join(","),
  ].join("|");
}

const LIGHT_ACTIVE = new Set(["on"]);
const PRESENCE_ACTIVE = new Set(["on", "home", "occupied", "open", "true", "active"]);

export function pickRepresentative(
  ids: string[],
  states: Record<string, EntityState | undefined>,
  kind: "light" | "presence",
): string | undefined {
  if (ids.length === 0) return undefined;
  const active = kind === "light" ? LIGHT_ACTIVE : PRESENCE_ACTIVE;
  return ids.find((id) => active.has(states[id]?.state ?? "")) ?? ids[0];
}

function registryEntries(hass: ClassifierHass): RegistryEntry[] {
  const entities = hass.entities;
  if (!entities) return [];
  if (Array.isArray(entities)) {
    return entities.map((entry) => normalizeEntry(entry));
  }
  return Object.entries(entities).map(([key, entry]) => normalizeEntry(entry, key));
}

function normalizeEntry(entry: RegistryEntry, key?: string): RegistryEntry {
  return {
    ...entry,
    entity_id: entry.entity_id || key || "",
  };
}

function deviceMap(devices: ClassifierHass["devices"]): Record<string, DeviceEntry> {
  if (!devices) return {};
  if (Array.isArray(devices)) {
    return Object.fromEntries(devices.map((device) => [device.id, device]));
  }
  return devices;
}

function areaOf(entry: RegistryEntry, devices: Record<string, DeviceEntry>): string | null {
  if (entry.area_id) return entry.area_id;
  if (!entry.device_id) return null;
  return devices[entry.device_id]?.area_id || null;
}

function isHidden(entry: RegistryEntry): boolean {
  return Boolean(entry.hidden || entry.hidden_by || entry.disabled_by);
}

function isDiagnosticOrConfig(entry: RegistryEntry): boolean {
  return entry.entity_category === "diagnostic" || entry.entity_category === "config";
}

function deviceClass(entry: RegistryEntry, state: EntityState | undefined): string | undefined {
  const fromState = state?.attributes?.device_class;
  if (typeof fromState === "string" && fromState) return fromState;
  return entry.device_class || entry.original_device_class || undefined;
}

function friendlyName(state: EntityState | undefined): string | undefined {
  const name = state?.attributes?.friendly_name;
  return typeof name === "string" ? name : undefined;
}

function isKioskSatellite(device: DeviceEntry | undefined): boolean {
  return /kiosk[\s_-]*satellite/i.test(device?.manufacturer ?? "");
}

function isSatelliteLed(entityId: string, device: DeviceEntry | undefined): boolean {
  if (!entityId.startsWith("light.")) return false;
  if (entityId.includes("led_control")) return true;
  return isKioskSatellite(device);
}

function isLedSwitch(entityId: string): boolean {
  return /^switch\..*_led$/.test(entityId);
}

function isPressureReading(entityId: string, deviceClassName: string | undefined): boolean {
  if (!entityId.startsWith("sensor.")) return false;
  if (deviceClassName === "pressure") return true;
  return entityId.endsWith("_pressure");
}

function mentionsChairOrBed(entityId: string, name?: string): boolean {
  const tail = entityId.includes(".") ? entityId.slice(entityId.indexOf(".") + 1) : entityId;
  if (hasWord(tail, "chair") || hasWord(tail, "bed")) return true;
  if (!name) return false;
  return hasWord(name, "chair") || hasWord(name, "bed");
}

function hasWord(value: string, word: string): boolean {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes(word);
}

function companionLed(deviceId: string | null | undefined, entries: RegistryEntry[]): string | undefined {
  if (!deviceId) return undefined;
  const lights = entries
    .filter((entry) => entry.device_id === deviceId && entry.entity_id.startsWith("light."))
    .map((entry) => entry.entity_id)
    .sort();
  return lights.find((id) => id.includes("led_control")) ?? lights.find((id) => id.includes("led")) ?? lights[0];
}

function sortIds(ids: string[], states: Record<string, EntityState>): string[] {
  return [...ids].sort((a, b) => compareIds(a, b, states));
}

function compareIds(a: string, b: string, states: Record<string, EntityState>): number {
  const an = friendlyName(states[a]) ?? a;
  const bn = friendlyName(states[b]) ?? b;
  return an.localeCompare(bn) || a.localeCompare(b);
}
