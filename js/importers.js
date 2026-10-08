// Import a game from a link to another site. Each site is one entry in SITES: `match` pulls the game id out of a link,
// `load` fetches it and `toGame` turns the site's data into our saved-game JSON (the Game constructor validates it).
// No DOM at load time. Errors carry `code` (link | network | notFound | badData); main.js maps it to a message.
(function (G) {
  'use strict';

  // `config.proxy` is the base URL of a relay for sites that do not allow cross-origin requests (set by main.js).
  const config = { proxy: '' };

  function fail(code, url) {
    const e = new Error(code);
    e.code = code;
    if (url) e.url = url; // where the person can fetch the data by hand
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

  // ---------- playok.com ----------
  // The page embeds a PGN-like record, also served as https://www.playok.com/p/?g=gm<id>.txt:
  //   [Black "a"] [White "b"] [Date "2026.06.22"] [Time "17:06:43"] [GameType "61,15"]   (GameType = "<kind>,<board size>")
  //   1. d11 e13 2. e14 white 3. -- d10 4. e9 f9 ... 19. a10 1-0
  // Columns are letters from the left, rows count up from the bottom. `white`/`black` is the colour choice after the opening
  // stones and `--` an empty slot; neither is a move. Every token (stones and markers) alternates between the two seats, and the
  // headers name the seats (Black = the first seat), not always the final colours: stones alternate black, white, black... by
  // order, so the last stone's seat tells who ended up black (the opening swap can hand white to either seat).
  // The same record can come three ways: the .txt file (through `config.proxy`, because the site sends no CORS headers),
  // a link that carries it as Base64 (`?g=gm.<base64>`) and a link with only the moves (`?g=gm+c3l7f8...`, no names, board 15).
  const PLAYOK_DEFAULT_SIZE = 15;

  function hash(text) { // FNV-1a, for a stable id when the record names no date or players
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(36);
  }

  const playok = {
    id: 'playok',
    name: 'PlayOK',
    match(url) {
      if (!/^(www\.)?playok\.com$/i.test(url.hostname) || url.pathname !== '/p/') return null;
      const m = /^(gm\d{1,12})(\.txt)?$/.exec(url.searchParams.get('g') || '');
      return m ? m[1] : null;
    },
    // A link that carries the game itself: the record text, or null. Read from the raw query (a `+` must stay a `+`).
    inline(url) {
      if (!/^(www\.)?playok\.com$/i.test(url.hostname) || url.pathname !== '/p/') return null;
      const m = /[?&]g=gm([.+])([^&#]*)/.exec(url.search);
      if (!m) return null;
      let data = m[2];
      try {
        data = decodeURIComponent(data);
      } catch (e) {
        // not percent-encoded after all
      }
      if (m[1] === '+') return data; // moves only: the fragment (#22) only says which move the site shows
      try {
        const bin = atob(data.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''));
        return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      } catch (e) {
        throw fail('badData');
      }
    },
    looksLike(text) {
      return /\[GameType\s+"/.test(text) || /^\s*1\.\s+[a-z]\d{1,2}\b/i.test(text);
    },
    async load(id, fetchFn) {
      if (!config.proxy) throw fail('blocked', `https://www.playok.com/p/?g=${id}.txt`);
      const res = await fetchFn(`${config.proxy}/import/playok/${id}`);
      if (res.status === 404) throw fail('notFound');
      if (!res.ok) throw fail('network');
      return res.text();
    },
    toGame(text, id) {
      const head = {};
      String(text).replace(/^\s*\[(\w+)\s+"([^"]*)"\]/gm, (all, k, v) => { head[k] = v; return all; });
      const size = Number((head.GameType || '').split(',')[1]) || PLAYOK_DEFAULT_SIZE;
      if (size < 5 || size > 26) throw fail('badData');
      const body = String(text).replace(/^\s*\[.*\]\s*$/gm, ' ');
      // Stones and the markers between them, in order; move numbers and the result are not matched.
      const tokens = body.match(/--|white|black|[a-z]\d{1,2}/gi) || [];
      const nodes = [];
      const seen = new Set();
      let lastSeat = 0;
      tokens.forEach((tok, i) => {
        const m = /^([a-z])(\d{1,2})$/i.exec(tok);
        if (!m) return;
        const x = m[1].toLowerCase().charCodeAt(0) - 97;
        const y = size - Number(m[2]);
        if (x >= size || y < 0 || y >= size || seen.has(y * size + x)) throw fail('badData');
        seen.add(y * size + x);
        nodes.push([nodes.length, x, y]);
        lastSeat = i % 2; // tokens alternate between the first seat (0) and the second (1)
      });
      if (!nodes.length) throw fail('badData');

      // Stone n is black when n is odd; the seat that played the last stone has that stone's colour.
      const blackSeat = (nodes.length - 1) % 2 === 0 ? lastSeat : 1 - lastSeat;
      const seats = [head.Black, head.White].map((n) => (n || '').trim());
      const names = blackSeat === 0 ? seats : [seats[1], seats[0]];
      const when = Date.parse(`${(head.Date || '').replace(/\./g, '-')}T${head.Time || '00:00:00'}Z`);
      const createdAt = Number.isFinite(when) ? when : Date.now();
      const key = [head.Date, head.Time, names[0], names[1]].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const title = names[0] && names[1] ? `${names[0]} vs ${names[1]}` : '';
      return {
        id: `playok-${key.length > 8 ? key : hash(body)}`, // the same record imported by link or by paste is one game
        name: [title, id ? `PlayOK #${id.slice(2)}` : 'PlayOK'].filter(Boolean).join(' · '),
        size,
        createdAt,
        updatedAt: createdAt,
        players: names,
        walls: [],
        portals: [],
        nodes,
        prefs: [],
        cur: nodes.length,
      };
    },
  };

  const SITES = [vncaro, playok];

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
      let inline = null;
      try {
        inline = site.inline ? site.inline(url) : null;
      } catch (e) {
        inline = ''; // a link that should carry a game but does not decode: reported as unreadable data later
      }
      if (inline != null) return { site, id: null, text: inline };
      const id = site.match(url);
      if (id) return { site, id };
    }
    return null;
  }

  // True for a link we can fetch or a game record we can read as it is.
  const recognises = (text) => !!parseLink(text) || SITES.some((s) => s.looksLike && s.looksLike(String(text)));

  // Fetch a link (or read a pasted game record) and return saved-game JSON. `fetchFn` is injectable for tests.
  async function fromLink(text, fetchFn) {
    const hit = parseLink(text);
    if (!hit) {
      const site = SITES.find((s) => s.looksLike && s.looksLike(String(text)));
      if (!site) throw fail('link');
      return { site: site.name, game: site.toGame(String(text), null) };
    }
    if (hit.text != null) return { site: hit.site.name, game: hit.site.toGame(hit.text, null) }; // the link carries the game
    let data;
    try {
      data = await hit.site.load(hit.id, fetchFn || ((u) => fetch(u)));
    } catch (e) {
      throw e.code ? e : fail('network');
    }
    return { site: hit.site.name, game: hit.site.toGame(data, hit.id) };
  }

  G.importers = { SITES, config, parseLink, recognises, fromLink };
})(window.Gomoku = window.Gomoku || {});
