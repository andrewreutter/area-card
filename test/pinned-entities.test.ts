import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PINNED_KEY_PREFIX,
  cyclePin,
  isDoubleTallPinnedCard,
  layoutPinnedCards,
  parseAreaPins,
  pinEntityId,
  pinMode,
  pinnedEdgeRadius,
  pinnedKey,
  pinnedRowsSideBySide,
  pinnedSideBySideGridStyles,
  pinnedSideBySideHostStyles,
  pinnedSideBySideStyles,
  selectPinnedCards,
  serializeAreaPins,
  type AreaPins,
  type PinnedLayoutRow,
} from "../src/pinned-entities";

describe("pinnedKey", () => {
  it("prefixes the area id", () => {
    assert.equal(PINNED_KEY_PREFIX, "area-card-pinned:");
    assert.equal(pinnedKey("kitchen"), "area-card-pinned:kitchen");
  });
});

const emptyPins = (): AreaPins => ({ always: [], whenOn: [] });

describe("parseAreaPins", () => {
  it("treats a legacy JSON array of entity ids as always", () => {
    assert.deepEqual(parseAreaPins('["light.a","switch.b"]'), {
      always: ["light.a", "switch.b"],
      whenOn: [],
    });
  });

  it("keeps non-empty strings and drops everything else that is not a pin", () => {
    assert.deepEqual(parseAreaPins('["light.a","",1,null,"switch.b",false,{"id":"","mode":"when-on"},{"mode":"when-on"},{"id":1,"mode":"when-on"},{"id":"light.c","mode":"hidden"}]'), {
      always: ["light.a", "switch.b"],
      whenOn: [],
    });
  });

  it("reads while-on objects and mode always objects", () => {
    assert.deepEqual(
      parseAreaPins('[{"id":"media_player.tv","mode":"when-on"},{"id":"light.desk","mode":"always"},"switch.lamp"]'),
      { always: ["light.desk", "switch.lamp"], whenOn: ["media_player.tv"] },
    );
  });

  it("lets the last entry win and keeps first-seen order in one list", () => {
    const raw = JSON.stringify([
      "light.a",
      { id: "light.b", mode: "when-on" },
      { id: "light.a", mode: "when-on" },
      "light.b",
      { id: "light.d", mode: "always" },
      { id: "switch.e", mode: "when-on" },
      { id: "switch.e", mode: "always" },
    ]);
    assert.deepEqual(parseAreaPins(raw), {
      always: ["light.b", "light.d", "switch.e"],
      whenOn: ["light.a"],
    });
  });

  it("returns empty pins for null, undefined, bad JSON, and non-arrays", () => {
    assert.deepEqual(parseAreaPins(null), emptyPins());
    assert.deepEqual(parseAreaPins(undefined), emptyPins());
    assert.deepEqual(parseAreaPins("{"), emptyPins());
    assert.deepEqual(parseAreaPins("not json"), emptyPins());
    assert.deepEqual(parseAreaPins('{"id":"light.a","mode":"when-on"}'), emptyPins());
    assert.deepEqual(parseAreaPins('"light.a"'), emptyPins());
    assert.deepEqual(parseAreaPins("null"), emptyPins());
    assert.deepEqual(parseAreaPins(1), emptyPins());
    assert.deepEqual(parseAreaPins({ id: "light.a", mode: "when-on" }), emptyPins());
  });

  it("accepts an already-parsed array", () => {
    assert.deepEqual(parseAreaPins(["light.desk", { id: "media_player.tv", mode: "when-on" }]), {
      always: ["light.desk"],
      whenOn: ["media_player.tv"],
    });
    assert.deepEqual(
      parseAreaPins([
        "light.a",
        { id: "light.a", mode: "when-on" },
        { id: "switch.b", mode: "always" },
      ]),
      { always: ["switch.b"], whenOn: ["light.a"] },
    );
  });
});

describe("serializeAreaPins", () => {
  it("uses strings only when every pin is always", () => {
    const cases: AreaPins[] = [
      { always: ["light.desk", "switch.lamp"], whenOn: [] },
      { always: ["light.desk"], whenOn: ["media_player.tv"] },
      { always: [], whenOn: ["media_player.tv"] },
      { always: [], whenOn: [] },
    ];
    assert.deepEqual(serializeAreaPins(cases[0]), ["light.desk", "switch.lamp"]);
    assert.deepEqual(serializeAreaPins(cases[1]), ["light.desk", { id: "media_player.tv", mode: "when-on" }]);
    assert.deepEqual(serializeAreaPins(cases[2]), [{ id: "media_player.tv", mode: "when-on" }]);
    assert.deepEqual(serializeAreaPins(cases[3]), []);
    for (const pins of cases) {
      const payload = serializeAreaPins(pins);
      assert.ok(Array.isArray(payload));
      assert.equal(typeof payload, "object");
    }
  });
});

