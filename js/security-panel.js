// Security card in Settings: the device-bound key pair, public-key sharing, trusted keys,
// the engine gate, and the signing / verifying used by Export and Import.
(function (G) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const sec = G.security;
  const store = G.storage;
  const { t } = G.i18n;

  G.createSecurityPanel = function (deps) {
    const { esc, toast, settings } = deps;
    const keys = { own: null, trusted: store.loadKeys().trusted };
    let access = null; // { gate, token }, set only after this page proved it holds an allow-listed private key
    const gateMeta = document.querySelector('meta[name="engine-gate"]');
    const gateUrl = gateMeta ? gateMeta.content.trim().replace(/\/+$/, '') : '';
    const gate = gateUrl ? `${gateUrl}/` : ''; // '' = engine files are served locally

    // Read by the engine client before it loads or searches, so calling it directly from the console skips the UI
    // but not this check. Defined once and locked: neither G nor this property can be reassigned afterwards.
    Object.defineProperty(G, 'engineGuard', { value: () => access, writable: false, configurable: false });

    const ready = store.loadOwnKey().then((pair) => {
      keys.own = pair;
      return render();
    });

    // ---------- files ----------

    function download(name, data) {
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    async function readJson(file) {
      try {
        return JSON.parse(await file.text());
      } catch (e) {
        return null;
      }
    }

    function persistTrusted() {
      if (!store.saveKeys(keys)) toast(t('storage.failed'));
    }

    // allowed-keys.json lists the public keys that may use the engine; fingerprints are recomputed, never trusted.
    async function loadAllowed() {
      try {
        const res = await fetch(`allowed-keys.json?v=${encodeURIComponent(G.VERSION || '')}`, { cache: 'no-store' });
        const raw = await res.json();
        if (!res.ok || !raw || raw.format !== 'gomoku-allowed-keys' || !Array.isArray(raw.keys)) return null;
        const out = [];
        for (const k of raw.keys) {
          const parsed = k && k.code
            ? await sec.parseKeyCode(k.code)
            : await sec.parsePublicKeyFile({ format: 'gomoku-public-key', publicKey: k && k.publicKey });
          if (parsed) out.push(parsed);
        }
        return out;
      } catch (e) {
        return null;
      }
    }

    // With an engine gate (a Cloudflare Worker) the engine files are only served against a token. The gate sends a
    // fresh challenge, this device signs it with the private key, and the gate checks it against allowed-keys.json.
    async function authorizeWithGate() {
      try {
        const { challenge } = await (await fetch(`${gate}challenge`, { cache: 'no-store' })).json();
        const signature = await sec.signText(keys.own.privateKey, challenge);
        const res = await fetch(`${gate}token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge, signature, publicKey: keys.own.publicKey }),
        });
        if (res.status === 403) {
          toast(t('sec.engineNotAllowed', { fp: (await sec.fingerprint(keys.own.publicKey)).slice(0, 9) }));
          return false;
        }
        const body = await res.json();
        if (!res.ok || typeof body.token !== 'string') throw new Error(body.error || res.status);
        access = { gate, token: body.token };
        return true;
      } catch (e) {
        toast(t('sec.engineGateFailed'));
        return false;
      }
    }

    // ---------- actions ----------

    async function createKeys() {
      let pair;
      try {
        pair = await sec.createKeyPair();
      } catch (e) {
        toast(t('sec.keyFailed'));
        return;
      }
      if (!(await store.saveOwnKey(pair))) {
        toast(t('sec.keyFailed'));
        return;
      }
      keys.own = pair;
      render();
      toast(t('sec.keyCreated'));
    }

    async function deleteKeys() {
      if (!confirm(t('sec.deleteConfirm'))) return;
      await store.saveOwnKey(null);
      keys.own = null;
      access = null;
      deps.engineStop();
      render();
      toast(t('sec.deleted'));
    }

    async function copyCode() {
      try {
        await navigator.clipboard.writeText(sec.keyCode(keys.own.publicKey));
        toast(t('sec.codeCopied'));
      } catch (e) {
        toast(t('sec.copyFailed'));
      }
    }

    async function copyPublic() {
      try {
        await navigator.clipboard.writeText(JSON.stringify(await sec.publicKeyFile(keys.own.publicKey), null, 1));
        toast(t('sec.copied'));
      } catch (e) {
        toast(t('sec.copyFailed'));
      }
    }

    async function savePublic() {
      download('gomoku-public-key.json', await sec.publicKeyFile(keys.own.publicKey));
    }

    async function addTrustedCode() {
      const code = prompt(t('sec.enterCode'));
      if (code) addTrusted(await sec.parseKeyCode(code));
    }

    async function addTrustedFile(file) {
      addTrusted(await sec.parsePublicKeyFile(await readJson(file)));
    }

    function addTrusted(parsed) {
      if (!parsed) {
        toast(t('sec.badKeyFile'));
        return;
      }
      if (keys.trusted.some((k) => k.fingerprint === parsed.fingerprint)) {
        toast(t('sec.trustedDup'));
        return;
      }
      keys.trusted.push(parsed);
      persistTrusted();
      render();
      toast(t('sec.trustedAdded'));
    }

    function removeTrusted(fp) {
      keys.trusted = keys.trusted.filter((k) => k.fingerprint !== fp);
      persistTrusted();
      render();
    }

    // ---------- card ----------

    async function render() {
      const el = $('#securityBody');
      $('#signRow').hidden = !keys.own;
      if (!sec.supported() || !window.indexedDB) {
        el.innerHTML = `<p class="muted small-text">${esc(t('sec.unsupported'))}</p>`;
        return;
      }
      const btn = (act, label, cls = '') => `<button class="small ${cls}" data-sec="${act}">${esc(t(label))}</button>`;
      const trusted = keys.trusted.map((k) => `
        <li><code>${esc(k.fingerprint)}</code>
          <button class="small" data-sec-remove="${esc(k.fingerprint)}">${esc(t('sec.remove'))}</button></li>`).join('');
      const trustedHtml = `
        <div class="sub-label">${esc(t('sec.trusted'))}</div>
        <p class="muted small-text">${esc(t('sec.trustedHelp'))}</p>
        ${trusted ? `<ul class="key-list">${trusted}</ul>` : `<p class="muted small-text">${esc(t('sec.trustedNone'))}</p>`}
        <div class="btn-row">
          ${btn('addTrustedCode', 'sec.addTrustedCode')}
          <label class="btn small"><span>${esc(t('sec.addTrusted'))}</span><input type="file" data-sec-file="trusted" accept=".json,application/json" hidden></label>
        </div>`;

      if (!keys.own) {
        el.innerHTML = `
          <p class="muted small-text">${esc(t('sec.intro'))}</p>
          <div class="btn-row">${btn('create', 'sec.create', 'primary')}</div>
          ${trustedHtml}`;
        return;
      }
      const fp = await sec.fingerprint(keys.own.publicKey);
      const date = new Date(keys.own.createdAt).toLocaleDateString(G.i18n.locale);
      el.innerHTML = `
        <p class="muted small-text">${esc(t('sec.intro'))}</p>
        <div class="sub-label">${esc(t('sec.fingerprint'))}</div>
        <code class="fingerprint">${esc(fp)}</code>
        <div class="sub-label">${esc(t('sec.code'))}</div>
        <code class="fingerprint">${esc(sec.keyCode(keys.own.publicKey))}</code>
        <p class="muted small-text">${esc(t('sec.created', { date }))}. ${esc(t('sec.keyBound'))}</p>
        <div class="btn-row">
          ${btn('copyCode', 'sec.copyCode')}
          ${btn('copyPublic', 'sec.copyPublic')}
          ${btn('savePublic', 'sec.savePublic')}
          ${btn('deleteKeys', 'sec.delete')}
        </div>
        <p class="muted small-text">${esc(t('sec.engineRule'))}</p>
        ${trustedHtml}`;
    }

    // Clicks and file choices are delegated so buttons rendered later work too.
    const ACTIONS = { create: createKeys, copyCode, copyPublic, savePublic, deleteKeys, addTrustedCode };
    $('#securityBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sec]');
      if (b) ACTIONS[b.dataset.sec]();
      const r = e.target.closest('[data-sec-remove]');
      if (r) removeTrusted(r.dataset.secRemove);
    });
    $('#securityBody').addEventListener('change', (e) => {
      const f = e.target.closest('[data-sec-file]');
      if (!f) return;
      const file = f.files[0];
      f.value = '';
      if (file) addTrustedFile(file);
    });

    // ---------- export / import hooks ----------

    return {
      // Returns the export body with a signature when signing applies, the body as is when it does not,
      // and null when signing failed (no file should be written).
      async signExport(body) {
        await ready;
        if (!keys.own || !settings().signExports || !sec.supported()) return body;
        try {
          return await sec.signExport(keys.own, body);
        } catch (e) {
          toast(t('sec.signFailed'));
          return null;
        }
      },

      // { ok, note }: ok is false for a signature that does not match the content (import must stop).
      async verifyImport(parsed) {
        const v = await sec.verifyExport(parsed);
        if (v.status === 'none') return { ok: true, note: '' };
        if (v.status === 'invalid') return { ok: false, note: t('sec.importInvalid') };
        const fp = v.fingerprint;
        if (keys.own && keys.own.publicKey.x === v.publicKey.x && keys.own.publicKey.y === v.publicKey.y) {
          return { ok: true, note: t('sec.signedOwn') };
        }
        if (keys.trusted.some((k) => k.fingerprint === fp)) return { ok: true, note: t('sec.signedTrusted') };
        return { ok: true, note: t('sec.signedUnknown', { fp: fp.slice(0, 9) }) };
      },

      // The engine is for key holders only: this browser must hold a private key whose public key is in
      // allowed-keys.json (published with the site). A fresh challenge is signed, so a copied public key is not enough.
      async authorizeEngine() {
        await ready;
        access = null;
        if (!sec.supported() || !keys.own) {
          toast(t('sec.engineNoKey'));
          return false;
        }
        if (gate) return authorizeWithGate();
        const list = await loadAllowed();
        if (!list) {
          toast(t('sec.engineListFailed'));
          return false;
        }
        const fp = await sec.fingerprint(keys.own.publicKey);
        const entry = list.find((k) => k.fingerprint === fp);
        if (entry && (await sec.proves(keys.own.privateKey, entry.publicKey))) {
          access = { gate: '', token: '' };
          return true;
        }
        toast(t('sec.engineNotAllowed', { fp: fp.slice(0, 9) }));
        return false;
      },

      render,
    };
  };
})(window.Gomoku = window.Gomoku || {});
