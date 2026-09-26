// WCAG 2.2 colour contrast: ratios, label ink choice, fix suggestions and the board colour audit.
// Pure functions (no DOM), so tests/model.test.js can load this file directly.
(function (G) {
  'use strict';

  // Minimum ratios: 1.4.11 non-text contrast (symbols, walls, lines), 1.4.3 text (coordinate labels).
  // The grid threshold is a visibility recommendation, not a WCAG requirement: grid lines are drawn light on purpose.
  const MIN = { graphic: 3, text: 4.5, grid: 1.4 };

  // Suggested fixes aim this much above the minimum, so they stay readable after video compression on a stream.
  const SUGGEST_MARGIN = 1.15;

  // Opacity of the black/white ink used for board text; board.js draws with these same values.
  const INK_ALPHA = { edge: 0.7, cellPaper: 0.72, cellStone: 0.85 };

  // Body colour of a black stone (board.js draws it with this colour or a gradient around it).
  const BLACK_STONE = '#151515';

  function parse(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toHex(rgb) {
    return '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');
  }

  function luminance(rgb) {
    const [r, g, b] = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // WCAG contrast ratio of two colours (hex strings or [r, g, b]), from 1 to 21.
  function ratio(a, b) {
    const la = luminance(typeof a === 'string' ? parse(a) : a);
    const lb = luminance(typeof b === 'string' ? parse(b) : b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function blend(fg, alpha, bg) {
    return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
  }

  // Black or white, whichever contrasts more with the background: the ink for board labels.
  function ink(bgHex) {
    const bg = parse(bgHex);
    return ratio([0, 0, 0], bg) >= ratio([255, 255, 255], bg) ? [0, 0, 0] : [255, 255, 255];
  }

  // Contrast of semi-transparent label ink as it actually renders on the background.
  function textRatio(bgHex, alpha) {
    const bg = parse(bgHex);
    return ratio(blend(ink(bgHex), alpha, bg), bg);
  }

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }

  function hslToRgb([h, s, l]) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  // Closest colour of the same hue and saturation (changing lightness only) that satisfies meets(hex).
  function suggest(hex, meets) {
    const [h, s, l] = rgbToHsl(parse(hex));
    for (let step = 1; step <= 100; step++) {
      for (const sign of [-1, 1]) {
        const l2 = l + (sign * step) / 100;
        if (l2 < 0 || l2 > 1) continue;
        const candidate = toHex(hslToRgb([h, s, l2]));
        if (meets(candidate)) return candidate;
      }
    }
    return null;
  }

  function get(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // Checks every board colour of the active theme against its background.
  // Returns [{ key, what, ratio, min, sc, ok, advisory, suggestion }]; `what` is an i18n key.
  function audit(s) {
    const paper = s.theme === 'paper';
    const bgKey = paper ? 'paper.bg' : 'stone.bg';
    const bg = get(s, bgKey);
    const items = [];
    const add = (key, what, value, min, sc, meets, advisory = false) => {
      const ok = value >= min;
      items.push({ key, what, ratio: value, min, sc, ok, advisory, suggestion: ok ? null : suggest(get(s, key), meets(min * SUGGEST_MARGIN)) });
    };
    // `meets(target)` builds the pass test used when searching for a suggested colour.
    const against = (target) => (c) => ratio(c, bg) >= target;
    const graphic = (key, what) => add(key, what, ratio(get(s, key), bg), MIN.graphic, '1.4.11', against);

    if (paper) {
      graphic('paper.xColor', 'a11y.x');
      graphic('paper.oColor', 'a11y.o');
      graphic('paper.wall', 'a11y.wall');
      add('paper.grid', 'a11y.grid', ratio(s.paper.grid, bg), MIN.grid, null, against, true);
    } else {
      graphic('stone.line', 'a11y.line');
      graphic('stone.wall', 'a11y.wall');
      // Black stones have no outline, so the board itself must contrast with them. White stones are
      // outlined and shadowed, which gives their edge contrast on any board colour.
      add('stone.bg', 'a11y.blackStone', ratio(BLACK_STONE, bg), MIN.graphic, '1.4.11',
        (target) => (c) => ratio(BLACK_STONE, c) >= target);
    }
    const alpha = s.coords === 'cell' ? (paper ? INK_ALPHA.cellPaper : INK_ALPHA.cellStone) : INK_ALPHA.edge;
    add(bgKey, 'a11y.labels', textRatio(bg, alpha), MIN.text, '1.4.3', (target) => (c) => textRatio(c, alpha) >= target);
    return items;
  }

  G.contrast = { MIN, SUGGEST_MARGIN, INK_ALPHA, BLACK_STONE, parse, toHex, ratio, ink, textRatio, suggest, audit };
})(window.Gomoku = window.Gomoku || {});
