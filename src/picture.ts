/** Cover image for the button, the pinned cluster, and the popup. */
export type PicturePlacement = "none" | "button" | "cluster";

/**
 * Where the area photo is painted.
 * A pinned row that while-on already hid is not visible, so the caller passes that result.
 */
export function picturePlacement(
  picture: string | null | undefined,
  pinnedRowsVisible: boolean,
): PicturePlacement {
  if (picture === null || picture === undefined || picture === "") return "none";
  return pinnedRowsVisible ? "cluster" : "button";
}

/**
 * Outer corner of the cluster photo. Same radius the area button and the
 * bottom pinned cards already use. A pill radius is not used: ha-card clips
 * overflow, and a huge radius would scoop through a tall card.
 */
export const CLUSTER_PICTURE_RADIUS = "var(--ha-card-border-radius, 34px)";

/**
 * Lighter than the button scrim so the photo reads through the pinned rows.
 * The button and the popup keep the darker wash.
 */
const CLUSTER_SCRIM = "linear-gradient(90deg, rgba(0,0,0,.22), rgba(0,0,0,.06))";

/** Same wash the button photo uses, so room text stays readable over video. */
const BUTTON_SCRIM = "linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.28))";

/** Scrim over the camera video. Pinned rows keep the lighter cluster wash. */
export function cameraVideoScrim(pinnedRows: boolean): string {
  return pinnedRows ? CLUSTER_SCRIM : BUTTON_SCRIM;
}

/**
 * ha-card reads this from the theme (`blur(12px) saturate(1.3)` here).
 * It frosts whatever is painted behind the card. The cluster sets it so a
 * shadow root that does not get the explicit override still stays sharp.
 */
const SHARP_BACKDROP = "none";

/** Same cover sizing as the button. No popup sizing. Radius lives on the cluster, not on ha-card. */
export function clusterPictureProperties(picture: string): {
  "background-image": string;
  "background-size": string;
  "background-position": string;
  "border-radius": string;
  "--ha-card-backdrop-filter": string;
} {
  const url = JSON.stringify(picture);
  return {
    "background-image": `${CLUSTER_SCRIM}, url(${url})`,
    "background-size": "cover",
    "background-position": "center",
    "border-radius": CLUSTER_PICTURE_RADIUS,
    "--ha-card-backdrop-filter": SHARP_BACKDROP,
  };
}

export function clusterPictureStyles(picture: string): string {
  const props = clusterPictureProperties(picture);
  return [
    `background-image: ${props["background-image"]};`,
    `background-size: ${props["background-size"]};`,
    `background-position: ${props["background-position"]};`,
    `border-radius: ${props["border-radius"]};`,
    `--ha-card-backdrop-filter: ${props["--ha-card-backdrop-filter"]};`,
  ].join("\n");
}

/**
 * Turns off the theme glass and any filter that would frost the cluster photo.
 * The photo is behind these layers, so a backdrop blur smears it.
 */
function sharpOverPictureLines(): string[] {
  return [
    "backdrop-filter: none !important;",
    "-webkit-backdrop-filter: none !important;",
    "filter: none !important;",
    "--ha-card-backdrop-filter: none !important;",
  ];
}

/**
 * Hides the second copy Bubble paints on the button while the cluster photo is showing.
 * The photo is one rounded shape on the cluster. The button must not paint its own
 * corner fill (a square ha-card, or a second radius) on top of it.
 * The theme backdrop blur stays off so the photo behind the button stays sharp.
 */
export function buttonPictureSuppressStyles(): string {
  const sharp = sharpOverPictureLines().map((line) => `  ${line}`);
  return [
    ":host {",
    ...sharp,
    "}",
    "ha-card {",
    "  background: transparent !important;",
    "  background-color: transparent !important;",
    "  background-image: none !important;",
    "  box-shadow: none !important;",
    ...sharp,
    "}",
    ".bubble-background {",
    "  background-image: none !important;",
    "  background-color: transparent !important;",
    "  box-shadow: none !important;",
    ...sharp,
    "}",
    ".bubble-container {",
    "  background-color: transparent !important;",
    "  background-image: none !important;",
    "  box-shadow: none !important;",
    ...sharp,
    "}",
    "ha-card::before,",
    "ha-card::after,",
    ".bubble-background::before,",
    ".bubble-background::after,",
    ".bubble-container::before,",
    ".bubble-container::after {",
    ...sharp,
    "}",
  ].join("\n");
}

