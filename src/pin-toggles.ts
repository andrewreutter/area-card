import { pinEntityId, type PinMode } from "./pinned-entities";
import { pinSwitchStyles } from "./popup-chrome";
import { BUBBLE_CARDS_GRID } from "./tags";

const PIN_STYLE_ID = "area-card-pin-switch-style";

const PIN_ICONS: Record<PinMode, string> = {
  hidden: "mdi:eye-off",
  always: "mdi:pin",
  "when-on": "mdi:eye-check",
};

const PIN_LABELS: Record<PinMode, string> = {
  hidden: "Hidden on the area card",
  always: "Always on the area card",
  "when-on": "On the area card while on",
};

interface PinButton extends HTMLButtonElement {
  pinCycle?: (entityId: string) => void;
}

function rowConfig(cell: Element): Record<string, unknown> | null {
  for (const child of cell.children) {
    if (child.classList.contains("area-card-pin-switch")) continue;
    const config = (child as Element & { config?: unknown }).config;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      return config as Record<string, unknown>;
    }
  }
  return null;
}

function removeSwitches(cell: Element): void {
  for (const node of cell.querySelectorAll(":scope > .area-card-pin-switch")) node.remove();
}

function showPinMode(button: HTMLButtonElement, mode: PinMode): void {
  button.dataset.pinMode = mode;
  const label = PIN_LABELS[mode];
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.title = label;
  button.querySelector("ha-icon")?.setAttribute("icon", PIN_ICONS[mode]);
}

function createPinButton(): PinButton {
  const button = document.createElement("button") as PinButton;
  button.type = "button";
  button.className = "area-card-pin-switch";
  const icon = document.createElement("ha-icon");
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const entityId = button.dataset.pinEntity;
    if (entityId) button.pinCycle?.(entityId);
  });
  return button;
}

function ensurePinStyles(root: ParentNode): void {
  const host = root as ParentNode & {
    querySelector?: (selector: string) => Element | null;
    appendChild?: (node: Node) => Node;
  };
  if (typeof host.querySelector !== "function" || typeof host.appendChild !== "function") return;
  if (host.querySelector(`#${PIN_STYLE_ID}`)) return;
  const style = document.createElement("style");
  style.id = PIN_STYLE_ID;
  style.textContent = pinSwitchStyles();
  host.appendChild(style);
}

function isForeignControl(node: Element): boolean {
  const tag = node.tagName;
  return typeof tag === "string" && tag.toUpperCase() !== "BUTTON";
}

/** One cycle button per entity row while editing. Reuses the existing button so focus survives a rebuild. */
export function syncPinToggles(
  root: ParentNode,
  options: {
    editing: boolean;
    modeOf: (entityId: string) => PinMode;
    onCycle: (entityId: string) => void;
  },
): void {
  ensurePinStyles(root);
  for (const cell of root.querySelectorAll(`.${BUBBLE_CARDS_GRID} > .card`)) {
    const entityId = options.editing ? pinEntityId(rowConfig(cell)) : null;
    if (!options.editing || !entityId) {
      removeSwitches(cell);
      continue;
    }

    let toggle = cell.querySelector(":scope > .area-card-pin-switch") as PinButton | null;
    if (toggle && isForeignControl(toggle)) {
      toggle.remove();
      toggle = null;
    }
    if (!toggle) {
      toggle = createPinButton();
      cell.insertBefore(toggle, cell.firstChild);
    } else if (toggle !== cell.firstElementChild) {
      cell.insertBefore(toggle, cell.firstChild);
    }
    if (!toggle.querySelector("ha-icon")) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("aria-hidden", "true");
      toggle.append(icon);
    }
    for (const extra of cell.querySelectorAll(":scope > .area-card-pin-switch")) {
      if (extra !== toggle) extra.remove();
    }

    toggle.dataset.pinEntity = entityId;
    toggle.pinCycle = options.onCycle;
    showPinMode(toggle, options.modeOf(entityId));
  }
}
