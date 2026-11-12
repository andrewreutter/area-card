import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildButtonConfig } from "../src/button-config";
import { buildPopupCards } from "../src/popup-cards";
import {
  classifyArea,
  emptySections,
  type ClassifierHass,
  type DeviceEntry,
  type EntityState,
  type RegistryEntry,
} from "../src/sections";

interface Fixture {
  entities?: RegistryEntry[];
  devices?: DeviceEntry[];
  states?: Record<string, EntityState>;
}

function state(entityId: string, value: string, attributes: Record<string, unknown> = {}): EntityState {
  return { entity_id: entityId, state: value, attributes };
}

function hass(fixture: Fixture): ClassifierHass {
  const entities: Record<string, RegistryEntry> = {};
  const states: Record<string, EntityState> = {};
  for (const entry of fixture.entities ?? []) {
    entities[entry.entity_id] = entry;
    states[entry.entity_id] = fixture.states?.[entry.entity_id] ?? state(entry.entity_id, "off");
  }
  for (const [id, value] of Object.entries(fixture.states ?? {})) {
    states[id] = value;
  }
  const devices: Record<string, DeviceEntry> = {};
  for (const device of fixture.devices ?? []) devices[device.id] = device;
  return { entities, devices, states };
}

describe("classifyArea", () => {
  it("drops hidden entities and keeps a visible light", () => {
    const result = classifyArea(
      hass({
        entities: [
          { entity_id: "light.hidden_lamp", area_id: "bedroom", hidden_by: "user" },
          { entity_id: "light.reading_lamp", area_id: "bedroom" },
        ],
      }),
      "bedroom",
    );
    assert.deepEqual(result.lights, ["light.reading_lamp"]);
  });

  it("drops diagnostic and config lights", () => {
    const result = classifyArea(
      hass({
        entities: [
          { entity_id: "light.diag", area_id: "bedroom", entity_category: "diagnostic" },
          { entity_id: "light.config", area_id: "bedroom", entity_category: "config" },
          { entity_id: "light.reading_lamp", area_id: "bedroom" },
        ],
      }),
      "bedroom",
    );
    assert.deepEqual(result.lights, ["light.reading_lamp"]);
  });

  it("drops satellite LEDs by led_control and by kiosk satellite manufacturer", () => {
    const result = classifyArea(
      hass({
        devices: [
          { id: "updoot", area_id: "bedroom", manufacturer: "ESPhome" },
          { id: "kiosk", area_id: "bedroom", manufacturer: "Kiosk Satellite" },
        ],
        entities: [
          { entity_id: "light.updoot_led_control_idle", device_id: "updoot" },
          { entity_id: "light.updoot2_led_control_idle", device_id: "kiosk" },
          { entity_id: "light.kiosk_spot", device_id: "kiosk" },
          { entity_id: "light.reading_lamp", area_id: "bedroom" },
          { entity_id: "assist_satellite.updoot", device_id: "updoot" },
          { entity_id: "switch.kiosk_relay", device_id: "kiosk" },
        ],
      }),
      "bedroom",
    );
    assert.deepEqual(result.lights, ["light.reading_lamp"]);
    assert.deepEqual(result.switches, []);
    assert.deepEqual(result.satellites, [
      { entityId: "assist_satellite.updoot", ledEntityId: "light.updoot_led_control_idle" },
    ]);
  });

  it("rolls a same-device pressure sensor into occupancy and keeps it off status", () => {
    const result = classifyArea(
      hass({
        devices: [{ id: "chair", area_id: "office_of_drew" }],
        entities: [
          { entity_id: "binary_sensor.office_chair", device_id: "chair" },
          { entity_id: "sensor.office_chair_pressure", device_id: "chair", entity_category: "diagnostic" },
          { entity_id: "sensor.office_temperature", area_id: "office_of_drew" },
          { entity_id: "sensor.office_humidity", area_id: "office_of_drew" },
        ],
        states: {
          "binary_sensor.office_chair": state("binary_sensor.office_chair", "on", {
            device_class: "occupancy",
            friendly_name: "Office Chair",
          }),
          "sensor.office_chair_pressure": state("sensor.office_chair_pressure", "42", {
            device_class: "pressure",
            unit_of_measurement: "hPa",
          }),
          "sensor.office_temperature": state("sensor.office_temperature", "21", { device_class: "temperature" }),
          "sensor.office_humidity": state("sensor.office_humidity", "40", { device_class: "humidity" }),
        },
      }),
      "office_of_drew",
    );
    assert.deepEqual(result.occupancy, [
      { entityId: "binary_sensor.office_chair", pressureEntityId: "sensor.office_chair_pressure" },
    ]);
    assert.deepEqual(result.status, ["sensor.office_humidity", "sensor.office_temperature"]);
  });

  it("uses the device area when the entity area is unset, and the entity area when both are set", () => {
    const result = classifyArea(
      hass({
        devices: [
          { id: "desk", area_id: "office_of_drew" },
          { id: "lamp", area_id: "bedroom" },
        ],
        entities: [
          { entity_id: "light.desk_lamp", device_id: "desk", area_id: null },
          { entity_id: "light.reading_lamp", device_id: "lamp", area_id: "bedroom" },
          { entity_id: "light.moved", device_id: "lamp", area_id: "office_of_drew" },
        ],
      }),
      "office_of_drew",
    );
    assert.deepEqual(result.lights, ["light.desk_lamp", "light.moved"]);

    const bedroom = classifyArea(
      hass({
        devices: [{ id: "lamp", area_id: "bedroom" }],
        entities: [
          { entity_id: "light.reading_lamp", device_id: "lamp", area_id: "bedroom" },
          { entity_id: "light.moved", device_id: "lamp", area_id: "office_of_drew" },
        ],
      }),
      "bedroom",
    );
    assert.deepEqual(bedroom.lights, ["light.reading_lamp"]);
  });

  it("reads device class from state attributes and keeps other binary sensors as status", () => {
    const result = classifyArea(
      hass({
        entities: [
          { entity_id: "binary_sensor.motion", area_id: "bedroom" },
          { entity_id: "binary_sensor.door", area_id: "bedroom" },
          { entity_id: "binary_sensor.helpmeet_something", area_id: "bedroom" },
          { entity_id: "cover.shade", area_id: "bedroom" },
          { entity_id: "binary_sensor.diag_contact", area_id: "bedroom", entity_category: "diagnostic" },
        ],
        states: {
          "binary_sensor.motion": state("binary_sensor.motion", "off", { device_class: "motion" }),
          "binary_sensor.door": state("binary_sensor.door", "off", { device_class: "door" }),
          "binary_sensor.helpmeet_something": state("binary_sensor.helpmeet_something", "off", {
            device_class: "connectivity",
          }),
          "cover.shade": state("cover.shade", "closed"),
          "binary_sensor.diag_contact": state("binary_sensor.diag_contact", "off", { device_class: "connectivity" }),
        },
      }),
      "bedroom",
    );
    assert.deepEqual(result.occupancy.map((item) => item.entityId), ["binary_sensor.motion"]);
    assert.deepEqual(result.openings, ["binary_sensor.door", "cover.shade"]);
    assert.deepEqual(result.status, ["binary_sensor.helpmeet_something"]);
  });

  it("sends LED switches and template entities to helpers, and leaves circadian lights as lights", () => {
    const result = classifyArea(
      hass({
        entities: [
          { entity_id: "switch.desk_led", area_id: "office_of_drew" },
          { entity_id: "switch.desk_plug", area_id: "office_of_drew" },
          { entity_id: "light.circadian_lamps", area_id: "office_of_drew", platform: "group" },
          { entity_id: "light.template_lamp", area_id: "office_of_drew", platform: "template" },
          { entity_id: "input_boolean.guest", area_id: "office_of_drew" },
          { entity_id: "input_select.scene", area_id: "office_of_drew" },
          { entity_id: "timer.nap", area_id: "office_of_drew" },
        ],
        states: {
          "switch.desk_plug": state("switch.desk_plug", "off", { device_class: "outlet" }),
        },
      }),
      "office_of_drew",
    );
    assert.deepEqual(result.lights, ["light.circadian_lamps"]);
    assert.deepEqual(result.switches, ["switch.desk_plug"]);
    assert.deepEqual(result.helpers, ["input_boolean.guest", "light.template_lamp", "switch.desk_led", "timer.nap"]);
    assert.deepEqual(result.selects, ["input_select.scene"]);
  });

  it("includes only automations assigned to the area", () => {
    const result = classifyArea(
      hass({
        entities: [
          { entity_id: "automation.bedtime", area_id: "bedroom" },
          { entity_id: "automation.master_bedroom_name_only", area_id: "kitchen" },
          { entity_id: "media_player.tv", area_id: "bedroom" },
        ],
        states: {
          "automation.master_bedroom_name_only": state("automation.master_bedroom_name_only", "on", {
            friendly_name: "Master Bedroom lights",
          }),
        },
      }),
      "bedroom",
    );
    assert.deepEqual(result.automations, ["automation.bedtime"]);
    assert.deepEqual(result.mediaPlayers, ["media_player.tv"]);
  });

  it("rolls up a same-device pressure sensor that has no device class", () => {
    const result = classifyArea(
      hass({
        devices: [{ id: "bed", area_id: "bedroom" }],
        entities: [
          { entity_id: "binary_sensor.bedroom_bed_pressure_sensor", device_id: "bed" },
          { entity_id: "sensor.bedroom_bed_pressure_sensor_pressure", device_id: "bed" },
          { entity_id: "select.bedroom_bed_pressure_sensor_sensitivity", device_id: "bed", entity_category: "config" },
        ],
        states: {
          "binary_sensor.bedroom_bed_pressure_sensor": state("binary_sensor.bedroom_bed_pressure_sensor", "on", {
            device_class: "occupancy",
          }),
          "sensor.bedroom_bed_pressure_sensor_pressure": state("sensor.bedroom_bed_pressure_sensor_pressure", "338", {
            friendly_name: "Bed Pressure Sensor Pressure",
          }),
          "select.bedroom_bed_pressure_sensor_sensitivity": state("select.bedroom_bed_pressure_sensor_sensitivity", "middle"),
        },
      }),
      "bedroom",
    );
    assert.deepEqual(result.occupancy, [
      {
        entityId: "binary_sensor.bedroom_bed_pressure_sensor",
        pressureEntityId: "sensor.bedroom_bed_pressure_sensor_pressure",
      },
    ]);
    assert.deepEqual(result.status, []);
    assert.deepEqual(result.selects, []);
    assert.deepEqual(result.helpers, []);
  });

  it("treats a chair or bed binary sensor as occupancy", () => {
    const result = classifyArea(
      hass({
        entities: [
          { entity_id: "binary_sensor.under_bed", area_id: "bedroom" },
          { entity_id: "binary_sensor.bedroom_window", area_id: "bedroom" },
        ],
        states: {
          "binary_sensor.under_bed": state("binary_sensor.under_bed", "on", { friendly_name: "Under bed" }),
          "binary_sensor.bedroom_window": state("binary_sensor.bedroom_window", "off", {
            device_class: "window",
            friendly_name: "Bedroom window",
          }),
        },
      }),
      "bedroom",
    );
    assert.deepEqual(result.occupancy.map((item) => item.entityId), ["binary_sensor.under_bed"]);
    assert.deepEqual(result.openings, ["binary_sensor.bedroom_window"]);
  });
});

