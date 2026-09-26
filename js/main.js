// App wiring: state, panels, keyboard and persistence.
(function (G) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const store = G.storage;
  const { t } = G.i18n;

  let settings = store.loadSettings(G.DEFAULT_SETTINGS, G.migrateSettings);
  const games = store.loadGames(); // id -> serialised game
  let game = null;
  let mode = 'play'; // 'play' | 'setup'

  const board = new G.BoardView($('#board'), onCell);

  // ---------- helpers ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function defaultName() {
    const date = new Date().toLocaleString(G.i18n.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return t('games.defaultName', { date });
  }

  // A move in the active coordinate system: "H8" on edge coordinates, "#37" with cell numbers.
  function moveText(id, g = game) {
    const n = g.nodes[id];
    return settings.coords === 'cell'
      ? `#${G.coords.spiral(g.size)[g.key(n.x, n.y)]}`
      : G.coords.label(n.x, n.y, g.size);
  }

  function playerName(p) {
    return t(`player.${settings.theme}${p}`);
  }

  // ---------- persistence ----------

  let saveTimer = 0;
  function persist() {
    games.set(game.id, game.toJSON());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
  }

  let warnedStorage = false;
  function flush() {
    clearTimeout(saveTimer);
    if (!store.saveGames(games) && !warnedStorage) {
      warnedStorage = true;
      toast(t('storage.failed'));
    }
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.hidden && flush());

  // Discards the current game from storage when it has no moves and no walls.
  function dropIfEmpty() {
    if (game && game.isEmpty()) games.delete(game.id);
  }

  function openGame(data) {
    game = data instanceof G.Game ? data : new G.Game(data);
    mode = 'play';
    store.setCurrent(game.id);
    persist();
    refresh();
  }

  // ---------- actions ----------

  function onCell(x, y) {
    if (mode === 'setup') {
      const r = game.toggleWall(x, y);
      if (r === 'blocked') {
        toast(t('setup.blocked'));
        return;
      }
    } else if (!game.play(x, y)) {
      return;
    }
    update();
  }

  function update() {
    persist();
    refresh();
  }

  function nav(fn) {
    if (fn()) update();
  }

  function setMode(m) {
    mode = m;
    refresh();
  }

  function deleteCurrentMove() {
    if (game.cur === 0) return;
    const n = game.nodes[game.cur];
    const after = countSubtree(game.cur) - 1;
    if (!confirm(t('moves.confirmDelete', { d: n.depth, move: moveText(game.cur), after }))) return;
    game.removeSubtree(game.cur);
    update();
  }

  function countSubtree(id) {
    let count = 0;
    const stack = [id];
    while (stack.length) {
      count++;
      stack.push(...game.nodes[stack.pop()].children);
    }
    return count;
  }

  // ---------- rendering ----------

  function refresh() {
    applyThemeVars();
    board.render(game, settings, mode);
    document.body.classList.toggle('setup', mode === 'setup');
    renderPlayPanel();
    renderHeader();
    if (!$('[data-panel="games"]').hidden) renderGameList();
  }

  function applyThemeVars() {
    const root = document.documentElement.style;
    const paper = settings.theme === 'paper';
    root.setProperty('--p0', paper ? settings.paper.xColor : '#151515');
    root.setProperty('--p1', paper ? settings.paper.oColor : '#f4f4f1');
    root.setProperty('--turn-bg', paper ? settings.paper.bg : settings.stone.bg);
  }

  function renderHeader() {
    const input = $('#gameName');
    if (document.activeElement !== input) input.value = game.name;
    $('#sizeTag').textContent = `${game.size} × ${game.size}`;
  }

  function renderPlayPanel() {
    const node = game.nodes[game.cur];
    const toMove = game.toMove();
    const line = game.line();

    $('#turnPiece').innerHTML = G.pieceIcon(toMove, settings);
    $('#turnLabel').textContent = mode === 'setup' ? t('turn.setup') : t('turn.toMove', { name: playerName(toMove) });
    $('#moveInfo').textContent = game.cur === 0
      ? (line.length ? t('info.start', { n: line.length }) : t('info.empty'))
      : t('info.after', { d: node.depth, n: line.length, move: moveText(game.cur) });

    for (const b of $$('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    $('#setupHelp').hidden = mode !== 'setup';
    $('#wallCount').textContent = t('setup.count', { n: game.walls.size });
    $('#clearWalls').disabled = !game.walls.size;

    $('#toStart').disabled = $('#back').disabled = game.cur === 0;
    $('#forward').disabled = $('#toEnd').disabled = !node.children.length;
    $('#deleteMove').disabled = game.cur === 0;

    // Branches from the current position
    const kids = node.children;
    $('#branchBlock').hidden = kids.length < 2;
    $('#branches').innerHTML = kids.length < 2 ? '' : kids.map((id, i) =>
      `<button data-goto="${id}" class="${id === node.pref ? 'on' : ''}"><b>${String.fromCharCode(97 + (i % 26))}</b> ${esc(moveText(id))}</button>`
    ).join('');

    // Alternatives to the move just played
    const sibs = game.cur ? game.nodes[node.parent].children : [];
    $('#altBlock').hidden = sibs.length < 2;
    $('#alternatives').innerHTML = sibs.length < 2 ? '' : sibs.map((id) =>
      `<button data-goto="${id}" class="${id === game.cur ? 'on' : ''}">${esc(moveText(id))}</button>`
    ).join('');

    // Move list of the current line
    const forks = line.filter((id) => game.nodes[game.nodes[id].parent].children.length > 1).length;
    $('#lineInfo').textContent = forks ? t('moves.forks', { n: forks }) : '';
    const items = [`<li class="start${game.cur === 0 ? ' current' : ''}"><button data-goto="0">${esc(t('moves.start'))}</button></li>`];
    for (const id of line) {
      const n = game.nodes[id];
      const cls = id === game.cur ? 'current' : n.depth > node.depth ? 'future' : 'past';
      const fork = game.nodes[n.parent].children.length > 1 ? `<span class="fork" title="${esc(t('moves.forkTitle'))}">⑂</span>` : '';
      items.push(`<li class="${cls}"><button data-goto="${id}"><span class="dot p${game.player(id)}"></span>${n.depth}. ${esc(moveText(id))}${fork}</button></li>`);
    }
    const list = $('#moveList');
    list.innerHTML = items.join('');
    // Keep the current move visible without scrolling the page itself.
    const current = list.querySelector('.current');
    if (current) {
      const top = current.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + current.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = top + current.offsetHeight - list.clientHeight;
      }
    }
  }

  function renderGameList() {
    const list = [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      $('#gameList').innerHTML = `<li class="empty">${esc(t('games.none'))}</li>`;
      return;
    }
    $('#gameList').innerHTML = list.map((g) => {
      const moves = Array.isArray(g.nodes) ? g.nodes.length : 0;
      const walls = Array.isArray(g.walls) ? g.walls.length : 0;
      const when = new Date(g.updatedAt).toLocaleString(G.i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
      const isCur = g.id === game.id;
      const name = g.name || t('games.untitled');
      const meta = [`${g.size}×${g.size}`, t('games.moves', { n: moves })];
      if (walls) meta.push(t('games.walls', { n: walls }));
      meta.push(when);
      return `<li class="${isCur ? 'current' : ''}">
        <div class="info">
          <div class="title">${esc(name)}</div>
          <div class="meta">${esc(meta.join(' · '))}</div>
        </div>
        ${isCur ? `<span class="tag">${esc(t('games.current'))}</span>` : `<button class="small" data-open="${esc(g.id)}">${esc(t('games.open'))}</button>`}
        <button class="small danger" data-delete="${esc(g.id)}" title="${esc(t('games.delete'))}" aria-label="${esc(`${t('games.delete')}: ${name}`)}">✕</button>
      </li>`;
    }).join('');
  }

  // ---------- settings ----------

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  }

  function syncSettingsUI() {
    for (const el of $$('[data-key]')) {
      const v = getPath(settings, el.dataset.key);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
    for (const b of $$('[data-set]')) {
      const [key, value] = b.dataset.set.split(':');
      const on = getPath(settings, key) === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const sec of $$('[data-for]')) sec.hidden = sec.dataset.for !== settings.theme;
    $('#coordsHelp').textContent = t(settings.coords === 'cell' ? 'coords.cellHelp' : 'coords.edgeHelp');
    renderSwatches();
    renderAllPicks();
    renderContrast();
  }

  // ---------- colour contrast (WCAG 2.2 AA) ----------

  const fmtRatio = (r) => (Math.floor(r * 10) / 10).toFixed(1); // round down so a failing ratio never reads as passing
  let lastFailing = null;

  // Badges each colour chip with its contrast, lists problems with a one-click fix, and toasts new problems.
  function renderContrast() {
    const items = G.contrast.audit(settings);
    const worst = new Map();
    for (const it of items) {
      const prev = worst.get(it.key);
      if (!prev || it.ratio / it.min < prev.ratio / prev.min) worst.set(it.key, it);
    }
    for (const chip of $$(`[data-for="${settings.theme}"] .color-chip`)) {
      const it = worst.get(chip.querySelector('input').dataset.key);
      let badge = chip.querySelector('.ratio');
      if (!badge) {
        badge = document.createElement('small');
        badge.className = 'ratio';
        chip.append(badge);
      }
      chip.classList.toggle('bad', !!it && !it.ok && !it.advisory);
      chip.classList.toggle('warn', !!it && !it.ok && it.advisory);
      badge.textContent = it ? `${it.ok ? '✓' : '⚠'} ${fmtRatio(it.ratio)}` : '';
      badge.title = it ? t('a11y.badge', { ratio: fmtRatio(it.ratio), min: it.min }) : '';
    }

    const problems = items.filter((it) => !it.ok);
    const onlyAdvice = problems.every((it) => it.advisory); // grid visibility is a recommendation, not WCAG
    const html = !problems.length
      ? `<p class="contrast-ok">✓ ${esc(t('a11y.ok'))}</p>`
      : `<p class="contrast-head${onlyAdvice ? ' advisory' : ''}">⚠ ${esc(t(onlyAdvice ? 'a11y.adviceTitle' : 'a11y.title'))}</p>` +
        `<ul class="${onlyAdvice ? 'advisory' : ''}">${problems.map((it) => {
        const detail = t(it.advisory ? 'a11y.issueAdvisory' : 'a11y.issue', { ratio: fmtRatio(it.ratio), min: it.min, sc: it.sc });
        const fix = it.suggestion
          ? `<button class="small" data-set="${it.key}:${it.suggestion}"><i style="background:${it.suggestion}"></i>${esc(
            t(it.key.endsWith('.bg') ? 'a11y.useBg' : 'a11y.use', { color: it.suggestion }))}</button>`
          : '';
        return `<li class="${it.advisory ? 'advisory' : ''}"><span><b>${esc(t(it.what))}</b> ${esc(detail)}</span>${fix}</li>`;
      }).join('')}</ul>`;
    for (const box of $$('.contrast-report')) box.innerHTML = html;

    // Alert only on problems a change just introduced (not on load, not repeatedly).
    const failing = problems.filter((it) => !it.advisory);
    if (lastFailing) {
      const fresh = failing.find((it) => !lastFailing.has(it.what));
      if (fresh) toast(t('a11y.toast', { what: t(fresh.what), ratio: fmtRatio(fresh.ratio) }));
    }
    lastFailing = new Set(failing.map((it) => it.what));
  }

  // Visual option cards (board theme, symbol style, stone style): each shows a live preview in the current colours.
  function renderPicks(container, key, options) {
    const current = getPath(settings, key);
    container.innerHTML = options.map(({ value, preview, label }) => {
      const on = current === value;
      return `<button data-set="${key}:${value}" class="pick${on ? ' on' : ''}" aria-pressed="${on}">` +
        `${preview}<span>${esc(label)}</span></button>`;
    }).join('');
  }

  function renderAllPicks() {
    renderPicks($('#themePicks'), 'theme', ['paper', 'stone'].map((th) => ({
      value: th, preview: G.themePreview(th, settings), label: t(`set.theme.${th}`),
    })));
    renderPicks($('#styleSwatches'), 'paper.style', G.SYMBOL_STYLES.map((st) => ({
      value: st, preview: G.symbolPreview(st, settings), label: t(`style.${st}`),
    })));
    renderPicks($('#stonePicks'), 'stone.style', ['glossy', 'flat'].map((st) => ({
      value: st, preview: G.stonePreview(st, settings), label: t(`stone.${st}`),
    })));
  }

  // Page theme: 'auto' follows the operating system and updates live when it changes.
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  function applyPageTheme() {
    const dark = settings.ui === 'dark' || (settings.ui === 'auto' && darkQuery.matches);
    document.documentElement.dataset.ui = dark ? 'dark' : 'light';
  }
  darkQuery.addEventListener('change', applyPageTheme);

  function applyLanguage() {
    G.i18n.setLang(settings.lang);
    G.i18n.apply();
    $('#langBtn').textContent = settings.lang === 'vi' ? 'VI' : 'EN';
    $('#focusBtn').textContent = t(document.body.classList.contains('focus') ? 'header.showPanel' : 'header.hidePanel');
  }

  // Preset buttons preview the preset itself (background, grid or lines, symbols or stones, in its own colours).
  // A preset counts as selected while every colour it sets still matches.
  function renderSwatches() {
    for (const theme of ['paper', 'stone']) {
      const cur = settings[theme];
      $(`#${theme}Swatches`).innerHTML = G.PRESETS[theme].map((p, i) => {
        const { name, ...values } = p;
        const on = Object.entries(values).every(([k, v]) => String(cur[k]).toLowerCase() === v);
        const preview = G.themePreview(theme, { ...settings, [theme]: { ...cur, ...values } });
        const label = esc(t(`preset.${name}`));
        return `<button data-preset="${theme}:${i}" class="${on ? 'on' : ''}" title="${label}" aria-label="${label}" aria-pressed="${on}">${preview}</button>`;
      }).join('');
    }
  }

  function settingsChanged() {
    store.saveSettings(settings);
    applyPageTheme();
    applyLanguage();
    syncSettingsUI();
    refresh();
  }

  for (const el of $$('[data-key]')) {
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      setPath(settings, el.dataset.key, el.type === 'checkbox' ? el.checked : el.value);
      settingsChanged();
    });
  }

  // Option buttons: data-set="path.in.settings:value" (static and rendered ones, hence delegation).
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    const [key, value] = b.dataset.set.split(':');
    setPath(settings, key, value);
    settingsChanged();
  });

  $('#langBtn').addEventListener('click', () => {
    settings.lang = settings.lang === 'vi' ? 'en' : 'vi';
    settingsChanged();
  });

  document.addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (!p) return;
    const [theme, i] = p.dataset.preset.split(':');
    const { name, ...values } = G.PRESETS[theme][Number(i)];
    Object.assign(settings[theme], values);
    settingsChanged();
  });

  $('#resetSettings').addEventListener('click', () => {
    if (!confirm(t('set.resetConfirm'))) return;
    settings = structuredClone(G.DEFAULT_SETTINGS);
    settingsChanged();
  });

  // ---------- new game dialog ----------

  const dlg = $('#newDialog');

  function openNewDialog() {
    $('#newName').value = defaultName();
    $('#newSize').value = [15, 19, 20].includes(game.size) ? String(game.size) : 'custom';
    $('#newCustom').value = game.size;
    $('#customRow').hidden = $('#newSize').value !== 'custom';
    $('#newKeepWalls').checked = false;
    updateKeepWalls();
    dlg.returnValue = '';
    dlg.showModal();
  }

  function chosenSize() {
    const v = $('#newSize').value;
    return v === 'custom' ? Number($('#newCustom').value) : Number(v);
  }

  function updateKeepWalls() {
    const box = $('#newKeepWalls');
    const ok = game.walls.size > 0 && chosenSize() === game.size;
    box.disabled = !ok;
    if (!ok) box.checked = false;
    $('#keepWallsNote').textContent = !game.walls.size
      ? t('new.noWalls')
      : ok ? t('games.walls', { n: game.walls.size }) : t('new.sameSize');
  }

  $('#newSize').addEventListener('change', () => {
    $('#customRow').hidden = $('#newSize').value !== 'custom';
    updateKeepWalls();
  });
  $('#newCustom').addEventListener('input', updateKeepWalls);

  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const size = chosenSize();
    if (!Number.isInteger(size) || size < G.Game.MIN_SIZE || size > G.Game.MAX_SIZE) {
      toast(t('new.badSize', { min: G.Game.MIN_SIZE, max: G.Game.MAX_SIZE }));
      return;
    }
    const next = G.Game.create(size, $('#newName').value.trim() || defaultName());
    if ($('#newKeepWalls').checked) {
      for (const k of game.walls) next.walls.add(k);
    }
    dropIfEmpty();
    openGame(next);
    toast(t('new.started', { size }));
  });

  // ---------- games tab ----------

  $('#gameList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-delete]');
    if (open) {
      const data = games.get(open.dataset.open);
      try {
        dropIfEmpty();
        openGame(data);
        selectTab('play');
      } catch (err) {
        toast(t('games.damaged'));
      }
    } else if (del) {
      const id = del.dataset.delete;
      const g = games.get(id);
      if (!g || !confirm(t('games.confirmDelete', { name: g.name || t('games.untitled') }))) return;
      games.delete(id);
      if (id === game.id) {
        const rest = [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        openGame(rest.length ? rest[0] : G.Game.create(15, defaultName()));
      }
      flush();
      renderGameList();
    }
  });

  $('#exportBtn').addEventListener('click', () => {
    flush();
    const data = { format: 'gomoku-board', version: 1, exportedAt: new Date().toISOString(), games: [...games.values()] };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gomoku-games-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      toast(t('import.badJson'));
      return;
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed.games) ? parsed.games : [parsed];
    let added = 0;
    let skipped = 0;
    for (const raw of list) {
      try {
        const g = new G.Game(raw).toJSON();
        const existing = games.get(g.id);
        if (existing && existing.updatedAt >= g.updatedAt) {
          skipped++;
          continue;
        }
        games.set(g.id, g);
        added++;
      } catch (err) {
        skipped++;
      }
    }
    flush();
    renderGameList();
    toast(t('import.done', { added, skipped }));
  });

  // ---------- tabs, buttons, keyboard ----------

  function selectTab(name) {
    for (const t of $$('[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
    for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== name;
    if (name === 'games') renderGameList();
  }

  for (const t of $$('[data-tab]')) t.addEventListener('click', () => selectTab(t.dataset.tab));
  for (const b of $$('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) nav(() => game.goTo(Number(b.dataset.goto)));
  });

  $('#toStart').addEventListener('click', () => nav(() => game.toStart()));
  $('#back').addEventListener('click', () => nav(() => game.back()));
  $('#forward').addEventListener('click', () => nav(() => game.forward()));
  $('#toEnd').addEventListener('click', () => nav(() => game.toEnd()));
  $('#newGame').addEventListener('click', openNewDialog);
  $('#deleteMove').addEventListener('click', deleteCurrentMove);
  $('#clearWalls').addEventListener('click', () => {
    if (confirm(t('setup.confirmClear', { n: game.walls.size })) && game.clearWalls()) update();
  });

  $('#gameName').addEventListener('input', (e) => {
    game.name = e.target.value.slice(0, 80);
    game.touch();
    persist();
  });
  $('#gameName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
  });

  function toggleFocus() {
    const on = document.body.classList.toggle('focus');
    $('#focusBtn').textContent = t(on ? 'header.showPanel' : 'header.hidePanel');
  }
  $('#focusBtn').addEventListener('click', toggleFocus);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || dlg.open) return;
    if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
    const actions = {
      ArrowLeft: () => nav(() => game.back()),
      ArrowRight: () => nav(() => game.forward()),
      ArrowUp: () => nav(() => game.sibling(-1)),
      ArrowDown: () => nav(() => game.sibling(1)),
      Home: () => nav(() => game.toStart()),
      End: () => nav(() => game.toEnd()),
      s: () => setMode(mode === 'setup' ? 'play' : 'setup'),
      n: openNewDialog,
      f: toggleFocus,
    };
    const act = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!act) return;
    e.preventDefault();
    act();
  });

  // ---------- start ----------

  function start() {
    applyPageTheme();
    applyLanguage();
    syncSettingsUI();
    const id = store.getCurrent();
    if (id && games.has(id)) {
      try {
        openGame(games.get(id));
        return;
      } catch (err) {
        console.warn('Saved game could not be opened', err);
      }
    }
    openGame(G.Game.create(15, defaultName()));
  }

  start();
})(window.Gomoku = window.Gomoku || {});
