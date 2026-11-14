import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAreaPins, type AreaPins } from "../src/pinned-entities";
import {
  PIN_STICKY_MS,
  entityPinActive,
  pinStickyKey,
  visiblePinnedIds,
  type PinStickyState,
} from "../src/pin-visibility";

const AREA = "kitchen";
const TV = "media_player.tv";
const NOW = 1_700_000_000_000;

function whenOn(ids: string[], always: string[] = []): AreaPins {
  return { always, whenOn: ids };
}

function sample(state: string): (entityId: string) => string {
  return () => state;
}

function sticky(entityId: string, state: PinStickyState, areaId = AREA): Map<string, PinStickyState> {
  return new Map([[pinStickyKey(areaId, entityId), state]]);
}

describe("visiblePinnedIds", () => {
  it("treats a legacy string array as always, even while off", () => {
    const pins = parseAreaPins('["light.a","switch.b"]');
    assert.deepEqual(pins, { always: ["light.a", "switch.b"], whenOn: [] });
    const visible = visiblePinnedIds(pins, sample("off"), new Map(), AREA, NOW);
    assert.deepEqual(visible.ids, ["light.a", "switch.b"]);
    assert.equal(visible.sticky.size, 0);
    assert.equal(visible.deadline, undefined);
  });

  it("hides a while-on entity that is off", () => {
    const visible = visiblePinnedIds(whenOn([TV], ["light.keep"]), sample("off"), new Map(), AREA, NOW);
    assert.deepEqual(visible.ids, ["light.keep"]);
    assert.deepEqual(visible.sticky.get(pinStickyKey(AREA, TV)), { active: false });
    assert.equal(visible.sticky.get(pinStickyKey(AREA, TV))?.until, undefined);
    assert.equal(visible.deadline, undefined);
  });

  it("shows playing with no until", () => {
    const visible = visiblePinnedIds(whenOn([TV]), sample("playing"), new Map(), AREA, NOW);
    assert.deepEqual(visible.ids, [TV]);
    assert.deepEqual(visible.sticky.get(pinStickyKey(AREA, TV)), { active: true });
    assert.equal(visible.sticky.get(pinStickyKey(AREA, TV))?.until, undefined);
    assert.equal(visible.deadline, undefined);
  });

  it("keeps the next paused sample visible until now plus 120000", () => {
    assert.equal(PIN_STICKY_MS, 120_000);
    const playing = visiblePinnedIds(whenOn([TV]), sample("playing"), new Map(), AREA, NOW);
    const pausedAt = NOW + 250;
    const paused = visiblePinnedIds(whenOn([TV]), sample("paused"), playing.sticky, AREA, pausedAt);
    assert.deepEqual(paused.ids, [TV]);
    assert.deepEqual(paused.sticky.get(pinStickyKey(AREA, TV)), { active: false, until: pausedAt + 120_000 });
    assert.equal(paused.deadline, pausedAt + PIN_STICKY_MS);
  });

  it("does not extend until when a later paused sample arrives before it", () => {
    const until = NOW + PIN_STICKY_MS;
    const later = visiblePinnedIds(whenOn([TV]), sample("paused"), sticky(TV, { active: false, until }), AREA, NOW + 5_000);
    assert.deepEqual(later.ids, [TV]);
    assert.equal(later.sticky.get(pinStickyKey(AREA, TV))?.until, until);
    assert.equal(later.deadline, until);
  });

  it("hides a sample taken at until and clears until", () => {
    const until = NOW + PIN_STICKY_MS;
    const at = visiblePinnedIds(whenOn([TV]), sample("paused"), sticky(TV, { active: false, until }), AREA, until);
    assert.deepEqual(at.ids, []);
    assert.deepEqual(at.sticky.get(pinStickyKey(AREA, TV)), { active: false });
    assert.equal(at.deadline, undefined);
    const after = visiblePinnedIds(whenOn([TV]), sample("paused"), at.sticky, AREA, until + 5_000);
    assert.deepEqual(after.ids, []);
    assert.equal(after.sticky.get(pinStickyKey(AREA, TV))?.until, undefined);
  });

  it("shows a hidden paused player when it plays, then starts a new window on the next pause", () => {
    const hidden = visiblePinnedIds(whenOn([TV]), sample("paused"), new Map(), AREA, NOW);
    assert.deepEqual(hidden.ids, []);
    const playAt = NOW + 4_000;
    const playing = visiblePinnedIds(whenOn([TV]), sample("playing"), hidden.sticky, AREA, playAt);
    assert.deepEqual(playing.ids, [TV]);
    assert.equal(playing.sticky.get(pinStickyKey(AREA, TV))?.until, undefined);
    const pauseAt = playAt + 3_000;
    const paused = visiblePinnedIds(whenOn([TV]), sample("paused"), playing.sticky, AREA, pauseAt);
    assert.deepEqual(paused.ids, [TV]);
    assert.equal(paused.sticky.get(pinStickyKey(AREA, TV))?.until, pauseAt + PIN_STICKY_MS);
  });

  it("hides paused when there is no previous sticky", () => {
    const visible = visiblePinnedIds(whenOn([TV]), sample("paused"), new Map(), AREA, NOW);
    assert.deepEqual(visible.ids, []);
    assert.equal(visible.deadline, undefined);
  });

  it("does not refresh the window from paused to idle to paused", () => {
    const until = NOW + PIN_STICKY_MS;
    const idle = visiblePinnedIds(whenOn([TV]), sample("idle"), sticky(TV, { active: false, until }), AREA, NOW + 1_000);
    assert.equal(idle.sticky.get(pinStickyKey(AREA, TV))?.until, until);
    const paused = visiblePinnedIds(whenOn([TV]), sample("paused"), idle.sticky, AREA, NOW + 2_000);
    assert.deepEqual(paused.ids, [TV]);
    assert.equal(paused.sticky.get(pinStickyKey(AREA, TV))?.until, until);
  });

  it("starts the same window when a non-media entity turns off", () => {
    const on = visiblePinnedIds(whenOn(["light.a"]), sample("on"), new Map(), AREA, NOW);
    const offAt = NOW + 20;
    const off = visiblePinnedIds(whenOn(["light.a"]), sample("off"), on.sticky, AREA, offAt);
    assert.deepEqual(off.ids, ["light.a"]);
    assert.equal(off.sticky.get(pinStickyKey(AREA, "light.a"))?.until, offAt + PIN_STICKY_MS);
  });

  it("drops sticky for an entity that is no longer while-on", () => {
    const visible = visiblePinnedIds(
      { always: [TV], whenOn: [] },
      sample("paused"),
      sticky(TV, { active: true }),
      AREA,
      NOW,
    );
    assert.deepEqual(visible.ids, [TV]);
    assert.equal(visible.sticky.size, 0);
  });

  it("uses the soonest while-on deadline", () => {
    const soon = NOW + 1_000;
    const later = NOW + 50_000;
    const prior = new Map<string, PinStickyState>([
      [pinStickyKey(AREA, "light.a"), { active: false, until: soon }],
      [pinStickyKey(AREA, TV), { active: false, until: later }],
    ]);
    const visible = visiblePinnedIds(whenOn(["light.a", TV]), sample("off"), prior, AREA, NOW);
    assert.deepEqual(visible.ids, ["light.a", TV]);
    assert.equal(visible.deadline, soon);
    assert.equal(visible.sticky.has(pinStickyKey("office", TV)), false);
  });
});

