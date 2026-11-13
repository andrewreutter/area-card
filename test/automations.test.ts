import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  clearAutomationCache,
  isAutomationDisabled,
  loadDisabledAutomations,
  type AutomationConfig,
} from "../src/automations";
import type { ClassifierHass, RegistryEntry } from "../src/sections";

const motion = "binary_sensor.motion";
const temp = "sensor.temp";
const helper = "input_boolean.guest";

function entry(entityId: string, deviceId?: string, id?: string): RegistryEntry {
  return { entity_id: entityId, device_id: deviceId, id };
}

function hass(
  states: Record<string, string>,
  entries: RegistryEntry[] = [],
): ClassifierHass {
  return {
    entities: entries,
    states: Object.fromEntries(
      Object.entries(states).map(([entityId, value]) => [entityId, { state: value, attributes: {} }]),
    ),
  };
}

const devices = [
  entry(motion, "dev", "motion-reg"),
  entry(temp, "dev", "temp-reg"),
  entry(helper),
];

function disabled(config: AutomationConfig, states: Record<string, string>, entries = devices): boolean {
  return isAutomationDisabled(config, hass(states, entries), entries);
}

describe("isAutomationDisabled", () => {
  it("disables a device trigger whose entity is unavailable even if a sibling entity is up", () => {
    const config: AutomationConfig = {
      triggers: [{ platform: "device", device_id: "dev", entity_id: "motion-reg" }],
    };
    assert.equal(disabled(config, { [motion]: "unavailable", [temp]: "21" }), true);
    assert.equal(disabled(config, { [motion]: "off", [temp]: "unavailable" }), false);
  });

  it("disables a device trigger with no entity when every device entity is unavailable", () => {
    const config: AutomationConfig = {
      triggers: [{ platform: "device", device_id: "dev" }],
    };
    assert.equal(disabled(config, { [motion]: "unavailable", [temp]: "unavailable" }), true);
    assert.equal(disabled(config, { [motion]: "unavailable", [temp]: "21" }), false);
    assert.equal(disabled(config, {}, [entry(helper)]), false);
  });

  it("disables a state or numeric trigger only when every entity is an unavailable device", () => {
    const stateTrigger: AutomationConfig = {
      triggers: [{ trigger: "state", entity_id: motion }],
    };
    assert.equal(disabled(stateTrigger, { [motion]: "unavailable" }), true);
    assert.equal(disabled(stateTrigger, { [motion]: "on" }), false);
    const helperTrigger: AutomationConfig = {
      triggers: [{ platform: "state", entity_id: helper }],
    };
    assert.equal(disabled(helperTrigger, { [helper]: "unavailable" }), false);
    const numeric: AutomationConfig = {
      triggers: [{ platform: "numeric_state", entity_id: temp }],
    };
    assert.equal(disabled(numeric, { [temp]: "unavailable" }), true);
    const either: AutomationConfig = {
      triggers: [{ platform: "state", entity_id: [motion, temp] }],
    };
    assert.equal(disabled(either, { [motion]: "unavailable", [temp]: "unavailable" }), true);
    assert.equal(disabled(either, { [motion]: "unavailable", [temp]: "21" }), false);
  });

  it("stays enabled when any trigger can still fire", () => {
    const config: AutomationConfig = {
      triggers: [
        { platform: "device", device_id: "dev", entity_id: motion },
        { trigger: "time" },
      ],
    };
    assert.equal(disabled(config, { [motion]: "unavailable" }), false);
    assert.equal(
      disabled({ triggers: [{ trigger: "sun" }, { trigger: "homeassistant" }] }, {}),
      false,
    );
    assert.equal(disabled({ triggers: [] }, { [motion]: "unavailable" }), false);
    assert.equal(isAutomationDisabled(null, hass({})), false);
  });

  it("resolves a device trigger entity id that is the real entity id", () => {
    const config: AutomationConfig = {
      triggers: [{ platform: "device", device_id: "dev", entity_id: motion }],
    };
    assert.equal(disabled(config, { [motion]: "unavailable", [temp]: "21" }), true);
  });
});

describe("loadDisabledAutomations", () => {
  beforeEach(() => clearAutomationCache());

  it("uses the registry id, then recomputes from states without refetching", async () => {
    let calls = 0;
    const fixture: ClassifierHass = {
      states: {
        "automation.motion": { state: "on", attributes: {}, last_updated: "1" },
        [motion]: { state: "unavailable", attributes: {} },
        [temp]: { state: "21", attributes: {} },
      },
      entities: {
        [motion]: entry(motion, "dev", "motion-reg"),
        [temp]: entry(temp, "dev", "temp-reg"),
      },
      callWS: async (message) => {
        calls += 1;
        if (message.type === "config/entity_registry/list") {
          return [entry(motion, "dev", "motion-reg"), entry(temp, "dev", "temp-reg")];
        }
        return {
          config: {
            triggers: [{ platform: "device", device_id: "dev", entity_id: "motion-reg" }],
          },
        };
      },
    };
    const first = await loadDisabledAutomations(fixture, ["automation.motion"]);
    assert.equal(first.has("automation.motion"), true);
    const afterFetch = calls;
    assert.ok(afterFetch >= 2);

    fixture.states![motion] = { state: "on", attributes: {} };
    const second = await loadDisabledAutomations(fixture, ["automation.motion"]);
    assert.equal(second.has("automation.motion"), false);
    assert.equal(calls, afterFetch);
  });

  it("returns an empty set when the config cannot be loaded", async () => {
    const fixture: ClassifierHass = {
      states: { "automation.motion": { state: "on", attributes: {}, last_updated: "1" } },
      callWS: async () => {
        throw new Error("offline");
      },
    };
    const result = await loadDisabledAutomations(fixture, ["automation.motion"]);
    assert.equal(result.size, 0);
  });
});