describe("cyclePin", () => {
  it("cycles hidden to always, always to while on, and while on to hidden", () => {
    let pins: AreaPins = { always: ["switch.b"], whenOn: [] };
    pins = cyclePin(pins, "light.a");
    assert.deepEqual(pins, { always: ["switch.b", "light.a"], whenOn: [] });
    assert.equal(pinMode(pins, "light.a"), "always");
    pins = cyclePin(pins, "light.a");
    assert.deepEqual(pins, { always: ["switch.b"], whenOn: ["light.a"] });
    assert.equal(pinMode(pins, "light.a"), "when-on");
    pins = cyclePin(pins, "light.a");
    assert.deepEqual(pins, { always: ["switch.b"], whenOn: [] });
    assert.equal(pinMode(pins, "light.a"), "hidden");
  });

  it("appends a falling always pin after the current while-on ids", () => {
    assert.deepEqual(
      cyclePin({ always: ["light.a", "switch.b"], whenOn: ["media_player.tv"] }, "light.a"),
      { always: ["switch.b"], whenOn: ["media_player.tv", "light.a"] },
    );
  });

  it("drops every copy, then appends the id once", () => {
    const pins = { always: ["light.a", "switch.b", "light.a"], whenOn: ["light.a"] };
    assert.deepEqual(cyclePin(pins, "light.a"), { always: ["switch.b"], whenOn: ["light.a"] });
    assert.deepEqual(pins, { always: ["light.a", "switch.b", "light.a"], whenOn: ["light.a"] });
  });
});

describe("pinEntityId", () => {
  it("returns null for a section title", () => {
    assert.equal(pinEntityId({ type: "custom:area-card-section-title", title: "Lights", entity: "light.a" }), null);
  });

  it("returns null for a chips card", () => {
    assert.equal(pinEntityId({ type: "custom:area-card-mushroom-chips-card", entity: "sensor.status" }), null);
    assert.equal(pinEntityId({ type: "chips-card" }), null);
  });

  it("returns a plain entity", () => {
    assert.equal(pinEntityId({ type: "custom:area-card-mushroom-entity-card", entity: "sensor.temp" }), "sensor.temp");
  });

  it("returns a media-control entity", () => {
    assert.equal(pinEntityId({ type: "media-control", entity: "media_player.tv" }), "media_player.tv");
  });

  it("returns the inner entity of a light row", () => {
    assert.equal(
      pinEntityId({
        type: "custom:area-card-light-row",
        card: { type: "custom:area-card-mushroom-light-card", entity: "light.kitchen" },
      }),
      "light.kitchen",
    );
  });

  it("returns null for a light row without an entity", () => {
    assert.equal(pinEntityId({ type: "custom:area-card-light-row", entity: "light.kitchen" }), null);
    assert.equal(pinEntityId({ type: "custom:area-card-light-row", card: { type: "custom:area-card-mushroom-light-card" } }), null);
    assert.equal(pinEntityId({ type: "custom:area-card-light-row", card: { entity: "" } }), null);
    assert.equal(pinEntityId({ type: "custom:area-card-light-row", card: null }), null);
  });

  it("returns null when the entity is missing", () => {
    assert.equal(pinEntityId(null), null);
    assert.equal(pinEntityId(undefined), null);
    assert.equal(pinEntityId({ type: "entities" }), null);
    assert.equal(pinEntityId({ entity: "" }), null);
    assert.equal(pinEntityId({ entity: 1 }), null);
  });
});

