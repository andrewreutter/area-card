import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoplayRejected,
  cameraAccessToken,
  cameraFrameReady,
  cameraPlaybackGuardStyles,
} from "../src/camera-video";
import {
  buttonPictureSuppressStyles,
  cameraEntityPicture,
  cameraStreamPath,
  cameraSupportsStream,
  cameraVideoScrim,
  clusterPictureStyles,
  clusterPictureWhileVideo,
  collapsedCameraBackground,
  collapsedCardPicture,
  pictureAfterAutoplayFailure,
  pictureAfterCameraLoad,
  picturePlacement,
  pinnedPictureSurfaceStyles,
} from "../src/picture";

const picture = 'https://ha.local/api/image/serve/abc")def';

describe("collapsed card picture", () => {
  const area = "/api/image/serve/man-cave";
  const one = "/api/camera_proxy/camera.one";
  const two = "/api/camera_proxy/camera.two";
  const cameras = ["camera.one", "camera.two"];

  it("uses the first background camera in area order", () => {
    const imageOf = (id: string) => (id === "camera.one" ? one : two);
    assert.equal(collapsedCardPicture(area, cameras, ["camera.two", "camera.one"], imageOf), one);
    assert.equal(collapsedCardPicture(area, ["camera.two", "camera.one"], ["camera.one", "camera.two"], imageOf), two);
    assert.equal(collapsedCardPicture(area, cameras, ["camera.two"], imageOf), two);
    assert.equal(collapsedCardPicture(area, cameras, [], imageOf), area);
  });

  it("keeps the area picture when that camera has no image", () => {
    const imageOf = (id: string) => (id === "camera.two" ? two : null);
    assert.equal(collapsedCardPicture(area, cameras, ["camera.one", "camera.two"], imageOf), area);
    assert.equal(collapsedCardPicture(area, cameras, ["camera.one"], () => ""), area);
    assert.equal(collapsedCardPicture(null, cameras, ["camera.one"], () => null), null);
    assert.equal(cameraEntityPicture({ state: "idle", attributes: {} }), null);
    assert.equal(cameraEntityPicture({ state: "unavailable", attributes: { entity_picture: one } }), null);
    assert.equal(cameraEntityPicture({ state: "idle", attributes: { entity_picture: one } }), one);
  });

  it("keeps the area picture when the fallback still fails to load", () => {
    assert.equal(pictureAfterCameraLoad(area, one, "failed", null), area);
    assert.equal(pictureAfterCameraLoad(area, one, "pending", null), area);
    assert.equal(pictureAfterCameraLoad(area, one, "loaded", null), one);
    assert.equal(pictureAfterCameraLoad(area, null, "loaded", one), area);
  });

  it("plays video for the first background camera that can stream", () => {
    const cameraOf = (id: string) => ({
      stream: true,
      still: id === "camera.one" ? one : two,
    });
    const choice = collapsedCameraBackground(area, cameras, ["camera.two", "camera.one"], cameraOf);
    assert.equal(choice.entityId, "camera.one");
    assert.equal(choice.video, true);
    assert.equal(choice.still, one);
    assert.equal(choice.area, area);
    const later = collapsedCameraBackground(area, ["camera.two", "camera.one"], ["camera.one", "camera.two"], cameraOf);
    assert.equal(later.entityId, "camera.two");
    assert.equal(later.video, true);
  });

  it("keeps the still when that camera has no video stream", () => {
    const choice = collapsedCameraBackground(area, cameras, ["camera.one", "camera.two"], (id) => ({
      stream: id === "camera.two",
      still: id === "camera.one" ? one : two,
    }));
    assert.equal(choice.entityId, "camera.one");
    assert.equal(choice.video, false);
    assert.equal(choice.still, one);
    assert.equal(collapsedCardPicture(area, cameras, ["camera.one"], () => one), one);
  });

  it("keeps the area picture when the stream and the still are both missing", () => {
    const choice = collapsedCameraBackground(area, cameras, ["camera.one"], () => ({ stream: false, still: null }));
    assert.equal(choice.video, false);
    assert.equal(choice.still, null);
    assert.equal(pictureAfterCameraLoad(choice.area, choice.still, "failed", null), area);
    assert.equal(cameraSupportsStream({ attributes: { supported_features: 2 } }), true);
    assert.equal(cameraSupportsStream({ attributes: { supported_features: 3 } }), true);
    assert.equal(cameraSupportsStream({ attributes: { supported_features: 1 } }), false);
    assert.equal(cameraSupportsStream({ attributes: {} }), false);
    assert.equal(cameraSupportsStream(null), false);
    assert.equal(cameraStreamPath({ url: "/api/hls/abc/master_playlist.m3u8" }), "/api/hls/abc/master_playlist.m3u8");
    assert.equal(cameraStreamPath({ url: "/api/camera_proxy/camera.one" }), null);
    assert.equal(cameraStreamPath({ url: "/api/camera_proxy_stream/camera.one" }), null);
    assert.equal(cameraStreamPath({}), null);
    assert.match(cameraVideoScrim(false), /rgba\(0,0,0,\.55\)/);
    assert.match(cameraVideoScrim(true), /rgba\(0,0,0,\.22\)/);
    assert.equal(cameraAccessToken({ auth: { data: { access_token: "abc" } } }), "abc");
    assert.equal(cameraAccessToken({ auth: { accessToken: "abc" } }), "abc");
    assert.equal(cameraAccessToken({ auth: { data: { access_token: "" } } }), null);
    assert.equal(cameraAccessToken({}), null);
  });

  it("starts muted and hides the start button, and keeps the area picture if autoplay fails", () => {
    const css = cameraPlaybackGuardStyles();
    assert.match(css, /webkit-media-controls-start-playback-button/);
    assert.match(css, /webkit-media-controls-overlay-play-button/);
    assert.match(css, /display:\s*none !important/);
    assert.match(css, /pointer-events:\s*none !important/);
    assert.match(css, /object-fit:\s*cover !important/);
    assert.match(css, /object-position:\s*center !important/);
    assert.equal(css.includes("22%"), false);
    assert.match(css, /max-height:\s*none !important/);
    assert.equal(css.includes("controls: true"), false);
    assert.equal(clusterPictureWhileVideo(true, one), null);
    assert.equal(clusterPictureWhileVideo(false, one), one);
    assert.equal(clusterPictureWhileVideo(false, null), null);
    assert.equal(pictureAfterAutoplayFailure(area, true, one), one);
    assert.equal(pictureAfterAutoplayFailure(area, false, one), one);
    assert.equal(pictureAfterAutoplayFailure(area, true, null), area);
    assert.equal(pictureAfterAutoplayFailure(null, true, null), null);
    const frame = { videoWidth: 640, readyState: 2, paused: false };
    assert.equal(cameraFrameReady(frame), true);
    assert.equal(cameraFrameReady({ ...frame, paused: true }), false);
    assert.equal(cameraFrameReady({ ...frame, videoWidth: 0 }), false);
    assert.equal(cameraFrameReady({ ...frame, readyState: 1 }), false);
    assert.equal(cameraFrameReady(null), false);
    assert.equal(autoplayRejected(new DOMException("blocked", "NotAllowedError")), true);
    assert.equal(autoplayRejected(new DOMException("interrupted", "AbortError")), false);
  });
});

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
