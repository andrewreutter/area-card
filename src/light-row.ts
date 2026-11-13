import type { ClassifierHass } from "./sections";

interface LightRowConfig {
  card?: Record<string, unknown>;
  led_entity?: string;
}

interface CardElement extends HTMLElement {
  hass?: ClassifierHass;
  setConfig?: (config: Record<string, unknown>) => void;
  getCardSize?: () => number;
  getGridOptions?: () => { columns?: number; rows?: number | string };
}

interface ServiceHass extends ClassifierHass {
  callService?: (domain: string, service: string, data?: Record<string, unknown>) => Promise<unknown>;
}

const LED_ON = "rgb(255, 193, 7)";
const LED_OFF_RING = "rgb(158, 158, 158)";

function tagForType(type: unknown): string | undefined {
  if (typeof type !== "string" || !type.startsWith("custom:")) return undefined;
  return type.slice("custom:".length);
}

class AreaCardLightRow extends HTMLElement {
  private config?: LightRowConfig;
  private _hass?: ServiceHass;
  private cardEl?: CardElement;
  private dotEl?: HTMLButtonElement;
  private cardType?: string;

  createRenderRoot(): HTMLElement {
    return this;
  }

  getCardSize(): number {
    return this.cardEl?.getCardSize?.() ?? 1;
  }

  getGridOptions(): { columns?: number; rows?: number | string } {
    return this.cardEl?.getGridOptions?.() ?? { columns: 12 };
  }

  setConfig(config: LightRowConfig): void {
    this.config = config;
    this.mount();
  }

  set hass(value: ServiceHass) {
    this._hass = value;
    if (this.cardEl) this.cardEl.hass = value;
    this.paintDot();
  }

  get hass(): ServiceHass | undefined {
    return this._hass;
  }

  connectedCallback(): void {
    this.style.display = "block";
    this.style.position = "relative";
    this.mount();
  }

  private mount(): void {
    const card = this.config?.card;
    const tag = tagForType(card?.type);
    if (!card || !tag) return;
    if (!this.cardEl || this.cardType !== card.type) {
      this.cardEl?.remove();
      this.cardEl = document.createElement(tag) as CardElement;
      this.cardType = String(card.type);
      this.insertBefore(this.cardEl, this.dotEl ?? null);
    }
    this.cardEl.setConfig?.(card);
    if (this._hass) this.cardEl.hass = this._hass;
    this.paintDot();
  }

  private paintDot(): void {
    const entity = this.config?.led_entity;
    if (!entity) {
      this.dotEl?.remove();
      this.dotEl = undefined;
      return;
    }
    const dot = this.ensureDot();
    const on = this._hass?.states?.[entity]?.state === "on";
    dot.dataset.on = on ? "true" : "false";
    dot.dataset.entity = entity;
    dot.style.background = on ? LED_ON : "transparent";
    dot.style.boxShadow = on ? "none" : `inset 0 0 0 1.5px ${LED_OFF_RING}`;
  }

  private ensureDot(): HTMLButtonElement {
    if (this.dotEl) return this.dotEl;
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "area-card-led-dot";
    dot.setAttribute("aria-label", "LED");
    dot.dataset.areaLedDot = "";
    Object.assign(dot.style, {
      position: "absolute",
      right: "16px",
      top: "24px",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      border: "none",
      padding: "0",
      margin: "0",
      zIndex: "3",
      cursor: "pointer",
      boxSizing: "border-box",
      appearance: "none",
    });
    dot.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    dot.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const led = this.config?.led_entity;
      if (!led || !this._hass?.callService) return;
      void this._hass.callService("switch", "toggle", { entity_id: led });
    });
    this.dotEl = dot;
    this.append(dot);
    return dot;
  }
}

if (!customElements.get("area-card-light-row")) {
  customElements.define("area-card-light-row", AreaCardLightRow);
}
