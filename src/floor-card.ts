import { areasOnFloor, floorDisplay, type AreaRef } from "./floors";
import type { ClassifierHass } from "./sections";

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

    // Keep body visibility in sync with collapse state
    if (this.bodyEl) {
      this.bodyEl.style.display = this._expanded ? "" : "none";
    }

    // Rebuild area list when membership changes
    if (this.renderedAreas !== areasKey) {
      this.syncAreaCards(areas, hass);
      this.renderedAreas = areasKey;
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
    header.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:4px 0 8px;cursor:pointer;user-select:none";
    header.addEventListener("click", () => this.toggle());
    return header;
  }

  private populateHeader(header: HTMLElement, icon: string, name: string): void {
    header.innerHTML = "";

    const iconEl = document.createElement("ha-icon");
    iconEl.setAttribute("icon", icon);
    iconEl.style.cssText = "--mdc-icon-size:20px;flex-shrink:0";

    const nameEl = document.createElement("span");
    nameEl.className = "floor-card-name";
    nameEl.textContent = name;
    nameEl.style.cssText =
      "flex:1;font-weight:500;font-size:var(--paper-font-subhead_-_font-size,1rem);" +
      "color:var(--primary-text-color,inherit)";

    const chevronEl = document.createElement("ha-icon");
    chevronEl.setAttribute("icon", "mdi:chevron-down");
    chevronEl.dataset.floorChevron = "";
    chevronEl.style.cssText = `flex-shrink:0;--mdc-icon-size:20px;transition:transform 0.2s;transform:rotate(${this._expanded ? "0" : "-90"}deg)`;

    header.append(iconEl, nameEl, chevronEl);
  }

  private syncChevron(): void {
    const chevron = this.headerEl?.querySelector<HTMLElement>("[data-floor-chevron]");
    if (chevron) {
      chevron.style.transform = `rotate(${this._expanded ? "0" : "-90"}deg)`;
    }
  }

  private syncAreaCards(areas: AreaRef[], hass: ClassifierHass): void {
    const nextEls = new Map<string, AreaCardElement>();
    const fragment = document.createDocumentFragment();

    for (const { areaId } of areas) {
      let el = this.areaEls.get(areaId);
      if (!el) {
        el = document.createElement("area-card") as AreaCardElement;
        el.setConfig?.({ area: areaId });
      }
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
    if (this.bodyEl) {
      this.bodyEl.style.display = this._expanded ? "" : "none";
    }
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