describe("selectPinnedCards", () => {
  const title = { type: "custom:area-card-section-title", title: "Lights" };
  const chips = { type: "custom:area-card-mushroom-chips-card", chips: [] };
  const climate = { type: "custom:area-card-mushroom-entity-card", entity: "sensor.temp" };
  const light = {
    type: "custom:area-card-light-row",
    card: { type: "custom:area-card-mushroom-light-card", entity: "light.kitchen" },
  };
  const media = { type: "media-control", entity: "media_player.tv" };
  const cover = { type: "custom:area-card-mushroom-cover-card", entity: "cover.shade" };
  const lightAgain = {
    type: "custom:area-card-light-row",
    card: { entity: "light.kitchen" },
  };
  const cards = [title, chips, climate, light, media, cover, lightAgain];

  it("keeps pinned rows in popup order, including a light-row wrapper", () => {
    const selected = selectPinnedCards(cards, ["cover.shade", "light.kitchen", "sensor.temp"]);
    assert.deepEqual(selected, [climate, light, cover]);
    assert.equal(selected[0], climate);
    assert.equal(selected[1], light);
    assert.equal(selected[2], cover);
  });

  it("skips titles, chips, and ids that are not pinned", () => {
    assert.deepEqual(selectPinnedCards(cards, ["media_player.tv"]), [media]);
    assert.deepEqual(selectPinnedCards(cards, []), []);
  });

  it("drops a duplicate entity id", () => {
    const selected = selectPinnedCards(cards, ["light.kitchen"]);
    assert.deepEqual(selected, [light]);
    assert.equal(selected[0], light);
  });
});

function pinnedCard(entity: string, columns?: number): Record<string, unknown> {
  const config: Record<string, unknown> = {
    type: "custom:area-card-mushroom-entity-card",
    entity,
  };
  if (columns !== undefined) config.grid_options = { columns };
  return config;
}

function layoutWidths(rows: PinnedLayoutRow[]): string[][] {
  return rows.map((row) => row.cards.map((card) => card.width));
}

function layoutEntities(rows: PinnedLayoutRow[]): string[][] {
  return rows.map((row) => row.cards.map((card) => String(card.config.entity)));
}

describe("layoutPinnedCards", () => {
  it("pairs two half-width cards", () => {
    const first = pinnedCard("light.a", 6);
    const second = pinnedCard("light.b", 6);
    const rows = layoutPinnedCards([first, second]);
    assert.deepEqual(layoutWidths(rows), [["half", "half"]]);
    assert.equal(rows[0].cards[0].config, first);
    assert.equal(rows[0].cards[1].config, second);
    assert.deepEqual(first.grid_options, { columns: 6 });
    assert.deepEqual(second.grid_options, { columns: 6 });
  });

  it("expands a half when the next card is full width", () => {
    const half = pinnedCard("light.a", 6);
    const full = pinnedCard("media_player.tv", 12);
    const rows = layoutPinnedCards([half, full]);
    assert.deepEqual(layoutWidths(rows), [["expanded-full"], ["full"]]);
    assert.deepEqual(layoutEntities(rows), [["light.a"], ["media_player.tv"]]);
    assert.equal(rows[0].cards[0].config, half);
    assert.equal(rows[1].cards[0].config, full);
    assert.deepEqual(half.grid_options, { columns: 6 });
    assert.deepEqual(full.grid_options, { columns: 12 });
  });

  it("expands a trailing half-width card", () => {
    const half = pinnedCard("light.a", 6);
    const rows = layoutPinnedCards([half]);
    assert.deepEqual(layoutWidths(rows), [["expanded-full"]]);
    assert.equal(rows[0].cards[0].config, half);
    assert.deepEqual(half.grid_options, { columns: 6 });
  });

  it("pairs three halves into a pair plus an expanded one", () => {
    const cards = [pinnedCard("light.a", 6), pinnedCard("light.b", 6), pinnedCard("light.c", 6)];
    const rows = layoutPinnedCards(cards);
    assert.deepEqual(layoutWidths(rows), [["half", "half"], ["expanded-full"]]);
    assert.deepEqual(layoutEntities(rows), [["light.a", "light.b"], ["light.c"]]);
    for (const card of cards) assert.deepEqual(card.grid_options, { columns: 6 });
  });

  it("keeps full-width cards full and unpaired", () => {
    const media = pinnedCard("media_player.tv", 12);
    const climate = pinnedCard("climate.room");
    const rows = layoutPinnedCards([media, climate]);
    assert.deepEqual(layoutWidths(rows), [["full"], ["full"]]);
    assert.equal(rows[0].cards[0].config, media);
    assert.equal(rows[1].cards[0].config, climate);
    assert.deepEqual(media.grid_options, { columns: 12 });
    assert.equal(climate.grid_options, undefined);
  });

  it("preserves popup order when halves and full rows mix", () => {
    const cards = [
      pinnedCard("light.a", 6),
      pinnedCard("media_player.tv", 12),
      pinnedCard("light.b", 6),
      pinnedCard("switch.lamp", 6),
      pinnedCard("cover.shade", 12),
    ];
    const rows = layoutPinnedCards(cards);
    assert.deepEqual(layoutWidths(rows), [["expanded-full"], ["full"], ["half", "half"], ["full"]]);
    assert.deepEqual(layoutEntities(rows), [
      ["light.a"],
      ["media_player.tv"],
      ["light.b", "switch.lamp"],
      ["cover.shade"],
    ]);
    assert.deepEqual(
      rows.flatMap((row) => row.cards.map((card) => card.config)),
      cards,
    );
  });

  it("treats a non-numeric column count as full width", () => {
    const card = pinnedCard("sensor.temp", 6);
    (card.grid_options as { columns: unknown }).columns = "6";
    const rows = layoutPinnedCards([card, pinnedCard("light.a", 4)]);
    assert.deepEqual(layoutWidths(rows), [["full"], ["full"]]);
  });
});

