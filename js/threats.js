// Threat analysis for engine lines: classifies moves (five, four, open three, 4-3, 3-3...), maps threats and forced
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

  const gridCache = new Map(); // size -> geometry shared by every Grid of that size

  // Per-size geometry: the cell of every (direction, line, bit) and the valid-bit mask of every line.
  function geometry(size) {
    let g = gridCache.get(size);
    if (g) return g;
    const lines = [size, size, 2 * size - 1, 2 * size - 1];
    const valid = lines.map((c) => new Int32Array(c));
    const cellAt = lines.map((c) => new Int16Array(c * 32).fill(-1));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (let d = 0; d < 4; d++) {
          const L = lineOf[d](x, y, size);
          const p = posOf[d](x, y);
          valid[d][L] |= 1 << p;
          cellAt[d][L * 32 + p] = y * size + x;
        }
      }
    }
    g = { size, lines, valid, cellAt };
    gridCache.set(size, g);
    return g;
  }

  class Grid {
    // board: { size, walls: Set of keys, stones: Map key -> player }
    constructor(board) {
      const size = board.size;
      this.size = size;
      this.geo = geometry(size);
      const lines = this.geo.lines;
      this.own = [0, 1].map(() => lines.map((c) => new Int32Array(c)));
      this.block = lines.map((c) => new Int32Array(c)); // walls
      this.cell = new Int8Array(size * size).fill(-1); // -1 empty, 0 / 1 stone of that player, 2 wall
      this.stamp = new Int32Array(size * size);
      this.gen = 0;
      for (const k of board.walls) this.set(k, 2);
      for (const [k, p] of board.stones) this.set(k, p);
    }

    set(k, p) {
      const size = this.size;
      const x = k % size;
      const y = (k - x) / size;
      this.cell[k] = p;
      for (let d = 0; d < 4; d++) {
        const L = lineOf[d](x, y, size);
        const bit = 1 << posOf[d](x, y);
        if (p === 2) this.block[d][L] |= bit;
        else this.own[p][d][L] |= bit;
      }
    }

    clear(k) {
      const size = this.size;
      const x = k % size;
      const y = (k - x) / size;
      const p = this.cell[k];
      this.cell[k] = -1;
      for (let d = 0; d < 4; d++) {
        const L = lineOf[d](x, y, size);
        const bit = ~(1 << posOf[d](x, y));
        if (p === 2) this.block[d][L] &= bit;
        else this.own[p][d][L] &= bit;
      }
    }

    // Bits of line (d, L) that player p cannot use: off the board, walls and enemy stones.
    blocked(p, d, L) {
      return ~this.geo.valid[d][L] | this.block[d][L] | this.own[1 - p][d][L];
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

  // What the stone of player p at cell k makes in each direction: { five, fours, open, threes }.
  //   fours: directions holding a four; open: some four has two completing cells; threes: directions holding an open three.
  function analyzeCell(grid, k) {
    const size = grid.size;
    const p = grid.cell[k];
    const x = k % size;
    const y = (k - x) / size;
    const out = { five: false, fours: 0, open: false, threes: 0 };
    for (let d = 0; d < 4; d++) {
      const L = lineOf[d](x, y, size);
      const pos = posOf[d](x, y);
      const O = grid.own[p][d][L];
      const B = grid.blocked(p, d, L);
      let five = false;
      for (let s = Math.max(0, pos - 4); s <= pos && !five; s++) five = ((O >>> s) & 31) === 31;
      if (five) {
        out.five = true;
        continue;
      }
      const done = fourCells(O, B, pos);
      if (done) {
        out.fours++;
        if (done & (done - 1)) out.open = true;
        continue;
      }
      // an open three: one more stone makes a four with two completing cells
      for (let e = Math.max(0, pos - 4); e <= pos + 4; e++) {
        if ((O | B) >>> e & 1) continue;
        if (popcount(fourCells(O | (1 << e), B, pos)) >= 2) {
          out.threes++;
          break;
        }
      }
    }
    return out;
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
  const levelOf = (a) => (a.five ? 'five' : a.fours ? 'four' : a.threes ? 'three' : '');
  // Its winning combination: 'five' | 'open4' (open four) | '4-4' | '4-3' | '3-3' | ''.
  const finishOf = (a) => (a.five ? 'five' : a.open ? 'open4' : a.fours >= 2 ? '4-4' : a.fours && a.threes ? '4-3' : a.threes >= 2 ? '3-3' : '');

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

  // Cells the side to move must choose from to survive the opponent's next move, or null when nothing is urgent
  // (or the side to move can win at once). Covers fives, open fours and double fours; counter-threats are not considered.
  function gridDefences(grid, toMove) {
    const opp = 1 - toMove;
    if (windowCells(grid, toMove, 4).length) return null;
    // a severe combination needs a five-window that already holds three stones, so only those cells are classified
    const theirs = gridMap(grid, opp, windowCells(grid, opp, 3));
    const urgent = [];
    const fives = [];
    for (const [k, f] of theirs) {
      if (f === 'five') fives.push(k);
      if (SEVERE.has(f)) urgent.push(k);
    }
    if (fives.length) return fives;
    if (!urgent.length) return null;
    const size = grid.size;
    const cand = new Set();
    for (const u of urgent) {
      const ux = u % size;
      const uy = (u - ux) / size;
      for (let y = Math.max(0, uy - 5); y <= Math.min(size - 1, uy + 5); y++) {
        for (let x = Math.max(0, ux - 5); x <= Math.min(size - 1, ux + 5); x++) {
          const k = y * size + x;
          if (grid.cell[k] === -1) cand.add(k);
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

  // The attacker (ctx.att) has just moved and the defender is to move. Returns the winning continuation as a list of
  // cell keys (defender reply, attacker move, ...) ending with the attacker's five, or null when the attacker does not
  // win by force. The defender's strongest resistance (the longest reply) is the one kept, so the line is a single
  // principal variation. Search rules:
  //   VCF: the attacker plays only fours, the defender must block the single completing cell.
  //   VCT: also open threes, which the defender may answer with any cell that stops an open four.
  // Counter-threats of the defender other than an immediate five are not modelled, so a VCT is optimistic about them.
  function refute(ctx, depth) {
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
    return best; // empty when no reply exists: the combination itself wins
  }

  // The attacker is to move: the cell keys of a forcing win (attacker move, defender reply, ..., five), or null.
  function attack(ctx, depth) {
    const { grid, att, mode } = ctx;
    const def = 1 - att;
    if (--ctx.budget < 0) throw new Abort();
    const five = windowCells(grid, att, 4);
    if (five.length) return [five[0]]; // makes five at once
    if (depth <= 0 || windowCells(grid, def, 4).length) return null; // out of depth, or must block a four first
    let moves = windowCells(grid, att, 3);
    let threesToo = false;
    if (mode === 'VCT') {
      // An open three is too slow while the defender threatens an open four of their own.
      let urgent = false;
      for (const f of gridMap(grid, def, windowCells(grid, def, 3)).values()) urgent = urgent || SEVERE.has(f);
      threesToo = !urgent;
      if (threesToo) moves = windowCells(grid, att, 2);
    }
    const scored = [];
    for (const m of moves) {
      grid.set(m, att);
      const an = analyzeCell(grid, m);
      grid.clear(m);
      if (!an.fours && !(threesToo && an.threes)) continue;
      scored.push({ m, score: (an.open ? 8 : 0) + (an.fours >= 2 ? 6 : 0) + (an.fours && an.threes ? 4 : 0) + an.fours * 2 + an.threes });
    }
    scored.sort((p, q) => q.score - p.score);
    for (const { m } of scored) {
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

  const DEPTH = { VCF: 12, VCT: 5 }; // attacking moves searched
  const BUDGET = 4000; // search nodes per proof, so a hard position cannot freeze the page

  // Replays `line` (line[0] played by `first`) on a grid of the board, stopping at the first impossible move.
  // Returns the cells played and, per move, the threat it makes and its winning combination.
  function replay(board, line, first) {
    const grid = new Grid(board);
    const out = { cells: [], kinds: [], finishes: [] };
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      if (x < 0 || y < 0 || x >= board.size || y >= board.size) break;
      const k = y * board.size + x;
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
        const grid = new Grid(board);
        for (let i = 0; i <= from; i++) grid.set(base.cells[i], (first + i) % 2);
        for (const m of ['VCF', 'VCT']) {
          const ctx = { grid, att, mode: m, budget };
          try {
            const keys = attackerToMove ? attack(ctx, DEPTH[m]) : refute(ctx, DEPTH[m]);
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
        if (!mode) return null;
      }
      const full = line.slice(0, from + 1).concat(ext);
      const rep = replay(board, full, first);
      if (rep.cells.length !== full.length) return null;
      const end = full.length - 1 - ((((full.length - 1 - p) % 2) + 2) % 2); // last attacking move
      if (end < p || !rep.kinds[end]) return null;
      const allowed = (kd) => kd === 'four' || kd === 'five' || (mode === 'VCT' && kd === 'three');
      let start = end;
      while (start - 2 >= p && allowed(rep.kinds[start - 2])) start -= 2;
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
  const analyze = (board, x, y) => analyzeCell(new Grid(board), y * board.size + x);

  // Wins by force: winning line [[x, y], ...] for `att`, or null. mode 'VCF' | 'VCT'; attackerToMove says who moves next.
  function solve(board, att, mode, attackerToMove, budget = BUDGET) {
    const grid = new Grid(board);
    const ctx = { grid, att, mode, budget };
    try {
      const keys = attackerToMove ? attack(ctx, DEPTH[mode]) : refute(ctx, DEPTH[mode]);
      return keys && keys.map((k) => cellOf(grid, k));
    } catch (e) {
      if (e instanceof Abort) return null;
      throw e;
    }
  }

  G.threats = {
    classify: (board, x, y) => levelOf(analyze(board, x, y)),
    finish: (board, x, y) => finishOf(analyze(board, x, y)),
    // Finish of `player` playing each empty cell where a threat can start: Map key -> finish (only cells with one).
    map(board, player, cells) {
      const grid = new Grid(board);
      return gridMap(grid, player, cells || windowCells(grid, player, 2));
    },
    defences: (board, toMove) => gridDefences(new Grid(board), toMove),
    solve,
    chain,
    RANK,
  };
})(window.Gomoku = window.Gomoku || {});
