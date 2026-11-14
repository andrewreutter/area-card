import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { syncPinToggles } from "../src/pin-toggles";
import type { PinMode } from "../src/pinned-entities";
import { BUBBLE_CARDS_GRID } from "../src/tags";

const GRID_SELECTOR = `.${BUBBLE_CARDS_GRID} > .card`;

type FakeNode = {
  id: string;
  tag: string;
  textContent: string;
  className: string;
  title: string;
  classList: { contains(name: string): boolean };
  config?: Record<string, unknown>;
  dataset: Record<string, string>;
  pinCycle?: (entityId: string) => void;
  children: FakeNode[];
  firstChild: FakeNode | null;
  firstElementChild: FakeNode | null;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, listener: (event: { stopPropagation(): void }) => void): void;
  append(...nodes: FakeNode[]): void;
  querySelector(selector: string): FakeNode | null;
  querySelectorAll(selector: string): FakeNode[];
  insertBefore(node: FakeNode, before: FakeNode | null): void;
  remove(): void;
  fire(type: string): boolean;
};

function syncEnds(cell: FakeNode): void {
  cell.firstChild = cell.children[0] ?? null;
  cell.firstElementChild = cell.children[0] ?? null;
}

function fakeNode(className = "", config?: Record<string, unknown>): FakeNode {
  const listeners = new Map<string, (event: { stopPropagation(): void }) => void>();
  const node: FakeNode = {
    id: "",
    tag: "",
    textContent: "",
    className,
    title: "",
    config,
    dataset: {},
    children: [],
    firstChild: null,
    firstElementChild: null,
    attributes: {},
    classList: {
      contains(name: string) {
        return node.className.split(/\s+/).includes(name);
      },
    },
    setAttribute(name: string, value: string) {
      node.attributes[name] = value;
    },
    getAttribute(name: string) {
      return node.attributes[name] ?? null;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    append(...children) {
      node.children.push(...children);
      syncEnds(node);
    },
    querySelector(selector: string) {
      return node.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string) {
      if (selector === ":scope > .area-card-pin-switch") {
        return node.children.filter((child) => child.classList.contains("area-card-pin-switch"));
      }
      if (selector === "ha-icon") return node.children.filter((child) => child.tag === "ha-icon");
      return [];
    },
    insertBefore(child, before) {
      const existing = node.children.indexOf(child);
      if (existing !== -1) node.children.splice(existing, 1);
      const index = before ? node.children.indexOf(before) : node.children.length;
      node.children.splice(index < 0 ? node.children.length : index, 0, child);
      syncEnds(node);
    },
    remove() {},
    fire(type: string) {
      let stopped = false;
      listeners.get(type)?.({
        stopPropagation() {
          stopped = true;
        },
      });
      return stopped;
    },
  };
  return node;
}

function iconOf(node: FakeNode): string | null {
  return node.querySelector("ha-icon")?.getAttribute("icon") ?? null;
}

function cellWith(config: Record<string, unknown> | null): FakeNode {
  const cell = fakeNode("card");
  if (config) {
    const card = fakeNode("", config);
    card.remove = () => {
      const index = cell.children.indexOf(card);
      if (index !== -1) cell.children.splice(index, 1);
      syncEnds(cell);
    };
    cell.children.push(card);
  }
  syncEnds(cell);
  const insert = cell.insertBefore.bind(cell);
  cell.insertBefore = (child, before) => {
    child.remove = () => {
      const index = cell.children.indexOf(child);
      if (index !== -1) cell.children.splice(index, 1);
      syncEnds(cell);
    };
    insert(child, before);
  };
  return cell;
}

function grid(cells: FakeNode[]) {
  const selectors: string[] = [];
  return {
    selectors,
    root: {
      querySelectorAll(selector: string) {
        selectors.push(selector);
        return selector === GRID_SELECTOR ? cells : [];
      },
    },
  };
}

describe("syncPinToggles", () => {
  const created: string[] = [];
  const previousDocument = globalThis.document;

  before(() => {
    globalThis.document = {
      createElement(tag: string) {
        created.push(tag);
        const node = fakeNode();
        node.tag = tag;
        return node as unknown as HTMLElement;
      },
    } as unknown as Document;
  });

  after(() => {
    globalThis.document = previousDocument;
  });

  it("puts one cycle button on entity rows and skips titles and chips", () => {
    created.length = 0;
    const title = cellWith({ type: "custom:area-card-section-title", title: "Lights" });
    const chips = cellWith({ type: "custom:area-card-mushroom-chips-card", chips: [] });
    const light = cellWith({
      type: "custom:area-card-light-row",
      card: { type: "custom:area-card-mushroom-light-card", entity: "light.kitchen" },
    });
    const media = cellWith({ type: "media-control", entity: "media_player.tv" });
    const cover = cellWith({ type: "custom:area-card-mushroom-cover-card", entity: "cover.shade" });
    const { root, selectors } = grid([title, chips, light, media, cover]);
    const modes = new Map<string, PinMode>([
      ["light.kitchen", "always"],
      ["media_player.tv", "when-on"],
    ]);
    const cycled: string[] = [];

    syncPinToggles(root as unknown as ParentNode, {
      editing: true,
      modeOf: (entityId) => modes.get(entityId) ?? "hidden",
      onCycle: (entityId) => cycled.push(entityId),
    });

    assert.deepEqual(selectors, [GRID_SELECTOR]);
    assert.deepEqual(created, ["button", "ha-icon", "button", "ha-icon", "button", "ha-icon"]);
    assert.equal(created.includes("ha-switch"), false);
    assert.equal(title.children.some((child) => child.classList.contains("area-card-pin-switch")), false);
    assert.equal(chips.children.some((child) => child.classList.contains("area-card-pin-switch")), false);

    const lightSwitch = light.children[0];
    const mediaSwitch = media.children[0];
    const coverSwitch = cover.children[0];
    assert.equal(lightSwitch.className, "area-card-pin-switch");
    assert.equal(mediaSwitch.className, "area-card-pin-switch");
    assert.equal(coverSwitch.className, "area-card-pin-switch");
    assert.equal(lightSwitch.dataset.pinEntity, "light.kitchen");
    assert.equal(lightSwitch.dataset.pinMode, "always");
    assert.equal(lightSwitch.getAttribute("aria-label"), "Always on the area card");
    assert.equal(lightSwitch.title, "Always on the area card");
    assert.equal(iconOf(lightSwitch), "mdi:pin");
    assert.equal(mediaSwitch.dataset.pinMode, "when-on");
    assert.equal(mediaSwitch.getAttribute("aria-label"), "On the area card while on");
    assert.equal(mediaSwitch.title, "On the area card while on");
    assert.equal(iconOf(mediaSwitch), "mdi:eye-check");
    assert.equal(coverSwitch.dataset.pinEntity, "cover.shade");
    assert.equal(coverSwitch.dataset.pinMode, "hidden");
    assert.equal(coverSwitch.getAttribute("aria-label"), "Hidden on the area card");
    assert.equal(coverSwitch.title, "Hidden on the area card");
    assert.equal(iconOf(coverSwitch), "mdi:eye-off");
    assert.equal(light.children[1].config?.type, "custom:area-card-light-row");

    assert.equal(mediaSwitch.fire("pointerdown"), true);
    assert.equal(mediaSwitch.fire("click"), true);
    assert.deepEqual(cycled, ["media_player.tv"]);

    const again = created.length;
    const recycled: string[] = [];
    modes.set("light.kitchen", "when-on");
    syncPinToggles(root as unknown as ParentNode, {
      editing: true,
      modeOf: (entityId) => modes.get(entityId) ?? "hidden",
      onCycle: (entityId) => recycled.push(entityId),
    });
    assert.equal(created.length, again);
    assert.equal(light.children[0], lightSwitch);
    assert.equal(light.querySelector(":scope > .area-card-pin-switch"), lightSwitch);
    assert.equal(lightSwitch.dataset.pinMode, "when-on");
    assert.equal(iconOf(lightSwitch), "mdi:eye-check");
    assert.equal(lightSwitch.fire("click"), true);
    assert.deepEqual(recycled, ["light.kitchen"]);

    syncPinToggles(root as unknown as ParentNode, {
      editing: false,
      modeOf: () => "always",
      onCycle: () => {},
    });
    assert.equal(light.children.some((child) => child.classList.contains("area-card-pin-switch")), false);
    assert.equal(media.children.some((child) => child.classList.contains("area-card-pin-switch")), false);
    assert.equal(cover.children.some((child) => child.classList.contains("area-card-pin-switch")), false);
  });

  it("does not match the unprefixed bubble grid class", () => {
    const light = cellWith({ type: "custom:area-card-mushroom-entity-card", entity: "light.desk" });
    const root = {
      querySelectorAll(selector: string) {
        return selector === ".bubble-cards-grid-container > .card" ? [light] : [];
      },
    };
    syncPinToggles(root as unknown as ParentNode, {
      editing: true,
      modeOf: () => "always",
      onCycle: () => {},
    });
    assert.equal(light.children.some((child) => child.classList.contains("area-card-pin-switch")), false);
  });

  it("injects pin layout once, outside Bubble's rewritten popup stylesheet", () => {
    const nodes: FakeNode[] = [];
    const root = {
      querySelector(selector: string) {
        if (selector !== "#area-card-pin-switch-style") return null;
        return nodes.find((node) => node.id === "area-card-pin-switch-style") ?? null;
      },
      appendChild(node: FakeNode) {
        nodes.push(node);
      },
      querySelectorAll() {
        return [];
      },
    };
    const options = { editing: true, modeOf: (): PinMode => "hidden", onCycle: () => {} };
    syncPinToggles(root as unknown as ParentNode, options);
    syncPinToggles(root as unknown as ParentNode, options);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].id, "area-card-pin-switch-style");
    const css = nodes[0].textContent;
    assert.match(css, /\.area-card-bubbles-grid-container > \.card:has\(> \.area-card-pin-switch\)/);
    assert.match(css, /flex:\s*0 0 auto/);
    assert.match(css, /width:\s*36px/);
    assert.match(css, /height:\s*36px/);
    assert.match(css, /background:\s*transparent/);
    assert.match(css, /border:\s*none/);
    assert.match(css, /padding:\s*0/);
    assert.match(css, /color:\s*var\(--primary-text-color\)/);
    assert.match(css, /color:\s*var\(--primary-color\)/);
    assert.match(css, /\[data-pin-mode="hidden"\][^}]*opacity:\s*0\.45/);
    assert.equal(css.includes(":not(.area-card-bubbles-grid-container"), false);
  });
});
