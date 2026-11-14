/**
 * Pins and floor expansion live in Home Assistant frontend user data
 * (`.storage/frontend.user_data_<user id>`). Lovelace cannot open that store
 * itself, so this module subscribes with `frontend/subscribe_user_data`.
 * The first snapshot copies matching localStorage keys once.
 */
import { FLOOR_EXPANDED_KEY_PREFIX, floorExpandedKey } from "./floor-state";
import {
  PINNED_KEY_PREFIX,
  parseAreaPins,
  pinnedKey,
  serializeAreaPins,
  type AreaPins,
} from "./pinned-entities";
import type { ClassifierHass } from "./sections";

interface FrontendHass {
  user?: { id?: string };
  connection?: {
    subscribeMessage(
      callback: (event: { value: unknown }) => void,
      command: { type: "frontend/subscribe_user_data" },
    ): Promise<() => void>;
  };
  callWS?(message: Record<string, unknown>): Promise<unknown>;
}

type CacheEntry =
  | { kind: "pins"; pins: AreaPins }
  | { kind: "floor"; expanded: boolean };

interface WriteChain {
  count: number;
  tail: Promise<void>;
}

interface BrowserStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

const listeners = new Set<(key: string) => void>();

let generation = 0;
let cache = new Map<string, CacheEntry>();
let chains = new Map<string, WriteChain>();
let userId: string | undefined;
let userKnown = false;
let loadPromise: Promise<void> | undefined;
let unsubscribe: (() => void) | undefined;
let releaseLoad: (() => void) | undefined;
let migrated = false;

function hassApi(hass: ClassifierHass): FrontendHass {
  return hass as unknown as FrontendHass;
}

function isPinKey(key: string): boolean {
  return key.startsWith(PINNED_KEY_PREFIX);
}

function isFloorKey(key: string): boolean {
  return key.startsWith(FLOOR_EXPANDED_KEY_PREFIX);
}

function isAreaCardKey(key: string): boolean {
  return isPinKey(key) || isFloorKey(key);
}

function asDict(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function pinsEqual(left: AreaPins, right: AreaPins): boolean {
  return sameIds(left.always, right.always) && sameIds(left.whenOn, right.whenOn);
}

function clonePins(pins: AreaPins): AreaPins {
  return { always: [...pins.always], whenOn: [...pins.whenOn] };
}

function emptyObservablePins(): AreaPins {
  return { always: [], whenOn: [] };
}

/** Missing floors stay expanded, which is the card default. */
function floorBoolean(value: unknown): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return true;
}

function departsFromDefault(entry: CacheEntry): boolean {
  if (entry.kind === "floor") return entry.expanded === false;
  return entry.pins.always.length > 0 || entry.pins.whenOn.length > 0;
}

function notify(key: string): void {
  for (const listener of [...listeners]) listener(key);
}

function commitPins(key: string, pins: AreaPins): void {
  const next = clonePins(pins);
  const prev = cache.get(key);
  if (prev?.kind === "pins" && pinsEqual(prev.pins, next)) return;
  const previous = prev?.kind === "pins" ? prev.pins : emptyObservablePins();
  cache.set(key, { kind: "pins", pins: next });
  if (!pinsEqual(previous, next)) notify(key);
}

function commitFloor(key: string, expanded: boolean): void {
  const prev = cache.get(key);
  if (prev?.kind === "floor" && prev.expanded === expanded) return;
  const previous = prev?.kind === "floor" ? prev.expanded : true;
  cache.set(key, { kind: "floor", expanded });
  if (previous !== expanded) notify(key);
}

function commitSent(key: string, value: unknown): void {
  if (isPinKey(key)) commitPins(key, parseAreaPins(value));
  else if (isFloorKey(key)) commitFloor(key, floorBoolean(value));
}

function forget(key: string): void {
  const prev = cache.get(key);
  if (!prev) return;
  cache.delete(key);
  if (departsFromDefault(prev)) notify(key);
}

function isWriting(key: string): boolean {
  return (chains.get(key)?.count ?? 0) > 0;
}

/**
 * Each event is the whole user-data document. Area-card keys missing from it
 * are gone, except a key whose write is still in flight: its echo must not
 * put the previous pin cycle back.
 */
function applyDocument(doc: Record<string, unknown>, gen: number): void {
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(doc)) {
    if (gen !== generation) return;
    if (!isAreaCardKey(key)) continue;
    seen.add(key);
    if (isWriting(key)) continue;
    if (isPinKey(key)) commitPins(key, parseAreaPins(raw));
    else commitFloor(key, floorBoolean(raw));
  }
  if (gen !== generation) return;
  for (const key of [...cache.keys()]) {
    if (seen.has(key) || isWriting(key)) continue;
    forget(key);
  }
}

