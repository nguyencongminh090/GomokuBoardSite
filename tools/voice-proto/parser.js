// Prototype parser: spoken Vietnamese text -> number / board label. Classic script, also loadable from node.
(function (root) {
  'use strict';

  // Lower-case, drop tone marks and punctuation ("Ba mươi bảy." -> "ba muoi bay").
  function norm(s) {
    return String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const WORD = {
    khong: 0, mot: 1, mot_: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5,
    sau: 6, bay: 7, bam: 7, tam: 8, chin: 9
  };

  // Words -> integer, or null. Handles "ba muoi bay", "hai mot", "tram le nam", "37", "3 7".
  function parseNumber(text) {
    const toks = norm(text).split(' ').filter(Boolean);
    if (!toks.length) return null;
    if (toks.every((w) => /^\d+$/.test(w))) return Number(toks.join(''));
    const structural = toks.some((w) => w === 'tram' || w === 'muoi' || w === 'le' || w === 'linh');
    if (!structural) {
      if (toks.every((w) => w in WORD)) {
        return toks.length === 1 ? WORD[toks[0]] : Number(toks.map((w) => WORD[w]).join(''));
      }
      return null;
    }
    let hundreds = 0;
    let rest = 0;
    let pending = null;
    for (const w of toks) {
      if (w in WORD) {
        if (pending !== null) return null;
        pending = WORD[w];
      } else if (w === 'tram') {
        if (pending === null) return null;
        hundreds = pending * 100;
        pending = null;
      } else if (w === 'muoi') {
        // "muoi" after a digit is the multiplier (hai muoi), alone it is ten (muoi mot)
        rest += pending === null ? 10 : pending * 10;
        pending = null;
      } else if (w === 'le' || w === 'linh') {
        continue;
      } else {
        return null;
      }
    }
    return hundreds + rest + (pending || 0);
  }

  const LETTERS = {
    a: ['a', 'ah'], b: ['be', 'bi', 'b'], c: ['xe', 'se', 'si', 'c'], d: ['de', 'di', 'd'], e: ['e'],
    f: ['ep', 'ef', 'ep phe', 'f'], g: ['gio', 'gi', 'ghi', 'g'], h: ['hat', 'hac', 'ech', 'h'], i: ['i', 'ai'],
    j: ['dai', 'gioi', 'j'], k: ['ca', 'ka', 'cay', 'kay', 'k'], l: ['lo', 'le', 'el', 'eo', 'l'],
    m: ['mo', 'em', 'me', 'm'], n: ['no', 'en', 'ne', 'n'], o: ['o', 'oh']
  };

  // "H8", "h 8", "hat tam", "hat tam muoi" -> { letter, number } or null.
  function parseLabel(text) {
    const s = norm(text);
    let m = /^([a-z]) ?(\d{1,2})$/.exec(s);
    if (m) return { letter: m[1], number: Number(m[2]) };
    const toks = s.split(' ');
    for (const len of [2, 1]) {
      const name = toks.slice(0, len).join(' ');
      for (const k of Object.keys(LETTERS)) {
        if (LETTERS[k].includes(name)) {
          const n = parseNumber(toks.slice(len).join(' '));
          if (n !== null) return { letter: k, number: n };
        }
      }
    }
    return null;
  }

  // Canonical string of what was understood, or null: "37" in number mode, "H8" in label mode.
  function parseMove(text, mode) {
    if (mode === 'num') {
      const n = parseNumber(text);
      return n === null ? null : String(n);
    }
    const l = parseLabel(text);
    return l ? l.letter.toUpperCase() + l.number : null;
  }

  const api = { norm, parseNumber, parseLabel, parseMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoiceParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
