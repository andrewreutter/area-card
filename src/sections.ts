import { matchesRoomPhrase } from "./names";

export interface RegistryEntry {
  entity_id: string;
  /** Entity registry id. Device triggers store this, not the entity_id. */
  id?: string;
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
  last_updated?: string;
}

export interface AreaEntry {
  area_id?: string;
  name?: string;
  icon?: string | null;
  picture?: string | null;
  floor_id?: string | null;
}

export interface FloorEntry {
  floor_id?: string;
  name?: string;
  icon?: string | null;
}

export interface ClassifierHass {
  states?: Record<string, EntityState>;
  entities?: Record<string, RegistryEntry> | RegistryEntry[];
  devices?: Record<string, DeviceEntry> | DeviceEntry[];
  areas?: Record<string, AreaEntry>;
  floors?: Record<string, FloorEntry>;
  hassUrl?: (path: string) => string;
  callWS?: (message: { type: string; entity_id?: string }) => Promise<unknown>;
  formatEntityState?: (stateObj: EntityState, state?: string) => string;
}

export interface OccupancyItem {
  entityId: string;
  pressureEntityId?: string;
}

export interface SatelliteItem {
  entityId: string;
  ledEntityId?: string;
  alarmEntityId?: string;
}

export interface AreaSections {
  climate: string[];
  lights: string[];
  lightLeds: Record<string, string>;
  mediaPlayers: string[];
  cameras: string[];
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
    climate: [],
    lights: [],
    lightLeds: {},
    mediaPlayers: [],
    cameras: [],
    switches: [],
    occupancy: [],
    openings: [],
    satellites: [],
    helpers: [],
    selects: [],
    automations: [],
  };
}

export function areaDisplay(
  hass: ClassifierHass,
  areaId: string,
): { name: string; icon: string; picture: string | null } {
  const area = hass.areas?.[areaId];
  return {
    name: area?.name || areaId,
    icon: area?.icon || "mdi:door",
    picture: resolvePicture(hass, area?.picture),
  };
}

const PURE_HELPER_DOMAINS = new Set(["input_boolean", "input_select", "timer"]);

/**
 * True when the area has device entities and every one of them is unavailable.
 * Pure helpers and template helpers that are not device entities are ignored.
 * An area with no device entities stays available.
 * A disabled automation does not count as available, so it cannot keep the area lit.
 */
export function areaUnavailable(
  hass: ClassifierHass,
  areaId: string,
  disabledAutomations: ReadonlySet<string> = new Set(),
): boolean {
  const devices = deviceMap(hass.devices);
  const states = hass.states ?? {};
  const deviceEntities = registryEntries(hass).filter((entry) => {
    if (!entry.entity_id || !states[entry.entity_id]) return false;
    if (isHidden(entry)) return false;
    if (areaOf(entry, devices) !== areaId) return false;
    return isDeviceEntity(entry);
  });
  if (deviceEntities.length === 0) return false;
  return deviceEntities.every((entry) => {
    if (disabledAutomations.has(entry.entity_id)) return true;
    return states[entry.entity_id]?.state === "unavailable";
  });
}

function resolvePicture(hass: ClassifierHass, picture: string | null | undefined): string | null {
  if (!picture) return null;
  if (typeof hass.hassUrl !== "function") return picture;
  return hass.hassUrl(picture);
}

function isDeviceEntity(entry: RegistryEntry): boolean {
  const domain = entry.entity_id.split(".")[0] ?? "";
  if (PURE_HELPER_DOMAINS.has(domain)) return false;
  if (entry.platform === "template" && !entry.device_id) return false;
  return Boolean(entry.device_id);
}

