// Search-bar commands (G.commands): turns a sentence such as "set board 17x17" or "bật chế độ tối" into actions the app can
// apply. No DOM, no state changes: `parse` only describes what to do, main.js applies it.
//
// The text is folded (lower case, no tone marks) and split into clauses at "and / và / then / , ;", so "dark mode and 19x19"
// gives two actions. Each clause takes the first rule that matches (RULES is ordered from most to least specific).
//
// Action shapes (`id` names the label, see STRINGS `cmd.name.<id>`):
//   { type: 'set', id, path, value, valueKey?, same }   one settings value (`same`: it already has that value)
//   { type: 'preset', theme, index, name, same }        a colour preset of a board theme (also switches the theme)
//   { type: 'newGame', size, same }                     a new empty game of that size (the size belongs to a game)
//   { type: 'error', key, params }                      understood, but the value is not allowed
(function (G) {
  'use strict';

  const fold = (s) => G.search.fold(s);

  const ON = /\b(bat|hien|mo|show|enable|enabled|turn on|switch on|display|on)\b/;
  const OFF = /\b(tat|an|dong|hide|disable|disabled|turn off|switch off|off)\b/;
  const NUM = /(\d+(?:[.,]\d+)?)/;
  const DIMS = /\b(\d{1,2})\s*(?:x|\*|by|nhan)\s*(\d{1,2})\b/;

  const num = (text) => {
    const m = NUM.exec(text);
    return m ? Number(m[1].replace(',', '.')) : null;
  };

  // Settings that are switches: on/off verbs set them, no verb flips them.
  const TOGGLES = [
    { id: 'moveNumbers', path: 'showMoveNumbers', re: /(move number|number.* move|so nuoc|thu tu nuoc|danh so nuoc)/ },
    { id: 'lastMove', path: 'showLastMove', re: /(last move|latest move|nuoc cuoi|nuoc vua|nuoc gan nhat|highlight)/ },
    { id: 'threatMap', path: 'threatMap', re: /(threat map|threats|ban do de doa|de doa)/ },
    { id: 'voiceConfirm', path: 'voice.confirm', re: /(voice confirm|confirm.* voice|confirm.* mic|xac nhan giong|xac nhan.* nghe)/ },
    { id: 'signExports', path: 'signExports', re: /(sign.* export|export.* sign|ky.* (file|xuat|tep)|chu ky)/ },
    { id: 'autoload', path: 'engine.autoload', re: /(auto ?load|tu (dong )?tai|load.* page opens)/ },
    { id: 'multi', path: 'engine.multi', re: /(multi ?thread|da luong)/ },
    { id: 'autoAnalyze', path: 'engine.auto', re: /(auto ?analy[sz]|tu (dong )?phan tich)/ },
  ];

  // Numeric engine settings: [id, path, subject, min, max, step-less]. Longer subjects first ("analysis time" before "time").
  const NUMBERS = [
    { id: 'analysisTime', path: 'engine.analysisTime', min: 0, max: 3600, re: /(analy[sz]\w* time|time.* analy[sz]|thoi gian phan tich|giay phan tich)/ },
    { id: 'moveTime', path: 'engine.moveTime', min: 0, max: 3600, re: /(move time|think\w* time|time per move|time.* move|thoi gian (nghi|suy nghi|danh|moi nuoc)|giay moi nuoc)/ },
    { id: 'strength', path: 'engine.strength', min: 0, max: 100, re: /(strength|do manh|suc manh|trinh do|do kho|difficulty|level)/ },
    { id: 'threads', path: 'engine.threads', min: 0, max: 64, re: /(thread|luong)/ },
    { id: 'nbest', path: 'engine.nbest', min: 1, max: 10, re: /(candidate|nbest|suggested moves|so nuoc goi y|goi y)/ },
    { id: 'depth', path: 'engine.depth', min: 2, max: 99, re: /(depth|do sau)/ },
  ];

  // Strength by word, the same four levels as the buttons.
  const LEVELS = [
    { re: /\b(easy|beginner|de|yeu)\b/, value: 20 },
    { re: /\b(medium|normal|trung binh|vua)\b/, value: 50 },
    { re: /\b(hard|strong|kho|manh)\b/, value: 80 },
    { re: /\b(max|maximum|strongest|toi da|manh nhat)\b/, value: 100 },
  ];

  // Choices: a keyword per value; `need` must also appear (a context word) unless `alone` is true.
  const CHOICES = [
    { id: 'theme', path: 'theme', need: /(board|ban|theme|giao dien|kieu|look)/, options: [
      { value: 'paper', re: /\b(paper|giay|o ly)\b/, valueKey: 'set.theme.paper' },
      { value: 'stone', re: /\b(stones?|quan co|quan da|go|goban|ban co vay)\b/, valueKey: 'set.theme.stone' },
    ] },
    { id: 'symbols', path: 'paper.style', need: /(symbol|style|bieu tuong|kieu|x o|cross|circle|nets?)/, options: [
      { value: 'classic', re: /\b(classic|co dien)\b/, valueKey: 'style.classic' },
      { value: 'bold', re: /\b(bold|dam)\b/, valueKey: 'style.bold' },
      { value: 'hand', re: /\b(hand|ve tay|handwrit\w*)\b/, valueKey: 'style.hand' },
    ] },
    { id: 'stones', path: 'stone.style', need: /(stone|quan|style|kieu)/, options: [
      { value: 'glossy', re: /\b(glossy|gloss|shiny|bong)\b/, valueKey: 'stone.glossy' },
      { value: 'flat', re: /\b(flat|phang)\b/, valueKey: 'stone.flat' },
    ] },
    { id: 'cellOrder', path: 'cellOrder', need: /(sequence|tuan tu|spiral|xoan oc|row by row|tung hang)/, options: [
      { value: 'sequence', re: /(sequence|tuan tu|row by row|tung hang)/, valueKey: 'cellOrder.sequence' },
      { value: 'spiral', re: /(spiral|xoan oc)/, valueKey: 'cellOrder.spiral' },
    ] },
    { id: 'coords', path: 'coords', need: /(coord|toa do|label|cell number|so o|so trong o|spiral)/, options: [
      { value: 'cell', re: /(cell|spiral|so o|so trong o|number)/, valueKey: 'coords.cell' },
      { value: 'edge', re: /(edge|letter|chu cai|canh|vien|label)/, valueKey: 'coords.edge' },
    ] },
    { id: 'lang', path: 'lang', alone: true, options: [
      { value: 'en', re: /\b(english|tieng anh|anh van)\b/, text: 'English' },
      { value: 'vi', re: /\b(vietnamese|tieng viet|viet nam)\b/, text: 'Tiếng Việt' },
    ] },
    { id: 'view', path: 'view', need: /(view|mode|che do|chuyen|switch|go to|sang|giao dien)/, options: [
      { value: 'live', re: /\b(live|livestream|stream|truc tiep)\b/, valueKey: 'view.live' },
      { value: 'analyze', re: /\b(analy[sz]\w*|phan tich)\b/, valueKey: 'view.analyze' },
    ] },
    { id: 'rule', path: 'engine.rule', need: /(rule|luat|renju|freestyle|tu do)/, options: [
      { value: '4', re: /\brenju\b/, valueKey: 'eng.rule.4' },
      { value: '1', re: /\b(standard|chuan)\b/, valueKey: 'eng.rule.1' },
      { value: '0', re: /\b(freestyle|free|tu do)\b/, valueKey: 'eng.rule.0' },
    ] },
    { id: 'style', path: 'engine.style', need: /(style|loi choi|loi danh|phong cach|cach choi|cach danh|choi|play|engine|may|troll|cau hoa)/, options: [
      { value: 'aggressive', re: /\b(aggressive\w*|attack\w*|tan cong|hung hang)\b/, valueKey: 'eng.style.aggressive' },
      { value: 'defensive', re: /\b(defensive\w*|defen[cs]e|defend\w*|phong thu)\b/, valueKey: 'eng.style.defensive' },
      { value: 'normal', re: /\b(normal|balanced?|binh thuong|can bang)\b/, valueKey: 'eng.style.normal' },
      { value: 'troll', re: /\b(troll\w*|cau hoa|draw seek\w*)\b/, valueKey: 'eng.style.troll' },
    ] },
  ];

  // The page theme needs its own rule: "tắt chế độ tối" means light, and "sáng" alone is too vague.
  function pageTheme(c) {
    const dark = /(dark|night|che do toi|nen toi|giao dien toi|ban dem)/.test(c);
    const light = /(light mode|light theme|bright|che do sang|nen sang|giao dien sang|ban ngay)/.test(c);
    const auto = /(follow.* system|system (theme|mode)|he thong|theo may)/.test(c);
    let value = null;
    if (auto) value = 'auto';
    else if (dark && !light) value = OFF.test(c) && !ON.test(c) ? 'light' : 'dark';
    else if (light && !dark) value = OFF.test(c) && !ON.test(c) ? 'dark' : 'light';
    return value && { id: 'ui', path: 'ui', value, valueKey: `set.ui.${value}` };
  }

  function size(c, ctx) {
    const d = DIMS.exec(c);
    let n = null;
    if (d) {
      if (d[1] !== d[2]) return { type: 'error', key: 'cmd.notSquare', params: { w: d[1], h: d[2] } };
      n = Number(d[1]);
    } else if (/(board size|grid size|size|kich thuoc|co ban|ban co|co bang|board|dimension)/.test(c) && !/(font|text)/.test(c)) {
      n = num(c);
      if (n !== null && !Number.isInteger(n)) n = null;
    }
    if (n === null) return null;
    const { MIN_SIZE: min, MAX_SIZE: max } = G.Game;
    if (n < min || n > max) return { type: 'error', key: 'new.badSize', params: { min, max } };
    return { type: 'newGame', size: n, same: ctx.size === n };
  }

  function preset(c) {
    const context = /(preset|palette|colou?r|mau|bang mau|background|nen|board|ban|theme)/.test(c);
    for (const theme of ['paper', 'stone']) {
      const list = G.PRESETS[theme];
      for (let index = 0; index < list.length; index++) {
        const { name } = list[index];
        const names = G.i18n.LANGS.map((l) => fold(G.i18n.STRINGS[l][`preset.${name}`] || '')).concat(fold(name));
        const hit = names.some((n) => n && new RegExp(`\\b${n}\\b`).test(c));
        // Ambiguous names (white, pale, felt, slate) need a context word; "chalkboard" or "kraft" stand alone.
        if (hit && (context || ['Kraft', 'Chalkboard', 'Notebook', 'Walnut', 'Kaya'].includes(name))) return { type: 'preset', theme, index, name };
      }
    }
    return null;
  }

  function clause(c, ctx) {
    const s = ctx.settings;
    const on = ON.test(c);
    const off = OFF.test(c);

    const sz = size(c, ctx);
    if (sz) return sz;

    const ui = pageTheme(c);
    if (ui) return { type: 'set', ...ui };

    for (const n of NUMBERS) {
      if (!n.re.test(c)) continue;
      let v = num(c);
      if (v === null && n.id === 'strength') {
        const lv = LEVELS.find((l) => l.re.test(c));
        if (lv) v = lv.value;
      }
      if (v === null) return null;
      return { type: 'set', id: n.id, path: n.path, value: Math.min(n.max, Math.max(n.min, v)) };
    }

    for (const tg of TOGGLES) {
      if (!tg.re.test(c)) continue;
      const cur = path(s, tg.path);
      const value = on === off ? !cur : on;
      return { type: 'set', id: tg.id, path: tg.path, value };
    }

    for (const ch of CHOICES) {
      if (!ch.alone && !ch.need.test(c)) continue;
      const o = ch.options.find((x) => x.re.test(c));
      if (!o) continue;
      if (ch.id === 'coords' && ch.need.test(c) && o.value === 'edge' && /(cell|so o|spiral)/.test(c)) continue;
      return { type: 'set', id: ch.id, path: ch.path, value: o.value, valueKey: o.valueKey, text: o.text };
    }

    return preset(c);
  }

  function path(obj, p) {
    return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  // Actions for a sentence. ctx: { settings, size } (the current settings and board size, for toggles and `same`).
  function parse(text, ctx) {
    const folded = fold(text.replace(/[×✕]/g, 'x').replace(/[,;+&]/g, ' and '));
    if (!folded) return [];
    const out = [];
    for (const part of folded.split(/\b(?:and|va|then|roi|sau do)\b/)) {
      const c = part.trim();
      if (!c) continue;
      const a = clause(c, ctx);
      if (!a) continue;
      if (a.type === 'set') a.same = path(ctx.settings, a.path) === a.value;
      if (a.type === 'preset') {
        const cur = ctx.settings[a.theme];
        const { name, ...values } = G.PRESETS[a.theme][a.index];
        a.same = ctx.settings.theme === a.theme && Object.entries(values).every(([k, v]) => String(cur[k]).toLowerCase() === v);
      }
      out.push(a);
    }
    return out;
  }

  G.commands = { parse };
})(window.Gomoku = window.Gomoku || {});
