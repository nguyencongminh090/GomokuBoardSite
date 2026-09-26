# Gomoku Board

A static gomoku board for livestreamed games. One host runs the page and plays both sides,
while players call their moves over voice (TikTok live, video calls, ...). No server, no build step.

## Features

- **Board** of any size from 5×5 to 26×26, chosen when starting a new game.
- **Controls**: Back, Forward, first/last move, New game.
- **Variations**: go back and play a different move to create a branch. The old line is kept.
  Switch with ↑/↓, the branch chips, or the move list. Branch points are lettered on the board.
- **Board setup**: add or remove WALL cells that nobody can play on. New games can copy walls
  from the current game.
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

Keyboard: `←` `→` back/forward · `↑` `↓` switch branch · `Home` `End` · `S` setup · `N` new game ·
`F` hide the side panel (board only, for streaming).

## Run locally

Open `index.html` in a browser. It uses plain scripts (no ES modules), so it also works from `file://`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to *Settings → Pages* and set *Source* to "Deploy from a branch", then pick the branch and `/ (root)`.

## Files

| File | Role |
|---|---|
| `js/game.js` | Game model: walls and the variation tree (flat node array, parents before children) |
| `js/board.js` | SVG renderer for both themes, hover preview, click-to-cell mapping |
| `js/coords.js` | Edge labels and spiral cell numbering |
| `js/storage.js` | localStorage access, guarded against full or disabled storage |
| `js/settings.js` | Default settings and colour presets |
| `js/i18n.js` | UI strings (vi, en) and the `data-i18n` markup translator |
| `js/contrast.js` | WCAG contrast ratios, fix suggestions and the board colour audit |
| `js/main.js` | UI wiring, panels, keyboard, import/export |
| `tests/model.test.js` | Model tests: `node tests/model.test.js` |

## Saved game format

```json
{
  "id": "m1abc2de3f",
  "name": "Game 26 Sep 14:05",
  "size": 15,
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000,
  "walls": [[3, 3], [11, 11]],
  "nodes": [[0, 7, 7], [1, 8, 7], [1, 6, 6]],
  "prefs": [1, 2, -1, -1],
  "cur": 2
}
```

`x` and `y` are 0-based with the origin at the top-left. `nodes[i]` is node `i + 1` as
`[parent, x, y]`; node 0 is the empty board. `prefs[n]` is the child that Forward follows from
node `n` (`-1` when there is none). `cur` is the node currently shown.
