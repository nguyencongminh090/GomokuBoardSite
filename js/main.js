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
  let tab = 'play'; // the open panel: 'play' | 'analyze' | 'games' | 'settings' (the gear, no tab)
  let tool = 'wall'; // setup tool: 'wall' | 'portal'
  let pending = null; // first end of a portal pair, waiting for its partner

  const board = new G.BoardView($('#board'), onCell);

  const engine = G.createEnginePanel({
    game: () => game,
    settings: () => settings,
    mode: () => mode,
    tab: () => tab,
    view: () => settings.view,
    explainShown: () => explain.shown(),
    // Plays a stone for the side to move; `byHost` is false for the engine's own moves.
    play(x, y, byHost) {
      if (mode === 'play' && game.play(x, y)) update(byHost);
    },
    goTo: (id) => nav(() => game.goTo(id)),
    cellText: (x, y) => cellText(x, y),
    playerName: (p) => playerName(p),
    toast: (msg) => toast(msg),
    flush: () => flush(),
    board,
    authorize: () => security.authorizeEngine(),
  });

  const install = G.createInstallPrompt({ t, store });

  const explain = G.createExplainPanel({
    game: () => game,
    mode: () => mode,
    tab: () => tab,
    cellText: (x, y) => cellText(x, y),
    playerName: (p) => playerName(p),
    board,
  });

  const voice = G.createVoicePanel({
    game: () => game,
    mode: () => mode,
    settings: () => settings,
    // Same path as a click on the board: the engine treats it as a host move.
    play(x, y) {
      if (mode === 'play' && game.play(x, y)) update(true);
    },
    cellText: (x, y) => cellText(x, y),
    toast: (msg) => toast(msg),
    board,
  });

  const search = G.createSearchPanel({
    t,
    esc,
    openTab: (name) => openTab(name),
    setMode: (m) => setMode(m),
    mode: () => mode,
    settings: () => settings,
    size: () => game.size,
    apply: (actions) => applyCommands(actions),
    voice,
  });

  const security = G.createSecurityPanel({ esc, toast, settings: () => settings, engineStop: () => engine.unload() });

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

  // A cell in the active coordinate system: "H8" on edge coordinates, "#37" with cell numbers.
  function cellText(x, y, g = game) {
    return settings.coords === 'cell'
      ? `#${G.coords.numbers(g.size, settings.cellOrder)[g.key(x, y)]}`
      : G.coords.label(x, y, g.size);
  }

  function moveText(id, g = game) {
    const n = g.nodes[id];
    return cellText(n.x, n.y, g);
  }

  // The host's name for the player when one is set, else the symbol or colour (X / O, Black / White).
  function defaultPlayerName(p) {
    return t(`player.${settings.theme}${p}`);
  }

  function playerName(p) {
    return (game && game.players[p]) || defaultPlayerName(p);
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
    voice.cancel();
    game = data instanceof G.Game ? data : new G.Game(data);
    mode = 'play';
    pending = null;
    store.setCurrent(game.id);
    persist();
    refresh();
    engine.positionChanged(false);
  }

  // ---------- actions ----------

  function onCell(x, y) {
    if (mode === 'setup' && tool === 'portal') {
      onPortalCell(x, y);
      return;
    }
    if (mode === 'setup') {
      const r = game.toggleWall(x, y);
      if (r === 'blocked') {
        toast(t('setup.blocked'));
        return;
      }
      update();
      return;
    }
    if (game.play(x, y)) update(true);
  }

  // Portal tool: click a portal to remove its pair; otherwise click two free cells to make a pair.
  function onPortalCell(x, y) {
    const k = game.key(x, y);
    if (game.isPortal(k)) {
      pending = null;
      game.removePortal(k);
      update();
      return;
    }
    if (pending === null) {
      if (game.walls.has(k) || game.nodes.some((n, i) => i > 0 && n.x === x && n.y === y)) return toast(t('setup.portalBlocked'));
      if (!game.portalCellFree(k)) return toast(t('setup.portalNear', { d: G.Game.MIN_PORTAL_DISTANCE }));
      pending = k;
      update();
      return;
    }
    if (k === pending) {
      pending = null;
      update();
      return;
    }
    const problem = game.portalProblem(pending % game.size, Math.floor(pending / game.size), x, y);
    if (problem) {
      toast(t(problem === 'near' ? 'setup.portalNear' : 'setup.portalBlocked', { d: G.Game.MIN_PORTAL_DISTANCE }));
      return;
    }
    game.addPortal(pending % game.size, Math.floor(pending / game.size), x, y);
    pending = null;
    update();
  }

  // `played` marks a stone the host just placed, which is the engine's cue when it plays one side.
  function update(played = false) {
    persist();
    refresh();
    engine.positionChanged(played);
  }

  function nav(fn) {
    if (fn()) update();
  }

  function setMode(m) {
    mode = m;
    pending = null;
    refresh();
    engine.positionChanged(false);
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
    board.branch = null; // a branch preview belongs to the chips of the previous position
    board.tool = tool;
    board.pending = pending;
    // The threat map is an analysis aid: viewers of a livestream never see it.
    board.render(game, settings.view === 'live' ? { ...settings, threatMap: false } : settings, mode);
    document.body.classList.toggle('setup', mode === 'setup');
    renderPlayPanel();
    renderPlayers();
    renderHeader();
    engine.render();
    explain.positionChanged();
    explain.render();
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

  // Name cards beside the board: the side to move is highlighted. A field being typed in is left alone.
  function renderPlayers() {
    const toMove = game.toMove();
    for (const p of [0, 1]) {
      const input = $(`#playerName${p}`);
      input.placeholder = defaultPlayerName(p);
      input.setAttribute('aria-label', t('players.nameOf', { name: defaultPlayerName(p) }));
      if (document.activeElement !== input) input.value = game.players[p];
      $(`#playerPiece${p}`).innerHTML = G.pieceIcon(p, settings);
      input.closest('.player').classList.toggle('active', mode === 'play' && toMove === p);
    }
  }

  for (const p of [0, 1]) {
    const input = $(`#playerName${p}`);
    input.addEventListener('input', () => {
      game.players[p] = input.value.trim().slice(0, G.Game.MAX_PLAYER_NAME);
      persist();
      renderPlayPanel();
      engine.render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
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

    for (const b of $$('[data-mode]')) {
      b.classList.toggle('on', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }
    $('#setupHelp').hidden = mode !== 'setup';
    $('#wallCount').textContent = t('setup.count', { n: game.walls.size });
    $('#clearWalls').disabled = !game.walls.size;
    $('#portalCount').textContent = pending !== null ? t('setup.portalPending') : t('setup.portalCount', { n: game.portals.length });
    $('#clearPortals').disabled = !game.portals.length;
    $('#torusToggle').checked = game.torus;
    for (const b of $$('[data-tool]')) {
      b.classList.toggle('on', b.dataset.tool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    }
    $('#generateLabel').textContent = t(tool === 'wall' ? 'setup.genWallLabel' : 'setup.genPortalLabel');
    $('#generate').textContent = t('setup.generate');
    $('#setupWallHelp').hidden = tool !== 'wall';
    $('#setupPortalHelp').hidden = tool !== 'portal';

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

  let gameQuery = '';
  let gameSort = 'recent';
  let renamingId = null;
  const collapsedGroups = new Set(); // group names (not saved; groups start open)

  const icon = G.icons.svg;

  const SORTS = {
    recent: (a, b) => b.updatedAt - a.updatedAt,
    name: (a, b) => (a.name || '').localeCompare(b.name || '', G.i18n.locale, { numeric: true, sensitivity: 'base' }),
    moves: (a, b) => (b.nodes ? b.nodes.length : 0) - (a.nodes ? a.nodes.length : 0),
    size: (a, b) => b.size - a.size || b.updatedAt - a.updatedAt,
  };

  // Search ignores case and tone marks ("van" finds "Ván"); it matches the name and the two player names.
  const fold = (x) => G.search.fold(String(x || ''));

  function renderGameList() {
    const all = [...games.values()];
    const q = fold(gameQuery.trim());
    const list = all
      .filter((g) => !q || fold([g.name, g.group, ...(g.players || [])].join(' ')).includes(q))
      .sort((a, b) => SORTS[gameSort](a, b) || b.updatedAt - a.updatedAt);
    $('#gamesCount').textContent = all.length ? t('games.count', { shown: list.length, total: all.length }) : '';
    $('#clearGames').disabled = !all.length;
    if (!list.length) {
      $('#gameList').innerHTML = `<li class="empty">${esc(t(all.length ? 'games.noMatch' : 'games.none'))}</li>`;
      return;
    }
    const item = (g) => {
      const moves = Array.isArray(g.nodes) ? g.nodes.length : 0;
      const walls = Array.isArray(g.walls) ? g.walls.length : 0;
      const when = new Date(g.updatedAt).toLocaleString(G.i18n.locale, { dateStyle: 'medium', timeStyle: 'short' });
      const isCur = g.id === game.id;
      const name = g.name || t('games.untitled');
      const meta = [`${g.size}×${g.size}`, t('games.moves', { n: moves })];
      if (walls) meta.push(t('games.walls', { n: walls }));
      const portals = Array.isArray(g.portals) ? g.portals.length : 0;
      if (portals) meta.push(t('games.portals', { n: portals }));
      if (g.torus === true) meta.push(t('games.torus'));
      meta.push(when);
      let thumb = '';
      try {
        thumb = G.gamePreview(g, settings);
      } catch (err) {
        thumb = ''; // a damaged record still lists, so it can be deleted
      }
      const title = renamingId === g.id
        ? `<input class="title-edit" data-rename-input="${esc(g.id)}" maxlength="80" spellcheck="false" value="${esc(g.name)}" aria-label="${esc(t('games.rename'))}">`
        : `<div class="title" data-rename="${esc(g.id)}" title="${esc(t('games.rename'))}">${esc(name)}</div>`;
      const players = g.players && g.players.some(Boolean) ? `<div class="meta">${esc(g.players.filter(Boolean).join(' vs '))}</div>` : '';
      return `<li class="${isCur ? 'current' : ''}" data-game-id="${esc(g.id)}"${renamingId === g.id ? '' : ' draggable="true"'}>
        <button class="thumb" data-open="${esc(g.id)}" tabindex="-1" aria-hidden="true">${thumb}</button>
        <div class="info">
          ${title}${players}
          <div class="meta">${esc(meta.join(' · '))}</div>
        </div>
        <div class="acts">
          ${isCur ? `<span class="tag">${esc(t('games.current'))}</span>` : `<button class="small" data-open="${esc(g.id)}">${esc(t('games.open'))}</button>`}
          <button class="small icon-only" data-group-game="${esc(g.id)}" title="${esc(t('group.set'))}" aria-label="${esc(`${t('group.set')}: ${name}`)}">${icon('folder')}</button>
          <button class="small icon-only" data-rename="${esc(g.id)}" title="${esc(t('games.rename'))}" aria-label="${esc(`${t('games.rename')}: ${name}`)}">${icon('pencil')}</button>
          <button class="small danger icon-only" data-delete="${esc(g.id)}" title="${esc(t('games.delete'))}" aria-label="${esc(`${t('games.delete')}: ${name}`)}">${icon('trash')}</button>
        </div>
      </li>`;
    };

    // With no group anywhere the list stays flat; otherwise each group gets a collapsible header, ungrouped games last.
    const byGroup = new Map();
    for (const g of list) {
      const key = g.group || '';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(g);
    }
    if (!byGroup.size || (byGroup.size === 1 && byGroup.has(''))) {
      $('#gameList').innerHTML = list.map(item).join('');
    } else {
      const names = [...byGroup.keys()].filter(Boolean)
        .sort((a, b) => a.localeCompare(b, G.i18n.locale, { numeric: true, sensitivity: 'base' }));
      if (byGroup.has('')) names.push('');
      $('#gameList').innerHTML = names.map((name) => {
        const members = byGroup.get(name);
        const open = !!q || !collapsedGroups.has(name); // a search always shows its matches
        const label = name || t('group.none');
        const total = all.filter((g) => (g.group || '') === name).length;
        return `<li class="group-head" data-drop-group="${esc(name)}">
          <button class="group-toggle" data-group-toggle="${esc(name)}" aria-expanded="${open}">
            ${icon(open ? 'down' : 'right')}<span class="group-label">${esc(label)}</span>
          </button>
          <span class="meta">${esc(t('games.count', { shown: members.length, total }))}</span>
          ${name ? `<button class="small icon-only" data-group-rename="${esc(name)}" title="${esc(t('group.rename'))}" aria-label="${esc(`${t('group.rename')}: ${name}`)}">${icon('pencil')}</button>` : ''}
        </li>${open ? members.map(item).join('') : ''}`;
      }).join('');
    }
    const edit = $('#gameList [data-rename-input]');
    if (edit) {
      edit.focus();
      edit.select();
    }
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
      const on = String(getPath(settings, key)) === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const sec of $$('[data-for]')) sec.hidden = sec.dataset.for !== settings.theme;
    $('#coordsHelp').textContent = t(settings.coords === 'cell'
      ? (settings.cellOrder === 'sequence' ? 'coords.sequenceHelp' : 'coords.cellHelp')
      : 'coords.edgeHelp');
    $('#cellOrderRow').hidden = settings.coords !== 'cell';
    renderSwatches();
    renderAllPicks();
    renderContrast();
    security.render();
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
    renderFocusBtn();
    install.refresh();
    voice.renderKey();
    search.render();
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

  const ENGINE_TABS = ['versus', 'analyze'];

  // The Analyse view is for key holders: it proves the private key (see security-panel.js) once per page load, and until
  // then the app stays in Live. A failed check puts the setting back to Live.
  let unlocked = false;
  let unlocking = false;
  let pendingTab = null;

  function requireKey() {
    if (unlocking) return;
    unlocking = true;
    security.authorizeEngine().then((ok) => {
      unlocking = false;
      const open = pendingTab;
      pendingTab = null;
      if (ok) {
        unlocked = true;
        applyView();
        if (open) selectTab(open);
      } else {
        settings.view = 'live';
        store.saveSettings(settings);
        applyView();
        syncSettingsUI();
      }
    });
  }

  // Live shows board controls only; Analyse view adds the engine tabs and a wider panel (css/style.css).
  function applyView() {
    if (settings.view === 'analyze' && !unlocked) requireKey();
    const live = settings.view === 'live' || !unlocked;
    document.body.classList.toggle('view-live', live);
    document.body.classList.toggle('view-analyze', !live);
    if (live && ENGINE_TABS.includes(tab)) selectTab('play');
  }

  function settingsChanged() {
    store.saveSettings(settings);
    applyPageTheme();
    applyLanguage();
    applyView();
    syncSettingsUI();
    refresh();
    engine.settingsChanged();
  }

  // A control's value in the type its setting has. Number fields are clamped to their min/max;
  // an empty or invalid one returns undefined and is reset to the current setting.
  function controlValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type !== 'number') return el.value;
    const v = Number(el.value);
    if (el.value.trim() === '' || !Number.isFinite(v)) return undefined;
    return Math.min(Number(el.max), Math.max(Number(el.min), v));
  }

  for (const el of $$('[data-key]')) {
    // Number fields commit on change (blur or Enter), so a half-typed value is never applied.
    el.addEventListener(el.type === 'checkbox' || el.type === 'number' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      const v = controlValue(el);
      if (v !== undefined) setPath(settings, el.dataset.key, v);
      settingsChanged();
    });
  }

  // Option buttons: data-set="path.in.settings:value" (static and rendered ones, hence delegation).
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set]');
    if (!b) return;
    const [key, value] = b.dataset.set.split(':');
    setPath(settings, key, typeof getPath(settings, key) === 'number' ? Number(value) : value);
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
    const count = game.walls.size + game.portals.length;
    const ok = count > 0 && chosenSize() === game.size;
    box.disabled = !ok;
    if (!ok) box.checked = false;
    $('#keepWallsNote').textContent = !count
      ? t('new.noWalls')
      : ok ? [game.walls.size && t('games.walls', { n: game.walls.size }), game.portals.length && t('games.portals', { n: game.portals.length })].filter(Boolean).join(', ') : t('new.sameSize');
  }

  $('#newSize').addEventListener('change', () => {
    $('#customRow').hidden = $('#newSize').value !== 'custom';
    updateKeepWalls();
  });
  $('#newCustom').addEventListener('input', updateKeepWalls);

  $('#newCancel').addEventListener('click', () => dlg.close('cancel'));

  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const size = chosenSize();
    if (!Number.isInteger(size) || size < G.Game.MIN_SIZE || size > G.Game.MAX_SIZE) {
      toast(t('new.badSize', { min: G.Game.MIN_SIZE, max: G.Game.MAX_SIZE }));
      return;
    }
    startGame(size, $('#newName').value.trim() || defaultName(), $('#newKeepWalls').checked);
  });

  // An empty game of `size`; the names carry over, and so do walls, portals and torus when `keep` (same size only).
  function startGame(size, name, keep) {
    const next = G.Game.create(size, name);
    next.players = [...game.players]; // the same two people usually play the next game
    if (keep) {
      for (const k of game.walls) next.walls.add(k);
      next.torus = game.torus;
      next.portals = game.portals.map((p) => [...p]);
    }
    dropIfEmpty();
    openGame(next);
    toast(t('new.started', { size }));
  }

  // Search-bar commands (js/commands.js): `actions` come from G.commands.parse. Returns how many changed something.
  function applyCommands(actions) {
    let n = 0;
    let size = 0;
    for (const a of actions) {
      if (a.same || a.type === 'error') continue;
      n++;
      if (a.type === 'set') setPath(settings, a.path, a.value);
      else if (a.type === 'preset') {
        const { name, ...values } = G.PRESETS[a.theme][a.index];
        settings.theme = a.theme;
        Object.assign(settings[a.theme], values);
      } else if (a.type === 'newGame') size = a.size;
    }
    if (n) settingsChanged();
    if (size) startGame(size, defaultName(), false);
    else if (n) toast(t('cmd.done', { n }));
    return n;
  }

  // ---------- games tab ----------

  $('#gameList').addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    const del = e.target.closest('[data-delete]');
    const ren = e.target.closest('[data-rename]');
    const grp = e.target.closest('[data-group-game]');
    const grpRen = e.target.closest('[data-group-rename]');
    const grpTog = e.target.closest('[data-group-toggle]');
    if (grp) {
      openGroupDialog({ ids: [grp.dataset.groupGame] });
    } else if (grpRen) {
      openGroupDialog({ rename: grpRen.dataset.groupRename });
    } else if (grpTog) {
      const name = grpTog.dataset.groupToggle;
      if (!collapsedGroups.delete(name)) collapsedGroups.add(name);
      renderGameList();
    } else if (ren) {
      renamingId = ren.dataset.rename;
      renderGameList();
    } else if (open) {
      const data = games.get(open.dataset.open);
      try {
        const next = new G.Game(data);
        dropIfEmpty();
        openGame(next);
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

  // Groups: a game has at most one optional group name (`game.group`). The dialog files one game (`{ id }`) or renames
  // a whole group (`{ rename }`; an empty name dissolves it and its games become ungrouped).
  const groupDlg = $('#groupDialog');
  let groupCtx = null;

  function groupNames() {
    return [...new Set([...games.values()].map((g) => g.group).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, G.i18n.locale, { numeric: true, sensitivity: 'base' }));
  }

  function openGroupDialog(ctx) {
    groupCtx = ctx;
    const members = (ctx.ids || []).map((id) => games.get(id)).filter(Boolean);
    if (ctx.ids && !members.length) return;
    const g = members[0];
    $('#groupTitle').textContent = t(ctx.ids ? 'group.set' : 'group.rename');
    $('#groupNote').textContent = members.map((m) => m.name || t('games.untitled')).join(' · ');
    $('#groupName').value = ctx.ids ? (members.length === 1 ? g.group || '' : '') : ctx.rename;
    $('#groupOptions').innerHTML = groupNames().map((n) => `<option value="${esc(n)}">`).join('');
    const remove = $('#groupRemove');
    remove.textContent = t(ctx.ids ? 'group.remove' : 'group.dissolve');
    remove.hidden = ctx.ids ? !members.some((m) => m.group) : false;
    groupDlg.showModal();
    $('#groupName').select();
  }
  $('#groupCancel').addEventListener('click', () => groupDlg.close());
  $('#groupRemove').addEventListener('click', () => groupDlg.close('remove'));

  // Grouping is bookkeeping, so it does not change `updatedAt` (the "newest" order stays put).
  function setGroup(id, name) {
    const g = games.get(id);
    if (!g) return;
    if (name) g.group = name;
    else delete g.group;
    if (id === game.id) game.group = name;
  }

  groupDlg.addEventListener('close', () => {
    const ctx = groupCtx;
    groupCtx = null;
    if (!ctx || !['ok', 'remove'].includes(groupDlg.returnValue)) return;
    const name = groupDlg.returnValue === 'remove' ? '' : $('#groupName').value.trim().slice(0, G.Game.MAX_GROUP_NAME);
    if (ctx.ids) for (const id of ctx.ids) setGroup(id, name);
    else for (const g of [...games.values()]) if (g.group === ctx.rename) setGroup(g.id, name);
    if (ctx.rename !== undefined) {
      if (collapsedGroups.delete(ctx.rename) && name) collapsedGroups.add(name);
    }
    flush();
    renderGameList();
  });

  // Drag a game onto a group header (or onto a game in a group) to file it there, onto "Ungrouped" to free it, or onto
  // another ungrouped game to start a new group with both (the dialog asks for its name). Mouse only: touch has no HTML5 drag.
  const list = $('#gameList');
  let dragId = null;
  const dropTarget = (e) => e.target.closest('li[data-drop-group], li[data-game-id]');
  const targetGroup = (li) => (li.dataset.dropGroup !== undefined ? li.dataset.dropGroup : (games.get(li.dataset.gameId) || {}).group || '');
  const clearDrop = () => list.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));

  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest ? e.target.closest('li[data-game-id]') : null;
    if (!li) return;
    dragId = li.dataset.gameId;
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.effectAllowed = 'move';
    li.classList.add('dragging');
  });
  list.addEventListener('dragover', (e) => {
    const li = dropTarget(e);
    if (!dragId || !li || li.dataset.gameId === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDrop();
    li.classList.add('drop-target');
  });
  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) clearDrop();
  });
  list.addEventListener('dragend', () => {
    dragId = null;
    clearDrop();
    list.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  });
  // Drop game `id` on list item `li`.
  function dropGame(id, li) {
    const group = targetGroup(li);
    if (!group && li.dataset.gameId) { // onto a loose game: name a new group for both
      openGroupDialog({ ids: [id, li.dataset.gameId] });
      return;
    }
    const g = games.get(id);
    if (!g || (g.group || '') === group) return;
    setGroup(id, group);
    flush();
    renderGameList();
  }
  list.addEventListener('drop', (e) => {
    const li = dropTarget(e);
    const id = dragId;
    if (!id || !li || li.dataset.gameId === id) return;
    e.preventDefault();
    dragId = null;
    clearDrop();
    dropGame(id, li);
  });

  // Touch has no HTML5 drag, so a long press picks a game up (a normal swipe still scrolls) and a ghost follows the finger.
  const HOLD_MS = 350;
  const HOLD_SLOP = 8;
  let touch = null; // { id, x, y, timer, ghost, over }
  const endTouch = () => {
    if (!touch) return;
    clearTimeout(touch.timer);
    if (touch.ghost) touch.ghost.remove();
    clearDrop();
    list.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    touch = null;
  };
  const overItem = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const li = el && el.closest ? el.closest('#gameList li[data-drop-group], #gameList li[data-game-id]') : null;
    return li && li.dataset.gameId !== touch.id ? li : null;
  };

  list.addEventListener('dragstart', (e) => {
    if (touch) e.preventDefault(); // a long press must not also start the browser's own drag
  }, true);
  list.addEventListener('contextmenu', (e) => {
    if (touch) e.preventDefault();
  });
  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target.closest('button:not(.thumb), input')) return;
    const li = e.target.closest('li[data-game-id]');
    if (!li || renamingId) return;
    endTouch();
    touch = { id: li.dataset.gameId, x: e.clientX, y: e.clientY, ghost: null, over: null };
    touch.timer = setTimeout(() => {
      const label = li.querySelector('.title');
      touch.ghost = document.createElement('div');
      touch.ghost.className = 'drag-ghost';
      touch.ghost.textContent = label ? label.textContent : '';
      document.body.append(touch.ghost);
      touch.ghost.style.left = `${touch.x}px`;
      touch.ghost.style.top = `${touch.y}px`;
      li.classList.add('dragging');
      if (navigator.vibrate) navigator.vibrate(15);
    }, HOLD_MS);
  });
  list.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerType !== 'touch') return;
    if (!touch.ghost) { // moved before the hold finished: the person is scrolling
      if (Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > HOLD_SLOP) endTouch();
      return;
    }
    touch.x = e.clientX;
    touch.y = e.clientY;
    touch.ghost.style.left = `${e.clientX}px`;
    touch.ghost.style.top = `${e.clientY}px`;
    clearDrop();
    touch.over = overItem(e.clientX, e.clientY);
    if (touch.over) touch.over.classList.add('drop-target');
  });
  // While a game is held, the finger moves the ghost instead of scrolling the page.
  list.addEventListener('touchmove', (e) => {
    if (touch && touch.ghost) e.preventDefault();
  }, { passive: false });
  list.addEventListener('pointerup', (e) => {
    if (!touch || e.pointerType !== 'touch') return;
    const { id, ghost } = touch;
    const li = ghost ? overItem(e.clientX, e.clientY) : null;
    endTouch();
    if (li) dropGame(id, li);
  });
  list.addEventListener('pointercancel', endTouch);

  // Renaming: Enter or leaving the field saves, Escape cancels. The open game's name field in the top bar follows.
  function finishRename(input, save) {
    const id = input.dataset.renameInput;
    if (renamingId !== id) return;
    renamingId = null;
    const g = games.get(id);
    const name = input.value.trim().slice(0, 80);
    if (save && g && name !== g.name) {
      if (id === game.id) {
        game.name = name;
        game.touch();
        persist();
        renderHeader();
      } else {
        g.name = name;
        g.updatedAt = Date.now();
      }
      flush();
    }
    renderGameList();
  }
  $('#gameList').addEventListener('keydown', (e) => {
    if (!e.target.matches('[data-rename-input]')) return;
    if (e.key === 'Enter') finishRename(e.target, true);
    else if (e.key === 'Escape') finishRename(e.target, false);
  });
  $('#gameList').addEventListener('focusout', (e) => {
    if (e.target.matches('[data-rename-input]') && renamingId) finishRename(e.target, true);
  });

  $('#gameSearch').addEventListener('input', (e) => {
    gameQuery = e.target.value;
    renderGameList();
  });
  $('#gameSort').addEventListener('change', (e) => {
    gameSort = e.target.value;
    renderGameList();
  });

  // Expand: the panel grows over most of the page and the games become a grid of large position thumbnails.
  $('#gamesExpand').addEventListener('click', () => {
    const on = !document.body.classList.contains('games-wide');
    document.body.classList.toggle('games-wide', on);
    $('#gamesExpand').setAttribute('aria-pressed', String(on));
  });

  // Clean all: every saved game, including the open one, is removed and a fresh empty game of the same size starts.
  $('#clearGames').addEventListener('click', () => {
    if (!games.size || !confirm(t('games.confirmClear', { n: games.size }))) return;
    games.clear();
    openGame(G.Game.create(game.size, defaultName()));
    flush();
    renderGameList();
    toast(t('games.cleared'));
  });

  $('#exportBtn').addEventListener('click', async () => {
    flush();
    const body = { format: 'gomoku-board', version: 1, exportedAt: new Date().toISOString(), games: [...games.values()] };
    const data = await security.signExport(body);
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gomoku-games-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Import dialog: a file exported by this site, or a link to a game on another site (js/importers.js).
  const importDlg = $('#importDialog');
  // Sites that send no CORS headers are fetched through the engine gate's Worker (same address as the engine gate).
  const gateMeta = document.querySelector('meta[name="engine-gate"]');
  G.importers.config.proxy = gateMeta ? gateMeta.content.trim().replace(/\/+$/, '') : '';
  const importStatus = (msg) => { $('#importStatus').textContent = msg; };
  $('#importBtn').addEventListener('click', () => {
    $('#importSites').textContent = t('import.sites', { names: G.importers.SITES.map((s) => s.name).join(', ') });
    importStatus('');
    importDlg.showModal();
  });
  $('#importClose').addEventListener('click', () => importDlg.close());

  async function importLink() {
    const input = $('#importLink');
    const go = $('#importLinkGo');
    if (!input.value.trim() || go.disabled) return;
    go.disabled = true;
    importStatus(t('import.loading'));
    try {
      const { game: raw } = await G.importers.fromLink(input.value);
      const g = new G.Game(raw).toJSON();
      if (games.has(g.id)) {
        importStatus(t('import.linkExists'));
        return;
      }
      games.set(g.id, g);
      flush();
      renderGameList();
      importDlg.close();
      dropIfEmpty();
      openGame(g);
      input.value = '';
      toast(t('import.linkDone', { name: g.name }));
    } catch (err) {
      importStatus(t(`import.err.${['link', 'network', 'notFound', 'badData', 'blocked'].includes(err.code) ? err.code : 'badData'}`, { url: err.url }));
    } finally {
      go.disabled = false;
    }
  }
  $('#importLinkGo').addEventListener('click', importLink);

  // Paste: read the clipboard into the box and import at once when it holds a link we support.
  $('#importPaste').addEventListener('click', async () => {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()).trim();
    } catch (err) {
      importStatus(t('import.err.clipboard'));
      return;
    }
    if (!text) {
      importStatus(t('import.err.empty'));
      return;
    }
    $('#importLink').value = text;
    if (G.importers.recognises(text)) importLink();
    else importStatus(t('import.err.link'));
  });
  $('#importLink').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); importLink(); }
  });

  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    importDlg.close();
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      toast(t('import.badJson'));
      return;
    }
    const check = await security.verifyImport(parsed);
    if (!check.ok) {
      toast(check.note);
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
        if (game && g.id === game.id) openGame(g);
        added++;
      } catch (err) {
        skipped++;
      }
    }
    flush();
    renderGameList();
    toast(`${t('import.done', { added, skipped })} ${check.note}`.trim());
  });

  // ---------- tabs, buttons, keyboard ----------

  function selectTab(name) {
    if (ENGINE_TABS.includes(name) && !unlocked) {
      pendingTab = name;
      requireKey();
      return;
    }
    tab = name;
    for (const t of $$('[data-tab]')) {
      t.setAttribute('aria-selected', String(t.dataset.tab === name));
      if (t.dataset.tab === name) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== name;
    $('#settingsBtn').setAttribute('aria-pressed', String(name === 'settings'));
    document.body.classList.toggle('on-games', name === 'games');
    if (name === 'games') renderGameList();
    explain.render();
    engine.render();
  }

  // The gear opens Settings (and About) in the panel; pressing it again returns to the tab that was open.
  let tabBeforeSettings = 'play';
  $('#settingsBtn').addEventListener('click', () => {
    if (tab === 'settings') return selectTab(tabBeforeSettings);
    tabBeforeSettings = tab;
    if (document.body.classList.contains('focus')) toggleFocus();
    selectTab('settings');
  });
  // An engine tab is only visible in the Analyse view: switch to it first when something jumps there from Live.
  function revealTab(name) {
    if (!ENGINE_TABS.includes(name) || settings.view === 'analyze') return;
    settings.view = 'analyze';
    store.saveSettings(settings);
    applyView();
    syncSettingsUI();
  }

  // Opens a panel from code (search jumps): the side panel is shown again if it was hidden.
  function openTab(name) {
    if (name === 'settings' && tab !== 'settings') tabBeforeSettings = tab;
    revealTab(name);
    if (document.body.classList.contains('focus')) toggleFocus();
    selectTab(name);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto-tab]');
    if (!b) return;
    revealTab(b.dataset.gotoTab);
    selectTab(b.dataset.gotoTab);
  });

  for (const t of $$('[data-tab]')) t.addEventListener('click', () => selectTab(t.dataset.tab));

  // The tab strip scrolls when it does not fit: fade the overflowing edges and let the wheel scroll it sideways.
  const tabsNav = $('.tabs');
  function updateTabEdges() {
    const max = tabsNav.scrollWidth - tabsNav.clientWidth;
    tabsNav.classList.toggle('more-start', tabsNav.scrollLeft > 1);
    tabsNav.classList.toggle('more-end', tabsNav.scrollLeft < max - 1);
  }
  tabsNav.addEventListener('scroll', updateTabEdges, { passive: true });
  tabsNav.addEventListener('wheel', (e) => {
    if (e.deltaY && !e.deltaX && tabsNav.scrollWidth > tabsNav.clientWidth) {
      tabsNav.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  new ResizeObserver(updateTabEdges).observe(tabsNav);
  for (const b of $$('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-goto]');
    if (b) nav(() => game.goTo(Number(b.dataset.goto)));
  });

  // Hovering (or focusing) a branch chip previews that variation on the board: the chip's move and the line Forward
  // would follow from it, numbered with the real move numbers. An alternative to the current move fades that stone out.
  function previewBranch(id) {
    if (id === game.cur) id = game.nodes[id].children.length ? game.nextOf(id) : -1;
    if (id < 0) return board.setBranch(null);
    const ids = [id];
    while (game.nodes[ids[ids.length - 1]].children.length) ids.push(game.nextOf(ids[ids.length - 1]));
    const n = game.nodes[id];
    const cur = game.nodes[game.cur];
    const hide = game.cur && n.parent === cur.parent ? [cur.x, cur.y] : null;
    board.setBranch({ line: ids.map((i) => [game.nodes[i].x, game.nodes[i].y]), first: game.player(id), from: n.depth - 1, mark: 0, hide });
  }
  for (const box of [$('#branches'), $('#alternatives')]) {
    const show = (e) => {
      const b = e.target.closest('[data-goto]');
      if (b) previewBranch(Number(b.dataset.goto));
    };
    const hide = (e) => {
      if (!e.relatedTarget || !box.contains(e.relatedTarget)) board.setBranch(null);
    };
    box.addEventListener('pointerover', show);
    box.addEventListener('focusin', show);
    box.addEventListener('pointerout', hide);
    box.addEventListener('focusout', hide);
  }

  $('#toStart').addEventListener('click', () => nav(() => game.toStart()));
  $('#back').addEventListener('click', () => nav(() => game.back()));
  $('#forward').addEventListener('click', () => nav(() => game.forward()));
  $('#toEnd').addEventListener('click', () => nav(() => game.toEnd()));
  $('#newGame').addEventListener('click', openNewDialog);
  $('#deleteMove').addEventListener('click', deleteCurrentMove);
  for (const b of $$('[data-tool]')) {
    b.addEventListener('click', () => {
      tool = b.dataset.tool;
      pending = null;
      refresh();
    });
  }
  $('#torusToggle').addEventListener('change', (e) => {
    if (!game.setTorus(e.target.checked)) toast(t('setup.torusNear', { d: G.Game.MIN_PORTAL_DISTANCE }));
    pending = null;
    update();
  });
  $('#generate').addEventListener('click', () => {
    const input = $('#generateCount');
    const n = Math.min(99, Math.max(1, Math.floor(Number(input.value)) || 1));
    input.value = n;
    const added = tool === 'wall' ? game.generateWalls(n) : game.generatePortals(n);
    pending = null;
    if (added < n) toast(t(tool === 'wall' ? 'setup.genWallShort' : 'setup.genPortalShort', { n: added, d: G.Game.MIN_GENERATED_GAP }));
    update();
  });
  $('#clearPortals').addEventListener('click', () => {
    if (confirm(t('setup.confirmClearPortals', { n: game.portals.length })) && game.clearPortals()) {
      pending = null;
      update();
    }
  });
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

  // The button is an icon: its name (hide or show) lives in aria-label.
  function renderFocusBtn() {
    const on = document.body.classList.contains('focus');
    $('#focusBtn').setAttribute('aria-label', t(on ? 'header.showPanel' : 'header.hidePanel'));
    $('#focusBtn').setAttribute('aria-pressed', String(on));
  }

  function toggleFocus() {
    document.body.classList.toggle('focus');
    renderFocusBtn();
  }
  $('#focusBtn').addEventListener('click', toggleFocus);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && !dlg.open) {
      e.preventDefault();
      return search.open();
    }
    if (e.ctrlKey || e.metaKey || e.altKey || dlg.open) return;
    if (e.target instanceof Element && e.target.closest('input, select, textarea, button, [role="tab"]')) return;
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
      '/': search.open,
      a: () => engine.toggleAnalysis(),
      e: () => engine.engineMove(),
    };
    const act = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!act) return;
    e.preventDefault();
    act();
  });

  // ---------- start ----------

  function start() {
    $('#appVersion').textContent = t('app.version', { v: G.VERSION || '–' });
    $('#aboutVersion').textContent = G.VERSION;
    applyPageTheme();
    applyLanguage();
    applyView();
    syncSettingsUI();
    openInitialGame();
    engine.start();
    registerServiceWorker();
    install.start();
    voice.start();
    // Harden against console tampering: the security API and engine client can no longer be patched in place.
    for (const o of [G.security, G.EngineClient, G.EngineClient.prototype, G]) Object.freeze(o);
  }

  // The worker makes the page installable and offline-capable and adds the isolation headers the engine
  // threads need. Its URL carries the release version, so each release installs a fresh cache.
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register(G.serviceWorkerUrl).catch((err) => console.warn('Service worker unavailable', err));
    // The worker's URL carries the release version, so only a reload can pick up a new release. An installed app is
    // rarely reloaded by hand: when it comes back to the front, compare with the published page and reload if newer.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || !G.VERSION) return;
      try {
        const res = await fetch(location.pathname, { cache: 'no-cache' });
        const live = /<meta name="app-version" content="([^"]*)"/.exec(await res.text());
        if (live && live[1] !== G.VERSION) {
          toast(t('app.updating'));
          flush();
          setTimeout(() => location.reload(), 1200);
        }
      } catch (err) { /* offline: keep the current version */ }
    });
  }

  function openInitialGame() {
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
