// Threat analysis of an engine line: finds the continuous attack (VCF = only fours, VCT = fours and open threes).
// Pure model code (no DOM). Freestyle gomoku: five or more in a row wins; walls, edges and enemy stones block.
(function (G) {
  'use strict';

  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const REACH = 5; // cells looked at on each side of the new stone
  const OWN = 1;
  const EMPTY = 0;
  const BLOCK = 2;
  const CENTRE = REACH;

  // Does a run of 5+ own cells contain index `at`?
  function makesFive(cells, at) {
    let a = at;
    let b = at;
    while (a > 0 && cells[a - 1] === OWN) a--;
    while (b < cells.length - 1 && cells[b + 1] === OWN) b++;
    return b - a + 1 >= 5;
  }

  // Empty cells of the line where an own stone makes a five through the centre stone.
  function completions(cells) {
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY) continue;
      cells[i] = OWN;
      if (makesFive(cells, i) && makesFive(cells, CENTRE)) out.push(i);
      cells[i] = EMPTY;
    }
    return out;
  }

  // What the stone just placed at (x, y) makes in each direction: { five, fours, open, threes }.
  //   fours: directions holding a four; open: some four has two completing cells; threes: directions holding an open three.
  // board: { size, walls: Set of keys, stones: Map key -> player }; the stone must already be in `stones`.
  function analyze(board, x, y) {
    const { size, walls, stones } = board;
    const me = stones.get(y * size + x);
    const out = { five: false, fours: 0, open: false, threes: 0 };
    for (const [dx, dy] of DIRS) {
      const cells = [];
      for (let i = -REACH; i <= REACH; i++) {
        const cx = x + dx * i;
        const cy = y + dy * i;
        if (cx < 0 || cy < 0 || cx >= size || cy >= size || walls.has(cy * size + cx)) {
          cells.push(BLOCK);
          continue;
        }
        const s = stones.get(cy * size + cx);
        cells.push(s === undefined ? EMPTY : s === me ? OWN : BLOCK);
      }
      if (makesFive(cells, CENTRE)) {
        out.five = true;
        continue;
      }
      const done = completions(cells);
      if (done.length) {
        out.fours++;
        if (done.length >= 2) out.open = true;
        continue;
      }
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== EMPTY) continue;
        cells[i] = OWN;
        const open = completions(cells).length >= 2; // the three can become an open four
        cells[i] = EMPTY;
        if (open) {
          out.threes++;
          break;
        }
      }
    }
    return out;
  }

  // 'five' | 'four' | 'three' | '' : the strongest single threat of the stone at (x, y).
  function classify(board, x, y) {
    const a = analyze(board, x, y);
    return a.five ? 'five' : a.fours ? 'four' : a.threes ? 'three' : '';
  }

  // The move's winning combination: 'five' | 'open4' (open four) | '4-4' | '4-3' | '3-3' | ''.
  function finish(board, x, y) {
    const a = analyze(board, x, y);
    if (a.five) return 'five';
    if (a.open) return 'open4';
    if (a.fours >= 2) return '4-4';
    if (a.fours && a.threes) return '4-3';
    return a.threes >= 2 ? '3-3' : '';
  }

  const RANK = { five: 5, open4: 4, '4-4': 4, '4-3': 3, '3-3': 2 };
  const SEVERE = new Set(['five', 'open4', '4-4']);

  // Empty cells within reach of a stone of `player`: the only places a new threat of theirs can appear.
  function nearby(board, player) {
    const { size, walls, stones } = board;
    const out = new Set();
    for (const [k, p] of stones) {
      if (p !== player) continue;
      const sx = k % size;
      const sy = (k - sx) / size;
      for (let y = Math.max(0, sy - 4); y <= Math.min(size - 1, sy + 4); y++) {
        for (let x = Math.max(0, sx - 4); x <= Math.min(size - 1, sx + 4); x++) {
          const c = y * size + x;
          if (!stones.has(c) && !walls.has(c)) out.add(c);
        }
      }
    }
    return out;
  }

  // Finish of `player` playing each empty cell near their stones: Map key -> finish (only cells with one).
  function map(board, player, cells) {
    const { size, stones } = board;
    const out = new Map();
    for (const k of cells || nearby(board, player)) {
      stones.set(k, player);
      const f = finish(board, k % size, Math.floor(k / size));
      stones.delete(k);
      if (f) out.set(k, f);
    }
    return out;
  }

  // Cells the side to move must choose from to survive the opponent's next move, or null when nothing is urgent
  // (or the side to move can win at once). Covers fives, open fours and double fours; counter-threats are not considered.
  function defences(board, toMove) {
    const { size, stones } = board;
    const mine = map(board, toMove);
    for (const f of mine.values()) if (f === 'five') return null;
    const theirs = map(board, 1 - toMove);
    const urgent = [...theirs].filter(([, f]) => SEVERE.has(f)).map(([k]) => k);
    if (!urgent.length) return null;
    const fives = urgent.filter((k) => theirs.get(k) === 'five');
    if (fives.length) return fives;
    const out = [];
    const cand = new Set();
    for (const u of urgent) {
      const ux = u % size;
      const uy = Math.floor(u / size);
      for (let y = Math.max(0, uy - 5); y <= Math.min(size - 1, uy + 5); y++) {
        for (let x = Math.max(0, ux - 5); x <= Math.min(size - 1, ux + 5); x++) {
          const k = y * size + x;
          if (!stones.has(k) && !board.walls.has(k)) cand.add(k);
        }
      }
    }
    for (const c of cand) {
      stones.set(c, toMove);
      const still = urgent.some((u) => {
        if (u === c) return false;
        stones.set(u, 1 - toMove);
        const f = finish(board, u % size, Math.floor(u / size));
        stones.delete(u);
        return SEVERE.has(f);
      });
      stones.delete(c);
      if (!still) out.push(c);
    }
    return out;
  }

  // ---------- victory search (VCF / VCT) ----------

  // Empty cells lying in a five-window (5 cells in a row, no enemy stone, wall or edge) that already holds at least
  // `minOwn` stones of `player` (and fewer than five). With 4 stones the cell completes a five, with 3 a move there
  // makes a four. Much cheaper than classifying every cell, and it finds every cell that can make a four or five.
  function windowCells(board, player, minOwn) {
    const { size, walls, stones } = board;
    const out = new Set();
    for (const [k, p] of stones) {
      if (p !== player) continue;
      const sx = k % size;
      const sy = (k - sx) / size;
      for (const [dx, dy] of DIRS) {
        for (let o = -4; o <= 0; o++) {
          let own = 0;
          let ok = true;
          const empties = [];
          for (let i = 0; i < 5 && ok; i++) {
            const x = sx + dx * (o + i);
            const y = sy + dy * (o + i);
            const c = y * size + x;
            if (x < 0 || y < 0 || x >= size || y >= size || walls.has(c)) ok = false;
            else if (!stones.has(c)) empties.push(c);
            else if (stones.get(c) === player) own++;
            else ok = false;
          }
          if (ok && own >= minOwn && own < 5) for (const c of empties) out.add(c);
        }
      }
    }
    return out;
  }

  class Abort extends Error {}

  // Does the player who just moved (att) win by force? The defender is to move. mode 'VCF': the attacker plays only
  // fours (the defender must block the single completing cell); 'VCT': fours and open threes (the defender may
  // answer a three with any cell that stops an open four). Counter-threats of the defender other than an
  // immediate five are not modelled, so a VCT found here is optimistic about defender counter-fours.
  function refute(ctx, depth) {
    const { board, att, mode } = ctx;
    const def = 1 - att;
    if (--ctx.budget < 0) throw new Abort();
    if (windowCells(board, def, 4).size) return false; // the defender completes a five first
    const comp = windowCells(board, att, 4);
    if (comp.size >= 2) return true; // two ways to make five: open four or double four
    let replies;
    if (comp.size === 1) {
      replies = [...comp];
    } else {
      if (mode === 'VCF') return false;
      replies = defences(board, def);
      if (!replies) return false; // no threat at all
    }
    for (const r of replies) {
      board.stones.set(r, def);
      let won;
      try {
        won = attack(ctx, depth - 1);
      } finally {
        board.stones.delete(r);
      }
      if (!won) return false;
    }
    return true;
  }

  // The attacker (ctx.att) is to move: is there a forcing move that wins?
  function attack(ctx, depth) {
    const { board, att, mode } = ctx;
    const def = 1 - att;
    if (--ctx.budget < 0) throw new Abort();
    if (windowCells(board, att, 4).size) return true; // makes five at once
    if (depth <= 0 || windowCells(board, def, 4).size) return false; // out of depth, or must block a four first
    const fours = windowCells(board, att, 3);
    let moves = [...fours];
    let threesToo = false;
    if (mode === 'VCT') {
      // An open three is too slow while the defender threatens an open four of their own.
      const urgent = [...map(board, def)].some(([, f]) => SEVERE.has(f));
      threesToo = !urgent;
      if (threesToo) moves = [...windowCells(board, att, 2)];
    }
    const scored = [];
    for (const m of moves) {
      board.stones.set(m, att);
      const an = analyze(board, m % board.size, Math.floor(m / board.size));
      board.stones.delete(m);
      if (!an.fours && !(threesToo && an.threes)) continue;
      scored.push({ m, score: (an.open ? 8 : 0) + (an.fours >= 2 ? 6 : 0) + (an.fours && an.threes ? 4 : 0) + an.fours * 2 + an.threes });
    }
    scored.sort((p, q) => q.score - p.score);
    for (const { m } of scored) {
      board.stones.set(m, att);
      let won;
      try {
        won = refute(ctx, depth);
      } finally {
        board.stones.delete(m);
      }
      if (won) return true;
    }
    return false;
  }

  const DEPTH = { VCF: 12, VCT: 5 }; // attacking moves searched
  const BUDGET = 4000; // search nodes per proof, so a hard position cannot freeze the page

  // Does `att`, who has just played the last stone on `board`, win by force with `mode` ('VCF' | 'VCT')?
  // Returns false when the search ran out of budget.
  function proves(board, att, mode, budget = BUDGET) {
    const ctx = { board, att, mode, budget };
    try {
      return refute(ctx, DEPTH[mode]);
    } catch (e) {
      if (e instanceof Abort) return false;
      throw e;
    }
  }

  // Finds the attack that wins and traces it back from the end of `line` ([[x, y], ...], line[0] played by `first`).
  // The attacker is the side that wins: the last attacking move must lead to a forced victory (five, open four,
  // 4-4, or a VCF / VCT that the search proves from there). From that move the chain extends backwards over the
  // attacker's earlier moves for as long as each one is itself a threat (a four for VCF, a four or open three for
  // VCT), because a quiet move starts a new plan. Returns
  //   { kind: 'VCF' | 'VCT', start, end, kinds, finish }   start/end: line indices of the first / last attacking move
  // or null. kinds[i] is the threat made by line[i]; finish is the winning combination of line[end].
  function chain(board, line, first) {
    const size = board.size;
    const stones = new Map(board.stones);
    const b = { size, walls: board.walls, stones };
    const kinds = [];
    const finishes = [];
    const cells = [];
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      const k = y * size + x;
      if (x < 0 || stones.has(k) || board.walls.has(k)) break;
      stones.set(k, (first + i) % 2);
      cells.push(k);
      const a = analyze(b, x, y);
      kinds.push(a.five ? 'five' : a.fours ? 'four' : a.threes ? 'three' : '');
      finishes.push(a.five ? 'five' : a.open ? 'open4' : a.fours >= 2 ? '4-4' : a.fours && a.threes ? '4-3' : a.threes >= 2 ? '3-3' : '');
    }
    const n = cells.length;
    let budget = BUDGET;
    for (const p of [0, 1]) { // the side that moves first in the line, then the other one
      const att = (first + p) % 2;
      let e = n - 1 - ((((n - 1 - p) % 2) + 2) % 2); // last move of the attacker
      for (let tries = 0; tries < 2 && e >= p; tries++, e -= 2) {
        if (!kinds[e]) continue; // a quiet move cannot be the end of a continuous attack
        // the board as it was right after line[e]
        b.stones = new Map(board.stones);
        for (let i = 0; i <= e; i++) b.stones.set(cells[i], (first + i) % 2);
        let mode = kinds[e] === 'five' ? 'VCF' : '';
        for (const m of mode ? [] : ['VCF', 'VCT']) {
          const ctx = { board: b, att, mode: m, budget };
          try {
            if (refute(ctx, DEPTH[m])) mode = m;
          } catch (err) {
            if (!(err instanceof Abort)) throw err;
          }
          budget = Math.max(0, ctx.budget);
          if (mode) break;
        }
        if (!mode) continue;
        let start = e;
        let onlyFours = kinds[e] === 'four' || kinds[e] === 'five';
        while (start - 2 >= p && kinds[start - 2]) {
          if (kinds[start - 2] === 'three') onlyFours = false;
          start -= 2;
        }
        // trace back only through threats the mode allows: a VCF chain stops at an open three
        if (mode === 'VCF' && !onlyFours) {
          start = e;
          while (start - 2 >= p && (kinds[start - 2] === 'four' || kinds[start - 2] === 'five')) start -= 2;
          onlyFours = true;
        }
        const count = (e - start) / 2 + 1;
        if (count < 2 && !['open4', '4-4', '4-3', '3-3'].includes(finishes[e])) continue; // a lone five or four is no attack
        return { kind: mode === 'VCF' && onlyFours ? 'VCF' : 'VCT', start, end: e, kinds: kinds.slice(0, e + 1), finish: finishes[e] };
      }
    }
    return null;
  }

  G.threats = { classify, finish, map, defences, proves, chain, RANK };
})(window.Gomoku = window.Gomoku || {});
