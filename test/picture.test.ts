import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buttonPictureSuppressStyles,
  clusterPictureStyles,
  picturePlacement,
  pinnedPictureSurfaceStyles,
} from "../src/picture";

const picture = 'https://ha.local/api/image/serve/abc")def';

describe("picture placement", () => {
  it("keeps the photo on the button until a pinned row is showing", () => {
    assert.equal(picturePlacement(picture, false), "button");
    assert.equal(picturePlacement(picture, true), "cluster");
    assert.equal(picturePlacement(null, true), "none");
    assert.equal(picturePlacement(undefined, false), "none");
    assert.equal(picturePlacement("", true), "none");
  });

  it("paints the cluster with a light scrim, the card radius, and escaped quotes", () => {
    const css = clusterPictureStyles(picture);
    assert.match(css, /linear-gradient\(90deg,\s*rgba\(0,0,0,\.22\),\s*rgba\(0,0,0,\.06\)\)/);
    assert.match(css, /border-radius:\s*var\(--ha-card-border-radius,\s*34px\)/);
    assert.match(css, /background-size:\s*cover/);
    assert.match(css, /background-position:\s*center/);
    assert.match(css, /--ha-card-backdrop-filter:\s*none/);
    assert.ok(css.includes(`url(${JSON.stringify(picture)})`));
    assert.equal(css.includes("rgba(0,0,0,.55)"), false);
    assert.equal(css.includes("999px"), false);
    assert.equal(css.includes("overflow"), false);
    assert.equal(css.includes("100% auto"), false);
    assert.equal(css.includes("top center"), false);
    assert.equal(css.includes("no-repeat"), false);
    assert.equal(css.includes(".bubble-pop-up-background"), false);
  });

  it("clears the button's own photo and corner fill while the cluster is showing", () => {
    const css = buttonPictureSuppressStyles();
    assert.match(css, /\.bubble-background\s*\{[^}]*background-image:\s*none !important/);
    assert.match(css, /\.bubble-container\s*\{[^}]*background-color:\s*transparent !important/);
    assert.match(css, /ha-card\s*\{[^}]*background:\s*transparent !important/);
    assert.match(css, /ha-card\s*\{[^}]*background-image:\s*none !important/);
    assert.match(css, /ha-card\s*\{[^}]*backdrop-filter:\s*none !important/);
    assert.match(css, /ha-card\s*\{[^}]*-webkit-backdrop-filter:\s*none !important/);
    assert.match(css, /ha-card\s*\{[^}]*filter:\s*none !important/);
    assert.match(css, /\.bubble-container\s*\{[^}]*backdrop-filter:\s*none !important/);
    assert.match(css, /\.bubble-background\s*\{[^}]*--ha-card-backdrop-filter:\s*none !important/);
    assert.equal(css.includes(".bubble-name"), false);
    assert.equal(css.includes("pop-up"), false);
    assert.equal(css.includes("popup"), false);
  });

  it("clears pinned fills without a second photo or a card radius", () => {
    const css = pinnedPictureSurfaceStyles();
    assert.match(css, /background:\s*transparent !important/);
    assert.match(css, /--card-primary-color:\s*#fff/);
    assert.match(css, /--ha-card-background:\s*transparent/);
    assert.match(css, /text-shadow:\s*0 1px 2px rgba\(0,0,0,\.65\)/);
    assert.match(css, /area-card-mushroom-state-info[\s\S]*background:\s*transparent !important/);
    assert.match(css, /--shape-color:\s*rgba\(255,255,255,0\.1\) !important/);
    assert.match(css, /--slider-color:\s*rgba\(var\(--rgb-state-light\),\s*0\.22\) !important/);
    assert.match(css, /--slider-bg-color:\s*rgba\(var\(--rgb-state-light\),\s*0\.06\) !important/);
    assert.match(css, /ha-card\s*\{[^}]*backdrop-filter:\s*none !important/);
    assert.match(css, /ha-card\s*\{[^}]*-webkit-backdrop-filter:\s*none !important/);
    assert.match(css, /ha-card\s*\{[^}]*filter:\s*none !important/);
    assert.match(css, /:host\s*\{[^}]*--ha-card-backdrop-filter:\s*none !important/);
    assert.equal(css.includes("opacity"), false);
    assert.equal(css.includes("border-radius"), false);
    assert.equal(css.includes("999px"), false);
    assert.equal(css.includes("overflow"), false);
    assert.equal(css.includes("linear-gradient"), false);
    assert.equal(css.includes(".bubble-pop-up"), false);
  });
});
