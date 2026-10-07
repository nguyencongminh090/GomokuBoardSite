// Feature search bar (above the tabs): type a question, pick a result, the panel jumps to that control.
// The matching is G.search (js/search.js); this file holds the feature table and the UI.
(function (G) {
  'use strict';

  // Where each feature lives. `targets` are tried in order and the first visible one wins (a control can be hidden by
  // state, e.g. engine buttons before the engine is loaded). `before: 'setup'` switches to Setup mode first.
  // `where` labels a control outside the panel (default: the top bar).
  // Texts are the STRINGS keys `find.<id>`, `.d` (description) and `.k` (keywords).
  const FEATURES = [
    { id: 'cell', tab: 'play', targets: ['#cellInput'] },
    { id: 'voice', tab: 'play', targets: ['#micBtn', '#voiceSettings'] },
    { id: 'voicekey', tab: 'settings', targets: ['#groqKey', '#securityCard'] },
    { id: 'undo', tab: null, where: 'find.where.board', targets: ['#boardNav'] },
    { id: 'new', tab: 'play', targets: ['#newGame'] },
    { id: 'size', tab: 'play', targets: ['#newGame'] },
    { id: 'walls', tab: 'play', targets: ['[data-tool="wall"]'], before: 'setup' },
    { id: 'portals', tab: 'play', targets: ['[data-tool="portal"]'], before: 'setup' },
    { id: 'torus', tab: 'play', targets: ['#torusToggle'], before: 'setup' },
    { id: 'branches', tab: 'play', targets: ['#branchBlock', '#moveList'] },
    { id: 'deletemove', tab: 'play', targets: ['#deleteMove'] },
    { id: 'movelist', tab: 'play', targets: ['#moveList'] },
    { id: 'keys', tab: 'play', targets: ['.keys-details'] },
    { id: 'engine', tab: 'versus', targets: ['#versusCard'] },
    { id: 'engload', tab: 'analyze', targets: ['#engLoad'] },
    { id: 'enganalyze', tab: 'analyze', targets: ['#engAnalyze'] },
    { id: 'engresults', tab: 'analyze', targets: ['#engResults'] },
    { id: 'engstrength', tab: 'versus', targets: ['[data-set="engine.strength:50"]'] },
    { id: 'engstyle', tab: 'versus', targets: ['[data-set="engine.style:aggressive"]'] },
    { id: 'engrule', tab: 'versus', targets: ['[data-set="engine.rule:0"]'] },
    { id: 'engtime', tab: 'versus', targets: ['[data-key="engine.moveTime"]'] },
    { id: 'engthreads', tab: 'versus', targets: ['#engThreads'] },
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
  const WHERE = { play: 'find.where.play', versus: 'find.where.versus', analyze: 'find.where.analyze', games: 'find.where.games', settings: 'find.where.settings' };

  // deps: { t, esc, openTab(name), setMode(m), mode(), settings(), size(), apply(actions), voice }  (voice: createVoicePanel's API)
  G.createSearchPanel = function (deps) {
    const $ = (sel) => document.querySelector(sel);
    const { t, esc } = deps;
    const input = $('#searchInput');
    const ghost = $('#searchGhost');
    const dialog = $('#searchDialog');
    const list = $('#searchList');
    const clear = $('#searchClear');
    const mic = $('#searchMic');
    const voiceMsg = $('#searchVoice');
    const byId = new Map(FEATURES.map((f) => [f.id, f]));

    let index = null;
    let shown = []; // feature ids in the list, in order
    let active = -1;
    let completion = '';
    let gathered = false; // Enter on a small screen: the keyboard is closed and all matches are listed
    let commands = []; // actions parsed from the query (js/commands.js); one card at the top applies them all
    let hitTimer = 0;
    let dictation = null; // the running voice capture, if any

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
      const where = f.tab ? t(WHERE[f.tab]) : t(f.where || 'find.where.top');
      return `<div class="search-opt" role="option" id="searchOpt${i}" data-id="${id}" aria-selected="${i === active}">` +
        `<span class="search-opt-title">${highlight(t(`find.${id}`), hits)}</span>` +
        `<span class="search-opt-where">${esc(where)}</span>` +
        `<span class="search-opt-desc">${highlight(t(`find.${id}.d`), hits)}</span></div>`;
    }

    // The query with its misspelt words fixed, but only when the fixed text means something (a command or a feature).
    function autocorrect(text) {
      const fix = G.search.correct(index, text);
      if (!fix) return null;
      const ctx = { settings: deps.settings(), size: deps.size() };
      return G.commands.parse(fix, ctx).length || G.search.query(index, fix, { typing: false }).length ? fix : null;
    }

    // What an action does, in words: "Chế độ trang: Tối".
    function commandLabel(a) {
      if (a.type === 'newGame') return t('cmd.size', { n: a.size });
      if (a.type === 'preset') return t('cmd.preset', { name: t(`preset.${a.name}`) });
      if (a.type === 'error') return t(a.key, a.params);
      const v = a.valueKey ? t(a.valueKey) : typeof a.value === 'boolean' ? t(a.value ? 'cmd.on' : 'cmd.off') : a.text || String(a.value);
      return t('cmd.set', { name: t(`cmd.name.${a.id}`), v });
    }

    function commandCard() {
      const rows = commands.map((a) => {
        const bad = a.type === 'error';
        const note = a.same ? ` <span class="search-opt-where">${esc(t('cmd.already'))}</span>` : '';
        return `<li class="${bad ? 'cmd-bad' : ''}">${esc(commandLabel(a))}${note}</li>`;
      }).join('');
      const doable = commands.some((a) => !a.same && a.type !== 'error');
      return `<div class="search-head">${esc(t('cmd.head'))}</div>` +
        `<div class="search-opt search-cmd" role="option" id="searchOpt0" data-id="cmd" aria-selected="${active === 0}" aria-disabled="${!doable}">` +
        `<ul class="search-cmd-list">${rows}</ul>` +
        `${doable ? `<span class="search-opt-where">${esc(t('cmd.hint'))}</span>` : ''}</div>`;
    }

    function render() {
      if (!index) buildIndex();
      const text = input.value;
      const hasText = text.trim().length > 0;
      clear.hidden = !hasText;
      let results = hasText ? G.search.query(index, text) : [];
      let corrected = '';
      if (hasText && !results.length) { // auto-correct: show what the fixed spelling finds
        corrected = autocorrect(text) || '';
        if (corrected) results = G.search.query(index, corrected, { typing: false });
      }
      commands = hasText ? G.commands.parse(text, { settings: deps.settings(), size: deps.size() }) : [];
      const cmdRows = commands.length ? 1 : 0; // the card is option 0 and counts as one entry of `shown`
      let html = cmdRows ? commandCard() : '';
      if (hasText && results.length) {
        shown = [...(cmdRows ? ['cmd'] : []), ...results.map((r) => r.id)];
        active = Math.min(Math.max(active, 0), shown.length - 1);
        if (cmdRows) html = commandCard();
        if (gathered) html += `<div class="search-head">${esc(t('find.gathered', { n: results.length, q: corrected || text.trim() }))}</div>`;
        if (corrected) html += `<p class="search-msg">${esc(t('find.showingFor', { q: corrected }))}</p>`;
        html += results.map((r, i) => option(r.id, i + cmdRows, r.hits)).join('');
      } else if (cmdRows) {
        shown = ['cmd'];
        active = 0;
        html = commandCard();
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

    // Applies the parsed commands and closes the dialog; with nothing to do the dialog stays (the card says why).
    function runCommands() {
      if (!commands.some((a) => !a.same && a.type !== 'error')) return;
      dialog.close();
      deps.apply(commands);
    }

    function jump(id) {
      if (id === 'cmd') return runCommands();
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

    // Small screens: the on-screen keyboard hides the list, so Enter closes it and shows every match with its description.
    function canGather() {
      return !gathered && input.value.trim() && shown.length > 1 && (dialog.classList.contains('compact') || matchMedia('(pointer: coarse)').matches);
    }

    function setGathered(on) {
      if (gathered === on) return;
      gathered = on;
      dialog.classList.toggle('gathered', on);
      fit();
    }

    function gather() {
      active = -1;
      setGathered(true);
      input.blur();
      render();
      list.scrollTop = 0;
    }

    input.addEventListener('focus', () => { if (gathered) { setGathered(false); render(); } });
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = shown.length;
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        syncActive();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!commands.length) { // a misspelt command ("set bord 17x17"): show the corrected one first, a second Enter applies it
          const fix = input.value.trim() && autocorrect(input.value);
          if (fix && G.commands.parse(fix, { settings: deps.settings(), size: deps.size() }).length) {
            input.value = fix;
            active = 0;
            return render();
          }
        }
        if (canGather()) return gather();
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
    dialog.addEventListener('close', () => {
      setGathered(false);
      input.removeAttribute('aria-activedescendant');
      if (dictation) dictation.stop();
      say('');
    });
    $('#searchBtn').addEventListener('click', open);

    // ---------- fit to the visible screen ----------

    const MIN_BODY = 96; // search box + one option must stay visible above the on-screen keyboard
    const COMPACT_BELOW = 420; // visible height under which the hint line and option descriptions are dropped

    // The on-screen keyboard shrinks the visual viewport but not `vh`, so the box is placed and sized from the visual
    // viewport: it sits near the top, and when little room is left it moves up and hides the extras.
    function fit() {
      if (!dialog.open) return;
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      const top = (vv ? vv.offsetTop : 0) + Math.min(h * 0.1, Math.max(8, h - MIN_BODY - 130));
      dialog.style.marginTop = `${Math.round(top)}px`;
      dialog.style.maxHeight = `${Math.max(MIN_BODY + 52, Math.round(h - (top - (vv ? vv.offsetTop : 0)) - 8))}px`;
      dialog.classList.toggle('compact', h < COMPACT_BELOW && !gathered);
      if (active >= 0) syncActive();
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fit);
      window.visualViewport.addEventListener('scroll', fit);
    }
    window.addEventListener('resize', fit);

    // ---------- voice ----------

    function say(text) {
      voiceMsg.hidden = !text;
      voiceMsg.textContent = text;
    }

    function setMic(on) {
      mic.setAttribute('aria-pressed', String(on));
      mic.classList.toggle('on', on);
    }

    // Click to start, click again to stop (it also stops by itself after a few seconds). The transcript goes into the
    // box, spelling-corrected when needed, and is never applied without Enter.
    async function toggleMic() {
      if (dictation) return dictation.stop();
      say(t('find.listening'));
      let cap;
      try {
        cap = await deps.voice.dictate(deps.settings().lang);
      } catch (err) {
        return say(err.message);
      }
      dictation = cap;
      setMic(true);
      try {
        const heard = await cap.text;
        setMic(false);
        say(t('find.transcribing'));
        useTranscript(heard);
      } catch (err) {
        say(err.message);
      } finally {
        dictation = null;
        setMic(false);
      }
    }

    function useTranscript(heard) {
      const text = heard.replace(/[.!?。…]+$/, '').trim();
      if (!text) return say(t('voice.tooShort'));
      if (!index) buildIndex();
      const asIs = G.commands.parse(text, { settings: deps.settings(), size: deps.size() }).length;
      input.value = asIs ? text : autocorrect(text) || text;
      say(t('find.heard', { text }));
      active = 0;
      render();
      input.focus();
    }

    mic.addEventListener('click', toggleMic);

    function open() {
      setGathered(false);
      if (!dialog.open) dialog.showModal();
      mic.hidden = !deps.voice.supported;
      active = 0;
      fit();
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
