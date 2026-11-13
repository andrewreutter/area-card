import { entityTitle, lightExposesControls } from "./popup-cards";
import { dotTooltipLabel, rollupEntityIds, visibleDotRollupId, type RollupId, type SectionRollup } from "./rollups";
import type { AreaSections, EntityState } from "./sections";

export interface DotTooltipSource {
  sections: AreaSections;
  states: Record<string, EntityState | undefined>;
  roomName: string;
  formatEntityState?: (state: EntityState, stateText?: string) => string;
}

const TIP_ID = "area-card-dot-tooltip";
const GAP = 6;
const MARGIN = 4;

export function tooltipPosition(
  anchor: { left: number; top: number; width: number; height: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let top = anchor.top - GAP - tip.height;
  if (top < MARGIN) top = anchor.top + anchor.height + GAP;
  let left = anchor.left + anchor.width / 2 - tip.width / 2;
  const maxLeft = Math.max(MARGIN, viewport.width - MARGIN - tip.width);
  if (left < MARGIN) left = MARGIN;
  if (left > maxLeft) left = maxLeft;
  return { left, top };
}

let tipEl: HTMLDivElement | undefined;
let scrollBound = false;

function ensureTip(): HTMLDivElement {
  if (tipEl?.isConnected) return tipEl;
  let style = document.getElementById("area-card-dot-tooltip-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "area-card-dot-tooltip-style";
    style.textContent = `
      #${TIP_ID} {
        position: fixed;
        inset: auto;
        margin: 0;
        width: max-content;
        height: auto;
        overflow: visible;
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
        border-radius: 12px;
        padding: 4px 10px;
        background: var(--secondary-background-color, #202124);
        color: var(--primary-text-color, #f5f5f5);
        font: 500 13px/1.3 var(--primary-font-family, var(--ha-font-family, system-ui, sans-serif));
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
        pointer-events: none;
        white-space: pre;
      }
    `;
    document.head.appendChild(style);
  }
  const el = document.createElement("div");
  el.id = TIP_ID;
  el.setAttribute("role", "tooltip");
  el.popover = "manual";
  document.body.appendChild(el);
  tipEl = el;
  return el;
}

function onScroll(): void {
  hideAreaDotTooltip();
}

export function showAreaDotTooltip(target: HTMLElement, text: string): void {
  const el = ensureTip();
  el.textContent = text;
  el.style.visibility = "hidden";
  const anchor = target.getBoundingClientRect();
  el.style.left = `${anchor.left}px`;
  el.style.top = `${Math.max(MARGIN, anchor.top - 32)}px`;
  if (!el.matches(":popover-open")) el.showPopover();
  const pos = tooltipPosition(target.getBoundingClientRect(), el.getBoundingClientRect(), {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.style.visibility = "visible";
  if (!scrollBound) {
    window.addEventListener("scroll", onScroll, true);
    scrollBound = true;
  }
}

export function hideAreaDotTooltip(): void {
  if (scrollBound) {
    window.removeEventListener("scroll", onScroll, true);
    scrollBound = false;
  }
  if (!tipEl) return;
  if (tipEl.matches(":popover-open")) tipEl.hidePopover();
}

/**
 * Collapsed area-card dot tooltip. The first line is the summary those dots
 * already showed. Each rolled-up entity follows, in section order.
 * Floor headers keep the summary alone.
 */
export function areaDotTooltip(
  className: string,
  rollups: readonly SectionRollup[],
  source?: DotTooltipSource,
): string | null {
  const header = dotTooltipLabel(className, rollups);
  if (!header || !source) return header;
  const id = visibleDotRollupId(className);
  if (!id) return header;
  const lines = rollupEntityIds(id, source.sections)
    .map((entityId) => tooltipLine(id, entityId, source))
    .filter((line): line is string => line !== null);
  return lines.length > 0 ? `${header}\n${lines.join("\n")}` : header;
}

/** Bind an immediate tooltip on each visible dot. Empty slots are left alone. */
export function syncAreaDotTooltips(
  root: ParentNode,
  rollups: readonly SectionRollup[],
  source?: DotTooltipSource,
): void {
  root.querySelectorAll(".bubble-sub-button").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (!node.className.includes("area-dot-")) return;
    node.removeAttribute("title");
    const label = areaDotTooltip(node.className, rollups, source);
    if (!label) {
      delete node.dataset.areaTip;
      return;
    }
    node.dataset.areaTip = label;
    if (node.dataset.areaTipBound === "1") return;
    node.dataset.areaTipBound = "1";
    node.addEventListener("pointerenter", () => {
      const text = node.dataset.areaTip;
      if (!text) return;
      showAreaDotTooltip(node, text);
    });
    node.addEventListener("pointerleave", hideAreaDotTooltip);
    node.addEventListener("pointerdown", hideAreaDotTooltip);
  });
}

function tooltipLine(id: RollupId, entityId: string, source: DotTooltipSource): string | null {
  const title = entityTitle(entityId, source.states as Record<string, EntityState>, source.roomName);
  const name = title.startsWith("{{") ? "" : title;
  const stateText = tooltipState(id, entityId, source);
  if (!name) return stateText || null;
  return stateText ? `${name}  ${stateText}` : name;
}

function tooltipState(id: RollupId, entityId: string, source: DotTooltipSource): string {
  const entityState = source.states[entityId];
  if (id === "occupancy") return occupancyStateText(entityId, source);
  if (id === "satellites") return satelliteStateText(entityId, source);
  // On/off lights use the template card's title-cased state, not the formatter.
  if (id === "lights" && !lightExposesControls(entityState)) return titledState(entityState);
  return formattedOrTitled(entityState, source.formatEntityState);
}

function occupancyStateText(entityId: string, source: DotTooltipSource): string {
  const item = source.sections.occupancy.find((entry) => entry.entityId === entityId);
  const base = titledState(source.states[entityId]);
  const pressureId = item?.pressureEntityId;
  if (!pressureId) return base;
  const pressure = source.states[pressureId];
  const raw = pressure?.state ?? "";
  if (!raw || raw === "unknown" || raw === "unavailable" || raw === "none") return base;
  const unit = pressure?.attributes?.unit_of_measurement;
  const suffix = typeof unit === "string" && unit !== "" ? `${raw} ${unit}` : raw;
  return base ? `${base} · ${suffix}` : suffix;
}

function satelliteStateText(entityId: string, source: DotTooltipSource): string {
  const item = source.sections.satellites.find((entry) => entry.entityId === entityId);
  const parts: string[] = [];
  const base = titledState(source.states[entityId]);
  if (base) parts.push(base);
  if (item?.ledEntityId) {
    const led = source.states[item.ledEntityId];
    let text = `LED: ${titledState(led) || "Unknown"}`;
    const brightness = led?.attributes?.brightness;
    if (led?.state === "on" && typeof brightness === "number") {
      text += ` (${Math.round(brightness / 2.55)}%)`;
    }
    parts.push(text);
  }
  if (item?.alarmEntityId) {
    parts.push(`Alarm: ${source.states[item.alarmEntityId]?.state === "on" ? "On" : "Off"}`);
  }
  return parts.join(" · ");
}

function formattedOrTitled(
  entityState: EntityState | undefined,
  format: DotTooltipSource["formatEntityState"],
): string {
  if (format && entityState) {
    try {
      const text = format(entityState);
      if (typeof text === "string" && text.trim() !== "") return text.trim();
    } catch {
      // Fall through to the title-cased state the template rows show.
    }
  }
  return titledState(entityState);
}

function titledState(entityState: EntityState | undefined): string {
  const raw = (entityState?.state ?? "").trim();
  if (raw === "" || raw === "none") return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
