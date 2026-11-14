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

export function pictureBackgroundStyles(picture: string, surface: "button" | "popup"): string {
  const url = JSON.stringify(picture);
  if (surface === "button") {
    return [
      ".bubble-background {",
      `  background-image: linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.28)), url(${url});`,
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
