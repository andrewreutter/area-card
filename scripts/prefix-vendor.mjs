import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const vendor = path.join(root, "vendor");
const dist = path.join(root, "dist");
const distVendor = path.join(dist, "vendor");

fs.mkdirSync(distVendor, { recursive: true });

const bubble = prefixBubble(fs.readFileSync(path.join(vendor, "bubble-card.js"), "utf8"));
const mushroom = prefixMushroom(fs.readFileSync(path.join(vendor, "mushroom.js"), "utf8"));

const bubbleBanner =
  "/*! Area Card private copy of Bubble Card v3.4.3 (MIT). Custom elements are prefixed so they do not collide with a globally installed Bubble Card. */\n";
const mushroomBanner =
  "/*! Area Card private copy of Mushroom v5.2.3 (Apache-2.0). Custom elements are prefixed so they do not collide with a globally installed Mushroom. */\n";

writeBoth("area-card-bubble.js", bubbleBanner + bubble);
writeBoth("area-card-mushroom.js", mushroomBanner + mushroom);

function writeBoth(name, contents) {
  fs.writeFileSync(path.join(dist, name), contents);
  fs.writeFileSync(path.join(distVendor, name), contents);
}

function prefixBubble(src) {
  const marker = "window.customCards=window.customCards||[],window.customCards.push(";
  const start = src.indexOf(marker);
  if (start < 0) throw new Error("Bubble card picker registration was not found");
  if (src.indexOf(marker, start + marker.length) !== -1) {
    throw new Error("Expected a single Bubble customCards registration");
  }
  let cursor = start + marker.length;
  let depth = 1;
  while (cursor < src.length && depth > 0) {
    const char = src[cursor];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    cursor += 1;
  }
  if (src[cursor] === ",") cursor += 1;
  src = src.slice(0, start) + src.slice(cursor);

  const { text, restore } = protectUrls(src);
  src = text.replaceAll("bubble-card", "area-card-bubble");
  src = src.replaceAll("bubble-formfield", "area-card-bubble-formfield");
  src = src.replaceAll("ha-form-bc_cluster", "area-card-ha-form-bc_cluster");
  src = src.replaceAll("ha-form-bc_group", "area-card-ha-form-bc_group");
  src = src.replaceAll("ha-selector-bc_object", "area-card-ha-selector-bc_object");
  src = src.replaceAll("ha-selector-calendar_entity", "area-card-ha-selector-calendar_entity");
  src = restore(src);

  assertIncludes(src, 'customElements.define("area-card-bubble"', "prefixed bubble element");
  assertIncludes(src, 'customElements.define("area-card-bubble-editor"', "prefixed bubble editor");
  assertAbsent(src, 'customElements.define("bubble-card"', "unprefixed bubble element");
  assertAbsent(src, "window.customCards", "Bubble card picker registration");
  assertIncludes(
    src,
    'script[src*="area-card-bubble.js"]',
    "bubble script lookup aligned with the prefixed filename",
  );
  assertIncludes(src, "https://community.home-assistant.io/t/bubble-card-a-minimalist-card-collection", "untouched community URL");
  return src;
}

function prefixMushroom(src) {
  const registration =
    'function eg(t){const o=window;o.customCards=o.customCards||[];const i=t.type.replace("-card","").replace("mushroom-","");o.customCards.push(ee(ee({},t),{},{preview:!0,documentationURL:`${e.url}/blob/main/docs/cards/${i}.md`}))}';
  if (!src.includes(registration)) {
    throw new Error("Mushroom card picker registration was not found");
  }
  src = src.replace(registration, "function eg(t){}");
  if (!src.includes('og="mushroom"')) throw new Error("Mushroom element prefix constant was not found");
  src = src.replace('og="mushroom"', 'og="area-card-mushroom"');

  const { text, restore } = protectUrls(src);
  src = text.replaceAll("mushroom-", "area-card-mushroom-");
  src = restore(src);

  assertIncludes(src, 'og="area-card-mushroom"', "prefixed mushroom constant");
  assertIncludes(src, "${og}-light-card", "computed mushroom light card");
  assertIncludes(src, "area-card-mushroom-shape-icon", "prefixed mushroom shape icon");
  assertIncludes(src, "area-card-mushroom-template-card", "prefixed mushroom template card");
  assertAbsent(src, 'og="mushroom"', "unprefixed mushroom constant");
  assertAbsent(src, "window.customCards", "Mushroom card picker registration");
  assertMushroomTagsPrefixed(src);
  assertIncludes(src, "https://github.com/piitaya/lovelace-mushroom", "untouched mushroom repository URL");
  return src;
}

function protectUrls(src) {
  const urls = [];
  const text = src.replace(/https?:\/\/[^"'`\\\s)]+/g, (url) => {
    const token = `%%AREACARDURL${urls.length}%%`;
    urls.push(url);
    return token;
  });
  return {
    text,
    restore(value) {
      return value.replace(/%%AREACARDURL(\d+)%%/g, (_, index) => {
        const url = urls[Number(index)];
        if (!url) throw new Error(`Missing protected URL ${index}`);
        return url;
      });
    },
  };
}

function assertIncludes(src, needle, label) {
  if (!src.includes(needle)) throw new Error(`Prefix check failed: missing ${label}`);
}

function assertAbsent(src, needle, label) {
  if (src.includes(needle)) throw new Error(`Prefix check failed: still has ${label}`);
}

function assertMushroomTagsPrefixed(src) {
  const marker = "mushroom-";
  let from = 0;
  while (from < src.length) {
    const index = src.indexOf(marker, from);
    if (index < 0) return;
    const prefix = src.slice(Math.max(0, index - "area-card-".length), index);
    if (prefix !== "area-card-") {
      throw new Error(
        `Unprefixed mushroom tag near ${index}: ${src.slice(Math.max(0, index - 20), index + 40)}`,
      );
    }
    from = index + marker.length;
  }
}