function browserStorage(): BrowserStorage | undefined {
  try {
    const storage = globalThis.localStorage as BrowserStorage | undefined;
    if (!storage || typeof storage.getItem !== "function" || typeof storage.removeItem !== "function") {
      return undefined;
    }
    return storage;
  } catch {
    return undefined;
  }
}

function removeStored(storage: BrowserStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // A blocked localStorage should not fail the snapshot.
  }
}

function listAreaCardKeys(storage: BrowserStorage): string[] {
  const keys: string[] = [];
  const length = storage.length;
  if (typeof length !== "number" || !Number.isFinite(length) || length < 0) return keys;
  if (typeof storage.key !== "function") return keys;
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string" && isAreaCardKey(key)) keys.push(key);
  }
  return keys;
}

async function migrateKey(
  storage: BrowserStorage,
  key: string,
  serverDoc: Record<string, unknown>,
  api: FrontendHass,
  gen: number,
): Promise<void> {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(serverDoc, key)) {
    removeStored(storage, key);
    return;
  }
  try {
    if (isPinKey(key)) {
      await setValue(api, key, serializeAreaPins(parseAreaPins(raw)));
    } else if (raw === "true" || raw === "false") {
      await setValue(api, key, raw === "true");
    } else {
      removeStored(storage, key);
      return;
    }
  } catch {
    // The next visit can retry. Leave the localStorage item in place.
    return;
  }
  if (gen !== generation) return;
  removeStored(storage, key);
}

async function migrateFromLocalStorage(
  serverDoc: Record<string, unknown>,
  api: FrontendHass,
  gen: number,
): Promise<void> {
  const storage = browserStorage();
  if (!storage) return;
  let keys: string[];
  try {
    keys = listAreaCardKeys(storage);
  } catch {
    return;
  }
  for (const key of keys) {
    if (gen !== generation) return;
    await migrateKey(storage, key, serverDoc, api, gen);
  }
}

async function applySnapshot(value: unknown, api: FrontendHass, gen: number): Promise<void> {
  if (gen !== generation) return;
  const doc = asDict(value);
  if (!doc) return;
  const migrate = !migrated;
  if (migrate) migrated = true;
  applyDocument(doc, gen);
  if (!migrate || gen !== generation) return;
  await migrateFromLocalStorage(doc, api, gen);
}

function eventValue(event: { value?: unknown } | null | undefined): unknown {
  if (!event || typeof event !== "object" || !("value" in event)) return undefined;
  return event.value;
}

function finishLoad(
  settled: { current: boolean },
  cancel: () => void,
  resolve: () => void,
  reject: (error: unknown) => void,
  error?: unknown,
): void {
  if (settled.current) return;
  settled.current = true;
  if (releaseLoad === cancel) releaseLoad = undefined;
  if (error === undefined) resolve();
  else reject(error);
}

function subscribeAndWait(api: FrontendHass, gen: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const settled = { current: false };
    const cancel = () => finishLoad(settled, cancel, resolve, reject);
    releaseLoad = cancel;
    const connection = api.connection;
    const subscribe = connection?.subscribeMessage;
    if (!connection || typeof subscribe !== "function") {
      finishLoad(settled, cancel, resolve, reject, new Error("Home Assistant user data is unavailable"));
      return;
    }
    let opened = false;
    const onEvent = (event: { value: unknown }) => {
      if (gen !== generation) {
        cancel();
        return;
      }
      const job = applySnapshot(eventValue(event), api, gen);
      if (opened) {
        void job.catch(() => undefined);
        return;
      }
      opened = true;
      job.then(
        () => cancel(),
        (error: unknown) => {
          if (gen !== generation) cancel();
          else finishLoad(settled, cancel, resolve, reject, error);
        },
      );
    };
    try {
      Promise.resolve(connection.subscribeMessage(onEvent, { type: "frontend/subscribe_user_data" })).then(
        (stop) => {
          if (gen !== generation) {
            try {
              stop();
            } catch {
              // The socket may already be closed.
            }
            cancel();
            return;
          }
          unsubscribe = stop;
        },
        (error: unknown) => {
          if (gen !== generation) cancel();
          else finishLoad(settled, cancel, resolve, reject, error);
        },
      );
    } catch (error) {
      finishLoad(settled, cancel, resolve, reject, error);
    }
  });
}

function valueOfGet(result: unknown): unknown {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(result, "value")) return undefined;
  return (result as { value: unknown }).value;
}

