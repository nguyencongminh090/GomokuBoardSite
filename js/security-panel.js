// Security card in Settings: key pair, password dialog, public-key sharing, trusted keys,
// and the signing / verifying used by Export and Import.
(function (G) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const sec = G.security;
  const store = G.storage;
  const { t } = G.i18n;

  G.createSecurityPanel = function (deps) {
    const { esc, toast, settings, onLock } = deps;
    const keys = store.loadKeys();
    let unlocked = null; // decrypted CryptoKey, kept in memory only until Lock or page close

    const dlg = $('#pwDialog');
    const form = $('#pwForm');
    const input = $('#pwInput');
    const confirmInput = $('#pwConfirm');
    const errorEl = $('#pwError');
    const okBtn = $('#pwOk');

    // ---------- password dialog ----------

    // Resolves with the password once `check(password)` returns no error message, or null if cancelled.
    // `check` may be async; its message is shown in the dialog and the dialog stays open.
    function askPassword({ title, note, confirm = false, check }) {
      $('#pwTitle').textContent = title;
      $('#pwNote').textContent = note;
      $('#pwConfirmRow').hidden = !confirm;
      input.autocomplete = confirm ? 'new-password' : 'current-password';
      input.value = confirmInput.value = errorEl.textContent = '';
      dlg.returnValue = '';
      return new Promise((resolve) => {
        let password = null;
        const onSubmit = async (e) => {
          e.preventDefault();
          okBtn.disabled = true; // key derivation takes a moment
          let error = null;
          try {
            if (confirm && input.value.length < sec.MIN_PASSWORD) error = t('sec.pw.tooShort', { min: sec.MIN_PASSWORD });
            else if (confirm && input.value !== confirmInput.value) error = t('sec.pw.mismatch');
            else error = await check(input.value);
          } catch (err) {
            error = t('sec.pw.wrong');
          }
          okBtn.disabled = false;
          errorEl.textContent = error || '';
          if (error) {
            input.focus();
            return;
          }
          password = input.value;
          dlg.close('ok');
        };
        const onClose = () => {
          form.removeEventListener('submit', onSubmit);
          dlg.removeEventListener('close', onClose);
          input.value = confirmInput.value = ''; // do not leave the password in the DOM
          resolve(password);
        };
        form.addEventListener('submit', onSubmit);
        dlg.addEventListener('close', onClose);
        dlg.showModal();
        input.focus();
      });
    }

    $('#pwCancel').addEventListener('click', () => dlg.close('cancel'));

    // Asks for the current password and returns { password, key } or null. Works for any stored record.
    async function askCurrent(record = keys.own) {
      let key = null;
      const password = await askPassword({
        title: t('sec.pw.enterTitle'),
        note: t('sec.pw.enterNote'),
        check: async (pw) => {
          try {
            key = await sec.unlock(record, pw);
            return null;
          } catch (e) {
            return t('sec.pw.wrong');
          }
        },
      });
      return password === null ? null : { password, key };
    }

    function persistKeys() {
      if (!store.saveKeys(keys)) toast(t('storage.failed'));
    }

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

    // ---------- actions ----------

    async function createKeys() {
      let record = null;
      const pw = await askPassword({
        title: t('sec.pw.createTitle'),
        note: t('sec.pw.createNote'),
        confirm: true,
        check: async (password) => {
          record = await sec.createRecord(password);
          return null;
        },
      });
      if (pw === null) return;
      keys.own = record;
      keys.lockEngine = true; // a new key holder gets the engine gate by default
      unlocked = await sec.unlock(record, pw);
      persistKeys();
      render();
      toast(t('sec.keyCreated'));
    }

    async function toggleLock() {
      if (unlocked) {
        unlocked = null;
        onLock();
      } else {
        const r = await askCurrent();
        if (!r) return;
        unlocked = r.key;
      }
      render();
    }

    async function toggleEngineLock() {
      if (!(await askCurrent())) return;
      keys.lockEngine = !keys.lockEngine;
      if (keys.lockEngine && !unlocked) onLock();
      persistKeys();
      render();
      toast(t(keys.lockEngine ? 'sec.engineLocked' : 'sec.engineOpen'));
    }

    async function copyPublic() {
      const text = JSON.stringify(await sec.publicKeyFile(keys.own.publicKey), null, 1);
      try {
        await navigator.clipboard.writeText(text);
        toast(t('sec.copied'));
      } catch (e) {
        toast(t('sec.copyFailed'));
      }
    }

    async function savePublic() {
      download('gomoku-public-key.json', await sec.publicKeyFile(keys.own.publicKey));
    }

    async function backup() {
      if (!(await askCurrent())) return;
      download('gomoku-private-key-backup.json', { format: 'gomoku-private-key', ...keys.own });
      toast(t('sec.backedUp'));
    }

    async function changePassword() {
      const current = await askCurrent();
      if (!current) return;
      let next = null;
      const pw = await askPassword({
        title: t('sec.pw.newTitle'),
        note: t('sec.pw.createNote'),
        confirm: true,
        check: async (password) => {
          next = await sec.rewrap(keys.own, current.password, password);
          return null;
        },
      });
      if (pw === null) return;
      keys.own = next;
      persistKeys();
      toast(t('sec.pwChanged'));
    }

    async function deleteKeys() {
      if (!confirm(t('sec.deleteConfirm'))) return;
      if (!(await askCurrent())) return;
      keys.own = null;
      keys.lockEngine = false;
      unlocked = null;
      persistKeys();
      render();
      toast(t('sec.deleted'));
    }

    async function restore(file) {
      const raw = await readJson(file);
      if (!raw || raw.format !== 'gomoku-private-key' || !sec.isRecord(raw)) {
        toast(t('sec.badBackup'));
        return;
      }
      const { format, ...record } = raw;
      const r = await askCurrent(record);
      if (!r) return;
      keys.own = record;
      unlocked = r.key;
      persistKeys();
      render();
      toast(t('sec.restored'));
    }

    async function addTrusted(file) {
      const parsed = await sec.parsePublicKeyFile(await readJson(file));
      if (!parsed) {
        toast(t('sec.badKeyFile'));
        return;
      }
      if (keys.trusted.some((k) => k.fingerprint === parsed.fingerprint)) {
        toast(t('sec.trustedDup'));
        return;
      }
      keys.trusted.push(parsed);
      persistKeys();
      render();
      toast(t('sec.trustedAdded'));
    }

    function removeTrusted(fp) {
      keys.trusted = keys.trusted.filter((k) => k.fingerprint !== fp);
      persistKeys();
      render();
    }

    // ---------- card ----------

    async function render() {
      const el = $('#securityBody');
      $('#signRow').hidden = !keys.own;
      if (!sec.supported()) {
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
        <label class="btn small"><span>${esc(t('sec.addTrusted'))}</span><input type="file" data-sec-file="trusted" accept=".json,application/json" hidden></label>`;

      if (!keys.own) {
        el.innerHTML = `
          <p class="muted small-text">${esc(t('sec.intro'))}</p>
          <div class="btn-row">
            ${btn('create', 'sec.create', 'primary')}
            <label class="btn small"><span>${esc(t('sec.restore'))}</span><input type="file" data-sec-file="restore" accept=".json,application/json" hidden></label>
          </div>
          ${trustedHtml}`;
        return;
      }
      const fp = await sec.fingerprint(keys.own.publicKey);
      const date = new Date(keys.own.createdAt).toLocaleDateString(G.i18n.locale);
      el.innerHTML = `
        <p class="muted small-text">${esc(t('sec.intro'))}</p>
        <div class="sub-label">${esc(t('sec.fingerprint'))}</div>
        <code class="fingerprint">${esc(fp)}</code>
        <p class="muted small-text">${esc(t('sec.created', { date }))} · ${esc(t(unlocked ? 'sec.unlocked' : 'sec.locked'))}</p>
        <div class="btn-row">
          ${btn('toggleLock', unlocked ? 'sec.lock' : 'sec.unlock')}
          ${btn('copyPublic', 'sec.copyPublic')}
          ${btn('savePublic', 'sec.savePublic')}
        </div>
        <div class="btn-row">
          ${btn('backup', 'sec.backup')}
          ${btn('changePassword', 'sec.changePw')}
          ${btn('deleteKeys', 'sec.delete')}
        </div>
        <p class="muted small-text">${esc(t(keys.lockEngine ? 'sec.engineStateLocked' : 'sec.engineStateOpen'))}</p>
        <div class="btn-row">${btn('toggleEngineLock', keys.lockEngine ? 'sec.engineUnlockAll' : 'sec.engineLockAll')}</div>
        ${trustedHtml}`;
    }

    // Clicks and file choices are delegated so buttons rendered later work too.
    const ACTIONS = { create: createKeys, toggleLock, copyPublic, savePublic, backup, changePassword, deleteKeys, toggleEngineLock };
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
      if (file) (f.dataset.secFile === 'restore' ? restore : addTrusted)(file);
    });

    // ---------- export / import hooks ----------

    return {
      // Returns the export body with a signature when signing applies, the body as is when it does not,
      // and null when the host cancelled the password prompt or signing failed (no file should be written).
      async signExport(body) {
        if (!keys.own || !settings().signExports || !sec.supported()) return body;
        if (!unlocked) {
          const r = await askCurrent();
          if (!r) return null;
          unlocked = r.key;
          render();
        }
        try {
          return await sec.signExport(keys.own, unlocked, body);
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

      // True when this session may use the engine: no gate, or the key holder has unlocked the private key.
      async authorizeEngine() {
        if (!keys.own || !keys.lockEngine) return true;
        if (unlocked) return true;
        toast(t('sec.engineNeedsKey'));
        const r = await askCurrent();
        if (!r) return false;
        unlocked = r.key;
        render();
        return true;
      },

      render,
    };
  };
})(window.Gomoku = window.Gomoku || {});
