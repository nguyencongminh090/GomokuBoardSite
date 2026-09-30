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

  // Follows `line` ([[x, y], ...], first move by `first`) from `board` and returns the attack chain:
  //   { kind: 'VCF' | 'VCT', moves: n, kinds: [...], finish: winning combination of the last attack move } covering the leading moves of the line in which
  //   every move of the attacker (line[0]'s player) is a five, four or three, or null when there is none.
  // kinds[i] is the threat made by line[i] (''/'five'/'four'/'three'); defender moves are the forced replies.
  // A chain needs at least 2 attacking moves, otherwise it is just a single threat, not a continuous attack.
  function chain(board, line, first) {
    const stones = new Map(board.stones);
    const b = { size: board.size, walls: board.walls, stones };
    const kinds = [];
    const finishes = [];
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      if (x < 0 || stones.has(y * board.size + x)) break;
      stones.set(y * board.size + x, (first + i) % 2);
      const a = analyze(b, x, y);
      kinds.push(a.five ? 'five' : a.fours ? 'four' : a.threes ? 'three' : '');
      finishes.push(a.five ? 'five' : a.open ? 'open4' : a.fours >= 2 ? '4-4' : a.fours && a.threes ? '4-3' : a.threes >= 2 ? '3-3' : '');
    }
    let moves = 0;
    let attacks = 0;
    let onlyFours = true;
    for (let i = 0; i < kinds.length; i += 2) {
      if (!kinds[i]) break;
      if (kinds[i] === 'three') onlyFours = false;
      attacks++;
      moves = i + 1;
      if (kinds[i] === 'five') break;
    }
    if (attacks < 2) return null;
    return { kind: onlyFours ? 'VCF' : 'VCT', moves, kinds: kinds.slice(0, moves), finish: finishes[moves - 1] };
  }

  G.threats = { classify, finish, map, defences, chain, RANK };
})(window.Gomoku = window.Gomoku || {});
