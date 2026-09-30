// Rapfi engine client. The engine is a WebAssembly build of Rapfi (engine/rapfi-*.js) running in a Web
// Worker (engine/engine.worker.js); this file speaks its Piskvork/Yixin text protocol.
//
// Every search is one job: the page sends the whole position as a YXBOARD block (walls as colour 3,
// stones in move order), then one search command (YXNBEST, YXPLAYSELF or YXOPPDIST). The engine only
// accepts STOP while it is thinking and answers every search, stopped or not, with one move line, so
// a new job waits for that line. The block is also the job's key: a result belongs to the position
// on the board only if the block built from it is the same.
//
// The protocol helpers (G.engineProtocol) have no DOM access and are tested in tests/model.test.js.
(function (G) {
  'use strict';

  const MAX_SIZE = 22; // Rapfi's MAX_BOARD_SIZE
  // Release version from index.html, passed on to the worker so the engine files are versioned too.
  const VERSION = typeof document !== 'undefined'
    ? (document.querySelector('meta[name="app-version"]') || {}).content || ''
    : '';
  const STOP_TIMEOUT = 5000; // ms to wait for the move line after STOP before giving up on it

  // ---------- protocol ----------

  // YXBOARD (or BOARD) block for the position at the game's cursor. Colour 1 is the first player
  // (cross / black), so the engine's "first entry is black" rule and the site's player order agree.
  function boardBlock(game, cmd = 'YXBOARD') {
    const s = game.size;
    const lines = [cmd];
    for (const k of [...game.walls].sort((a, b) => a - b)) lines.push(`${k % s},${Math.floor(k / s)},3`);
    for (const id of game.path(game.cur)) {
      const n = game.nodes[id];
      lines.push(`${n.x},${n.y},${game.player(id) + 1}`);
    }
    lines.push('DONE');
    return lines.join('\n');
  }

  // INFO commands for a search configuration, as [name, value] pairs.
  function configCommands(c) {
    return [
      ['RULE', c.rule],
      ['THREAD_NUM', c.threads],
      ['HASH_SIZE', c.hashMB * 1024], // KB, applied as-is (MAX_MEMORY would subtract a reserve)
      ['MAX_DEPTH', c.depth],
      ['STRENGTH', c.strength],
      ['TIMEOUT_MATCH', 0],
      ['TIMEOUT_TURN', c.timeMs], // 0 with no match time = no time limit: think until stopped (or max depth)
    ];
  }

  // Engine value text: "123", "+M5" (mate in 5 plies), "-M4", "+M*" (mate from a database).
  function parseValue(text) {
    const mate = /^([+-])M(\d+|\*)$/.exec(text);
    if (mate) {
      const plies = mate[2] === '*' ? 0 : Number(mate[2]);
      return { text, mate: mate[1] === '+' ? 1 : -1, plies };
    }
    const cp = Number(text);
    return Number.isFinite(cp) ? { text, cp } : { text };
  }

  function parseCoord(text) {
    const m = /^(-?\d+),(-?\d+)$/.exec(text);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  // Classifies one output line.
  function parseLine(line) {
    const text = line.trim();
    if (text === 'OK') return { type: 'ok' };
    if (text === 'SWAP') return { type: 'swap' };
    if (text.startsWith('MESSAGE ')) return { type: 'message', text: text.slice(8) };
    if (text.startsWith('ERROR ')) return { type: 'error', text: text.slice(6) };
    if (text.startsWith('INFO ')) {
      const rest = text.slice(5);
      const sp = rest.indexOf(' ');
      return sp < 0
        ? { type: 'info', key: rest, value: '' }
        : { type: 'info', key: rest.slice(0, sp), value: rest.slice(sp + 1) };
    }
    const parts = text.split(/\s+/);
    const moves = parts.map(parseCoord);
    if (parts.length <= 2 && moves.every(Boolean)) return { type: 'move', moves };
    if (text.includes('name=')) return { type: 'about', text };
    return { type: 'other', text };
  }

  // Collects the INFO detail feed (INFO PV i ... INFO PV DONE) into one entry per principal variation.
  class InfoCollector {
    constructor() {
      this.lines = [];
      this.cur = null;
    }

    // Returns true when a PV was completed.
    add(key, value) {
      if (key === 'PV') {
        if (value === 'DONE') {
          const c = this.cur;
          this.cur = null;
          if (!c) return false;
          this.lines[c.pv] = c;
          if (c.numPv) this.lines.length = Math.min(this.lines.length, c.numPv);
          return true;
        }
        this.cur = { pv: Number(value) || 0, line: [] };
        return false;
      }
      const c = this.cur;
      if (!c) return false;
      switch (key) {
        case 'NUMPV': c.numPv = Number(value); break;
        case 'DEPTH': c.depth = Number(value); break;
        case 'SELDEPTH': c.selDepth = Number(value); break;
        case 'NODES': c.nodes = Number(value); break;
        case 'TOTALNODES': c.totalNodes = Number(value); break;
        case 'TOTALTIME': c.time = Number(value); break;
        case 'SPEED': c.speed = Number(value); break;
        case 'EVAL': c.value = parseValue(value); break;
        case 'WINRATE': c.winrate = Number(value); break;
        case 'BESTLINE': c.line = value.split(/\s+/).map(parseCoord).filter(Boolean); break;
        default: break;
      }
      return false;
    }
  }

  // ---------- browser support ----------

  // A minimal module using a v128 instruction; valid only where WebAssembly SIMD is supported.
  const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

  // Why the engine cannot run here, or '' when it can. Returns an i18n key.
  function unsupportedReason() {
    if (typeof location !== 'undefined' && location.protocol === 'file:') return 'eng.err.file';
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return 'eng.err.wasm';
    try {
      if (!WebAssembly.validate(SIMD_PROBE)) return 'eng.err.simd';
    } catch (e) {
      return 'eng.err.simd';
    }
    return '';
  }

  // Threads need SharedArrayBuffer, which browsers only give to cross-origin isolated pages.
  function canUseThreads() {
    return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
  }

  // ---------- client ----------

  // Events passed to `listener(type, data)`:
  //   'state'    the client state changed (see `state`)
  //   'status'   loader progress text
  //   'line'     { text, out } a line sent (out = false) or received (out = true), for the log
  //   'about'    engine name/version line
  //   'analysis' { job, lines } a principal variation was completed
  //   'done'     { job, move, lines } a search finished (move is null when it was cut off)
  //   'error'    { text } the engine failed to load or crashed
  class EngineClient {
    constructor(listener, base = 'engine/') {
      this.listener = listener;
      this.base = base;
      this.worker = null;
      this.variant = '';
      this.state = 'off'; // 'off' | 'loading' | 'idle' | 'busy' | 'error'
      this.job = null; // the running search
      this.next = null; // the search to start once the running one has answered
      this.stopping = false;
      this.stopTimer = 0;
      this.collector = new InfoCollector();
      this.about = '';
      this.size = 0; // board size the engine was last started with
      this.applied = new Map(); // INFO name -> value last sent
    }

    get ready() {
      return this.state === 'idle' || this.state === 'busy';
    }

    emit(type, data) {
      this.listener(type, data);
    }

    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.emit('state', state);
    }

    load(variant) {
      this.shutdown();
      this.variant = variant;
      this.setState('loading');
      let worker;
      try {
        worker = new Worker(`${this.base}engine.worker.js${VERSION ? `?v=${encodeURIComponent(VERSION)}` : ''}`);
      } catch (err) {
        this.fail(err.message);
        return;
      }
      this.worker = worker;
      worker.onmessage = (e) => this.onWorkerMessage(worker, e.data);
      worker.onerror = (e) => {
        e.preventDefault();
        if (worker === this.worker) this.fail(e.message || 'Worker error');
      };
      worker.postMessage({ type: 'init', variant });
    }

    unload() {
      this.next = null;
      this.shutdown();
      this.setState('off');
    }

    shutdown() {
      clearTimeout(this.stopTimer);
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      const job = this.job;
      this.job = null;
      this.stopping = false;
      this.size = 0;
      this.applied.clear();
      if (job) this.emit('done', { job, move: null, lines: this.collector.lines });
    }

    fail(text) {
      this.next = null;
      this.shutdown();
      this.setState('error');
      this.emit('error', { text });
    }

    onWorkerMessage(worker, msg) {
      if (worker !== this.worker) return; // a terminated worker's last messages
      switch (msg.type) {
        case 'status': this.emit('status', msg.text); break;
        case 'ready':
          this.send('ABOUT');
          this.send('INFO SHOW_DETAIL 2'); // the INFO feed, not the realtime one
          this.send('INFO PONDERING 0');
          this.send(`INFO TIME_LEFT ${0x7fffffff}`); // unlimited match time
          this.setState('idle');
          if (this.next) this.startNext();
          break;
        case 'line': this.onLine(msg.text); break;
        case 'error': this.fail(msg.text); break;
        case 'exit': this.fail(`Engine exited (${msg.code})`); break;
        default: break;
      }
    }

    send(text) {
      if (!this.worker) return;
      this.emit('line', { text, out: false });
      this.worker.postMessage({ type: 'cmd', text });
    }

    // Starts a search, or queues it behind the running one (which is stopped) or until the engine has loaded.
    // job: { kind, block, size, config, go }
    run(job) {
      this.next = job;
      if (this.state === 'idle') this.startNext();
      else if (this.state === 'busy') {
        this.job.superseded = true; // its answer is no longer wanted
        this.halt();
      }
    }

    // Ends the running search now; its answer (the best move so far) is still reported.
    stop() {
      this.next = null;
      this.halt();
    }

    // Drops any queued search and stops the running one, whose answer is no longer wanted.
    cancel() {
      this.next = null;
      if (this.job) this.job.superseded = true;
      this.halt();
    }

    halt() {
      if (this.state !== 'busy' || this.stopping) return;
      this.stopping = true;
      this.job.stopped = true;
      if (this.variant === 'single') {
        // The single-threaded engine is deaf while it thinks: restart it. The queued job survives.
        this.load('single');
        return;
      }
      this.send('YXSTOP');
      // If no search was actually running (e.g. the block was rejected), no move line will come.
      this.stopTimer = setTimeout(() => this.finish(null), STOP_TIMEOUT);
    }

    startNext() {
      const job = this.next;
      this.next = null;
      if (!job) return;
      if (this.size !== job.size) {
        this.send(`START ${job.size}`);
        this.size = job.size;
      }
      for (const [name, value] of configCommands(job.config)) {
        if (this.applied.get(name) === value) continue;
        this.send(`INFO ${name} ${value}`);
        this.applied.set(name, value);
      }
      this.collector = new InfoCollector();
      this.job = job;
      this.stopping = false;
      this.setState('busy');
      this.send(job.block);
      this.send(job.go);
    }

    onLine(text) {
      this.emit('line', { text, out: true });
      const p = parseLine(text);
      if (p.type === 'info') {
        if (this.job && this.collector.add(p.key, p.value)) {
          this.emit('analysis', { job: this.job, lines: this.collector.lines });
        }
      } else if (p.type === 'move') {
        if (this.job) this.finish(p.moves[0]);
      } else if (p.type === 'about') {
        this.about = p.text;
        this.emit('about', p.text);
      } else if (p.type === 'error' && /No game has been started|Unsupported board size/.test(p.text)) {
        // The search command was refused, so no move line will follow.
        this.size = 0;
        if (this.job) this.finish(null);
      }
    }

    finish(move) {
      clearTimeout(this.stopTimer);
      const job = this.job;
      this.job = null;
      this.stopping = false;
      if (this.state === 'busy') this.setState('idle');
      if (job) this.emit('done', { job, move, lines: this.collector.lines });
      if (this.next && this.state === 'idle') this.startNext();
    }
  }

  G.VERSION = VERSION;
  G.engineProtocol = { MAX_SIZE, boardBlock, configCommands, parseValue, parseLine, InfoCollector };
  G.engineSupport = { unsupportedReason, canUseThreads };
  G.EngineClient = EngineClient;
})(window.Gomoku = window.Gomoku || {});
