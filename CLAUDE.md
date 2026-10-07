# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static gomoku board for livestreamed games, deployed to GitHub Pages. One host runs the page and plays both sides
while players call moves over voice chat (TikTok live, video calls). It is not multiplayer, and it has no server,
no build step and no dependencies.

Product decisions (don't change them unless asked):
- Besides WALL cells the host can set **portal pairs** (`game.portals`, `[keyA, keyB]`): unplayable, Chebyshev distance >= 3
  between any two portal cells (the engine's rule, `Game.MIN_PORTAL_DISTANCE`), never on a wall or a move. A line entering one
  leaves from the other in the same direction. Explain/threat map are **off** on boards with portals (`explain.js` has no
  portal geometry); only the engine understands them.
- **Torus** (`game.torus`, saved as `torus: true` only when on): no board edges, the last column/row is next to the first. Portal
  distance is cyclic. Explain/threat map are off (`game.bendsLines()`). The engine gets `INFO TORUS 0|1` before the portal pairs
  (`EngineClient.torus`; `START` clears it) and refuses Renju on a torus, so the engine panel shows a note instead of searching.
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
engine/build.sh <rapfi repo>    # rebuild the engine WASM into ../GomokuEngineFiles (needs `source ~/emsdk/emsdk_env.sh`)
gate/deploy.sh                  # upload ../GomokuEngineFiles to the engine gate (Cloudflare Worker)
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

The scripts are classic `<script>` tags, loaded in dependency order in `index.html`: `i18n → contrast → coords → settings → game → security → storage → explain → board → engine → engine-panel → explain-panel → security-panel → voice → voice-panel → search → commands → search-panel → install → main`.
Each is an IIFE that attaches to the global namespace `window.Gomoku` (`G`). Keep it that way: ES modules would break
`file://` use, and `tests/model.test.js` loads `coords.js`/`game.js`/`security.js`/`explain.js`/`engine.js` by `eval` with a stub `window`, so
those files must stay free of DOM access at load time (`engine.js` touches `Worker` only when a load is requested).

- **`game.js` (`G.Game`): the only owner of game state.** Walls are a `Set` of cell keys (`y * size + x`, origin top-left).
  Moves form a variation tree stored as a **flat `nodes` array where a parent always has a lower index than its children**.
  Node 0 is the empty-board sentinel. Serialisation (`[parent, x, y]` triples + `prefs` + `cur`) and `removeSubtree`
  (which compacts and re-indexes) both rely on that ordering, so any new tree mutation must preserve it.
  - Portals: `portals` serialises as `[ax, ay, bx, by]`; the constructor drops invalid pairs. The engine client sends
    `INFO CLEARPORTALS` + `INFO YXPORTAL a b` before the `YXBOARD` block only when the set changed (`portalCommands`,
    `EngineClient.portals`; `START` clears them engine-side). The block cannot carry pairs, so a job's identity is
    `G.engineProtocol.jobKey(game)`, not the block alone.
  - `cur` is the displayed node. Each node's `pref` is the child that Forward, `toEnd` and `line()` follow. `goTo` rewrites
    `pref` along the path so Forward retraces the line you jumped to.
  - Player = `(depth - 1) % 2` (0 = cross/black moves first). It is derived, not stored.
  - `play` re-uses an existing child with the same coordinates instead of duplicating it.
  - The constructor is also the validator for imported and stored JSON: it throws on bad data.
  - `players` is an optional pair of names (first, second player; trimmed, max `Game.MAX_PLAYER_NAME`), saved per game and written
    only when set. `playerName(p)` in `main.js` returns it, else X/O or Black/White. In Live view `#players` shows two name cards
    beside the board (also with the panel hidden) and highlights the side to move; a new game keeps the names.
- **`board.js` (`G.BoardView`)** re-renders the whole SVG as a string on every change and redraws only the hover ghost on
  pointer move. Both themes share one geometry: position `(x, y)` is centred at `m + (x + 0.5) * P`. Paper draws cell
  borders around the positions; Stone draws lines through them. Themes change only the drawing, never the model.
  - **Grid lines are pixel-snapped.** `fit()` sets the SVG's size in JS (so one cell is a whole number of device pixels),
    and each line is nudged onto the pixel grid, with its width in whole device pixels. Don't size `#board` from CSS,
    don't draw grid lines at raw `m + i * P` coordinates, and don't add `shape-rendering="crispEdges"`: any of these
    brings back lines that render at uneven thickness. A `ResizeObserver` redraws when the available space changes.
- **`explain.js` (`G.explain`)** is pure freestyle threat analysis (no DOM; walls, edges and enemy stones block), modelled on
  Rapfi's pattern classes (`core/types.h` `Pattern4`). The board is held as **bitboards per line** (`Grid`: one 32-bit mask per
  player for every row, column and both diagonals; a cell is one bit of four lines), so window tests are mask operations. The
  public API takes plain `{ size, walls, stones }` boards: `classify`/`finish` (five, open four, 4-4, 4-3, 3-3), `map` (cells
  that would give such a finish), `defences` (cells the side to move must choose from: fives, open fours, double fours;
  counter-threats ignored), `solve` and `chain`. `solve` is a small VCF/VCT search (iterative deepening, so the line is a shortest win; a Zobrist-hashed transposition table per search; `Grid`s are pooled; budget-capped) returning one winning line (VCF: only
  fours, the defender must block; VCT: fours and open threes, the defender may answer a three with any cell that stops an
  open four; VCT also models the defender's counter-attack: instead of blocking a three, the defender may play a four, the attacker must
  block it at no cost, and a defender double or open four wins; a forced block of a defender four never costs an attacking
  move; node budget, depth and nested counters are capped). `chain` replays an engine PV, lets
  the solver **play the rest of the win** (engines stop a PV early) and traces the victory back from its end over the
  attacker's earlier threat moves; a run of threats that does not end in a win is not highlighted. Result
  `{ kind: 'VCF' | 'VCT', line, start, end, added, kinds, finish }` (`line` = PV + solver moves, from `added` on). Counter-fours and the attacker's forced blocks inside the chain are drawn
  as teal dotted rings and thin rings. The engine
  never reports this, so it is recomputed client-side. `settings.threatMap` draws `map` tags and `defences` rings
  (`BoardView.threatMap`, play mode only). Keep the bitboard code equal to the plain definitions: compare against an oracle
  (the pre-bitboard version in git, commit 0859097) after any change to `analyzeCell`/`windowCells`.
- **Explain vs Engine**: the engine only searches and reports (`engine.js`, `engine-panel.js`: controls, results table, and
  the PV hover / wheel preview, which keep working while it searches). **Explain** is everything we add on top, in
  `explain.js` (model) and `explain-panel.js` (the Explain section of the Analyse tab): the threat map switch, a position-level VCF/VCT
  search for the side to move (works without an engine), a step list that explains each move (attack, forced block,
  counter-attack), and the legend. Explain draws in its own board layer (`BoardView.setExplain`, under the engine's
  `setAnalysis` layer) and only while the Analyse tab is open; the board wheel belongs to Explain while its line is drawn (`explain.shown()`), else to the engine PV.
  The engine panel also calls `G.explain.chain` to tag and complete its PVs. Neither panel changes the game.
- **Win chance graph** (`engine-panel.js`, the first card of the Analyse tab, `#engGraph`): the bar has no history, so the panel keeps
  `evals`, a `Map` of position key -> the first player's win chance, filled by `remember()` whenever a search reports a
  winrate (same number the bar shows; it is never computed by a separate search). A position's key is its move path
  (`x,y;x,y`, `nodeKey`), not the node id, because ids are re-indexed by `removeSubtree`; the empty board is `''`. `evalsCtx`
  (size, torus, walls, portals, engine rule) guards the map: when it changes the map is cleared. `renderGraph()` draws the
  current line (`game.line()`, so moves after the cursor too): x = move number, y = 0-100 % on a rounded plot with 0/50/100 % guides, a smooth
  Catmull-Rom curve per run of adjacent known moves always drawn in the **first player's colour** (`--p0`; the second player never has a line, the graph is one number) with a gradient fill
  fading towards the 50 % line (on the Stone theme the black line gets a casing in `--text`, class `stone`, so it shows on the dark page), points coloured by who moved (only the cursor's above 30 points), and for the cursor move a ring,
  a vertical guide and its value. A legend above the plot shows both players and the cursor's split. Positions never analysed are gaps.
  Gradients are set as `fill`/`stroke` attributes, not in CSS (a CSS `url(#id)` resolves against the stylesheet). Clicking a point calls
  `app.goTo(id)`. It redraws on every `render()` and on resize.
  There is deliberately **no "analyse the whole game" action**: the graph only shows what the engine reported live (auto analysis
  fills it as the game is played). Not saved with the game, not exported.
- **`main.js`** holds app state (`game`, `mode: 'play' | 'setup'`, `settings`). The flow is always: mutate `game` → `persist()`
  (debounced localStorage write, flushed on `pagehide`) → `refresh()` (board + panels re-rendered from state).
  Settings controls are bound generically: inputs use `data-key="path.in.settings"` (checkbox/colour/select) and option
  buttons use `data-set="path.in.settings:value"` (click is delegated, so buttons rendered later work too). A new setting
  needs a default in `settings.js` plus a control with one of those attributes. No per-control JS is needed.
  Visual option cards (board theme, symbol style, stone style) are `data-set` buttons rendered by `renderPicks()` in
  `main.js` from preview functions in `board.js` (`themePreview`, `symbolPreview`, `stonePreview`), so they always show
  the current colours. The Settings tab is grouped into cards, most-used first: Board → Display → General → Security. `settings.view` (`'live'` default | `'analyze'`, the Live/Analyse switch in the top bar, `applyView()` in `main.js`) decides what is visible: **Live** hides the Versus and Analyse tabs, the language button (search stays), the win-chance bar and graph, the engine's board overlay and the threat map, so a livestream never shows engine ideas; **Analyse** shows everything and widens the panel to 480px on desktop. Anything that jumps to an engine tab (search, the engine chip) switches to Analyse first (`revealTab`). The panel has four tabs (Play, Versus, Analyse, Games); the gear in the top bar opens Settings, with About folded in at its end. **Play is the livestream view and holds no engine controls**: turn, mode, the move dock (cell input, mic, back/forward), branches, move list. Its only engine trace is the `#engChip` ("engine plays O") shown while the engine moves for a side; it jumps to Versus. Versus holds who the engine plays and "Engine move"; Analyse holds engine state and load, Analyse/auto-analysis with the eval bar, results, Explain, and folds engine tuning into "Engine options". Keep it that way: a new feature goes into one of these, not into a new tab (see `.claude/knowledge/ux-information-architecture.md`).
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
- **PWA** (`manifest.webmanifest`, `icons/`, `coi-serviceworker.js`, `js/install.js`): the site is installable (name MCaro). The one
  service worker adds COOP/COEP to every response and caches the app shell under the release version (its URL carries `?v=`,
  `G.serviceWorkerUrl`); it never caches `engine/`, `allowed-keys.json` or cross-origin requests. `install.js` shows a phone-only banner
  (Android: replays `beforeinstallprompt`; iOS: Share → Add to Home Screen hint), hidden for 14 days once dismissed and never in the
  installed app. `main.js` reloads when the app returns to the front and `index.html` carries a newer `app-version`. A new asset in the
  shell needs adding to `SHELL` in the worker; the manifest screenshots (`icons/shot-*.png`) feed Android's rich install dialog.
- **Presets** (`G.PRESETS` in `settings.js`) set every colour of their theme, including symbols and walls (walls are
  per theme: `paper.wall` / `stone.wall`). A test audits every preset in both coordinate modes, so a new or edited
  preset must pass WCAG AA. The default paper colours equal the Cream preset.
- **`storage.js`** wraps every localStorage access in try/catch. `loadSettings` merges only keys that exist in the defaults
  with a matching type, so renaming a setting silently drops the saved value unless `G.migrateSettings` (in `settings.js`)
  maps the old key onto the new one.
- **Security** (`js/security.js` model, `js/security-panel.js` UI): an ECDSA P-256 key pair made with Web Crypto. The
  private key is a **non-extractable** `CryptoKey` stored in IndexedDB (`storage.loadOwnKey`/`saveOwnKey`); there is no
  password, backup or restore, so it cannot be copied to another person and a lost key means generating a new one. The
  public key is shared as a 44-character **key code** (compressed point, `G.security.keyCode`) or a `gomoku-public-key`
  file. Export adds `signature` (over the compact JSON of the body without it); Import rejects a signature that does not
  verify and reports own / trusted / unknown signer. Unsigned files still import. The engine is for key holders only:
  `engine-panel.js` `requestLoad()` asks `app.authorize()`, which needs a private key whose public key is listed in
  `allowed-keys.json` (repo root), proved by signing a fresh challenge. `node tools/add-key.js <code> [name]` adds a key.
  Defence in depth against console tampering: `G.engineGuard` (a locked, non-writable property) is re-checked inside
  `EngineClient.load` and `run`, and `main.js` freezes `G`, `G.security` and `EngineClient` after start. This is
  client-side only: the engine files in `engine/` are public (and in git history), so a determined user can still run them.
  Real enforcement needs the host to hide them (e.g. Cloudflare Access), not code.
  **Engine gate (`gate/`, optional):** a Cloudflare Worker that serves the Rapfi files only against a token. `/challenge`
  gives a MACed nonce, the page signs it with the private key, `/token` verifies it against `allowed-keys.json` (read from
  Pages) and returns an HMAC token; `/engine/*?t=` checks it. It is switched on by `<meta name="engine-gate" content="URL">`
  in `index.html` (empty = engine files served locally, old behaviour). Then `G.engineGuard()` returns `{ gate, token }`,
  and `engine.worker.js` loads the files from the gate (the `gate`/`t` query also reaches the pthread workers).
  `gate/deploy.sh` copies the engine from `../GomokuEngineFiles` (outside the repo; `engine/rapfi-*` is git-ignored) into
  `gate/public` (git-ignored) and deploys. The engine files are no longer in the tree, but they are still in git history
  until it is rewritten, so the gate protects nothing until then. Revocation lags by `TOKEN_TTL`.
- **Feature search** (`js/search.js` model, `js/search-panel.js` UI): the magnifier button in the top bar (`/` or Ctrl+K) opens a centred `<dialog>` over a dimmed page; it finds a control from a short
  question and jumps to it (closing the dialog first). The model is DOM-free NLP: fold tone marks (`cai dat` = `cài đặt`), drop stop words and question openers
  (`làm sao để`, `how do I`), light English stemming, a TF-IDF style index (title > keywords > description, both languages in one
  index), prefix match for the word being typed, typo tolerance (edit distance 1-2), adjacent-pair bonus, inline completion
  (`complete`) and "did you mean" (`correct`). `FEATURES` in `search-panel.js` maps each id to a tab and `targets` (first visible
  selector wins; `before: 'setup'` enters Setup mode first). A new feature needs a row there plus `find.<id>`, `.d` and `.k`
  (`;`-separated keywords and synonyms) in **both** languages; a test checks the strings and that `#id` / `data-*` targets exist.
- **Search commands** (`js/commands.js`, `G.commands.parse(text, { settings, size })`): the same search box also applies settings
  ("set board 17x17", "bật chế độ tối", "strength 70", "hide last move"). DOM-free: it only returns actions (`set`, `preset`, `newGame`,
  `error`); `applyCommands` in `main.js` applies them through `settingsChanged()` / `startGame()`. Clauses split at "and/và/,"; the first
  matching rule per clause wins. Board size is per game, so a size command starts a new game. A new rule needs `cmd.name.<id>` in both languages.
- **Voice search and auto-correct** (`#searchMic` in the search dialog): click to record, click again to stop (10 s cap). It reuses the
  voice panel's Groq key and transcriber through `voice.dictate(lang)` (language = the interface language) and never plays a move.
  The transcript lands in the box, spelling-corrected by `autocorrect()` when the fixed text matches a command or a feature, and is
  **never applied without Enter**. Typed queries are corrected the same way (no results -> results for the fixed spelling; a misspelt
  command -> Enter shows the corrected command first). `G.search.correct` leaves words with digits alone ("70" must not become "50").
- **Voice moves** (`js/voice.js` model, `js/voice-panel.js` UI): hold the mic button or V, say a cell. The clip goes to Groq's
  `whisper-large-v3` (free tier, `language=vi`, `temperature=0`; 82% right on spoken cell numbers in `tools/voice-proto`, Web Speech
  64%), and `G.voice.parseCell(text, size)` turns the text into a cell: edge labels (`H8`, `hát tám`) or spiral numbers (`ba mươi bảy`),
  both accepted whatever `settings.coords` is. Text that does not parse, or a cell that cannot be played, is never played. The host's
  own API key is in localStorage (`storage.loadGroqKey`), never in settings or exports. `settings.voice.confirm` previews the cell
  (`BoardView.setVoice`) for 1.5 s before playing it through the normal `game.play()` path. No prompt is sent to Whisper (it can echo it).
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
  - **Playing style** (`settings.engine.style`: `normal` | `aggressive` | `defensive` | `troll`, Versus tab, Level card): `INFO STYLE 0|1|2|3`
    plus `INFO STYLE_MARGIN` and `INFO STYLE_CONTEMPT` go through `configCommands` like every INFO value. Only move jobs
    carry the style (`styleConfig(kind, style)`); analysis jobs send `STYLE 0`, as they force strength 100. A changed STYLE clears the
    engine's hash and START does not reset it (the `applied` map is cleared only with the worker). The engine applies a style only on
    wall/portal/torus boards at strength 100 and silently plays normal otherwise; `styleBlocked()` drives the `#engStyleNote` hint.
    Margin is per style (`styleMarginAggressive` 60, `styleMarginDefensive` 30) and contempt shared (`styleContempt` 30), in a "Style tuning"
    `<details>`; `G.engineProtocol.STYLE_LIMITS` (margin 0..400, contempt 0..200; the engine allows 0..6000, but the win chance is
    sigmoid(value/200) and past 400 any non-losing move qualifies) clamps what is sent, and the inputs carry the same min/max.
    **Troll** (`troll`, vi "Cầu hoà", never "cân bằng", which is Normal) seeks a draw: it never wins unless every other move loses,
    even leaving a five unplayed. It has its own margin (`styleMarginTroll` 60, on the Troll scale) and `INFO STYLE_TROLL_TARGET`
    (`trollTarget` 500, `STYLE_LIMITS.target` 0..1000: the edge it keeps and never cashes in), sent only with Troll; the target does not
    clear the hash, and Troll ignores the contempt (still sent, harmless). The four style buttons wrap 2x2 on phones (`.seg-wrap`).
    With a style on, the move played may not be the first PV line. Protocol: `Rapfi/docs/protocol-style.md` in the engine source.
  - Threads need COOP/COEP; `coi-serviceworker.js` adds them and `engine-panel.js` reloads once (guarded per tab by
    sessionStorage). Engine settings live under `settings.engine`; number fields commit on `change` and are clamped.
  - The overlay is a separate SVG layer (`BoardView.setAnalysis`), redrawn without re-rendering the board. A previewed line is
    drawn at full length (with the solver's added moves in italics) and any candidate's line shows when its marker is hovered; hovering a move in the PV column, or the mouse wheel over the board (`scrollPreview`), sets how many
    moves show. The preview survives moving the pointer from the table onto the board, and is cleared on leaving both.
    Attack chain colours: VCF red, VCT purple (`ATTACK` in `board.js`, `.atk` in CSS).

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