describe("pinnedEdgeRadius", () => {
  it("squares the top and leaves a lone bottom card on its own radius", () => {
    const css = pinnedEdgeRadius({ first: true, last: true, left: true, right: true });
    assert.match(css, /border-top-left-radius:\s*0/);
    assert.match(css, /border-top-right-radius:\s*0/);
    assert.doesNotMatch(css, /border-bottom/);
    assert.doesNotMatch(css, /999px/);
    assert.doesNotMatch(css, /border-radius:/);
  });

  it("lets each card in a bottom pair keep its outer corner", () => {
    const left = pinnedEdgeRadius({ first: false, last: true, left: true, right: false });
    const right = pinnedEdgeRadius({ first: false, last: true, left: false, right: true });
    assert.match(left, /border-bottom-right-radius:\s*0/);
    assert.doesNotMatch(left, /border-bottom-left-radius/);
    assert.match(right, /border-bottom-left-radius:\s*0/);
    assert.doesNotMatch(right, /border-bottom-right-radius/);
    assert.doesNotMatch(left, /999px/);
    assert.doesNotMatch(right, /999px/);
  });

  it("squares every corner that meets another pinned card", () => {
    const middle = pinnedEdgeRadius({ first: false, last: false, left: true, right: true });
    assert.match(middle, /border-top-left-radius:\s*0/);
    assert.match(middle, /border-top-right-radius:\s*0/);
    assert.match(middle, /border-bottom-left-radius:\s*0/);
    assert.match(middle, /border-bottom-right-radius:\s*0/);
    const upperLeft = pinnedEdgeRadius({ first: true, last: false, left: true, right: false });
    assert.match(upperLeft, /border-bottom-left-radius:\s*0/);
    assert.match(upperLeft, /border-bottom-right-radius:\s*0/);
  });
});

function dimmable(entity: string, columns = 6): Record<string, unknown> {
  return {
    type: "custom:area-card-light-row",
    grid_options: { columns },
    card: {
      type: "custom:area-card-mushroom-light-card",
      entity,
      show_brightness_control: true,
      show_color_temp_control: true,
      show_color_control: true,
      collapsible_controls: true,
      grid_options: { columns },
    },
  };
}