export function classifyArea(hass: ClassifierHass, areaId: string): AreaSections {
  const devices = deviceMap(hass.devices);
  const states = hass.states ?? {};
  const allEntries = registryEntries(hass);
  const satelliteDevices = satelliteDeviceIds(allEntries, devices);
  const entries = allEntries.filter((entry) => {
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

  const renderedLights = entries.filter((entry) => isRenderedLight(entry, devices, satelliteDevices, states));
  const lightLeds = assignLightLeds(renderedLights, entries, satelliteDevices);
  const sections = emptySections();
  sections.lightLeds = lightLeds;

  for (const entry of entries) {
    const id = entry.entity_id;
    const domain = id.split(".")[0] ?? "";
    const state = states[id];
    const dc = deviceClass(entry, state);
    const device = entry.device_id ? devices[entry.device_id] : undefined;
    const suppressed = isDiagnosticOrConfig(entry);

    if (isPressureReading(id, dc)) continue;

    if (isSatelliteRelated(entry, satelliteDevices)) {
      if (domain === "assist_satellite") {
        sections.satellites.push(satelliteItem(entry, entries, states));
      }
      continue;
    }

    if (domain === "automation") {
      sections.automations.push(id);
      continue;
    }

    if (domain === "sensor" && (dc === "temperature" || dc === "humidity")) {
      if (!suppressed) sections.climate.push(id);
      continue;
    }

    if (isLedSwitch(id)) continue;

    if (domain === "camera") {
      if (suppressed) continue;
      sections.cameras.push(id);
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
      if (suppressed) continue;
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
      }
    }
  }

  appendNamedAutomations(hass, areaId, allEntries, states, sections);
  appendSatelliteMediaPlayers(sections, allEntries, devices, states);

  sections.climate = sortIds(sections.climate, states);
  sections.lights = sortIds(sections.lights, states);
  sections.mediaPlayers = sortIds(sections.mediaPlayers, states);
  sections.cameras = sortIds(sections.cameras, states);
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
    .map((item) => `${item.entityId}=${item.ledEntityId ?? ""}=${item.alarmEntityId ?? ""}`)
    .join(",");
  const leds = sections.lights.map((id) => `${id}=${sections.lightLeds[id] ?? ""}`).join(",");
  return [
    areaId,
    name,
    icon,
    sections.climate.join(","),
    sections.lights.join(","),
    leds,
    sections.mediaPlayers.join(","),
    sections.cameras.join(","),
    sections.switches.join(","),
    occupancy,
    sections.openings.join(","),
    satellites,
    sections.helpers.join(","),
    sections.selects.join(","),
    sections.automations.join(","),
  ].join("|");
}

function appendNamedAutomations(
  hass: ClassifierHass,
  areaId: string,
  allEntries: RegistryEntry[],
  states: Record<string, EntityState>,
  sections: AreaSections,
): void {
  const roomName = hass.areas?.[areaId]?.name;
  if (typeof roomName !== "string" || roomName.trim() === "") return;
  const areaNames = Object.values(hass.areas ?? {})
    .map((area) => area?.name ?? "")
    .filter((name) => name.trim() !== "");
  const seen = new Set(sections.automations);
  for (const entry of allEntries) {
    const id = entry.entity_id;
    if (!id.startsWith("automation.")) continue;
    if (seen.has(id)) continue;
    if (!states[id] || isHidden(entry)) continue;
    const name = friendlyName(states[id]);
    if (!name || !matchesRoomPhrase(name, roomName, areaNames)) continue;
    sections.automations.push(id);
    seen.add(id);
  }
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

function satelliteDeviceIds(entries: RegistryEntry[], devices: Record<string, DeviceEntry>): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.device_id) continue;
    const domain = entry.entity_id.split(".")[0] ?? "";
    if (domain === "assist_satellite" || isKioskSatellite(devices[entry.device_id])) {
      ids.add(entry.device_id);
    }
  }
  return ids;
}

