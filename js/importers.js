// Import a game from a link to another site. Each site is one entry in SITES: `match` pulls the game id out of a link,
// `load` fetches it and `toGame` turns the site's data into our saved-game JSON (the Game constructor validates it).
// No DOM at load time. Errors carry `code` (link | network | notFound | badData); main.js maps it to a message.
(function (G) {
  'use strict';

  function fail(code) {
    const e = new Error(code);
    e.code = code;
    return e;
  }

  // ---------- vncaro.com ----------
  // GET /api/games/<id> -> { van: { nuocDi: [[row, col]...], oCam: [[row, col]...], X, O, ngay, cheDo, xuyenKhong } }.
  // The board is always 19x19 and X moves first. 'vocuc' is a board whose edges wrap (our torus), 'xuyenkhong' are portal pairs.
  const VNCARO_SIZE = 19;
  const VNCARO_UTC_OFFSET = '+07:00'; // the site's dates carry no zone; it is a Vietnamese site

  const vncaro = {
    id: 'vncaro',
    name: 'VNCaro',
    match(url) {
      const m = /^\/van\/(\d{1,12})\/?$/.exec(url.pathname);
      return /^(www\.)?vncaro\.com$/i.test(url.hostname) && m ? m[1] : null;
    },
    async load(id, fetchFn) {
      const res = await fetchFn(`https://vncaro.com/api/games/${id}`);
      if (res.status === 404) throw fail('notFound');
      if (!res.ok) throw fail('network');
      return res.json();
    },
    toGame(res, id) {
      const v = res && res.van;
      if (!v || !Array.isArray(v.nuocDi) || !v.nuocDi.length) throw fail('badData');
      const size = VNCARO_SIZE;
      // The site stores [row, col]; we store x = column, y = row.
      const cell = (c) => {
        if (!Array.isArray(c) || !Number.isInteger(c[0]) || !Number.isInteger(c[1]) ||
            c[0] < 0 || c[1] < 0 || c[0] >= size || c[1] >= size) throw fail('badData');
        return [c[1], c[0]];
      };
      const modes = Array.isArray(v.cheDo) ? v.cheDo : [];

      const walls = (v.oCam || []).map(cell);
      const blocked = new Set(walls.map(([x, y]) => y * size + x));
      const nodes = v.nuocDi.map((m, i) => {
        const [x, y] = cell(m);
        const k = y * size + x;
        if (blocked.has(k)) throw fail('badData'); // a move on a wall or on an earlier move
        blocked.add(k);
        return [i, x, y];
      });

      const portals = [];
      if (modes.includes('xuyenkhong')) {
        for (const pair of v.xuyenKhong || []) {
          if (Array.isArray(pair) && pair.length === 2) portals.push([...cell(pair[0]), ...cell(pair[1])]);
        }
      }

      const names = [v.X && v.X.ten, v.O && v.O.ten].map((n) => (typeof n === 'string' ? n.trim() : ''));
      const when = Date.parse(`${String(v.ngay || '').replace(' ', 'T')}${VNCARO_UTC_OFFSET}`);
      const createdAt = Number.isFinite(when) ? when : Date.now();
      const title = names[0] && names[1] ? `${names[0]} vs ${names[1]}` : `#${id}`;
      return {
        id: `vncaro-${id}`, // importing the same game twice finds the first copy
        name: `${title} · VNCaro #${id}`,
        size,
        createdAt,
        updatedAt: createdAt,
        ...(modes.includes('vocuc') ? { torus: true } : {}),
        players: names,
        walls,
        portals,
        nodes,
        prefs: [],
        cur: nodes.length, // show the finished game
      };
    },
  };

  const SITES = [vncaro];

  // The site and game id a pasted link points to, or null.
  function parseLink(text) {
    let url;
    try {
      url = new URL(String(text).trim());
    } catch (e) {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    for (const site of SITES) {
      const id = site.match(url);
      if (id) return { site, id };
    }
    return null;
  }

  // Fetch a link and return saved-game JSON. `fetchFn` is injectable for tests.
  async function fromLink(text, fetchFn) {
    const hit = parseLink(text);
    if (!hit) throw fail('link');
    let data;
    try {
      data = await hit.site.load(hit.id, fetchFn || ((u) => fetch(u)));
    } catch (e) {
      throw e.code ? e : fail('network');
    }
    return { site: hit.site.name, game: hit.site.toGame(data, hit.id) };
  }

  G.importers = { SITES, parseLink, fromLink };
})(window.Gomoku = window.Gomoku || {});