describe("pinnedRowsSideBySide", () => {
  it("splits an expanded half-width double-tall light", () => {
    const light = dimmable("light.a");
    const rows = layoutPinnedCards([light]);
    assert.deepEqual(layoutWidths(rows), [["expanded-full"]]);
    assert.equal(rows[0].cards[0].config, light);
    assert.equal(isDoubleTallPinnedCard(light), true);
    assert.equal(pinnedRowsSideBySide(light, "expanded-full"), true);
    assert.deepEqual(light.grid_options, { columns: 6 });
    assert.deepEqual((light.card as { grid_options: unknown }).grid_options, { columns: 6 });
  });

  it("leaves a partnered half-width double-tall card stacked", () => {
    const first = dimmable("light.a");
    const second = dimmable("light.b");
    const rows = layoutPinnedCards([first, second]);
    assert.deepEqual(layoutWidths(rows), [["half", "half"]]);
    assert.equal(pinnedRowsSideBySide(first, "half"), false);
    assert.equal(pinnedRowsSideBySide(second, "half"), false);
    assert.equal(pinnedRowsSideBySide(first, rows[0].cards[0].width), false);
  });

  it("leaves a native full-width double-tall card stacked", () => {
    const light = dimmable("light.a", 12);
    const rows = layoutPinnedCards([light]);
    assert.deepEqual(layoutWidths(rows), [["full"]]);
    assert.equal(isDoubleTallPinnedCard(light), true);
    assert.equal(pinnedRowsSideBySide(light, "full"), false);
    assert.equal(pinnedRowsSideBySide(light, rows[0].cards[0].width), false);
  });

  it("expands a half-width single-row card without splitting it", () => {
    const card = pinnedCard("switch.lamp", 6);
    const rows = layoutPinnedCards([card]);
    assert.deepEqual(layoutWidths(rows), [["expanded-full"]]);
    assert.equal(isDoubleTallPinnedCard(card), false);
    assert.equal(pinnedRowsSideBySide(card, "expanded-full"), false);
    assert.equal(pinnedRowsSideBySide(card, rows[0].cards[0].width), false);
  });

  it("treats a light or cover control under the name as double-tall", () => {
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-mushroom-light-card",
        show_color_temp_control: true,
        grid_options: { columns: 6 },
      }),
      true,
    );
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-mushroom-cover-card",
        entity: "cover.shade",
        show_buttons_control: true,
        grid_options: { columns: 6 },
      }),
      true,
    );
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-mushroom-cover-card",
        show_position_control: true,
        grid_options: { columns: 6 },
      }),
      true,
    );
    const cover = {
      type: "custom:area-card-mushroom-cover-card",
      entity: "cover.shade",
      show_buttons_control: true,
      show_position_control: true,
      grid_options: { columns: 6 },
    };
    assert.equal(pinnedRowsSideBySide(cover, layoutPinnedCards([cover])[0].cards[0].width), true);
  });

  it("does not treat an on/off light, a cover without controls, or another tall card as double-tall", () => {
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-light-row",
        grid_options: { columns: 6 },
        card: {
          type: "custom:area-card-mushroom-template-card",
          entity: "light.a",
          grid_options: { columns: 6 },
        },
      }),
      false,
    );
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-mushroom-light-card",
        show_brightness_control: false,
        grid_options: { columns: 6 },
      }),
      false,
    );
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-mushroom-cover-card",
        grid_options: { columns: 6 },
      }),
      false,
    );
    assert.equal(
      isDoubleTallPinnedCard({
        type: "custom:area-card-mushroom-climate-card",
        show_temperature_control: true,
        grid_options: { columns: 6, rows: 1 },
      }),
      false,
    );
  });

  it("treats grid_options.rows of 2 as double-tall, including inside a light row", () => {
    const wrapped = {
      type: "custom:area-card-light-row",
      grid_options: { columns: 6 },
      card: {
        type: "custom:area-card-mushroom-template-card",
        entity: "light.a",
        grid_options: { columns: 6, rows: 2 },
      },
    };
    assert.equal(isDoubleTallPinnedCard(wrapped), true);
    assert.equal(pinnedRowsSideBySide(wrapped, "expanded-full"), true);
    assert.equal(pinnedRowsSideBySide(wrapped, "half"), false);
    assert.equal(isDoubleTallPinnedCard({ type: "entities", grid_options: { columns: 6, rows: "2" } }), false);
    assert.equal(isDoubleTallPinnedCard({ type: "entities", grid_options: { columns: 6, rows: 2 } }), true);
  });
});

describe("pinnedSideBySideStyles", () => {
  it("places the two rows in two columns and does not clip them", () => {
    const css = `${pinnedSideBySideStyles()}\n${pinnedSideBySideHostStyles()}`;
    assert.match(css, /flex-direction:\s*row/);
    assert.match(css, /flex-wrap:\s*nowrap/);
    assert.match(css, /area-card-mushroom-state-item/);
    assert.match(css, /\.actions/);
    assert.match(css, /flex:\s*1 1 0%/);
    assert.match(css, /overflow:\s*visible/);
    assert.doesNotMatch(css, /overflow:\s*hidden/);
    assert.doesNotMatch(css, /grid-template-columns:[^;]*1fr\s+1fr\s+1fr/);
    const grid = pinnedSideBySideGridStyles();
    assert.match(grid, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
    assert.match(grid, /grid-auto-flow:\s*row/);
    assert.doesNotMatch(grid, /1fr\s+1fr\s+1fr/);
  });
});
