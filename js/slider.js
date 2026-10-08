/* Sliding highlight for segmented controls (.seg: the selected button has class "on") and for the tab bar
   (.tabs: aria-selected="true"). A single absolutely positioned thumb glides to the selected button; the
   buttons keep their own state, so nothing else needs to know about it. Without this script the CSS
   falls back to the plain per-button highlight (the `slide` class is only added once a thumb exists). */
(function () {
  'use strict';

  function attach(host, isTabs) {
    const thumb = document.createElement('span');
    thumb.className = isTabs ? 'tab-thumb' : 'seg-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    host.prepend(thumb);
    const selected = () => host.querySelector(isTabs ? 'button[aria-selected="true"]' : 'button.on');
    let ready = false;

    function place() {
      const btn = selected();
      if (!btn || !btn.offsetWidth) {
        if (host.classList.contains('slide')) host.classList.remove('slide');
        return;
      }
      const h = isTabs ? 2 : btn.offsetHeight;
      const y = isTabs ? btn.offsetTop + btn.offsetHeight - 2 : btn.offsetTop;
      thumb.style.width = `${btn.offsetWidth}px`;
      thumb.style.height = `${h}px`;
      thumb.style.transform = `translate(${btn.offsetLeft}px, ${y}px)`;
      if (!isTabs) thumb.style.borderRadius = getComputedStyle(btn).borderRadius;
      if (!host.classList.contains('slide')) host.classList.add('slide');
      if (!ready) {
        // Let the first placement land without animating from the corner.
        ready = true;
        requestAnimationFrame(() => requestAnimationFrame(() => thumb.classList.add('ready')));
      }
    }

    const ro = new ResizeObserver(place);
    ro.observe(host);
    for (const b of host.querySelectorAll('button')) ro.observe(b);
    new MutationObserver(place).observe(host, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'hidden'] });
    place();
  }

  function init() {
    if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    for (const el of document.querySelectorAll('.seg')) attach(el, false);
    for (const el of document.querySelectorAll('.tabs')) attach(el, true);
  }

  init();
})();
