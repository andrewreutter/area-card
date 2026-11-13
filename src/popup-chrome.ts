/** Header title has no fill, with or without a picture. Picture rules are appended when one exists. */
const POPUP_TITLE_CHROME = [
  ".bubble-pop-up > .bubble-header-container > .bubble-header .bubble-button-card-container {",
  "  background: none !important;",
  "  box-shadow: none !important;",
  "}",
  ".bubble-pop-up > .bubble-header-container > .bubble-header .bubble-background,",
  ".bubble-pop-up > .bubble-header-container > .bubble-header .bubble-button-card-container > ha-ripple {",
  "  display: none !important;",
  "}",
].join("\n");

/** White text on the header that actually renders, only when a picture sits behind it. */
const POPUP_TITLE_ON_PICTURE = [
  ".bubble-pop-up > .bubble-header-container > .bubble-header .bubble-name,",
  ".bubble-pop-up > .bubble-header-container > .bubble-header .bubble-state {",
  "  color: #fff !important;",
  "  text-shadow: 0 1px 2px rgba(0,0,0,.65);",
  "}",
].join("\n");

export function popupChromeStyles(pictureStyles?: string): string {
  if (!pictureStyles) return POPUP_TITLE_CHROME;
  return [POPUP_TITLE_CHROME, pictureStyles, POPUP_TITLE_ON_PICTURE].join("\n");
}

export function areaSettingsPath(areaId: string): string {
  return `/config/areas/area/${areaId}`;
}

/** Place the gear immediately left of close. A gear already in that spot is left alone. */
export function insertAreaEditButton(actions: Element, button: HTMLElement): void {
  const close = actions.querySelector(".bubble-close-button");
  if (!close) return;
  if (close.previousElementSibling?.classList.contains("area-card-edit-area")) return;
  actions.insertBefore(button, close);
}
