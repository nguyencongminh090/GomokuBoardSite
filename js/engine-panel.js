// Engine UI: the Engine tab (load and configure), the engine block of the Play tab (who the engine plays,
// analysis, distance moves, results) and the engine overlay on the board. main.js creates it and passes the
// app state it needs; it never changes the game except through app.play().
(function (G) {
  'use strict';

  const { t } = G.i18n;
  const P = G.engineProtocol;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // sessionStorage flag for the one reload that turns on cross-origin isolation (needed for threads):
  // 'reload' = reloading now, load the engine when the page is back; 'tried' = done for this tab.
  const ISOLATE_KEY = 'gomoku-board.engine.isolate';
  const LOG_LINES = 400;
  const PREVIEW_MOVES = 12; // moves of a line drawn on the board; long lines bury the position

  function session(value) {
    try {
      if (value === undefined) return sessionStorage.getItem(ISOLATE_KEY);
      sessionStorage.setItem(ISOLATE_KEY, value);
    } catch (e) { /* storage unavailable: at worst the isolation reload is offered again */ }
    return null;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 1234 -> "1.2k", 959000 -> "959k", 5600000 -> "5.6M"
  function compact(n) {
    if (!Number.isFinite(n)) return '–';
    for (const [unit, v] of [['G', 1e9], ['M', 1e6], ['k', 1e3]]) {
      if (n >= v) return `${(n / v).toFixed(n >= 100 * v ? 0 : 1)}${unit}`;
    }
    return String(n);
  }

  // Result lines to show: each PV keeps its last completed depth, so after the ranking changes a stale
  // lower-ranked PV can start with the same move as a fresher one. Show each first move once.
  function shownLines(lines) {
    const seen = new Set();
    return lines.filter((l) => {
      if (!l || !l.line.length) return false;
      const k = l.line[0].join(',');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function valueText(v) {
    if (!v) return '–';
    if (v.mate) return `${v.mate > 0 ? '+' : '-'}M${v.plies || '*'}`;
    if (v.cp !== undefined) return v.cp > 0 ? `+${v.cp}` : String(v.cp);
    return v.text;
  }

  const pct = (w) => `${Math.round(w * 100)}%`;

  G.createEnginePanel = function (app) {
    // app: { game(), settings(), mode(), play(x, y), cellText(x, y), playerName(p), toast(msg), flush(), board, authorize() }
    const client = new G.EngineClient(onEvent);
    const log = [];
    let status = ''; // loader progress text
    let result = null; // { key, kind, toMove, lines, done } analysis of the position on the board
    let preview = -1; // index of the result line shown on the board
    let lastEngine = null; // engine settings at the previous settingsChanged(), to react to changes
    let wasReady = false; // true once loaded; stays true while the single-threaded build restarts after a stop
    let frame = 0;

    const engineSettings = () => app.settings().engine;
    const tooBig = () => app.game().size > P.MAX_SIZE;

    // ---------- loading ----------

    function load() {
      const why = G.engineSupport.unsupportedReason();
      if (why) {
        app.toast(t(why));
        render();
        return;
      }
      if (engineSettings().multi && !G.engineSupport.canUseThreads() && isolate()) return;
      client.load(engineSettings().multi && G.engineSupport.canUseThreads() ? 'multi' : 'single');
    }

    // Threads need a cross-origin isolated page. GitHub Pages cannot send the COOP/COEP headers, so a
    // service worker adds them (coi-serviceworker.js) and the page reloads once. Returns true if reloading.
    function isolate() {
      if (!('serviceWorker' in navigator) || !window.isSecureContext || session()) return false;
      session('reload');
      app.toast(t('eng.isolating'));
      // Reload only once the worker is active, or the reloaded page would not come through it.
      navigator.serviceWorker.register('coi-serviceworker.js').then(() => navigator.serviceWorker.ready).then(() => {
        app.flush();
        location.reload();
      }, (err) => {
        console.warn('Cross-origin isolation is unavailable', err);
        session('tried');
        client.load('single');
      });
      return true;
    }

    // Loading is the only way in to the engine, so this is where the key gate applies.
    async function requestLoad() {
      if (await app.authorize()) load();
    }

    function unload() {
      client.unload();
      result = null;
      render();
    }

    // Called once when the app starts.
    function start() {
      lastEngine = { ...engineSettings() };
      if (session() === 'reload') {
        session('tried');
        requestLoad();
      } else if (engineSettings().autoload) {
        requestLoad();
      }
      positionChanged(false); // queues auto-analysis of the opening position
    }

    // ---------- searching ----------

    function config(kind) {
      const e = engineSettings();
      const threads = client.variant === 'multi' ? e.threads || navigator.hardwareConcurrency || 4 : 1;
      const secs = kind === 'analyze' ? e.analysisTime : e.moveTime; // 0 = no time limit
      return {
        rule: Number(e.rule),
        threads,
        hashMB: Number(e.hash),
        depth: e.depth,
        strength: e.strength,
        timeMs: Math.round(secs * 1000),
      };
    }

    // Searches can be queued while the engine (re)loads; they start once it is ready.
    function canSearch() {
      return (client.ready || client.state === 'loading') && !tooBig() && app.mode() !== 'setup';
    }

    function search(kind, go) {
      if (!canSearch()) return;
      const game = app.game();
      const block = P.boardBlock(game);
      client.run({ kind, block, size: game.size, config: config(kind), go });
      result = { key: block, kind, toMove: game.toMove(), lines: [], done: false };
      preview = -1;
      render();
    }

    const analyze = () => search('analyze', `YXNBEST ${engineSettings().nbest}`);
    const engineMove = () => search('move', 'YXNBEST 1');

    // Stop keeps the answer: an engine move still plays the best move found so far.
    function stop() {
      client.stop();
    }

    function toggleAnalysis() {
      if (client.state === 'busy') stop();
      else analyze();
    }

    // Called by main.js after anything that may change the position. `played` is true when the host
    // (not the engine) just placed a stone, which is the engine's cue in "engine plays X/O" mode.
    function positionChanged(played) {
      const game = app.game();
      const key = canSearch() ? P.boardBlock(game) : '';
      if (result && result.key !== key) {
        result = null;
        preview = -1;
      }
      const running = client.job;
      if (!key) {
        if (running) client.cancel();
      } else if (played && engineSettings().side === String(game.toMove())) {
        engineMove();
      } else if (engineSettings().auto) {
        if (!running || running.block !== key) analyze();
      } else if (running && running.block !== key) {
        client.cancel();
      }
      render();
    }

    // Called by main.js after any settings change.
    function settingsChanged() {
      const e = engineSettings();
      const prev = lastEngine || e;
      lastEngine = { ...e };
      if (e.multi !== prev.multi) {
        if (!e.multi) unregisterIsolation();
        if (client.ready || client.state === 'loading') load(); // restart with the other build
        return;
      }
      if (!canSearch()) return;
      const game = app.game();
      if (e.side !== prev.side && e.side === String(game.toMove()) && !client.job) engineMove();
      else if (e.auto && !prev.auto && !client.job) analyze();
      else if (!e.auto && prev.auto && client.job && client.job.kind === 'analyze') client.cancel();
    }

    function unregisterIsolation() {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) {
          if (r.active && r.active.scriptURL.endsWith('/coi-serviceworker.js')) r.unregister();
        }
      }, () => {});
    }

    // ---------- engine events ----------

    function onEvent(type, data) {
      switch (type) {
        case 'state':
          if (data === 'idle') wasReady = true;
          else if (data !== 'busy' && data !== 'loading') wasReady = false;
          break;
        case 'status':
          status = data;
          break;
        case 'line':
          log.push(data.out ? data.text : `> ${data.text.replace(/\n/g, ' | ')}`);
          if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
          if (data.out && /^MESSAGE (Transposition table|Hash)/.test(data.text)) app.toast(data.text.slice(8));
          break;
        case 'analysis':
          if (result && result.key === data.job.block) result.lines = data.lines.slice();
          break;
        case 'done':
          onDone(data);
          break;
        case 'error':
          app.toast(t('eng.failed', { text: data.text }));
          break;
        default:
          break;
      }
      schedule();
    }

    function onDone({ job, move, lines }) {
      // A stopped search that gave no move line (the single-threaded build restarts to stop, so it never
      // answers) still has its best line so far: use its first move. This is what makes Stop end an engine
      // move that has no time limit.
      if (!move && job.stopped) {
        const best = shownLines(lines)[0];
        if (best) move = best.line[0];
      }
      if (result && result.key === job.block) {
        if (lines.length) result.lines = lines.slice();
        // Moves from the opening logic (e.g. on an empty board) come without an INFO feed: show the move alone.
        else if (move && move[0] >= 0 && !job.stopped) result.lines = [{ pv: 0, line: [move] }];
        result.done = true;
      }
      if (job.kind !== 'move' || job.superseded) return;
      const game = app.game();
      if (P.boardBlock(game) !== job.block || app.mode() === 'setup') return; // the host moved on
      if (!move || move[0] < 0 || !game.canPlay(move[0], move[1])) {
        if (!job.stopped) app.toast(t('eng.noMove'));
        return;
      }
      result = null;
      app.play(move[0], move[1], false);
    }

    // ---------- rendering ----------

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
    }

    const busy = () => client.state === 'busy';

    function render() {
      renderEngineTab();
      renderPlayBlock();
      renderOverlay();
    }

    function stateText() {
      if (client.state === 'loading') return status ? `${t('eng.state.loading')} ${status}` : t('eng.state.loading');
      return t(`eng.state.${client.state}`);
    }

    function renderEngineTab() {
      const s = client.state;
      $('#engDot').dataset.state = s;
      $('#engStateText').textContent = stateText();
      const why = G.engineSupport.unsupportedReason();
      let detail = '';
      if (why) detail = t(why);
      else if (client.ready) {
        const version = /version="([^"(]+)/.exec(client.about);
        const threads = config('move').threads;
        detail = [
          version ? `Rapfi ${version[1].trim()}` : 'Rapfi',
          client.variant === 'multi' ? t('eng.variant.multi', { n: threads }) : t('eng.variant.single'),
        ].join(' · ');
        if (engineSettings().multi && client.variant === 'single') detail += `. ${t('eng.noThreads')}`;
      }
      $('#engDetail').textContent = detail;
      $('#engLoad').disabled = !!why || s === 'loading' || client.ready;
      $('#engUnload').disabled = s === 'off';
      $('#engThreads').disabled = client.variant === 'single' && client.ready;
      $('#engClearHash').disabled = $('#engHashUsage').disabled = s !== 'idle';

      const logBox = $('#engLog');
      if (logBox.closest('details').open) {
        const atEnd = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 4;
        logBox.textContent = log.length ? log.join('\n') : t('eng.logEmpty');
        if (atEnd) logBox.scrollTop = logBox.scrollHeight;
      }
    }

    function renderPlayBlock() {
      const game = app.game();
      const ready = client.ready || (client.state === 'loading' && wasReady);
      $('#engOff').hidden = ready;
      $('#engOn').hidden = !ready;
      $('#engStatus').textContent = `· ${stateText()}`;
      $('#engLoadPlay').hidden = client.state === 'loading';
      $('#engOffText').textContent = G.engineSupport.unsupportedReason()
        ? t(G.engineSupport.unsupportedReason())
        : client.state === 'loading' ? stateText() : t('eng.offText');
      if (!ready) return;

      $('#engSide0').textContent = t('eng.side.player', { name: app.playerName(0) });
      $('#engSide1').textContent = t('eng.side.player', { name: app.playerName(1) });
      const note = tooBig() ? t('eng.tooBig', { max: P.MAX_SIZE }) : app.mode() === 'setup' ? t('eng.setupPaused') : '';
      $('#engNote').textContent = note;
      $('#engNote').hidden = !note;
      const can = canSearch();
      $('#engAnalyze').disabled = !can;
      $('#engMove').disabled = !can;
      $('#engSelfDist').disabled = !can;
      $('#engOppDist').disabled = !can;
      $('#engStop').disabled = !busy();
      $('#engAnalyze').classList.toggle('on', busy() && client.job && client.job.kind === 'analyze');
      $('#engSelfDistHelp').textContent = t('eng.selfDistHelp', { n: engineSettings().selfDist });
      $('#engOppDistHelp').textContent = t('eng.oppDistHelp', { n: engineSettings().oppDist });

      const lines = result ? shownLines(result.lines) : [];
      renderEval(lines[0]);
      const table = $('#engLines');
      table.hidden = !lines.length;
      // The rows are rebuilt on every search update: keep keyboard focus on the same row's button.
      const focused = table.contains(document.activeElement) ? document.activeElement.dataset.engplay : undefined;
      table.querySelector('tbody').innerHTML = lines.map((l, i) => {
        const [x, y] = l.line[0] || [-1, -1];
        const move = x >= 0 ? app.cellText(x, y) : '–';
        const rest = l.line.slice(0, 8).map(([a, b]) => app.cellText(a, b)).join(' ');
        return `<tr data-line="${i}" class="${i === preview ? 'on' : ''}">` +
          `<td>${i + 1}</td>` +
          `<td><button class="small" data-engplay="${i}" title="${esc(t('eng.playLine', { move }))}"${x >= 0 ? '' : ' disabled'}>${esc(move)}</button></td>` +
          `<td>${esc(valueText(l.value))}</td>` +
          `<td>${l.winrate === undefined ? '–' : pct(l.winrate)}</td>` +
          `<td>${l.depth === undefined ? '–' : `${l.depth}-${l.selDepth}`}</td>` +
          `<td class="pv">${esc(rest)}${l.line.length > 8 ? ' …' : ''}</td></tr>`;
      }).join('');
      if (focused !== undefined) {
        const b = table.querySelector(`[data-engplay="${focused}"]`);
        if (b) b.focus({ preventScroll: true });
      }
    }

    // Win chance bar from the first player's side, plus search statistics.
    function renderEval(best) {
      const box = $('#engEval');
      box.hidden = !best || best.winrate === undefined;
      if (box.hidden) return;
      const w0 = result.toMove === 0 ? best.winrate : 1 - best.winrate;
      $('#engEvalFill').style.width = `${(w0 * 100).toFixed(1)}%`;
      $('#engEvalP0').textContent = `${app.playerName(0)} ${pct(w0)}`;
      $('#engEvalP1').textContent = `${pct(1 - w0)} ${app.playerName(1)}`;
      $('#engEvalText').textContent = t('eng.stats', {
        depth: `${best.depth}-${best.selDepth}`,
        nodes: compact(best.totalNodes),
        speed: compact(best.speed),
        time: ((best.time || 0) / 1000).toFixed(1),
      });
    }

    function renderOverlay() {
      const lines = result ? shownLines(result.lines) : [];
      if (!lines.length) {
        app.board.setAnalysis(null);
        return;
      }
      if (preview >= 0 && lines[preview]) {
        app.board.setAnalysis({ line: lines[preview].line.slice(0, PREVIEW_MOVES), first: result.toMove });
        return;
      }
      const cands = [];
      lines.forEach((l, i) => {
        const first = l.line[0];
        if (!first || first[0] < 0) return;
        cands.push({ x: first[0], y: first[1], rank: i + 1, label: l.winrate === undefined ? '' : pct(l.winrate) });
      });
      app.board.setAnalysis({ cands });
    }

    function setPreview(i) {
      if (i === preview) return;
      preview = i;
      for (const tr of $$('#engLines tbody tr')) tr.classList.toggle('on', Number(tr.dataset.line) === i);
      renderOverlay();
    }

    // ---------- controls ----------

    $('#engLoad').addEventListener('click', requestLoad);
    $('#engLoadPlay').addEventListener('click', requestLoad);
    $('#engUnload').addEventListener('click', unload);
    $('#engAnalyze').addEventListener('click', analyze);
    $('#engMove').addEventListener('click', engineMove);
    $('#engStop').addEventListener('click', stop);
    $('#engSelfDist').addEventListener('click', () => search('move', `YXPLAYSELF ${engineSettings().selfDist}`));
    $('#engOppDist').addEventListener('click', () => search('move', `YXOPPDIST ${engineSettings().oppDist}`));
    $('#engClearHash').addEventListener('click', () => client.state === 'idle' && client.send('YXHASHCLEAR'));
    $('#engHashUsage').addEventListener('click', () => client.state === 'idle' && client.send('YXSHOWHASHUSAGE'));
    $('#engLog').closest('details').addEventListener('toggle', renderEngineTab);

    const table = $('#engLines');
    table.addEventListener('pointerover', (e) => {
      const tr = e.target.closest('tr[data-line]');
      if (tr) setPreview(Number(tr.dataset.line));
    });
    table.addEventListener('pointerleave', () => setPreview(-1));
    table.addEventListener('focusin', (e) => {
      const tr = e.target.closest('tr[data-line]');
      if (tr) setPreview(Number(tr.dataset.line));
    });
    table.addEventListener('focusout', (e) => {
      if (!table.contains(e.relatedTarget)) setPreview(-1);
    });
    table.addEventListener('click', (e) => {
      const b = e.target.closest('[data-engplay]');
      if (!b || !result) return;
      const l = shownLines(result.lines)[Number(b.dataset.engplay)];
      if (!l || !l.line[0]) return;
      preview = -1;
      app.play(l.line[0][0], l.line[0][1], true);
    });

    return { start, render, positionChanged, settingsChanged, analyze, toggleAnalysis, engineMove, stop, unload };
  };
})(window.Gomoku = window.Gomoku || {});
