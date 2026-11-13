import { floorIds } from "./floors";
import type { ClassifierHass } from "./sections";

type FloorCardElement = HTMLElement & {
  hass?: ClassifierHass;
  setConfig(config: { floor: string }): void;
};

const CONFIG_FORM = { schema: [] };

class FloorsCard extends HTMLElement {
  private configured = false;
  private _hass?: ClassifierHass;
  private floorEls = new Map<string, FloorCardElement>();
  private listEl?: HTMLElement;
  private renderedFloors?: string;
  private running = false;
  private queued = false;

  static getConfigForm(): typeof CONFIG_FORM {
    return CONFIG_FORM;
  }

  static getStubConfig(): Record<string, never> {
    return {};
  }

  getConfigForm(): typeof CONFIG_FORM {
    return FloorsCard.getConfigForm();
  }

  createRenderRoot(): HTMLElement {
    return this;
  }

  getCardSize(): number {
    return Math.max(1, this.floorEls.size);
  }

  getGridOptions(): { columns: string; rows: string } {
    return { columns: "full", rows: "auto" };
  }

  setConfig(config: unknown): void {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid configuration");
    }
    this.configured = true;
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
        const message = error instanceof Error ? error.message : "Floors Card failed to render";
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
    if (!this.configured || !this._hass) return;

    const hass = this._hass;
    const ids = floorIds(hass);
    // The floor registry has not arrived. Draw nothing.
    if (ids === undefined) return;

    const key = ids.join(",");
    if (this.renderedFloors !== key) {
      if (ids.length === 0) {
        this.clearFloors();
        this.showEmpty();
      } else {
        this.querySelector("[data-floors-card-empty]")?.remove();
        this.syncFloorCards(ids);
      }
      this.renderedFloors = key;
    }

    for (const el of this.floorEls.values()) {
      el.hass = hass;
    }

    this.querySelector("[data-floors-card-error]")?.remove();
  }

  private syncFloorCards(ids: string[]): void {
    if (!this.listEl) {
      this.listEl = document.createElement("div");
      this.listEl.style.cssText = "display:flex;flex-direction:column;gap:8px";
      this.append(this.listEl);
    }

    const nextEls = new Map<string, FloorCardElement>();
    const fragment = document.createDocumentFragment();

    for (const floorId of ids) {
      let el = this.floorEls.get(floorId);
      if (!el) {
        el = document.createElement("floor-card") as FloorCardElement;
        el.setConfig({ floor: floorId });
      }
      nextEls.set(floorId, el);
      // Move keepers out of the live list before dropping nodes, so a reorder
      // keeps collapse state and an open popup.
      fragment.appendChild(el);
    }

    for (const [floorId, el] of this.floorEls) {
      if (!nextEls.has(floorId)) el.remove();
    }

    this.listEl.appendChild(fragment);
    this.floorEls = nextEls;
  }

  private clearFloors(): void {
    for (const el of this.floorEls.values()) el.remove();
    this.floorEls.clear();
    this.listEl?.remove();
    this.listEl = undefined;
  }

  private showEmpty(): void {
    let empty = this.querySelector<HTMLElement>("[data-floors-card-empty]");
    if (!empty) {
      empty = document.createElement("div");
      empty.setAttribute("data-floors-card-empty", "");
      empty.style.cssText = "padding:16px; color:var(--secondary-text-color); font-size:14px";
      this.append(empty);
    }
    empty.textContent = "No floors";
  }

  private showError(message: string): void {
    let error = this.querySelector("[data-floors-card-error]");
    if (!error) {
      error = document.createElement("div");
      error.setAttribute("data-floors-card-error", "");
      this.append(error);
    }
    error.textContent = message;
  }
}

if (!customElements.get("floors-card")) {
  customElements.define("floors-card", FloorsCard);
}

type CustomCard = {
  type: string;
  name: string;
  description: string;
  preview: boolean;
  documentationURL: string;
};

const registry = window as Window & { customCards?: CustomCard[] };
registry.customCards = registry.customCards || [];
if (!registry.customCards.some((card) => card.type === "floors-card")) {
  registry.customCards.push({
    type: "floors-card",
    name: "Floors Card",
    description: "One Floor Card for each floor",
    preview: true,
    documentationURL: "https://github.com/Helpmeeters/area-card#floors-card",
  });
}
