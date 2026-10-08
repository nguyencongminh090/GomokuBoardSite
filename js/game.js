// Game model: board size, walls, portal pairs and a variation tree of moves.
//
// Nodes live in a flat array; node 0 is the empty-board root. A node's parent always has a
// smaller index, so the array can be serialised as [parent, x, y] triples and rebuilt in order.
// Each node remembers its preferred child (`pref`), which Forward follows.
(function (G) {
  'use strict';

  const MIN_SIZE = 5;
  const MAX_SIZE = 26;
  const MIN_PORTAL_DISTANCE = 3; // Chebyshev distance between any two portal cells (the engine's rule)

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  class Game {
    constructor(data) {
      const size = Number(data.size);
      if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
        throw new Error('Invalid board size');
      }
      this.size = size;
      this.id = typeof data.id === 'string' && data.id ? data.id : newId();
      this.name = typeof data.name === 'string' ? data.name.slice(0, 80) : '';
      // Optional names of the two players (first player, second player), shown beside the board in Live view.
      const names = Array.isArray(data.players) ? data.players : [];
      this.players = [0, 1].map((i) => (typeof names[i] === 'string' ? names[i].trim().slice(0, Game.MAX_PLAYER_NAME) : ''));
      // Optional name of the group the game is filed under in the Games tab ('' = none).
      this.group = typeof data.group === 'string' ? data.group.trim().slice(0, Game.MAX_GROUP_NAME) : '';
      this.createdAt = Number(data.createdAt) || Date.now();
      this.updatedAt = Number(data.updatedAt) || this.createdAt;

      // Torus: the board has no edges, the last column is next to the first and the last row next to the first.
      // Set before the portals, because portal distances are measured the short way round on a torus.
      this.torus = data.torus === true;

      this.walls = new Set();
      for (const w of Array.isArray(data.walls) ? data.walls : []) {
        if (Array.isArray(w) && this.inBounds(w[0], w[1])) this.walls.add(this.key(w[0], w[1]));
      }

      // Portal pairs as [keyA, keyB]. A line entering one cell leaves from the other in the same direction.
      this.portals = [];
      for (const p of Array.isArray(data.portals) ? data.portals : []) {
        if (!Array.isArray(p) || p.length < 4 || !this.inBounds(p[0], p[1]) || !this.inBounds(p[2], p[3])) continue;
        const a = this.key(p[0], p[1]);
        const b = this.key(p[2], p[3]);
        if (!this.walls.has(a) && !this.walls.has(b) && this.portalFits(a, b)) this.portals.push([a, b]);
      }

      this.nodes = [{ parent: -1, x: -1, y: -1, depth: 0, children: [], pref: -1 }];
      for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
        const [p, x, y] = Array.isArray(n) ? n : [];
        if (!Number.isInteger(p) || p < 0 || p >= this.nodes.length || !this.inBounds(x, y)) {
          throw new Error('Corrupt move tree');
        }
        this.addNode(p, x, y);
      }
      const prefs = Array.isArray(data.prefs) ? data.prefs : [];
      this.nodes.forEach((node, i) => {
        if (node.children.includes(prefs[i])) node.pref = prefs[i];
      });

      const cur = data.cur;
      this.cur = Number.isInteger(cur) && cur >= 0 && cur < this.nodes.length ? cur : 0;
    }

    static create(size, name) {
      return new Game({ size, name });
    }

    toJSON() {
      const s = this.size;
      return {
        id: this.id,
        name: this.name,
        size: s,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
        ...(this.torus ? { torus: true } : {}),
        ...(this.players.some(Boolean) ? { players: [...this.players] } : {}),
        ...(this.group ? { group: this.group } : {}),
        walls: [...this.walls].map((k) => [k % s, Math.floor(k / s)]),
        portals: this.portals.map(([a, b]) => [a % s, Math.floor(a / s), b % s, Math.floor(b / s)]),
        nodes: this.nodes.slice(1).map((n) => [n.parent, n.x, n.y]),
        prefs: this.nodes.map((n) => n.pref),
        cur: this.cur,
      };
    }

    key(x, y) {
      return y * this.size + x;
    }

    inBounds(x, y) {
      return Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && y >= 0 && x < this.size && y < this.size;
    }

    touch() {
      this.updatedAt = Date.now();
    }

    isEmpty() {
      return this.nodes.length === 1 && this.walls.size === 0 && this.portals.length === 0 && !this.torus;
    }

    addNode(parent, x, y) {
      const id = this.nodes.length;
      const p = this.nodes[parent];
      this.nodes.push({ parent, x, y, depth: p.depth + 1, children: [], pref: -1 });
      p.children.push(id);
      if (p.pref === -1) p.pref = id;
      return id;
    }

    // 0 = first player (cross / black), 1 = second player.
    player(id) {
      return (this.nodes[id].depth - 1) % 2;
    }

    toMove() {
      return this.nodes[this.cur].depth % 2;
    }

    // Node ids from the first move down to `id` (root excluded).
    path(id) {
      const out = [];
      for (let i = id; i > 0; i = this.nodes[i].parent) out.push(i);
      return out.reverse();
    }

    // Node ids of the current line: path to the cursor, then preferred children to the end.
    line() {
      const ids = this.path(this.cur);
      for (let id = this.cur; this.nodes[id].children.length;) {
        id = this.nextOf(id);
        ids.push(id);
      }
      return ids;
    }

    nextOf(id) {
      const n = this.nodes[id];
      return n.pref >= 0 ? n.pref : n.children[0];
    }

    // Map of cell key -> node id for the position at the cursor.
    position() {
      const pos = new Map();
      for (const id of this.path(this.cur)) {
        const n = this.nodes[id];
        pos.set(this.key(n.x, n.y), id);
      }
      return pos;
    }

    canPlay(x, y) {
      if (!this.inBounds(x, y)) return false;
      const k = this.key(x, y);
      return !this.walls.has(k) && !this.isPortal(k) && !this.position().has(k);
    }

    // Plays at (x, y). Re-uses an existing branch with the same move instead of duplicating it.
    play(x, y) {
      if (!this.canPlay(x, y)) return false;
      const cur = this.nodes[this.cur];
      let child = cur.children.find((c) => this.nodes[c].x === x && this.nodes[c].y === y);
      if (child === undefined) {
        child = this.addNode(this.cur, x, y);
        this.touch();
      }
      cur.pref = child;
      this.cur = child;
      return true;
    }

    back() {
      if (this.cur === 0) return false;
      this.cur = this.nodes[this.cur].parent;
      return true;
    }

    forward() {
      if (!this.nodes[this.cur].children.length) return false;
      this.cur = this.nextOf(this.cur);
      return true;
    }

    toStart() {
      const moved = this.cur !== 0;
      this.cur = 0;
      return moved;
    }

    toEnd() {
      let moved = false;
      while (this.forward()) moved = true;
      return moved;
    }

    // Jumps to a node and makes its line the preferred one, so Forward retraces it.
    goTo(id) {
      if (!Number.isInteger(id) || id < 0 || id >= this.nodes.length) return false;
      for (const i of this.path(id)) this.nodes[this.nodes[i].parent].pref = i;
      const moved = this.cur !== id;
      this.cur = id;
      return moved;
    }

    // Switches to the previous (-1) or next (+1) alternative of the current move.
    sibling(delta) {
      if (this.cur === 0) return false;
      const sibs = this.nodes[this.nodes[this.cur].parent].children;
      const j = sibs.indexOf(this.cur) + delta;
      if (j < 0 || j >= sibs.length) return false;
      return this.goTo(sibs[j]);
    }

    // Removes a node and everything after it; the cursor moves to its parent if it was inside.
    removeSubtree(id) {
      if (!Number.isInteger(id) || id <= 0 || id >= this.nodes.length) return false;
      const old = this.nodes;
      const drop = new Set([id]);
      for (let i = id + 1; i < old.length; i++) if (drop.has(old[i].parent)) drop.add(i);

      const keepCur = drop.has(this.cur) ? old[id].parent : this.cur;
      const map = new Map([[0, 0]]);
      this.nodes = [{ parent: -1, x: -1, y: -1, depth: 0, children: [], pref: -1 }];
      for (let i = 1; i < old.length; i++) {
        if (!drop.has(i)) map.set(i, this.addNode(map.get(old[i].parent), old[i].x, old[i].y));
      }
      for (const [o, n] of map) {
        const p = old[o].pref;
        if (map.has(p)) this.nodes[n].pref = map.get(p);
      }
      this.cur = map.get(keepCur);
      this.touch();
      return true;
    }

    // Adds or removes a wall. A cell used by any move in the tree cannot become a wall.
    toggleWall(x, y) {
      if (!this.inBounds(x, y)) return 'blocked';
      const k = this.key(x, y);
      if (this.walls.has(k)) {
        this.walls.delete(k);
        this.touch();
        return 'removed';
      }
      if (this.isPortal(k) || this.nodes.some((n, i) => i > 0 && n.x === x && n.y === y)) return 'blocked';
      this.walls.add(k);
      this.touch();
      return 'added';
    }

    // True when lines do not run straight (portals or a torus): the threat analysis does not understand these.
    bendsLines() {
      return this.torus || this.portals.length > 0;
    }

    // Index of the pair that owns cell key k, or -1.
    portalIndex(k) {
      return this.portals.findIndex(([a, b]) => a === k || b === k);
    }

    isPortal(k) {
      return this.portalIndex(k) >= 0;
    }

    // The other end of the pair that owns cell key k, or -1.
    portalPartner(k) {
      const p = this.portals[this.portalIndex(k)];
      return p ? (p[0] === k ? p[1] : p[0]) : -1;
    }

    // True when cell key k is at least MIN_PORTAL_DISTANCE (Chebyshev) from every existing portal cell.
    portalCellFree(k) {
      return !this.portals.some((p) => p.some((c) => this.portalNear(k, c)));
    }

    // Chebyshev distance of two cell keys. On a torus each axis takes the shorter way round (the engine's rule).
    distance(i, j) {
      const s = this.size;
      const axis = (a, b) => {
        const d = Math.abs(a - b);
        return this.torus ? Math.min(d, s - d) : d;
      };
      return Math.max(axis(i % s, j % s), axis(Math.floor(i / s), Math.floor(j / s)));
    }

    portalNear(i, j) {
      return this.distance(i, j) < MIN_PORTAL_DISTANCE;
    }

    // Turns the torus on or off. Returns false (changing nothing) when the portal pairs would be too close
    // across the seam, which the engine refuses too.
    setTorus(on) {
      on = on === true;
      if (on === this.torus) return true;
      this.torus = on;
      const cells = this.portals.flat();
      const tooClose = cells.some((a, i) => cells.some((b, j) => i < j && this.portalNear(a, b)));
      if (tooClose) {
        this.torus = !on;
        return false;
      }
      this.touch();
      return true;
    }

    // True when a new pair (a, b) keeps every portal cell, old and new, at least MIN_PORTAL_DISTANCE apart.
    portalFits(a, b) {
      return a !== b && !this.portalNear(a, b) && this.portalCellFree(a) && this.portalCellFree(b);
    }

    // Why a pair cannot be added: 'blocked' (a wall or a move uses a cell), 'near' (too close to another portal
    // cell), or '' when it fits.
    portalProblem(x1, y1, x2, y2) {
      if (!this.inBounds(x1, y1) || !this.inBounds(x2, y2)) return 'blocked';
      const a = this.key(x1, y1);
      const b = this.key(x2, y2);
      const used = (x, y, k) => this.walls.has(k) || this.nodes.some((n, i) => i > 0 && n.x === x && n.y === y);
      if (used(x1, y1, a) || used(x2, y2, b)) return 'blocked';
      return this.portalFits(a, b) ? '' : 'near';
    }

    addPortal(x1, y1, x2, y2) {
      if (this.portalProblem(x1, y1, x2, y2)) return false;
      this.portals.push([this.key(x1, y1), this.key(x2, y2)]);
      this.touch();
      return true;
    }

    // Removes the whole pair that owns cell key k.
    removePortal(k) {
      const i = this.portalIndex(k);
      if (i < 0) return false;
      this.portals.splice(i, 1);
      this.touch();
      return true;
    }

    // Keys of the cells used by any move in the tree.
    movedKeys() {
      return new Set(this.nodes.slice(1).map((n) => this.key(n.x, n.y)));
    }

    // Shuffled keys of the cells a generated wall or portal may use: at least MIN_GENERATED_GAP from the edge (no
    // edges on a torus) and free of moves and of `avoid` keys.
    generationCells(rng, avoid) {
      const moved = this.movedKeys();
      const s = this.size;
      const free = [];
      for (let k = 0; k < s * s; k++) {
        const x = k % s;
        const y = Math.floor(k / s);
        const inside = this.torus || Math.min(x, y, s - 1 - x, s - 1 - y) >= Game.MIN_GENERATED_GAP;
        if (inside && !moved.has(k) && !avoid(k)) free.push(k);
      }
      for (let i = free.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [free[i], free[j]] = [free[j], free[i]];
      }
      return free;
    }

    // Replaces the walls with up to n random ones, each at least MIN_GENERATED_GAP from the edge and from every
    // other wall, on cells free of portals and moves. Returns how many were placed.
    generateWalls(n, rng = Math.random) {
      const walls = [];
      for (const k of this.generationCells(rng, (c) => this.isPortal(c))) {
        if (walls.length >= Math.floor(n)) break;
        if (walls.every((w) => this.distance(k, w) >= Game.MIN_GENERATED_GAP)) walls.push(k);
      }
      this.walls = new Set(walls);
      this.touch();
      return walls.length;
    }

    // Replaces the portals with up to n random pairs; every portal cell keeps MIN_GENERATED_GAP from the edge and
    // from every other portal cell (the partner included), on cells free of walls and moves. Returns how many
    // pairs were placed.
    generatePortals(n, rng = Math.random) {
      const cells = [];
      const free = this.generationCells(rng, (c) => this.walls.has(c));
      const next = () => free.find((k) => !cells.includes(k) && cells.every((c) => this.distance(k, c) >= Game.MIN_GENERATED_GAP));
      let added = 0;
      const pairs = [];
      for (; added < Math.floor(n); added++) {
        const a = next();
        if (a === undefined) break;
        cells.push(a);
        const b = next();
        if (b === undefined) {
          cells.pop();
          break;
        }
        cells.push(b);
        pairs.push([a, b]);
      }
      this.portals = pairs;
      this.touch();
      return pairs.length;
    }

    clearPortals() {
      if (!this.portals.length) return false;
      this.portals = [];
      this.touch();
      return true;
    }

    clearWalls() {
      if (!this.walls.size) return false;
      this.walls.clear();
      this.touch();
      return true;
    }
  }

  Game.MIN_SIZE = MIN_SIZE;
  Game.MAX_SIZE = MAX_SIZE;
  Game.MAX_PLAYER_NAME = 24;
  Game.MAX_GROUP_NAME = 40;
  Game.MIN_PORTAL_DISTANCE = MIN_PORTAL_DISTANCE;
  Game.MIN_GENERATED_GAP = 4; // generated walls and portals: distance from the edge and from each other
  G.Game = Game;
})(window.Gomoku = window.Gomoku || {});
