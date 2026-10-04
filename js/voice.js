// Voice moves, model part: spoken Vietnamese text -> a board cell. No DOM, so tests can load it.
(function (G) {
  'use strict';

  // Spoken digits, tone marks removed ("bảy" -> "bay"). "tu" and "lam" only occur after a tens word.
  const DIGIT = { khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, nham: 5, sau: 6, bay: 7, tam: 8, chin: 9 };

  // Spoken names of the column letters. Whisper often writes the letter itself ("H8"), which is handled first.
  const LETTER_NAMES = {
    a: ['a', 'ah'], b: ['be', 'bi', 'b'], c: ['xe', 'se', 'si', 'co', 'c'], d: ['de', 'di', 'do', 'd'], e: ['e'],
    f: ['ep', 'ef', 'ep phe', 'f'], g: ['gio', 'gi', 'ghi', 'go', 'g'], h: ['hat', 'hac', 'ech', 'ho', 'h'], i: ['i', 'ai'],
    j: ['dai', 'gioi', 'j'], k: ['ca', 'ka', 'cay', 'kay', 'k'], l: ['lo', 'le', 'el', 'eo', 'l'],
    m: ['mo', 'em', 'me', 'm'], n: ['no', 'en', 'ne', 'n'], o: ['o', 'oh'], p: ['pe', 'pi', 'po', 'p'], q: ['quy', 'cu', 'q'],
    r: ['re', 'ro', 'r'], s: ['et', 'es', 's'], t: ['te', 'ti', 'to', 't'], u: ['u', 'iu'],
    v: ['vi', 've', 'vo', 'v'], w: ['dup', 'w'], x: ['ich', 'ics', 'x'], y: ['y', 'ioc'], z: ['zet', 'det', 'z'],
  };

  const LETTER_INDEX = {};
  for (const names of Object.values(LETTER_NAMES)) for (const n of names) for (const w of n.split(' ')) LETTER_INDEX[w] = true;

  // Words people put in front of the cell ("đánh ba mươi bảy", "nước đi H8"; the "đi" is not read as the letter D).
  // Number words that are not digits.
  const STRUCTURE = ['tram', 'muoi', 'le', 'linh'];

  const FILLER = new Set(['danh', 'nuoc', 'so', 'toi', 'vao', 'toa', 'nhe']);

  // Lower-case, drop tone marks and punctuation: "Ba mươi bảy." -> "ba muoi bay".
  function normalize(text) {
    return String(text).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Whisper often writes a real syllable that only sounds like the number word ("xáu" for "sáu", "chăm" for "trăm").
  // js/voice-lexicon.js (built from the Vietnamese dictionary) maps those onto the word that was meant.
  function recover(s) {
    const lex = G.voiceLexicon || {};
    return s.split(' ').map((w) => (w in DIGIT || STRUCTURE.includes(w) || FILLER.has(w) || w in LETTER_INDEX ? w : lex[w] || w)).join(' ');
  }

  // One spoken digit: a digit word or a single numeral ("bay", "7"), else undefined.
  function digitOf(w) {
    if (w in DIGIT) return DIGIT[w];
    return /^\d$/.test(w) ? Number(w) : undefined;
  }

  // Normalised words -> integer or null: "ba muoi bay", "hai mot", "tram le nam", "37", "3 7".
  // Parts must come in order and at most once: hundreds (x tram), tens (muoi / le), units.
  function parseNumber(s) {
    const words = s.split(' ').filter(Boolean);
    if (!words.length) return null;
    if (words.every((w) => /^\d+$/.test(w))) return Number(words.join(''));
    const structural = words.some((w) => STRUCTURE.includes(w));
    if (!structural) { // plain digits: "hai tu" = 24
      return words.every((w) => digitOf(w) !== undefined) ? Number(words.map(digitOf).join('')) : null;
    }
    let hundreds = 0;
    let tens = 0;
    let pending = null; // a digit waiting to see whether tram or muoi follows
    let sawHundreds = false;
    let sawTens = false; // muoi, or le / linh (no tens)
    for (const w of words) {
      const d = digitOf(w);
      if (d !== undefined) {
        if (pending !== null) return null;
        pending = d;
      } else if (w === 'tram') {
        if (pending === null || sawHundreds || sawTens) return null;
        hundreds = pending * 100;
        sawHundreds = true;
        pending = null;
      } else if (w === 'muoi') { // after a digit it multiplies (hai muoi), alone it is ten (muoi mot)
        if (sawTens) return null;
        tens = pending === null ? 10 : pending * 10;
        sawTens = true;
        pending = null;
      } else if (w === 'le' || w === 'linh') {
        if (sawTens || pending !== null) return null;
        sawTens = true;
      } else {
        return null;
      }
    }
    return hundreds + tens + (pending || 0);
  }

  // "h8", "h 8", "hat tam", "be muoi lam" -> { letter, number } or null.
  function parseLabel(s) {
    const m = /^([a-z]) ?(\d{1,2})$/.exec(s);
    if (m) return { letter: m[1], number: Number(m[2]) };
    const words = s.split(' ');
    for (const len of [2, 1]) {
      const name = words.slice(0, len).join(' ');
      for (const letter of Object.keys(LETTER_NAMES)) {
        if (!LETTER_NAMES[letter].includes(name)) continue;
        const number = parseNumber(words.slice(len).join(' '));
        if (number !== null) return { letter, number };
      }
    }
    return null;
  }

  // The cell a spoken phrase names on a board of `size`: { x, y, kind: 'label' | 'number' }, or null.
  // Both forms are understood whatever the coordinate setting is: "H8" / "hát tám" and "37" / "ba mươi bảy".
  function parseCell(text, size) {
    const heard = normalize(text).replace(/\bnuoc di\b/, '').split(' ').filter((w) => !FILLER.has(w)).join(' ');
    // Exactly what was heard comes first; only when that is no cell are real-but-wrong syllables swapped for number words.
    return cellOf(heard, size) || cellOf(recover(heard), size);
  }

  function cellOf(s, size) {
    const label = parseLabel(s);
    if (label) {
      const x = G.coords.LETTERS.indexOf(label.letter.toUpperCase());
      const y = size - label.number;
      return x < size && y >= 0 && y < size ? { x, y, kind: 'label' } : null;
    }
    const n = parseNumber(s);
    if (n === null || n < 1 || n > size * size) return null;
    const k = G.coords.spiral(size).indexOf(n);
    return { x: k % size, y: Math.floor(k / size), kind: 'number' };
  }

  G.voice = { normalize, parseNumber, parseLabel, parseCell, vocabulary: { DIGITS: DIGIT, STRUCTURE } };
})(window.Gomoku = window.Gomoku || {});
