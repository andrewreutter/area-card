/**
 * Home Assistant's muted HLS player for a collapsed-card camera background.
 * The playlist is the video stream from `camera/stream`. No audio element is created.
 */

export interface CameraStreamPlayer extends HTMLElement {
  url?: string;
  muted: boolean;
  controls: boolean;
  autoPlay: boolean;
  playsInline: boolean;
  fitMode?: "cover" | "contain" | "fill";
  posterUrl?: string;
  allowExoPlayer?: boolean;
}

interface CardHelpers {
  createCardElement?: (config: Record<string, unknown>) => unknown;
}

/** User token Home Assistant already holds. Never log or store this. */
export function cameraAccessToken(hass: unknown): string | null {
  if (!hass || typeof hass !== "object") return null;
  const auth = (hass as { auth?: { data?: { access_token?: unknown }; accessToken?: unknown } }).auth;
  if (!auth) return null;
  const token = auth.data?.access_token ?? auth.accessToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function absoluteStreamUrl(path: string, resolveUrl?: (path: string) => string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (resolveUrl) {
    const resolved = resolveUrl(path);
    if (/^https?:\/\//i.test(resolved)) return resolved;
  }
  return new URL(path, window.location.origin).href;
}

let authInstalled = false;
let tokenReader: () => string | null = () => null;

/**
 * HA's HLS player fetches `/api/hls/` without the page's bearer token.
 * Add that token only for those video requests. Read it at request time.
 */
export function installCameraStreamAuth(getToken: () => string | null): void {
  tokenReader = getToken;
  if (authInstalled) return;
  authInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const token = url.includes("/api/hls/") ? tokenReader() : null;
    if (!token) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    if (input instanceof Request) return originalFetch(new Request(input, { headers }));
    return originalFetch(input, { ...init, headers });
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function openWithStreamUrl(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    (this as XMLHttpRequest & { __areaCardStreamUrl?: string }).__areaCardStreamUrl = String(url);
    return originalOpen.call(this, method, url, async ?? true, username, password);
  } as typeof XMLHttpRequest.prototype.open;

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function sendWithStreamAuth(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null,
  ) {
    const url = (this as XMLHttpRequest & { __areaCardStreamUrl?: string }).__areaCardStreamUrl ?? "";
    const token = url.includes("/api/hls/") ? tokenReader() : null;
    if (token) {
      try {
        this.setRequestHeader("Authorization", `Bearer ${token}`);
      } catch {
        // The request already has the header, or sending has started.
      }
    }
    return originalSend.call(this, body);
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Registers `ha-hls-player` by loading the picture card that Home Assistant uses for cameras. */
export async function ensureCameraStreamPlayer(): Promise<boolean> {
  if (customElements.get("ha-hls-player")) return true;
  const load = (window as Window & { loadCardHelpers?: () => Promise<CardHelpers> }).loadCardHelpers;
  if (typeof load === "function") {
    try {
      const helpers = await load();
      const created = await helpers.createCardElement?.({
        type: "picture-entity",
        entity: "camera.webcam",
        camera_view: "live",
        show_name: false,
        show_state: false,
      });
      if (created instanceof HTMLElement) created.remove();
    } catch {
      // The card module registers ha-hls-player while it loads.
    }
  }
  if (customElements.get("ha-hls-player")) return true;
  const defined = customElements.whenDefined("ha-hls-player").then(() => true);
  const timeout = new Promise<boolean>((resolve) => {
    window.setTimeout(() => resolve(false), 4000);
  });
  const ready = await Promise.race([defined, timeout]);
  return ready && !!customElements.get("ha-hls-player");
}

/** Muted autoplaying HLS video. No controls, so the stream cannot be unmuted. */
export function createCameraStreamPlayer(entityId: string): CameraStreamPlayer {
  const player = document.createElement("ha-hls-player") as CameraStreamPlayer;
  player.muted = true;
  player.controls = false;
  player.autoPlay = true;
  player.playsInline = true;
  player.fitMode = "cover";
  player.posterUrl = "";
  player.allowExoPlayer = false;
  player.setAttribute("muted", "");
  player.setAttribute("playsinline", "");
  player.setAttribute("autoplay", "");
  player.removeAttribute("controls");
  player.dataset.camera = entityId;
  player.style.width = "100%";
  player.style.height = "100%";
  player.style.display = "block";
  player.style.pointerEvents = "none";
  player.style.setProperty("--video-max-height", "100%");
  return player;
}

export const CAMERA_PLAYBACK_STYLE_ID = "area-card-playback-guard";

/** A decoded frame is on screen. `paused === false` alone is not enough: play() flips that before any picture exists. */
export function cameraFrameReady(
  video: { videoWidth: number; readyState: number; paused: boolean } | null | undefined,
): boolean {
  return !!video && video.videoWidth > 0 && video.readyState >= 2 && !video.paused;
}

/** Hides the browser and Home Assistant play overlay. The background cannot be clicked. */
export function cameraPlaybackGuardStyles(): string {
  return [
    ":host {",
    "  position: relative !important;",
    "  display: block !important;",
    "  width: 100% !important;",
    "  height: 100% !important;",
    "  overflow: hidden !important;",
    "}",
    "video {",
    "  position: absolute !important;",
    "  inset: 0 !important;",
    "  width: 100% !important;",
    "  height: 100% !important;",
    "  max-height: none !important;",
    "  object-fit: cover !important;",
    "  object-position: center !important;",
    "  background: none !important;",
    "  pointer-events: none !important;",
    "}",
    "video, audio, button, ha-icon-button, ha-button, mwc-icon-button {",
    "  pointer-events: none !important;",
    "}",
    "button, ha-icon-button, ha-button, mwc-icon-button {",
    "  display: none !important;",
    "}",
    "video::-webkit-media-controls,",
    "video::-webkit-media-controls-enclosure,",
    "video::-webkit-media-controls-panel,",
    "video::-webkit-media-controls-play-button,",
    "video::-webkit-media-controls-start-playback-button,",
    "video::-webkit-media-controls-overlay-play-button {",
    "  display: none !important;",
    "  opacity: 0 !important;",
    "  pointer-events: none !important;",
    "  -webkit-appearance: none !important;",
    "}",
  ].join("\n");
}

/** True when the browser refused to start playback without a click. */
export function autoplayRejected(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

/** Puts the guard stylesheet in the player shadow root, where the video actually lives. */
export function hideCameraPlaybackControls(player: HTMLElement): void {
  const root = player.shadowRoot;
  if (!root || root.getElementById(CAMERA_PLAYBACK_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CAMERA_PLAYBACK_STYLE_ID;
  style.textContent = cameraPlaybackGuardStyles();
  root.append(style);
}

/**
 * Mute the inner video and mark it autoplay/playsinline before play().
 * The muted attribute is what lets a browser start the stream without a click.
 */
export function primeCameraVideo(player: HTMLElement): HTMLVideoElement | null {
  if ("posterUrl" in player) (player as CameraStreamPlayer).posterUrl = "";
  silenceCameraPlayer(player);
  const video = player.shadowRoot?.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) return null;
  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.autoplay = true;
  video.playsInline = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  video.poster = "";
  video.setAttribute("muted", "");
  video.setAttribute("autoplay", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.removeAttribute("controls");
  video.removeAttribute("poster");
  video.style.pointerEvents = "none";
  video.style.objectFit = "cover";
  video.style.objectPosition = "center";
  video.style.position = "absolute";
  video.style.inset = "0";
  video.style.width = "100%";
  video.style.height = "100%";
  video.style.maxHeight = "none";
  return video;
}

/** Keep the video silent. An audio track on the media stream stays disabled. */
export function silenceCameraPlayer(player: HTMLElement): void {
  if ("muted" in player) (player as { muted: boolean }).muted = true;
  const root = player.shadowRoot;
  const videos = root ? [...root.querySelectorAll("video")] : [];
  if (player instanceof HTMLVideoElement) videos.unshift(player);
  for (const node of videos) {
    if (!(node instanceof HTMLVideoElement)) continue;
    node.muted = true;
    node.defaultMuted = true;
    node.volume = 0;
    const media = node.srcObject;
    if (media instanceof MediaStream) {
      for (const track of media.getAudioTracks()) track.enabled = false;
    }
  }
  if (!root) return;
  for (const node of root.querySelectorAll("audio")) {
    if (!(node instanceof HTMLAudioElement)) continue;
    node.muted = true;
    node.volume = 0;
    node.pause();
  }
}
