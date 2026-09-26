// Game model: board size, walls and a variation tree of moves.
//
// Nodes live in a flat array; node 0 is the empty-board root. A node's parent always has a
// smaller index, so the array can be serialised as [parent, x, y] triples and rebuilt in order.
// Each node remembers its preferred child (`pref`), which Forward follows.
(function (G) {
  'use strict';

  const MIN_SIZE = 5;
  const MAX_SIZE = 26;

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
      this.createdAt = Number(data.createdAt) || Date.now();
      this.updatedAt = Number(data.updatedAt) || this.createdAt;

      this.walls = new Set();
      for (const w of Array.isArray(data.walls) ? data.walls : []) {
        if (Array.isArray(w) && this.inBounds(w[0], w[1])) this.walls.add(this.key(w[0], w[1]));
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
        walls: [...this.walls].map((k) => [k % s, Math.floor(k / s)]),
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
      return this.nodes.length === 1 && this.walls.size === 0;
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

    mainLineLength() {
      let len = 0;
      for (let id = 0; this.nodes[id].children.length; len++) id = this.nextOf(id);
      return len;
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
      return !this.walls.has(k) && !this.position().has(k);
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
      if (this.nodes.some((n, i) => i > 0 && n.x === x && n.y === y)) return 'blocked';
      this.walls.add(k);
      this.touch();
      return 'added';
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
  G.Game = Game;
})(window.Gomoku = window.Gomoku || {});
