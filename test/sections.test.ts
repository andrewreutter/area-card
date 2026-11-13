import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildButtonConfig } from "../src/button-config";
import { areasOnFloor, floorDisplay } from "../src/floors";
import { stripRoomName } from "../src/names";
import { tooltipPosition } from "../src/dot-tooltip";
import { buildPopupCards, buildPopupConfig } from "../src/popup-cards";
import { dotTooltipLabel, rollupLabel, sectionRollups, sectionTitle } from "../src/rollups";
import {
  classifyArea,
  emptySections,
  type AreaEntry,
  type AreaSections,
  type ClassifierHass,
  type DeviceEntry,
  type EntityState,
  type FloorEntry,
  type RegistryEntry,
} from "../src/sections";

interface Fixture {
  entities?: RegistryEntry[];
  devices?: DeviceEntry[];
  states?: Record<string, EntityState>;
  areas?: Record<string, AreaEntry>;
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
  return { entities, devices, states, areas: fixture.areas };
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
    assert.deepEqual(result.climate, ["sensor.office_humidity", "sensor.office_temperature"]);
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

  it("reads device class from state attributes and drops other binary sensors from the sections", () => {
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
    assert.equal(listedIds(result).includes("binary_sensor.helpmeet_something"), false);
    assert.deepEqual(result.climate, []);
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
    assert.deepEqual(result.helpers, ["input_boolean.guest", "light.template_lamp", "timer.nap"]);
    assert.equal(listedIds(result).includes("switch.desk_led"), false);
    assert.deepEqual(result.selects, ["input_select.scene"]);
  });

  it("includes an automation assigned to the area or its device", () => {
    const result = classifyArea(
      hass({
        areas: roomAreas,
        devices: [{ id: "bed-device", area_id: "bedroom" }],
        entities: [
          { entity_id: "automation.bedtime", area_id: "bedroom" },
          { entity_id: "automation.on_device", device_id: "bed-device" },
          { entity_id: "automation.kitchen_only", area_id: "kitchen" },
          { entity_id: "media_player.tv", area_id: "bedroom" },
        ],
        states: {
          "automation.bedtime": state("automation.bedtime", "on", { friendly_name: "Bedtime" }),
          "automation.on_device": state("automation.on_device", "off", { friendly_name: "Lamp routine" }),
          "automation.kitchen_only": state("automation.kitchen_only", "on", { friendly_name: "Kitchen lights" }),
        },
      }),
      "bedroom",
    );
    assert.deepEqual(result.automations, ["automation.bedtime", "automation.on_device"]);
    assert.deepEqual(result.mediaPlayers, ["media_player.tv"]);
  });

  it("includes an automation whose name contains the room name", () => {
    const lights = "automation.man_cave_lights";
    const tv = "automation.turn_on_man_cave_tv";
    const assigned = "automation.also_assigned";
    const result = classifyArea(
      hass({
        areas: roomAreas,
        entities: [
          { entity_id: lights, area_id: "kitchen" },
          { entity_id: tv },
          { entity_id: assigned, area_id: "office_of_drew" },
          { entity_id: "automation.hidden_match", area_id: "kitchen", hidden_by: "user" },
        ],
        states: {
          [lights]: state(lights, "on", { friendly_name: "Man Cave Lights" }),
          [tv]: state(tv, "off", { friendly_name: "Turn on man cave TV" }),
          [assigned]: state(assigned, "on", { friendly_name: "Man Cave Lights" }),
          "automation.hidden_match": state("automation.hidden_match", "on", { friendly_name: "Man Cave hidden" }),
        },
      }),
      "office_of_drew",
    );
    assert.deepEqual(result.automations, [assigned, lights, tv]);

    const states = {
      [lights]: state(lights, "on", { friendly_name: "Man Cave · Occupied · Turn on Lights" }),
      [tv]: state(tv, "off", { friendly_name: "Turn on man cave TV" }),
      [assigned]: state(assigned, "on", { friendly_name: "Man Cave Lights" }),
    };
    const rollup = sectionRollups(result, states).find((item) => item.id === "automations");
    assert.equal(rollup && `${rollup.active}/${rollup.total} ${rollup.word}`, "2/3 On");
    const cards = buildPopupCards(
      { ...emptySections(), automations: [lights] },
      { [lights]: states[lights] },
      "Man Cave",
    );
    const row = cards.find((card) => card.entity === lights);
    assert.equal(row?.primary, "Occupied · Turn on Lights");
    assert.equal((row?.hold_action as { perform_action?: string }).perform_action, "automation.toggle");
    assert.deepEqual(
      cards.filter((card) => card.title).map((card) => card.title),
      ["Status", "Automations"],
    );
  });

