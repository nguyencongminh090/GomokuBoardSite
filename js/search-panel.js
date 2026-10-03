// Feature search bar (above the tabs): type a question, pick a result, the panel jumps to that control.
// The matching is G.search (js/search.js); this file holds the feature table and the UI.
(function (G) {
  'use strict';

  // Where each feature lives. `targets` are tried in order and the first visible one wins (a control can be hidden by
  // state, e.g. engine buttons before the engine is loaded). `before: 'setup'` switches to Setup mode first.
  // Texts are the STRINGS keys `find.<id>`, `.d` (description) and `.k` (keywords).
  const FEATURES = [
    { id: 'cell', tab: 'play', targets: ['#cellInput'] },
    { id: 'voice', tab: 'play', targets: ['#micBtn', '#voiceSettings'] },
    { id: 'voicekey', tab: 'settings', targets: ['#groqKey', '#securityCard'] },
    { id: 'undo', tab: 'play', targets: ['.nav-row'] },
    { id: 'new', tab: 'play', targets: ['#newGame'] },
    { id: 'size', tab: 'play', targets: ['#newGame'] },
    { id: 'walls', tab: 'play', targets: ['[data-tool="wall"]'], before: 'setup' },
    { id: 'portals', tab: 'play', targets: ['[data-tool="portal"]'], before: 'setup' },
    { id: 'torus', tab: 'play', targets: ['#torusToggle'], before: 'setup' },
    { id: 'branches', tab: 'play', targets: ['#branchBlock', '#moveList'] },
    { id: 'deletemove', tab: 'play', targets: ['#deleteMove'] },
    { id: 'movelist', tab: 'play', targets: ['#moveList'] },
    { id: 'keys', tab: 'play', targets: ['.keys-details'] },
    { id: 'engine', tab: 'play', targets: ['.engine-block'] },
    { id: 'engload', tab: 'analyze', targets: ['#engLoad'] },
    { id: 'enganalyze', tab: 'play', targets: ['#engAnalyze', '.engine-block'] },
    { id: 'engresults', tab: 'analyze', targets: ['#engResults'] },
    { id: 'engstrength', tab: 'analyze', targets: ['[data-set="engine.strength:50"]'] },
    { id: 'engrule', tab: 'analyze', targets: ['[data-set="engine.rule:0"]'] },
    { id: 'engtime', tab: 'analyze', targets: ['[data-key="engine.moveTime"]'] },
    { id: 'engthreads', tab: 'analyze', targets: ['#engThreads'] },
    { id: 'findwin', tab: 'analyze', targets: ['#expFind'] },
    { id: 'threatmap', tab: 'analyze', targets: ['[data-key="threatMap"]'] },
    { id: 'theme', tab: 'settings', targets: ['#themePicks'] },
    { id: 'colors', tab: 'settings', targets: ['[data-for="paper"] .color-grid', '[data-for="stone"] .color-grid'] },
    { id: 'presets', tab: 'settings', targets: ['#paperSwatches', '#stoneSwatches'] },
    { id: 'symbols', tab: 'settings', targets: ['#styleSwatches', '#stonePicks'] },
    { id: 'coords', tab: 'settings', targets: ['[data-set="coords:edge"]'] },
    { id: 'movenumbers', tab: 'settings', targets: ['[data-key="showMoveNumbers"]'] },
    { id: 'lastmove', tab: 'settings', targets: ['[data-key="showLastMove"]'] },
    { id: 'language', tab: 'settings', targets: ['[data-set="lang:vi"]'] },
    { id: 'darkmode', tab: 'settings', targets: ['[data-set="ui:light"]'] },
    { id: 'security', tab: 'settings', targets: ['#securityCard'] },
    { id: 'export', tab: 'games', targets: ['#exportBtn'] },
    { id: 'import', tab: 'games', targets: ['[data-panel="games"] label.btn'] },
    { id: 'savedgames', tab: 'games', targets: ['#gameList'] },
    { id: 'gamename', tab: null, targets: ['#gameName'] },
    { id: 'hidepanel', tab: null, targets: ['#focusBtn'] },
    { id: 'about', tab: 'settings', targets: ['.about-card'] },
    { id: 'reset', tab: 'settings', targets: ['#resetSettings'] },
  ];

  G.SEARCH_FEATURES = FEATURES; // read by the tests

  const POPULAR = ['cell', 'voice', 'walls', 'colors', 'engine', 'export'];
  const WHERE = { play: 'find.where.play', analyze: 'find.where.analyze', games: 'find.where.games', settings: 'find.where.settings' };

  // deps: { t, esc, openTab(name), setMode(m), mode() }
  G.createSearchPanel = function (deps) {
    const $ = (sel) => document.querySelector(sel);
    const { t, esc } = deps;
    const input = $('#searchInput');
    const ghost = $('#searchGhost');
    const dialog = $('#searchDialog');
    const list = $('#searchList');
    const clear = $('#searchClear');
    const byId = new Map(FEATURES.map((f) => [f.id, f]));

    let index = null;
    let shown = []; // feature ids in the list, in order
    let active = -1;
    let completion = '';
    let hitTimer = 0;

    function buildIndex() {
      const text = (lang, key) => G.i18n.STRINGS[lang][`find.${key}`] || '';
      index = G.search.createIndex(FEATURES.map((f) => ({
        id: f.id,
        fields: {
          title: G.i18n.LANGS.map((l) => text(l, f.id)),
          desc: G.i18n.LANGS.map((l) => text(l, `${f.id}.d`)),
          kw: G.i18n.LANGS.flatMap((l) => text(l, `${f.id}.k`).split(';').filter(Boolean)),
        },
      })));
    }

    // Wraps the words of `text` that matched the query in <mark>.
    function highlight(text, hits) {
      return text.split(/(\p{L}[\p{L}\p{N}]*)/u).map((part, i) => {
        if (i % 2 === 0) return esc(part);
        const f = G.search.fold(part);
        const [s] = G.search.tokenize(f);
        const hit = hits.some((h) => s === h || (h.length >= 2 && f.startsWith(h)));
        return hit ? `<mark>${esc(part)}</mark>` : esc(part);
      }).join('');
    }

    function option(id, i, hits) {
      const f = byId.get(id);
      const where = f.tab ? t(WHERE[f.tab]) : t('find.where.top');
      return `<div class="search-opt" role="option" id="searchOpt${i}" data-id="${id}" aria-selected="${i === active}">` +
        `<span class="search-opt-title">${highlight(t(`find.${id}`), hits)}</span>` +
        `<span class="search-opt-where">${esc(where)}</span>` +
        `<span class="search-opt-desc">${highlight(t(`find.${id}.d`), hits)}</span></div>`;
    }

    function render() {
      if (!index) buildIndex();
      const text = input.value;
      const hasText = text.trim().length > 0;
      clear.hidden = !hasText;
      const results = hasText ? G.search.query(index, text) : [];
      let html = '';
      if (hasText && results.length) {
        shown = results.map((r) => r.id);
        active = Math.min(Math.max(active, 0), shown.length - 1);
        html = results.map((r, i) => option(r.id, i, r.hits)).join('');
      } else {
        shown = POPULAR;
        active = hasText ? -1 : Math.max(active, -1);
        const fix = hasText ? G.search.correct(index, text) : null;
        if (hasText) {
          html += `<p class="search-msg">${esc(t('find.none', { q: text.trim() }))} ` +
            `${fix ? `${esc(t('find.didYouMean'))} <button type="button" class="link-btn" data-fix="${esc(fix)}">${esc(fix)}</button>?` : esc(t('find.noneHelp'))}</p>`;
        }
        html += `<div class="search-head">${esc(t('find.popular'))}</div>${POPULAR.map((id, i) => option(id, i, [])).join('')}`;
      }
      list.innerHTML = `${html}<p class="search-foot">${esc(t('find.hint'))}</p>`;
      syncActive();
      renderGhost();
    }

    function syncActive() {
      list.querySelectorAll('.search-opt').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
      const cur = active >= 0 ? $(`#searchOpt${active}`) : null;
      if (cur) {
        input.setAttribute('aria-activedescendant', cur.id);
        cur.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    // Inline completion of the word being typed; only shown when it extends the typed text exactly.
    function renderGhost() {
      const text = input.value;
      const full = text && index ? G.search.complete(index, text) : null;
      completion = full && full.toLowerCase().startsWith(text.toLowerCase()) ? full.slice(text.length) : '';
      ghost.innerHTML = `<span class="search-typed">${esc(text)}</span>${esc(completion)}`;
    }

    function acceptCompletion() {
      if (!completion) return false;
      input.value += completion;
      active = 0;
      render();
      return true;
    }

    function visible(el) {
      return el.getClientRects().length > 0;
    }

    function jump(id) {
      const f = byId.get(id);
      if (!f) return;
      if (f.before === 'setup' && deps.mode() !== 'setup') deps.setMode('setup');
      if (f.tab) deps.openTab(f.tab);
      let el = null;
      for (const sel of f.targets) {
        const c = document.querySelector(sel);
        if (c && visible(c)) { el = c; break; }
      }
      dialog.close();
      if (!el) return;
      for (let d = el; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true;
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      if (el.matches('button, input, select, textarea, summary, a[href], [tabindex]')) el.focus({ preventScroll: true });
      const mark = el.closest('.switch-row, .seg, .pick-grid, .swatches, .color-grid, .field') || el;
      document.querySelectorAll('.search-hit').forEach((n) => n.classList.remove('search-hit'));
      void mark.offsetWidth; // restart the animation when the same element is hit twice
      mark.classList.add('search-hit');
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => mark.classList.remove('search-hit'), 2600);
    }

    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = shown.length;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        syncActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const id = shown[active >= 0 ? active : 0];
        if (id && (input.value.trim() || active >= 0)) jump(id);
      } else if (e.key === 'Tab' && completion && !e.shiftKey) {
        e.preventDefault();
        acceptCompletion();
      } else if (e.key === 'ArrowRight' && completion && input.selectionStart === input.value.length) {
        e.preventDefault();
        acceptCompletion();
      } else if (e.key === 'Escape') {
        // Esc clears the text first, then closes (the dialog's own Esc handling is replaced).
        e.preventDefault();
        if (input.value) { input.value = ''; render(); } else dialog.close();
      }
    });

    // Clicking a result must not take focus from the input.
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const fix = e.target.closest('[data-fix]');
      if (fix) {
        input.value = fix.dataset.fix;
        active = 0;
        return render();
      }
      const opt = e.target.closest('.search-opt');
      if (opt) jump(opt.dataset.id);
    });
    list.addEventListener('mousemove', (e) => {
      const opt = e.target.closest('.search-opt');
      const i = opt ? shown.indexOf(opt.dataset.id) : -1;
      if (i >= 0 && i !== active) { active = i; syncActive(); }
    });
    clear.addEventListener('click', () => { input.value = ''; input.focus(); render(); });
    // A click on the dimmed page (the dialog's own backdrop) closes it.
    dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => input.removeAttribute('aria-activedescendant'));
    $('#searchBtn').addEventListener('click', open);

    function open() {
      if (!dialog.open) dialog.showModal();
      active = 0;
      render();
      input.focus();
      input.select();
    }

    return {
      open,
      // The language changed: the list shows titles in the new language.
      render() { if (dialog.open) render(); },
    };
  };
})(window.Gomoku = window.Gomoku || {});