/**
 * Clears pinned card fills so the cluster photo shows through. Names stay white.
 * The theme backdrop blur stays off so the photo behind the row stays sharp.
 * No border-radius here: ha-card hides overflow, and a radius on it clips a tall card.
 */
export function pinnedPictureSurfaceStyles(): string {
  const sharp = sharpOverPictureLines().map((line) => `  ${line}`);
  return [
    ":host {",
    "  --card-primary-color: #fff;",
    "  --card-secondary-color: #fff;",
    "  --primary-text-color: #fff;",
    "  --secondary-text-color: #fff;",
    "  --ha-card-background: transparent;",
    "  --card-background-color: transparent;",
    ...sharp,
    "}",
    "ha-card {",
    "  background: transparent !important;",
    "  background-color: transparent !important;",
    "  border: none !important;",
    "  box-shadow: none !important;",
    "  text-shadow: 0 1px 2px rgba(0,0,0,.65);",
    "  --ha-card-background: transparent;",
    "  --card-background-color: transparent;",
    ...sharp,
    "}",
    "ha-card::before,",
    "ha-card::after {",
    ...sharp,
    "}",
    "area-card-mushroom-state-info,",
    "area-card-mushroom-state-item .info {",
    "  background: transparent !important;",
    "  background-color: transparent !important;",
    "}",
    "area-card-mushroom-shape-icon {",
    "  --shape-color: rgba(255,255,255,0.1) !important;",
    "  --shape-color-disabled: rgba(255,255,255,0.08) !important;",
    "}",
    "area-card-mushroom-light-brightness-control {",
    "  --slider-color: rgba(var(--rgb-state-light), 0.22) !important;",
    "  --slider-bg-color: rgba(var(--rgb-state-light), 0.06) !important;",
    "}",
  ].join("\n");
}

/**
 * First camera in area order that is set to the collapsed-card background.
 * A later camera with the same choice does not replace it.
 */
export function firstBackgroundCamera(
  camerasInAreaOrder: readonly string[],
  backgroundIds: readonly string[],
): string | null {
  const selected = new Set(backgroundIds);
  for (const id of camerasInAreaOrder) {
    if (selected.has(id)) return id;
  }
  return null;
}

/** Home Assistant's camera STREAM feature. A still-only camera does not set this bit. */
const CAMERA_STREAM = 2;

/** True when the camera advertises a video stream. A still proxy alone does not. */
export function cameraSupportsStream(
  state: { attributes?: Record<string, unknown> } | null | undefined,
): boolean {
  const features = state?.attributes?.supported_features;
  return typeof features === "number" && (features & CAMERA_STREAM) === CAMERA_STREAM;
}

/**
 * HLS path from a `camera/stream` result. Anything else, including the still
 * proxy and an audio response, is not a video background.
 */
export function cameraStreamPath(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const url = (result as { url?: unknown }).url;
  if (typeof url !== "string" || !url.includes("/api/hls/")) return null;
  return url;
}

/** Still URL from a camera state. Unavailable, unknown, and a blank picture are no image. */
export function cameraEntityPicture(
  state: { state?: string; attributes?: Record<string, unknown> } | null | undefined,
): string | null {
  if (!state) return null;
  const value = state.state;
  if (typeof value !== "string" || value.length === 0 || value === "unavailable" || value === "unknown") return null;
  const picture = state.attributes?.entity_picture;
  return typeof picture === "string" && picture.length > 0 ? picture : null;
}

export interface CollapsedCameraBackground {
  entityId: string | null;
  area: string | null;
  /** Still for the chosen camera. Fallback when its video is missing or fails. */
  still: string | null;
  /** The chosen camera advertises video. A later camera does not take its place. */
  video: boolean;
}