describe("popup and button configs", () => {
  it("omits empty section headings", () => {
    const cards = buildPopupCards(emptySections());
    assert.deepEqual(cards, []);
  });

  it("renders only the sections that have entities, with prefixed mushroom types", () => {
    const cards = buildPopupCards({
      ...emptySections(),
      lights: ["light.reading_lamp", "light.under_bed"],
      occupancy: [{ entityId: "binary_sensor.bed", pressureEntityId: "sensor.bed_pressure" }],
    });
    const titles = cards.filter((card) => card.title).map((card) => card.title);
    assert.deepEqual(titles, ["Lights", "Occupancy"]);
    assert.equal(cards.some((card) => JSON.stringify(card).includes("sensor.bed_pressure") && card.type?.toString().includes("entity-card")), false);
    const types = cards.map((card) => String(card.type));
    assert.ok(types.every((type) => type.startsWith("custom:area-card-mushroom-")));
    assert.ok(types.includes("custom:area-card-mushroom-light-card"));
    assert.ok(types.includes("custom:area-card-mushroom-template-card"));
    assert.equal(types.some((type) => type.startsWith("custom:mushroom-")), false);
    assert.equal(JSON.stringify(cards).includes("custom:bubble-card"), false);
  });

  it("hides the lights sub-button when no lights remain and toggles the whole set", () => {
    const withLights = buildButtonConfig({
      areaId: "bedroom",
      name: "Master Bedroom",
      icon: "mdi:bed",
      sections: { ...emptySections(), lights: ["light.reading_lamp", "light.under_bed"] },
      lightRepresentative: "light.reading_lamp",
      occupancyRepresentative: "binary_sensor.bed",
    });
    const sub = withLights.sub_button as Array<Record<string, unknown>>;
    assert.equal(sub.length, 2);
    assert.equal(sub[0]?.icon, "mdi:account");
    const lightTap = sub[1]?.tap_action as { target: { entity_id: string[] } };
    assert.deepEqual(lightTap.target.entity_id, ["light.reading_lamp", "light.under_bed"]);
    assert.equal(sub[1]?.entity, "light.reading_lamp");
    assert.equal((withLights.button_action as { tap_action: { navigation_path: string } }).tap_action.navigation_path, "#area-bedroom");

    const noLights = buildButtonConfig({
      areaId: "office_of_drew",
      name: "Man Cave",
      icon: "mdi:office-building",
      sections: emptySections(),
    });
    const onlyOccupancy = noLights.sub_button as Array<Record<string, unknown>>;
    assert.equal(onlyOccupancy.length, 1);
    assert.equal(onlyOccupancy[0]?.icon, "mdi:account");
    assert.equal(JSON.stringify(noLights).includes("bubble-card"), false);
  });
});
