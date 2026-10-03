// Explain (in the Analyse tab): explains the position without an engine (threat map, VCF / VCT search). It owns its own board layer
// (BoardView.setExplain) and never changes the game. The engine's PV decorations live in engine-panel.js; both use
// the model in explain.js.
(function (G) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const { t } = G.i18n;
  const E = G.explain;
  const COMBOS = new Set(['open4', '4-4', '4-3', '3-3']);

  // app: { game(), mode(), tab(), cellText(x, y), playerName(p), board }
  G.createExplainPanel = function (app) {
    let result = null; // { key, first, line, chain, roles }
    let step = 0; // moves shown (hover on a step, or the wheel over the board); 0 = all

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const active = () => app.tab() === 'analyze';

    // The position at the cursor as a model board.
    function boardOf(game) {
      const stones = new Map();
      for (const [k, id] of game.position()) stones.set(k, game.player(id));
      return { size: game.size, walls: game.walls, stones };
    }

    // What each move of the line is: 'attack', 'reply' (forced block), 'counter' (the defender's four) or
    // 'block' (the attacker blocking that four at no cost).
    function rolesOf(kinds) {
      return kinds.map((kind, i) => {
        if (i % 2 === 0) return i > 0 && (kinds[i - 1] === 'four' || kinds[i - 1] === 'five') ? 'block' : 'attack';
        return kind === 'four' || kind === 'five' ? 'counter' : 'reply';
      });
    }

    function find() {
      const game = app.game();
      if (app.mode() === 'setup' || game.bendsLines()) return;
      const board = boardOf(game);
      const me = game.toMove();
      let mode = 'VCF';
      let line = E.solve(board, me, 'VCF', true);
      if (!line) {
        mode = 'VCT';
        line = E.solve(board, me, 'VCT', true);
      }
      step = 0;
      if (!line) {
        result = { key: positionKey(), none: true };
        render();
        return;
      }
      const d = E.describe(board, line, me);
      const end = line.length - 1; // the solver's line ends with the attacker's last move
      const chain = { kind: mode, line, start: 0, end, added: line.length, kinds: d.kinds, finish: d.finishes[end] };
      result = { key: positionKey(), first: me, line, chain, roles: rolesOf(d.kinds), kinds: d.kinds, finishes: d.finishes, mode };
      render();
    }

    function clear() {
      result = null;
      step = 0;
      render();
    }

    // Identifies the position (and game) a result belongs to.
    function positionKey() {
      const g = app.game();
      return `${g.size}|${[...g.walls].join(',')}|${g.portals.join(';')}|${g.path(g.cur).map((id) => `${g.nodes[id].x},${g.nodes[id].y}`).join(';')}|${g.name || ''}`;
    }

    // The position changed under the result.
    function positionChanged() {
      if (result && result.key !== positionKey()) clear();
    }

    function stepText(i) {
      const r = result;
      const role = r.roles[i];
      if (role === 'reply') return t('exp.step.reply');
      if (role === 'counter') return t('exp.step.counter');
      if (role === 'block') return t('exp.step.block');
      const fin = r.finishes[i];
      if (i === r.chain.end && fin && fin !== 'five') {
        return `${t('exp.step.win')} (${fin === 'open4' ? t('eng.openFour') : fin})`;
      }
      return t(`exp.step.attack.${r.kinds[i] || 'four'}`);
    }

    function render() {
      const portals = app.game().bendsLines(); // the analysis does not know portals or a torus
      const can = app.mode() !== 'setup' && !portals;
      $('#expFind').disabled = !can;
      $('#expClear').disabled = !result;
      const status = $('#expStatus');
      const list = $('#expSteps');
      const focused = list.contains(document.activeElement) ? document.activeElement.dataset.step : undefined;
      if (!result) {
        status.textContent = portals ? t('exp.noPortals') : '';
        list.innerHTML = '';
      } else if (result.none) {
        status.textContent = t('exp.none');
        list.innerHTML = '';
      } else {
        const attacks = Math.ceil(result.line.length / 2);
        status.textContent = t('exp.found', { kind: result.chain.kind, n: attacks, side: app.playerName(result.first) });
        list.innerHTML = result.line.map(([x, y], i) => {
          const player = (result.first + i) % 2;
          return `<li class="${result.roles[i]}"><button type="button" data-step="${i + 1}" class="${i + 1 === step ? 'on' : ''}">` +
            `<span class="n">${i + 1}</span><span class="mv">${esc(app.cellText(x, y))}</span>` +
            `<span class="why">${esc(app.playerName(player))}: ${esc(stepText(i))}</span></button></li>`;
        }).join('');
        if (focused !== undefined) {
          const b = list.querySelector(`[data-step="${focused}"]`);
          if (b) b.focus({ preventScroll: true });
        }
      }
      renderOverlay();
    }

    // The line is shown only while the Analyse tab is open, so it never clutters play.
    function renderOverlay() {
      if (!result || result.none || !active()) {
        app.board.setExplain(null);
        return;
      }
      const len = result.line.length;
      const n = step > 0 && step < len ? step : len;
      app.board.setExplain({ line: result.line.slice(0, n), first: result.first, chain: result.chain, mark: n < len ? n - 1 : -1 });
    }

    function setStep(n) {
      if (n === step) return;
      step = n;
      for (const b of $$('#expSteps button')) b.classList.toggle('on', Number(b.dataset.step) === step);
      renderOverlay();
    }

    $('#expFind').addEventListener('click', find);
    $('#expClear').addEventListener('click', clear);

    const list = $('#expSteps');
    list.addEventListener('pointerover', (e) => {
      const b = e.target.closest('[data-step]');
      if (b) setStep(Number(b.dataset.step));
    });
    list.addEventListener('pointerleave', () => setStep(0));
    list.addEventListener('focusin', (e) => {
      const b = e.target.closest('[data-step]');
      if (b) setStep(Number(b.dataset.step));
    });
    list.addEventListener('focusout', (e) => {
      if (!list.contains(e.relatedTarget)) setStep(0);
    });

    // Mouse wheel over the board walks the line one move per notch (down = forward), like the engine's PV preview.
    app.board.svg.addEventListener('wheel', (e) => {
      if (e.ctrlKey || !e.deltaY || !shown()) return;
      const len = result.line.length;
      const cur = step || len;
      setStep(Math.max(1, Math.min(len, cur + (e.deltaY > 0 ? 1 : -1))));
      e.preventDefault();
    }, { passive: false });

    // True while a winning line is drawn, so the wheel over the board belongs to it and not to the engine's PV.
    const shown = () => !!result && !result.none && active();

    return { render, positionChanged, shown };
  };
})(window.Gomoku = window.Gomoku || {});
