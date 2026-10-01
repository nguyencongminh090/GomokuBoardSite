// Explain: the model that explains a position or an engine line. It classifies moves (five, four, open three, 4-3, 3-3...), maps threats and forced
// blocks, and finds a victory by continuous threats (VCF = only fours, VCT = fours and open threes).
// Pure model code (no DOM). Freestyle gomoku: five or more in a row wins; walls, edges and enemy stones block.
//
// The board is held as bitboards per line (every row, column and both diagonals is one 32-bit mask per player), as
// in Rapfi's line patterns. A cell sits at bit `pos` of four lines, so "is there a five in this window?" or "which
// cell completes it?" is a few mask operations instead of reading cells one by one.
(function (G) {
  'use strict';

  // Line directions: horizontal, vertical, diagonal (x - y constant), anti-diagonal (x + y constant).
  // Along each line a cell's bit is its x, except for columns where it is its y, so neighbours on a line are neighbouring bits.
  const lineOf = [
    (x, y, n) => y,
    (x, y, n) => x,
    (x, y, n) => x - y + n - 1,
    (x, y, n) => x + y,
  ];
  const posOf = [(x, y) => x, (x, y) => y, (x, y) => x, (x, y) => x];

  // Population count of a 5-bit window, and the position of the lowest clear bit of a window with four stones.
  const POP5 = [];
  const HOLE5 = [];
  for (let w = 0; w < 32; w++) {
    POP5.push((w & 1) + ((w >> 1) & 1) + ((w >> 2) & 1) + ((w >> 3) & 1) + ((w >> 4) & 1));
    let hole = -1;
    for (let i = 4; i >= 0; i--) if (!((w >> i) & 1)) hole = i;
    HOLE5.push(hole);
  }
  const popcount = (v) => {
    v -= (v >>> 1) & 0x55555555;
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };

  // Population count of a 9-bit window.
  const POP9 = [];
  for (let w = 0; w < 512; w++) POP9.push(POP5[w & 31] + POP5[w >> 5 & 15] );
  const gridCache = new Map(); // size -> geometry shared by every Grid of that size

  // Per-size geometry: the cell of every (direction, line, bit) and the valid-bit mask of every line.
  function geometry(size) {
    let g = gridCache.get(size);
    if (g) return g;
    const lines = [size, size, 2 * size - 1, 2 * size - 1];
    const valid = lines.map((c) => new Int32Array(c));
    const cellAt = lines.map((c) => new Int16Array(c * 32).fill(-1));
    const lineIdx = lines.map(() => new Int16Array(size * size)); // the line a cell lies on, per direction
    const posIdx = lines.map(() => new Int8Array(size * size)); // and its bit on that line
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (let d = 0; d < 4; d++) {
          const L = lineOf[d](x, y, size);
          const p = posOf[d](x, y);
          valid[d][L] |= 1 << p;
          cellAt[d][L * 32 + p] = y * size + x;
          lineIdx[d][y * size + x] = L;
          posIdx[d][y * size + x] = p;
        }
      }
    }
    // Zobrist keys: two 32-bit words per (player, cell) make a 53-bit position hash for the solver's table.
    let seed = size * 7919 + 17;
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed | 0;
    };
    const zob = [0, 1].map(() => [new Int32Array(size * size), new Int32Array(size * size)]);
    for (const p of zob) for (const a of p) for (let i = 0; i < a.length; i++) a[i] = rnd();
    g = { size, lines, valid, cellAt, lineIdx, posIdx, zob };
    gridCache.set(size, g);
    return g;
  }

  class Grid {
    constructor(size) {
      this.size = size;
      this.geo = geometry(size);
      const lines = this.geo.lines;
      this.own = [0, 1].map(() => lines.map((c) => new Int32Array(c)));
      this.block = lines.map((c) => new Int32Array(c)); // walls
      this.cell = new Int8Array(size * size).fill(-1); // -1 empty, 0 / 1 stone of that player, 2 wall
      this.stamp = new Int32Array(size * size);
      this.gen = 0;
      this.h1 = 0; // Zobrist hash of the stones (walls never change during a search, so they are left out)
      this.h2 = 0;
    }

    // board: { size, walls: Set of keys, stones: Map key -> player }
    load(board) {
      for (const k of board.walls) this.set(k, 2);
      for (const [k, p] of board.stones) this.set(k, p);
    }

    reset() {
      for (const per of this.own) for (const a of per) a.fill(0);
      for (const a of this.block) a.fill(0);
      this.cell.fill(-1);
      this.h1 = 0;
      this.h2 = 0;
    }

    // 53-bit position key: fits a JS number exactly, so the transposition table can be a plain Map.
    hash() {
      return (this.h1 >>> 0) * 2097152 + (this.h2 & 2097151);
    }

    set(k, p) {
      const { lineIdx, posIdx, zob } = this.geo;
      this.cell[k] = p;
      if (p !== 2) {
        this.h1 ^= zob[p][0][k];
        this.h2 ^= zob[p][1][k];
      }
      for (let d = 0; d < 4; d++) {
        const L = lineIdx[d][k];
        const bit = 1 << posIdx[d][k];
        if (p === 2) this.block[d][L] |= bit;
        else this.own[p][d][L] |= bit;
      }
    }

    clear(k) {
      const { lineIdx, posIdx, zob } = this.geo;
      const p = this.cell[k];
      this.cell[k] = -1;
      if (p !== 2) {
        this.h1 ^= zob[p][0][k];
        this.h2 ^= zob[p][1][k];
      }
      for (let d = 0; d < 4; d++) {
        const L = lineIdx[d][k];
        const bit = ~(1 << posIdx[d][k]);
        if (p === 2) this.block[d][L] &= bit;
        else this.own[p][d][L] &= bit;
      }
    }

    // Bits of line (d, L) that player p cannot use: off the board, walls and enemy stones.
    blocked(p, d, L) {
      return ~this.geo.valid[d][L] | this.block[d][L] | this.own[1 - p][d][L];
    }
  }

  // Grids are reused: building one allocates a dozen typed arrays, and every public call needs one.
  const gridPool = new Map(); // size -> free grids
  function withGrid(board, fn) {
    let free = gridPool.get(board.size);
    if (!free) gridPool.set(board.size, (free = []));
    const grid = free.pop() || new Grid(board.size);
    grid.load(board);
    try {
      return fn(grid);
    } finally {
      grid.reset();
      free.push(grid);
    }
  }

  // Completing cells (as a bit mask on the line) of every five-window through bit `pos` that holds four stones.
  function fourCells(O, B, pos) {
    let out = 0;
    for (let s = Math.max(0, pos - 4); s <= pos; s++) {
      const w = O >>> s & 31;
      if (POP5[w] !== 4 || ((B >>> s) & 31) !== 0) continue;
      out |= 1 << (s + HOLE5[w]);
    }
    return out;
  }

  // What the stone of player p at cell k makes over the four directions, packed in one integer (no allocation):
  //   bit 0: a five;  bit 1: an open four (some four has two completing cells);
  //   bits 2-4: directions holding a four;  bits 5-7: directions holding an open three.
  const FIVE = 1;
  const OPEN = 2;
  const foursOf = (a) => (a >> 2) & 7;
  const threesOf = (a) => (a >> 5) & 7;

  function analyzeCell(grid, k) {
    const { lineIdx, posIdx, valid } = grid.geo;
    const p = grid.cell[k];
    const mine = grid.own[p];
    const theirs = grid.own[1 - p];
    let five = 0;
    let open = 0;
    let fours = 0;
    let threes = 0;
    for (let d = 0; d < 4; d++) {
      const L = lineIdx[d][k];
      const pos = posIdx[d][k];
      const O = mine[d][L];
      const near = (O >>> Math.max(0, pos - 4)) & 511; // the stones within reach of this one, as a 9-bit window
      if (POP9[near] < 3) continue; // a four needs 4 stones in a window and a three 3: nothing to find in this direction
      const B = ~valid[d][L] | grid.block[d][L] | theirs[d][L];
      let run = false;
      for (let s = Math.max(0, pos - 4); s <= pos && !run; s++) run = ((O >>> s) & 31) === 31;
      if (run) {
        five = 1;
        continue;
      }
      const done = fourCells(O, B, pos);
      if (done) {
        fours++;
        if (done & (done - 1)) open = 2;
        continue;
      }
      // an open three: one more stone makes a four with two completing cells
      for (let e = Math.max(0, pos - 4); e <= pos + 4; e++) {
        if ((O | B) >>> e & 1) continue;
        if (popcount(fourCells(O | (1 << e), B, pos)) >= 2) {
          threes++;
          break;
        }
      }
    }
    return five | open | (fours << 2) | (threes << 5);
  }

  // Empty cells (as keys) that lie in a five-window (5 cells in a row, no enemy stone, wall or edge) holding at least
  // `minOwn` and fewer than five stones of `player`. With 4 stones the cell completes a five, with 3 a move there
  // makes a four, with 2 an open three can appear. These are all the cells where a threat of that size can be made.
  function windowCells(grid, player, minOwn) {
    const out = [];
    const { cellAt } = grid.geo;
    const stamp = grid.stamp;
    const gen = ++grid.gen;
    for (let d = 0; d < 4; d++) {
      const own = grid.own[player][d];
      for (let L = 0; L < own.length; L++) {
        const O = own[L];
        if (!O) continue;
        const B = grid.blocked(player, d, L);
        const hi = 31 - Math.clz32(O);
        const lo = 31 - Math.clz32(O & -O);
        for (let s = Math.max(0, lo - 4); s <= hi; s++) {
          if ((B >>> s) & 31) continue;
          const w = (O >>> s) & 31;
          const c = POP5[w];
          if (c < minOwn || c >= 5) continue;
          for (let i = 0; i < 5; i++) {
            if ((w >>> i) & 1) continue;
            const k = cellAt[d][L * 32 + s + i];
            if (stamp[k] !== gen) {
              stamp[k] = gen;
              out.push(k);
            }
          }
        }
      }
    }
    return out;
  }

  // The stone at cell k makes: 'five' | 'four' | 'three' | ''.
  const levelOf = (a) => (a & FIVE ? 'five' : foursOf(a) ? 'four' : threesOf(a) ? 'three' : '');
  // Its winning combination: 'five' | 'open4' (open four) | '4-4' | '4-3' | '3-3' | ''.
  const finishOf = (a) => {
    if (a & FIVE) return 'five';
    if (a & OPEN) return 'open4';
    const f = foursOf(a);
    const t3 = threesOf(a);
    return f >= 2 ? '4-4' : f && t3 ? '4-3' : t3 >= 2 ? '3-3' : '';
  };

  const RANK = { five: 5, open4: 4, '4-4': 4, '4-3': 3, '3-3': 2 };
  const SEVERE = new Set(['five', 'open4', '4-4']);

  // Finish of `player` playing each cell of `cells`: Map key -> finish (only cells with one).
  function gridMap(grid, player, cells) {
    const out = new Map();
    for (const k of cells) {
      grid.set(k, player);
      const f = finishOf(analyzeCell(grid, k));
      grid.clear(k);
      if (f) out.set(k, f);
    }
    return out;
  }

  // Cells where `player` would make a five, open four or double four (only cells in a window that already holds three
  // stones can). `fives` (optional) collects the cells that make a five.
  function severeCells(grid, player, fives) {
    const out = [];
    for (const k of windowCells(grid, player, 3)) {
      grid.set(k, player);
      const f = finishOf(analyzeCell(grid, k));
      grid.clear(k);
      if (!SEVERE.has(f)) continue;
      out.push(k);
      if (f === 'five' && fives) fives.push(k);
    }
    return out;
  }

  // Cells the side to move must choose from to survive the opponent's next move, or null when nothing is urgent
  // (or the side to move can win at once). Covers fives, open fours and double fours; counter-threats are not considered.
  function gridDefences(grid, toMove) {
    const opp = 1 - toMove;
    if (windowCells(grid, toMove, 4).length) return null;
    const fives = [];
    const urgent = severeCells(grid, opp, fives);
    if (fives.length) return fives;
    if (!urgent.length) return null;
    // A block changes what a threat cell makes only if it lies on one of that cell's four lines, within 4 cells.
    const { size, geo } = grid;
    const cand = new Set();
    for (const u of urgent) {
      for (let d = 0; d < 4; d++) {
        const L = geo.lineIdx[d][u];
        const pos = geo.posIdx[d][u];
        for (let e = Math.max(0, pos - 4); e <= pos + 4; e++) {
          const k = geo.cellAt[d][L * 32 + e];
          if (k >= 0 && grid.cell[k] === -1) cand.add(k);
        }
      }
    }
    const out = [];
    for (const c of cand) {
      grid.set(c, toMove);
      let still = false;
      for (const u of urgent) {
        if (u === c) continue;
        grid.set(u, opp);
        still = SEVERE.has(finishOf(analyzeCell(grid, u)));
        grid.clear(u);
        if (still) break;
      }
      grid.clear(c);
      if (!still) out.push(c);
    }
    return out;
  }

  // ---------- victory search (VCF / VCT) ----------

  class Abort extends Error {}

  const cellOf = (grid, k) => [k % grid.size, Math.floor(k / grid.size)];

  // A search context: the grid, the attacker, VCF or VCT, the node budget, and the transposition tables. A position
  // is the same position however it was reached, so each is searched once per depth. There are two tables (attacker to
  // move / defender to move) per level of nested counter-attack, because a nested search is cut off sooner.
  // `prune` switches off the heuristic cut of useless fours (see usefulFour / usefulCounter), for the oracle test.
  function makeCtx(grid, att, mode, budget, prune = true) {
    const tables = () => [0, 1, 2, 3].map(() => new Map());
    return { grid, att, mode, budget, prune, top: 0, counters: 0, cut: false, tt: { attack: tables(), refute: tables() } };
  }

  // Fours are cut only this many attacking moves below the root of an iteration: the first levels stay exhaustive,
  // and iterative deepening makes up for what a cut loses further down.
  const PRUNE_FROM = 2;
  const pruneOn = (ctx, depth) => ctx.prune && ctx.top - depth >= PRUNE_FROM;

  // Rule A. A four that is not a finish is worth playing only if it makes progress: after the stone and the forced
  // block, the attacker has a cell that starts a threat which was not there before (`before`: those cells at the
  // node). Otherwise it only burns a window and delays. `grid` has the four's stone `m` not yet placed.
  function usefulFour(ctx, m, before) {
    const { grid, att, mode } = ctx;
    grid.set(m, att);
    const comp = windowCells(grid, att, 4);
    let ok = true;
    if (comp.length === 1) {
      grid.set(comp[0], 1 - att);
      ok = windowCells(grid, att, mode === 'VCF' ? 3 : 2).some((k) => !before.has(k));
      grid.clear(comp[0]);
    }
    grid.clear(m);
    return ok;
  }

  // Table lookup: undefined on a miss, null when the position is known not to win within `depth`, or the winning line.
  function probe(ctx, kind, key, depth) {
    const e = ctx.tt[kind][ctx.counters].get(key);
    if (!e) return undefined;
    if (e.win && e.need <= depth) return e.win;
    if (e.fail >= depth) return null;
    return undefined;
  }

  function store(ctx, kind, key, depth, line) {
    const table = ctx.tt[kind][ctx.counters];
    let e = table.get(key);
    if (!e) table.set(key, (e = { fail: -1, win: null, need: 0 }));
    if (line) {
      const need = kind === 'attack' ? Math.ceil(line.length / 2) : Math.floor(line.length / 2);
      if (!e.win || need < e.need) {
        e.win = line;
        e.need = need;
      }
    } else if (depth > e.fail) {
      e.fail = depth;
    }
  }

  // The attacker (ctx.att) has just moved and the defender is to move. Returns the winning continuation as a list of
  // cell keys (defender reply, attacker move, ...) ending with the attacker's five, or null when the attacker does not
  // win by force within `depth` more attacking moves. The defender's strongest resistance (the longest reply) is the
  // one kept, so the line is a single principal variation. Search rules:
  //   VCF: the attacker plays only fours, the defender must block the single completing cell.
  //   VCT: also open threes, which the defender may answer with any cell that stops an open four.
  // Counter-attack: in VCT the defender may answer a three with a four of their own (see below).
  function refute(ctx, depth) {
    const key = ctx.grid.hash();
    const hit = probe(ctx, 'refute', key, depth);
    if (hit !== undefined) return hit;
    const line = refuteSearch(ctx, depth);
    store(ctx, 'refute', key, depth, line);
    return line;
  }

  function refuteSearch(ctx, depth) {
    const { grid, att, mode } = ctx;
    const def = 1 - att;
    if (--ctx.budget < 0) throw new Abort();
    if (windowCells(grid, def, 4).length) return null; // the defender completes a five first
    const comp = windowCells(grid, att, 4);
    if (comp.length >= 2) return [comp[0], comp[1]]; // open or double four: block one, the other makes five
    let replies;
    if (comp.length === 1) {
      replies = comp;
    } else {
      if (mode === 'VCF') return null;
      replies = gridDefences(grid, def);
      if (!replies) return null; // no threat at all
    }
    let best = [];
    for (const r of replies) {
      grid.set(r, def);
      let sub;
      try {
        sub = attack(ctx, depth - 1);
      } finally {
        grid.clear(r);
      }
      if (!sub) return null;
      if (sub.length + 1 > best.length) best = [r, ...sub];
    }
    // Counter-attack (VCT only, where the attacker has made a three rather than a four): instead of blocking, the
    // defender may play a four of their own. The attacker must block it, and the defender then moves again with
    // the attacker's threat still standing; a double four or open four by the defender wins for the defender.
    if (mode === 'VCT' && !comp.length && ctx.counters < MAX_COUNTERS) {
      // Rule B. A counter-four that is no finish only helps if its stone lands on a cell the attacker's threats need
      // (a window with three stones, or a defence cell); anywhere else the attacker blocks and wins as before.
      let vital = null;
      const cut = pruneOn(ctx, depth);
      for (const m of windowCells(grid, def, 3)) {
        grid.set(m, def);
        const stops = foursOf(analyzeCell(grid, m)) ? windowCells(grid, def, 4) : [];
        if (!stops.length) {
          grid.clear(m);
          continue;
        }
        if (stops.length >= 2) {
          grid.clear(m);
          return null; // the counter-attack wins outright
        }
        if (cut) {
          grid.clear(m);
          if (!vital) vital = new Set([...windowCells(grid, att, 3), ...replies]);
          if (!vital.has(m)) continue;
          grid.set(m, def);
        }
        const c = stops[0];
        grid.set(c, att);
        ctx.counters++;
        let sub;
        try {
          sub = refute(ctx, depth);
        } finally {
          ctx.counters--;
          grid.clear(c);
          grid.clear(m);
        }
        if (!sub) return null;
        if (sub.length + 2 > best.length) best = [m, c, ...sub];
      }
    }
    return best; // empty when no reply exists: the combination itself wins
  }

  // The attacker is to move: the cell keys of a forcing win (attacker move, defender reply, ..., five), or null.
  function attack(ctx, depth) {
    if (depth <= 0) return attackLeaf(ctx);
    const key = ctx.grid.hash();
    const hit = probe(ctx, 'attack', key, depth);
    if (hit !== undefined) return hit;
    const line = attackSearch(ctx, depth);
    store(ctx, 'attack', key, depth, line);
    return line;
  }

  // Out of attacking moves: only a five or a forced block can still be played. Remembers whether a threat was cut off,
  // so that iterative deepening knows a deeper search might find more.
  function attackLeaf(ctx) {
    const { grid, att, mode } = ctx;
    if (--ctx.budget < 0) throw new Abort();
    const five = windowCells(grid, att, 4);
    if (five.length) return [five[0]];
    const stops = windowCells(grid, 1 - att, 4);
    if (stops.length === 1) {
      grid.set(stops[0], att);
      let sub;
      try {
        sub = refute(ctx, 0);
      } finally {
        grid.clear(stops[0]);
      }
      return sub && [stops[0], ...sub];
    }
    if (!stops.length && windowCells(grid, att, mode === 'VCF' ? 3 : 2).length) ctx.cut = true;
    return null;
  }

  function attackSearch(ctx, depth) {
    const { grid, att, mode } = ctx;
    const def = 1 - att;
    if (--ctx.budget < 0) throw new Abort();
    const five = windowCells(grid, att, 4);
    if (five.length) return [five[0]]; // makes five at once
    // The defender holds a four (a counter-attack or a block that made one): the attacker must block it, then the
    // defender moves again. This costs no attacking move.
    const stops = windowCells(grid, def, 4);
    if (stops.length >= 2) return null;
    if (stops.length === 1) {
      grid.set(stops[0], att);
      let sub;
      try {
        sub = refute(ctx, depth);
      } finally {
        grid.clear(stops[0]);
      }
      return sub && [stops[0], ...sub];
    }
    let moves = windowCells(grid, att, 3);
    let threesToo = false;
    if (mode === 'VCT') {
      // An open three is too slow while the defender threatens an open four of their own.
      threesToo = !severeCells(grid, def).length;
      if (threesToo) moves = windowCells(grid, att, 2);
    }
    // Moves as integers, score in the high bits (cells are below 1024), so ordering allocates no objects.
    const scored = [];
    const cut = pruneOn(ctx, depth);
    let before = null;
    for (const m of moves) {
      grid.set(m, att);
      const an = analyzeCell(grid, m);
      grid.clear(m);
      const f = foursOf(an);
      const t3 = threesOf(an);
      if (!f && !(threesToo && t3)) continue;
      if (cut && f === 1 && !t3 && !(an & (FIVE | OPEN))) {
        if (!before) before = new Set(windowCells(grid, att, mode === 'VCF' ? 3 : 2));
        if (!usefulFour(ctx, m, before)) continue;
      }
      scored.push(((an & OPEN ? 8 : 0) + (f >= 2 ? 6 : 0) + (f && t3 ? 4 : 0) + f * 2 + t3) << 10 | m);
    }
    scored.sort((p, q) => q - p);
    for (const v of scored) {
      const m = v & 1023;
      grid.set(m, att);
      let sub;
      try {
        sub = refute(ctx, depth);
      } finally {
        grid.clear(m);
      }
      if (sub) return [m, ...sub];
    }
    return null;
  }

  // Iterative deepening: try 1, 2, 3... attacking moves, so the first win found is a shortest one (the line shown is
  // the quickest win, not just any win) and quick wins are never lost behind a deep search. The table makes the
  // shallower rounds almost free. Stops early when nothing was cut off by the depth limit: deeper cannot find more.
  function deepen(ctx, attackerToMove) {
    for (let d = 1; d <= DEPTH[ctx.mode]; d++) {
      ctx.cut = false;
      ctx.top = d;
      const keys = attackerToMove ? attack(ctx, d) : refute(ctx, d);
      if (keys) return keys;
      if (!ctx.cut) return null;
    }
    return null;
  }

  const DEPTH = { VCF: 12, VCT: 5 }; // attacking moves searched
  const MAX_COUNTERS = 3; // nested defender counter-fours explored
  const BUDGET = 4000; // search nodes per proof, so a hard position cannot freeze the page

  // Replays `line` (line[0] played by `first`) on a grid of the board, stopping at the first impossible move.
  // Returns the cells played and, per move, the threat it makes and its winning combination.
  function replay(board, line, first) {
    return withGrid(board, (grid) => replayOn(grid, board.size, line, first));
  }

  function replayOn(grid, size, line, first) {
    const out = { cells: [], kinds: [], finishes: [] };
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      if (x < 0 || y < 0 || x >= size || y >= size) break;
      const k = y * size + x;
      if (grid.cell[k] !== -1) break;
      grid.set(k, (first + i) % 2);
      out.cells.push(k);
      const a = analyzeCell(grid, k);
      out.kinds.push(levelOf(a));
      out.finishes.push(finishOf(a));
    }
    return out;
  }

  const COMBOS = new Set(['open4', '4-4', '4-3', '3-3']);

  // Does `line` (line[0] by `first`) play legally to a five by `att`, every four answered on its only completing cell?
  function lineWins(board, line, first, att) {
    return withGrid(board, (grid) => {
      for (let i = 0; i < line.length; i++) {
        const [x, y] = line[i];
        const k = y * board.size + x;
        const p = (first + i) % 2;
        if (grid.cell[k] !== -1) return false;
        grid.set(k, p);
        const a = analyzeCell(grid, k);
        if (a & FIVE) return p === att && i === line.length - 1;
        if (!foursOf(a)) continue;
        const stops = windowCells(grid, p, 4);
        if (stops.length === 1 && (i + 1 >= line.length || line[i + 1][1] * board.size + line[i + 1][0] !== stops[0])) return false;
      }
      return false;
    });
  }

  // Rule C. Drops the four pairs (a four and the block it forces) from the moves of `line` at index `from` on that
  // the win does not need, last pair first. Only the tail after the last three is trimmed: there every move is forced
  // (each four has one answer), so the shorter line is still a forced win.
  function trimLine(board, line, first, att, from) {
    let kinds = replay(board, line, first).kinds;
    if (kinds.length !== line.length) return line;
    from = Math.max(from, kinds.lastIndexOf('three') + 1);
    for (let i = line.length - 3; i >= from; i--) {
      if (kinds[i] !== 'four') continue;
      const shorter = line.slice(0, i).concat(line.slice(i + 2));
      if (!lineWins(board, shorter, first, att)) continue;
      line = shorter;
      kinds = replay(board, line, first).kinds;
    }
    return line;
  }

  // Finds the attack that wins and traces it back from the end of `line` ([[x, y], ...], line[0] played by `first`).
  // The attacker is the side that wins. The solver plays the rest of the win itself (engines stop a PV before the
  // end), so the result is one complete line to victory:
  //   - the line ends with an attacking move: it is kept (a move after it is dropped) and the solver finishes from there;
  //   - the line ends with a defender move: the solver finds the attacker's win from that position.
  // From the final winning move the chain extends backwards over the attacker's earlier moves for as long as each is
  // itself a threat (a four for VCF, a four or open three for VCT): a quiet move starts a new plan. Returns
  //   { kind: 'VCF' | 'VCT', line, start, end, added, kinds, finish }
  // line: the PV plus the solver's moves; start/end: indices of the first / last attacking move of the chain; added: index
  // of the first move that came from the solver (line.length if none); finish: the winning combination of line[end].
  // null when the line holds no victory.
  function chain(board, line, first) {
    const base = replay(board, line, first);
    const n = base.cells.length;
    if (!n) return null;
    let budget = BUDGET;
    // Tries to win from the position after line[from]; `attackerToMove` says who is to move there.
    function attempt(p, from, attackerToMove) {
      const att = (first + p) % 2;
      const done = !attackerToMove && base.kinds[from] === 'five';
      let ext = done ? [] : null;
      let mode = done ? 'VCF' : '';
      if (!done) {
        withGrid(board, (grid) => {
          for (let i = 0; i <= from; i++) grid.set(base.cells[i], (first + i) % 2);
          for (const m of ['VCF', 'VCT']) {
            const ctx = makeCtx(grid, att, m, budget);
            try {
              const keys = deepen(ctx, attackerToMove);
              if (keys) {
                ext = keys.map((k) => cellOf(grid, k));
                mode = m;
              }
            } catch (err) {
              if (!(err instanceof Abort)) throw err;
            }
            budget = Math.max(0, ctx.budget);
            if (mode) break;
          }
        });
        if (!mode) return null;
      }
      const full = trimLine(board, line.slice(0, from + 1).concat(ext), first, att, from + 1);
      const rep = replay(board, full, first);
      if (rep.cells.length !== full.length) return null;
      const end = full.length - 1 - ((((full.length - 1 - p) % 2) + 2) % 2); // last attacking move
      if (end < p || !rep.kinds[end]) return null;
      const allowed = (kd) => kd === 'four' || kd === 'five' || (mode === 'VCT' && kd === 'three');
      let start = end;
      // a forced block of the defender's counter-four is part of the attack even though it makes no threat
      const forced = (j) => j >= 1 && (rep.kinds[j - 1] === 'four' || rep.kinds[j - 1] === 'five');
      while (start - 2 >= p && (allowed(rep.kinds[start - 2]) || forced(start - 2))) start -= 2;
      let onlyFours = true;
      for (let i = start; i <= end; i += 2) if (rep.kinds[i] === 'three') onlyFours = false;
      if ((end - start) / 2 + 1 < 2 && !COMBOS.has(rep.finishes[end])) return null; // a lone five or four is no attack
      return {
        kind: mode === 'VCF' && onlyFours ? 'VCF' : 'VCT',
        line: full,
        start,
        end,
        added: from + 1,
        kinds: rep.kinds,
        finish: rep.finishes[end],
      };
    }
    for (const p of [0, 1]) { // the side that moves first in the line, then the other one
      const last = n - 1 - ((((n - 1 - p) % 2) + 2) % 2); // last attacking move, or below p when there is none
      const tries = [];
      if (last < n - 1) tries.push([n - 1, true]); // the line ends with a defender move: the attacker moves next
      for (let e = last; e >= p && e >= last - 2; e -= 2) if (base.kinds[e]) tries.push([e, false]);
      for (const [from, attackerToMove] of tries) {
        const c = attempt(p, from, attackerToMove);
        if (c) return c;
      }
    }
    return null;
  }

  // ---------- public API: boards are { size, walls: Set of keys, stones: Map key -> player } ----------

  // For the stone already in `stones` at (x, y).
  const analyze = (board, x, y) => withGrid(board, (grid) => analyzeCell(grid, y * board.size + x));

  // Wins by force: shortest winning line [[x, y], ...] for `att`, or null. mode 'VCF' | 'VCT'; attackerToMove says who
  // moves next.
  function solve(board, att, mode, attackerToMove, budget = BUDGET, prune = true) {
    const line = withGrid(board, (grid) => {
      const ctx = makeCtx(grid, att, mode, budget, prune);
      try {
        const keys = deepen(ctx, attackerToMove);
        return keys && keys.map((k) => cellOf(grid, k));
      } catch (e) {
        if (e instanceof Abort) return null;
        throw e;
      }
    });
    return line && prune ? trimLine(board, line, attackerToMove ? att : 1 - att, att, 0) : line;
  }

  G.explain = {
    classify: (board, x, y) => levelOf(analyze(board, x, y)),
    finish: (board, x, y) => finishOf(analyze(board, x, y)),
    // Finish of `player` playing each empty cell where a threat can start: Map key -> finish (only cells with one).
    map: (board, player, cells) => withGrid(board, (grid) => gridMap(grid, player, cells || windowCells(grid, player, 2))),
    defences: (board, toMove) => withGrid(board, (grid) => gridDefences(grid, toMove)),
    solve,
    chain,
    // Per move of `line` (line[0] by `first`): the threat it makes ('', 'three', 'four', 'five') and its finish.
    describe(board, line, first) {
      const r = replay(board, line, first);
      return { count: r.cells.length, kinds: r.kinds, finishes: r.finishes };
    },
    RANK,
  };
})(window.Gomoku = window.Gomoku || {});
