import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  automationIconName,
  automationStateText,
  automationSubtitleSegments,
  placeAutomationSubtitle,
} from "../src/automation-subtitle";
import { buildButtonConfig } from "../src/button-config";
import { climateSubtitle } from "../src/climate-subtitle";
import { floorExpandedKey, floorRuntimeConfig, parseFloorExpanded } from "../src/floor-state";
import { areasOnFloor, floorDisplay } from "../src/floors";
import { stripRoomName } from "../src/names";
import { areaDotTooltip, tooltipPosition } from "../src/dot-tooltip";
import { buildPopupCards, buildPopupConfig } from "../src/popup-cards";
import { collapsedDotSlots, dotTooltipLabel, floorDotRow, iconInk, parseHideSections, ROLLUP_ORDER, rollupLabel, sectionColor, sectionHasEntities, sectionIcon, sectionRollups, sectionTitle, withoutSections, type RollupId } from "../src/rollups";
import {
  areaDisplay,
  areaUnavailable,
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

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  attrs: Record<string, string>;
  styleMap: Record<string, string>;
  style: { setProperty(name: string, value: string): void };
  setAttribute(name: string, value: string): void;
}

function placeHost(initial: string) {
  const kids: FakeNode[] = [];
  let raw: string | null = initial;
  let replacements = 0;
  return {
    get kids() {
      return kids;
    },
    get replacements() {
      return replacements;
    },
    get textContent() {
      if (raw !== null) return raw;
      return kids.map((node) => node.textContent).join("");
    },
    ownerDocument: {
      createElement(tag: string): FakeNode {
        const styleMap: Record<string, string> = {};
        const node: FakeNode = {
          tag,
          className: "",
          textContent: "",
          attrs: {},
          styleMap,
          style: {
            setProperty(name: string, value: string) {
              styleMap[name] = value;
            },
          },
          setAttribute(name: string, value: string) {
            node.attrs[name] = value;
          },
        };
        return node;
      },
      createTextNode(text: string): FakeNode {
        return {
          tag: "#text",
          className: "",
          textContent: text,
          attrs: {},
          styleMap: {},
          style: { setProperty() {} },
          setAttribute() {},
        };
      },
    },
    replaceChildren(...nodes: FakeNode[]) {
      kids.splice(0, kids.length, ...nodes);
      raw = null;
      replacements += 1;
    },
    style: { removeProperty() {} },
  };
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
    assert.equal(rollup && rollupLabel(rollup), "Automations 2/3 on, 0 disabled");
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

  it("puts the section icon to the left of each heading", () => {
    const cards = buildPopupCards({
      ...emptySections(),
      climate: ["sensor.temp"],
      lights: ["light.a"],
      mediaPlayers: ["media_player.tv"],
      switches: ["switch.a"],
      occupancy: [{ entityId: "binary_sensor.motion" }],
      openings: ["binary_sensor.door"],
      satellites: [{ entityId: "assist_satellite.kiosk" }],
      helpers: ["input_boolean.a"],
      automations: ["automation.a"],
    });
    const headings = cards.filter((card) => card.type === "custom:area-card-section-title");
    assert.deepEqual(
      headings.map((card) => [card.title, card.icon, card.color]),
      [
        ["Status", "mdi:list-status", "var(--primary-text-color)"],
        ...ROLLUP_ORDER.map((id) => [sectionTitle(id), sectionIcon(id), sectionColor(id)]),
      ],
    );
    assert.equal(sectionIcon("lights"), "mdi:lightbulb");
    assert.equal(sectionIcon("openings"), "mdi:door");
    assert.equal(iconInk("rgb(255, 193, 7)"), "#1a1a1a");
    assert.equal(iconInk("rgb(158, 158, 158)"), "#1a1a1a");
    assert.equal(iconInk("rgb(255, 235, 59)"), "#1a1a1a");
    assert.equal(iconInk("rgb(33, 150, 243)"), "#fff");
    assert.equal(iconInk("rgb(3, 169, 244)"), "#fff");
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
    assert.ok(
      types.every(
        (type) => type.startsWith("custom:area-card-mushroom-") || type === "custom:area-card-section-title",
      ),
    );
    assert.ok(types.includes("custom:area-card-section-title"));
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
      dotSlots: DOT_SLOTS,
    });
    const active = buildButtonConfig({
      areaId: "bedroom",
      name: "Master Bedroom",
      icon: "mdi:bed",
      sections,
      states: onStates,
      dotSlots: DOT_SLOTS,
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
      dotSlots: DOT_SLOTS,
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
    assert.match(styles, /width: 22px !important/);
    assert.match(styles, /--mdc-icon-size: 14px/);
    assert.equal(styles.includes("color: transparent"), false);
    const sectionIcons = [
      "mdi:lightbulb",
      "mdi:play-circle",
      "mdi:toggle-switch",
      "mdi:account",
      "mdi:door",
      "mdi:tablet-dashboard",
      "mdi:cog",
    ];
    assert.equal(DOT_SLOTS.includes("automations"), false);
    assert.deepEqual(offDots.map((dot) => dot.icon), sectionIcons);
    const withAutomations = { ...sections, automations: ["automation.bedtime"] };
    const automationStates = {
      ...onStates,
      "automation.bedtime": state("automation.bedtime", "on", { friendly_name: "Bedtime" }),
    };
    const automationDots = (
      buildButtonConfig({
        areaId: "bedroom",
        name: "Master Bedroom",
        icon: "mdi:bed",
        sections: withAutomations,
        states: automationStates,
        dotSlots: DOT_SLOTS,
      }).sub_button as Array<Record<string, unknown>>
    ).map((dot) => dot.css_class);
    assert.equal(automationDots.some((css) => String(css).includes("automations")), false);
    assert.deepEqual(automationDots, expectedOn);
    assert.deepEqual(
      buildPopupCards(withAutomations, automationStates, "Master Bedroom")
        .filter((card) => card.title)
        .map((card) => card.title),
      ["Status", "Lights", "Automations"],
    );
    assert.deepEqual(onDots.map((dot) => dot.icon), sectionIcons);
    assert.deepEqual(otherDots.map((dot) => dot.icon), sectionIcons);
    assert.match(
      String(active.styles),
      /\.bubble-sub-button\.area-dot-lights-on \{[^}]*color: #1a1a1a !important/,
    );
    assert.match(
      styles,
      /\.bubble-sub-button\.area-dot-lights-off \{[^}]*color: rgb\(255, 193, 7\) !important/,
    );
    assert.match(styles, /:host\s*\{[^}]*--bubble-box-shadow:\s*var\(--ha-card-box-shadow\)/);
    assert.match(
      styles,
      /--bubble-main-background-color:\s*var\(--ha-card-background,\s*var\(--card-background-color\)\)/,
    );
    assert.match(styles, /--bubble-border-radius:\s*var\(--ha-card-border-radius\)/);
    assert.match(styles, /--bubble-icon-border-radius:\s*50%/);
    const emptyRule = styles.slice(styles.indexOf('[class*="-empty"]'));
    assert.equal(emptyRule.includes("display: none"), false);
    assert.equal(styles.includes("background: rgb(255, 193, 7)"), false);
    assert.equal(String(active.styles).includes("background: rgb(255, 193, 7)"), true);
    assert.equal(styles.includes("box-shadow: inset 0 0 0 1.5px rgb(255, 193, 7)"), true);

    const emptyDot = offDots.find((dot) => String(dot.css_class).endsWith("-empty"));
    assert.ok(emptyDot);
    assert.deepEqual(emptyDot.tap_action, { action: "none" });
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
        dotSlots: DOT_SLOTS,
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

const DOT_SLOTS = collapsedDotSlots([]);

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
    assert.equal(climateSubtitle(sections.climate, states, "Man Cave"), "Temperature 21");
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

describe("collapsed area dot tooltips", () => {
  const room = "Man Cave";

  it("keeps the summary header and lists that section in order", () => {
    const sections = {
      ...emptySections(),
      lights: ["light.lamp", "light.bare", "light.desk"],
      mediaPlayers: ["media_player.speaker", "media_player.tv"],
      openings: ["binary_sensor.window", "cover.door"],
      switches: ["switch.fan"],
      climate: ["sensor.temp"],
      automations: ["automation.bedtime"],
    };
    const states = {
      "light.lamp": state("light.lamp", "off", { friendly_name: "Man Cave Lamp" }),
      "light.bare": state("light.bare", "on"),
      "light.desk": state("light.desk", "off", { friendly_name: "Man Cave Desk" }),
      "media_player.speaker": state("media_player.speaker", "off", { friendly_name: "Man Cave Speaker" }),
      "media_player.tv": state("media_player.tv", "playing", { friendly_name: "Man Cave TV" }),
      "binary_sensor.window": state("binary_sensor.window", "on", { friendly_name: "Man Cave Window" }),
      "cover.door": state("cover.door", "closed", { friendly_name: "Man Cave Door" }),
      "switch.fan": state("switch.fan", "on", { friendly_name: "Man Cave Fan" }),
      "sensor.temp": state("sensor.temp", "21", {
        friendly_name: "Man Cave Temperature",
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
      "automation.bedtime": state("automation.bedtime", "on", { friendly_name: "Man Cave Bedtime" }),
    };
    const rollups = sectionRollups(sections, states);
    const tipSource = { sections, states, roomName: room };
    const lights = areaDotTooltip("bubble-sub-button area-dot-lights-on", rollups, tipSource);
    const lightsRollup = rollups.find((rollup) => rollup.id === "lights");
    assert.equal(lights?.split("\n")[0], rollupLabel(lightsRollup!));
    assert.deepEqual(lights?.split("\n"), ["Lights 1/3 On", "Lamp  Off", "On", "Desk  Off"]);
    assert.equal(lights?.includes("{{"), false);
    assert.equal(lights?.includes("light.bare"), false);
    for (const other of ["Fan", "Speaker", "TV", "Window", "Door", "Temperature", "Bedtime"]) {
      assert.equal(lights?.includes(other), false, other);
    }
    assert.deepEqual(areaDotTooltip("bubble-sub-button area-dot-media-on", rollups, tipSource)?.split("\n"), [
      "Media players 1/2 On",
      "Speaker  Off",
      "TV  Playing",
    ]);
    assert.deepEqual(areaDotTooltip("bubble-sub-button area-dot-openings-on", rollups, tipSource)?.split("\n"), [
      "Entries 1/2 Open",
      "Window  On",
      "Door  Closed",
    ]);
    assert.equal(areaDotTooltip("bubble-sub-button area-dot-occupancy-empty", rollups, tipSource), null);
    assert.equal(areaDotTooltip("bubble-sub-button area-dot-helpers-empty", rollups, tipSource), null);
    const [floorDot] = floorDotRow(["lights"], [rollups]);
    assert.equal(floorDot?.label, "Lights 1/3 On");
  });

  it("lists only the on/off helpers the summary counts", () => {
    const sections = {
      ...emptySections(),
      helpers: ["input_boolean.guest", "timer.nap", "binary_sensor.flag"],
      selects: ["input_select.scene"],
    };
    const states = {
      "input_boolean.guest": state("input_boolean.guest", "on", { friendly_name: "Man Cave Guest Mode" }),
      "timer.nap": state("timer.nap", "active", { friendly_name: "Man Cave Nap" }),
      "binary_sensor.flag": state("binary_sensor.flag", "off", { friendly_name: "Flag" }),
      "input_select.scene": state("input_select.scene", "movie", { friendly_name: "Man Cave Scene" }),
    };
    const rollups = sectionRollups(sections, states);
    const tip = areaDotTooltip("bubble-sub-button area-dot-helpers-on", rollups, {
      sections,
      states,
      roomName: room,
    });
    assert.deepEqual(tip?.split("\n"), ["Helpers 1/2 On", "Guest Mode  On", "Flag  Off"]);
    assert.equal(tip?.includes("Nap"), false);
    assert.equal(tip?.includes("Scene"), false);
    const selectsOnly = sectionRollups(
      { ...emptySections(), selects: ["input_select.scene"], helpers: ["timer.nap"] },
      states,
    );
    assert.equal(
      areaDotTooltip("bubble-sub-button area-dot-helpers-empty", selectsOnly, {
        sections,
        states,
        roomName: room,
      }),
      null,
    );
  });

  it("uses the popup row state, and the formatter on mushroom rows", () => {
    const sections = {
      ...emptySections(),
      lights: ["light.plain", "light.dim"],
      switches: ["switch.fan"],
      openings: ["binary_sensor.window"],
      occupancy: [{ entityId: "binary_sensor.motion", pressureEntityId: "sensor.pressure" }],
      satellites: [
        {
          entityId: "assist_satellite.kiosk",
          ledEntityId: "light.kiosk_led",
          alarmEntityId: "binary_sensor.kiosk_alarm",
        },
      ],
    };
    const states = {
      "light.plain": state("light.plain", "off", { friendly_name: "Man Cave Plain" }),
      "light.dim": state("light.dim", "on", {
        friendly_name: "Man Cave Dim",
        supported_color_modes: ["brightness"],
      }),
      "switch.fan": state("switch.fan", "on", { friendly_name: "Man Cave Fan" }),
      "binary_sensor.window": state("binary_sensor.window", "on", { friendly_name: "Man Cave Window" }),
      "binary_sensor.motion": state("binary_sensor.motion", "on", { friendly_name: "Man Cave Motion" }),
      "sensor.pressure": state("sensor.pressure", "1013", {
        friendly_name: "Man Cave Pressure",
        unit_of_measurement: "hPa",
      }),
      "assist_satellite.kiosk": state("assist_satellite.kiosk", "idle", { friendly_name: "Man Cave Kiosk" }),
      "light.kiosk_led": state("light.kiosk_led", "on", { brightness: 128 }),
      "binary_sensor.kiosk_alarm": state("binary_sensor.kiosk_alarm", "off"),
    };
    const rollups = sectionRollups(sections, states);
    const format = (entity: EntityState) => `fmt ${entity.state}`;
    const tipSource = { sections, states, roomName: room, formatEntityState: format };
    assert.deepEqual(areaDotTooltip("bubble-sub-button area-dot-lights-on", rollups, tipSource)?.split("\n"), [
      "Lights 1/2 On",
      "Plain  Off",
      "Dim  fmt on",
    ]);
    assert.deepEqual(areaDotTooltip("bubble-sub-button area-dot-switches-on", rollups, tipSource)?.split("\n"), [
      "Switches 1/1 On",
      "Fan  fmt on",
    ]);
    assert.deepEqual(areaDotTooltip("bubble-sub-button area-dot-openings-on", rollups, tipSource)?.split("\n"), [
      "Entries 1/1 Open",
      "Window  fmt on",
    ]);
    const occupancy = areaDotTooltip("bubble-sub-button area-dot-occupancy-on", rollups, tipSource);
    assert.deepEqual(occupancy?.split("\n"), ["Occupancy 1/1 On", "Motion  On · 1013 hPa"]);
    assert.equal(occupancy?.includes("fmt"), false);
    assert.equal(occupancy?.includes("Pressure"), false);
    const satellite = areaDotTooltip("bubble-sub-button area-dot-satellites-on", rollups, tipSource);
    assert.deepEqual(satellite?.split("\n"), [
      "Satellites 1/1 On",
      "Kiosk  Idle · LED: On (50%) · Alarm: Off",
    ]);
    assert.equal(satellite?.includes("fmt"), false);
    assert.equal(satellite?.includes("light.kiosk_led"), false);
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

// ---------------------------------------------------------------------------
// hide_sections
// ---------------------------------------------------------------------------

describe("parseHideSections", () => {
  it("returns empty for undefined and null", () => {
    assert.deepEqual(parseHideSections(undefined), []);
    assert.deepEqual(parseHideSections(null), []);
  });

  it("returns valid ids unchanged", () => {
    assert.deepEqual(parseHideSections(["media", "satellites"]), ["media", "satellites"] as RollupId[]);
  });

  it("throws for a non-list value", () => {
    assert.throws(() => parseHideSections("media"), /list/);
    assert.throws(() => parseHideSections(42), /list/);
  });

  it("throws for an unknown section id", () => {
    assert.throws(() => parseHideSections(["media", "bogus"]), /Unknown/);
  });
});

describe("sectionHasEntities", () => {
  it("climate: present when climate has sensors, absent when empty", () => {
    assert.equal(sectionHasEntities("climate", { ...emptySections(), climate: ["sensor.temp"] }), true);
    assert.equal(sectionHasEntities("climate", emptySections()), false);
  });

  it("helpers: present when helpers OR selects non-empty, absent when both empty", () => {
    assert.equal(sectionHasEntities("helpers", { ...emptySections(), selects: ["input_select.s"] }), true);
    assert.equal(sectionHasEntities("helpers", { ...emptySections(), helpers: ["input_boolean.b"] }), true);
    assert.equal(sectionHasEntities("helpers", emptySections()), false);
  });

  it("covers every RollupId", () => {
    for (const id of ROLLUP_ORDER) {
      assert.equal(typeof sectionHasEntities(id, emptySections()), "boolean");
    }
  });
});

describe("withoutSections and hide_sections on button config", () => {
  it("clearing media and satellites removes those fields and leaves others intact", () => {
    const sections = {
      ...emptySections(),
      lights: ["light.a"],
      mediaPlayers: ["media_player.tv"],
      satellites: [{ entityId: "assist_satellite.kiosk" }],
    };
    const result = withoutSections(sections, ["media", "satellites"]);
    assert.deepEqual(result.mediaPlayers, []);
    assert.deepEqual(result.satellites, []);
    assert.deepEqual(result.lights, ["light.a"]);
  });

  it("clearing helpers removes both helpers and selects", () => {
    const sections = {
      ...emptySections(),
      helpers: ["input_boolean.g"],
      selects: ["input_select.s"],
    };
    const result = withoutSections(sections, ["helpers"]);
    assert.deepEqual(result.helpers, []);
    assert.deepEqual(result.selects, []);
  });

  it("clearing lights also removes lightLeds", () => {
    const sections = {
      ...emptySections(),
      lights: ["light.a"],
      lightLeds: { "light.a": "switch.a_led" },
    };
    const result = withoutSections(sections, ["lights"]);
    assert.deepEqual(result.lights, []);
    assert.deepEqual(result.lightLeds, {});
  });

  it("hiding media and satellites produces a shorter dot row with correct classes", () => {
    const hide: RollupId[] = ["media", "satellites"];
    const sections = {
      ...emptySections(),
      lights: ["light.a"],
      mediaPlayers: ["media_player.tv"],
    };
    const states = {
      "light.a": state("light.a", "on"),
      "media_player.tv": state("media_player.tv", "playing"),
    };
    const visibleSections = withoutSections(sections, hide);
    const dotSlots = collapsedDotSlots(hide);
    const config = buildButtonConfig({
      areaId: "room",
      name: "Room",
      icon: "mdi:home",
      sections: visibleSections,
      states,
      dotSlots,
    });
    const dots = config.sub_button as Array<Record<string, unknown>>;
    assert.equal(dots.length, dotSlots.length);
    assert.ok(!dots.some((d) => String(d.css_class).includes("media")));
    assert.ok(!dots.some((d) => String(d.css_class).includes("satellites")));
    assert.ok(!dots.some((d) => String(d.css_class).includes("climate")));
    assert.ok(dots.some((d) => String(d.css_class).includes("lights-on")));
    const classes = dots.map((d) => String(d.css_class));
    const expectedOrder = dotSlots.map((id) =>
      id === "lights" ? "area-dot-lights-on" : `area-dot-${id}-empty`,
    );
    assert.deepEqual(classes, expectedOrder);
  });

  it("popup omits hidden sections and their Status chips", () => {
    const hide: RollupId[] = ["media", "satellites"];
    const sections = {
      ...emptySections(),
      lights: ["light.a"],
      mediaPlayers: ["media_player.tv"],
      satellites: [{ entityId: "assist_satellite.kiosk" }],
    };
    const states = {
      "light.a": state("light.a", "off"),
      "media_player.tv": state("media_player.tv", "playing"),
      "assist_satellite.kiosk": state("assist_satellite.kiosk", "idle"),
    };
    const visible = withoutSections(sections, hide);
    const cards = buildPopupCards(visible, states, "Room");
    const titles = cards.filter((c) => c.title).map((c) => c.title);
    assert.ok(titles.includes("Lights"), "Lights section should be present");
    assert.ok(!titles.includes("Media players"), "Media players section should be hidden");
    assert.ok(!titles.includes("Satellites"), "Satellites section should be hidden");
  });
});

describe("floor-wide section hiding", () => {
  it("hides sections absent on every area and keeps sections present on any area", () => {
    // area1 has lights + temp sensor; area2 has openings + selects (helpers)
    const sections1 = { ...emptySections(), lights: ["light.a"], climate: ["sensor.temp"] };
    const sections2 = { ...emptySections(), openings: ["binary_sensor.door"], selects: ["input_select.s"] };
    const all = [sections1, sections2];
    const hide = ROLLUP_ORDER.filter((id) => all.every((s) => !sectionHasEntities(id, s)));
    // lights, openings, climate, helpers(selects) all have at least one area → not hidden
    assert.ok(!hide.includes("lights"), "lights present in area1");
    assert.ok(!hide.includes("openings"), "openings present in area2");
    assert.ok(!hide.includes("climate"), "climate present in area1 (temp sensor counts)");
    assert.ok(!hide.includes("helpers"), "helpers present in area2 (selects count)");
    // media, switches, occupancy, satellites, automations absent everywhere → hidden
    assert.ok(hide.includes("media"));
    assert.ok(hide.includes("switches"));
    assert.ok(hide.includes("occupancy"));
    assert.ok(hide.includes("satellites"));
    assert.ok(hide.includes("automations"));
  });

  it("hides all sections when areas list is empty (guarded by floor card)", () => {
    // computeFloorHide returns [] for empty areas; test the sectionHasEntities logic directly
    const noAreas: typeof emptySections[] = [];
    const hide = ROLLUP_ORDER.filter((id) => noAreas.every((s) => !sectionHasEntities(id, s())));
    // every() on empty array is vacuously true — all ids would be hidden
    // The floor card guards against this by returning [] when areas.length === 0
    assert.equal(hide.length, ROLLUP_ORDER.length);
  });
});

describe("area pictures", () => {
  const picture = 'https://ha.local/api/image/serve/abc")def';

  it("resolves a picture through hassUrl and leaves a path alone otherwise", () => {
    const withUrl = areaDisplay(
      {
        areas: { kitchen: { name: "Kitchen", picture: "/api/image/serve/kitchen" } },
        hassUrl: (path) => `http://treetop:8123${path}`,
      },
      "kitchen",
    );
    assert.equal(withUrl.picture, "http://treetop:8123/api/image/serve/kitchen");
    const plain = areaDisplay(
      { areas: { kitchen: { name: "Kitchen", picture: "/api/image/serve/kitchen" } } },
      "kitchen",
    );
    assert.equal(plain.picture, "/api/image/serve/kitchen");
    assert.equal(areaDisplay({ areas: { kitchen: { name: "Kitchen" } } }, "kitchen").picture, null);
  });

  it("paints the picture on the button and the popup, and escapes quotes", () => {
    const button = buildButtonConfig({
      areaId: "kitchen",
      name: "Kitchen",
      icon: "mdi:pot-steam",
      sections: emptySections(),
      picture,
    });
    const popup = buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections(), {}, picture);
    const buttonStyles = String(button.styles);
    const popupStyles = String(popup.styles);
    const escaped = JSON.stringify(picture);
    assert.ok(buttonStyles.includes(`url(${escaped})`));
    assert.ok(popupStyles.includes(`url(${escaped})`));
    assert.match(buttonStyles, /\.bubble-background[\s\S]*background-image: linear-gradient\(90deg/);
    assert.match(popupStyles, /\.bubble-pop-up-background[\s\S]*linear-gradient\(to bottom/);
    assert.match(buttonStyles, /color:\s*#fff !important/);
    assert.match(popupStyles, /color:\s*#fff !important/);
    assert.match(buttonStyles, /\.bubble-state[^{]*\{[^}]*color:\s*#fff !important/);
    assert.match(buttonStyles, /\.bubble-state[^{]*\{[^}]*text-shadow:\s*0 1px 2px rgba\(0,0,0,\.65\)/);
    assert.match(
      popupStyles,
      /\.bubble-pop-up > \.bubble-header-container > \.bubble-header \.bubble-name,\n\.bubble-pop-up > \.bubble-header-container > \.bubble-header \.bubble-state \{[^}]*color:\s*#fff !important/,
    );
    assert.equal(popupStyles.includes("popup-style-classic"), false);
    assert.equal(popupStyles.includes("popup-style-home-assistant"), false);
    assert.equal(buttonStyles.includes('url("' + picture + '")'), false);
  });

  it("leaves both surfaces without a background image when the area has no picture", () => {
    const button = buildButtonConfig({
      areaId: "kitchen",
      name: "Kitchen",
      icon: "mdi:pot-steam",
      sections: emptySections(),
    });
    const popup = buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections());
    assert.equal(String(button.styles).includes("background-image"), false);
    assert.equal(/\.bubble-state[^{]*\{[^}]*#fff/.test(String(button.styles)), false);
    const popupStyles = String(popup.styles);
    assert.equal(popupStyles.includes("background-image"), false);
    assert.match(
      popupStyles,
      /\.bubble-header \.bubble-button-card-container \{[^}]*background:\s*none !important/,
    );
    assert.match(popupStyles, /\.bubble-header \.bubble-background,[\s\S]*display:\s*none !important/);
  });
});

describe("disabled automations", () => {
  it("splits the summary into off, on, and disabled and shows it on the subtitle", () => {
    const motion = "automation.motion";
    const bedtime = "automation.bedtime";
    const away = "automation.away";
    const sections = { ...emptySections(), automations: [motion, bedtime, away] };
    const states = {
      [motion]: state(motion, "on", { friendly_name: "Motion" }),
      [bedtime]: state(bedtime, "on", { friendly_name: "Bedtime" }),
      [away]: state(away, "off", { friendly_name: "Away" }),
    };
    const disabled = new Set([motion]);
    const rollups = sectionRollups(sections, states, disabled);
    assert.equal(rollupLabel(rollups[0]!), "Automations 1/2 on, 1 disabled");
    assert.equal(
      dotTooltipLabel("bubble-sub-button area-dot-automations-on", rollups),
      "Automations 1/2 on, 1 disabled",
    );
    const filled = buildButtonConfig({
      areaId: "bedroom",
      name: "Bedroom",
      icon: "mdi:bed",
      sections,
      states,
      disabledAutomations: disabled,
      dotSlots: collapsedDotSlots([]),
    });
    const filledDots = filled.sub_button as Array<{ css_class: string }>;
    assert.equal(filledDots.some((dot) => dot.css_class.includes("automations")), false);
    assert.deepEqual(automationSubtitleSegments(rollups[0]!), [
      { kind: "text", text: "1/2+" },
      { kind: "strike", text: "1" },
      { kind: "text", text: " " },
      { kind: "icon", icon: "mdi:flash" },
      { kind: "text", text: " on" },
    ]);
    assert.equal(automationIconName(), sectionIcon("automations"));
    assert.equal(filled.state_content, `{{ ${JSON.stringify(automationStateText(rollups[0]!))} }}`);
    assert.equal(String(filled.state_content).includes("Automations"), false);
    assert.equal(String(filled.state_content).includes("disabled"), false);

    const onlyDisabled = sectionRollups({ ...emptySections(), automations: [motion] }, states, disabled);
    assert.equal(rollupLabel(onlyDisabled[0]!), "Automations 1 disabled");
    assert.equal(onlyDisabled[0]?.active, 0);
    const onlyDisabledButton = buildButtonConfig({
      areaId: "bedroom",
      name: "Bedroom",
      icon: "mdi:bed",
      sections: { ...emptySections(), automations: [motion] },
      states,
      disabledAutomations: disabled,
      dotSlots: collapsedDotSlots([]),
    });
    const onlyDisabledDots = onlyDisabledButton.sub_button as Array<{ css_class: string }>;
    assert.equal(onlyDisabledDots.some((dot) => dot.css_class.includes("automations")), false);
    assert.deepEqual(automationSubtitleSegments(onlyDisabled[0]!), [
      { kind: "text", text: "0/0+" },
      { kind: "strike", text: "1" },
      { kind: "text", text: " " },
      { kind: "icon", icon: "mdi:flash" },
      { kind: "text", text: " on" },
    ]);
    assert.equal(onlyDisabledButton.state_content, `{{ ${JSON.stringify(automationStateText(onlyDisabled[0]!))} }}`);

    const offAndDead = sectionRollups(
      { ...emptySections(), automations: [away] },
      states,
      new Set([away]),
    );
    assert.equal(rollupLabel(offAndDead[0]!), "Automations 1 disabled");

    const cards = buildPopupCards(sections, states, "Bedroom", disabled);
    const row = cards.find((card) => card.entity === motion);
    const live = cards.find((card) => card.entity === bedtime);
    assert.equal(row?.secondary, "Disabled");
    assert.equal(row?.icon, "mdi:flash-off");
    assert.equal(row?.icon_color, "grey");
    assert.equal((row?.hold_action as { perform_action?: string }).perform_action, "automation.toggle");
    assert.equal(String(live?.secondary).includes("last_triggered"), true);
    assert.equal(String(live?.icon_color).includes("green"), true);
    const chips = cards.find((card) => String(card.type).endsWith("chips-card"));
    const contents = (chips?.chips as Array<{ content: string }>).map((chip) => chip.content);
    assert.deepEqual(contents, ["Automations 1/2 on, 1 disabled"]);
  });

  it("keeps a zero on-count in the fraction and leaves disabled out of that total", () => {
    const on = "automation.on";
    const offA = "automation.off_a";
    const offB = "automation.off_b";
    const offC = "automation.off_c";
    const deadA = "automation.dead_a";
    const deadB = "automation.dead_b";
    const deadC = "automation.dead_c";

    const allOff = sectionRollups(
      { ...emptySections(), automations: [offA, offB, offC] },
      {
        [offA]: state(offA, "off"),
        [offB]: state(offB, "off"),
        [offC]: state(offC, "off"),
      },
    );
    assert.equal(rollupLabel(allOff[0]!), "Automations 0/3 on, 0 disabled");
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-automations-off", allOff), "Automations 0/3 on, 0 disabled");
    assert.deepEqual(automationSubtitleSegments(allOff[0]!), [
      { kind: "text", text: "0/3 " },
      { kind: "icon", icon: "mdi:flash" },
      { kind: "text", text: " on" },
    ]);

    const offAndDisabled = sectionRollups(
      { ...emptySections(), automations: [offA, offB, deadA] },
      {
        [offA]: state(offA, "off"),
        [offB]: state(offB, "off"),
        [deadA]: state(deadA, "on"),
      },
      new Set([deadA]),
    );
    assert.equal(rollupLabel(offAndDisabled[0]!), "Automations 0/2 on, 1 disabled");
    assert.equal(offAndDisabled[0]?.active, 0);
    assert.equal(offAndDisabled[0]?.off, 2);
    assert.equal(offAndDisabled[0]?.disabled, 1);

    const disabledNotInTotal = sectionRollups(
      { ...emptySections(), automations: [on, offA, deadA, deadB, deadC] },
      {
        [on]: state(on, "on"),
        [offA]: state(offA, "off"),
        [deadA]: state(deadA, "on"),
        [deadB]: state(deadB, "off"),
        [deadC]: state(deadC, "on"),
      },
      new Set([deadA, deadB, deadC]),
    );
    assert.equal(rollupLabel(disabledNotInTotal[0]!), "Automations 1/2 on, 3 disabled");
    assert.deepEqual(automationSubtitleSegments(disabledNotInTotal[0]!), [
      { kind: "text", text: "1/2+" },
      { kind: "strike", text: "3" },
      { kind: "text", text: " " },
      { kind: "icon", icon: "mdi:flash" },
      { kind: "text", text: " on" },
    ]);
    assert.equal(disabledNotInTotal[0]?.active, 1);
    assert.equal(disabledNotInTotal[0]?.off, 1);
    assert.equal(disabledNotInTotal[0]?.disabled, 3);
    assert.equal(dotTooltipLabel("bubble-sub-button area-dot-automations-empty", disabledNotInTotal), null);
  });

  it("does not let a disabled automation keep the area available", () => {
    const fixture = hass({
      devices: [{ id: "shed-dev", area_id: "shed" }],
      entities: [
        { entity_id: "light.shed", device_id: "shed-dev" },
        { entity_id: "automation.shed_lights", device_id: "shed-dev" },
      ],
      states: {
        "light.shed": state("light.shed", "unavailable"),
        "automation.shed_lights": state("automation.shed_lights", "on"),
      },
    });
    assert.equal(areaUnavailable(fixture, "shed"), false);
    assert.equal(areaUnavailable(fixture, "shed", new Set(["automation.shed_lights"])), true);

    const onlyAutomation = hass({
      devices: [{ id: "shed-dev", area_id: "shed" }],
      entities: [{ entity_id: "automation.shed_lights", device_id: "shed-dev" }],
      states: { "automation.shed_lights": state("automation.shed_lights", "on") },
    });
    assert.equal(areaUnavailable(onlyAutomation, "shed"), false);
    assert.equal(areaUnavailable(onlyAutomation, "shed", new Set(["automation.shed_lights"])), true);
  });
});

describe("areaUnavailable", () => {
  it("marks an area unavailable when every device entity is unavailable", () => {
    const result = areaUnavailable(
      hass({
        devices: [{ id: "shed-dev", area_id: "shed" }],
        entities: [
          { entity_id: "light.shed", device_id: "shed-dev" },
          { entity_id: "binary_sensor.shed_door", device_id: "shed-dev" },
          { entity_id: "input_boolean.shed_guest", area_id: "shed" },
          { entity_id: "sensor.shed_note", area_id: "shed", platform: "template" },
        ],
        states: {
          "light.shed": state("light.shed", "unavailable"),
          "binary_sensor.shed_door": state("binary_sensor.shed_door", "unavailable"),
          "input_boolean.shed_guest": state("input_boolean.shed_guest", "on"),
          "sensor.shed_note": state("sensor.shed_note", "on"),
        },
      }),
      "shed",
    );
    assert.equal(result, true);
  });

  it("stays available when one device entity is available", () => {
    const result = areaUnavailable(
      hass({
        devices: [{ id: "kitchen-dev", area_id: "kitchen" }],
        entities: [
          { entity_id: "light.kitchen", device_id: "kitchen-dev" },
          { entity_id: "sensor.kitchen_temp", device_id: "kitchen-dev" },
        ],
        states: {
          "light.kitchen": state("light.kitchen", "unavailable"),
          "sensor.kitchen_temp": state("sensor.kitchen_temp", "21"),
        },
      }),
      "kitchen",
    );
    assert.equal(result, false);
  });

  it("stays available when the area has no device entities", () => {
    const helpersOnly = areaUnavailable(
      hass({
        entities: [
          { entity_id: "input_boolean.guest", area_id: "hall" },
          { entity_id: "input_select.scene", area_id: "hall" },
          { entity_id: "timer.nap", area_id: "hall" },
          { entity_id: "sensor.note", area_id: "hall", platform: "template" },
        ],
        states: {
          "input_boolean.guest": state("input_boolean.guest", "unavailable"),
          "input_select.scene": state("input_select.scene", "unavailable"),
          "timer.nap": state("timer.nap", "unavailable"),
          "sensor.note": state("sensor.note", "unavailable"),
        },
      }),
      "hall",
    );
    assert.equal(helpersOnly, false);
    assert.equal(areaUnavailable(hass({}), "empty"), false);
  });

  it("dims the collapsed button and still lists the area on its floor", () => {
    const fixture = hass({
      devices: [{ id: "shed-dev", area_id: "shed" }],
      entities: [{ entity_id: "light.shed", device_id: "shed-dev" }],
      states: { "light.shed": state("light.shed", "unavailable") },
      areas: {
        shed: { area_id: "shed", name: "Shed", floor_id: "down" },
        kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "down" },
      },
    });
    assert.equal(areaUnavailable(fixture, "shed"), true);
    assert.deepEqual(
      areasOnFloor(fixture, "down").map((area) => area.areaId),
      ["kitchen", "shed"],
    );
    const button = buildButtonConfig({
      areaId: "shed",
      name: "Shed",
      icon: "mdi:greenhouse",
      sections: emptySections(),
      unavailable: true,
    });
    const styles = String(button.styles);
    assert.match(styles, /opacity:\s*0\.5 !important/);
    assert.match(styles, /cursor:\s*not-allowed/);
    assert.equal(button.card_type, "button");
    assert.equal(Array.isArray(button.sub_button), true);
  });

  it("shifts dots left by the floor chevron only when the card asks to align them", () => {
    const input = {
      areaId: "bedroom",
      name: "Bedroom",
      icon: "mdi:bed",
      sections: { ...emptySections(), lights: ["light.a"] },
      states: { "light.a": state("light.a", "on") },
    };
    assert.equal(String(buildButtonConfig(input).styles).includes("margin-inline-end: 36px"), false);
    assert.match(String(buildButtonConfig({ ...input, alignDots: true }).styles), /margin-inline-end: 36px !important/);
  });
});

describe("climate subtitle", () => {
  const room = "Man Cave";

  function button(
    sections: AreaSections,
    states: Record<string, EntityState | undefined>,
    extra: { formatEntityState?: (state: EntityState) => string } = {},
  ) {
    return buildButtonConfig({
      areaId: "office_of_drew",
      name: room,
      icon: "mdi:office-building",
      sections,
      states,
      dotSlots: collapsedDotSlots([]),
      ...extra,
    });
  }

  it("strips the room name from a temperature sensor and quotes the template", () => {
    const sections = { ...emptySections(), climate: ["sensor.temp"] };
    const states = {
      "sensor.temp": state("sensor.temp", "21", {
        device_class: "temperature",
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
    };
    assert.equal(climateSubtitle(sections.climate, states, room), "Temperature 21 °C");
    const config = button(sections, states);
    assert.equal(config.state_content, '{{ "Temperature 21 °C" }}');
    assert.equal(config.button_type, "name");
    assert.equal(config.entity, undefined);
    assert.equal(config.show_state, undefined);
    const styles = String(config.styles);
    assert.match(styles, /\.bubble-state[^{]*\{[^}]*text-overflow:\s*ellipsis/);
    assert.equal(/\.bubble-state[^{]*\{[^}]*display:[^;}]*!important/.test(styles), false);
  });

  it("joins humidity and temperature in friendly-name order with the fallback formatter", () => {
    assert.equal(
      climateSubtitle(
        ["sensor.humidity"],
        {
          "sensor.humidity": state("sensor.humidity", "40", {
            device_class: "humidity",
            friendly_name: "Man Cave Humidity",
            unit_of_measurement: "%",
          }),
        },
        room,
      ),
      "Humidity 40 %",
    );

    const fixtureStates = {
      "sensor.office_temperature": state("sensor.office_temperature", "21", {
        device_class: "temperature",
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "sensor.office_humidity": state("sensor.office_humidity", "40", {
        device_class: "humidity",
        friendly_name: "Man Cave Humidity",
        unit_of_measurement: "%",
      }),
    };
    const classified = classifyArea(
      hass({
        areas: { office_of_drew: { name: room } },
        entities: [
          { entity_id: "sensor.office_temperature", area_id: "office_of_drew" },
          { entity_id: "sensor.office_humidity", area_id: "office_of_drew" },
        ],
        states: fixtureStates,
      }),
      "office_of_drew",
    );
    assert.deepEqual(classified.climate, ["sensor.office_humidity", "sensor.office_temperature"]);
    assert.equal(
      climateSubtitle(classified.climate, fixtureStates, room),
      "Humidity 40 % · Temperature 21 °C",
    );
  });

  it("keeps unavailable and unknown and does not append a unit", () => {
    assert.equal(
      climateSubtitle(
        ["sensor.temp"],
        {
          "sensor.temp": state("sensor.temp", "unavailable", {
            friendly_name: "Man Cave Temperature",
            unit_of_measurement: "°C",
          }),
        },
        room,
      ),
      "Temperature unavailable",
    );
    assert.equal(
      climateSubtitle(
        ["sensor.temp"],
        {
          "sensor.temp": state("sensor.temp", "unknown", {
            friendly_name: "Man Cave Temperature",
            unit_of_measurement: "°C",
          }),
        },
        room,
      ),
      "Temperature unknown",
    );
  });

  it("uses the value alone when the sensor has no friendly name", () => {
    assert.equal(
      climateSubtitle(
        ["sensor.temp"],
        { "sensor.temp": state("sensor.temp", "21", { unit_of_measurement: "°C" }) },
        room,
      ),
      "21 °C",
    );
  });

  it("skips a missing state object", () => {
    assert.equal(
      climateSubtitle(
        ["sensor.missing", "sensor.temp"],
        {
          "sensor.temp": state("sensor.temp", "21", {
            friendly_name: "Man Cave Temperature",
            unit_of_measurement: "°C",
          }),
        },
        room,
      ),
      "Temperature 21 °C",
    );
  });

  it("skips an empty formatted value and omits state_content when nothing remains", () => {
    const states = {
      "sensor.temp": state("sensor.temp", "21", {
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "sensor.humidity": state("sensor.humidity", "40", {
        friendly_name: "Man Cave Humidity",
        unit_of_measurement: "%",
      }),
    };
    const formatEntityState = (entity: EntityState) =>
      entity.entity_id === "sensor.temp" ? "" : `fmt ${entity.state}`;
    assert.equal(
      climateSubtitle(["sensor.humidity", "sensor.temp"], states, room, formatEntityState),
      "Humidity fmt 40",
    );
    assert.equal(
      climateSubtitle(["sensor.temp"], states, room, (entity) => `fmt ${entity.state}`),
      "Temperature fmt 21",
    );
    const config = button({ ...emptySections(), climate: ["sensor.temp"] }, states, {
      formatEntityState: () => "",
    });
    assert.equal("state_content" in config, false);
    assert.equal("state_content" in button(emptySections(), {}), false);
  });

  it("drops the subtitle and the climate dot when climate is hidden", () => {
    const hide: RollupId[] = ["climate"];
    const sections = {
      ...emptySections(),
      climate: ["sensor.temp"],
      lights: ["light.desk"],
    };
    const states = {
      "sensor.temp": state("sensor.temp", "21", {
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "light.desk": state("light.desk", "on"),
    };
    const config = buildButtonConfig({
      areaId: "office_of_drew",
      name: room,
      icon: "mdi:office-building",
      sections: withoutSections(sections, hide),
      states,
      dotSlots: collapsedDotSlots(hide),
    });
    assert.equal("state_content" in config, false);
    const dots = config.sub_button as Array<{ css_class: string }>;
    assert.equal(dots.some((dot) => dot.css_class.includes("climate")), false);
    assert.equal(dots[0]?.css_class, "area-dot-lights-on");
  });

  it("leaves climate domain thermostats out of the climate section", () => {
    const result = classifyArea(
      hass({
        entities: [{ entity_id: "climate.office", area_id: "office_of_drew" }],
        states: {
          "climate.office": state("climate.office", "heat", { friendly_name: "Man Cave" }),
        },
      }),
      "office_of_drew",
    );
    assert.deepEqual(result.climate, []);
  });

  it("keeps both temperature sensors in climate section order", () => {
    const states = {
      "sensor.east": state("sensor.east", "18", {
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "sensor.west": state("sensor.west", "21", {
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
    };
    assert.equal(
      climateSubtitle(["sensor.west", "sensor.east"], states, room),
      "Temperature 21 °C · Temperature 18 °C",
    );
  });

  it("escapes quotes and backslashes in the state template", () => {
    const states = {
      "sensor.temp": state("sensor.temp", "21", {
        friendly_name: 'Man Cave Temp "C" \\',
        unit_of_measurement: "°C",
      }),
    };
    assert.equal(climateSubtitle(["sensor.temp"], states, room), 'Temp "C" \\ 21 °C');
    const config = button({ ...emptySections(), climate: ["sensor.temp"] }, states);
    assert.equal(config.state_content, '{{ "Temp \\"C\\" \\\\ 21 °C" }}');
  });

  it("drops climate and automations from collapsed dots and still drops a hidden id", () => {
    assert.equal(collapsedDotSlots([])[0], "lights");
    assert.equal(collapsedDotSlots([]).includes("climate"), false);
    assert.equal(collapsedDotSlots([]).includes("automations"), false);
    assert.equal(ROLLUP_ORDER.includes("climate"), true);
    assert.equal(ROLLUP_ORDER.includes("automations"), true);
    assert.deepEqual(collapsedDotSlots(["media"]), [
      "lights",
      "switches",
      "occupancy",
      "openings",
      "satellites",
      "helpers",
    ]);
  });

  it("shows the automation summary alone when the room has no climate", () => {
    const sections = { ...emptySections(), automations: ["automation.a"] };
    const states = { "automation.a": state("automation.a", "on") };
    const config = button(sections, states);
    const alone = sectionRollups(sections, states)[0]!;
    assert.deepEqual(automationSubtitleSegments(alone), [
      { kind: "text", text: "1/1 " },
      { kind: "icon", icon: "mdi:flash" },
      { kind: "text", text: " on" },
    ]);
    assert.equal(String(automationStateText(alone)).includes("+0"), false);
    assert.equal(config.state_content, `{{ ${JSON.stringify(automationStateText(alone))} }}`);
    assert.equal(config.button_type, "name");
    assert.equal(config.entity, undefined);
    assert.equal(config.show_state, undefined);
    const dots = config.sub_button as Array<{ css_class: string }>;
    assert.equal(dots.some((dot) => dot.css_class.includes("automations")), false);
  });

  it("joins climate and the automation summary on one subtitle", () => {
    const states = {
      "sensor.office_humidity": state("sensor.office_humidity", "40", {
        device_class: "humidity",
        friendly_name: "Man Cave Humidity",
        unit_of_measurement: "%",
      }),
      "sensor.office_temperature": state("sensor.office_temperature", "21", {
        device_class: "temperature",
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "automation.a": state("automation.a", "on"),
      "automation.b": state("automation.b", "on"),
      "automation.c": state("automation.c", "off"),
    };
    const sections = {
      ...emptySections(),
      climate: ["sensor.office_humidity", "sensor.office_temperature"],
      automations: ["automation.a", "automation.b", "automation.c"],
    };
    const config = button(sections, states);
    const rollup = sectionRollups(sections, states).find((item) => item.id === "automations");
    assert.ok(rollup);
    assert.deepEqual(automationSubtitleSegments(rollup), [
      { kind: "text", text: "2/3 " },
      { kind: "icon", icon: automationIconName() },
      { kind: "text", text: " on" },
    ]);
    assert.equal(automationIconName(), "mdi:flash");
    assert.equal(String(automationStateText(rollup)).includes("+0"), false);
    assert.equal(
      config.state_content,
      `{{ ${JSON.stringify(`Humidity 40 % · Temperature 21 °C · ${automationStateText(rollup)}`)} }}`,
    );
  });

  it("omits the automation piece when automations are hidden and keeps climate", () => {
    const hide: RollupId[] = ["automations"];
    const sections = {
      ...emptySections(),
      climate: ["sensor.temp"],
      automations: ["automation.a"],
      lights: ["light.desk"],
    };
    const states = {
      "sensor.temp": state("sensor.temp", "21", {
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "automation.a": state("automation.a", "on"),
      "light.desk": state("light.desk", "on"),
    };
    const visible = withoutSections(sections, hide);
    const config = buildButtonConfig({
      areaId: "office_of_drew",
      name: room,
      icon: "mdi:office-building",
      sections: visible,
      states,
      dotSlots: collapsedDotSlots(hide),
    });
    assert.equal(config.state_content, '{{ "Temperature 21 °C" }}');
    const titles = buildPopupCards(visible, states, room)
      .filter((card) => card.title)
      .map((card) => card.title);
    assert.equal(titles.includes("Automations"), false);
    assert.equal(titles.includes("Climate"), true);
  });

  it("omits only climate when climate is hidden and keeps the automation summary", () => {
    const hide: RollupId[] = ["climate"];
    const sections = {
      ...emptySections(),
      climate: ["sensor.temp"],
      automations: ["automation.a", "automation.b"],
    };
    const states = {
      "sensor.temp": state("sensor.temp", "21", {
        friendly_name: "Man Cave Temperature",
        unit_of_measurement: "°C",
      }),
      "automation.a": state("automation.a", "on"),
      "automation.b": state("automation.b", "off"),
    };
    const visible = withoutSections(sections, hide);
    const config = buildButtonConfig({
      areaId: "office_of_drew",
      name: room,
      icon: "mdi:office-building",
      sections: visible,
      states,
      dotSlots: collapsedDotSlots(hide),
    });
    const rollup = sectionRollups(visible, states).find((item) => item.id === "automations");
    assert.ok(rollup);
    assert.deepEqual(automationSubtitleSegments(rollup), [
      { kind: "text", text: "1/2 " },
      { kind: "icon", icon: "mdi:flash" },
      { kind: "text", text: " on" },
    ]);
    assert.equal(config.state_content, `{{ ${JSON.stringify(automationStateText(rollup))} }}`);
    const titles = buildPopupCards(visible, states, room)
      .filter((card) => card.title)
      .map((card) => card.title);
    assert.equal(titles.includes("Climate"), false);
    assert.equal(titles.includes("Automations"), true);
    const dots = config.sub_button as Array<{ css_class: string }>;
    assert.equal(dots.some((dot) => dot.css_class.includes("automations")), false);
    assert.equal(dots.some((dot) => dot.css_class.includes("climate")), false);
  });

  it("places a flash icon and strikes only the disabled count", () => {
    const struck = placeHost(`1/2+\u20613\u2062 \u2063 on`);
    assert.equal(placeAutomationSubtitle(struck as unknown as HTMLElement), true);
    assert.deepEqual(
      struck.kids.map((node) => [node.tag, node.textContent, node.attrs.icon, node.styleMap["text-decoration"]]),
      [
        ["#text", "1/2+", undefined, undefined],
        ["s", "3", undefined, "line-through"],
        ["#text", " ", undefined, undefined],
        ["ha-icon", "", "mdi:flash", undefined],
        ["#text", " on", undefined, undefined],
      ],
    );
    assert.equal(struck.kids[1]?.className, "area-card-automation-disabled");
    assert.equal(struck.kids[3]?.className, "area-card-automation-icon");
    assert.equal(struck.kids[3]?.styleMap["--mdc-icon-size"], "12px");
    assert.equal(placeAutomationSubtitle(struck as unknown as HTMLElement), false);
    assert.equal(struck.replacements, 1);

    const plain = placeHost("2/3 \u2063 on");
    assert.equal(placeAutomationSubtitle(plain as unknown as HTMLElement), true);
    assert.equal(plain.kids.some((node) => node.tag === "s"), false);
    assert.equal(plain.kids.find((node) => node.tag === "ha-icon")?.attrs.icon, "mdi:flash");
    assert.equal(placeAutomationSubtitle(plain as unknown as HTMLElement), false);
  });

  it("omits state_content when the room has neither climate nor automations", () => {
    assert.equal("state_content" in button(emptySections(), {}), false);
    assert.equal(
      "state_content" in button({ ...emptySections(), lights: ["light.desk"] }, { "light.desk": state("light.desk", "on") }),
      false,
    );
  });

  it("leaves the floor header without a climate or automations slot", () => {
    const sections = { ...emptySections(), climate: ["sensor.temp"], automations: ["automation.a"] };
    const hide = ROLLUP_ORDER.filter((id) => !sectionHasEntities(id, sections));
    assert.equal(hide.includes("climate"), false);
    assert.equal(hide.includes("automations"), false);
    const slots = collapsedDotSlots(hide);
    assert.equal(slots.includes("climate"), false);
    assert.equal(slots.includes("automations"), false);
    assert.deepEqual(slots, []);
  });
});

describe("floor dot rollup", () => {
  it("fills a slot when any area is active and adds the counts", () => {
    const on = sectionRollups(
      { ...emptySections(), lights: ["light.a", "light.b"] },
      { "light.a": state("light.a", "on"), "light.b": state("light.b", "off") },
    );
    const off = sectionRollups(
      { ...emptySections(), lights: ["light.c"], openings: ["binary_sensor.door"] },
      { "light.c": state("light.c", "off"), "binary_sensor.door": state("binary_sensor.door", "on") },
    );
    const dots = floorDotRow(["lights", "openings", "media"], [on, off]);
    assert.deepEqual(
      dots.map((dot) => [dot.id, dot.state, dot.label]),
      [
        ["lights", "on", "Lights 1/3 On"],
        ["openings", "on", "Entries 1/1 Open"],
        ["media", "empty", null],
      ],
    );
    assert.equal(dots[0]?.background, "rgb(255, 193, 7)");
    assert.equal(dots[0]?.ring, null);
    assert.equal(dots[2]?.icon, "mdi:play-circle");
  });

  it("keeps a hollow dot when the section is present and nothing is active", () => {
    const idle = sectionRollups(
      { ...emptySections(), lights: ["light.a"] },
      { "light.a": state("light.a", "off") },
    );
    const [dot] = floorDotRow(["lights"], [idle]);
    assert.equal(dot?.state, "off");
    assert.equal(dot?.label, "Lights 0/1 On");
    assert.equal(dot?.background, "transparent");
    assert.equal(dot?.ring, "rgb(255, 193, 7)");
    assert.equal(dot?.color, "rgb(255, 193, 7)");
  });

  it("adds automation off, on, and disabled counts across areas", () => {
    const first = sectionRollups(
      { ...emptySections(), automations: ["automation.a", "automation.b"] },
      {
        "automation.a": state("automation.a", "on"),
        "automation.b": state("automation.b", "off"),
      },
      new Set(["automation.b"]),
    );
    const second = sectionRollups(
      { ...emptySections(), automations: ["automation.c"] },
      { "automation.c": state("automation.c", "off") },
    );
    const [dot] = floorDotRow(["automations"], [first, second]);
    assert.equal(dot?.state, "on");
    assert.equal(dot?.label, "Automations 1/2 on, 1 disabled");
  });

  it("leaves a slot empty when the section has entities but does not draw a dot", () => {
    const sensors = sectionRollups(
      { ...emptySections(), climate: ["sensor.temp"], selects: ["input_select.scene"] },
      {
        "sensor.temp": state("sensor.temp", "21", { device_class: "temperature" }),
        "input_select.scene": state("input_select.scene", "movie"),
      },
    );
    const dots = floorDotRow(["climate", "helpers"], [sensors]);
    assert.deepEqual(
      dots.map((dot) => dot.state),
      ["empty", "empty"],
    );
  });
});

describe("floor expanded storage", () => {
  it("keys each floor separately", () => {
    assert.equal(floorExpandedKey("upstairs"), "area-card-floor-expanded:upstairs");
    assert.equal(floorExpandedKey("downstairs"), "area-card-floor-expanded:downstairs");
    assert.equal(floorExpandedKey("cabin"), "area-card-floor-expanded:cabin");
  });

  it("tells Bubble the floor is a shared stack so a room popup does not hide it", () => {
    assert.deepEqual(floorRuntimeConfig("upstairs"), {
      floor: "upstairs",
      type: "custom:vertical-stack-in-card",
    });
  });

  it("parses stored booleans and uses expanded when the value is missing", () => {
    assert.equal(parseFloorExpanded("true"), true);
    assert.equal(parseFloorExpanded("false"), false);
    assert.equal(parseFloorExpanded(null), true);
    assert.equal(parseFloorExpanded(undefined), true);
    assert.equal(parseFloorExpanded(""), true);
    assert.equal(parseFloorExpanded("yes"), true);
    assert.equal(parseFloorExpanded(null, false), false);
  });
});
