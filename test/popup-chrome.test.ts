import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildButtonConfig } from "../src/button-config";
import { buildPopupConfig } from "../src/popup-cards";
import { areaSettingsPath, insertAreaEditButton } from "../src/popup-chrome";
import { emptySections } from "../src/sections";

const picture = "https://ha.local/api/image/serve/kitchen";

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
    const close = {
      previousElementSibling: null as { classList: { contains(name: string): boolean } } | null,
    };
    const children: object[] = [close];
    const actions = {
      querySelector(selector: string) {
        if (selector === ".bubble-close-button") return close;
        return null;
      },
      insertBefore(node: { classList: { contains(name: string): boolean } }, child: object) {
        const index = children.indexOf(child);
        children.splice(index, 0, node);
        if (child === close) close.previousElementSibling = node;
      },
    };
    const button = {
      classList: { contains: (name: string) => name === "area-card-edit-area" },
    };
    insertAreaEditButton(actions as unknown as Element, button as unknown as HTMLElement);
    assert.equal(children[0], button);
    assert.equal(children[1], close);
    assert.equal(close.previousElementSibling, button);

    const extra = {
      classList: { contains: (name: string) => name === "area-card-edit-area" },
    };
    insertAreaEditButton(actions as unknown as Element, extra as unknown as HTMLElement);
    assert.deepEqual(children, [button, close]);
  });
});
