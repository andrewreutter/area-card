import { loadDisabledAutomations } from "./automations";
import { buildButtonConfig } from "./button-config";
import { hideAreaDotTooltip, syncAreaDotTooltips } from "./dot-tooltip";
import { ensureDeps } from "./ensure-deps";
import "./floor-card";
import "./floors-card";
import "./light-row";
import "./section-title";
import { buildPopupConfig } from "./popup-cards";
import { areaSettingsPath, insertAreaEditButton } from "./popup-chrome";
import { collapsedDotSlots, parseHideSections, ROLLUP_ORDER, sectionRollups, sectionTitle, type RollupId, type SectionRollup, withoutSections } from "./rollups";
import { areaDisplay, areaUnavailable, classifyArea, membershipKey, type ClassifierHass } from "./sections";
import { BUBBLE_ELEMENT } from "./tags";

interface AreaCardConfig {
  area: string;
  hide_sections: RollupId[];
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
    {
      name: "hide_sections",
      selector: {
        select: {
          multiple: true,
          options: ROLLUP_ORDER.map((id) => ({ value: id, label: sectionTitle(id) })),
        },
      },
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
  private dotRollups: SectionRollup[] = [];
  private tooltipHost?: HTMLElement;
  private tooltipObserver?: MutationObserver;
  private tooltipFrame = 0;
  private tooltipTries = 0;
  private editHost?: HTMLElement;
  private editObserver?: MutationObserver;
  private editFrame = 0;
  private editTries = 0;
  private editAreaId?: string;

  static getConfigForm(): typeof CONFIG_FORM {
    return CONFIG_FORM;
  }

  static getStubConfig(hass?: ClassifierHass): AreaCardConfig {
    const first = hass?.areas ? Object.keys(hass.areas)[0] : undefined;
    return { area: first || "area", hide_sections: [] };
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

  setConfig(config: { area?: unknown; hide_sections?: unknown }): void {
    if (!config || typeof config.area !== "string" || config.area.trim() === "") {
      throw new Error("Area is required");
    }
    const hide = parseHideSections(config.hide_sections);
    this._config = { area: config.area, hide_sections: hide };
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

  disconnectedCallback(): void {
    this.stopDotTooltipWatch();
    this.stopAreaEditWatch();
    hideAreaDotTooltip();
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
    const { name, icon, picture } = areaDisplay(hass, areaId);
    const sections = classifyArea(hass, areaId);
    const disabled = await loadDisabledAutomations(hass, sections.automations);
    if (!this._config || this._hass !== hass || this._config.area !== areaId) return;
    const hide = this._config.hide_sections;
    const unavailable = areaUnavailable(hass, areaId, disabled);
    const visibleSections = withoutSections(sections, hide);
    const signature = membershipKey(areaId, name, icon, sections);
    const states = hass.states ?? {};
    this.dotRollups = sectionRollups(visibleSections, states, disabled);
    const formatEntityState = hass.formatEntityState;
    const buttonConfig = buildButtonConfig({
      areaId,
      name,
      icon,
      sections: visibleSections,
      states,
      dotSlots: collapsedDotSlots(hide),
      picture,
      unavailable,
      disabledAutomations: disabled,
      alignDots: !!this.closest("floor-card"),
      formatEntityState: typeof formatEntityState === "function" ? formatEntityState.bind(hass) : undefined,
    });
    const popupConfig = buildPopupConfig(areaId, name, icon, visibleSections, states, picture, disabled);
    const buttonKey = JSON.stringify(buttonConfig);
    const popupKey = JSON.stringify(popupConfig);

    if (this.signature !== signature || !this.buttonEl || !this.popupEl) {
      hideAreaDotTooltip();
      this.stopDotTooltipWatch();
      this.stopAreaEditWatch();
      this.buttonEl?.remove();
      this.popupEl?.remove();
      this.buttonEl = document.createElement(BUBBLE_ELEMENT) as BubbleElement;
      this.popupEl = document.createElement(BUBBLE_ELEMENT) as BubbleElement;
      // Bubble's host is inline-block. The closed popup is 0px tall and still
      // wraps onto a line box under the button, which shows up as extra padding.
      this.buttonEl.style.display = "block";
      this.popupEl.style.display = "block";
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
    this.watchDotTooltips();
    this.watchAreaEdit(areaId);
    this.querySelector("[data-area-card-error]")?.remove();
  }

  private stopDotTooltipWatch(): void {
    this.tooltipObserver?.disconnect();
    this.tooltipObserver = undefined;
    if (this.tooltipFrame) cancelAnimationFrame(this.tooltipFrame);
    this.tooltipFrame = 0;
    this.tooltipHost = undefined;
    this.tooltipTries = 0;
  }

  private watchDotTooltips(): void {
    const host = this.buttonEl;
    if (!host) return;
    if (this.tooltipHost === host) {
      this.applyDotTooltips();
      return;
    }
    this.stopDotTooltipWatch();
    this.tooltipHost = host;
    const attach = () => {
      if (this.buttonEl !== host || !this.isConnected) return;
      const root = host.shadowRoot;
      if (!root) {
        if (this.tooltipTries++ < 90) this.tooltipFrame = requestAnimationFrame(attach);
        return;
      }
      this.applyDotTooltips();
      this.tooltipObserver = new MutationObserver(() => this.applyDotTooltips());
      this.tooltipObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    };
    attach();
  }

  private applyDotTooltips(): void {
    const root = this.buttonEl?.shadowRoot;
    if (!root) return;
    syncAreaDotTooltips(root, this.dotRollups);
  }

  private stopAreaEditWatch(): void {
    this.editObserver?.disconnect();
    this.editObserver = undefined;
    if (this.editFrame) cancelAnimationFrame(this.editFrame);
    this.editFrame = 0;
    this.editHost = undefined;
    this.editTries = 0;
  }

  // Bubble rebuilds header actions, so a one-time gear insert disappears.
  private watchAreaEdit(areaId: string): void {
    const host = this.popupEl;
    this.editAreaId = areaId;
    if (!host) return;
    if (this.editHost === host) {
      this.applyAreaEdit();
      return;
    }
    this.stopAreaEditWatch();
    this.editAreaId = areaId;
    this.editHost = host;
    const attach = () => {
      if (this.popupEl !== host || !this.isConnected) return;
      const root = host.shadowRoot;
      if (!root) {
        if (this.editTries++ < 90) this.editFrame = requestAnimationFrame(attach);
        return;
      }
      this.applyAreaEdit();
      this.editObserver = new MutationObserver(() => this.applyAreaEdit());
      this.editObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    };
    attach();
  }

  private applyAreaEdit(): void {
    const root = this.popupEl?.shadowRoot;
    const areaId = this.editAreaId;
    if (!root || !areaId) return;
    const actions = root.querySelector(".bubble-header-actions");
    if (!actions) return;
    const close = actions.querySelector(".bubble-close-button");
    if (!close || close.previousElementSibling?.classList.contains("area-card-edit-area")) return;
    insertAreaEditButton(actions, this.areaEditButton(areaId));
  }

  private areaEditButton(areaId: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bubble-header-action-button area-card-edit-area";
    button.setAttribute("aria-label", "Edit area");
    button.style.padding = "0";
    button.style.border = "none";
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:cog");
    icon.setAttribute("aria-hidden", "true");
    icon.style.setProperty("--mdc-icon-size", "24px");
    button.append(icon);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.history.pushState({ from }, "", areaSettingsPath(areaId));
      window.dispatchEvent(
        new CustomEvent("location-changed", {
          bubbles: true,
          composed: true,
          detail: { replace: false },
        }),
      );
    });
    return button;
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
