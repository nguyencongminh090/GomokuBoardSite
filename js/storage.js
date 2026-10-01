// Browser persistence (localStorage). Every access is guarded: storage can be full,
// disabled or cleared, and the site must still work for the current session.
(function (G) {
  'use strict';

  const KEYS = {
    games: 'gomoku-board.games.v1',
    settings: 'gomoku-board.settings.v1',
    current: 'gomoku-board.current.v1',
    keys: 'gomoku-board.keys.v1',
    installDismissed: 'gomoku-board.install-dismissed.v1',
  };

  // One IndexedDB request per call; resolves with its result once the transaction has committed.
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('gomoku-board', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('keys');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('keys', mode);
        const req = fn(tx.objectStore('keys'));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  }

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
    // Public keys of other people: [{ publicKey, fingerprint }]. Never part of settings or exports.
    loadKeys() {
      const raw = read(KEYS.keys, null);
      const trusted = raw && Array.isArray(raw.trusted)
        ? raw.trusted.filter((k) => k && G.security.isPublicJwk(k.publicKey) && typeof k.fingerprint === 'string')
        : [];
      return { trusted };
    },
    // When the install banner was last dismissed (ms since epoch, 0 = never).
    installDismissedAt() {
      const at = read(KEYS.installDismissed, 0);
      return typeof at === 'number' ? at : 0;
    },
    dismissInstall() {
      return write(KEYS.installDismissed, Date.now());
    },
    saveKeys(keys) {
      return write(KEYS.keys, { trusted: keys.trusted });
    },
    // The own key pair lives in IndexedDB because only it can store a non-extractable CryptoKey.
    async loadOwnKey() {
      try {
        const pair = await idb('readonly', (store) => store.get('own'));
        return G.security.isKeyPair(pair) ? pair : null;
      } catch (e) {
        return null;
      }
    },
    async saveOwnKey(pair) {
      try {
        await idb('readwrite', (store) => (pair ? store.put(pair, 'own') : store.delete('own')));
        if (pair && navigator.storage && navigator.storage.persist) navigator.storage.persist(); // ask not to be evicted
        return true;
      } catch (e) {
        console.warn('Could not save the key pair', e);
        return false;
      }
    },
    getCurrent() {
      return read(KEYS.current, null);
    },
    setCurrent(id) {
      write(KEYS.current, id);
    },
  };
})(window.Gomoku = window.Gomoku || {});
