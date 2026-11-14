# Agent notes

HACS Lovelace plugin (not a Python custom component). Product behavior is in `README.md`. This file is the operational path so you do not rediscover it.

Serving Wonderwood Local is not a release. The choice is in "Local or release", immediately before "Ship a card change".

Repo: `https://github.com/Helpmeeters/area-card`. Cards ship in one bundle, `area-card.js`, which registers both `area-card` (`custom:area-card`) and `floor-card` (`custom:floor-card`).

## Browse

The gstack browse binary is already built:

```bash
B="$HOME/.cursor/skills/gstack/browse/dist/browse"
```

Use that path. The skill's setup check looks in the repo and `~/.claude/skills/gstack/browse/dist/browse`, prints `NEEDS_SETUP`, and is wrong on this machine. Do not search the filesystem, read the gstack skill, run its preamble, run `./setup`, or install bun.

Wonderwood: `http://treetop:8123/dynamic-home/home`. Lovelace UI is inside open shadow roots. Query through them. The page is ready when `document.querySelector("home-assistant").hass` is set. Loaded card URLs are the `performance.getEntriesByType("resource")` entries whose name contains `area-card.js`.

A screenshot of the login page means the browse session is logged out. Import cookies and open the dashboard again:

```bash
"$B" goto "http://treetop:8123/dynamic-home/home"
"$B" cookie-import-browser chrome --domain treetop
"$B" goto "http://treetop:8123/dynamic-home/home"
```

The browser name comes before `--domain`. Import after a treetop page is open. A Keychain prompt for "Chrome Safe Storage" means the session stays logged out until that prompt is allowed.

## Home Assistant

`HASS_URL` and `HASS_TOKEN` are in `/Users/andrewreutter/.hermes/.env`. Read them in the process. Never print the token, log it, or write it into the repo.

Talk to treetop over the websocket (`HASS_URL` with `http` swapped to `ws`, path `/api/websocket`). Node on this machine has a global `WebSocket`. Do not pip-install a client. SSH to treetop does not work. Registries, Lovelace, and HACS are websocket commands.

Handshake: the first message is `auth_required`. Send `{ "type": "auth", "access_token": "<token>" }` and wait for `auth_ok`. Every command needs a numeric `id`. Match the reply with that `id`. A reply is `{ "id", "type": "result", "success", "result" }`.

Registries, `get_states`, and the Lovelace config are large. Write the raw `result` to `/tmp` and print a summary.

```bash
node --input-type=module << 'EOF'
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("/Users/andrewreutter/.hermes/.env", "utf8")
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return [];
      const i = trimmed.indexOf("=");
      if (i < 1) return [];
      let value = trimmed.slice(i + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [[trimmed.slice(0, i), value]];
    }),
);

const base = env.HASS_URL.replace(/\/$/, "");
const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/websocket");
const pending = new Map();
let nextId = 1;

function call(type, fields = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), 90_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ id, type, ...fields }));
  });
}

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout auth")), 15_000);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: env.HASS_TOKEN }));
      return;
    }
    if (msg.type === "auth_ok") {
      clearTimeout(timer);
      resolve();
      return;
    }
    if (msg.type === "auth_invalid") {
      clearTimeout(timer);
      reject(new Error("auth_invalid"));
      return;
    }
    pending.get(msg.id)?.(msg);
  });
});

const msg = await call("lovelace/config", { url_path: "dynamic-home" });
writeFileSync("/tmp/ha-result.json", JSON.stringify(msg.result));
console.log(msg.success, JSON.stringify(msg.result).length);
ws.close();
EOF
```

Change `call(...)` for the command you need. Commands that already work:

