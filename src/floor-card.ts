import { areasOnFloor, floorDisplay, type AreaRef } from "./floors";
import { ROLLUP_ORDER, sectionHasEntities, type RollupId } from "./rollups";
import { classifyArea, type ClassifierHass } from "./sections";

interface FloorCardConfig {
  floor: string;
}

type AreaCardElement = HTMLElement & {
  hass?: ClassifierHass;
  setConfig?: (config: Record<string, unknown>) => void;
};

const CONFIG_FORM = {
  schema: [
    {
      name: "floor",
      required: true,
      selector: { floor: {} },
    },
  ],
};

class FloorCard extends HTMLElement {
  private _config?: FloorCardConfig;
  private _hass?: ClassifierHass;
  private _expanded = true;
  private headerEl?: HTMLElement;
  private bodyEl?: HTMLElement;
  private areaEls = new Map<string, AreaCardElement>();
  private renderedFloor?: string;
  private renderedAreas?: string;
  private renderedHide?: string;
  private running = false;
  private queued = false;

  static getConfigForm(): typeof CONFIG_FORM {
    return CONFIG_FORM;
  }

  static getStubConfig(hass?: ClassifierHass): FloorCardConfig {
    const first = hass?.floors ? Object.keys(hass.floors)[0] : undefined;
    return { floor: first || "floor" };
  }

  getConfigForm(): typeof CONFIG_FORM {
    return FloorCard.getConfigForm();
  }

  createRenderRoot(): HTMLElement {
    return this;
  }

  getCardSize(): number {
    if (!this._expanded) return 1;
    return 1 + 2 * this.areaEls.size;
  }

  getGridOptions(): { columns: string; rows: string } {
    return { columns: "full", rows: "auto" };
  }

  setConfig(config: { floor?: unknown }): void {
    if (!config || typeof config.floor !== "string" || config.floor.trim() === "") {
      throw new Error("Floor is required");
    }
    if (this._config?.floor !== config.floor) {
      this.headerEl?.remove();
      this.bodyEl?.remove();
      this.headerEl = undefined;
      this.bodyEl = undefined;
      this.areaEls.clear();
      this.renderedFloor = undefined;
      this.renderedAreas = undefined;
      this.renderedHide = undefined;
    }
    this._config = { floor: config.floor };
    this.schedule();
  }

  get hass(): ClassifierHass | undefined {
    return this._hass;
  }

  set hass(value: ClassifierHass) {
    this._hass = value;
    this.schedule();
  }

  connectedCallback(): void {
    this.style.display = "block";
    this.schedule();
  }

