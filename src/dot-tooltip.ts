import { dotTooltipLabel, type SectionRollup } from "./rollups";

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
        white-space: nowrap;
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

/** Bind an immediate tooltip on each visible dot. Empty slots are left alone. */
export function syncAreaDotTooltips(root: ParentNode, rollups: readonly SectionRollup[]): void {
  root.querySelectorAll(".bubble-sub-button").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (!node.className.includes("area-dot-")) return;
    node.removeAttribute("title");
    const label = dotTooltipLabel(node.className, rollups);
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