- Registries: `config/area_registry/list`, `config/floor_registry/list`, `config/entity_registry/list`, `config/device_registry/list`, `get_states`
- Dashboard read: `lovelace/config` with `url_path: "dynamic-home"` (storage mode, title Wonderwood). The dashboard body is `result` (`result.views`), not the websocket envelope.
- Dashboard write: re-read immediately before saving and snapshot that `result` to `/tmp`. Save with `lovelace/config/save`, `url_path: "dynamic-home"`, and `config` set to that object. This instance has no config hash, so a second writer clobbers the first. Re-read after the save and check the cards you changed.
- Lovelace resources: `lovelace/resources`. Wonderwood's resource id is `657217310ddd49488a2cc228e3488e0a` and its URL is `/hacsfiles/area-card/area-card.js`. Wonderwood Local's resource id is `cea25e92ccf54575b6ad7617f98f8368` and its URL is the dev server's `area-card-local.js`. `area-card-bubble.js` and `area-card-mushroom.js` are siblings of whichever script loaded. Update one resource with `lovelace/resources/update` and `{ "resource_id", "res_type": "module", "url" }`. Do not point one dashboard's resource at the other.
- Install a release: the HACS repository id on treetop is `1455927335`. If a command rejects it, `hacs/repositories/list` and take the repo whose name contains `area-card`. `hacs/repository/update` may return Unknown command. `hacs/repository/download` with `{ "repository": "<id>" }` is the install. Allow 90 seconds. Proof is an HTTP GET of `$HASS_URL/hacsfiles/area-card/area-card.js` with `Authorization: Bearer <token>` whose body contains the change. The dashboard cache key is `?hacstag=<id><version with the dots removed>` (`1.0.22` → `14559273351022`).

## Local or release

Choose the path here, before any release step.

"Wonderwood Local", "local", or "serve my changes" means build and serve the working tree to Wonderwood Local only. It is not a release. Do not commit, push, create a GitHub release, or download through HACS.

"Wonderwood" without "Local", or an explicit ship/release request, is the only time the release path runs. That path updates the released card that Wonderwood loads.

v1.0.23 was published because a request to serve Wonderwood Local was carried out as a release. Do not do that again.

Wonderwood is `http://treetop:8123/dynamic-home/home`. It loads the released HACS file `/hacsfiles/area-card/area-card.js`. Changing it means the full release path: version bump, commit, push, `gh release create` with the three dist assets, then HACS download. Those steps are "Ship a card change" and "Serve to Wonderwood with a release".

Wonderwood Local is `http://treetop:8123/dynamic-home-local/home`. Its own resource is `http://100.84.152.125:8787/area-card-local.js`. The repo has no serve script. Reuse `node /tmp/area-card-dev-server.mjs`, which serves the working tree `dist/area-card.js` as `area-card-local.js` on port 8787. If that process is already listening, leave it. Do not invent a second server. `npm run build` refreshes that file. Serving local changes does not commit, push, release, or update the HACS resource. Those steps are "Serve to Wonderwood Local from local dev changes".

Lovelace resources are global, but these dashboards use different resource URLs. Do not replace the HACS resource when updating the local dashboard.

## Ship a card change

Run this section only for Wonderwood without "Local", or an explicit ship/release request. A request to serve Wonderwood Local does not enter these steps.

There is no GitHub Actions workflow. `dist/` is gitignored and is uploaded only as release assets.

1. `git fetch origin` and rebase onto `origin/main` before editing. Another agent may be releasing.
2. Change `src/` and `test/`. Run `npm test`. `npm run build` refreshes the prefixed vendor copies and writes `dist/area-card.js`, `dist/area-card-bubble.js`, and `dist/area-card-mushroom.js`.
3. Bump `package.json` version. Commit only the files for this change. Leave `.gstack/`, `.env`, `dist/`, and unrelated `.gitignore` edits unstaged.
4. Push, then:

```bash
gh release create vX.Y.Z dist/area-card.js dist/area-card-bubble.js dist/area-card-mushroom.js \
  --title "vX.Y.Z" --notes "..."
```

