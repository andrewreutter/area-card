import { BUBBLE_CARDS_GRID } from "./tags";

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

/**
 * Pin-switch layout. Bubble rewrites popup `styles` and appends a `:not()` that
 * excludes `.area-card-bubbles-grid-container` and everything inside it, so these
 * rules never match when they ride along in that stylesheet. `syncPinToggles`
 * injects this text in its own style element.
 */
export function pinSwitchStyles(): string {
  return [
    `.${BUBBLE_CARDS_GRID} > .card:has(> .area-card-pin-switch) {`,
    "  display: flex !important;",
    "  align-items: center;",
    "  gap: 8px;",
    "}",
    `.${BUBBLE_CARDS_GRID} > .card:has(> .area-card-pin-switch) > :not(.area-card-pin-switch) {`,
    "  flex: 1 1 auto;",
    "  min-width: 0;",
    "}",
    ".area-card-pin-switch {",
    "  flex: 0 0 auto;",
    "  display: inline-flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "  box-sizing: border-box;",
    "  width: 36px;",
    "  height: 36px;",
    "  padding: 0;",
    "  border: none;",
    "  background: transparent;",
    "  color: var(--primary-text-color);",
    "  --mdc-icon-size: 24px;",
    "}",
    '.area-card-pin-switch[data-pin-mode="always"],',
    '.area-card-pin-switch[data-pin-mode="when-on"],',
    '.area-card-pin-switch[data-pin-mode="background"] {',
    "  color: var(--primary-color);",
    "  opacity: 1;",
    "}",
    '.area-card-pin-switch[data-pin-mode="hidden"] {',
    "  opacity: 0.45;",
    "}",
  ].join("\n");
}

/** Header action buttons sit tight against close. */
const POPUP_HEADER_ACTIONS = [
  ".bubble-header-container > .bubble-header-actions {",
  "  gap: 4px !important;",
  "}",
  ".bubble-header-container > .bubble-header-actions > .bubble-header-action-button {",
  "  width: 36px !important;",
  "  height: 36px !important;",
  "}",
  ".area-card-pin-edit[aria-pressed=\"true\"] {",
  "  background: var(--primary-color) !important;",
  "  color: var(--text-primary-color, #fff) !important;",
  "}",
].join("\n");

export function popupChromeStyles(pictureStyles?: string): string {
  const title = pictureStyles
    ? [POPUP_TITLE_CHROME, pictureStyles, POPUP_TITLE_ON_PICTURE].join("\n")
    : POPUP_TITLE_CHROME;
  return [title, POPUP_HEADER_ACTIONS].join("\n");
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

/** Place pencil, then gear, immediately left of close. Moves existing nodes. A missing close button does nothing. */
export function ensureHeaderButtons(actions: Element, pencil: HTMLElement, gear: HTMLElement): void {
  const close = actions.querySelector(".bubble-close-button");
  if (!close) return;
  if (close.previousElementSibling !== gear) actions.insertBefore(gear, close);
  if (gear.previousElementSibling !== pencil) actions.insertBefore(pencil, gear);
}
