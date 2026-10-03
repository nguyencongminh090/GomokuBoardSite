// Default settings and colour presets.
(function (G) {
  'use strict';

  G.DEFAULT_SETTINGS = {
    lang: 'vi', // 'vi' | 'en'
    ui: 'light', // page theme: 'light' | 'dark' | 'auto' (follow the system)
    theme: 'paper', // board theme: 'paper' (cross & circle) | 'stone' (black & white)
    paper: {
      bg: '#fbf8f1',
      grid: '#c3cedb',
      xColor: '#c8322f',
      oColor: '#1f5bc4',
      wall: '#4b4f58',
      style: 'classic', // one style for both symbols: classic | bold | hand
    },
    stone: {
      bg: '#dcb35c',
      line: '#3a2a12',
      wall: '#3b3f46',
      style: 'glossy', // glossy | flat
    },
    coords: 'edge', // 'edge' (A–Z, 1–N around the board) | 'cell' (spiral numbers inside cells)
    showMoveNumbers: false,
    showLastMove: true,
    threatMap: false, // tag cells that would make 4-3 / 3-3 / open fours, and the cells that must be blocked
    voice: {
      confirm: true, // show the heard cell for a moment (cancellable) before playing it
    },
    signExports: true, // sign Export files when a key pair exists
    engine: {
      autoload: false, // load the engine when the page opens
      multi: true, // multi-threaded build when the page can be cross-origin isolated
      side: 'none', // player the engine plays after each host move: 'none' | '0' | '1'
      auto: false, // analyse every position
      rule: '0', // Rapfi rule id: '0' freestyle | '1' standard | '4' renju
      moveTime: 5, // seconds per engine move, 0 = no limit (until stopped)
      analysisTime: 10, // seconds per analysis, 0 = no limit (until stopped)
      nbest: 3, // candidate moves in an analysis
      depth: 99,
      strength: 100, // 0..100
      threads: 0, // 0 = one per logical CPU
      hash: '128', // transposition table size in MB
      selfDist: 3, // YXPLAYSELF distance
      oppDist: 3, // YXOPPDIST distance
    },
  };

  // Maps settings saved by older versions onto the current shape.
  G.migrateSettings = function (raw) {
    if (!raw || typeof raw !== 'object') return raw;
    if (raw.coords === undefined && typeof raw.showCellNumbers === 'boolean') {
      raw.coords = raw.showCellNumbers ? 'cell' : 'edge';
    }
    if (raw.paper && raw.paper.style === undefined && typeof raw.paper.xStyle === 'string') {
      raw.paper.style = raw.paper.xStyle;
    }
    if (typeof raw.wallColor === 'string') { // one shared wall colour -> one per board theme
      for (const theme of ['paper', 'stone']) {
        raw[theme] = raw[theme] || {};
        if (raw[theme].wall === undefined) raw[theme].wall = raw.wallColor;
      }
    }
    return raw;
  };

  G.SYMBOL_STYLES = ['classic', 'bold', 'hand'];

  // Every preset carries its own symbol and wall colours, chosen to meet WCAG 2.2 AA contrast on its
  // background (tests/model.test.js audits them). Stones stay black and white.
  G.PRESETS = {
    paper: [
      { name: 'White', bg: '#ffffff', grid: '#c9d3df', xColor: '#d6383a', oColor: '#2764d1', wall: '#4b4f58' },
      { name: 'Cream', bg: '#fbf8f1', grid: '#c3cedb', xColor: '#c8322f', oColor: '#1f5bc4', wall: '#4b4f58' },
      { name: 'Notebook', bg: '#eef4ff', grid: '#94b3e0', xColor: '#c21d3a', oColor: '#1e3a8a', wall: '#3a4660' },
      { name: 'Kraft', bg: '#e7d3ad', grid: '#b39463', xColor: '#9b1c1c', oColor: '#1f3b73', wall: '#4a3a28' },
      { name: 'Chalkboard', bg: '#22302a', grid: '#4d6a5d', xColor: '#ffd166', oColor: '#8ecdf5', wall: '#c9d6cf' },
    ],
    stone: [
      { name: 'Kaya', bg: '#dcb35c', line: '#3a2a12', wall: '#3b3f46' },
      { name: 'Pale', bg: '#ecd8a4', line: '#4a3a1c', wall: '#4b4f58' },
      { name: 'Walnut', bg: '#c38952', line: '#24160a', wall: '#1c1512' },
      { name: 'Slate', bg: '#9ea9ae', line: '#232d33', wall: '#2b2f36' },
      { name: 'Felt', bg: '#8fc19f', line: '#16301f', wall: '#1f2a24' },
    ],
  };
})(window.Gomoku = window.Gomoku || {});
