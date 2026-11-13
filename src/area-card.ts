import { buildButtonConfig } from "./button-config";
import { ensureDeps } from "./ensure-deps";
import { buildPopupConfig } from "./popup-cards";
import {
  areaDisplay,
  classifyArea,
  membershipKey,
  pickRepresentative,
  type ClassifierHass,
} from "./sections";
import { BUBBLE_ELEMENT } from "./tags";

interface AreaCardConfig {
  area: string;
}

interface BubbleElement extends HTMLElement {
  hass?: ClassifierHass;
  setConfig?: (config: Record<string, unknown>) => void;
}

const CONFIG_FORM = {
  schema: [
    {
      name: "area",
      required: true,
      selector: { area: {} },
    },
  ],
};

class AreaCard extends HTMLElement {
  private _config?: AreaCardConfig;
  private _hass?: ClassifierHass;
  private buttonEl?: BubbleElement;
  private popupEl?: BubbleElement;
  private signature?: string;
  private buttonKey?: string;
  private popupKey?: string;
  private running = false;
  private queued = false;

  static getConfigForm(): typeof CONFIG_FORM {
    return CONFIG_FORM;
  }

  static getStubConfig(hass?: ClassifierHass): AreaCardConfig {
    const first = hass?.areas ? Object.keys(hass.areas)[0] : undefined;
    return { area: first || "area" };
  }

  getConfigForm(): typeof CONFIG_FORM {
    return AreaCard.getConfigForm();
  }

  createRenderRoot(): HTMLElement {
    return this;
  }

  getCardSize(): number {
    return 2;
  }

  setConfig(config: { area?: unknown }): void {
    if (!config || typeof config.area !== "string" || config.area.trim() === "") {
      throw new Error("Area is required");
    }
    this._config = { area: config.area };
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
        const message = error instanceof Error ? error.message : "Area Card failed to render";
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
    await ensureDeps();
    if (!this._config || !this._hass) return;

    const hass = this._hass;
    const areaId = this._config.area;
    const { name, icon } = areaDisplay(hass, areaId);
    const sections = classifyArea(hass, areaId);
    const signature = membershipKey(areaId, name, icon, sections);
    const lightRepresentative = pickRepresentative(sections.lights, hass.states ?? {}, "light");
    const occupancyRepresentative = pickRepresentative(
      sections.occupancy.map((item) => item.entityId),
      hass.states ?? {},
      "presence",
    );
    const buttonConfig = buildButtonConfig({
      areaId,
      name,
      icon,
      sections,
      lightRepresentative,
      occupancyRepresentative,
    });
    const popupConfig = buildPopupConfig(areaId, name, icon, sections, hass.states ?? {});
    const buttonKey = JSON.stringify(buttonConfig);
    const popupKey = JSON.stringify(popupConfig);

    if (this.signature !== signature || !this.buttonEl || !this.popupEl) {
      this.buttonEl?.remove();
      this.popupEl?.remove();
      this.buttonEl = document.createElement(BUBBLE_ELEMENT) as BubbleElement;
      this.popupEl = document.createElement(BUBBLE_ELEMENT) as BubbleElement;
      this.dataset.area = areaId;
      this.append(this.buttonEl, this.popupEl);
      this.signature = signature;
      this.buttonKey = undefined;
      this.popupKey = undefined;
    }

    if (this.buttonKey !== buttonKey) {
      this.buttonEl.setConfig?.(buttonConfig);
      this.buttonKey = buttonKey;
    }
    if (this.popupKey !== popupKey) {
      this.popupEl.setConfig?.(popupConfig);
      this.popupKey = popupKey;
    }

    this.buttonEl.hass = hass;
    this.popupEl.hass = hass;
    this.querySelector("[data-area-card-error]")?.remove();
  }

  private showError(message: string): void {
    let error = this.querySelector("[data-area-card-error]");
    if (!error) {
      error = document.createElement("div");
      error.setAttribute("data-area-card-error", "");
      this.append(error);
    }
    error.textContent = message;
  }
}

if (!customElements.get("area-card")) {
  customElements.define("area-card", AreaCard);
}

type CustomCard = {
  type: string;
  name: string;
  description: string;
  preview: boolean;
};

const registry = window as Window & { customCards?: CustomCard[] };
registry.customCards = registry.customCards || [];
if (!registry.customCards.some((card) => card.type === "area-card")) {
  registry.customCards.push({
    type: "area-card",
    name: "Area Card",
    description: "Area summary button and popup",
    preview: true,
  });
}
