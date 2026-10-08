# Gomoku Board

A static gomoku board for livestreamed games. One host runs the page and plays both sides,
while players call their moves over voice (TikTok live, video calls, ...). No server, no build step.

## Features

- **Board** of any size from 5×5 to 26×26, chosen when starting a new game.
- **Controls**: Back, Forward, first/last move, New game.
- **Variations**: go back and play a different move to create a branch. The old line is kept.
  Switch with ↑/↓, the branch chips, or the move list. Branch points are lettered on the board.
- **Board setup**: add or remove WALL cells that nobody can play on, and **portal pairs** (a line entering one portal
  leaves from the other in the same direction; portal cells are unplayable and at least 3 cells apart). New games can copy
  portals along with walls. Explain is off on boards with portals; the engine supports them.
- **Torus**: a board setting in Board setup that removes the edges: the last column is next to the first and the last row
  next to the first, in every direction (a dashed teal frame marks the seam). Portal distances are measured the short way
  round. Explain is off on a torus; the engine supports it (Freestyle and Standard, not Renju).
- **Board themes**: *Paper* (cross and circle on grid paper; colours configurable, one symbol style
  shared by both marks: classic, bold or hand-drawn) and *Stone* (black and white stones; colours configurable).
- **Page theme**: light (default), dark, or auto (follows the system).
- **Colour presets**: each preset sets its own background, grid or lines, symbol and wall colours.
- **Contrast check (WCAG 2.2 AA)**: every colour shows its contrast ratio. Colours that are hard to see get a warning and
  a one-click suggested replacement.
- **Coordinates**, one at a time: letters and numbers on the board edge (A–Z, 1–N from the bottom),
  *or* numbers inside cells spiralling out from the centre (1 … size²), so viewers can call a move as "37".
- **Languages**: Vietnamese (default) and English. Switch in Settings or with the VI/EN button in the top bar.
- **Saved games**: every game is saved in the browser (localStorage) automatically. Starting a new
  game keeps the previous one under *Games*. Export/Import to JSON for backups.
- **Engine** (Rapfi, WebAssembly, runs in the browser): analyze a position (top moves with eval, win
  chance, depth and line, marked on the board; hover a line to preview it), auto-analysis on every
  position change, *Engine move*, *Engine plays X / O* (answers each host move), and distance moves
  (`YXPLAYSELF` / `YXOPPDIST`). Walls are sent to the engine, which treats them as line blockers.
  The *Engine* tab loads it and sets rule, time, suggestions, depth, strength, playing style (normal, aggressive, defensive or troll), threads and hash.
  Boards up to 22×22 (Rapfi's limit). The board itself still enforces no rules.

Keyboard: `←` `→` back/forward · `↑` `↓` switch branch · `Home` `End` · `S` setup · `N` new game ·
`F` hide the side panel (board only, for streaming) · `A` analyze / stop · `E` engine move.

## Run locally

Open `index.html` in a browser. It uses plain scripts (no ES modules), so it also works from `file://`,
except the engine: browsers do not run Web Workers or WebAssembly files from `file://`. For the engine,
serve the folder: `python3 -m http.server 8000` and open <http://localhost:8000>.

## Engine threads

The multi-threaded engine needs `SharedArrayBuffer`, which browsers only allow on cross-origin isolated
pages (COOP/COEP headers). GitHub Pages cannot send those headers, so when multi-threading is on (the
default), `coi-serviceworker.js` (registered on every visit) adds them, and loading the engine reloads the page
once if it was not yet in control. Without service workers (or when isolation fails) the single-threaded build is used, and it
stops a search by restarting the engine. See `engine/README.md` for the engine files, their GPLv3
licence and how to rebuild them.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to *Settings → Pages* and set *Source* to "Deploy from a branch", then pick the branch and `/ (root)`.

### Releasing a new version

Browsers cache the site's files (GitHub Pages allows about 10 minutes). Before pushing changes, bump the version:

```bash
node tools/bump-version.js 1.2.0
```

It updates `index.html`: the `app-version` meta tag and the `?v=` query on every stylesheet and script. The engine
worker passes the same query on to the engine's `.js`, `.wasm` and `.data` files, so a returning visitor gets the whole
new release at once instead of a mix of old and new files. The current version is shown at the bottom of *Settings*.

## Files

| File | Role |
|---|---|
| `js/game.js` | Game model: walls and the variation tree (flat node array, parents before children) |
| `js/board.js` | SVG renderer for both themes, hover preview, click-to-cell mapping |
| `js/coords.js` | Edge labels and spiral cell numbering |
| `js/security.js` | Device-bound key pair (non-extractable), key codes, export signing and verification (Web Crypto) |
| `js/security-panel.js` | Security card in Settings and the engine key gate |
| `tools/add-key.js` | Adds a public key code to `allowed-keys.json` (the engine allow-list) |
| `js/storage.js` | localStorage access, guarded against full or disabled storage |
| `js/settings.js` | Default settings and colour presets |
| `js/i18n.js` | UI strings (vi, en) and the `data-i18n` markup translator |
| `js/contrast.js` | WCAG contrast ratios, fix suggestions and the board colour audit |
| `js/engine.js` | Engine client: Web Worker lifecycle, search jobs, protocol builder and parser |
| `js/engine-panel.js` | Analyse tab (engine and Explain), engine block of the Play tab, board overlay |
| `js/main.js` | UI wiring, panels, keyboard, import/export |
| `engine/` | Rapfi WebAssembly builds, their worker host and build script (GPLv3, see `engine/README.md`) |
| `tools/bump-version.js` | Sets the release version used for cache busting (see *Releasing a new version*) |
| `coi-serviceworker.js` | Service worker: adds COOP/COEP headers (engine threads on GitHub Pages) and caches the app shell for offline use |
| `js/install.js` | Phone-only banner that offers to install the app |
| `manifest.webmanifest`, `icons/` | PWA manifest and icons: the site can be installed on a phone (Chrome: Install app; iOS Safari: Share → Add to Home Screen). The engine is never cached offline |
| `tests/model.test.js` | Model and engine protocol tests: `node tests/model.test.js` |

## Saved game format

```json
{
  "id": "m1abc2de3f",
  "name": "Game 26 Sep 14:05",
  "size": 15,
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000,
  "walls": [[3, 3], [11, 11]],
  "portals": [[2, 2, 10, 11]],
  "torus": true,
  "players": ["An", "Binh"],
  "nodes": [[0, 7, 7], [1, 8, 7], [1, 6, 6]],
  "prefs": [1, 2, -1, -1],
  "cur": 2
}
```

`x` and `y` are 0-based with the origin at the top-left. `portals` entries are `[ax, ay, bx, by]`
(optional: older saves have none; pairs that break the placement rules are dropped on load). `group` (the group name shown in the Games tab, up to 40 characters) is optional and written only when set. `players` (first and second player names, up to 24 characters) is optional and written only when a name is set. `torus` is optional
and written only when `true`; portal distances are then measured across the seam. `nodes[i]` is node `i + 1` as
`[parent, x, y]`; node 0 is the empty board. `prefs[n]` is the child that Forward follows from
node `n` (`-1` when there is none). `cur` is the node currently shown.
