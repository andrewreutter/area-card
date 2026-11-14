import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { floorExpandedKey } from "../src/floor-state";
import { pinnedKey, serializeAreaPins, type AreaPins } from "../src/pinned-entities";
import type { ClassifierHass } from "../src/sections";
import {
  cachedFloorExpanded,
  cachedPins,
  ensureUserData,
  resetUserDataForTests,
  saveAreaPins,
  saveFloorExpanded,
  subscribeUserData,
} from "../src/user-data";

const emptyPins = (): AreaPins => ({ always: [], whenOn: [], background: [] });

interface StorageMock {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  restore(): void;
}

function installLocalStorage(initial: Record<string, string> = {}): StorageMock {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const items = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return items.size;
    },
    key(index: number) {
      return [...items.keys()][index] ?? null;
    },
    getItem(key: string) {
      return items.has(key) ? items.get(key)! : null;
    },
    setItem(key: string, value: string) {
      items.set(key, String(value));
    },
    removeItem(key: string) {
      items.delete(key);
    },
    clear() {
      items.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: storage,
  });
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    restore() {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

interface Harness {
  hass: ClassifierHass;
  calls: Record<string, unknown>[];
  stops: number;
  subscriptions: number;
  failSet: boolean;
  emit(value: unknown, index?: number): void;
  setCallWS(fn: (message: Record<string, unknown>) => Promise<unknown>): void;
}

function createHarness(userId = "user-1"): Harness {
  const calls: Record<string, unknown>[] = [];
  const subscriptions: Array<(event: { value: unknown }) => void> = [];
  let stops = 0;
  let failSet = false;
  let handler = async (message: Record<string, unknown>): Promise<unknown> => {
    calls.push(message);
    if (failSet && message.type === "frontend/set_user_data") throw new Error("set failed");
    if (message.type === "frontend/get_user_data") return { value: {} };
    return undefined;
  };
  const hass = {
    user: { id: userId },
    connection: {
      subscribeMessage(callback: (event: { value: unknown }) => void, command: { type: string }) {
        assert.deepEqual(command, { type: "frontend/subscribe_user_data" });
        subscriptions.push(callback);
        return Promise.resolve(() => {
          stops += 1;
        });
      },
    },
    callWS(message: Record<string, unknown>) {
      return handler(message);
    },
  };
  return {
    hass: hass as unknown as ClassifierHass,
    calls,
    get stops() {
      return stops;
    },
    get subscriptions() {
      return subscriptions.length;
    },
    get failSet() {
      return failSet;
    },
    set failSet(value: boolean) {
      failSet = value;
    },
    emit(value: unknown, index = subscriptions.length - 1) {
      const callback = subscriptions[index];
      if (!callback) throw new Error("not subscribed");
      callback({ value });
    },
    setCallWS(fn) {
      handler = fn;
    },
  };
}

describe("frontend user data", { concurrency: 1 }, () => {
  let store: StorageMock;

  beforeEach(() => {
    resetUserDataForTests();
    store = installLocalStorage();
  });

  afterEach(() => {
    resetUserDataForTests();
    store.restore();
  });

  it("fills the cache from the first subscription event", async () => {
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    const again = ensureUserData(harness.hass);
    assert.equal(again, pending);
    harness.emit({
      [pinnedKey("kitchen")]: ["light.kitchen", { id: "media_player.tv", mode: "when-on" }],
      [floorExpandedKey("down")]: false,
      "lovelace-dashboard": { sidebar: "hidden" },
    });
    await pending;
    assert.equal(harness.subscriptions, 1);
    assert.equal(ensureUserData(harness.hass), pending);
    assert.deepEqual(cachedPins("kitchen"), {
      always: ["light.kitchen"],
      whenOn: ["media_player.tv"],
      background: [],
    });
    assert.deepEqual(cachedPins("missing"), emptyPins());
    assert.equal(cachedFloorExpanded("down"), false);
    assert.equal(cachedFloorExpanded("up"), true);
    assert.deepEqual(harness.calls, []);
  });

  it("notifies only when an area-card key changes", async () => {
    const harness = createHarness();
    const heard: string[] = [];
    subscribeUserData((key) => heard.push(key));
    const pending = ensureUserData(harness.hass);
    harness.emit({
      [pinnedKey("kitchen")]: ["light.a"],
      [floorExpandedKey("down")]: true,
      other: 1,
    });
    assert.deepEqual(heard, [pinnedKey("kitchen")]);
    await pending;
    harness.emit({
      [pinnedKey("kitchen")]: ["light.a"],
      [floorExpandedKey("down")]: true,
      other: 2,
    });
    assert.deepEqual(heard, [pinnedKey("kitchen")]);
    harness.emit({ [pinnedKey("kitchen")]: ["light.b"] });
    assert.deepEqual(heard, [pinnedKey("kitchen"), pinnedKey("kitchen")]);
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.b"], whenOn: [], background: [] });
    harness.emit({});
    assert.deepEqual(heard, [pinnedKey("kitchen"), pinnedKey("kitchen"), pinnedKey("kitchen")]);
    assert.deepEqual(cachedPins("kitchen"), emptyPins());
    assert.equal(cachedFloorExpanded("down"), true);
  });

  it("uploads a missing localStorage pin as an array and removes the key", async () => {
    store.setItem(
      pinnedKey("kitchen"),
      '["light.desk",{"id":"media_player.tv","mode":"when-on"}]',
    );
    store.setItem(floorExpandedKey("down"), "false");
    store.setItem(floorExpandedKey("attic"), "maybe");
    store.setItem("theme", "dark");
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    harness.emit({ [pinnedKey("office")]: ["switch.office"] });
    await pending;
    assert.deepEqual(harness.calls, [
      {
        type: "frontend/set_user_data",
        key: pinnedKey("kitchen"),
        value: ["light.desk", { id: "media_player.tv", mode: "when-on" }],
      },
      {
        type: "frontend/set_user_data",
        key: floorExpandedKey("down"),
        value: false,
      },
    ]);
    assert.ok(Array.isArray(harness.calls[0].value));
    assert.equal(typeof harness.calls[0].value, "object");
    assert.equal(typeof harness.calls[1].value, "boolean");
    assert.equal(store.getItem(pinnedKey("kitchen")), null);
    assert.equal(store.getItem(floorExpandedKey("down")), null);
    assert.equal(store.getItem(floorExpandedKey("attic")), null);
    assert.equal(store.getItem("theme"), "dark");
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.desk"], whenOn: ["media_player.tv"], background: [] });
    assert.deepEqual(cachedPins("office"), { always: ["switch.office"], whenOn: [], background: [] });
    assert.equal(cachedFloorExpanded("down"), false);
    assert.equal(cachedFloorExpanded("attic"), true);
  });

  it("keeps an existing server value and still removes localStorage", async () => {
    store.setItem(pinnedKey("kitchen"), '["light.local"]');
    store.setItem(pinnedKey("office"), '["light.also"]');
    store.setItem(floorExpandedKey("down"), "true");
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    harness.emit({
      [pinnedKey("kitchen")]: ["light.server"],
      [pinnedKey("office")]: [],
      [floorExpandedKey("down")]: false,
    });
    await pending;
    assert.deepEqual(harness.calls, []);
    assert.equal(store.getItem(pinnedKey("kitchen")), null);
    assert.equal(store.getItem(pinnedKey("office")), null);
    assert.equal(store.getItem(floorExpandedKey("down")), null);
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.server"], whenOn: [], background: [] });
    assert.deepEqual(cachedPins("office"), emptyPins());
    assert.equal(cachedFloorExpanded("down"), false);
  });

  it("leaves localStorage in place when the upload is rejected", async () => {
    store.setItem(pinnedKey("kitchen"), '["light.local"]');
    const harness = createHarness();
    harness.failSet = true;
    const pending = ensureUserData(harness.hass);
    harness.emit({});
    await pending;
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].type, "frontend/set_user_data");
    assert.equal(store.getItem(pinnedKey("kitchen")), '["light.local"]');
    assert.deepEqual(cachedPins("kitchen"), emptyPins());
  });

  it("ignores a localStorage that cannot be read", async () => {
    store.restore();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    harness.emit({ [pinnedKey("kitchen")]: ["light.a"] });
    await pending;
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.a"], whenOn: [], background: [] });
    assert.deepEqual(harness.calls, []);
  });

  it("saves pins with the serialized array and then updates the cache", async () => {
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    harness.emit({});
    await pending;
    const always: AreaPins = { always: ["light.desk", "switch.lamp"], whenOn: [], background: [] };
    await saveAreaPins(harness.hass, "office", always);
    const mixed: AreaPins = { always: ["light.desk"], whenOn: ["media_player.tv"], background: [] };
    await saveAreaPins(harness.hass, "office", mixed);
    assert.deepEqual(harness.calls[0], {
      type: "frontend/set_user_data",
      key: pinnedKey("office"),
      value: ["light.desk", "switch.lamp"],
    });
    assert.deepEqual(harness.calls[1], {
      type: "frontend/set_user_data",
      key: pinnedKey("office"),
      value: ["light.desk", { id: "media_player.tv", mode: "when-on" }],
    });
    for (const [index, pins] of [always, mixed].entries()) {
      assert.deepEqual(harness.calls[index].value, serializeAreaPins(pins));
      assert.equal(typeof harness.calls[index].value, "object");
    }
    assert.deepEqual(cachedPins("office"), mixed);
  });

  it("saves a floor as a boolean", async () => {
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    harness.emit({});
    await pending;
    await saveFloorExpanded(harness.hass, "down", false);
    assert.deepEqual(harness.calls[0], {
      type: "frontend/set_user_data",
      key: floorExpandedKey("down"),
      value: false,
    });
    assert.equal(typeof harness.calls[0].value, "boolean");
    assert.equal(cachedFloorExpanded("down"), false);
  });

  it("keeps the previous cache entry when a save is rejected", async () => {
    const harness = createHarness();
    const pending = ensureUserData(harness.hass);
    harness.emit({ [pinnedKey("kitchen")]: ["light.a"] });
    await pending;
    harness.failSet = true;
    const heard: string[] = [];
    const stop = subscribeUserData((key) => heard.push(key));
    await assert.rejects(
      saveAreaPins(harness.hass, "kitchen", { always: ["light.b"], whenOn: [], background: [] }),
      /set failed/,
    );
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.a"], whenOn: [], background: [] });
    assert.deepEqual(heard, []);
    assert.equal(harness.calls.at(-1)?.value && Array.isArray(harness.calls.at(-1)?.value), true);
    stop();
  });

  it("ignores a subscription echo for a key while its write is in flight", async () => {
    const harness = createHarness();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.setCallWS(async (message) => {
      harness.calls.push(message);
      if (message.type !== "frontend/set_user_data") return undefined;
      harness.emit({
        [pinnedKey("kitchen")]: ["light.echo"],
        [floorExpandedKey("down")]: true,
      });
      await gate;
      return undefined;
    });
    const pending = ensureUserData(harness.hass);
    harness.emit({
      [pinnedKey("kitchen")]: ["light.old"],
      [floorExpandedKey("down")]: false,
    });
    await pending;
    const save = saveAreaPins(harness.hass, "kitchen", { always: ["light.sent"], whenOn: [], background: [] });
    await flush();
    const pinsDuring = cachedPins("kitchen");
    const floorDuring = cachedFloorExpanded("down");
    release();
    await save;
    assert.deepEqual(pinsDuring, { always: ["light.old"], whenOn: [], background: [] });
    assert.equal(floorDuring, true);
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.sent"], whenOn: [], background: [] });
    assert.equal(cachedFloorExpanded("down"), true);
  });

  it("chains writes so an older pin cycle cannot finish last", async () => {
    const harness = createHarness();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: AreaPins[] = [];
    let started = 0;
    harness.setCallWS(async (message) => {
      if (message.type !== "frontend/set_user_data") return undefined;
      started += 1;
      seen.push(cachedPins("kitchen"));
      if (started === 1) await gate;
      return undefined;
    });
    const pending = ensureUserData(harness.hass);
    harness.emit({});
    await pending;
    const pinsA: AreaPins = { always: ["light.a"], whenOn: [], background: [] };
    const pinsB: AreaPins = { always: [], whenOn: ["light.a"], background: [] };
    const first = saveAreaPins(harness.hass, "kitchen", pinsA);
    try {
      await flush();
      assert.equal(started, 1);
      const second = saveAreaPins(harness.hass, "kitchen", pinsB);
      await flush();
      assert.equal(started, 1);
      release();
      await first;
      await second;
      assert.deepEqual(seen[0], emptyPins());
      assert.deepEqual(seen[1], pinsA);
      assert.deepEqual(cachedPins("kitchen"), pinsB);
    } finally {
      release();
    }
  });

  it("resolves without a transport and rejects saves without changing the cache", async () => {
    const bare = {} as ClassifierHass;
    await ensureUserData(bare);
    assert.deepEqual(cachedPins("kitchen"), emptyPins());
    assert.equal(cachedFloorExpanded("down"), true);
    await assert.rejects(saveAreaPins(bare, "kitchen", { always: ["light.a"], whenOn: [], background: [] }), /unavailable/);
    await assert.rejects(saveFloorExpanded(bare, "down", false), /unavailable/);
    assert.deepEqual(cachedPins("kitchen"), emptyPins());
    assert.equal(cachedFloorExpanded("down"), true);
  });

  it("loads once through get_user_data when there is no subscription", async () => {
    const calls: Record<string, unknown>[] = [];
    const hass = {
      user: { id: "user-1" },
      callWS(message: Record<string, unknown>) {
        calls.push(message);
        return Promise.resolve({
          value: {
            [pinnedKey("kitchen")]: ["light.a"],
            [floorExpandedKey("down")]: false,
            other: 1,
          },
        });
      },
    };
    await ensureUserData(hass as unknown as ClassifierHass);
    await ensureUserData(hass as unknown as ClassifierHass);
    assert.deepEqual(calls, [{ type: "frontend/get_user_data" }]);
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.a"], whenOn: [], background: [] });
    assert.equal(cachedFloorExpanded("down"), false);
  });

  it("drops the cache and resubscribes when the user id changes", async () => {
    const calls: Array<(event: { value: unknown }) => void> = [];
    let stops = 0;
    const connection = {
      subscribeMessage(callback: (event: { value: unknown }) => void, command: { type: string }) {
        assert.deepEqual(command, { type: "frontend/subscribe_user_data" });
        calls.push(callback);
        return Promise.resolve(() => {
          stops += 1;
        });
      },
    };
    const callWS = async () => undefined;
    const first = { user: { id: "user-a" }, connection, callWS } as unknown as ClassifierHass;
    const pending = ensureUserData(first);
    calls[0]({ value: { [pinnedKey("kitchen")]: ["light.a"] } });
    await pending;
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.a"], whenOn: [], background: [] });
    const heard: string[] = [];
    subscribeUserData((key) => heard.push(key));
    const second = { user: { id: "user-b" }, connection, callWS } as unknown as ClassifierHass;
    const next = ensureUserData(second);
    assert.equal(stops, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(cachedPins("kitchen"), emptyPins());
    assert.deepEqual(heard, [pinnedKey("kitchen")]);
    calls[0]({ value: { [pinnedKey("kitchen")]: ["light.stale"] } });
    assert.deepEqual(cachedPins("kitchen"), emptyPins());
    calls[1]({ value: { [pinnedKey("kitchen")]: ["light.b"] } });
    await next;
    assert.deepEqual(cachedPins("kitchen"), { always: ["light.b"], whenOn: [], background: [] });
  });
});