/**
 * Collapsed background camera. The first camera in area order wins.
 * Video is used when that camera can stream. Its still is the fallback, and
 * the area picture stays when that still is missing. The popup is not this photo.
 */
export function collapsedCameraBackground(
  areaPicture: string | null | undefined,
  camerasInAreaOrder: readonly string[],
  backgroundIds: readonly string[],
  cameraOf: (entityId: string) => { stream?: boolean; still?: string | null } | null | undefined,
): CollapsedCameraBackground {
  const area = typeof areaPicture === "string" && areaPicture.length > 0 ? areaPicture : null;
  const entityId = firstBackgroundCamera(camerasInAreaOrder, backgroundIds);
  if (!entityId) return { entityId: null, area, still: null, video: false };
  const camera = cameraOf(entityId);
  const stillValue = camera?.still;
  const still = typeof stillValue === "string" && stillValue.length > 0 ? stillValue : null;
  return { entityId, area, still, video: camera?.stream === true };
}

/**
 * Still used under the collapsed card when the camera video is not playing.
 * The first background camera in area order supplies it. When that camera has
 * no image, the area picture stays. A later camera is not used.
 */
export function collapsedCardPicture(
  areaPicture: string | null | undefined,
  camerasInAreaOrder: readonly string[],
  backgroundIds: readonly string[],
  imageOf: (entityId: string) => string | null | undefined,
): string | null {
  const choice = collapsedCameraBackground(areaPicture, camerasInAreaOrder, backgroundIds, (id) => ({
    still: imageOf(id),
  }));
  return choice.still ?? choice.area;
}

export type CameraPictureLoad = "pending" | "loaded" | "failed";

/**
 * Still shown while a camera video has not taken over the collapsed card.
 * A missing URL or a failed load keeps the area picture. While a new URL for
 * the same camera is still loading, the previous still stays up.
 */

/**
 * Still painted on the cluster while a camera video is the collapsed background.
 * The still comes off only after a frame is actually showing. Until then it stays,
 * so a player with no picture cannot leave a blank card.
 */
export function clusterPictureWhileVideo(frameVisible: boolean, picture: string | null): string | null {
  if (frameVisible) return null;
  return picture && picture.length > 0 ? picture : null;
}

/**
 * A video that never shows a frame leaves the camera still in place.
 * The area picture is used only when that still is missing.
 */
export function pictureAfterAutoplayFailure(
  areaPicture: string | null,
  failed: boolean,
  shown: string | null,
): string | null {
  if (shown && shown.length > 0) return shown;
  if (!failed) return null;
  return areaPicture && areaPicture.length > 0 ? areaPicture : null;
}
export function pictureAfterCameraLoad(
  areaPicture: string | null,
  cameraPicture: string | null,
  load: CameraPictureLoad | undefined,
  heldUrl: string | null,
): string | null {
  const area = areaPicture && areaPicture.length > 0 ? areaPicture : null;
  if (!cameraPicture) return area;
  if (load === "loaded") return cameraPicture;
  if (load === "failed") return area;
  if (heldUrl && heldUrl.length > 0) return heldUrl;
  return area;
}

export function pictureBackgroundStyles(picture: string, surface: "button" | "popup"): string {
  const url = JSON.stringify(picture);
  if (surface === "button") {
    return [
      ".bubble-background {",
      `  background-image: ${BUTTON_SCRIM}, url(${url});`,
      "  background-size: cover;",
      "  background-position: center;",
      "}",
      ".bubble-name,",
      ".bubble-state {",
      "  color: #fff !important;",
      "  text-shadow: 0 1px 2px rgba(0,0,0,.65);",
      "}",
    ].join("\n");
  }
  return [
    ".bubble-pop-up-background {",
    `  background-image: linear-gradient(to bottom, rgba(0,0,0,.55), rgba(0,0,0,.28)), url(${url});`,
    "  background-size: 100% auto;",
    "  background-position: top center;",
    "  background-repeat: no-repeat;",
    "}",
  ].join("\n");
}
