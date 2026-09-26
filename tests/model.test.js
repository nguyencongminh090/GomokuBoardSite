// Checks for the model (coords, game), i18n dictionaries, contrast maths and colour presets. Run: node tests/model.test.js
// The site uses classic scripts that attach to window.Gomoku, so they are evaluated with a stub window.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
for (const f of ['js/i18n.js', 'js/contrast.js', 'js/coords.js', 'js/settings.js', 'js/game.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
}
const G = window.Gomoku;

function test(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    process.exitCode = 1;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}

test('spiral numbers every cell exactly once', () => {
  for (const n of [5, 15, 19, 20, 26]) {
    const s = G.coords.spiral(n);
    assert.equal(new Set(s).size, n * n);
    assert(!s.includes(0));
    assert.equal(Math.max(...s), n * n);
  }
});

test('spiral starts at the centre and turns clockwise', () => {
  const s = G.coords.spiral(15);
  assert.equal(s[7 * 15 + 7], 1);
  assert.equal(s[7 * 15 + 8], 2); // right
  assert.equal(s[8 * 15 + 8], 3); // down
});

test('edge labels: row 1 at the bottom', () => {
  assert.equal(G.coords.label(7, 7, 15), 'H8');
  assert.equal(G.coords.label(0, 14, 15), 'A1');
});

test('playing after Back creates a branch; replaying a move reuses it', () => {
  const g = G.Game.create(15, 't');
  assert(g.play(7, 7) && g.play(8, 8) && g.play(9, 9));
  assert(!g.play(7, 7), 'occupied cell');
  g.back();
  g.back();
  assert(g.play(6, 6));
  assert.equal(g.nodes[1].children.length, 2);
  assert.equal(g.line().length, 2);
  assert(g.sibling(-1));
  assert.equal(g.line().length, 3, 'old branch keeps its preferred line');
  g.back();
  assert(g.play(8, 8));
  assert.equal(g.nodes.length, 5, 'no duplicate node');
});

test('walls block play and cannot cover a move anywhere in the tree', () => {
  const g = G.Game.create(15);
  g.play(7, 7);
  g.back();
  assert.equal(g.toggleWall(7, 7), 'blocked');
  assert.equal(g.toggleWall(0, 0), 'added');
  assert(!g.play(0, 0));
  assert.equal(g.toggleWall(0, 0), 'removed');
});

test('serialisation round-trips', () => {
  const g = G.Game.create(19, 'r');
  g.play(1, 1);
  g.play(2, 2);
  g.back();
  g.play(3, 3);
  g.toggleWall(5, 5);
  const j = JSON.parse(JSON.stringify(g.toJSON()));
  assert.deepEqual(new G.Game(j).toJSON(), j);
});

test('removeSubtree drops descendants and keeps indices valid', () => {
  const g = G.Game.create(15);
  g.play(7, 7);
  g.play(8, 8);
  g.play(9, 9);
  g.goTo(1);
  g.play(6, 6);
  g.goTo(2);
  assert(g.removeSubtree(2));
  assert.equal(g.nodes.length, 3);
  assert.equal(g.cur, 1);
  assert.deepEqual(new G.Game(g.toJSON()).toJSON(), g.toJSON());
  g.toEnd();
  assert.equal(g.nodes[g.cur].x, 6);
});

test('corrupt or out-of-range data is rejected', () => {
  assert.throws(() => new G.Game({ size: 15, nodes: [[5, 1, 1]] }));
  assert.throws(() => new G.Game({ size: 40 }));
  assert.throws(() => new G.Game({ size: 15, nodes: [[0, 15, 0]] }));
});

test('every language defines the same message keys', () => {
  const [first, ...rest] = G.i18n.LANGS;
  const keys = (lang) => Object.keys(G.i18n.STRINGS[lang]).sort();
  for (const lang of rest) assert.deepEqual(keys(lang), keys(first), `${lang} vs ${first}`);
});

test('t() falls back to English, then to the key', () => {
  assert.equal(G.i18n.t('tab.play'), 'Chơi');
  assert.equal(G.i18n.t('no.such.key'), 'no.such.key');
  assert.equal(G.i18n.t('games.moves', { n: 3 }), '3 nước');
});

test('contrast ratio matches WCAG reference values', () => {
  const C = G.contrast;
  assert.equal(C.ratio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(C.ratio('#777777', '#777777'), 1);
  assert.equal(C.ratio('#767676', '#ffffff').toFixed(2), '4.54'); // well-known AA text boundary grey
});

test('every preset meets WCAG AA in both coordinate modes', () => {
  for (const theme of ['paper', 'stone']) {
    for (const preset of G.PRESETS[theme]) {
      for (const coords of ['edge', 'cell']) {
        const s = structuredClone(G.DEFAULT_SETTINGS);
        const { name, ...values } = preset;
        Object.assign(s, { theme, coords });
        Object.assign(s[theme], values);
        const fails = G.contrast.audit(s).filter((it) => !it.ok);
        assert.deepEqual(fails.map((it) => `${it.what} ${it.ratio.toFixed(2)}`), [], `${theme}/${name}/${coords}`);
      }
    }
  }
});

test('default settings pass the audit and match a preset', () => {
  assert.deepEqual(G.contrast.audit(G.DEFAULT_SETTINGS).filter((it) => !it.ok), []);
  const { name, ...cream } = G.PRESETS.paper.find((p) => p.name === 'Cream');
  for (const [k, v] of Object.entries(cream)) assert.equal(G.DEFAULT_SETTINGS.paper[k], v, k);
});

test('a suggested fix passes and keeps the hue', () => {
  const s = structuredClone(G.DEFAULT_SETTINGS);
  s.paper.xColor = '#ffb3b3'; // pale pink on cream paper
  const item = G.contrast.audit(s).find((it) => it.key === 'paper.xColor');
  assert(!item.ok && item.suggestion);
  assert(G.contrast.ratio(item.suggestion, s.paper.bg) >= 3 * G.contrast.SUGGEST_MARGIN);
  const [r, g, b] = G.contrast.parse(item.suggestion);
  assert(r > g && r > b, 'still a red');
});

test('old shared wall colour migrates to both themes', () => {
  const raw = G.migrateSettings({ wallColor: '#123456', paper: {} });
  assert.equal(raw.paper.wall, '#123456');
  assert.equal(raw.stone.wall, '#123456');
});
