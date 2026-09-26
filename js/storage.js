// Browser persistence (localStorage). Every access is guarded: storage can be full,
// disabled or cleared, and the site must still work for the current session.
(function (G) {
  'use strict';

  const KEYS = {
    games: 'gomoku-board.games.v1',
    settings: 'gomoku-board.settings.v1',
    current: 'gomoku-board.current.v1',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Could not save to browser storage', e);
      return false;
    }
  }

  // Copies values from `src` into `base` only where the key exists in `base` with the same type,
  // so stale or hand-edited settings cannot introduce unknown fields.
  function mergeKnown(base, src) {
    if (!src || typeof src !== 'object') return base;
    for (const k of Object.keys(base)) {
      const b = base[k];
      const v = src[k];
      if (b && typeof b === 'object') mergeKnown(b, v);
      else if (typeof v === typeof b) base[k] = v;
    }
    return base;
  }

  G.storage = {
    loadGames() {
      const list = read(KEYS.games, []);
      const map = new Map();
      if (Array.isArray(list)) {
        for (const g of list) if (g && typeof g.id === 'string') map.set(g.id, g);
      }
      return map;
    },
    saveGames(map) {
      return write(KEYS.games, [...map.values()]);
    },
    loadSettings(defaults, migrate = (raw) => raw) {
      return mergeKnown(structuredClone(defaults), migrate(read(KEYS.settings, null)));
    },
    saveSettings(settings) {
      return write(KEYS.settings, settings);
    },
    getCurrent() {
      return read(KEYS.current, null);
    },
    setCurrent(id) {
      write(KEYS.current, id);
    },
  };
})(window.Gomoku = window.Gomoku || {});