  it("excludes an automation for a different room", () => {
    const fixture = hass({
      areas: roomAreas,
      entities: [
        { entity_id: "automation.guest", area_id: "guest_bedroom" },
        { entity_id: "automation.cave_word" },
        { entity_id: "automation.man_word" },
        { entity_id: "automation.master" },
        { entity_id: "automation.closet", area_id: "bedroom_closet" },
        { entity_id: "automation.bedroom_motion", area_id: "cabin_bedroom" },
      ],
      states: {
        "automation.guest": state("automation.guest", "on", { friendly_name: "Guest Bedroom Lights" }),
        "automation.cave_word": state("automation.cave_word", "on", { friendly_name: "Cave Lights" }),
        "automation.man_word": state("automation.man_word", "on", { friendly_name: "Man Lights" }),
        "automation.master": state("automation.master", "on", { friendly_name: "Master Bedroom Lights" }),
        "automation.closet": state("automation.closet", "on", { friendly_name: "Bedroom Closet · Door Closed" }),
        "automation.bedroom_motion": state("automation.bedroom_motion", "on", {
          friendly_name: "Bedroom · Motion · Turn on Overhead",
        }),
      },
    });
    assert.deepEqual(classifyArea(fixture, "office_of_drew").automations, []);
    assert.deepEqual(classifyArea(fixture, "bedroom").automations, ["automation.master"]);
    assert.deepEqual(classifyArea(fixture, "guest_bedroom").automations, ["automation.guest"]);
    assert.deepEqual(classifyArea(fixture, "bedroom_closet").automations, ["automation.closet"]);
    assert.deepEqual(classifyArea(fixture, "cabin_bedroom").automations, ["automation.bedroom_motion"]);
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
    assert.deepEqual(result.climate, []);
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
  it("opens as the private bubble popup, not the legacy vertical-stack popup", () => {
    const popup = buildPopupConfig("bedroom", "Master Bedroom", "mdi:bed", emptySections());
    assert.equal(popup.type, "custom:area-card-bubble");
    assert.equal(popup.card_type, "pop-up");
    assert.equal(popup.hash, "#area-bedroom");
    assert.equal(JSON.stringify(popup).includes("custom:bubble-card"), false);
  });

  it("uses the built-in media control card", () => {
    const cards = buildPopupCards(
      {
        ...emptySections(),
        mediaPlayers: ["media_player.tv"],
      },
      {
        "media_player.tv": state("media_player.tv", "off", { friendly_name: "Man Cave TV" }),
      },
      "Man Cave",
    );
    const media = cards.find((card) => card.type === "media-control");
    assert.equal(media?.entity, "media_player.tv");
    assert.equal(media?.name, "TV");
    assert.deepEqual(media?.grid_options, { columns: 12 });
    assert.equal(media?.use_media_info, undefined);
    assert.equal(media?.show_volume_level, undefined);
    assert.equal(media?.media_controls, undefined);
    assert.equal(media?.volume_controls, undefined);
    assert.equal(
      cards.some((card) => String(card.type).includes("media-player-card")),
      false,
    );
  });

  it("omits empty section headings", () => {
    const cards = buildPopupCards(emptySections());
    assert.deepEqual(cards, []);
  });

  it("renders only the sections that have entities, with prefixed mushroom types", () => {
    const cards = buildPopupCards(
      {
        ...emptySections(),
        lights: ["light.reading_lamp", "light.under_bed"],
        occupancy: [{ entityId: "binary_sensor.bed", pressureEntityId: "sensor.bed_pressure" }],
      },
      {
        "light.reading_lamp": state("light.reading_lamp", "on", { supported_color_modes: ["brightness"] }),
        "light.under_bed": state("light.under_bed", "on", { supported_color_modes: ["color_temp", "xy"] }),
      },
    );
    const titles = cards.filter((card) => card.title).map((card) => card.title);
    assert.deepEqual(titles, ["Status", "Lights", "Occupancy"]);
    const chips = cards.find((card) => String(card.type).endsWith("chips-card"));
    const contents = (chips?.chips as Array<{ content: string }>).map((chip) => chip.content);
    assert.deepEqual(contents, ["Lights 2/2 On", "Occupancy 0/1 On"]);
    assert.equal(cards.some((card) => JSON.stringify(card).includes("sensor.bed_pressure") && card.type?.toString().includes("entity-card")), false);
    const types = cards.map((card) => String(card.type));
    assert.ok(types.every((type) => type.startsWith("custom:area-card-mushroom-")));
    assert.ok(types.includes("custom:area-card-mushroom-light-card"));
    assert.ok(types.includes("custom:area-card-mushroom-template-card"));
    assert.equal(types.some((type) => type.startsWith("custom:mushroom-")), false);
    assert.equal(JSON.stringify(cards).includes("custom:bubble-card"), false);
  });

  it("toggles an on/off light from the icon and opens more-info from the row", () => {
    const desk = "light.man_cave_desk_lamp";
    const strip = "light.master_bedroom_under_bed_light_strip";
    const cards = buildPopupCards(
      { ...emptySections(), lights: [desk, strip, "light.no_modes"] },
      {
        [desk]: state(desk, "off", { friendly_name: "Man Cave Desk Lamp", supported_color_modes: ["onoff"] }),
        [strip]: state(strip, "on", { supported_color_modes: ["color_temp", "xy"] }),
        "light.no_modes": state("light.no_modes", "off", {}),
      },
    );
    const onOff = cards.find((card) => card.entity === desk);
    const dimmable = cards.find((card) => card.entity === strip);
    const unknown = cards.find((card) => card.entity === "light.no_modes");

    assert.equal(onOff?.type, "custom:area-card-mushroom-template-card");
    assert.deepEqual(onOff?.tap_action, { action: "more-info" });
    assert.deepEqual(onOff?.icon_tap_action, {
      action: "perform-action",
      perform_action: "light.toggle",
      target: { entity_id: desk },
    });
    assert.equal(JSON.stringify(onOff).includes("show_brightness_control"), false);

    assert.equal(unknown?.type, "custom:area-card-mushroom-template-card");
    assert.deepEqual((unknown?.icon_tap_action as { target: { entity_id: string } }).target.entity_id, "light.no_modes");

    assert.equal(dimmable?.type, "custom:area-card-mushroom-light-card");
    assert.equal(dimmable?.show_brightness_control, true);
    assert.equal(dimmable?.show_color_temp_control, true);
    assert.equal(dimmable?.show_color_control, true);
    assert.equal(dimmable?.icon_tap_action, undefined);
    assert.equal(dimmable?.tap_action, undefined);
  });

  it("keeps every brightness, color, and color-temperature mode on the light card", () => {
    for (const mode of ["brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"]) {
      const entity = `light.${mode}`;
      const cards = buildPopupCards(
        { ...emptySections(), lights: [entity] },
        { [entity]: state(entity, "on", { supported_color_modes: [mode] }) },
      );
      const card = cards.find((item) => item.entity === entity);
      assert.equal(card?.type, "custom:area-card-mushroom-light-card", mode);
      assert.equal(card?.show_brightness_control, true, mode);
    }
  });

  it("reserves a fixed dot slot for every section and hides empty ones", () => {
    const lights = ["light.a", "light.b", "light.c", "light.d"];
    const sections = { ...emptySections(), lights };
    const offStates = Object.fromEntries(lights.map((id) => [id, state(id, "off")]));
    const onStates = { ...offStates, "light.a": state("light.a", "on") };

    const inactive = buildButtonConfig({
      areaId: "bedroom",
      name: "Master Bedroom",
      icon: "mdi:bed",
      sections,
      states: offStates,
    });
    const active = buildButtonConfig({
      areaId: "bedroom",
      name: "Master Bedroom",
      icon: "mdi:bed",
      sections,
      states: onStates,
    });
    const other = buildButtonConfig({
      areaId: "office_of_drew",
      name: "Man Cave",
      icon: "mdi:office-building",
      sections: {
        ...emptySections(),
        climate: ["sensor.temp"],
        openings: ["binary_sensor.door"],
        selects: ["input_select.scene"],
        helpers: ["timer.nap"],
      },
      states: {
        "sensor.temp": state("sensor.temp", "21", { device_class: "temperature" }),
        "binary_sensor.door": state("binary_sensor.door", "off"),
        "input_select.scene": state("input_select.scene", "movie"),
        "timer.nap": state("timer.nap", "idle"),
      },
    });
    const offDots = inactive.sub_button as Array<Record<string, unknown>>;
    const onDots = active.sub_button as Array<Record<string, unknown>>;
    const otherDots = other.sub_button as Array<Record<string, unknown>>;
    const expectedOff = DOT_SLOTS.map((id) => (id === "lights" ? "area-dot-lights-off" : `area-dot-${id}-empty`));
    const expectedOn = DOT_SLOTS.map((id) => (id === "lights" ? "area-dot-lights-on" : `area-dot-${id}-empty`));
    const expectedOther = DOT_SLOTS.map((id) => (id === "openings" ? "area-dot-openings-off" : `area-dot-${id}-empty`));
    assert.deepEqual(offDots.map((dot) => dot.css_class), expectedOff);
    assert.deepEqual(onDots.map((dot) => dot.css_class), expectedOn);
    assert.deepEqual(otherDots.map((dot) => dot.css_class), expectedOther);
    assert.equal(offDots.length, otherDots.length);

    const styles = String(inactive.styles);
    assert.match(styles, /opacity: 0 !important/);
    assert.match(styles, /visibility: hidden !important/);
    assert.match(styles, /pointer-events: none !important/);
    assert.match(styles, /width: 14px !important/);
    const emptyRule = styles.slice(styles.indexOf('[class*="-empty"]'));
    assert.equal(emptyRule.includes("display: none"), false);
    assert.equal(styles.includes("background: rgb(255, 193, 7)"), false);
    assert.equal(String(active.styles).includes("background: rgb(255, 193, 7)"), true);
    assert.equal(styles.includes("box-shadow: inset 0 0 0 1.5px rgb(255, 193, 7)"), true);

    const emptyDot = offDots[0];
    assert.deepEqual(emptyDot?.tap_action, { action: "none" });
    assert.equal(JSON.stringify(emptyDot).includes("light.toggle"), false);
    assert.equal(JSON.stringify(emptyDot).includes("automation.toggle"), false);
    assert.equal(JSON.stringify(onDots).includes("light.toggle"), false);
    assert.equal(JSON.stringify(onDots).includes("perform-action"), false);
    const lightsDot = onDots[DOT_SLOTS.indexOf("lights")];
    const tap = lightsDot?.tap_action as { navigation_path: string };
    assert.equal(tap.navigation_path, "#area-bedroom");
    assert.equal(active.name, "Master Bedroom");
    assert.equal(JSON.stringify(active).includes("custom:bubble-card"), false);
    assert.equal(String(active.type), "custom:area-card-bubble");

    const sparseSections = {
      ...emptySections(),
      climate: ["sensor.temp"],
      openings: ["binary_sensor.door"],
      selects: ["input_select.scene"],
      helpers: ["timer.nap"],
    };
    const sparseStates = {
      "sensor.temp": state("sensor.temp", "21", { device_class: "temperature", friendly_name: "Man Cave Temperature" }),
      "binary_sensor.door": state("binary_sensor.door", "off"),
      "input_select.scene": state("input_select.scene", "movie"),
      "timer.nap": state("timer.nap", "idle"),
    };
    const sparseDots = (
      buildButtonConfig({
        areaId: "office_of_drew",
        name: "Man Cave",
        icon: "mdi:office-building",
        sections: sparseSections,
        states: sparseStates,
      }).sub_button as Array<Record<string, unknown>>
    ).map((dot) => dot.css_class);
    assert.deepEqual(
      sparseDots,
      DOT_SLOTS.map((id) => (id === "openings" ? "area-dot-openings-off" : `area-dot-${id}-empty`)),
    );
    const sparseCards = buildPopupCards(sparseSections, sparseStates, "Man Cave");
    assert.deepEqual(
      sparseCards.filter((card) => card.title).map((card) => card.title),
      ["Status", "Climate", "Entries", "Helpers"],
    );
  });
});

const DOT_SLOTS = [
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

const roomAreas: Record<string, { area_id: string; name: string }> = {
  office_of_drew: { area_id: "office_of_drew", name: "Man Cave" },
  bedroom: { area_id: "bedroom", name: "Master Bedroom" },
  cabin_bedroom: { area_id: "cabin_bedroom", name: "Bedroom" },
  guest_bedroom: { area_id: "guest_bedroom", name: "Guest Bedroom" },
  bedroom_closet: { area_id: "bedroom_closet", name: "Bedroom Closet" },
};

function listedIds(sections: AreaSections): string[] {
  return [
    ...sections.climate,
    ...sections.lights,
    ...Object.values(sections.lightLeds),
    ...sections.mediaPlayers,
    ...sections.switches,
    ...sections.occupancy.map((item) => item.entityId),
    ...sections.openings,
    ...sections.satellites.flatMap((item) => [item.entityId, item.ledEntityId, item.alarmEntityId].filter(Boolean) as string[]),
    ...sections.helpers,
    ...sections.selects,
    ...sections.automations,
  ];
}

describe("satellite scope", () => {
  it("keeps satellite entities off every other section and puts alarm on the kiosk card", () => {
    const result = classifyArea(
      hass({
        devices: [
          { id: "updoot", area_id: "office_of_drew", manufacturer: "kiosk_satellite" },
          { id: "plain", area_id: "office_of_drew", manufacturer: "Espressif" },
        ],
        entities: [
          { entity_id: "assist_satellite.updoot", device_id: "updoot" },
          { entity_id: "binary_sensor.updoot_alarm_ringing", device_id: "updoot" },
          { entity_id: "light.updoot_led_control_idle", device_id: "updoot" },
          { entity_id: "button.updoot_stop_alarm", device_id: "updoot" },
          { entity_id: "switch.updoot_relay", device_id: "updoot" },
          { entity_id: "sensor.updoot_cpu_temperature", device_id: "updoot", entity_category: "diagnostic" },
          { entity_id: "sensor.updoot_ambient_light", device_id: "updoot" },
          { entity_id: "assist_satellite.plain", device_id: "plain" },
          { entity_id: "binary_sensor.plain_alarm_ringing", device_id: "plain" },
          { entity_id: "light.desk_lamp", area_id: "office_of_drew" },
          { entity_id: "binary_sensor.door", area_id: "office_of_drew" },
        ],
        states: {
          "binary_sensor.updoot_alarm_ringing": state("binary_sensor.updoot_alarm_ringing", "off", {
            friendly_name: "Updoot1 Alarm ringing",
          }),
          "binary_sensor.plain_alarm_ringing": state("binary_sensor.plain_alarm_ringing", "on", {
            friendly_name: "Alarm ringing",
          }),
          "sensor.updoot_cpu_temperature": state("sensor.updoot_cpu_temperature", "40", { device_class: "temperature" }),
          "binary_sensor.door": state("binary_sensor.door", "off", { device_class: "door" }),
          "light.updoot_led_control_idle": state("light.updoot_led_control_idle", "on"),
        },
      }),
      "office_of_drew",
    );

    assert.deepEqual(result.satellites, [
      {
        entityId: "assist_satellite.plain",
        alarmEntityId: "binary_sensor.plain_alarm_ringing",
      },
      {
        entityId: "assist_satellite.updoot",
        ledEntityId: "light.updoot_led_control_idle",
        alarmEntityId: "binary_sensor.updoot_alarm_ringing",
      },
    ]);
    assert.deepEqual(result.lights, ["light.desk_lamp"]);
    assert.deepEqual(result.openings, ["binary_sensor.door"]);
    assert.deepEqual(result.climate, []);
    for (const leaked of [
      "binary_sensor.updoot_alarm_ringing",
      "binary_sensor.plain_alarm_ringing",
      "light.updoot_led_control_idle",
      "button.updoot_stop_alarm",
      "switch.updoot_relay",
      "sensor.updoot_cpu_temperature",
      "sensor.updoot_ambient_light",
    ]) {
      assert.equal(result.helpers.includes(leaked), false, leaked);
      assert.equal(result.switches.includes(leaked), false, leaked);
      assert.equal(result.lights.includes(leaked), false, leaked);
      assert.equal(result.openings.includes(leaked), false, leaked);
      assert.equal(result.climate.includes(leaked), false, leaked);
    }

    const cards = buildPopupCards(result, {
      "assist_satellite.updoot": state("assist_satellite.updoot", "idle", { friendly_name: "Updoot1 Assist satellite" }),
      "binary_sensor.updoot_alarm_ringing": state("binary_sensor.updoot_alarm_ringing", "off", {
        friendly_name: "Updoot1 Alarm ringing",
      }),
      "light.updoot_led_control_idle": state("light.updoot_led_control_idle", "on"),
    });
    const kiosk = cards.find((card) => card.entity === "assist_satellite.updoot");
    assert.equal(String(kiosk?.secondary).includes("Alarm:"), true);
    assert.equal(String(kiosk?.secondary).includes("light.updoot_led_control_idle"), true);
    assert.equal(kiosk?.primary, "Updoot1 Assist satellite");
    assert.equal(cards.some((card) => card.entity === "binary_sensor.updoot_alarm_ringing"), false);
    assert.deepEqual(
      cards.filter((card) => card.title).map((card) => card.title),
      ["Status", "Lights", "Entries", "Satellites"],
    );
  });
});

describe("section rollups", () => {
  it("counts 1 of 4 lights on and 1 of 4 openings open", () => {
    const lights = ["light.a", "light.b", "light.c", "light.d"];
    const openings = ["binary_sensor.d1", "binary_sensor.d2", "binary_sensor.d3", "binary_sensor.d4"];
    const sections = { ...emptySections(), lights, openings };
    const states = {
      "light.a": state("light.a", "on"),
      "light.b": state("light.b", "off"),
      "light.c": state("light.c", "off"),
      "light.d": state("light.d", "off"),
      "binary_sensor.d1": state("binary_sensor.d1", "on"),
      "binary_sensor.d2": state("binary_sensor.d2", "off"),
      "binary_sensor.d3": state("binary_sensor.d3", "off"),
      "binary_sensor.d4": state("binary_sensor.d4", "off"),
    };
    const rollups = sectionRollups(sections, states);
    assert.deepEqual(
      rollups.map((rollup) => rollupLabel(rollup)),
      ["Lights 1/4 On", "Entries 1/4 Open"],
    );
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-lights-on", rollups), "Lights 1/4 On");
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-openings-on", rollups), "Entries 1/4 Open");
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-media-empty", rollups), null);
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-climate-empty", rollups), null);
    const above = tooltipPosition({ left: 100, top: 80, width: 14, height: 14 }, { width: 120, height: 24 }, { width: 800, height: 600 });
    assert.equal(above.top, 80 - 6 - 24);
    assert.equal(above.left, 100 + 7 - 60);
    const flipped = tooltipPosition({ left: 100, top: 2, width: 14, height: 14 }, { width: 120, height: 24 }, { width: 800, height: 600 });
    assert.equal(flipped.top, 2 + 14 + 6);
    const clamped = tooltipPosition({ left: 780, top: 80, width: 14, height: 14 }, { width: 120, height: 24 }, { width: 800, height: 600 });
    assert.equal(clamped.left, 800 - 4 - 120);

    const openingCover = sectionRollups(
      { ...emptySections(), openings: ["cover.shade"] },
      { "cover.shade": state("cover.shade", "opening") },
    );
    assert.equal(openingCover[0]?.active, 1);
    const closedCover = sectionRollups(
      { ...emptySections(), openings: ["cover.shade"] },
      { "cover.shade": state("cover.shade", "closed") },
    );
    assert.equal(closedCover[0]?.active, 0);
  });

  it("counts helper binaries and ignores input_select and timers", () => {
    const sections = {
      ...emptySections(),
      helpers: ["input_boolean.guest", "input_boolean.away", "timer.nap", "binary_sensor.template_flag"],
      selects: ["input_select.scene"],
    };
    const states = {
      "input_boolean.guest": state("input_boolean.guest", "on"),
      "input_boolean.away": state("input_boolean.away", "off"),
      "timer.nap": state("timer.nap", "active"),
      "binary_sensor.template_flag": state("binary_sensor.template_flag", "off"),
      "input_select.scene": state("input_select.scene", "movie"),
    };
    const rollups = sectionRollups(sections, states);
    assert.deepEqual(
      rollups.map((rollup) => `${rollup.title} ${rollup.active}/${rollup.total} ${rollup.word}`),
      ["Helpers 1/3 On"],
    );

    const selectsOnly = sectionRollups(
      { ...emptySections(), selects: ["input_select.scene"], helpers: ["timer.nap"] },
      states,
    );
    assert.deepEqual(selectsOnly, []);
    const cards = buildPopupCards(
      { ...emptySections(), selects: ["input_select.scene"], helpers: ["timer.nap"] },
      states,
    );
    assert.deepEqual(
      cards.filter((card) => card.title).map((card) => card.title),
      ["Helpers"],
    );
  });

  it("omits a climate chip for numeric sensors and still shows the cards", () => {
    const sections = {
      ...emptySections(),
      climate: ["sensor.temp"],
      lights: ["light.desk"],
    };
    const states = {
      "sensor.temp": state("sensor.temp", "21", { device_class: "temperature", friendly_name: "Man Cave Temperature" }),
      "light.desk": state("light.desk", "off", { friendly_name: "Desk" }),
    };
    assert.deepEqual(
      sectionRollups(sections, states).map((rollup) => rollup.id),
      ["lights"],
    );
    const cards = buildPopupCards(sections, states, "Man Cave");
    assert.deepEqual(
      cards.filter((card) => card.title).map((card) => card.title),
      ["Status", "Climate", "Lights"],
    );
    const climate = cards.find((card) => card.entity === "sensor.temp");
    assert.equal(climate?.name, "Temperature");
  });

  it("labels the satellite section Satellites and counts alarm or companion LED", () => {
    const sections = {
      ...emptySections(),
      satellites: [
        {
          entityId: "assist_satellite.kiosk",
          ledEntityId: "light.kiosk_led",
          alarmEntityId: "binary_sensor.kiosk_alarm",
        },
      ],
    };
    const offStates = {
      "assist_satellite.kiosk": state("assist_satellite.kiosk", "idle", { friendly_name: "Man Cave Kiosk" }),
      "binary_sensor.kiosk_alarm": state("binary_sensor.kiosk_alarm", "off"),
      "light.kiosk_led": state("light.kiosk_led", "off"),
    };
    const off = sectionRollups(sections, offStates);
    assert.equal(sectionTitle("satellites"), "Satellites");
    assert.equal(off[0]?.id, "satellites");
    assert.deepEqual(
      off.map((rollup) => rollupLabel(rollup)),
      ["Satellites 0/1 On"],
    );
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-satellites-off", off), "Satellites 0/1 On");
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-satellites-empty", off), null);

    const cards = buildPopupCards(sections, offStates, "Man Cave");
    assert.deepEqual(
      cards.filter((card) => card.title).map((card) => card.title),
      ["Status", "Satellites"],
    );
    const chips = cards.find((card) => String(card.type).endsWith("chips-card"));
    const contents = (chips?.chips as Array<{ content: string }>).map((chip) => chip.content);
    assert.deepEqual(contents, ["Satellites 0/1 On"]);

    const alarmOn = sectionRollups(sections, {
      ...offStates,
      "binary_sensor.kiosk_alarm": state("binary_sensor.kiosk_alarm", "on"),
    });
    assert.equal(rollupLabel(alarmOn[0]!), "Satellites 1/1 On");
    const ledOn = sectionRollups(sections, {
      "binary_sensor.kiosk_alarm": state("binary_sensor.kiosk_alarm", "off"),
      "light.kiosk_led": state("light.kiosk_led", "on"),
    });
    assert.equal(rollupLabel(ledOn[0]!), "Satellites 1/1 On");
    assert.equal(JSON.stringify(cards).includes("Kiosk & Satellites"), false);
  });
});

describe("light LED dot", () => {
  it("puts a same-device LED switch on the light card and not in helpers", () => {
    const desk = "light.man_cave_desk_lamp";
    const led = "switch.man_cave_desk_lamp_led";
    const result = classifyArea(
      hass({
        devices: [{ id: "desk", area_id: "office_of_drew" }],
        entities: [
          { entity_id: desk, device_id: "desk" },
          { entity_id: led, device_id: "desk", entity_category: "config" },
          { entity_id: "switch.orphan_led", area_id: "office_of_drew" },
        ],
        states: {
          [desk]: state(desk, "off", { friendly_name: "Man Cave Desk Lamp", supported_color_modes: ["onoff"] }),
          [led]: state(led, "on", { friendly_name: "Man Cave Desk Lamp LED" }),
          "switch.orphan_led": state("switch.orphan_led", "on"),
        },
      }),
      "office_of_drew",
    );
    assert.deepEqual(result.lights, [desk]);
    assert.deepEqual(result.lightLeds, { [desk]: led });
    assert.deepEqual(result.helpers, []);
    assert.deepEqual(result.switches, []);

    const cards = buildPopupCards(result, {
      [desk]: state(desk, "off", { friendly_name: "Man Cave Desk Lamp", supported_color_modes: ["onoff"] }),
      [led]: state(led, "on"),
    }, "Man Cave");
    const row = cards.find((card) => card.led_entity === led);
    const inner = row?.card as Record<string, unknown>;
    assert.equal(row?.type, "custom:area-card-light-row");
    assert.equal(inner?.type, "custom:area-card-mushroom-template-card");
    assert.equal(inner?.primary, "Desk Lamp");
    assert.deepEqual(inner?.tap_action, { action: "more-info" });
    assert.deepEqual(inner?.icon_tap_action, {
      action: "perform-action",
      perform_action: "light.toggle",
      target: { entity_id: desk },
    });
    assert.equal(cards.some((card) => card.entity === led), false);
    assert.equal(cards.some((card) => card.entity === "switch.orphan_led"), false);
  });
});

describe("stripRoomName", () => {
  it("removes a leading room name and one separator", () => {
    assert.equal(stripRoomName("Man Cave Desk Lamp", "Man Cave"), "Desk Lamp");
    assert.equal(stripRoomName("Man Cave - Desk Lamp", "Man Cave"), "Desk Lamp");
    assert.equal(stripRoomName("Man Cave: Desk Lamp", "Man Cave"), "Desk Lamp");
    assert.equal(stripRoomName("Man Cave|Desk Lamp", "Man Cave"), "Desk Lamp");
    assert.equal(stripRoomName("Master Bedroom — Under Bed Light Strip", "Master Bedroom"), "Under Bed Light Strip");
    assert.equal(stripRoomName("Master Bedroom Reading Lamp", "Master Bedroom"), "Reading Lamp");
    assert.equal(stripRoomName("Man Cave Doors are Correct", "Man Cave"), "Doors are Correct");
    assert.equal(stripRoomName("Man Cave · Occupied · Turn on Lights", "Man Cave"), "Occupied · Turn on Lights");
  });

  it("leaves unrelated titles, the exact room name, and the header alone", () => {
    assert.equal(stripRoomName("Updoot1 Alarm ringing", "Man Cave"), "Updoot1 Alarm ringing");
    assert.equal(stripRoomName("Man Cave", "Man Cave"), "Man Cave");
    assert.equal(stripRoomName("man cave desk lamp", "Man Cave"), "desk lamp");
    assert.equal(stripRoomName("Man Caves are nice", "Man Cave"), "Man Caves are nice");

    const popup = buildPopupConfig(
      "office_of_drew",
      "Man Cave",
      "mdi:office-building",
      {
        ...emptySections(),
        lights: ["light.man_cave_desk_lamp"],
      },
      {
        "light.man_cave_desk_lamp": state("light.man_cave_desk_lamp", "on", {
          friendly_name: "Man Cave Desk Lamp",
          supported_color_modes: ["onoff"],
        }),
      },
    );
    assert.equal(popup.name, "Man Cave");
    const lamp = (popup.cards as Array<Record<string, unknown>>).find((card) => card.entity === "light.man_cave_desk_lamp");
    assert.equal(lamp?.primary, "Desk Lamp");
    const button = buildButtonConfig({
      areaId: "office_of_drew",
      name: "Man Cave",
      icon: "mdi:office-building",
      sections: { ...emptySections(), lights: ["light.man_cave_desk_lamp"] },
      states: {
        "light.man_cave_desk_lamp": state("light.man_cave_desk_lamp", "off"),
      },
    });
    assert.equal(button.name, "Man Cave");
  });
});

// ---------------------------------------------------------------------------
// Floor helpers
// ---------------------------------------------------------------------------

function floorHass(
  floors: Record<string, FloorEntry>,
  areas: Record<string, AreaEntry>,
): ClassifierHass {
  return { floors, areas };
}

describe("floorDisplay", () => {
  it("returns the floor name and icon when present", () => {
    const h = floorHass({ downstairs: { floor_id: "downstairs", name: "Downstairs", icon: "mdi:home-floor-0" } }, {});
    assert.deepEqual(floorDisplay(h, "downstairs"), { name: "Downstairs", icon: "mdi:home-floor-0" });
  });

  it("falls back to the floor id when name is missing", () => {
    const h = floorHass({ f1: { floor_id: "f1" } }, {});
    assert.equal(floorDisplay(h, "f1").name, "f1");
  });

  it("returns no icon when the floor icon is missing", () => {
    const h = floorHass({ f1: { floor_id: "f1", name: "Ground" } }, {});
    assert.equal(floorDisplay(h, "f1").icon, null);
  });

  it("returns no icon when the floor icon is null or empty", () => {
    const missing = floorHass({ f1: { floor_id: "f1", name: "Ground", icon: null } }, {});
    const empty = floorHass({ f1: { floor_id: "f1", name: "Ground", icon: "" } }, {});
    assert.equal(floorDisplay(missing, "f1").icon, null);
    assert.equal(floorDisplay(empty, "f1").icon, null);
  });

  it("returns the floor id and no icon when the floor is unknown", () => {
    const h = floorHass({}, {});
    assert.deepEqual(floorDisplay(h, "unknown"), { name: "unknown", icon: null });
  });

  it("returns the floor id and no icon when floors registry is absent", () => {
    const h: ClassifierHass = {};
    assert.deepEqual(floorDisplay(h, "x"), { name: "x", icon: null });
  });
});

describe("areasOnFloor", () => {
  it("returns areas whose floor_id matches, sorted by name", () => {
    const h = floorHass(
      { down: { floor_id: "down", name: "Downstairs" } },
      {
        kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "down" },
        living: { area_id: "living", name: "Living Room", floor_id: "down" },
        office: { area_id: "office", name: "Office", floor_id: "up" },
        garage: { area_id: "garage", name: "Garage" },
      },
    );
    const result = areasOnFloor(h, "down");
    assert.deepEqual(
      result.map((a) => a.areaId),
      ["kitchen", "living"],
    );
  });

  it("sorts areas alphabetically by name", () => {
    const h = floorHass(
      { f: { floor_id: "f" } },
      {
        z_area: { area_id: "z_area", name: "Zebra Room", floor_id: "f" },
        a_area: { area_id: "a_area", name: "Apple Room", floor_id: "f" },
        m_area: { area_id: "m_area", name: "Mango Room", floor_id: "f" },
      },
    );
    const result = areasOnFloor(h, "f");
    assert.deepEqual(
      result.map((a) => a.name),
      ["Apple Room", "Mango Room", "Zebra Room"],
    );
  });

  it("breaks name ties by area id", () => {
    const h = floorHass(
      { f: { floor_id: "f" } },
      {
        b_room: { area_id: "b_room", name: "Room", floor_id: "f" },
        a_room: { area_id: "a_room", name: "Room", floor_id: "f" },
      },
    );
    const result = areasOnFloor(h, "f");
    assert.deepEqual(
      result.map((a) => a.areaId),
      ["a_room", "b_room"],
    );
  });

  it("falls back to area id as name when area name is missing", () => {
    const h = floorHass(
      { f: { floor_id: "f" } },
      {
        nameless: { area_id: "nameless", floor_id: "f" },
      },
    );
    const result = areasOnFloor(h, "f");
    assert.equal(result[0].name, "nameless");
  });

  it("returns an empty list when no areas match the floor", () => {
    const h = floorHass(
      { f: { floor_id: "f" } },
      { kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "other" } },
    );
    assert.deepEqual(areasOnFloor(h, "f"), []);
  });

  it("returns an empty list when there are no areas at all", () => {
    const h: ClassifierHass = { floors: { f: { floor_id: "f" } } };
    assert.deepEqual(areasOnFloor(h, "f"), []);
  });
});
