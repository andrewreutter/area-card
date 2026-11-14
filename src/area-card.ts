import { syncAutomationSubtitle } from "./automation-subtitle";
import { loadDisabledAutomations } from "./automations";
import { buildButtonConfig, type ButtonConfigInput } from "./button-config";
import {
  absoluteStreamUrl,
  autoplayRejected,
  cameraFrameReady,
  cameraAccessToken,
  createCameraStreamPlayer,
  ensureCameraStreamPlayer,
  hideCameraPlaybackControls,
  installCameraStreamAuth,
  primeCameraVideo,
  type CameraStreamPlayer,
} from "./camera-video";
import { hideAreaDotTooltip, syncAreaDotTooltips, type DotTooltipSource } from "./dot-tooltip";
import { ensureDeps } from "./ensure-deps";
import "./floor-card";
import "./floors-card";
import "./light-row";
import "./section-title";
import {
  cyclePin,
  layoutPinnedCards,
  pinEntityId,
  pinMode,
  pinnedEdgeRadius,
  pinnedKey,
  pinnedRowsSideBySide,
  pinnedSideBySideGridStyles,
  pinnedSideBySideHostStyles,
  pinnedSideBySideStyles,
  selectPinnedCards,
  type PinnedEdge,
  type PinnedLayoutWidth,
} from "./pinned-entities";
import { syncPinToggles } from "./pin-toggles";
import { visiblePinnedIds, type PinStickyState } from "./pin-visibility";
import {
  buttonPictureSuppressStyles,
  cameraEntityPicture,
  cameraStreamPath,
  cameraSupportsStream,
  cameraVideoScrim,
  clusterPictureWhileVideo,
  CLUSTER_PICTURE_RADIUS,
  clusterPictureProperties,
  collapsedCardPicture,
  firstBackgroundCamera,
  pictureAfterAutoplayFailure,
  pictureAfterCameraLoad,
  picturePlacement,
  pinnedPictureSurfaceStyles,
  type CameraPictureLoad,
} from "./picture";
import { buildPopupConfig } from "./popup-cards";
import { areaSettingsPath, ensureHeaderButtons } from "./popup-chrome";
import { collapsedDotSlots, parseHideSections, ROLLUP_ORDER, sectionRollups, sectionTitle, type RollupId, type SectionRollup, withoutSections } from "./rollups";
import { areaDisplay, areaUnavailable, classifyArea, membershipKey, type ClassifierHass } from "./sections";
import { BUBBLE_ELEMENT } from "./tags";
import { cachedPins, ensureUserData, saveAreaPins, subscribeUserData } from "./user-data";

interface AreaCardConfig {
  area: string;
  hide_sections: RollupId[];
}

interface BubbleElement extends HTMLElement {
  hass?: ClassifierHass;
  setConfig?: (config: Record<string, unknown>) => void;
}

interface PinnedCardElement extends HTMLElement {
  hass?: ClassifierHass;
  config?: Record<string, unknown>;
  load?: () => void;
}

function popupCardsFrom(config: Record<string, unknown>): readonly Record<string, unknown>[] {
  const cards = config.cards;
  if (!Array.isArray(cards)) return [];
  const list: Record<string, unknown>[] = [];
  for (const card of cards) {
    if (card && typeof card === "object" && !Array.isArray(card)) list.push(card as Record<string, unknown>);
  }
  return list;
}

function applyPinnedHostStyle(host: HTMLElement): void {
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.gap = "0";
  host.style.margin = "0";
  host.style.padding = "0";
  host.style.width = "100%";
  host.style.overflow = "visible";
  host.style.borderRadius = "0";
}

function applyPinnedRowStyle(row: HTMLElement): void {
  row.style.display = "flex";
  row.style.flexDirection = "row";
  row.style.flexWrap = "nowrap";
  row.style.alignItems = "stretch";
  row.style.gap = "0";
  row.style.margin = "0";
  row.style.padding = "0";
  row.style.width = "100%";
}

function applyPinnedCardStyle(card: HTMLElement, width: PinnedLayoutWidth): void {
  const half = width === "half";
  card.style.display = "block";
  card.style.boxSizing = "border-box";
  card.style.margin = "0";
  card.style.padding = "0";
  card.style.minWidth = "0";
  card.style.flex = half ? "1 1 50%" : "1 1 100%";
  card.style.width = half ? "50%" : "100%";
  card.style.maxWidth = half ? "50%" : "100%";
}

/** Card element inside hui-card, plus a light row's mushroom card. Not the LED dot. */
function pinnedInnerHosts(card: HTMLElement): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  const roots: ParentNode[] = [];
  if (card.shadowRoot) roots.push(card.shadowRoot);
  roots.push(card);
  for (const root of roots) {
    for (const child of root.children) {
      if (!(child instanceof HTMLElement) || !child.localName.includes("-")) continue;
      hosts.push(child);
      if (child.localName !== "area-card-light-row") continue;
      for (const nested of child.children) {
        if (nested instanceof HTMLElement && nested.localName.startsWith("area-card-mushroom")) hosts.push(nested);
      }
    }
  }
  return hosts;
}

function pinnedChromeReady(card: HTMLElement): boolean {
  const hosts = pinnedInnerHosts(card).filter((host) => host.localName !== "area-card-light-row");
  if (hosts.length === 0) return false;
  return hosts.every((host) => host.shadowRoot?.querySelector("ha-card"));
}

const PIN_SPLIT_STYLE = "area-card-pin-split";
const PIN_SPLIT_ROWS = "area-card-pin-split-rows";