describe("entityPinActive", () => {
  it("treats missing, blank, unknown, and unavailable as inactive for every domain", () => {
    for (const entityId of ["light.a", TV, "cover.shade", "switch.lamp"]) {
      assert.equal(entityPinActive(entityId, undefined), false);
      assert.equal(entityPinActive(entityId, ""), false);
      assert.equal(entityPinActive(entityId, "unknown"), false);
      assert.equal(entityPinActive(entityId, "unavailable"), false);
    }
  });

  it("treats media playing, on, and buffering as active, and paused, idle, off, and standby as inactive", () => {
    for (const state of ["playing", "on", "buffering"]) assert.equal(entityPinActive(TV, state), true);
    for (const state of ["paused", "idle", "off", "standby"]) assert.equal(entityPinActive(TV, state), false);
  });

  it("treats cover open and opening as active, and closed and closing as inactive", () => {
    assert.equal(entityPinActive("cover.shade", "open"), true);
    assert.equal(entityPinActive("cover.shade", "opening"), true);
    assert.equal(entityPinActive("cover.shade", "closed"), false);
    assert.equal(entityPinActive("cover.shade", "closing"), false);
  });

  it("treats every other domain as active only when on", () => {
    assert.equal(entityPinActive("light.a", "on"), true);
    assert.equal(entityPinActive("light.a", "off"), false);
    assert.equal(entityPinActive("switch.lamp", "on"), true);
    assert.equal(entityPinActive("fan.room", "off"), false);
    assert.equal(entityPinActive("binary_sensor.door", "open"), false);
  });
});

describe("pinStickyKey", () => {
  it("differs by area id", () => {
    assert.equal(pinStickyKey(AREA, TV), `${AREA}\0${TV}`);
    assert.notEqual(pinStickyKey(AREA, TV), pinStickyKey("office", TV));
    const kitchen = visiblePinnedIds(whenOn([TV]), sample("playing"), new Map(), AREA, NOW);
    const office = visiblePinnedIds(whenOn([TV]), sample("paused"), kitchen.sticky, "office", NOW);
    assert.deepEqual(office.ids, []);
    assert.equal(office.sticky.has(pinStickyKey(AREA, TV)), false);
    assert.deepEqual(office.sticky.get(pinStickyKey("office", TV)), { active: false });
  });
});
