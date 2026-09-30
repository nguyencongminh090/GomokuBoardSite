# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static gomoku board for livestreamed games, deployed to GitHub Pages. One host runs the page and plays both sides
while players call moves over voice chat (TikTok live, video calls). It is not multiplayer, and it has no server,
no build step and no dependencies.

Product decisions (don't change them unless asked):
- The board is a free editor, not a rules engine. There is **no win detection** and no rule enforcement beyond "cell
  is empty and not a wall".
- "Numbers inside cells" means a **spiral numbering of every cell** from the centre (1 … size²) that viewers use to call
  moves out loud. It is not move order; move order on pieces is a separate setting.
- Coordinates are **either** edge labels **or** cell numbers (`settings.coords`), never both. Move text in the panel
  follows the active one (`H8` vs `#37`).
- Cross and circle always share **one symbol style** (`settings.paper.style`); only their colours differ.
- Vietnamese is the default language; English is the second. Every user-visible string goes through `js/i18n.js`.
- Going back and playing a different move creates a **branch** (variation tree). Nothing is overwritten.
- Games persist only in the browser's localStorage. Export/Import JSON is the backup path.
- The engine (Rapfi, WebAssembly) is optional and never changes the game except by playing a move
  through the normal `game.play()` path, so its moves branch like any other.

## Commands

```bash
node tests/model.test.js        # model, i18n, contrast, preset and engine protocol tests; exit code 1 on failure
xdg-open index.html             # run the site: works straight from file:// (classic scripts, not ES modules)
python3 -m http.server 8000     # or serve it, same as GitHub Pages; the engine only runs when served
engine/build.sh <rapfi repo>    # rebuild the engine WASM (needs `source ~/emsdk/emsdk_env.sh`)
node tools/bump-version.js X.Y.Z # set the release version (cache busting); do this before every deploy
```

**Versioning:** `index.html` is the single source of the release version (`<meta name="app-version">` plus `?v=` on every
local asset). `G.VERSION` (in `engine.js`) reads the meta tag; the engine worker URL carries it, and the worker appends
its own query to the engine files. A new script or stylesheet must get the `?v=` query too (the bump script updates
any `css/*.css` or `js/*.js` reference).

There is no linter, formatter or bundler. For a UI check without a browser window, headless Chrome can screenshot the page:
`google-chrome --headless=new --user-data-dir=<scratch dir> --window-size=1400,900 --screenshot=<out.png> file://$PWD/index.html`.
Use a scratch `--user-data-dir` so the test run doesn't share localStorage with real games.

## Architecture

The scripts are classic `<script>` tags, loaded in dependency order in `index.html`: `i18n → contrast → coords → settings → game → storage → board → engine → engine-panel → main`.
Each is an IIFE that attaches to the global namespace `window.Gomoku` (`G`). Keep it that way: ES modules would break
`file://` use, and `tests/model.test.js` loads `coords.js`/`game.js`/`engine.js` by `eval` with a stub `window`, so
those files must stay free of DOM access at load time (`engine.js` touches `Worker` only when a load is requested).

- **`game.js` (`G.Game`): the only owner of game state.** Walls are a `Set` of cell keys (`y * size + x`, origin top-left).
  Moves form a variation tree stored as a **flat `nodes` array where a parent always has a lower index than its children**.
  Node 0 is the empty-board sentinel. Serialisation (`[parent, x, y]` triples + `prefs` + `cur`) and `removeSubtree`
  (which compacts and re-indexes) both rely on that ordering, so any new tree mutation must preserve it.
  - `cur` is the displayed node. Each node's `pref` is the child that Forward, `toEnd` and `line()` follow. `goTo` rewrites
    `pref` along the path so Forward retraces the line you jumped to.
  - Player = `(depth - 1) % 2` (0 = cross/black moves first). It is derived, not stored.
  - `play` re-uses an existing child with the same coordinates instead of duplicating it.
  - The constructor is also the validator for imported and stored JSON: it throws on bad data.
- **`board.js` (`G.BoardView`)** re-renders the whole SVG as a string on every change and redraws only the hover ghost on
  pointer move. Both themes share one geometry: position `(x, y)` is centred at `m + (x + 0.5) * P`. Paper draws cell
  borders around the positions; Stone draws lines through them. Themes change only the drawing, never the model.
  - **Grid lines are pixel-snapped.** `fit()` sets the SVG's size in JS (so one cell is a whole number of device pixels),
    and each line is nudged onto the pixel grid, with its width in whole device pixels. Don't size `#board` from CSS,
    don't draw grid lines at raw `m + i * P` coordinates, and don't add `shape-rendering="crispEdges"`: any of these
    brings back lines that render at uneven thickness. A `ResizeObserver` redraws when the available space changes.
- **`main.js`** holds app state (`game`, `mode: 'play' | 'setup'`, `settings`). The flow is always: mutate `game` → `persist()`
  (debounced localStorage write, flushed on `pagehide`) → `refresh()` (board + panels re-rendered from state).
  Settings controls are bound generically: inputs use `data-key="path.in.settings"` (checkbox/colour/select) and option
  buttons use `data-set="path.in.settings:value"` (click is delegated, so buttons rendered later work too). A new setting
  needs a default in `settings.js` plus a control with one of those attributes. No per-control JS is needed.
  Visual option cards (board theme, symbol style, stone style) are `data-set` buttons rendered by `renderPicks()` in
  `main.js` from preview functions in `board.js` (`themePreview`, `symbolPreview`, `stonePreview`), so they always show
  the current colours. The Settings tab is grouped into three cards, most-used first: Board → Display → General.
- **Page theme**: `<html data-ui="light|dark">` selects the CSS token set in `css/style.css`. An inline script in
  `index.html` sets it before first paint; `applyPageTheme()` in `main.js` keeps it in sync, including `auto` following
  the system. Use `--accent-text` (not `--accent`) for accent-coloured text and thin lines, because it is tuned for contrast per theme.
- **i18n (`js/i18n.js`)**: `STRINGS.vi` / `STRINGS.en` map keys to strings or functions of named params (English
  plurals live in those functions). Static markup is translated by `data-i18n` (text), `data-i18n-html` (trusted markup
  from the dictionary) and `data-i18n-attr="title:key;aria-label:key"`. Dynamic text uses `t(key, params)`, and dates use
  `G.i18n.locale`. Add every new key to **both** languages; a test checks they match. Saved game names are user data
  and are never retranslated.
- **`contrast.js` (`G.contrast`)** holds the WCAG 2.2 maths (no DOM) and `audit(settings)`, which checks the active
  theme's colours: symbols, walls, stone lines and black stones need 3:1 (SC 1.4.11), and coordinate text needs 4.5:1
  (SC 1.4.3). The grid's 1.4:1 is only a visibility recommendation (`advisory`), because grid lines are meant to be
  faint. `board.js` draws board text with `G.contrast.ink()` and `INK_ALPHA`, the same values the audit checks, so
  change them together. The Settings colour chips show each ratio, and `renderContrast()` lists failures with a
  suggested fix (same hue, lightness shifted, aiming `SUGGEST_MARGIN` above the minimum) and toasts newly failing colours.
- **Presets** (`G.PRESETS` in `settings.js`) set every colour of their theme, including symbols and walls (walls are
  per theme: `paper.wall` / `stone.wall`). A test audits every preset in both coordinate modes, so a new or edited
  preset must pass WCAG AA. The default paper colours equal the Cream preset.
- **`storage.js`** wraps every localStorage access in try/catch. `loadSettings` merges only keys that exist in the defaults
  with a matching type, so renaming a setting silently drops the saved value unless `G.migrateSettings` (in `settings.js`)
  maps the old key onto the new one.
- **Engine** (`js/engine.js`, `js/engine-panel.js`, `engine/`): Rapfi runs in a Web Worker (`engine/engine.worker.js`)
  that hosts one of two Emscripten builds: `multi` (pthreads, needs `crossOriginIsolated`) or `single`. Protocol
  facts the client relies on, verified against `command/gomocup.cpp` of the MINT-P engine:
  - Every search is one job: `YXBOARD` block (walls as colour `3`, stones in move order with the first player as
    colour `1`) then `YXNBEST n` / `YXPLAYSELF n` / `YXOPPDIST n`. The block is **authoritative for walls** (it
    replaces the engine's wall set), so no `INFO WALL` is needed; with walls present it also clears the hash.
    The block text doubles as the job key: a result applies only while `boardBlock(game)` still equals it.
  - While thinking, the engine ignores every command except `STOP`/`YXSTOP`/`END`, and it answers **every**
    search with one move line, stopped or not (the protocol doc says otherwise; the code wins). So a new job waits
    for that line (`EngineClient.run` queues and stops). The single build cannot hear `YXSTOP` mid-search: stopping
    it restarts the worker.
  - Init commands (`SHOW_DETAIL 2`, etc.) must reach the engine before the first job; the detail `INFO` feed is
    what the analysis table parses (`InfoCollector`). Moves from the opening logic come without that feed.
  - When loaded inside a worker, Emscripten starts pthreads from the worker's own URL, which is why
    `engine.worker.js` checks `self.name === 'em-pthread'`.
  - Rapfi's board limit is 22×22 (`G.engineProtocol.MAX_SIZE`); the site allows 26, so the engine disables itself above 22.
  - Threads need COOP/COEP; `coi-serviceworker.js` adds them and `engine-panel.js` reloads once (guarded per tab by
    sessionStorage). Engine settings live under `settings.engine`; number fields commit on `change` and are clamped.
  - The overlay is a separate SVG layer (`BoardView.setAnalysis`), redrawn without re-rendering the board.

The saved-game JSON format is documented in `README.md`. Changing it needs a migration, because users' existing games
live in their browsers.

## Local skills and knowledge

Copied from the SKILLS_TREE library (`/run/media/ngmint/Data/Programming/Programming/SKILLS/SKILLS_TREE`):
- Skills in `.claude/skills/`: `bug-hunter`, `verification-before-completion`, `google-style-javascript`,
  `google-style-html-css`, `git-commit`.
- Knowledge notes in `.claude/knowledge/`: accessibility (`a11y-aria-keyboard-focus`, `a11y-wcag-essentials`), browser
  support baseline, e2e browser testing. Read them before changing keyboard handling, focus, colours or contrast.

Coding standards come from `SKILLS_TREE/rules/coding-standards/items/` (`code-writing.md`, `coding-style.md`). Match the
surrounding code first. Column alignment is applied only when the user runs `/align`.
