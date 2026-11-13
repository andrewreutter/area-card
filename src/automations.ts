import type { ClassifierHass, RegistryEntry } from "./sections";

export interface AutomationTrigger {
  platform?: string;
  trigger?: string;
  device_id?: string;
  entity_id?: string | string[];
}

export interface AutomationConfig {
  triggers?: AutomationTrigger[] | AutomationTrigger;
  trigger?: AutomationTrigger[] | AutomationTrigger;
}

interface EntityIndex {
  byRef: Map<string, RegistryEntry>;
  byDevice: Map<string, RegistryEntry[]>;
}

const configCache = new Map<string, { stamp: string; config: AutomationConfig | null }>();
const inflight = new Map<string, Promise<AutomationConfig | null>>();
let registryCache: { key: string; entries: RegistryEntry[] } | null = null;
let registryInflight: { key: string; promise: Promise<RegistryEntry[]> } | null = null;

export function clearAutomationCache(): void {
  configCache.clear();
  inflight.clear();
  registryCache = null;
  registryInflight = null;
}

/**
 * True when every trigger depends on an unavailable device, so the automation
 * will never fire. A time, sun, event, or other independent trigger keeps it
 * enabled. Unknown configs stay enabled.
 */
export function isAutomationDisabled(
  config: AutomationConfig | null | undefined,
  hass: ClassifierHass,
  entries?: readonly RegistryEntry[],
): boolean {
  if (!config) return false;
  const triggers = triggerList(config);
  if (triggers.length === 0) return false;
  const index = entityIndex(entries ?? entriesFromHass(hass));
  return triggers.every((trigger) => triggerBlocked(trigger, hass, index));
}

/** Load configs once, then recompute from live states on later renders. */
export async function loadDisabledAutomations(
  hass: ClassifierHass,
  automationIds: readonly string[],
): Promise<Set<string>> {
  if (automationIds.length === 0) return new Set();
  try {
    const entries = await loadRegistry(hass);
    const configs = new Map<string, AutomationConfig | null>();
    await Promise.all(
      automationIds.map(async (id) => {
        configs.set(id, await loadConfig(hass, id));
      }),
    );
    const disabled = new Set<string>();
    for (const [id, config] of configs) {
      if (isAutomationDisabled(config, hass, entries)) disabled.add(id);
    }
    return disabled;
  } catch {
    return new Set();
  }
}

function triggerBlocked(trigger: AutomationTrigger, hass: ClassifierHass, index: EntityIndex): boolean {
  const platform = platformOf(trigger);
  if (platform === "device") return deviceTriggerBlocked(trigger, hass, index);
  if (platform === "state" || platform === "numeric_state") {
    return entityTriggerBlocked(entityRefs(trigger.entity_id), hass, index);
  }
  return false;
}

function deviceTriggerBlocked(trigger: AutomationTrigger, hass: ClassifierHass, index: EntityIndex): boolean {
  const refs = entityRefs(trigger.entity_id);
  if (refs.length > 0) {
    const resolved = refs.map((ref) => index.byRef.get(ref));
    if (resolved.every((entry): entry is RegistryEntry => Boolean(entry))) {
      return resolved.every((entry) => hass.states?.[entry.entity_id]?.state === "unavailable");
    }
  }
  const deviceId = typeof trigger.device_id === "string" ? trigger.device_id : "";
  if (!deviceId) return false;
  return deviceFullyUnavailable(deviceId, hass, index);
}

function entityTriggerBlocked(refs: string[], hass: ClassifierHass, index: EntityIndex): boolean {
  if (refs.length === 0) return false;
  const resolved: RegistryEntry[] = [];
  for (const ref of refs) {
    const entry = index.byRef.get(ref);
    if (!entry?.device_id) return false;
    resolved.push(entry);
  }
  return resolved.every((entry) => hass.states?.[entry.entity_id]?.state === "unavailable");
}

function deviceFullyUnavailable(deviceId: string, hass: ClassifierHass, index: EntityIndex): boolean {
  const entities = (index.byDevice.get(deviceId) ?? []).filter(countsTowardDevice);
  if (entities.length === 0) return false;
  return entities.every((entry) => hass.states?.[entry.entity_id]?.state === "unavailable");
}

