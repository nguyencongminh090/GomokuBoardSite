// "Install the app" banner for phones. Android Chrome fires `beforeinstallprompt`, which is kept and replayed from the
// banner's button; iOS has no such event, so the banner explains Add to Home Screen for the browser in use. In-app
// browsers (TikTok, Facebook, Zalo...) cannot add to the Home Screen at all: there the button copies the link for Safari.
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
    // iOS flavour: 'inapp' (an app's own web view), 'other' (Chrome, Edge, Firefox: Share is in their own menu) or 'safari'.
    const iosKind = !ios ? '' : /BytedanceWebview|musical_ly|TikTok|FBAN|FBAV|FB_IAB|Instagram|Zalo|Messenger|Line\/|LinkedInApp|Snapchat/i.test(ua)
      ? 'inapp' : /CriOS|EdgiOS|FxiOS|OPiOS/.test(ua) ? 'other' : 'safari';
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
      const copy = iosKind === 'inapp';
      $('#installText').textContent = t(canPrompt ? 'install.android' : copy ? 'install.iosInApp' : iosKind === 'other' ? 'install.iosOther' : 'install.ios');
      $('#installBtn').textContent = t(copy ? 'install.copy' : 'install.button');
      $('#installBtn').hidden = !canPrompt && !copy;
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
        if (iosKind === 'inapp') {
          try {
            await navigator.clipboard.writeText(location.href.split('#')[0]);
            $('#installText').textContent = t('install.copied');
          } catch (err) {
            $('#installText').textContent = t('install.copyFailed', { url: location.href.split('#')[0] });
          }
          return;
        }
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
