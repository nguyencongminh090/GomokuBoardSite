// "Install the app" banner for phones. Android Chrome fires `beforeinstallprompt`, which is kept and replayed from the
// banner's button; iOS Safari has no such event, so the banner only explains Share -> Add to Home Screen.
// Never shown inside the installed app, on desktop, or for DISMISS_DAYS after the host closed it.
(function (G) {
  'use strict';

  const DISMISS_DAYS = 14;
  const SHOW_DELAY = 3000;

  G.createInstallPrompt = function (deps) {
    const { t, store } = deps;
    const $ = (sel) => document.querySelector(sel);
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const phone = ios || /Android/.test(ua) || matchMedia('(max-width: 860px) and (pointer: coarse)').matches;
    let deferred = null;
    let timer = 0;

    function installed() {
      return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    }

    function suppressed() {
      return Date.now() - store.installDismissedAt() < DISMISS_DAYS * 864e5;
    }

    function hide() {
      clearTimeout(timer);
      $('#installBanner').hidden = true;
    }

    function show() {
      if (installed() || suppressed()) return;
      const canPrompt = !!deferred;
      $('#installText').textContent = t(canPrompt ? 'install.android' : 'install.ios');
      $('#installBtn').hidden = !canPrompt;
      $('#installBanner').hidden = false;
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(show, SHOW_DELAY);
    }

    // Re-render the text after a language change while the banner is open.
    function refresh() {
      if (!$('#installBanner').hidden) show();
    }

    function start() {
      if (!phone || installed()) return;
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferred = e;
        schedule();
      });
      window.addEventListener('appinstalled', () => {
        deferred = null;
        hide();
      });
      // No install event on iOS (or when the browser already holds the app back): explain it by hand.
      if (ios) schedule();
      $('#installClose').addEventListener('click', () => {
        store.dismissInstall();
        hide();
      });
      $('#installBtn').addEventListener('click', async () => {
        if (!deferred) return;
        const ev = deferred;
        deferred = null;
        hide();
        ev.prompt();
        const choice = await ev.userChoice.catch(() => null);
        if (!choice || choice.outcome !== 'accepted') store.dismissInstall();
      });
    }

    return { start, refresh };
  };
})(window.Gomoku = window.Gomoku || {});
