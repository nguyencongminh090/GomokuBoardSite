// SVG board renderer. Both themes share one geometry: a size x size grid of positions with
// pitch P. The paper theme draws cells around each position; the stone theme draws lines
// through them, so pieces sit in cells or on intersections respectively.
(function (G) {
  'use strict';

  const P = 40;
  const f = (n) => Math.round(n * 10) / 10;
  const COUNTER = '#0f766e'; // the defender's counter-attack (a four that forces a block)
  const ATTACK = { VCF: '#b91c1c', VCT: '#7c3aed' }; // attack chain colours: fours only / fours and open threes
  const f3 = (n) => Math.round(n * 1000) / 1000;

  // Small deterministic PRNG so hand-drawn pieces keep their shape between renders.
  function rng(seed) {
    let s = (Math.imul(seed + 1, 2654435761) >>> 0) || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function defs(s) {
    return `<defs>
<radialGradient id="gStoneB" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="#6e6e6e"/><stop offset=".35" stop-color="#262626"/><stop offset="1" stop-color="#050505"/></radialGradient>
<radialGradient id="gStoneW" cx="36%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#ececea"/><stop offset="1" stop-color="#b9b9b4"/></radialGradient>
<linearGradient id="gSheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".14"/></linearGradient>
<pattern id="pHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${s.theme === 'paper' ? s.paper.wall : s.stone.wall}"/><rect width="2.5" height="7" fill="#000" fill-opacity=".3"/></pattern>
</defs>`;
  }

  // Smooth curve through points (Catmull-Rom converted to cubic Béziers).
  function smooth(pts) {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ` +
        `${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d;
  }

  function cross(cx, cy, color, style, seed) {
    const r = P * 0.28;
    if (style === 'hand') {
      const rnd = rng(seed);
      const j = (a) => (rnd() - 0.5) * a;
      // Each stroke bows to one side and overshoots a little, like a quick pen mark.
      const stroke = (x1, y1, x2, y2) => {
        const bow = (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 4);
        const mx = (x1 + x2) / 2 + bow + j(3);
        const my = (y1 + y2) / 2 - bow + j(3);
        return `M${f(x1 + j(5))} ${f(y1 + j(5))}Q${f(mx)} ${f(my)} ${f(x2 + j(6))} ${f(y2 + j(6))}`;
      };
      return `<path d="${stroke(cx - r, cy - r, cx + r, cy + r)}${stroke(cx + r, cy - r, cx - r, cy + r)}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
    }
    const w = style === 'bold' ? 6.5 : 3.6;
    return `<path d="M${f(cx - r)} ${f(cy - r)}L${f(cx + r)} ${f(cy + r)}M${f(cx + r)} ${f(cy - r)}L${f(cx - r)} ${f(cy + r)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  }

  function ring(cx, cy, color, style, seed) {
    const r = P * 0.29;
    if (style === 'hand') {
      // One loop drawn past its start point, with a wobbling radius, so the ends overlap.
      const rnd = rng(seed);
      const start = rnd() * Math.PI * 2;
      const sweep = Math.PI * 2 + 0.5 + rnd() * 0.4;
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = start + (sweep * i) / 12;
        const rr = r * (1 + (rnd() - 0.5) * 0.14) * (i === 12 ? 0.9 : 1);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92]);
      }
      return `<path d="${smooth(pts)}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
    }
    const w = style === 'bold' ? 6.2 : 3.6;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  }

  function stone(player, cx, cy, style) {
    const r = P * 0.46;
    if (style === 'flat') {
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${player ? '#f7f7f4' : '#151515'}" stroke="#151515" stroke-width="1.6"/>`;
    }
    return `<circle cx="${cx + 1}" cy="${cy + 2}" r="${r}" fill="#000" opacity=".28"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${player ? 'gStoneW' : 'gStoneB'})"${player ? ' stroke="rgba(0,0,0,.22)" stroke-width="1"' : ''}/>`;
  }

  function piece(player, cx, cy, s, seed) {
    if (s.theme === 'stone') return stone(player, cx, cy, s.stone.style);
    return player === 0
      ? cross(cx, cy, s.paper.xColor, s.paper.style, seed)
      : ring(cx, cy, s.paper.oColor, s.paper.style, seed);
  }

  function wall(x0, y0, theme) {
    if (theme === 'stone') {
      const w = P * 0.84;
      return `<rect x="${f(x0 + (P - w) / 2)}" y="${f(y0 + (P - w) / 2)}" width="${f(w)}" height="${f(w)}" rx="5" fill="url(#pHatch)" stroke="rgba(0,0,0,.45)" stroke-width="1.5"/>`;
    }
    return `<rect x="${x0 + 1.5}" y="${y0 + 1.5}" width="${P - 3}" height="${P - 3}" fill="url(#pHatch)"/>`;
  }

  // Pair colours, as in the desktop Portal UI: blue, pink, green, orange, purple, teal, gold, red.
  const PORTAL_COLORS = [[51, 179, 242], [230, 102, 153], [77, 204, 102], [242, 153, 51], [166, 89, 217], [51, 191, 179], [217, 191, 51], [217, 64, 64]];
  const portalRgb = (index, a = 1) => `rgba(${PORTAL_COLORS[index % PORTAL_COLORS.length].join(',')},${a})`;

  // One end of a portal pair: a coloured ring with a soft glow and a dark centre dot. The ring sits on a thin ink
  // outline so it keeps its contrast on any board colour.
  function portal(x0, y0, index, s) {
    const cx = x0 + P / 2;
    const cy = y0 + P / 2;
    const bg = s.theme === 'paper' ? s.paper.bg : s.stone.bg;
    const ink = G.contrast.ink(bg)[0] ? '#fff' : '#000';
    const r = P * 0.32;
    const w = P * 0.08;
    // On paper the whole cell is tinted in the pair's colour, so a portal never reads as a circle symbol.
    const cell = s.theme === 'paper'
      ? `<rect x="${f(x0 + 1)}" y="${f(y0 + 1)}" width="${f(P - 2)}" height="${f(P - 2)}" fill="${portalRgb(index, 0.3)}"/>`
      : '';
    return `<g class="portal">${cell}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r + w)}" fill="${portalRgb(index, 0.25)}"/>` +
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${ink}" stroke-opacity=".6" stroke-width="${f(w + 2)}"/>` +
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="none" stroke="${portalRgb(index)}" stroke-width="${f(w)}"/>` +
      `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(P * 0.08)}" fill="#262626"/></g>`;
  }

  // Dashed link between two cell centres, in a pair's colour.
  function portalLink(ax, ay, bx, by, index) {
    return `<line x1="${f(ax)}" y1="${f(ay)}" x2="${f(bx)}" y2="${f(by)}" stroke="${portalRgb(index, 0.55)}" stroke-width="2" stroke-dasharray="5 5"/>`;
  }

  function starPoints(n) {
    if (n < 9) return [];
    const a = n >= 13 ? 3 : 2;
    const b = n - 1 - a;
    const pts = [[a, a], [a, b], [b, a], [b, b]];
    if (n % 2) pts.push([(n - 1) / 2, (n - 1) / 2]);
    return pts;
  }

  // A standalone icon of one piece, used for the "to move" indicator.
  function pieceIcon(player, s) {
    const c = P / 2;
    return `<svg viewBox="0 0 ${P} ${P}" aria-hidden="true">${piece(player, c, c, s, 7)}</svg>`;
  }

  // Small 3×2 board in a theme's current colours, for the board-theme picker.
  function themePreview(theme, s) {
    const cells = [[20, 20, 0], [60, 60, 1], [100, 20, 0]];
    let body;
    if (theme === 'paper') {
      const g = s.paper.grid;
      body = `<rect width="120" height="80" fill="${s.paper.bg}"/>` +
        `<path d="M40 0V80M80 0V80M0 40H120" stroke="${g}" stroke-width="1.5"/>` +
        cells.map(([x, y, p]) => p ? ring(x, y, s.paper.oColor, s.paper.style, x) : cross(x, y, s.paper.xColor, s.paper.style, x)).join('');
    } else {
      body = `<rect width="120" height="80" fill="${s.stone.bg}"/><rect width="120" height="80" fill="url(#gSheen)"/>` +
        `<path d="M20 0V80M60 0V80M100 0V80M0 20H120M0 60H120" stroke="${s.stone.line}" stroke-width="1.5"/>` +
        cells.map(([x, y, p]) => stone(p, x, y, s.stone.style)).join('');
    }
    return `<svg viewBox="0 0 120 80" aria-hidden="true">${body}</svg>`;
  }

  // A black and a white stone on the board colour, for the stone-style picker.
  function stonePreview(style, s) {
    return `<svg viewBox="0 0 100 44" aria-hidden="true"><rect width="100" height="44" fill="${s.stone.bg}"/>` +
      `${stone(0, 28, 21, style)}${stone(1, 72, 21, style)}</svg>`;
  }

  // Cross and circle side by side in one symbol style, for the style picker.
  function symbolPreview(style, s) {
    return `<svg viewBox="0 0 ${2 * P} ${P}" aria-hidden="true"><rect width="${2 * P}" height="${P}" fill="${s.paper.bg}"/>` +
      `${cross(P / 2, P / 2, s.paper.xColor, style, 3)}${ring(1.5 * P, P / 2, s.paper.oColor, style, 5)}</svg>`;
  }

  // On phones the panel stacks under the board and the page grows with its content, so the board area has
  // no fixed height: the board is sized by width alone. With the panel hidden the page is one screen tall
  // (see css/style.css), so the board fits the full screen height too.
  function heightFollowsBoard() {
    return matchMedia('(max-width: 860px)').matches && !document.body.classList.contains('focus');
  }

  // Phones: the board runs edge to edge and labels only the left and bottom sides.
  function compactScreen() {
    return matchMedia('(max-width: 860px)').matches;
  }

  class BoardView {
    constructor(svg, onCell) {
      this.svg = svg;
      this.onCell = onCell;
      this.state = null;
      this.hover = null;
      this.voice = null; // cell heard by voice, previewed like a hover until it is played or cancelled
      this.tool = 'wall'; // setup tool: 'wall' | 'portal'
      this.pending = null; // cell key of the first end of a portal pair being placed
      svg.addEventListener('pointermove', (e) => this.setHover(this.cellAt(e)));
      svg.addEventListener('pointerleave', () => this.setHover(null));
      svg.addEventListener('click', (e) => {
        const c = this.cellAt(e);
        if (c) this.onCell(c.x, c.y);
      });
      // Pixel snapping depends on the rendered size, so redraw when the space available to the board changes.
      // On phones the board area's height follows the board itself, so only its width counts there;
      // otherwise resizing the board would retrigger the observer.
      this.spaceKey = '';
      new ResizeObserver(() => {
        const key = this.spaceKeyNow();
        if (key === this.spaceKey) return;
        this.spaceKey = key;
        requestAnimationFrame(() => this.refit());
      }).observe(svg.parentElement);
    }

    spaceKeyNow() {
      const wrap = this.svg.parentElement;
      return `${wrap.clientWidth}x${heightFollowsBoard() ? '' : wrap.clientHeight}@${window.devicePixelRatio}`;
    }

    refit() {
      if (!this.state) return;
      const { game, s, mode } = this.state;
      this.render(game, s, mode);
    }

    // Sizes the SVG so one cell (P units) is a whole number of device pixels. Then every grid line is the
    // same distance apart on screen and can be snapped to the pixel grid, so no line renders thicker or
    // blurrier than its neighbours. Returns the scale (device px per unit) and the SVG's device-pixel origin.
    fit(VW, VH) {
      const wrap = this.svg.parentElement;
      const cs = getComputedStyle(wrap);
      const dpr = window.devicePixelRatio || 1;
      const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = heightFollowsBoard()
        ? availW
        : wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (availW > 0 && availH > 0) {
        const q = Math.max(8, Math.floor(Math.min((availW * dpr * P) / VW, (availH * dpr * P) / VH))); // device px per cell
        this.svg.style.width = `${(VW * q) / P / dpr}px`;
        this.svg.style.height = `${(VH * q) / P / dpr}px`;
      }
      const rect = this.svg.getBoundingClientRect();
      const scale = rect.width > 0 ? (rect.width * dpr) / VW : 1;
      // Page coordinates (not viewport) so scrolling doesn't change the snapping. Browsers paint the SVG at
      // a whole device pixel, so the origin is rounded the same way.
      return {
        scale,
        dpr,
        x0: Math.round((rect.left + window.scrollX) * dpr),
        y0: Math.round((rect.top + window.scrollY) * dpr),
      };
    }

    cellAt(e) {
      if (!this.state) return null;
      const ctm = this.svg.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const { m, n } = this.state;
      const x = Math.floor((p.x - m) / P);
      const y = Math.floor((p.y - m) / P);
      return x >= 0 && y >= 0 && x < n && y < n ? { x, y } : null;
    }

    render(game, s, mode) {
      const n = game.size;
      const paper = s.theme === 'paper';
      const edge = s.coords !== 'cell'; // edge labels and cell numbers are mutually exclusive
      const compact = compactScreen();
      const m = compact ? (edge ? 26 : 2) : edge ? 34 : 12;
      const W = 2 * m + n * P;
      // Phones crop the unlabelled top and right margins down to a hairline; the geometry stays m-based.
      const cut = compact && edge ? m - 2 : 0;
      const VW = W - cut;
      const VH = W - cut;
      const vy = cut;
      const c = (i) => m + (i + 0.5) * P;
      const bg = paper ? s.paper.bg : s.stone.bg;
      // Board text ink: black or white, whichever contrasts more (the same rule the colour audit checks).
      const ink = G.contrast.ink(bg)[0] ? 'rgba(255,255,255,' : 'rgba(0,0,0,';
      const A = G.contrast.INK_ALPHA;
      const out = [defs(s)];

      this.state = { game, s, mode, m, n };
      this.svg.setAttribute('viewBox', `0 ${vy} ${VW} ${VH}`);
      const px = this.fit(VW, VH);
      this.spaceKey = this.spaceKeyNow();

      const rx = compact ? 0 : 12;
      out.push(`<rect width="${W}" height="${W}" rx="${rx}" fill="${bg}"/>`);
      if (!paper) out.push(`<rect width="${W}" height="${W}" rx="${rx}" fill="url(#gSheen)"/>`);

      // Grid. Widths are whole device pixels; each line is moved (by under half a pixel) so it covers
      // whole pixels: odd widths centre on a pixel's middle, even widths on a pixel boundary.
      const dev = (w) => Math.max(1, Math.round(w * px.dpr)); // css px -> whole device px
      const thin = dev(paper ? 1 : 1.1);
      const bold = Math.max(thin + 1, dev(paper ? 2 : 2.2));
      const snap = (u, origin, w) => {
        const X = origin + u * px.scale;
        const target = w % 2 ? Math.floor(X) + 0.5 : Math.round(X);
        return u + (target - X) / px.scale;
      };
      const count = paper ? n + 1 : n;
      const base = paper ? m : c(0);
      const widths = [];
      const xs = [];
      const ys = [];
      for (let i = 0; i < count; i++) {
        const w = i === 0 || i === count - 1 ? bold : thin;
        widths.push(w);
        xs.push(snap(base + i * P, px.x0, w));
        ys.push(snap(base + i * P - vy, px.y0, w) + vy);
      }
      // Lines run between the outer border lines, extended by half the border so corners close cleanly.
      const half = bold / px.scale / 2;
      const x1 = xs[0] - half;
      const x2 = xs[count - 1] + half;
      const y1 = ys[0] - half;
      const y2 = ys[count - 1] + half;
      const lines = [];
      for (let i = 0; i < count; i++) {
        const sw = f3(widths[i] / px.scale);
        lines.push(`<line x1="${f3(xs[i])}" y1="${f3(y1)}" x2="${f3(xs[i])}" y2="${f3(y2)}" stroke-width="${sw}"/>`);
        lines.push(`<line x1="${f3(x1)}" y1="${f3(ys[i])}" x2="${f3(x2)}" y2="${f3(ys[i])}" stroke-width="${sw}"/>`);
      }
      out.push(`<g stroke="${paper ? s.paper.grid : s.stone.line}" stroke-linecap="butt">${lines.join('')}</g>`);
      if (!paper) {
        out.push(`<g fill="${s.stone.line}">${starPoints(n).map(([x, y]) => `<circle cx="${f3(xs[x])}" cy="${f3(ys[y])}" r="3.6"/>`).join('')}</g>`);
      }

      // A torus has no edges: a dashed teal frame over the border marks the seam.
      if (game.torus) {
        out.push(`<rect x="${m}" y="${m}" width="${n * P}" height="${n * P}" fill="none" stroke="#2fa7a0" stroke-width="2.5" stroke-dasharray="7 5" opacity=".9"/>`);
      }

      // Edge coordinates
      if (edge) {
        const t = [];
        for (let i = 0; i < n; i++) {
          const L = G.coords.LETTERS[i];
          const num = n - i;
          t.push(`<text x="${c(i)}" y="${W - m / 2}">${L}</text>`);
          t.push(`<text x="${m / 2}" y="${c(i)}">${num}</text>`);
          if (!compact) {
            t.push(`<text x="${c(i)}" y="${m / 2}">${L}</text><text x="${W - m / 2}" y="${c(i)}">${num}</text>`);
          }
        }
        out.push(`<g class="edge" fill="${ink}${A.edge})">${t.join('')}</g>`);
      }

      // Walls
      for (const k of game.walls) {
        out.push(wall(m + (k % n) * P, m + Math.floor(k / n) * P, s.theme));
      }

      // Portals
      game.portals.forEach(([a, b], i) => {
        for (const k of [a, b]) out.push(portal(m + (k % n) * P, m + Math.floor(k / n) * P, i, s));
      });

      // First end of a pair the host has clicked but not completed
      if (mode === 'setup' && this.pending !== null && this.pending !== undefined) {
        const k = this.pending;
        out.push(portal(m + (k % n) * P, m + Math.floor(k / n) * P, game.portals.length, s));
      }

      const pos = game.position();

      // Spiral cell numbers on empty cells
      if (!edge) {
        const nums = G.coords.spiral(n);
        const t = [];
        for (let k = 0; k < n * n; k++) {
          if (pos.has(k) || game.walls.has(k) || game.isPortal(k)) continue;
          t.push(`<text x="${c(k % n)}" y="${c(Math.floor(k / n))}">${nums[k]}</text>`);
        }
        const size = n * n >= 100 ? 12 : 14;
        // On stone boards the numbers sit on line crossings; a halo in the board colour keeps them readable.
        const halo = paper ? '' : ` stroke="${bg}" stroke-width="5" paint-order="stroke"`;
        out.push(`<g class="cellnum" font-size="${size}" fill="${ink}${paper ? A.cellPaper : A.cellStone})"${halo}>${t.join('')}</g>`);
      }

      // Last move highlight (paper: tinted cell, drawn under the piece)
      const last = game.cur > 0 ? game.nodes[game.cur] : null;
      if (last && s.showLastMove && paper) {
        const color = game.player(game.cur) === 0 ? s.paper.xColor : s.paper.oColor;
        out.push(`<rect x="${m + last.x * P + 1}" y="${m + last.y * P + 1}" width="${P - 2}" height="${P - 2}" fill="${color}" opacity=".14"/>`);
      }

      // Pieces. The piece that has just become the current move drops in (not again on a plain redraw).
      const dropKey = game.cur > 0 ? `${game.id}:${game.cur}` : '';
      const drop = dropKey !== '' && dropKey !== this.lastDrop;
      this.lastDrop = dropKey;
      for (const [k, id] of pos) {
        const p = piece(game.player(id), c(k % n), c(Math.floor(k / n)), s, k);
        out.push(drop && id === game.cur ? `<g class="drop">${p}</g>` : p);
      }

      // Move order numbers
      if (s.showMoveNumbers) {
        const t = [];
        for (const [k, id] of pos) {
          const d = game.nodes[id].depth;
          const x = k % n;
          const y = Math.floor(k / n);
          const isLast = id === game.cur && s.showLastMove;
          if (paper) {
            t.push(`<text class="mnum-paper" x="${m + x * P + 3}" y="${m + y * P + 3}" fill="${isLast ? '#e0342f' : `${ink}${A.edge})`}">${d}</text>`);
          } else {
            const white = game.player(id) === 1;
            const fill = isLast ? (white ? '#d0201b' : '#ff7a6e') : white ? '#1a1a1a' : '#f4f4f4';
            t.push(`<text class="mnum" x="${c(x)}" y="${c(y)}" font-size="${d >= 100 ? 13 : 16}" fill="${fill}">${d}</text>`);
          }
        }
        out.push(`<g>${t.join('')}</g>`);
      }

      // Last move marker for stones (when numbers don't already mark it)
      if (last && s.showLastMove && !paper && !s.showMoveNumbers) {
        out.push(`<circle cx="${c(last.x)}" cy="${c(last.y)}" r="5" fill="#e0342f"/>`);
      }

      // Branch hints: lettered markers where the current position has 2+ continuations
      const kids = game.nodes[game.cur].children;
      if (kids.length > 1) {
        const t = kids.map((id, i) => {
          const nd = game.nodes[id];
          return `<g class="hint"><circle cx="${c(nd.x)}" cy="${c(nd.y)}" r="10"/><text x="${c(nd.x)}" y="${c(nd.y)}">${String.fromCharCode(97 + (i % 26))}</text></g>`;
        });
        out.push(t.join(''));
      }

      this.tagCells = null;
      if (s.threatMap && mode === 'play' && !game.bendsLines()) out.push(this.threatMap(game, m));
      out.push('<g class="explain"></g><g class="analysis"></g><g class="branch"></g><g class="ghost"></g>');
      this.svg.innerHTML = out.join('');
      this.analysisLayer = this.svg.querySelector('.analysis');
      this.explainLayer = this.svg.querySelector('.explain');
      this.branchLayer = this.svg.querySelector('.branch');
      this.analysisHtml = '';
      this.ghost = this.svg.querySelector('.ghost');
      this.drawExplain();
      this.drawAnalysis();
      this.drawBranch();
      this.drawGhost();
    }

    // Threat map: tags on empty cells that would give a winning combination (green: side to move, red: the opponent),
    // and dashed rings on the cells the side to move must choose from to survive.
    threatMap(game, m) {
      const T = G.explain;
      const size = game.size;
      const stones = new Map();
      for (const [k, id] of game.position()) stones.set(k, game.player(id));
      const board = { size, walls: game.walls, stones };
      const me = game.toMove();
      const cells = new Map();
      for (const [who, player] of [['opp', 1 - me], ['me', me]]) { // 'me' last so it wins ties
        for (const [k, fin] of T.map(board, player)) {
          const old = cells.get(k);
          if (!old || T.RANK[fin] >= T.RANK[old.fin]) cells.set(k, { fin, who });
        }
      }
      const out = ['<g class="tmap">'];
      const pos = (k) => [m + ((k % size) + 0.5) * P, m + (Math.floor(k / size) + 0.5) * P];
      for (const k of T.defences(board, me) || []) {
        const [cx, cy] = pos(k);
        out.push(`<circle class="must" cx="${cx}" cy="${cy}" r="17"/>`);
      }
      for (const [k, { fin, who }] of cells) {
        const [cx, cy] = pos(k);
        const text = fin === 'five' ? '5' : fin === 'open4' ? '4+' : fin;
        out.push(`<g class="tag ${who}"><rect x="${f(cx - 15)}" y="${f(cy - 8)}" width="30" height="16" rx="3"/>` +
          `<text x="${cx}" y="${cy}">${text}</text></g>`);
      }
      out.push('</g>');
      this.tagCells = new Set(cells.keys());
      return out.join('');
    }

    // Heat blobs (Sabaki / Shudan `.shudan-heat_N`): [spread, blur, alpha] in cells, colour red < purple < blue < green.
    const HEAT_RGB = ['240,35,17', '240,35,17', '146,39,143', '146,39,143', '72,134,213', '72,134,213', '72,134,213', '89,168,15', '89,168,15'];
    const HEAT = [[.40, .75, .7], [.40, .75, .8], [.45, .80, .7], [.50, .85, .8], [.55, .90, .7], [.60, 1, .8], [.75, 1, .8], [.90, 1, .7], [1, 1, .8]];
    const HEAT_SCALE = 0.6; // Sabaki's blobs are ~2 cells wide; candidates sit on neighbouring cells
    // Gradients are set through fill attributes (a CSS url(#id) would resolve against the stylesheet).
    const HEAT_DEFS = '<defs>' + HEAT.map(([sp, bl, al], i) => {
      const solid = Math.max(0, sp - bl / 2) / (sp + bl / 2);
      return `<radialGradient id="heat${i + 1}"><stop offset="${solid.toFixed(3)}" stop-color="rgb(${HEAT_RGB[i]})" stop-opacity="${al}"/>` +
        `<stop offset="1" stop-color="rgb(${HEAT_RGB[i]})" stop-opacity="0"/></radialGradient>`;
    }).join('') + '</defs>';

    // Engine overlay, drawn in its own layer (like the hover ghost) so search updates don't re-render the board.
    // overlay: { cands: [{ x, y, rank, label, tier, tag }], busy, line: [[x, y], ...] | null, first: player of line[0], chain: G.explain.chain result (victory run start..end) | null, mark: index of the move to stress | -1 } or null.
    // tier (1 best, 2 close, 3 weaker, 0 unknown) sets the marker colour and size; busy pulses the best marker.
    // A line (a previewed variation) replaces the candidate markers while it is shown.
    setAnalysis(overlay) {
      this.analysis = overlay;
      this.drawAnalysis();
    }

    drawAnalysis() {
      const layer = this.analysisLayer;
      const st = this.state;
      if (!layer || !st) return;
      const a = this.analysis;
      if (!a) {
        layer.innerHTML = '';
        this.analysisHtml = '';
        return;
      }
      const { game, s, m } = st;
      const c = (i) => m + (i + 0.5) * P;
      const paper = s.theme === 'paper';
      const bg = paper ? s.paper.bg : s.stone.bg;
      const ink = G.contrast.ink(bg)[0] ? '#fff' : '#1a1a1a'; // same rule as the board's other text
      const out = [];
      if (a.line && a.line.length) {
        out.push(...this.lineMarkup(a, st));
      } else {
        const RADIUS = [10.5, 12, 11, 9.5];
        // Draw the best marker last so a weaker neighbour never covers it.
        const cands = (a.cands || []).slice().sort((p, q) => q.rank - p.rank);
        const glow = cands.some((q) => q.strength);
        if (glow) out.push(HEAT_DEFS);
        const fs = f(Math.max(8, P * 0.36));
        for (const { x, y, rank, label, tier = 0, strength = 0, tag } of cands) {
          const best = rank === 1;
          const pulse = best && a.busy ? `<circle class="pulse" cx="${c(x)}" cy="${c(y)}" r="${f(P * 0.4)}"/>` : '';
          let r;
          if (strength) {
            // Sabaki-style heat blob (soft glow, wider and greener the better the move) with the winrate centred in it
            const h = HEAT[strength - 1];
            r = (h[0] + h[1] / 2) * HEAT_SCALE * P;
            out.push(`<g class="cand heat${best ? ' best' : ''}">${pulse}<circle cx="${c(x)}" cy="${c(y)}" r="${f(r)}" style="fill:url(#heat${strength})"/>` +
              `<text x="${c(x)}" y="${c(y)}" dy=".36em" font-size="${fs}">${label || rank}</text></g>`);
          } else {
            r = best ? 13 : RADIUS[tier];
            out.push(`<g class="cand t${tier}${best ? ' best' : ''}">${pulse}<circle cx="${c(x)}" cy="${c(y)}" r="${r}"/>` +
              `<text x="${c(x)}" y="${c(y)}" dy=".36em">${rank}</text></g>`);
          }
          if (tag) {
            out.push(`<text class="cand-tag" x="${c(x)}" y="${f(c(y) - r - 4)}" fill="${ATTACK[tag]}" stroke="${bg}" stroke-width="3" paint-order="stroke">${tag}</text>`);
          }
          if (label && !strength) {
            out.push(`<text class="cand-label" x="${c(x)}" y="${f(c(y) + r + 10)}" fill="${ink}" stroke="${bg}" stroke-width="3" paint-order="stroke">${label}</text>`);
          }
        }
      }
      // Skip identical markup so a running pulse animation is not restarted by every search update.
      const html = out.join('');
      if (html === this.analysisHtml) return;
      this.analysisHtml = html;
      layer.innerHTML = html;
    }

    // Markup of a previewed line (a.line, first mover a.first, optional victory chain a.chain and stressed move a.mark;
    // a.from offsets the move numbers, so a game variation shows its real move numbers).
    lineMarkup(a, st) {
      const { game, s, m } = st;
      const c = (i) => m + (i + 0.5) * P;
      const paper = s.theme === 'paper';
      const bg = paper ? s.paper.bg : s.stone.bg;
      const ink = G.contrast.ink(bg)[0] ? '#fff' : '#1a1a1a'; // same rule as the board's other text
      const out = [];
      // Moves of the victory chain (a.chain, traced back from the winning move) are solid and ringed in the
      // chain's colour; the rest of the line is faint.
      const ch = a.chain;
      a.line.forEach(([x, y], i) => {
        const player = (a.first + i) % 2;
        const inChain = ch && i >= ch.start && i <= ch.end;
        const attack = inChain && (i - ch.start) % 2 === 0;
        if (this.tagCells && this.tagCells.has(game.key(x, y))) {
          // a threat-map tag under a previewed stone would show through it: cover the tag first
          out.push(`<rect x="${f(c(x) - 16)}" y="${f(c(y) - 9)}" width="32" height="18" fill="${bg}"/>`);
        }
        out.push(`<g opacity="${inChain ? (attack ? 0.9 : 0.55) : 0.3}">${piece(player, c(x), c(y), s, game.key(x, y))}</g>`);
        if (attack) {
          // a move without a threat is a forced block of the defender's counter-four: thin ring
          out.push(`<circle class="threat ${ch.kinds[i] || 'block'}" cx="${c(x)}" cy="${c(y)}" r="${f(P * 0.46)}" stroke="${ATTACK[ch.kind]}"/>`);
        } else if (inChain && i > ch.start && i < ch.end && (ch.kinds[i] === 'four' || ch.kinds[i] === 'five')) {
          out.push(`<circle class="threat counter" cx="${c(x)}" cy="${c(y)}" r="${f(P * 0.4)}" stroke="${COUNTER}"/>`);
        }
        if (ch && i === ch.end && ch.finish) {
          const text = ch.finish === 'five' ? '5' : ch.finish === 'open4' ? '4+' : ch.finish;
          out.push(`<text class="cand-tag" x="${c(x)}" y="${f(c(y) - P * 0.46 - 3)}" fill="${ATTACK[ch.kind]}" stroke="${bg}" stroke-width="3" paint-order="stroke">${text}</text>`);
        }
        const fill = paper ? ink : player ? '#1a1a1a' : '#f4f4f4';
        const halo = paper ? ` stroke="${bg}" stroke-width="4" paint-order="stroke"` : '';
        out.push(`<text class="pvnum${i === a.mark ? ' cur' : ''}${ch && i >= ch.added ? ' solver' : ''}" x="${c(x)}" y="${c(y)}" dy=".36em" fill="${fill}"${halo}>${(a.from || 0) + i + 1}</text>`);
      });
      return out;
    }

    // Explain overlay (the Explain tab's own line), in a layer under the engine overlay. Same shape as setAnalysis' line.
    setExplain(overlay) {
      this.explain = overlay;
      this.drawExplain();
    }

    drawExplain() {
      const layer = this.explainLayer;
      const st = this.state;
      if (!layer || !st) return;
      const a = this.explain;
      layer.innerHTML = a && a.line && a.line.length ? this.lineMarkup(a, st).join('') : '';
    }

    // Variation preview while a branch chip is hovered: { line, first, from, mark, hide: [x, y] | null } or null.
    // `hide` is a stone on the board that the variation replaces (an alternative to the current move): it is faded out.
    // The engine and Explain layers and the branch letters are hidden meanwhile (`.previewing`), so only the variation shows.
    setBranch(overlay) {
      this.branch = overlay;
      this.drawBranch();
    }

    drawBranch() {
      const layer = this.branchLayer;
      const st = this.state;
      if (!layer || !st) return;
      const a = this.branch;
      const on = !!(a && a.line && a.line.length);
      this.svg.classList.toggle('previewing', on);
      if (!on) {
        layer.innerHTML = '';
        return;
      }
      const { s, m } = st;
      const bg = s.theme === 'paper' ? s.paper.bg : s.stone.bg;
      const hide = a.hide ? `<circle cx="${m + (a.hide[0] + 0.5) * P}" cy="${m + (a.hide[1] + 0.5) * P}" r="${f(P * 0.47)}" fill="${bg}" opacity=".8"/>` : '';
      layer.innerHTML = hide + this.lineMarkup(a, st).join('');
    }

    setHover(cell) {
      const same = cell && this.hover && cell.x === this.hover.x && cell.y === this.hover.y;
      if (same || (!cell && !this.hover)) return;
      this.hover = cell;
      this.drawGhost();
      if (this.onHoverCell) this.onHoverCell(cell);
    }

    // Previews the cell a voice move is about to take (null clears it).
    setVoice(cell) {
      this.voice = cell;
      this.drawGhost();
    }

    drawGhost() {
      if (!this.ghost) return;
      const h = this.hover || this.voice;
      const st = this.state;
      if (!h || !st) {
        this.ghost.innerHTML = '';
        return;
      }
      const { game, s, mode, m } = st;
      const x0 = m + h.x * P;
      const y0 = m + h.y * P;
      const k = game.key(h.x, h.y);
      let svg = '';
      const mark = (kk, color) => `<rect x="${m + (kk % game.size) * P + 3}" y="${m + Math.floor(kk / game.size) * P + 3}" width="${P - 6}" height="${P - 6}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="5 4"/>`;
      const center = (kk) => [m + ((kk % game.size) + 0.5) * P, m + (Math.floor(kk / game.size) + 0.5) * P];
      const pend = this.pending;
      const pendingNew = mode === 'setup' && this.tool === 'portal' && pend !== null && pend !== undefined;
      if (mode === 'setup' && this.tool === 'portal') {
        if (game.isPortal(k)) {
          svg = mark(k, '#e0342f') + mark(game.portalPartner(k), '#e0342f'); // clicking removes the pair
        } else if (!game.walls.has(k)) {
          svg = `<rect x="${x0}" y="${y0}" width="${P}" height="${P}" fill="#fff" opacity=".4"/>`;
          if (pendingNew && pend !== k) svg += portalLink(...center(pend), ...center(k), game.portals.length);
          svg += `<g opacity=".6">${portal(x0, y0, game.portals.length, s)}</g>`;
        }
      } else if (mode === 'setup') {
        svg = game.walls.has(k)
          ? `<rect x="${x0 + 3}" y="${y0 + 3}" width="${P - 6}" height="${P - 6}" fill="none" stroke="#e0342f" stroke-width="3" stroke-dasharray="5 4"/>`
          : `<g opacity=".45">${wall(x0, y0, s.theme)}</g>`;
      } else if (game.canPlay(h.x, h.y)) {
        svg = `<g opacity=".38">${piece(game.toMove(), x0 + P / 2, y0 + P / 2, s, k)}</g>`;
      } else if (game.isPortal(k)) {
        const i = game.portalIndex(k); // where a line entering this cell leaves: link to the other end
        svg = portalLink(...center(k), ...center(game.portalPartner(k)), i);
      }
      this.ghost.innerHTML = svg;
    }
  }

  G.BoardView = BoardView;
  G.pieceIcon = pieceIcon;
  G.symbolPreview = symbolPreview;
  G.themePreview = themePreview;
  G.stonePreview = stonePreview;
})(window.Gomoku = window.Gomoku || {});
