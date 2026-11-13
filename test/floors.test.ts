import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { floorIds } from "../src/floors";
import type { ClassifierHass, FloorEntry } from "../src/sections";

describe("floorIds", () => {
  it("returns undefined when floors is missing or undefined", () => {
    assert.equal(floorIds({}), undefined);
    assert.equal(floorIds({ floors: undefined }), undefined);
  });

  it("returns undefined when floors is null before the registry loads", () => {
    const hass = { floors: null } as unknown as ClassifierHass;
    assert.equal(floorIds(hass), undefined);
  });

  it("returns an empty list when the floor registry is empty", () => {
    assert.deepEqual(floorIds({ floors: {} }), []);
  });

  it("returns keys in insertion order when names are not alphabetical", () => {
    const hass: ClassifierHass = {
      floors: {
        zebra: { floor_id: "zebra", name: "Zebra" },
        apple: { floor_id: "apple", name: "Apple" },
      },
    };
    assert.deepEqual(floorIds(hass), ["zebra", "apple"]);
  });

  it("does not invent floors from areas", () => {
    const hass: ClassifierHass = {
      areas: {
        kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "downstairs" },
      },
    };
    assert.equal(floorIds(hass), undefined);
  });

  it("lists a floor that has no matching areas", () => {
    const hass: ClassifierHass = {
      floors: {
        attic: { floor_id: "attic", name: "Attic" },
      },
      areas: {
        kitchen: { area_id: "kitchen", name: "Kitchen", floor_id: "downstairs" },
      },
    };
    assert.deepEqual(floorIds(hass), ["attic"]);
  });

  it("ignores level and aliases and keeps insertion order", () => {
    const floors = {
      basement: { floor_id: "basement", name: "Basement", level: 0, aliases: ["lower"] },
      roof: { floor_id: "roof", name: "Roof", level: 3, aliases: ["top"] },
    } as unknown as Record<string, FloorEntry>;
    assert.deepEqual(floorIds({ floors }), ["basement", "roof"]);
  });
});