function countsTowardDevice(entry: RegistryEntry): boolean {
  return !entry.hidden && !entry.hidden_by && !entry.disabled_by;
}

function entityIndex(entries: readonly RegistryEntry[]): EntityIndex {
  const byRef = new Map<string, RegistryEntry>();
  const byDevice = new Map<string, RegistryEntry[]>();
  for (const entry of entries) {
    if (!entry.entity_id) continue;
    byRef.set(entry.entity_id, entry);
    if (entry.id) byRef.set(entry.id, entry);
    if (!entry.device_id) continue;
    const list = byDevice.get(entry.device_id);
    if (list) list.push(entry);
    else byDevice.set(entry.device_id, [entry]);
  }
  return { byRef, byDevice };
}

function triggerList(config: AutomationConfig): AutomationTrigger[] {
  const raw = config.triggers ?? config.trigger;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((item): item is AutomationTrigger => Boolean(item) && typeof item === "object");
}

function platformOf(trigger: AutomationTrigger): string {
  if (typeof trigger.platform === "string" && trigger.platform) return trigger.platform;
  if (typeof trigger.trigger === "string" && trigger.trigger) return trigger.trigger;
  return "";
}

function entityRefs(value: unknown): string[] {
  if (typeof value === "string" && value) return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item !== "");
}

async function loadRegistry(hass: ClassifierHass): Promise<RegistryEntry[]> {
  const fallback = entriesFromHass(hass);
  const key = String(fallback.length);
  if (registryCache?.key === key) return registryCache.entries;
  if (registryInflight?.key === key) return registryInflight.promise;
  const promise = fetchRegistry(hass, fallback, key);
  registryInflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (registryInflight?.promise === promise) registryInflight = null;
  }
}

async function fetchRegistry(
  hass: ClassifierHass,
  fallback: RegistryEntry[],
  key: string,
): Promise<RegistryEntry[]> {
  if (typeof hass.callWS !== "function") {
    registryCache = { key, entries: fallback };
    return fallback;
  }
  try {
    const result = await hass.callWS({ type: "config/entity_registry/list" });
    const entries = Array.isArray(result) ? result.flatMap((item) => {
      const entry = asEntry(item);
      return entry ? [entry] : [];
    }) : fallback;
    registryCache = { key, entries };
    return entries;
  } catch {
    registryCache = { key, entries: fallback };
    return fallback;
  }
}

async function loadConfig(hass: ClassifierHass, entityId: string): Promise<AutomationConfig | null> {
  const stamp = hass.states?.[entityId]?.last_updated ?? "";
  const cached = configCache.get(entityId);
  if (cached && cached.stamp === stamp) return cached.config;
  const flightKey = `${entityId}:${stamp}`;
  const pending = inflight.get(flightKey);
  if (pending) return pending;
  const promise = fetchConfig(hass, entityId);
  inflight.set(flightKey, promise);
  try {
    const config = await promise;
    configCache.set(entityId, { stamp, config });
    return config;
  } finally {
    inflight.delete(flightKey);
  }
}

async function fetchConfig(hass: ClassifierHass, entityId: string): Promise<AutomationConfig | null> {
  if (typeof hass.callWS !== "function") return null;
  try {
    return asConfig(await hass.callWS({ type: "automation/config", entity_id: entityId }));
  } catch {
    return null;
  }
}

function asConfig(value: unknown): AutomationConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const config = record.config && typeof record.config === "object"
    ? record.config as AutomationConfig
    : record as AutomationConfig;
  if (!config.triggers && !config.trigger) return null;
  return config;
}

function asEntry(value: unknown): RegistryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as RegistryEntry;
  if (typeof entry.entity_id !== "string" || entry.entity_id === "") return null;
  return entry;
}

function entriesFromHass(hass: ClassifierHass): RegistryEntry[] {
  const entities = hass.entities;
  if (!entities) return [];
  if (Array.isArray(entities)) return entities.filter((entry) => entry.entity_id);
  return Object.entries(entities).map(([key, entry]) => ({
    ...entry,
    entity_id: entry.entity_id || key,
  }));
}