function isSatelliteRelated(entry: RegistryEntry, satelliteDevices: Set<string>): boolean {
  const domain = entry.entity_id.split(".")[0] ?? "";
  if (domain === "assist_satellite") return true;
  return Boolean(entry.device_id && satelliteDevices.has(entry.device_id));
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

function isRenderedLight(
  entry: RegistryEntry,
  devices: Record<string, DeviceEntry>,
  satelliteDevices: Set<string>,
  states: Record<string, EntityState>,
): boolean {
  const id = entry.entity_id;
  if (!id.startsWith("light.")) return false;
  if (isSatelliteRelated(entry, satelliteDevices)) return false;
  if (isDiagnosticOrConfig(entry)) return false;
  if (entry.platform === "template") return false;
  const device = entry.device_id ? devices[entry.device_id] : undefined;
  if (isSatelliteLed(id, device)) return false;
  if (isPressureReading(id, deviceClass(entry, states[id]))) return false;
  return true;
}

function assignLightLeds(
  lights: RegistryEntry[],
  entries: RegistryEntry[],
  satelliteDevices: Set<string>,
): Record<string, string> {
  const leds = entries.filter(
    (entry) => isLedSwitch(entry.entity_id) && entry.device_id && !isSatelliteRelated(entry, satelliteDevices),
  );
  const assigned = new Map<string, string>();
  const used = new Set<string>();

  for (const light of lights) {
    if (!light.device_id) continue;
    const stem = light.entity_id.slice("light.".length);
    const named = leds.find(
      (entry) =>
        entry.device_id === light.device_id &&
        entry.entity_id === `switch.${stem}_led` &&
        !used.has(entry.entity_id),
    );
    if (!named) continue;
    assigned.set(light.entity_id, named.entity_id);
    used.add(named.entity_id);
  }

  for (const light of lights) {
    if (!light.device_id || assigned.has(light.entity_id)) continue;
    const available = leds.filter((entry) => entry.device_id === light.device_id && !used.has(entry.entity_id));
    const openLights = lights.filter((entry) => entry.device_id === light.device_id && !assigned.has(entry.entity_id));
    if (available.length !== 1 || openLights.length !== 1) continue;
    assigned.set(light.entity_id, available[0].entity_id);
    used.add(available[0].entity_id);
  }

  return Object.fromEntries(assigned);
}

function appendSatelliteMediaPlayers(
  sections: AreaSections,
  allEntries: RegistryEntry[],
  devices: Record<string, DeviceEntry>,
  states: Record<string, EntityState>,
): void {
  const byId = new Map(allEntries.map((entry) => [entry.entity_id, entry]));
  const seen = new Set(sections.mediaPlayers);
  for (const item of sections.satellites) {
    const playerId = satelliteMediaPlayerId(item.entityId);
    if (!playerId || seen.has(playerId)) continue;
    const entry = byId.get(playerId);
    if (!entry || isHidden(entry) || isDiagnosticOrConfig(entry) || !states[playerId]) continue;
    const device = entry.device_id ? devices[entry.device_id] : undefined;
    if (!isKioskSatellite(device)) continue;
    sections.mediaPlayers.push(playerId);
    seen.add(playerId);
  }
}

function satelliteMediaPlayerId(entityId: string): string | undefined {
  const prefix = "assist_satellite.";
  if (!entityId.startsWith(prefix)) return undefined;
  let objectId = entityId.slice(prefix.length);
  const suffix = "_assist_satellite";
  if (objectId.endsWith(suffix)) objectId = objectId.slice(0, -suffix.length);
  if (!objectId) return undefined;
  return `media_player.${objectId}`;
}

function satelliteItem(entry: RegistryEntry, entries: RegistryEntry[], states: Record<string, EntityState>): SatelliteItem {
  const item: SatelliteItem = { entityId: entry.entity_id };
  const led = companionLed(entry.device_id, entries);
  const alarm = companionAlarm(entry.device_id, entries, states);
  if (led) item.ledEntityId = led;
  if (alarm) item.alarmEntityId = alarm;
  return item;
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

function companionAlarm(
  deviceId: string | null | undefined,
  entries: RegistryEntry[],
  states: Record<string, EntityState>,
): string | undefined {
  if (!deviceId) return undefined;
  const matches = entries
    .filter(
      (entry) =>
        entry.device_id === deviceId &&
        entry.entity_id.startsWith("binary_sensor.") &&
        isAlarmRinging(entry.entity_id, states[entry.entity_id]),
    )
    .map((entry) => entry.entity_id)
    .sort();
  return matches[0];
}

function isAlarmRinging(entityId: string, state: EntityState | undefined): boolean {
  if (entityId.includes("alarm_ringing")) return true;
  const name = friendlyName(state);
  return Boolean(name && /alarm[\s_-]*ringing/i.test(name));
}

function sortIds(ids: string[], states: Record<string, EntityState>): string[] {
  return [...ids].sort((a, b) => compareIds(a, b, states));
}

function compareIds(a: string, b: string, states: Record<string, EntityState>): number {
  const an = friendlyName(states[a]) ?? a;
  const bn = friendlyName(states[b]) ?? b;
  return an.localeCompare(bn) || a.localeCompare(b);
}