function fetchOnce(api: FrontendHass, gen: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const settled = { current: false };
    const cancel = () => finishLoad(settled, cancel, resolve, reject);
    releaseLoad = cancel;
    if (typeof api.callWS !== "function") {
      finishLoad(settled, cancel, resolve, reject, new Error("Home Assistant user data is unavailable"));
      return;
    }
    Promise.resolve(api.callWS({ type: "frontend/get_user_data" })).then(
      (result) => {
        if (gen !== generation) {
          cancel();
          return;
        }
        applySnapshot(valueOfGet(result), api, gen).then(
          () => cancel(),
          (error: unknown) => {
            if (gen !== generation) cancel();
            else finishLoad(settled, cancel, resolve, reject, error);
          },
        );
      },
      (error: unknown) => {
        if (gen !== generation) cancel();
        else finishLoad(settled, cancel, resolve, reject, error);
      },
    );
  });
}

function dropCacheAndSubscription(): void {
  generation += 1;
  const cancel = releaseLoad;
  releaseLoad = undefined;
  cancel?.();
  const stop = unsubscribe;
  unsubscribe = undefined;
  if (stop) {
    try {
      stop();
    } catch {
      // The socket may already be closed.
    }
  }
  const stale = [...cache.entries()];
  cache = new Map();
  chains = new Map();
  loadPromise = undefined;
  migrated = false;
  for (const [key, entry] of stale) {
    if (departsFromDefault(entry)) notify(key);
  }
}

function finishChain(key: string, current: WriteChain): void {
  current.count -= 1;
  if (current.count <= 0 && chains.get(key) === current) chains.delete(key);
}

/** Older writes for this key finish before newer ones start, so a late response cannot restore a previous pin cycle. */
function enqueue(key: string, work: () => Promise<void>): Promise<void> {
  let chain = chains.get(key);
  if (!chain) {
    chain = { count: 0, tail: Promise.resolve() };
    chains.set(key, chain);
  }
  chain.count += 1;
  const current = chain;
  const run = current.tail.then(work, work);
  current.tail = run.then(
    () => finishChain(key, current),
    () => finishChain(key, current),
  );
  return run;
}

function setValue(api: FrontendHass, key: string, value: unknown): Promise<void> {
  if (typeof api.callWS !== "function") {
    return Promise.reject(new Error("Home Assistant user data is unavailable"));
  }
  if (userKnown && api.user?.id !== userId) {
    return Promise.reject(new Error("Home Assistant user changed"));
  }
  const gen = generation;
  return enqueue(key, async () => {
    if (gen !== generation) throw new Error("Home Assistant user changed");
    await api.callWS!({ type: "frontend/set_user_data", key, value });
    if (gen !== generation) throw new Error("Home Assistant user changed");
    commitSent(key, value);
  });
}

export function ensureUserData(hass: ClassifierHass): Promise<void> {
  const api = hassApi(hass);
  const nextUser = api.user?.id;
  if (userKnown && nextUser !== userId) {
    userId = nextUser;
    dropCacheAndSubscription();
  }
  userId = nextUser;
  userKnown = true;
  if (loadPromise) return loadPromise;
  const subscribed = typeof api.connection?.subscribeMessage === "function";
  if (!subscribed && typeof api.callWS !== "function") return Promise.resolve();
  const gen = generation;
  const pending = (subscribed ? subscribeAndWait(api, gen) : fetchOnce(api, gen)).then(
    () => undefined,
    (error: unknown) => {
      if (generation === gen && loadPromise === pending) loadPromise = undefined;
      throw error;
    },
  );
  loadPromise = pending;
  return pending;
}

export function cachedPins(areaId: string): AreaPins {
  const entry = cache.get(pinnedKey(areaId));
  if (!entry || entry.kind !== "pins") return emptyObservablePins();
  return clonePins(entry.pins);
}

export function cachedFloorExpanded(floorId: string): boolean {
  const entry = cache.get(floorExpandedKey(floorId));
  if (!entry || entry.kind !== "floor") return true;
  return entry.expanded;
}

export function saveAreaPins(hass: ClassifierHass, areaId: string, pins: AreaPins): Promise<void> {
  return setValue(hassApi(hass), pinnedKey(areaId), serializeAreaPins(pins));
}

export function saveFloorExpanded(hass: ClassifierHass, floorId: string, expanded: boolean): Promise<void> {
  return setValue(hassApi(hass), floorExpandedKey(floorId), expanded);
}

export function subscribeUserData(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetUserDataForTests(): void {
  listeners.clear();
  dropCacheAndSubscription();
  userId = undefined;
  userKnown = false;
}
