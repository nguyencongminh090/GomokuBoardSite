// Feature search model (G.search): natural-language matching of a short question to the app's features. No DOM.
//
// Pipeline, the same for documents and queries:
//   fold      lower-case, strip Vietnamese tone marks (đ -> d), so "cai dat" finds "cài đặt"
//   tokenize  split into words, drop stop words ("làm sao để", "how do I"), light English stemming
//   index     one weighted term vector per feature (title > keywords > description), TF-IDF style idf
//   query     per query word the best document word: exact, prefix (the word still being typed) or a typo
//             within edit distance 1-2; plus a bonus for adjacent word pairs ("nuoc di") and full coverage
//   complete  finish the word being typed from the vocabulary, with its original diacritics
//   correct   "did you mean": replace unknown words by the nearest vocabulary word
(function (G) {
  'use strict';

  const STOP = new Set((
    // Vietnamese (folded). "di" and "nuoc" are real content words here (nước đi), so they are not listed.
    'la lam de toi muon minh cach nhu the nao co khong va cho cua o dau cac mot nhung duoc can hay ban xin vui long tim ' +
    'thi ra vao trong khi nay kia gi thay giup huong dan em anh chi oi nhe a ' +
    // English
    'an the to of how do does did i me my we you can could would should want need wanna is it its in on for and or with ' +
    'where what which when find show please be are this that use get let make'
  ).split(' '));

  const WEIGHT = { title: 3, kw: 2.4, desc: 1 };

  function fold(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function stem(w) {
    if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  // Question openers that are stop words only as a phrase: "sao" alone is a content word ("sao lưu" = back up).
  const STOP_PHRASES = /\b(lam sao|nhu the nao|lam the nao|the nao|de lam)\b/g;

  // Folded words with stop words removed (kept when the text is nothing but stop words).
  function words(text) {
    const all = fold(text).replace(STOP_PHRASES, ' ').split(' ').filter(Boolean);
    const kept = all.filter((w) => !STOP.has(w));
    return kept.length ? kept : all;
  }

  function tokenize(text) {
    return words(text).map(stem);
  }

  // Optimal string alignment distance (substitution, insert, delete, adjacent swap), cut off at `max`.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  const typoLimit = (w) => (w.length >= 8 ? 2 : w.length >= 4 ? 1 : 0);

  // docs: [{ id, fields: { title: [str], kw: [str], desc: [str] } }]. Strings of every language go in one index,
  // so a Vietnamese interface still finds "dark mode" and an English one finds "cai dat".
  function createIndex(docs) {
    const df = new Map(); // stem -> documents containing it
    const surface = new Map(); // folded surface word -> { text: original lower-case word, n }
    const entries = docs.map((doc) => {
      const terms = new Map(); // stem -> weight
      const pairs = new Set();
      for (const [field, texts] of Object.entries(doc.fields)) {
        for (const text of texts) {
          const ws = words(text);
          const stems = ws.map(stem);
          stems.forEach((s, i) => {
            terms.set(s, Math.max(terms.get(s) || 0, WEIGHT[field]) + (terms.has(s) ? 0.15 : 0));
            if (i) pairs.add(`${stems[i - 1]} ${s}`);
          });
          // Surface words keep their diacritics for completion; stop words are not worth completing.
          for (const raw of String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
            const f = fold(raw);
            if (f.length < 2 || STOP.has(f)) continue;
            const hit = surface.get(f);
            if (hit) hit.n += 1;
            else surface.set(f, { text: raw, n: 1 });
          }
        }
      }
      for (const s of terms.keys()) df.set(s, (df.get(s) || 0) + 1);
      return { id: doc.id, terms, pairs };
    });
    const idf = (s) => Math.log(1 + entries.length / (df.get(s) || 0.5));
    return { entries, idf, surface, vocab: [...df.keys()] };
  }

  // Best similarity (0..1) between a query word and a document term, or 0.
  function similarity(q, term, prefix) {
    if (q === term) return 1;
    if (prefix && q.length >= 2 && term.startsWith(q)) return 0.8;
    const max = typoLimit(q);
    if (max && term.length >= 4 && distance(q, term, max) <= max) return 0.55;
    return 0;
  }

  // Ranked [{ id, score, hits }] for a question; `hits` are the folded query words that matched (for highlighting).
  // Without `typing` every word counts as complete; with it the last word may still be a prefix.
  function query(index, text, { limit = 8, typing = true } = {}) {
    const q = tokenize(text);
    if (!q.length) return [];
    const open = typing && !/\s$/.test(text);
    const out = [];
    for (const e of index.entries) {
      let score = 0;
      let matched = 0;
      const hits = [];
      q.forEach((w, i) => {
        let best = 0;
        for (const [term, weight] of e.terms) {
          const sim = similarity(w, term, open && i === q.length - 1);
          if (sim) best = Math.max(best, sim * weight * index.idf(term));
        }
        if (best) {
          score += best;
          matched += 1;
          hits.push(w);
        }
      });
      if (!matched) continue;
      for (let i = 1; i < q.length; i++) if (e.pairs.has(`${q[i - 1]} ${q[i]}`)) score *= 1.35;
      score *= 0.4 + 0.6 * (matched / q.length); // a feature that explains the whole question beats one that explains a word
      out.push({ id: e.id, score, hits });
    }
    out.sort((a, b) => b.score - a.score);
    const top = out[0] ? out[0].score : 0;
    return out.filter((r) => r.score >= top * 0.22).slice(0, limit);
  }

  // The query with its last word finished ("cai da" -> "cai đặt"), or null when it cannot be finished.
  function complete(index, text) {
    if (!text || /\s$/.test(text)) return null;
    const m = /(\S+)$/.exec(text);
    const f = fold(m[1]);
    if (f.length < 1 || /\s/.test(f)) return null;
    // A query with Vietnamese letters is Vietnamese: prefer completions that have them too ("đổi m" -> màu, not move).
    const accented = /[^\x00-\x7f]/.test(text);
    const rank = (v, key) => (accented && v.text !== key ? 1e6 : 0) + v.n;
    let best = null;
    for (const [key, v] of index.surface) {
      if (key.length <= f.length || !key.startsWith(f)) continue;
      if (!best || rank(v, key) > best.r || (rank(v, key) === best.r && key.length < best.key.length)) best = { key, v, r: rank(v, key) };
    }
    return best ? text.slice(0, text.length - m[1].length) + best.v.text : null;
  }

  // "Did you mean": each query word that is not in the vocabulary is replaced by its nearest vocabulary word.
  function correct(index, text) {
    const raw = fold(text).split(' ').filter(Boolean);
    if (!raw.length) return null;
    let changed = false;
    const fixed = raw.map((w) => {
      if (index.surface.has(w)) return index.surface.get(w).text;
      if (STOP.has(w) || /\d/.test(w) || index.vocab.includes(stem(w))) return w;
      const max = Math.max(1, typoLimit(w));
      let best = null;
      for (const [key, v] of index.surface) {
        const d = distance(w, key, max);
        if (d <= max && (!best || d < best.d || (d === best.d && v.n > best.n))) best = { key, d, n: v.n, text: v.text };
      }
      if (!best) return w;
      changed = true;
      return best.text;
    });
    return changed ? fixed.join(' ') : null;
  }

  G.search = { fold, tokenize, distance, createIndex, query, complete, correct };
})(window.Gomoku = window.Gomoku || {});
