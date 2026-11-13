import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPopupCards, type PopupLayout } from "../src/popup-cards";
import { estimateLineWidth, fitsHalfRow, halfRowTextWidth } from "../src/row-width";
import { emptySections, type EntityState } from "../src/sections";

const measure = estimateLineWidth;

function state(entityId: string, value: string, attributes: Record<string, unknown> = {}): EntityState {
  return { entity_id: entityId, state: value, attributes };
}

function layout(viewportWidth: number, extra: Partial<PopupLayout> = {}): PopupLayout {
  return { viewportWidth, measure, ...extra };
}

function columns(cards: Record<string, unknown>[], entity: string): number | undefined {
  const card = cards.find((item) => item.entity === entity || item.led_entity === entity);
  const grid = card?.grid_options as { columns?: number } | undefined;
  return grid?.columns;
}

describe("half-row text width", () => {
  it("uses the 540px desktop popup from 600px up", () => {
    assert.equal(halfRowTextWidth(800), 182);
    assert.equal(halfRowTextWidth(1200, true), 160);
  });

  it("uses the viewport below 600px and keeps the clipped right edge clear", () => {
    assert.equal(halfRowTextWidth(390), 100);
    assert.equal(halfRowTextWidth(390, true), 78);
  });

  it("rejects an unknown title and a line wider than the half row", () => {
    assert.equal(fitsHalfRow("Lamp", ["Unavailable"], 1200, { measure }), true);
    assert.equal(fitsHalfRow("{{ state_attr('light.a', 'friendly_name') }}", ["Unavailable"], 1200, { measure }), false);
    assert.equal(fitsHalfRow("Occupied · Turn on Lights", ["Unavailable"], 1200, { measure }), false);
    assert.equal(fitsHalfRow("Lamp", ["Unavailable"], 390, { led: true, measure }), false);
  });
});

describe("popup row width", () => {
  it("puts two short lights on one row and keeps headings, chips, and media full width", () => {
    const cards = buildPopupCards(
      {
        ...emptySections(),
        lights: ["light.lamp", "light.desk"],
        mediaPlayers: ["media_player.tv"],
      },
      {
        "light.lamp": state("light.lamp", "on", { friendly_name: "Lamp", supported_color_modes: ["onoff"] }),
        "light.desk": state("light.desk", "off", { friendly_name: "Desk", supported_color_modes: ["brightness"] }),
        "media_player.tv": state("media_player.tv", "off", { friendly_name: "TV" }),
      },
      "Room",
      new Set(),
      layout(1200),
    );
    assert.equal(columns(cards, "light.lamp"), 6);
    assert.equal(columns(cards, "light.desk"), 6);
    assert.equal(columns(cards, "media_player.tv"), 12);
    assert.equal(cards.find((card) => card.title === "Lights")?.grid_options && (cards.find((card) => card.title === "Lights")?.grid_options as { columns: number }).columns, 12);
    const chips = cards.find((card) => String(card.type).endsWith("chips-card"));
    assert.deepEqual(chips?.grid_options, { columns: 12 });
  });

  it("keeps a long title, a missing name, and a phone LED light on their own row", () => {
    const long = "light.long";
    const missing = "light.missing";
    const led = "switch.lamp_led";
    const wide = buildPopupCards(
      { ...emptySections(), lights: [long, missing, "light.lamp"], lightLeds: { "light.lamp": led } },
      {
        [long]: state(long, "on", { friendly_name: "Occupied · Turn on Lights", supported_color_modes: ["onoff"] }),
        [missing]: state(missing, "on", { supported_color_modes: ["onoff"] }),
        "light.lamp": state("light.lamp", "off", { friendly_name: "Lamp", supported_color_modes: ["onoff"] }),
        [led]: state(led, "on"),
      },
      "Room",
      new Set(),
      layout(1200),
    );
    assert.equal(columns(wide, long), 12);
    assert.equal(columns(wide, missing), 12);
    assert.equal(columns(wide, led), 6);

    const phone = buildPopupCards(
      { ...emptySections(), lights: ["light.lamp"], lightLeds: { "light.lamp": led } },
      {
        "light.lamp": state("light.lamp", "off", { friendly_name: "Lamp", supported_color_modes: ["onoff"] }),
        [led]: state(led, "on"),
      },
      "Room",
      new Set(),
      layout(390),
    );
    assert.equal(columns(phone, led), 12);
  });

  it("sizes mushroom cards from the formatted state and template lights from Unavailable", () => {
    const formatEntityState = (_state: EntityState, sample?: string) =>
      sample === "unavailable" ? "Nicht verfügbar heute Abend" : "On";
    const cards = buildPopupCards(
      { ...emptySections(), lights: ["light.dim", "light.plain"] },
      {
        "light.dim": state("light.dim", "on", { friendly_name: "Lamp", supported_color_modes: ["brightness"] }),
        "light.plain": state("light.plain", "on", { friendly_name: "Lamp", supported_color_modes: ["onoff"] }),
      },
      "Room",
      new Set(),
      layout(1200, { formatEntityState }),
    );
    assert.equal(columns(cards, "light.dim"), 12);
    assert.equal(columns(cards, "light.plain"), 6);
  });

  it("keeps a long select option, satellite line, or pressure reading full width", () => {
    const cards = buildPopupCards(
      {
        ...emptySections(),
        selects: ["input_select.mode", "input_select.away"],
        satellites: [{ entityId: "assist_satellite.kiosk", ledEntityId: "light.led", alarmEntityId: "binary_sensor.alarm" }],
        occupancy: [{ entityId: "binary_sensor.bed", pressureEntityId: "sensor.pressure" }],
        switches: ["switch.fan"],
      },
      {
        "input_select.mode": state("input_select.mode", "Low", { friendly_name: "Mode", options: ["Low", "High"] }),
        "input_select.away": state("input_select.away", "home", {
          friendly_name: "Scene",
          options: ["Away for the whole summer holiday"],
        }),
        "assist_satellite.kiosk": state("assist_satellite.kiosk", "idle", { friendly_name: "Kiosk" }),
        "binary_sensor.bed": state("binary_sensor.bed", "on", { friendly_name: "Bed" }),
        "sensor.pressure": state("sensor.pressure", "1013.25", {
          unit_of_measurement: "millimeters of mercury",
        }),
        "switch.fan": state("switch.fan", "off", { friendly_name: "Fan" }),
      },
      "Room",
      new Set(),
      layout(1200),
    );
    assert.equal(columns(cards, "input_select.mode"), 6);
    assert.equal(columns(cards, "input_select.away"), 12);
    assert.equal(columns(cards, "assist_satellite.kiosk"), 12);
    assert.equal(columns(cards, "binary_sensor.bed"), 12);
    assert.equal(columns(cards, "switch.fan"), 6);
  });

  it("uses Never triggered for an enabled automation and Disabled for a disabled one", () => {
    const live = "automation.live";
    const dead = "automation.dead";
    const cards = buildPopupCards(
      { ...emptySections(), automations: [live, dead] },
      {
        [live]: state(live, "on", { friendly_name: "Bedtime" }),
        [dead]: state(dead, "off", { friendly_name: "Away" }),
      },
      "Room",
      new Set([dead]),
      layout(390),
    );
    assert.equal(columns(cards, live), 12);
    assert.equal(columns(cards, dead), 6);
  });
});