Build those three files from the commit you are tagging. A dirty worktree leaks unrelated code into the asset (this happened on v1.0.9). If other edits are present, build from a clean worktree of that commit.

5. Serve that release to Wonderwood, below. Do not start that path for a local-only look.

Do not change git config. Do not skip hooks. Commit only when the task asks you to ship.

## Serve to Wonderwood Local from local dev changes

Wonderwood Local is `http://treetop:8123/dynamic-home-local/home` (`url_path: "dynamic-home-local"`). It is a copy of Wonderwood whose floor cards are `custom:floor-card-local`. Those create `area-card-local`. Lovelace resources are global, so both dashboards load both scripts. The local bundle registers suffixed elements (`area-card-local`, `floor-card-local`, `floors-card-local`, `area-card-local-light-row`, `area-card-local-section-title`) and the picker names "Area Card (local)", "Floor Card (local)", and "Floors Card (local)". Bubble and Mushroom element names stay shared. Do not change Wonderwood's `/hacsfiles/` resource while doing this.

The repo has no serve script. `/tmp/area-card-dev-server.mjs` is the server already used for Wonderwood Local. It serves `dist/` on `0.0.0.0:8787`. Responses send `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Private-Network: true`, and `Cache-Control: no-store`. `GET /area-card-local.js` reads `dist/area-card.js` and applies those renames on each request. Sibling bubble and mushroom files are served unchanged. Port 8765 belongs to another app. Do not use it. The server reads `dist/` from disk, so a rebuild does not need a restart. Reuse this server. Do not invent a second one.

The Local resource URL is `http://<this Mac's Tailscale address>:8787/area-card-local.js`. That address is the `utun` inet (`100.84.152.125` as of the last check). `127.0.0.1` only works in a browser on this Mac.

1. `npm run build`.
2. If nothing answers on 8787, start `node /tmp/area-card-dev-server.mjs`. If that process is already listening, leave it. If the file is gone and nothing is listening, recreate the server described above and start that one process. Do not start a second server.
3. `curl` the Local URL. It must be 200, define `"area-card-local"`, and contain a string from the change. If the Tailscale address changed, `lovelace/resources/update` the Local resource id only.
4. Reload Wonderwood Local. Do not commit, push, create a GitHub release, or download through HACS.

## Serve to Wonderwood with a release

Wonderwood (`http://treetop:8123/dynamic-home/home`) loads the HACS copy. Follow "Ship a card change" through the GitHub release, then update Home Assistant:

1. `hacs/repository/download` with `{ "repository": "1455927335" }`, as under Home Assistant above.
2. GET `$HASS_URL/hacsfiles/area-card/area-card.js` with the bearer token. The body must contain the change.
3. Wonderwood's resource URL must be `/hacsfiles/area-card/area-card.js?hacstag=1455927335<version with the dots removed>`. HACS often writes that query during the download. If it is still the previous version, `lovelace/resources/update` resource id `657217310ddd49488a2cc228e3488e0a` only. Do not change the Wonderwood Local resource.
4. Reload Wonderwood. Leave Wonderwood Local on the dev server.

## One writer

This repo has one `main` and agents ship straight to it. If `git status` shows another agent's edits, or `origin/main` is moving, wait. Do not stash, reset, or revert their files. Dashboard-only work can proceed without touching the repo.

## Easy to undo

- Bubble Card v3.4.3 and Mushroom v5.2.3 are vendored and prefixed (`area-card-bubble`, `area-card-mushroom-*`). Use those elements. A stock `mushroom-*` or `bubble-card` tag is the wrong card.
- The area-card editor has two fields: required `area` and optional `hide_sections` (multi-select). The floor-card editor has one required field: `floor`.
- Popup section order, dot slots, Entries, Satellites, LED dots, and room-name stripping are specified in `README.md`. Read it before changing `src/sections.ts`, `src/rollups.ts`, or `src/popup-cards.ts`.
