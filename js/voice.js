// Voice moves, model part: spoken Vietnamese text -> a board cell. No DOM, so tests can load it.
(function (G) {
  'use strict';

  // Spoken digits, tone marks removed ("bảy" -> "bay"). "tu" and "lam" only occur after a tens word.
  const DIGIT = { khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5, nham: 5, sau: 6, bay: 7, tam: 8, chin: 9 };

  // Spoken names of the column letters. Whisper often writes the letter itself ("H8"), which is handled first.
  const LETTER_NAMES = {
    a: ['a', 'ah'], b: ['be', 'bi', 'bo', 'be bo', 'bo bo', 'b'], c: ['xe', 'se', 'si', 'xo', 'co', 'c'], d: ['de', 'di', 'do', 'd'], e: ['e', 'ee'],
    f: ['ep', 'ef', 'phe', 'pho', 'fo', 'ep phe', 'f'], g: ['gio', 'gi', 'ghi', 'ge', 'gie', 'go', 'g'], h: ['hat', 'hac', 'hach', 'hot', 'ech', 'ho', 'h'], i: ['i', 'ai', 'i ngan'],
    j: ['dai', 'gioi', 'j'], k: ['ca', 'ka', 'ko', 'cay', 'kay', 'k'], l: ['lo', 'le', 'el', 'eo', 'e lo', 'el lo', 'l'],
    m: ['mo', 'em', 'me', 'em mo', 'm'], n: ['no', 'en', 'ne', 'en no', 'n'], o: ['o', 'oh'], p: ['pe', 'pi', 'po', 'pe pho', 'po pho', 'p'], q: ['quy', 'cu', 'q'],
    r: ['re', 'ro', 'ze', 'e ro', 'e re', 'r'], s: ['et', 'es', 'et si', 'et xi', 's'], t: ['te', 'ti', 'to', 't'], u: ['u', 'iu'],
    v: ['vi', 've', 'vo', 'v'], w: ['dup', 'w'], x: ['ich', 'ics', 'ich xi', 'ich xo', 'x'], y: ['y', 'ioc', 'i dai'], z: ['zet', 'det', 'z'],
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

  // Sound-alike matching (the noisy-channel idea: the transcript is the intended word plus recognition noise, so the intended
  // word is the closest known one). A syllable is split into onset + nucleus + coda and compared part by part with a weighted
  // edit distance: swapping sounds Vietnamese speakers and Whisper mix up costs 0.5, any other change costs 1.
  const ONSETS = ['ngh', 'ng', 'nh', 'ch', 'tr', 'th', 'kh', 'ph', 'gh', 'gi', 'qu', ...'bcdghklmnpqrstvxz'];
  const CODAS = ['ng', 'nh', 'ch', ...'cmnpt'];
  const SOFT = {
    onset: ['c k', 'c q', 'k q', 'd z', 'd gi', 'gi z', 'd r', 'r z', 'gi r', 'ch tr', 's x', 'n l', 'nh l', 'nh n', 't th', 'p ph', 'b p', 'h kh', 'g gh', 'ng ngh', 'v z'],
    nucleus: ['a e', 'o u', 'i e', 'u uo', 'o uo', 'a ai', 'o oa', 'i y'],
    coda: ['t c', 'n ng', 'ng nh', 'n nh', 'c ch', 't ch', 'm n', 'p t'],
  };
  const SOFT_SET = {};
  for (const [part, pairs] of Object.entries(SOFT)) SOFT_SET[part] = new Set(pairs.flatMap((p) => [p, p.split(' ').reverse().join(' ')]));

  function splitSyllable(w) {
    const onset = ONSETS.find((o) => w.startsWith(o) && w.length > o.length && 'aeiouy'.includes(w[o.length])) || '';
    const rest = w.slice(onset.length);
    const coda = CODAS.find((c) => rest.endsWith(c) && rest.length > c.length) || '';
    return [onset, rest.slice(0, rest.length - coda.length), coda];
  }

  // 0 = same, 0.5 = a known confusion, otherwise 1, for one part of a syllable.
  function partCost(part, a, b) {
    if (a === b) return 0;
    return SOFT_SET[part].has(`${a} ${b}`) ? 0.5 : 1;
  }

  // Distance between two syllables, capped at 2.
  function syllableCost(a, b) {
    if (a === b) return 0;
    const x = splitSyllable(a);
    const y = splitSyllable(b);
    return Math.min(2, partCost('onset', x[0], y[0]) + partCost('nucleus', x[1], y[1]) + partCost('coda', x[2], y[2]));
  }

  // Distance between two phrases of the same number of syllables, else Infinity.
  function phraseCost(a, b) {
    const x = a.split(' ');
    const y = b.split(' ');
    return x.length === y.length ? x.reduce((sum, w, i) => sum + syllableCost(w, y[i]), 0) : Infinity;
  }

  // The one candidate that sounds like `word` (cost <= limit), judged by `group` so two spellings of one meaning are no tie.
  // No answer when two meanings are equally close: a wrong guess is worse than none.
  function nearest(word, candidates, group, limit) {
    let best = null;
    let bestCost = Infinity;
    let tie = false;
    for (const c of candidates) {
      const cost = phraseCost(word, c);
      if (cost < bestCost - 1e-9) {
        best = c;
        bestCost = cost;
        tie = false;
      } else if (Math.abs(cost - bestCost) < 1e-9 && group(c) !== group(best)) {
        tie = true;
      }
    }
    return best !== null && !tie && bestCost <= limit ? best : null;
  }

  // After a column letter the rest must be a number, so a word that sounds like a number word is read as it ("tém" for
  // "tám", "thăm" for "tám"). Words that already are number words, numerals and short words stay as heard.
  const NUMBER_WORDS = [...Object.keys(DIGIT), ...STRUCTURE].filter((w) => w.length > 2);
  const numberGroup = (w) => (w in DIGIT ? 'd' + DIGIT[w] : w);
  function fuzzyNumber(s) {
    return s.split(' ').map((w) => {
      if (w.length < 3 || w in DIGIT || STRUCTURE.includes(w) || /\d/.test(w)) return w;
      return nearest(w, NUMBER_WORDS, numberGroup, 0.5) || w;
    }).join(' ');
  }

  // Which column letter a spoken name is, judged only among the `size` columns that exist: "hắt" -> h.
  function fuzzyLetter(name, size) {
    const names = [];
    for (const letter of Object.keys(LETTER_NAMES).slice(0, size)) {
      for (const n of LETTER_NAMES[letter]) if (n.length > 1) names.push([n, letter]);
    }
    const hit = nearest(name, names.map((e) => e[0]), (n) => names.find((e) => e[0] === n)[1], 0.5);
    return hit && names.find((e) => e[0] === hit)[1];
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
  function parseLabel(s, size = 26, fuzzy = true) {
    const m = /^([a-z]) ?(\d{1,2})$/.exec(s);
    if (m) return { letter: m[1], number: Number(m[2]) };
    const words = s.split(' ');
    const numberAfter = (len) => {
      const rest = words.slice(len).join(' ');
      return parseNumber(rest) ?? parseNumber(fuzzyNumber(rest));
    };
    for (const len of [2, 1]) { // a name as spoken, then one that only sounds like a letter name
      const name = words.slice(0, len).join(' ');
      for (const letter of Object.keys(LETTER_NAMES)) {
        if (!LETTER_NAMES[letter].includes(name)) continue;
        const number = numberAfter(len);
        if (number !== null) return { letter, number };
      }
    }
    for (const len of fuzzy ? [2, 1] : []) {
      const letter = len < words.length && fuzzyLetter(words.slice(0, len).join(' '), size);
      const number = letter && numberAfter(len);
      if (number !== null && number !== false && letter) return { letter, number };
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

  // Reading order: a label as spoken, then a spiral number, and only then a label whose letter merely sounds right
  // ("ba năm" is 35 before it is "bê năm" misheard). A reading that falls off the board is dropped, not the phrase.
  function cellOf(s, size) {
    const asLabel = (label) => {
      const x = label && G.coords.LETTERS.indexOf(label.letter.toUpperCase());
      const y = label && size - label.number;
      return label && x < size && y >= 0 && y < size ? { x, y, kind: 'label' } : null;
    };
    const n = parseNumber(s);
    const asNumber = () => {
      if (n === null || n < 1 || n > size * size) return null;
      const k = G.coords.spiral(size).indexOf(n);
      return { x: k % size, y: Math.floor(k / size), kind: 'number' };
    };
    return asLabel(parseLabel(s, size, false)) || asNumber() || asLabel(parseLabel(s, size));
  }

  G.voice = { normalize, parseNumber, parseLabel, parseCell, vocabulary: { DIGITS: DIGIT, STRUCTURE } };
})(window.Gomoku = window.Gomoku || {});
