// Hosts the Rapfi WebAssembly engine off the page's main thread (js/engine.js starts it).
//
// Page -> worker: { type: 'init', variant: 'multi' | 'single' }, then { type: 'cmd', text }.
// Worker -> page: { type: 'status', text }, { type: 'ready' }, { type: 'line', text } (one engine
// output line), { type: 'error', text }, { type: 'exit', code }.
//
// The single-threaded build runs a whole search inside one sendCommand() call, so this worker is
// blocked while it thinks; output lines still reach the page, but a STOP message cannot. The page
// stops that build by terminating the worker.
'use strict';

// The page loads this worker as engine.worker.js?v=<release>; the same query goes on every engine file,
// so a new release never runs against cached files from an old one.
const VERSION_QUERY = self.location.search;

// With an engine gate, the engine files come from the gate's origin and the page passes its address (`gate`)
// and an access token (`t`) in the query. Without one, they sit next to this file. The query is also what
// the pthread workers of the multi build start from, so they inherit both.
const PARAMS = new URLSearchParams(VERSION_QUERY);
const GATE = PARAMS.get('gate') || '';
const FILE_QUERY = GATE ? `?v=${encodeURIComponent(PARAMS.get('v') || '')}&t=${encodeURIComponent(PARAMS.get('t') || '')}` : VERSION_QUERY;
const fileUrl = (name) => (GATE ? `${GATE}${name}` : name);

if (self.name === 'em-pthread') {
  // Emscripten starts each search thread of the multi-threaded build from the script that loaded it,
  // which is this file. The engine script starts itself when it sees it is running as a pthread.
  importScripts(`${fileUrl('rapfi-multi-simd128.js')}${FILE_QUERY}`);
} else {
  let engine = null;
  const pending = []; // commands that arrive before the engine is ready

  const post = (msg) => self.postMessage(msg);

  self.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'init') {
      init(msg.variant);
    } else if (msg.type === 'cmd') {
      if (engine) engine.sendCommand(msg.text);
      else pending.push(msg.text);
    }
  };

  function init(variant) {
    if (variant !== 'multi' && variant !== 'single') {
      post({ type: 'error', text: `Unknown engine variant: ${variant}` });
      return;
    }
    try {
      importScripts(`${fileUrl(`rapfi-${variant}-simd128.js`)}${FILE_QUERY}`);
    } catch (err) {
      post({ type: 'error', text: `Could not load the engine script: ${err.message}` });
      return;
    }
    self.Rapfi({
      locateFile: (path, prefix) => `${GATE || prefix}${path}${FILE_QUERY}`, // the .wasm and .data files
      onReceiveStdout: (text) => post({ type: 'line', text }),
      onReceiveStderr: (text) => post({ type: 'line', text: `[stderr] ${text}` }),
      onExit: (code) => post({ type: 'exit', code }),
      setStatus: (text) => text && post({ type: 'status', text }),
    }).then((m) => {
      engine = m;
      post({ type: 'ready' });
      for (const text of pending.splice(0)) engine.sendCommand(text);
    }, (err) => {
      post({ type: 'error', text: String(err && err.message ? err.message : err) });
    });
  }
}
