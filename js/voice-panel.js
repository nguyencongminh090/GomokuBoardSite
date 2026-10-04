// Voice moves, UI part: hold the mic button (or the V key) and say a cell; Groq's Whisper turns the clip into text,
// G.voice.parseCell turns the text into a cell, and the move is played through the same path as a click.
// The API key is the host's own and lives only in this browser's localStorage.
(function (G) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const store = G.storage;
  const { t } = G.i18n;

  const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
  const MODEL = 'whisper-large-v3'; // the model measured at 82% on spoken cell numbers
  const MIN_CLIP_MS = 500; // shorter clips make Whisper invent words
  const TAIL_MS = 500; // keep recording a moment after release so the last syllable is not cut
  const CONFIRM_MS = 1500;
  const DICTATE_MAX_MS = 10000; // a search phrase is short: stop by itself
  const IDLE_RELEASE_MS = 30000; // let go of the microphone when it has not been used for a while

  G.createVoicePanel = function (deps) {
    const { game, mode, settings, play, cellText, board, toast } = deps;
    let apiKey = store.loadGroqKey();
    let state = 'idle'; // idle | recording | sending | confirming
    let held = false;
    let stream = null;
    let recorder = null;
    let chunks = [];
    let startedAt = 0;
    let tailTimer = 0;
    let idleTimer = 0;
    let confirmTimer = 0;

    const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    function say(text) {
      $('#voiceStatus').textContent = text;
    }

    function setState(next) {
      state = next;
      $('#micBtn').setAttribute('aria-pressed', String(next === 'recording'));
      $('#micBtn').classList.toggle('on', next === 'recording');
      $('#voiceCancel').hidden = next !== 'confirming';
    }

    // ---------- recording ----------

    function releaseStream() {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    async function press() {
      if (held) return;
      held = true;
      if (state === 'recording') { // pressed again during the tail: keep the same clip going
        clearTimeout(tailTimer);
        return;
      }
      if (state === 'confirming') cancel(); // pressing again discards the heard cell and starts over
      if (state !== 'idle') return;
      if (!apiKey) {
        held = false;
        say(t('voice.noKey'));
        return;
      }
      if (mode() !== 'play') {
        held = false;
        say(t('voice.playOnly'));
        return;
      }
      clearTimeout(idleTimer);
      try {
        if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      } catch (err) {
        held = false;
        say(t('voice.noMic'));
        return;
      }
      if (!held) { // released while the permission prompt was open
        scheduleRelease();
        return;
      }
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.start();
      startedAt = Date.now();
      setState('recording');
      say(t('voice.listening'));
    }

    function release() {
      if (!held) return;
      held = false;
      if (state !== 'recording') return;
      say(t('voice.finishing'));
      tailTimer = setTimeout(stopRecording, TAIL_MS);
    }

    function stopRecording() {
      const rec = recorder;
      const long = Date.now() - startedAt >= MIN_CLIP_MS + TAIL_MS;
      rec.onstop = () => {
        scheduleRelease();
        if (!long) {
          setState('idle');
          say(t('voice.tooShort'));
          return;
        }
        send(new Blob(chunks, { type: rec.mimeType }));
      };
      setState('sending');
      say(t('voice.sending'));
      rec.stop();
    }

    function scheduleRelease() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(releaseStream, IDLE_RELEASE_MS);
    }

    // ---------- transcription ----------

    async function transcribe(blob, lang = 'vi') {
      const ext = /mp4/.test(blob.type) ? 'mp4' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', blob, `clip.${ext}`);
      form.append('model', MODEL);
      form.append('language', lang);
      form.append('temperature', '0');
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 401) throw new Error(t('voice.badKey'));
      if (res.status === 429) throw new Error(t('voice.limit'));
      if (!res.ok) throw new Error(t('voice.error', { status: res.status }));
      return String((await res.json()).text || '').trim();
    }

    function errorText(err) {
      return err.name === 'TimeoutError' || err.name === 'TypeError' ? t('voice.network') : err.message;
    }

    // One-shot dictation for the search box. Resolves to { stop, text } once the microphone is recording (it throws a
    // readable Error when there is no key or microphone); `text` is a promise of the transcript, which `stop()` (or the
    // time limit) triggers. Independent of the move recorder above, so it never plays a move.
    async function dictate(lang) {
      if (!apiKey) throw new Error(t('voice.noKey'));
      if (state !== 'idle') throw new Error(t('voice.busy'));
      clearTimeout(idleTimer);
      try {
        if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      } catch (err) {
        throw new Error(t('voice.noMic'));
      }
      const rec = new MediaRecorder(stream);
      const parts = [];
      const began = Date.now();
      let limit = 0;
      rec.ondataavailable = (e) => parts.push(e.data);
      const text = new Promise((resolve, reject) => {
        rec.onstop = async () => {
          clearTimeout(limit);
          scheduleRelease();
          if (Date.now() - began < MIN_CLIP_MS) return reject(new Error(t('voice.tooShort')));
          try {
            resolve(await transcribe(new Blob(parts, { type: rec.mimeType }), lang));
          } catch (err) {
            reject(new Error(errorText(err)));
          }
        };
      });
      const stop = () => {
        if (rec.state === 'recording') setTimeout(() => rec.state === 'recording' && rec.stop(), TAIL_MS);
      };
      rec.start();
      limit = setTimeout(stop, DICTATE_MAX_MS);
      return { stop, text };
    }

    async function send(blob) {
      let text;
      try {
        text = await transcribe(blob);
      } catch (err) {
        setState('idle');
        say(errorText(err));
        return;
      }
      const g = game();
      const cell = G.voice.parseCell(text, g.size);
      if (!cell) {
        setState('idle');
        say(t('voice.unclear', { text }));
        return;
      }
      if (!g.canPlay(cell.x, cell.y)) {
        setState('idle');
        say(t('voice.cantPlay', { text, cell: cellText(cell.x, cell.y) }));
        return;
      }
      if (!settings().voice.confirm) {
        setState('idle');
        play(cell.x, cell.y);
        say(t('voice.played', { text, cell: cellText(cell.x, cell.y) }));
        return;
      }
      setState('confirming');
      board.setVoice({ x: cell.x, y: cell.y });
      say(t('voice.heard', { text, cell: cellText(cell.x, cell.y), s: CONFIRM_MS / 1000 }));
      confirmTimer = setTimeout(() => {
        clear();
        // The position may have changed while waiting (a click, Back): only play when the cell is still free.
        if (game().canPlay(cell.x, cell.y) && mode() === 'play') play(cell.x, cell.y);
      }, CONFIRM_MS);
    }

    function clear() {
      clearTimeout(confirmTimer);
      board.setVoice(null);
      setState('idle');
    }

    function cancel() {
      if (state !== 'confirming') return;
      clear();
      say(t('voice.cancelled'));
    }

    // ---------- key (Settings) ----------

    function renderKey() {
      const input = $('#groqKey');
      $('#groqKeyState').textContent = apiKey ? t('voice.keySaved', { tail: apiKey.slice(-4) }) : t('voice.keyNone');
      $('#groqKeyRemove').hidden = !apiKey;
      input.value = '';
      $('#voiceHint').hidden = !apiKey;
    }

    function saveKey() {
      const value = $('#groqKey').value.trim();
      if (!value) return;
      if (!store.saveGroqKey(value)) return toast(t('storage.failed'));
      apiKey = value;
      renderKey();
      toast(t('voice.keyStored'));
    }

    function removeKey() {
      store.saveGroqKey('');
      apiKey = '';
      releaseStream();
      renderKey();
    }

    // ---------- typed cell ----------

    function submitTyped(e) {
      e.preventDefault();
      const input = $('#cellInput');
      const text = input.value.trim();
      const say2 = (msg) => { $('#cellStatus').textContent = msg; };
      if (!text) return;
      if (mode() !== 'play') return say2(t('cell.playOnly'));
      const g = game();
      const cell = G.voice.parseCell(text, g.size);
      if (!cell) return say2(t('cell.unclear', { text }));
      if (!g.canPlay(cell.x, cell.y)) return say2(t('cell.cantPlay', { cell: cellText(cell.x, cell.y) }));
      play(cell.x, cell.y);
      input.value = '';
      say2('');
    }

    // ---------- wiring ----------

    function start() {
      $('#cellForm').addEventListener('submit', submitTyped);
      $('#voiceBlock').hidden = !supported;
      $('#voiceSettings').hidden = !supported;
      if (!supported) return;
      const mic = $('#micBtn');
      mic.addEventListener('pointerdown', (e) => {
        mic.setPointerCapture(e.pointerId);
        press();
      });
      for (const type of ['pointerup', 'pointercancel']) mic.addEventListener(type, release);
      // Keyboard: hold Space or Enter on the focused button, or hold V anywhere outside a text field.
      mic.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          press();
        }
      });
      mic.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') release();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== 'v' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target instanceof Element && e.target.closest('input, select, textarea, button, [role="tab"]')) return;
        press();
      });
      document.addEventListener('keyup', (e) => {
        if (e.key.toLowerCase() === 'v') release();
      });
      $('#voiceCancel').addEventListener('click', cancel);
      $('#groqKeySave').addEventListener('click', saveKey);
      $('#groqKeyRemove').addEventListener('click', removeKey);
      $('#groqKey').addEventListener('keydown', (e) => e.key === 'Enter' && saveKey());
      renderKey();
    }

    return { start, cancel, renderKey, dictate, supported, hasKey: () => !!apiKey };
  };
})(window.Gomoku = window.Gomoku || {});
