import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildButtonConfig } from "../src/button-config";
import { buildPopupConfig } from "../src/popup-cards";
import { areaSettingsPath, ensureHeaderButtons, insertAreaEditButton, pinSwitchStyles } from "../src/popup-chrome";
import { emptySections } from "../src/sections";

const picture = "https://ha.local/api/image/serve/kitchen";

type FakeHeaderNode = {
  previousElementSibling: FakeHeaderNode | null;
  classList: { contains(name: string): boolean };
};

function fakeNode(className?: string): FakeHeaderNode {
  return {
    previousElementSibling: null,
    classList: { contains: (name: string) => name === className },
  };
}

/** querySelector plus insertBefore that moves a node and records previousElementSibling. */
function fakeHeaderActions(includeClose = true) {
  const close = fakeNode("bubble-close-button");
  const children: FakeHeaderNode[] = includeClose ? [close] : [];
  const actions = {
    querySelector(selector: string) {
      if (selector === ".bubble-close-button" && includeClose) return close;
      return null;
    },
    insertBefore(node: FakeHeaderNode, child: FakeHeaderNode) {
      const existing = children.indexOf(node);
      if (existing !== -1) children.splice(existing, 1);
      const index = children.indexOf(child);
      children.splice(index, 0, node);
      child.previousElementSibling = node;
    },
  };
  return { close, children, actions };
}

describe("popup chrome", () => {
  it("fits the popup photo to the dialog width and keeps the button on cover", () => {
    const popupStyles = String(
      buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections(), {}, picture).styles,
    );
    const buttonStyles = String(
      buildButtonConfig({
        areaId: "kitchen",
        name: "Kitchen",
        icon: "mdi:pot-steam",
        sections: emptySections(),
        picture,
      }).styles,
    );
    assert.match(popupStyles, /background-size:\s*100% auto/);
    assert.match(popupStyles, /background-position:\s*top center/);
    assert.match(popupStyles, /background-repeat:\s*no-repeat/);
    assert.match(buttonStyles, /background-size:\s*cover/);
    assert.match(buttonStyles, /background-position:\s*center/);
  });

  it("clears the header title fill with and without a picture", () => {
    const withPicture = String(
      buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections(), {}, picture).styles,
    );
    const withoutPicture = String(buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections()).styles);
    for (const styles of [withPicture, withoutPicture]) {
      assert.match(
        styles,
        /\.bubble-header \.bubble-button-card-container \{[^}]*background:\s*none !important/,
      );
      assert.match(styles, /\.bubble-header \.bubble-background,[\s\S]*display:\s*none !important/);
    }
    assert.equal(withoutPicture.includes("background-image"), false);
    assert.match(withPicture, /background-image:/);
  });

  it("builds the area settings path", () => {
    assert.equal(areaSettingsPath("office_of_drew"), "/config/areas/area/office_of_drew");
  });

  it("inserts the gear immediately before the close button", () => {
    const { close, children, actions } = fakeHeaderActions();
    const button = fakeNode("area-card-edit-area");
    insertAreaEditButton(actions as unknown as Element, button as unknown as HTMLElement);
    assert.equal(children[0], button);
    assert.equal(children[1], close);
    assert.equal(close.previousElementSibling, button);

    const extra = fakeNode("area-card-edit-area");
    insertAreaEditButton(actions as unknown as Element, extra as unknown as HTMLElement);
    assert.deepEqual(children, [button, close]);
  });

  it("places the pencil, then the gear, immediately before close", () => {
    const { close, children, actions } = fakeHeaderActions();
    const pencil = fakeNode("area-card-pin-edit");
    const gear = fakeNode("area-card-edit-area");
    ensureHeaderButtons(
      actions as unknown as Element,
      pencil as unknown as HTMLElement,
      gear as unknown as HTMLElement,
    );
    assert.deepEqual(children, [pencil, gear, close]);
    assert.equal(gear.previousElementSibling, pencil);
    assert.equal(close.previousElementSibling, gear);

    children.splice(0, children.length, gear, pencil, close);
    gear.previousElementSibling = null;
    pencil.previousElementSibling = gear;
    close.previousElementSibling = pencil;
    ensureHeaderButtons(
      actions as unknown as Element,
      pencil as unknown as HTMLElement,
      gear as unknown as HTMLElement,
    );
    assert.deepEqual(children, [pencil, gear, close]);
    assert.equal(children.filter((node) => node === pencil).length, 1);
    assert.equal(children.filter((node) => node === gear).length, 1);
  });

  it("leaves the header buttons in place on a second call", () => {
    const { children, actions } = fakeHeaderActions();
    const pencil = fakeNode("area-card-pin-edit");
    const gear = fakeNode("area-card-edit-area");
    const host = actions as unknown as Element;
    ensureHeaderButtons(host, pencil as unknown as HTMLElement, gear as unknown as HTMLElement);
    const placed = [...children];
    ensureHeaderButtons(host, pencil as unknown as HTMLElement, gear as unknown as HTMLElement);
    assert.deepEqual(children, placed);
    assert.equal(children.filter((node) => node === pencil).length, 1);
    assert.equal(children.filter((node) => node === gear).length, 1);
  });

  it("does nothing when the popup has no close button", () => {
    const { children, actions } = fakeHeaderActions(false);
    const pencil = fakeNode("area-card-pin-edit");
    const gear = fakeNode("area-card-edit-area");
    assert.doesNotThrow(() =>
      ensureHeaderButtons(
        actions as unknown as Element,
        pencil as unknown as HTMLElement,
        gear as unknown as HTMLElement,
      ),
    );
    assert.deepEqual(children, []);
    assert.equal(pencil.previousElementSibling, null);
    assert.equal(gear.previousElementSibling, null);
  });

  it("sizes header action buttons with and without a picture", () => {
    const withPicture = String(
      buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections(), {}, picture).styles,
    );
    const withoutPicture = String(buildPopupConfig("kitchen", "Kitchen", "mdi:pot-steam", emptySections()).styles);
    for (const styles of [withPicture, withoutPicture]) {
      assert.match(styles, /\.bubble-header-actions \{[^}]*gap:\s*4px !important/);
      assert.match(
        styles,
        /\.bubble-header-action-button \{[^}]*width:\s*36px !important;[^}]*height:\s*36px !important/,
      );
      assert.equal(styles.includes("area-card-bubbles-grid-container"), false);
    }
    const pinStyles = pinSwitchStyles();
    assert.match(
      pinStyles,
      /\.area-card-bubbles-grid-container > \.card:has\(> \.area-card-pin-switch\) \{[^}]*display:\s*flex !important/,
    );
    assert.equal(pinStyles.includes("bubble-cards-grid-container"), false);
  });
});
