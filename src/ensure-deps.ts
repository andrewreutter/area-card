import { BUBBLE_ELEMENT, BUBBLE_SCRIPT, MUSHROOM_SCRIPT } from "./tags";

const MUSHROOM_READY = "area-card-mushroom-light-card";

let pending: Promise<void> | undefined;

export function ensureDeps(): Promise<void> {
  if (customElements.get(BUBBLE_ELEMENT) && customElements.get(MUSHROOM_READY)) {
    return Promise.resolve();
  }
  if (!pending) {
    pending = loadDeps().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

async function loadDeps(): Promise<void> {
  await Promise.all([loadFirst(MUSHROOM_SCRIPT), loadFirst(BUBBLE_SCRIPT)]);
  await Promise.all([
    waitForElement(BUBBLE_ELEMENT),
    waitForElement(MUSHROOM_READY),
    waitForElement("area-card-mushroom-template-card"),
    waitForElement("area-card-mushroom-chips-card"),
  ]);
}

async function loadFirst(file: string): Promise<void> {
  const urls = [
    new URL(`./vendor/${file}`, import.meta.url).href,
    new URL(`./${file}`, import.meta.url).href,
  ];
  let lastError: unknown;
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to load ${file}`);
}

function findScript(url: string): HTMLScriptElement | undefined {
  for (const node of Array.from(document.querySelectorAll("script[data-area-card-src]"))) {
    if (node instanceof HTMLScriptElement && node.dataset.areaCardSrc === url) return node;
  }
  return undefined;
}

function loadScript(url: string): Promise<void> {
  const match = findScript(url);
  if (match) {
    if (match.dataset.loaded === "true") return Promise.resolve();
    return new Promise((resolve, reject) => {
      match.addEventListener("load", () => resolve(), { once: true });
      match.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = false;
    script.dataset.areaCardSrc = url;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Failed to load ${url}`));
    };
    document.head.appendChild(script);
  });
}

function waitForElement(tag: string): Promise<void> {
  if (customElements.get(tag)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Timed out waiting for ${tag}`));
    }, 15000);
    customElements.whenDefined(tag).then(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}