  private schedule(): void {
    if (this.running) {
      this.queued = true;
      return;
    }
    this.running = true;
    void this.render()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Floor Card failed to render";
        this.showError(message);
      })
      .finally(() => {
        this.running = false;
        if (this.queued) {
          this.queued = false;
          this.schedule();
        }
      });
  }

  private async render(): Promise<void> {
    if (!this._config || !this._hass) return;

    const hass = this._hass;
    const floorId = this._config.floor;
    const { name, icon } = floorDisplay(hass, floorId);
    const areas = areasOnFloor(hass, floorId);
    const areasKey = areas.map((a) => a.areaId).join(",");
    const hideList = computeFloorHide(hass, areas);
    const hideKey = hideList.join(",");

    // Build the fixed chrome on first render
    if (!this.headerEl) {
      this.headerEl = this.buildHeader();
      this.bodyEl = document.createElement("div");
      this.bodyEl.className = "floor-card-body";
      this.bodyEl.style.cssText = "display:flex;flex-direction:column;gap:8px";
      this.append(this.headerEl, this.bodyEl);
    }

    // Rebuild header content when floor identity changes
    const floorKey = `${floorId}|${name}|${icon}`;
    if (this.renderedFloor !== floorKey) {
      this.populateHeader(this.headerEl, icon, name);
      this.renderedFloor = floorKey;
    }

    // Keep chevron in sync with collapse state
    this.syncChevron();

    this.syncBody();

    // Rebuild area list when membership changes
    if (this.renderedAreas !== areasKey) {
      this.syncAreaCards(areas, hass, hideList);
      this.renderedAreas = areasKey;
      this.renderedHide = hideKey;
    } else if (this.renderedHide !== hideKey) {
      // Area list unchanged but hidden sections changed — update configs only
      for (const [areaId, el] of this.areaEls) {
        el.setConfig?.({ area: areaId, hide_sections: hideList });
      }
      this.renderedHide = hideKey;
    }

    // Always forward hass to every area card
    for (const el of this.areaEls.values()) {
      el.hass = hass;
    }

    this.querySelector("[data-floor-card-error]")?.remove();
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "floor-card-header";
    // Inline styles: the card renders inside a Lovelace shadow tree, so a
    // document stylesheet does not reach it.
    header.style.cssText = [
      "display:flex",
      "align-items:center",
      "box-sizing:border-box",
      "height:calc(var(--row-height, 44px) * 0.8 + var(--row-gap, 8px) * (0.8 - 1))",
      "background:none",
      "overflow:visible",
      "cursor:pointer",
      "user-select:none",
      "color:var(--primary-text-color)",
    ].join(";");
    header.addEventListener("click", () => this.toggle());
    return header;
  }

  private populateHeader(header: HTMLElement, icon: string | null, name: string): void {
    header.innerHTML = "";

    if (icon) {
      const iconEl = document.createElement("ha-icon");
      iconEl.className = "floor-card-icon";
      iconEl.setAttribute("icon", icon);
      iconEl.style.cssText = [
        "display:inline-flex",
        "flex:0 0 auto",
        "width:24px",
        "height:24px",
        "margin:0 22px 0 8px",
        "--mdc-icon-size:24px",
        "color:var(--primary-text-color)",
      ].join(";");
      header.append(iconEl);
    }

    const nameEl = document.createElement("h4");
    nameEl.className = "floor-card-name";
    nameEl.textContent = name;
    nameEl.style.cssText = [
      "display:block",
      "margin:0 30px 0 " + (icon ? "0" : "16px"),
      "padding:0",
      "min-width:0",
      "font-family:inherit",
      "font-size:16px",
      "font-weight:600",
      "line-height:1.6",
      "color:var(--primary-text-color)",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis",
    ].join(";");

    const lineEl = document.createElement("div");
    lineEl.className = "floor-card-line";
    lineEl.style.cssText = [
      "flex:1 1 auto",
      "height:6px",
      "margin:0 14px 0 0",
      "border-radius:6px",
      "opacity:0.6",
      "background-color:var(--bubble-line-background-color, var(--ha-card-background-color, var(--secondary-background-color)))",
    ].join(";");

    const chevronWrap = document.createElement("div");
    chevronWrap.className = "floor-card-chevron";
    chevronWrap.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "flex:0 0 auto",
      "box-sizing:border-box",
      "width:36px",
      "height:36px",
      "margin-left:8px",
      "border-radius:18px",
      "background-color:var(--bubble-icon-background-color, rgba(255, 255, 255, 0.7))",
      "--mdc-icon-size:20px",
      "color:var(--primary-text-color)",
    ].join(";");
    const chevronEl = document.createElement("ha-icon");
    chevronEl.dataset.floorChevron = "";
    chevronEl.setAttribute("icon", this.chevronIcon());
    chevronWrap.append(chevronEl);

    header.append(nameEl, lineEl, chevronWrap);
  }

  private chevronIcon(): string {
    return this._expanded ? "mdi:chevron-up" : "mdi:chevron-down";
  }

  private syncChevron(): void {
    const chevron = this.headerEl?.querySelector<HTMLElement>("[data-floor-chevron]");
    if (chevron) {
      chevron.setAttribute("icon", this.chevronIcon());
    }
  }

  private syncAreaCards(areas: AreaRef[], hass: ClassifierHass, hideList: RollupId[]): void {
    const nextEls = new Map<string, AreaCardElement>();
    const fragment = document.createDocumentFragment();

    for (const { areaId } of areas) {
      let el = this.areaEls.get(areaId);
      if (!el) {
        el = document.createElement("area-card") as AreaCardElement;
      }
      el.setConfig?.({ area: areaId, hide_sections: hideList });
      nextEls.set(areaId, el);
      fragment.appendChild(el);
    }

    // Remove elements that belong to areas no longer on this floor
    for (const [areaId, el] of this.areaEls) {
      if (!nextEls.has(areaId)) el.remove();
    }

    if (this.bodyEl) {
      this.bodyEl.innerHTML = "";
      this.bodyEl.appendChild(fragment);
    }

    this.areaEls = nextEls;

    // Forward hass immediately so newly-created cards render
    for (const el of nextEls.values()) {
      el.hass = hass;
    }
  }

  private toggle(): void {
    this._expanded = !this._expanded;
    this.syncChevron();
    this.syncBody();
  }

  private syncBody(): void {
    if (!this.bodyEl) return;
    // An empty display value clears the flex set on the body, so the 8px gap
    // never applies and the area cards stack with no column gap.
    this.bodyEl.style.display = this._expanded ? "flex" : "none";
  }

  private showError(message: string): void {
    let error = this.querySelector("[data-floor-card-error]");
    if (!error) {
      error = document.createElement("div");
      error.setAttribute("data-floor-card-error", "");
      this.append(error);
    }
    error.textContent = message;
  }
}

function computeFloorHide(hass: ClassifierHass, areas: AreaRef[]): RollupId[] {
  if (areas.length === 0) return [];
  const sectionsList = areas.map((a) => classifyArea(hass, a.areaId));
  return ROLLUP_ORDER.filter((id) => sectionsList.every((s) => !sectionHasEntities(id, s)));
}

if (!customElements.get("floor-card")) {
  customElements.define("floor-card", FloorCard);
}

type CustomCard = {
  type: string;
  name: string;
  description: string;
  preview: boolean;
};

const registry = window as Window & { customCards?: CustomCard[] };
registry.customCards = registry.customCards || [];
if (!registry.customCards.some((card) => card.type === "floor-card")) {
  registry.customCards.push({
    type: "floor-card",
    name: "Floor Card",
    description: "Collapsible floor header with one Area Card per area on the floor",
    preview: true,
  });
}
