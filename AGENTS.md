# Agent notes

HACS Lovelace plugin (not a Python custom component). Product behavior is in `README.md`. This file is the operational path so you do not rediscover it.

Repo: `https://github.com/andrewreutter/area-card`. Cards ship in one bundle, `area-card.js`, which registers both `area-card` (`custom:area-card`) and `floor-card` (`custom:floor-card`).

## Browse

The gstack browse binary is already built:

```bash
B="$HOME/.cursor/skills/gstack/browse/dist/browse"
```

Use that path. The skill's setup check looks in the repo and `~/.claude/skills/gstack/browse/dist/browse`, prints `NEEDS_SETUP`, and is wrong on this machine. Do not search the filesystem, read the gstack skill, run its preamble, run `./setup`, or install bun.

Wonderwood: `http://treetop:8123/dynamic-home/home`. Lovelace UI is inside open shadow roots. Query through them. The page is ready when `document.querySelector("home-assistant").hass` is set. Loaded card URLs are the `performance.getEntriesByType("resource")` entries whose name contains `area-card.js`.

A screenshot of the login page means the browse session is logged out. Import cookies and open the dashboard again:

```bash
"$B" cookie-import-browser --domain treetop
"$B" goto "http://treetop:8123/dynamic-home/home"
```

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
- Lovelace resources: `lovelace/resources`. The plugin URL is `/hacsfiles/area-card/area-card.js`. `area-card-bubble.js` and `area-card-mushroom.js` are siblings.
- Install a release: the HACS repository id on treetop is `1455927335`. If a command rejects it, `hacs/repositories/list` and take the repo whose name contains `area-card`. Then `hacs/repository/update` and `hacs/repository/download` with `{ "repository": "<id>" }`. Allow 90 seconds for the download. Proof is an HTTP GET of `$HASS_URL/hacsfiles/area-card/area-card.js` with `Authorization: Bearer <token>` whose body contains the change. The dashboard cache key is `?hacstag=<id><version with the dots removed>` (`1.0.11` → `14559273351011`).

## Ship a card change

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

5. Download the release through HACS (above) and check Wonderwood in browse.

Do not change git config. Do not skip hooks. Commit only when the task asks you to ship.

## One writer

This repo has one `main` and agents ship straight to it. If `git status` shows another agent's edits, or `origin/main` is moving, wait. Do not stash, reset, or revert their files. Dashboard-only work can proceed without touching the repo.

## Easy to undo

- Bubble Card v3.4.3 and Mushroom v5.2.3 are vendored and prefixed (`area-card-bubble`, `area-card-mushroom-*`). Use those elements. A stock `mushroom-*` or `bubble-card` tag is the wrong card.
- The area-card editor has two fields: required `area` and optional `hide_sections` (multi-select). The floor-card editor has one required field: `floor`.
- Popup section order, dot slots, Entries, Satellites, LED dots, and room-name stripping are specified in `README.md`. Read it before changing `src/sections.ts`, `src/rollups.ts`, or `src/popup-cards.ts`.
