// One shared icon set: 24px outline paths drawn by the `.ico` style (stroke follows the text colour).
// Markup opts in with data-icon="name" (applied by G.i18n.apply, which keeps the translated label in a <span>).
(function (G) {
  'use strict';

  const PATHS = {
    // Games tab
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    // Navigation and actions
    left: '<path d="M15 6l-6 6 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5"/>',
    eraser: '<path d="M7 20h12M5 15l8-9a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-5 5H9z"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
    clipboard: '<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    // Tabs and modes
    board: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5z" transform="rotate(0)"/><path d="M5 19l2-2"/>',
    power: '<path d="M12 3v8M7 6.5a7 7 0 1 0 10 0"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  };

  const svg = (name) => (PATHS[name]
    ? `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
    : '');

  G.icons = { PATHS, svg };
})(window.Gomoku = window.Gomoku || {});