function syncPinnedStyle(root: ParentNode | null | undefined, id: string, text: string | null): void {
  if (!root) return;
  const existing = root.querySelector(`#${CSS.escape(id)}`);
  if (!text) {
    existing?.remove();
    return;
  }
  let style = existing;
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = id;
    root.append(style);
  }
  if (style.textContent !== text) style.textContent = text;
}

function mushroomLayout(host: HTMLElement): HTMLElement | null {
  const found = host.shadowRoot?.querySelector("area-card-mushroom-card");
  return found instanceof HTMLElement ? found : null;
}

/** Direct ha-card children when they are not already a mushroom name and control. */
function stackedCardBlocks(host: HTMLElement): HTMLElement[] {
  const card = host.shadowRoot?.querySelector("ha-card");
  if (!(card instanceof HTMLElement)) return [];
  const blocks = [...card.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
  if (blocks.some((node) => node.localName === "area-card-mushroom-card")) return [];
  return blocks.length >= 2 ? blocks : [];
}

/**
 * An expanded odd double-tall card puts its name and its control in two columns.
 * The stylesheet lives in the card shadow, so the popup config is untouched.
 */
function applyPinnedSideBySide(card: HTMLElement, follow = true): void {
  const sideBySide = card.dataset.pinSplit === "1";
  if (sideBySide) card.style.setProperty("overflow", "visible", "important");
  else card.style.removeProperty("overflow");

  let actionsVisible = false;
  for (const host of pinnedInnerHosts(card)) {
    if (host.localName === "area-card-light-row") continue;
    const root = host.shadowRoot;
    if (!root) continue;
    if (root.querySelector(".actions")) actionsVisible = true;
    const layout = mushroomLayout(host);
    const grid = sideBySide && !layout && stackedCardBlocks(host).length >= 2;
    const hostText = sideBySide
      ? grid
        ? `${pinnedSideBySideHostStyles()}\n${pinnedSideBySideGridStyles()}`
        : pinnedSideBySideHostStyles()
      : null;
    syncPinnedStyle(root, PIN_SPLIT_STYLE, hostText);
    syncPinnedStyle(layout?.shadowRoot, PIN_SPLIT_ROWS, sideBySide && layout ? pinnedSideBySideStyles() : null);
  }

  for (const host of pinnedInnerHosts(card)) {
    if (host.localName !== "area-card-light-row") continue;
    const dot = host.querySelector(".area-card-led-dot");
    if (!(dot instanceof HTMLElement)) continue;
    dot.style.right = sideBySide && actionsVisible ? "calc(50% + 16px)" : "16px";
  }

  if (follow && sideBySide && !actionsVisible && card.isConnected) {
    requestAnimationFrame(() => {
      if (card.isConnected && card.dataset.pinSplit === "1") applyPinnedSideBySide(card, false);
    });
  }
}

function pinnedSplitApplied(card: HTMLElement): boolean {
  if (card.dataset.pinSplit !== "1") return true;
  const hosts = pinnedInnerHosts(card).filter((host) => host.localName !== "area-card-light-row");
  if (hosts.length === 0) return false;
  return hosts.some((host) => {
    const layout = mushroomLayout(host);
    if (layout) return Boolean(layout.shadowRoot?.querySelector(`#${CSS.escape(PIN_SPLIT_ROWS)}`));
    return Boolean(host.shadowRoot?.querySelector(`#${CSS.escape(PIN_SPLIT_STYLE)}`));
  });
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
  private dotTooltipSource?: DotTooltipSource;
  private tooltipHost?: HTMLElement;
  private tooltipObserver?: MutationObserver;
  private tooltipFrame = 0;
  private tooltipTries = 0;
  private editHost?: HTMLElement;
  private editObserver?: MutationObserver;
  private editFrame = 0;
  private editTries = 0;
  private editAreaId?: string;
  private pinEditing = false;
  private pinSticky = new Map<string, PinStickyState>();
  private pinStickyTimer = 0;
  private pinEditEl?: HTMLButtonElement;
  private areaEditEl?: HTMLButtonElement;
  private pinnedEl?: HTMLElement;
  /** Photo painted on the collapsed card. The popup keeps the area picture. */
  private areaPicture: string | null = null;
  /** Area picture from the registry. A camera background does not replace the popup. */
  private areaPhoto: string | null = null;
  private cameraOrder: readonly string[] = [];
  private buttonInput?: ButtonConfigInput;
  private cameraLoads = new Map<string, CameraPictureLoad>();
  /** Last still that loaded for a camera, held while a refreshed URL is loading. */
  private heldCamera: { entityId: string; url: string } | null = null;
  /** Live HLS background. Failed stays failed until the chosen camera changes. */
  private streamState: { entityId: string; phase: "pending" | "playing" | "failed" } | null = null;
  private streamGeneration = 0;
  private streamTimer = 0;
  private resumeTimer = 0;
  /** The video element was created and did not start. The area picture stays up. */
  private autoplayFailed = false;
  private videoPlayer?: CameraStreamPlayer;
  private pinnedRowsVisible = false;
  private popupCards: readonly Record<string, unknown>[] = [];
  private pinnedConfigKey = new WeakMap<HTMLElement, string>();
  private resizeTimer = 0;
  private lastViewport = 0;
  private unsubscribeUserData?: () => void;
  private readonly onResize = () => {
    const width = window.innerWidth;
    if (width === this.lastViewport) return;
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => this.schedule(), 150);
  };

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
    window.addEventListener("resize", this.onResize);
    this.unsubscribeUserData?.();
    this.unsubscribeUserData = subscribeUserData((key: string) => {
      const hass = this._hass;
      const areaId = this._config?.area;
      if (!hass || !areaId || key !== pinnedKey(areaId)) return;
      this.syncPinnedRow(hass, areaId);
      this.applyAreaEdit();
    });
    this.schedule();
  }

  disconnectedCallback(): void {
    this.stopCameraVideo();
    this.unsubscribeUserData?.();
    this.unsubscribeUserData = undefined;
    window.removeEventListener("resize", this.onResize);
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.pinStickyTimer);
    this.pinStickyTimer = 0;
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
    const hass = this._hass;
    const areaId = this._config.area;
    await ensureUserData(hass);
    if (!this._config || this._hass !== hass || this._config.area !== areaId) return;
    await ensureDeps();
    if (!this._config || this._hass !== hass || this._config.area !== areaId) return;
    const { name, icon, picture } = areaDisplay(hass, areaId);
    const sections = classifyArea(hass, areaId);
    const disabled = await loadDisabledAutomations(hass, sections.automations);
    if (!this._config || this._hass !== hass || this._config.area !== areaId) return;
    this.areaPhoto = picture;
    this.cameraOrder = sections.cameras;
    const shownPicture = this.resolveCollapsedPicture(hass, areaId);
    this.areaPicture = shownPicture;
    const hide = this._config.hide_sections;
    const unavailable = areaUnavailable(hass, areaId, disabled);
    const visibleSections = withoutSections(sections, hide);
    const signature = membershipKey(areaId, name, icon, sections);
    const states = hass.states ?? {};
    this.dotRollups = sectionRollups(visibleSections, states, disabled);
    const formatEntityState = hass.formatEntityState;
    const formatState = typeof formatEntityState === "function" ? formatEntityState.bind(hass) : undefined;
    this.dotTooltipSource = {
      sections: visibleSections,
      states,
      roomName: name,
      formatEntityState: formatState,
    };
    const viewportWidth = window.innerWidth;
    this.lastViewport = viewportWidth;
    this.buttonInput = {
      areaId,
      name,
      icon,
      sections: visibleSections,
      states,
      dotSlots: collapsedDotSlots(hide),
      picture: shownPicture,
      unavailable,
      disabledAutomations: disabled,
      alignDots: !!this.closest("floor-card"),
      formatEntityState: formatState,
    };
    const buttonConfig = buildButtonConfig(this.buttonInput);
    const popupConfig = buildPopupConfig(areaId, name, icon, visibleSections, states, picture, disabled, {
      viewportWidth,
      formatEntityState: formatState,
    });
    const buttonKey = JSON.stringify(buttonConfig);
    const popupKey = JSON.stringify(popupConfig);
    this.popupCards = popupCardsFrom(popupConfig);

    if (this.signature !== signature || !this.buttonEl || !this.popupEl) {
      hideAreaDotTooltip();
      this.stopDotTooltipWatch();
      this.stopAreaEditWatch();
      this.pinEditing = false;
      this.buttonEl?.remove();
      this.popupEl?.remove();
      this.buttonEl = document.createElement(BUBBLE_ELEMENT) as BubbleElement;
      this.popupEl = document.createElement(BUBBLE_ELEMENT) as BubbleElement;
      // Bubble's host is inline-block. The closed popup is 0px tall and still
      // wraps onto a line box under the button, which shows up as extra padding.
      this.buttonEl.style.display = "block";
      this.popupEl.style.display = "block";
      this.dataset.area = areaId;
      this.append(this.buttonEl, this.pinnedHost(), this.popupEl);
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
    this.syncPinnedRow(hass, areaId);
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
    syncAreaDotTooltips(root, this.dotRollups, this.dotTooltipSource);
    syncAutomationSubtitle(root);
  }

  private stopAreaEditWatch(): void {
    this.editObserver?.disconnect();
    this.editObserver = undefined;
    if (this.editFrame) cancelAnimationFrame(this.editFrame);
    this.editFrame = 0;
    this.editHost = undefined;
    this.editTries = 0;
    this.pinEditEl = undefined;
    this.areaEditEl = undefined;
  }

  // Bubble rebuilds header actions, so the pencil and gear are reapplied.
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
    if (actions) {
      const pencil = this.headerButton(actions, ".area-card-pin-edit", this.pinEditEl, () => this.pinEditButton());
      const gear = this.headerButton(actions, ".area-card-edit-area", this.areaEditEl, () => this.areaEditButton(areaId));
      this.pinEditEl = pencil;
      this.areaEditEl = gear;
      ensureHeaderButtons(actions, pencil, gear);
      pencil.setAttribute("aria-pressed", this.pinEditing ? "true" : "false");
    }
    syncPinToggles(root, {
      editing: this.pinEditing,
      modeOf: (entityId) => pinMode(cachedPins(areaId), entityId),
      onCycle: (entityId) => this.pinCycled(areaId, entityId),
    });
  }

  private headerButton(
    actions: Element,
    selector: string,
    held: HTMLButtonElement | undefined,
    create: () => HTMLButtonElement,
  ): HTMLButtonElement {
    const found = actions.querySelector(`:scope > ${selector}`);
    if (found instanceof HTMLButtonElement) return found;
    if (held && !held.isConnected) return held;
    return create();
  }

  private pinEditButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bubble-header-action-button area-card-pin-edit";
    button.setAttribute("aria-label", "Choose what shows on the card");
    button.setAttribute("aria-pressed", this.pinEditing ? "true" : "false");
    button.style.padding = "0";
    button.style.border = "none";
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:pencil");
    icon.setAttribute("aria-hidden", "true");
    icon.style.setProperty("--mdc-icon-size", "24px");
    button.append(icon);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.pinEditing = !this.pinEditing;
      this.applyAreaEdit();
    });
    return button;
  }

  private pinCycled(areaId: string, entityId: string): void {
    const hass = this._hass;
    if (!hass || this._config?.area !== areaId) return;
    const next = cyclePin(cachedPins(areaId), entityId);
    void saveAreaPins(hass, areaId, next).then(
      () => {
        if (this._hass !== hass || this._config?.area !== areaId) return;
        this.syncPinnedRow(hass, areaId);
        this.applyAreaEdit();
      },
      () => {
        // A rejected save leaves the cache and the on-screen mode unchanged.
      },
    );
  }

  private pinnedHost(): HTMLElement {
    if (!this.pinnedEl) {
      this.pinnedEl = document.createElement("div");
      this.pinnedEl.className = "area-card-pinned";
    }
    const parent = this.pinnedEl.parentElement;
    const button = this.buttonEl;
    const popup = this.popupEl;
    if (
      parent &&
      parent !== this &&
      button?.parentElement === parent &&
      !(popup && parent.contains(popup))
    ) {
      return this.pinnedEl;
    }
    if (popup?.parentElement && this.pinnedEl.nextElementSibling !== popup) popup.before(this.pinnedEl);
    return this.pinnedEl;
  }

  private syncPinnedRow(hass: ClassifierHass, areaId: string): void {
    const shown = this.resolveCollapsedPicture(hass, areaId);
    this.applyShownPicture(hass, shown);
    this.syncCameraVideo(hass, areaId);
    const host = this.pinnedHost();
    const now = Date.now();
    const pins = cachedPins(areaId);
    const visible = visiblePinnedIds(
      pins,
      (id) => hass.states?.[id]?.state,
      this.pinSticky,
      areaId,
      now,
    );
    this.pinSticky = visible.sticky;
    this.armPinSticky(visible.deadline, now);
    const selected = selectPinnedCards(this.popupCards, visible.ids);
    const layout = layoutPinnedCards(selected);
    this.pinnedRowsVisible = layout.length > 0;
    const wanted = new Set<string>();
    for (const row of layout) {
      for (const item of row.cards) {
        const id = pinEntityId(item.config);
        if (id) wanted.add(id);
      }
    }
    for (const node of [...host.querySelectorAll<HTMLElement>("[data-pin-entity]")]) {
      if (!wanted.has(node.dataset.pinEntity ?? "")) node.remove();
    }

    const rowEls: HTMLElement[] = [];
    for (let index = 0; index < layout.length; index += 1) {
      let rowEl = host.children[index] as HTMLElement | undefined;
      if (!rowEl || rowEl.dataset.pinRow !== "1") {
        rowEl = document.createElement("div");
        rowEl.className = "area-card-pinned-row";
        rowEl.dataset.pinRow = "1";
        host.insertBefore(rowEl, host.children[index] ?? null);
      }
      applyPinnedRowStyle(rowEl);
      rowEls.push(rowEl);
    }

    layout.forEach((row, index) => {
      const rowEl = rowEls[index];
      row.cards.forEach((item, cardIndex) => {
        const id = pinEntityId(item.config);
        if (!id) return;
        const card = this.pinnedCard(host, id, item.config, hass);
        applyPinnedCardStyle(card, item.width);
        if (pinnedRowsSideBySide(item.config, item.width)) card.dataset.pinSplit = "1";
        else delete card.dataset.pinSplit;
        card.dataset.pinEdge = JSON.stringify({
          first: index === 0,
          last: index === layout.length - 1,
          left: cardIndex === 0,
          right: cardIndex === row.cards.length - 1,
        });
        this.watchPinnedChrome(card);
        const at = rowEl.children[cardIndex] ?? null;
        if (at !== card) rowEl.insertBefore(card, at);
      });
    });

    for (const rowEl of rowEls) {
      for (const child of [...rowEl.children]) {
        if (!(child instanceof HTMLElement) || !child.dataset.pinEntity) child.remove();
      }
    }
    while (host.childElementCount > rowEls.length) host.lastElementChild?.remove();

    if (rowEls.length === 0) {
      host.replaceChildren();
      host.style.display = "none";
      this.syncButtonGap(false);
      this.syncPicturePlacement(false);
      return;
    }
    applyPinnedHostStyle(host);
    this.syncButtonGap(true);
    this.syncPicturePlacement(true);
  }

  private pinnedCard(
    host: HTMLElement,
    entityId: string,
    config: Record<string, unknown>,
    hass: ClassifierHass,
  ): PinnedCardElement {
    let card = this.findPinnedCard(host, entityId);
    const key = JSON.stringify(config);
    if (!card) {
      card = document.createElement("hui-card") as PinnedCardElement;
      card.dataset.pinEntity = entityId;
      card.hass = hass;
      card.config = config;
      const load = card.load?.();
      if (load && typeof (load as Promise<void>).then === "function") {
        void (load as Promise<void>).then(() => {
          if (card?.isConnected) this.clearPinnedCardChrome(card);
        });
      }
      this.pinnedConfigKey.set(card, key);
      return card;
    }
    card.hass = hass;
    if (this.pinnedConfigKey.get(card) !== key) {
      card.config = config;
      this.pinnedConfigKey.set(card, key);
    }
    return card;
  }

  private findPinnedCard(host: HTMLElement, entityId: string): PinnedCardElement | null {
    const found = host.querySelector(`[data-pin-entity="${CSS.escape(entityId)}"]`);
    return found instanceof HTMLElement ? (found as PinnedCardElement) : null;
  }

  /** ha-card shows up after hui-card finishes loading. A later state update clears again. */
  private watchPinnedChrome(card: HTMLElement): void {
    this.clearPinnedCardChrome(card);
    if ((pinnedChromeReady(card) && pinnedSplitApplied(card)) || card.dataset.pinChrome === "pending") return;
    card.dataset.pinChrome = "pending";
    const clear = (tries: number) => {
      if (!card.isConnected) return;
      this.clearPinnedCardChrome(card);
      if ((pinnedChromeReady(card) && pinnedSplitApplied(card)) || tries >= 40) {
        delete card.dataset.pinChrome;
        return;
      }
      requestAnimationFrame(() => clear(tries + 1));
    };
    requestAnimationFrame(() => clear(0));
  }

  private clearPinnedCardChrome(card: HTMLElement): void {
    card.style.setProperty("margin", "0", "important");
    const clusterPicture = picturePlacement(this.areaPicture, this.pinnedRowsVisible) === "cluster";
    if (clusterPicture) {
      card.style.setProperty("background", "transparent", "important");
      card.style.setProperty("box-shadow", "none", "important");
      card.style.setProperty("backdrop-filter", "none", "important");
      card.style.setProperty("-webkit-backdrop-filter", "none", "important");
      card.style.setProperty("filter", "none", "important");
      card.style.setProperty("--ha-card-backdrop-filter", "none", "important");
    } else {
      card.style.removeProperty("background");
      card.style.removeProperty("box-shadow");
      card.style.removeProperty("backdrop-filter");
      card.style.removeProperty("-webkit-backdrop-filter");
      card.style.removeProperty("filter");
      card.style.removeProperty("--ha-card-backdrop-filter");
    }
    let edge: PinnedEdge = { first: true, last: true, left: true, right: true };
    try {
      const parsed: unknown = JSON.parse(card.dataset.pinEdge ?? "");
      if (parsed && typeof parsed === "object") edge = { ...edge, ...(parsed as PinnedEdge) };
    } catch {
      // A card created before its row position is known stays fully square on top.
    }
    const radius = pinnedEdgeRadius(edge);
    for (const host of pinnedInnerHosts(card)) {
      host.style.setProperty("margin", "0", "important");
      host.style.setProperty("display", "block", "important");
      host.style.setProperty("width", "100%", "important");
      const root = host.shadowRoot;
      if (!root) continue;
      // Mushroom rewrites ha-card's inline style on each update, which drops a
      // radius set on the element. A stylesheet in the shadow root keeps winning.
      let style = root.querySelector("#area-card-pin-flat");
      if (!(style instanceof HTMLStyleElement)) {
        style = document.createElement("style");
        style.id = "area-card-pin-flat";
        root.append(style);
      }
      const radiusText = `:host{margin:0 !important;display:block !important;width:100% !important}ha-card{margin:0 !important;${radius}}`;
      const text = clusterPicture ? `${radiusText}\n${pinnedPictureSurfaceStyles()}` : radiusText;
      if (style.textContent !== text) style.textContent = text;
    }
    applyPinnedSideBySide(card);
  }

  /** One timer for the soonest while-on grace. Cleared on every rearm and on disconnect. */
  private armPinSticky(deadline: number | undefined, now: number): void {
    window.clearTimeout(this.pinStickyTimer);
    this.pinStickyTimer = 0;
    if (deadline === undefined) return;
    this.pinStickyTimer = window.setTimeout(() => {
      const hass = this._hass;
      const areaId = this._config?.area;
      if (!this.isConnected || !hass || !areaId) return;
      this.syncPinnedRow(hass, areaId);
    }, Math.max(0, deadline - now));
  }

  /**
   * Still under the collapsed card, and the fallback when the camera video is
   * missing or fails. The popup is built with the area picture.
   * The first camera in area order wins. No still, or a still that fails to
   * load, leaves the area picture in place.
   */
  private resolveCollapsedPicture(hass: ClassifierHass, areaId: string): string | null {
    const area = this.areaPhoto && this.areaPhoto.length > 0 ? this.areaPhoto : null;
    const background = cachedPins(areaId).background ?? [];
    const chosen = firstBackgroundCamera(this.cameraOrder, background);
    const candidate = collapsedCardPicture(area, this.cameraOrder, background, (id) => {
      const raw = cameraEntityPicture(hass.states?.[id]);
      if (!raw) return null;
      return typeof hass.hassUrl === "function" ? hass.hassUrl(raw) : raw;
    });
    const cameraUrl = candidate && candidate !== area ? candidate : null;
    if (!cameraUrl || !chosen) {
      this.heldCamera = null;
      return area;
    }
    if (!this.cameraLoads.has(cameraUrl)) this.probeCamera(cameraUrl, areaId);
    const load = this.cameraLoads.get(cameraUrl);
    const held = this.heldCamera?.entityId === chosen ? this.heldCamera.url : null;
    const shown = pictureAfterCameraLoad(area, cameraUrl, load, held);
    if (load === "loaded") this.heldCamera = { entityId: chosen, url: cameraUrl };
    else if (load === "failed") this.heldCamera = null;
    return pictureAfterAutoplayFailure(area, this.autoplayFailed, shown);
  }

  private probeCamera(url: string, areaId: string): void {
    this.cameraLoads.set(url, "pending");
    const image = new Image();
    const finish = (status: "loaded" | "failed") => {
      this.cameraLoads.set(url, status);
      queueMicrotask(() => {
        if (!this.isConnected || this._config?.area !== areaId) return;
        const hass = this._hass;
        if (!hass) return;
        const shown = this.resolveCollapsedPicture(hass, areaId);
        const previous = this.areaPicture;
        this.applyShownPicture(hass, shown);
        if (shown !== previous) this.syncPicturePlacement(this.pinnedRowsVisible);
      });
    };
    image.onload = () => finish("loaded");
    image.onerror = () => finish("failed");
    image.src = url;
  }

  /** Rebuilds the collapsed button when its photo changes. The popup config is left alone. */
  private applyShownPicture(hass: ClassifierHass, shown: string | null): void {
    if (shown === this.areaPicture) return;
    this.areaPicture = shown;
    if (!this.buttonInput || !this.buttonEl) return;
    this.buttonInput = { ...this.buttonInput, picture: shown };
    const buttonConfig = buildButtonConfig(this.buttonInput);
    const buttonKey = JSON.stringify(buttonConfig);
    if (this.buttonKey === buttonKey) return;
    this.buttonEl.setConfig?.(buttonConfig);
    this.buttonKey = buttonKey;
    this.buttonEl.hass = hass;
  }

  private cameraVideoCovers(): boolean {
    const phase = this.streamState?.phase;
    return phase === "pending" || phase === "playing";
  }

  /** Start the chosen camera's muted HLS video, or leave the still in place. */
  private syncCameraVideo(hass: ClassifierHass, areaId: string): void {
    const chosen = firstBackgroundCamera(this.cameraOrder, cachedPins(areaId).background ?? []);
    if (!chosen || !cameraSupportsStream(hass.states?.[chosen])) {
      this.stopCameraVideo();
      return;
    }
    if (this.streamState?.entityId === chosen) return;
    this.startCameraVideo(hass, areaId, chosen);
  }

  private stopCameraVideo(): void {
    if (!this.streamState && !this.videoPlayer && !this.streamTimer && !this.resumeTimer) return;
    this.streamGeneration += 1;
    this.clearStreamTimers();
    this.autoplayFailed = false;
    this.streamState = null;
    this.videoPlayer?.remove();
    this.videoPlayer = undefined;
    this.querySelector(".area-card-camera-video")?.remove();
  }

  private clearStreamTimers(): void {
    window.clearTimeout(this.streamTimer);
    window.clearTimeout(this.resumeTimer);
    this.streamTimer = 0;
    this.resumeTimer = 0;
  }

  private startCameraVideo(hass: ClassifierHass, areaId: string, entityId: string): void {
    const generation = ++this.streamGeneration;
    this.clearStreamTimers();
    this.autoplayFailed = false;
    this.videoPlayer?.remove();
    this.videoPlayer = undefined;
    this.streamState = { entityId, phase: "pending" };
    void this.openCameraVideo(hass, areaId, entityId, generation);
  }

  private failCameraVideo(entityId: string, generation: number): void {
    if (generation !== this.streamGeneration) return;
    this.clearStreamTimers();
    this.videoPlayer?.remove();
    this.videoPlayer = undefined;
    this.streamState = { entityId, phase: "failed" };
    const hass = this._hass;
    const areaId = this._config?.area;
    if (hass && areaId) this.applyShownPicture(hass, this.resolveCollapsedPicture(hass, areaId));
    this.syncPicturePlacement(this.pinnedRowsVisible);
  }

  /**
   * Play the HLS playlist Home Assistant already serves. The player is muted
   * and started with play() once its video element is connected. If that start
   * is refused, the area picture stays and the player is removed.
   */
  private async openCameraVideo(
    hass: ClassifierHass,
    areaId: string,
    entityId: string,
    generation: number,
  ): Promise<void> {
    const current = () =>
      generation === this.streamGeneration && this.isConnected && this._config?.area === areaId;
    try {
      if (typeof hass.callWS !== "function") {
        this.failCameraVideo(entityId, generation);
        return;
      }
      installCameraStreamAuth(() => cameraAccessToken(this._hass));
      const call = hass.callWS as (message: Record<string, unknown>) => Promise<unknown>;
      const result = await call({ type: "camera/stream", entity_id: entityId, format: "hls" });
      if (!current()) return;
      const path = cameraStreamPath(result);
      if (!path) {
        this.failCameraVideo(entityId, generation);
        return;
      }
      const absolute = absoluteStreamUrl(path, (value) =>
        typeof hass.hassUrl === "function" ? hass.hassUrl(value) : value,
      );
      const ready = await ensureCameraStreamPlayer();
      if (!current()) return;
      if (!ready) {
        this.failCameraVideo(entityId, generation);
        return;
      }
      const player = createCameraStreamPlayer(entityId);
      this.videoPlayer = player;
      this.streamTimer = window.setTimeout(() => {
        if (generation !== this.streamGeneration || this.streamState?.phase === "playing") return;
        this.autoplayFailed = true;
        this.failCameraVideo(entityId, generation);
      }, 12_000);
      this.syncPicturePlacement(this.pinnedRowsVisible);
      player.url = absolute;
      this.armCameraPlayback(player, entityId, generation);
    } catch {
      this.failCameraVideo(entityId, generation);
    }
  }

  /** Mute, hide the start control, and call play() until the stream is actually running. */
  private armCameraPlayback(player: CameraStreamPlayer, entityId: string, generation: number): void {
    let starting = false;
    const markPlaying = () => {
      if (generation !== this.streamGeneration || this.streamState?.phase === "failed") return;
      window.clearTimeout(this.streamTimer);
      this.streamTimer = 0;
      if (this.streamState?.phase === "playing") return;
      this.streamState = { entityId, phase: "playing" };
      this.syncPicturePlacement(this.pinnedRowsVisible);
    };
    const tick = () => {
      if (generation !== this.streamGeneration || this.streamState?.phase === "failed") return;
      hideCameraPlaybackControls(player);
      const video = primeCameraVideo(player);
      if (cameraFrameReady(video)) {
        markPlaying();
        this.resumeTimer = window.setTimeout(tick, 1000);
        return;
      }
      if (this.streamState?.phase === "playing") {
        this.streamState = { entityId, phase: "pending" };
        this.syncPicturePlacement(this.pinnedRowsVisible);
      }
      if (video && !starting) {
        starting = true;
        const attempt = video.play();
        if (attempt && typeof attempt.then === "function") {
          void attempt.then(
            () => {
              starting = false;
              if (cameraFrameReady(video)) markPlaying();
            },
            (error: unknown) => {
              starting = false;
              if (generation !== this.streamGeneration || !autoplayRejected(error)) return;
              this.autoplayFailed = true;
              this.failCameraVideo(entityId, generation);
            },
          );
        } else starting = false;
      }
      this.resumeTimer = window.setTimeout(tick, 200);
    };
    window.clearTimeout(this.resumeTimer);
    tick();
  }

  /** Video layer under the button and pinned rows. Hidden until a frame is playing. */
  private mountCameraVideo(cluster: HTMLElement): void {
    const player = this.videoPlayer;
    const covers = this.cameraVideoCovers();
    const found = cluster.querySelector(":scope > .area-card-camera-video");
    if (!covers || !player) {
      if (found instanceof HTMLElement) found.remove();
      this.raiseCollapsedContent(false);
      return;
    }
    const layer = found instanceof HTMLElement ? found : this.createCameraVideoLayer();
    if (layer.parentElement !== cluster) cluster.prepend(layer);
    const scrim = layer.querySelector(".area-card-camera-scrim");
    if (scrim instanceof HTMLElement) scrim.style.backgroundImage = cameraVideoScrim(this.pinnedRowsVisible);
    if (player.parentElement !== layer) {
      if (scrim) layer.insertBefore(player, scrim);
      else layer.append(player);
    }
    layer.style.opacity = this.streamState?.phase === "playing" ? "1" : "0";
    this.raiseCollapsedContent(true);
  }

  private createCameraVideoLayer(): HTMLElement {
    const layer = document.createElement("div");
    layer.className = "area-card-camera-video";
    layer.setAttribute("aria-hidden", "true");
    layer.style.position = "absolute";
    layer.style.inset = "0";
    layer.style.zIndex = "0";
    layer.style.pointerEvents = "none";
    layer.style.overflow = "hidden";
    layer.style.borderRadius = CLUSTER_PICTURE_RADIUS;
    const scrim = document.createElement("div");
    scrim.className = "area-card-camera-scrim";
    scrim.style.position = "absolute";
    scrim.style.inset = "0";
    layer.append(scrim);
    return layer;
  }

  private raiseCollapsedContent(above: boolean): void {
    for (const el of [this.buttonEl, this.pinnedEl]) {
      if (!el) continue;
      if (above) {
        el.style.position = "relative";
        el.style.zIndex = "1";
      } else {
        el.style.removeProperty("position");
        el.style.removeProperty("z-index");
      }
    }
  }

  /**
   * One photo behind the area button and the pinned rows while any pinned row
   * is showing. A camera video uses that same cluster, with the still underneath
   * until a frame is playing. With neither, the button keeps its picture.
   */
  private syncPicturePlacement(pinnedRowsVisible: boolean): void {
    this.pinnedRowsVisible = pinnedRowsVisible;
    const videoCovers = this.cameraVideoCovers();
    const videoPlaying = this.streamState?.phase === "playing";
    const placement = picturePlacement(this.areaPicture, pinnedRowsVisible);
    const cluster = this.ensurePictureCluster();
    if (cluster && cluster !== this) {
      this.applyClusterLayout(cluster);
      const underVideo = clusterPictureWhileVideo(
        videoPlaying,
        placement === "cluster" || videoCovers ? this.areaPicture : null,
      );
      if (underVideo) {
        const props = clusterPictureProperties(underVideo);
        cluster.style.setProperty("background-image", props["background-image"]);
        cluster.style.setProperty("background-size", props["background-size"]);
        cluster.style.setProperty("background-position", props["background-position"]);
        cluster.style.setProperty("border-radius", props["border-radius"]);
        cluster.style.setProperty("--ha-card-backdrop-filter", props["--ha-card-backdrop-filter"]);
      } else {
        cluster.style.removeProperty("background-image");
        cluster.style.removeProperty("background-size");
        cluster.style.removeProperty("background-position");
        cluster.style.removeProperty("border-radius");
        cluster.style.removeProperty("--ha-card-backdrop-filter");
      }
      this.mountCameraVideo(cluster);
    }
    this.syncButtonPictureSuppress(placement === "cluster" || videoCovers);
    const host = this.pinnedEl;
    if (!host) return;
    for (const card of host.querySelectorAll<HTMLElement>("[data-pin-entity]")) {
      this.clearPinnedCardChrome(card);
    }
  }

  /** Button and pinned host only. The popup stays a sibling after this wrapper. */
  private ensurePictureCluster(): HTMLElement | null {
    const button = this.buttonEl;
    const pinned = this.pinnedEl;
    if (!button || !pinned) return null;
    const popup = this.popupEl;
    const current = button.parentElement;
    const content = current
      ? [...current.children].filter(
          (node) => !(node instanceof HTMLElement && node.classList.contains("area-card-camera-video")),
        )
      : [];
    if (
      current &&
      current !== this &&
      pinned.parentElement === current &&
      !(popup && current.contains(popup)) &&
      content.length === 2 &&
      content[0] === button &&
      content[1] === pinned
    ) {
      return current;
    }
    let cluster: HTMLElement | null = null;
    for (const node of this.children) {
      if (!(node instanceof HTMLElement) || !node.classList.contains("area-card-cluster")) continue;
      if (popup && node.contains(popup)) continue;
      cluster = node;
      break;
    }
    if (!cluster) {
      cluster = document.createElement("div");
      cluster.className = "area-card-cluster";
    }
    if (!cluster.contains(button)) {
      if (button.parentElement) button.before(cluster);
      else if (popup?.parentElement === this) popup.before(cluster);
      else this.append(cluster);
    }
    cluster.append(button, pinned);
    if (popup && cluster.contains(popup)) cluster.after(popup);
    else if (popup?.parentElement === this && cluster.nextElementSibling !== popup) cluster.after(popup);
    for (const extra of [...this.children]) {
      if (extra !== cluster && extra instanceof HTMLElement && extra.classList.contains("area-card-cluster")) {
        if (extra.childElementCount === 0) extra.remove();
      }
    }
    return cluster;
  }

  private applyClusterLayout(cluster: HTMLElement): void {
    cluster.style.display = "flex";
    cluster.style.flexDirection = "column";
    cluster.style.margin = "0";
    cluster.style.padding = "0";
    cluster.style.gap = "0";
    cluster.style.position = "relative";
    // The photo's own background clips to the cluster radius. overflow:hidden
    // here would also clip a tall pinned card (a light slider, a media player).
    cluster.style.removeProperty("overflow");
  }

  private syncButtonPictureSuppress(suppress: boolean): void {
    const button = this.buttonEl;
    if (!button) return;
    const apply = (): boolean => {
      if (this.buttonEl !== button || !button.isConnected) return true;
      const root = button.shadowRoot;
      if (!root) return !suppress;
      const existing = root.querySelector("#area-card-picture-suppress");
      if (!suppress) {
        existing?.remove();
        return true;
      }
      let style = existing;
      if (!(style instanceof HTMLStyleElement)) {
        style = document.createElement("style");
        style.id = "area-card-picture-suppress";
        root.append(style);
      }
      const text = buttonPictureSuppressStyles();
      if (style.textContent !== text) style.textContent = text;
      return true;
    };
    if (apply()) return;
    let tries = 0;
    const tick = () => {
      if (picturePlacement(this.areaPicture, this.pinnedRowsVisible) !== "cluster" && !this.cameraVideoCovers()) {
        button.shadowRoot?.querySelector("#area-card-picture-suppress")?.remove();
        return;
      }
      if (apply() || tries++ >= 40) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** The area button's bottom margin would split it from the first pinned row. */
  private syncButtonGap(pinned: boolean): void {
    const button = this.buttonEl;
    if (!button) return;
    const apply = () => {
      const ha = button.shadowRoot?.querySelector("ha-card");
      const bubble = button.shadowRoot?.querySelector(".bubble-container");
      const background = button.shadowRoot?.querySelector(".bubble-background");
      if (!pinned) {
        button.style.removeProperty("margin-bottom");
        for (const el of [ha, bubble, background]) {
          if (!(el instanceof HTMLElement)) continue;
          el.style.removeProperty("margin-bottom");
          el.style.removeProperty("border-bottom-left-radius");
          el.style.removeProperty("border-bottom-right-radius");
        }
        return true;
      }
      button.style.setProperty("margin-bottom", "0", "important");
      if (ha instanceof HTMLElement) {
        ha.style.setProperty("margin-bottom", "0", "important");
        ha.style.setProperty("border-bottom-left-radius", "0", "important");
        ha.style.setProperty("border-bottom-right-radius", "0", "important");
      }
      // Square the seam against the pinned rows. The cluster photo supplies the
      // outer corners, so a second radius here would curve the middle.
      for (const el of [bubble, background]) {
        if (!(el instanceof HTMLElement)) continue;
        el.style.setProperty("border-bottom-left-radius", "0", "important");
        el.style.setProperty("border-bottom-right-radius", "0", "important");
      }
      return ha instanceof HTMLElement && bubble instanceof HTMLElement && background instanceof HTMLElement;
    };
    if (apply()) return;
    let tries = 0;
    const tick = () => {
      if (apply() || tries++ >= 40) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
  documentationURL: string;
};

const registry = window as Window & { customCards?: CustomCard[] };
registry.customCards = registry.customCards || [];
if (!registry.customCards.some((card) => card.type === "area-card")) {
  registry.customCards.push({
    type: "area-card",
    name: "Area Card",
    description: "Area summary button and popup",
    preview: true,
    documentationURL: "https://github.com/Helpmeeters/area-card",
  });
}
