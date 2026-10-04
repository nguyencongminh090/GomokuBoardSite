// Checks for the model (coords, game), i18n dictionaries, contrast maths, colour presets and the engine protocol.
// Run: node tests/model.test.js
// The site uses classic scripts that attach to window.Gomoku, so they are evaluated with a stub window.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
for (const f of ['js/i18n.js', 'js/contrast.js', 'js/coords.js', 'js/voice.js', 'js/settings.js', 'js/game.js', 'js/security.js', 'js/explain.js', 'js/engine.js', 'js/search.js', 'js/search-panel.js']) {
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

// ---------- engine protocol ----------

const EP = G.engineProtocol;

test('engine board block: walls as colour 3, stones in move order, first player = 1', () => {
  const g = G.Game.create(15, 't');
  g.toggleWall(3, 4);
  g.toggleWall(0, 0);
  g.play(7, 7);
  g.play(8, 8);
  g.play(9, 7);
  assert.equal(EP.boardBlock(g), 'YXBOARD\n0,0,3\n3,4,3\n7,7,1\n8,8,2\n9,7,1\nDONE');
});

test('engine board block follows the cursor, not the end of the line', () => {
  const g = G.Game.create(15, 't');
  g.play(7, 7);
  g.play(8, 8);
  g.back();
  assert.equal(EP.boardBlock(g), 'YXBOARD\n7,7,1\nDONE');
  g.toStart();
  assert.equal(EP.boardBlock(g, 'BOARD'), 'BOARD\nDONE');
});

test('engine lines: moves, messages, errors, info and about', () => {
  assert.deepEqual(EP.parseLine('7,8'), { type: 'move', moves: [[7, 8]] });
  assert.deepEqual(EP.parseLine('7,8 9,10'), { type: 'move', moves: [[7, 8], [9, 10]] });
  assert.deepEqual(EP.parseLine('-1,-1'), { type: 'move', moves: [[-1, -1]] });
  assert.deepEqual(EP.parseLine('OK'), { type: 'ok' });
  assert.deepEqual(EP.parseLine('MESSAGE Load config from /config.toml'), { type: 'message', text: 'Load config from /config.toml' });
  assert.deepEqual(EP.parseLine('ERROR Board is not empty.'), { type: 'error', text: 'Board is not empty.' });
  assert.deepEqual(EP.parseLine('INFO BESTLINE 9,9 7,9'), { type: 'info', key: 'BESTLINE', value: '9,9 7,9' });
  assert.equal(EP.parseLine('name="Rapfi", version="0.43.02"').type, 'about');
  assert.equal(EP.parseLine('7,8 9,10 11,12').type, 'other');
});

test('engine values: centipawns and mate scores', () => {
  assert.equal(EP.parseValue('-47').cp, -47);
  assert.deepEqual(EP.parseValue('+M5'), { text: '+M5', mate: 1, plies: 5 });
  assert.deepEqual(EP.parseValue('-M12'), { text: '-M12', mate: -1, plies: 12 });
  assert.equal(EP.parseValue('+M*').mate, 1);
});

test('engine INFO feed is collected per principal variation', () => {
  const c = new EP.InfoCollector();
  const feed = (pv, depth, line) => {
    const done = [['PV', String(pv)], ['NUMPV', '2'], ['DEPTH', String(depth)], ['SELDEPTH', '9'], ['EVAL', '-47'],
      ['WINRATE', '0.41'], ['BESTLINE', line], ['PV', 'DONE']].map(([k, v]) => c.add(k, v));
    return done[done.length - 1];
  };
  assert.equal(feed(0, 2, '9,9 7,9'), true);
  feed(1, 2, '6,6');
  feed(0, 3, '5,5 9,9 1,1');
  assert.equal(c.lines.length, 2);
  assert.equal(c.lines[0].depth, 3);
  assert.deepEqual(c.lines[0].line, [[5, 5], [9, 9], [1, 1]]);
  assert.equal(c.lines[1].depth, 2, 'other PVs keep their last completed depth');
  assert.equal(c.lines[0].winrate, 0.41);
});

test('engine config commands use KB for the hash and turn time in ms', () => {
  const cmds = new Map(EP.configCommands({ rule: 4, threads: 8, hashMB: 128, depth: 99, strength: 100, timeMs: 5000 }));
  assert.equal(cmds.get('HASH_SIZE'), 131072);
  assert.equal(cmds.get('TIMEOUT_TURN'), 5000);
  assert.equal(cmds.get('TIMEOUT_MATCH'), 0);
  assert.equal(cmds.get('RULE'), 4);
});

test('engine settings defaults have the types their controls produce', () => {
  const e = G.DEFAULT_SETTINGS.engine;
  for (const k of ['moveTime', 'analysisTime', 'nbest', 'depth', 'strength', 'threads', 'selfDist', 'oppDist']) {
    assert.equal(typeof e[k], 'number', k);
  }
  for (const k of ['side', 'rule', 'hash']) assert.equal(typeof e[k], 'string', k);
});

(async () => {
  const S = G.security;
  const run = async (name, fn) => {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      process.exitCode = 1;
      console.log(`FAIL ${name}\n     ${e.message}`);
    }
  };
  const pair = await S.createKeyPair();
  const body = { format: 'gomoku-board', version: 1, exportedAt: 'x', games: [{ id: 'a', nodes: [[0, 1, 2]] }] };

  await run('private key is non-extractable and never appears in the record data', async () => {
    assert(S.isKeyPair(pair));
    assert.equal(pair.privateKey.extractable, false);
    await assert.rejects(crypto.subtle.exportKey('pkcs8', pair.privateKey));
    assert(!JSON.stringify(pair).includes('"d"'));
  });
  await run('signed export verifies after a JSON round trip', async () => {
    const signed = JSON.parse(JSON.stringify(await S.signExport(pair, body), null, 1));
    assert.equal((await S.verifyExport(signed)).status, 'valid');
  });
  await run('edited or re-signed export is rejected', async () => {
    const signed = JSON.parse(JSON.stringify(await S.signExport(pair, body)));
    signed.games[0].nodes[0][1] = 9;
    assert.equal((await S.verifyExport(signed)).status, 'invalid');
    const other = await S.createKeyPair();
    const forged = JSON.parse(JSON.stringify(await S.signExport(pair, body)));
    forged.signature.publicKey = other.publicKey;
    assert.equal((await S.verifyExport(forged)).status, 'invalid');
  });
  await run('unsigned export and legacy arrays report none', async () => {
    assert.equal((await S.verifyExport(body)).status, 'none');
    assert.equal((await S.verifyExport([body])).status, 'none');
  });
  await run('engine challenge passes only for the matching public key', async () => {
    const other = await S.createKeyPair();
    assert(await S.proves(pair.privateKey, pair.publicKey));
    assert(!(await S.proves(pair.privateKey, other.publicKey)));
  });
  await run('key code is 44 characters and round trips to the same key', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await S.createKeyPair();
      const code = S.keyCode(r.publicKey);
      assert.equal(code.length, 44);
      assert.deepEqual((await S.parseKeyCode(code)).publicKey, r.publicKey);
    }
    assert.equal(await S.parseKeyCode('nonsense'), null);
    assert.equal(await S.parseKeyCode('A'.repeat(44)), null);
  });
  await run('public key file round trips and rejects junk', async () => {
    const file = await S.publicKeyFile(pair.publicKey);
    const parsed = await S.parsePublicKeyFile(JSON.parse(JSON.stringify(file)));
    assert.equal(parsed.fingerprint, file.fingerprint);
    assert.equal(await S.parsePublicKeyFile({ format: 'gomoku-public-key', publicKey: { kty: 'EC' } }), null);
  });
  await run('engine client refuses to load or search without the guard', () => {
    const c = new G.EngineClient(() => {});
    c.load('single');
    assert.equal(c.state, 'error');
    c.run({ kind: 'move', block: '', size: 15, config: {}, go: 'YXNBEST 1' });
    assert.equal(c.next, null);
  });
})();

function threatBoard(size, stones, walls = []) {
  return { size, walls: new Set(walls), stones: new Map(stones.map(([x, y, p]) => [y * size + x, p])) };
}

test('threat classifier: five, four, open three, blocked three', () => {
  const T = G.explain;
  let b = threatBoard(15, [[3, 7, 0], [4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0]]);
  assert.equal(T.classify(b, 7, 7), 'five');
  b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0]]);
  assert.equal(T.classify(b, 7, 7), 'four');
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0]]);
  assert.equal(T.classify(b, 7, 7), 'three');
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [4, 7, 1], [8, 7, 1]]);
  assert.equal(T.classify(b, 7, 7), '');
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0]], [7 * 15 + 4, 7 * 15 + 8]);
  assert.equal(T.classify(b, 7, 7), '');
});

test('attack chain must end in a victory and traces back from it', () => {
  const T = G.explain;
  // VCF: row three blocked on the left by white; cross four (8,7), white must block (9,7), cross makes an open four in the column
  const b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [7, 5, 0], [7, 6, 0], [4, 7, 1], [1, 1, 1]]);
  const c = T.chain(b, [[8, 7], [9, 7], [7, 8], [1, 2]], 0);
  assert(c, 'chain expected');
  assert.equal(c.kind, 'VCF');
  assert.equal(c.start, 0);
  assert.equal(c.end, 4); // the solver plays the rest: block, then the five
  assert.equal(c.finish, 'five');
  assert.equal(c.added, 4); // the PV's own moves are kept
  assert.equal(c.line.length, 5);
  // a quiet first move is not part of the chain: the chain starts at the first threat of the winning run
  const q = T.chain(b, [[12, 12], [1, 2], [8, 7], [9, 7], [7, 8]], 0);
  assert(q && q.start === 2 && q.end === 6, 'quiet move excluded');
  // an engine PV that stops early: the solver finishes the whole VCF (four, forced block, open four, block, five)
  const early = T.chain(b, [[8, 7]], 0);
  assert(early && early.kind === 'VCF' && early.added === 1 && early.finish === 'five', 'solver completes the win');
  // a PV that ends with the defender's block: the attacker's win is found from there
  const blocked = T.chain(b, [[8, 7], [9, 7]], 0);
  assert(blocked && blocked.start === 0 && blocked.finish === 'five', 'win found after the last block');
  // an open three that leads nowhere is not a victory, so nothing is highlighted
  const t = threatBoard(15, [[6, 7, 0], [7, 7, 0], [1, 1, 1]]);
  assert(T.chain(t, [[8, 7], [5, 7]], 0) === null, 'three then block is no victory');
  // VCT: a double open three wins although it holds no four
  const d = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 5, 0], [7, 6, 0], [1, 1, 1]]);
  const v = T.chain(d, [[7, 7]], 0);
  assert(v && v.kind === 'VCT' && v.finish === '3-3');
  // the defender may be the winner of the line
  const w = T.chain(b, [[12, 12], [8, 7], [9, 7]], 0);
  assert(w === null || w.start >= 1, 'only the winning side is traced');
});

test('threat finish: open four, 4-3 and 3-3 combinations', () => {
  const T = G.explain;
  let b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0]]);
  assert.equal(T.finish(b, 7, 7), ''); // a lone three is not a finish
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [8, 7, 0]]);
  assert.equal(T.finish(b, 8, 7), 'open4');
  // 4-3 through (7,7): four along the row (4..7 blocked left by X at 3) and open three down the column
  b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0], [3, 7, 1], [7, 5, 0], [7, 6, 0]]);
  assert.equal(T.finish(b, 7, 7), '4-3');
  // 3-3: open three along the row and along the column
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [7, 5, 0], [7, 6, 0]]);
  assert.equal(T.finish(b, 7, 7), '3-3');
});

test('threat defences: the forced block of a four and of an open three', () => {
  const T = G.explain;
  // cross (0) has a four, white (1) to move must block the one completing cell
  let b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0], [3, 7, 1]]);
  assert.deepEqual(T.defences(b, 1), [7 * 15 + 8]);
  // open three: blocking cells are the extension cells; a far-away cell is not a defence
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0]]);
  const d = T.defences(b, 1);
  assert(d.includes(7 * 15 + 4) && d.includes(7 * 15 + 8));
  assert(!d.includes(0));
  assert.equal(T.defences(threatBoard(15, [[7, 7, 0]]), 1), null);
  // side to move wins at once: nothing to defend
  b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0], [4, 8, 1], [5, 8, 1], [6, 8, 1], [7, 8, 1]]);
  assert.equal(T.defences(b, 1), null);
});

test('threats treat walls like the board edge', () => {
  const T = G.explain;
  const at = (x, y) => y * 15 + x;
  // four with a wall on one end is still a four (one completing cell); walls on both ends make it dead
  let b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0]], [at(3, 7)]);
  assert.equal(T.classify(b, 7, 7), 'four');
  assert.deepEqual(T.defences(threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0]], [at(3, 7)]), 1), [at(8, 7)]);
  b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [6, 7, 0], [7, 7, 0]], [at(3, 7), at(8, 7)]);
  assert.equal(T.classify(b, 7, 7), '');
  // stones on the far side of a wall do not join the line
  b = threatBoard(15, [[4, 7, 0], [5, 7, 0], [7, 7, 0], [8, 7, 0], [9, 7, 0]], [at(6, 7)]);
  assert.equal(T.classify(b, 9, 7), '');
  // a wall next to the stone makes an open three half-open: no three, and no map entry for the cell behind it
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0]], [at(4, 7)]);
  assert.equal(T.classify(b, 7, 7), '');
  // a line that steps onto a wall ends the chain there
  b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [7, 5, 0], [7, 6, 0]], [at(9, 7)]);
  assert(T.chain(b, [[8, 7], [1, 1], [7, 8]], 0) === null || T.chain(b, [[9, 7], [1, 1], [7, 8]], 0) === null);
  assert(T.chain(b, [[9, 7], [1, 1], [7, 8]], 0) === null);
});

test('threat bitboards: every direction on the largest board, edges and corners', () => {
  const T = G.explain;
  const n = 26;
  // anti-diagonal five reaching the corner area, diagonal four against the edge, column and row at the far side
  let b = threatBoard(n, [[25, 0, 0], [24, 1, 0], [23, 2, 0], [22, 3, 0], [21, 4, 0]]);
  assert.equal(T.classify(b, 21, 4), 'five');
  b = threatBoard(n, [[22, 22, 0], [23, 23, 0], [24, 24, 0], [25, 25, 0]]);
  assert.equal(T.classify(b, 25, 25), 'four'); // the edge closes one end: one completing cell
  assert.deepEqual(T.defences(threatBoard(n, [[22, 22, 0], [23, 23, 0], [24, 24, 0], [25, 25, 0]]), 1), [21 * n + 21]);
  b = threatBoard(n, [[0, 10, 0], [1, 10, 0], [2, 10, 0]]);
  assert.equal(T.classify(b, 2, 10), ''); // a three that starts at the edge is not open
  b = threatBoard(n, [[10, 25, 0], [11, 25, 0], [12, 25, 0]]);
  assert.equal(T.classify(b, 12, 25), 'three'); // a row along the edge is a normal line
  b = threatBoard(n, [[25, 10, 0], [25, 11, 0], [25, 12, 0]]);
  assert.equal(T.classify(b, 25, 12), 'three');
});

test('solver returns one winning line ending in a five', () => {
  const T = G.explain;
  const b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [7, 5, 0], [7, 6, 0], [4, 7, 1], [1, 1, 1]]);
  const line = T.solve(b, 0, 'VCF', true);
  assert(line && line.length % 2 === 1, 'attacker moves first and last');
  const last = line[line.length - 1];
  // replay it: the last move must be a five
  const stones = new Map(b.stones);
  line.forEach(([x, y], i) => stones.set(y * 15 + x, i % 2));
  assert.equal(T.classify({ size: 15, walls: b.walls, stones }, last[0], last[1]), 'five');
  assert.equal(T.solve(threatBoard(15, [[7, 7, 0]]), 0, 'VCT', true), null);
});

test('solver models counter-attacks: a double three is refuted by the defender\'s own four-then-open-four', () => {
  const T = G.explain;
  // cross plays (12,10): a double open three. Without counter-play that wins.
  const cross = [[10, 10, 0], [11, 10, 0], [12, 8, 0], [12, 9, 0], [2, 6, 0]];
  const calm = threatBoard(15, cross.concat([[1, 1, 1], [1, 3, 1], [13, 13, 1], [13, 1, 1], [8, 13, 1]]));
  const win = T.solve(calm, 0, 'VCT', true);
  assert(win && win[0][0] === 12 && win[0][1] === 10, 'double three wins when the defender has no counter-play');
  // white owns a 4-3 at (6,6): four in the row (blocked by cross at (2,6)) plus an open three in the column.
  // Counter: white (6,6) four, cross must block (7,6), then white (6,7) makes an open four and wins first.
  const armed = threatBoard(15, cross.concat([[3, 6, 1], [4, 6, 1], [5, 6, 1], [6, 4, 1], [6, 5, 1]]));
  assert.equal(T.solve(armed, 0, 'VCT', true), null);
});

test('solver lets the attacker block a defender four at no cost and go on', () => {
  const T = G.explain;
  // white holds a four in the column x = 9 (cross at (9,11) closes one end): cross must block (9,6), and that block
  // makes an open four in row 6, so cross still wins. Without the interlude the solver gave up on any defender four.
  const b = threatBoard(15, [[9, 7, 1], [9, 8, 1], [9, 9, 1], [9, 10, 1], [9, 11, 0], [10, 6, 0], [11, 6, 0], [12, 6, 0], [1, 1, 0], [1, 3, 1]]);
  const line = T.solve(b, 0, 'VCF', true);
  assert(line && line[0][0] === 9 && line[0][1] === 6, 'cross blocks (9,6) first');
  assert.equal(line.length, 3);
  // two completing cells for the defender are lost: the attacker cannot block both
  const lost = threatBoard(15, [[9, 7, 1], [9, 8, 1], [9, 9, 1], [9, 10, 1], [10, 6, 0], [11, 6, 0], [12, 6, 0], [1, 1, 0], [1, 3, 1]]);
  assert.equal(T.solve(lost, 0, 'VCF', true), null);
});

test('solver deepens iteratively: the line shown is a shortest win, and results do not depend on the table', () => {
  const T = G.explain;
  // cross can win at once with an open four, but also by a longer chain of fours elsewhere: the short one is returned
  const b = threatBoard(15, [[7, 7, 0], [8, 7, 0], [9, 7, 0], [3, 3, 0], [3, 4, 0], [3, 5, 0], [3, 2, 1], [1, 1, 1], [1, 3, 1]]);
  const line = T.solve(b, 0, 'VCF', true);
  assert(line, 'a win exists');
  assert.equal(line.length, 3, 'open four, a block, the five');
  assert(line[0][1] === 7 && (line[0][0] === 6 || line[0][0] === 10), 'the open four in row 7');
  assert.deepEqual(T.solve(b, 0, 'VCF', true), line, 'the same answer every time');
  // grids are reused between calls: a second board of the same size is not polluted by the first
  assert.equal(T.solve(threatBoard(15, [[7, 7, 0]]), 0, 'VCF', true), null);
});

test('pruning useless fours never loses a win and never lengthens the line', () => {
  const T = G.explain;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let wins = 0;
  for (let i = 0; i < 150; i++) {
    const stones = [];
    const count = 14 + Math.floor(rnd() * 14);
    for (let j = 0; j < count; j++) stones.push([4 + Math.floor(rnd() * 7), 4 + Math.floor(rnd() * 7), j % 2]);
    const b = threatBoard(15, stones);
    for (const mode of ['VCF', 'VCT']) {
      const full = T.solve(b, 0, mode, true, 4000, false);
      const cut = T.solve(b, 0, mode, true, 4000, true);
      if (full) assert(cut, `${mode} win lost on position ${i}`);
      if (full && cut) assert(cut.length <= full.length, `${mode} line longer on position ${i}`);
      if (cut) wins++;
    }
  }
  assert(wins > 50, 'the sample should hold wins');
});

// ---------- portals ----------

test('portal pairs: unplayable, min distance 3, not on walls or moves, removed as a pair', () => {
  const g = G.Game.create(15, 't');
  assert.equal(g.addPortal(2, 2, 10, 10), true);
  assert.equal(g.canPlay(2, 2), false);
  assert.equal(g.portalPartner(g.key(2, 2)), g.key(10, 10));
  assert.equal(g.toggleWall(10, 10), 'blocked'); // a wall cannot cover a portal
  assert.equal(g.portalProblem(4, 4, 12, 12), 'near'); // 2 away from (2,2)
  assert.equal(g.portalProblem(5, 5, 5, 6), 'near'); // the two ends of one pair too
  assert.equal(g.portalProblem(5, 5, 8, 5), '');
  g.toggleWall(0, 0);
  assert.equal(g.portalProblem(0, 0, 8, 0), 'blocked');
  g.play(7, 7);
  assert.equal(g.portalProblem(7, 7, 12, 3), 'blocked');
  assert.equal(g.removePortal(g.key(10, 10)), true);
  assert.equal(g.portals.length, 0);
});

test('a second pair can be placed once the first exists, cell by cell', () => {
  const g = G.Game.create(15, 't');
  g.addPortal(2, 2, 10, 10);
  assert.equal(g.portalCellFree(g.key(6, 6)), true);
  assert.equal(g.portalCellFree(g.key(4, 4)), false); // 2 away from (2,2)
  assert.equal(g.portalCellFree(g.key(5, 2)), true); // exactly 3 away
  assert.equal(g.portalCellFree(g.key(2, 2)), false); // an existing portal cell
  assert.equal(g.addPortal(5, 2, 12, 5), true);
  assert.equal(g.portals.length, 2);
});

test('player names are optional, trimmed, capped and survive a JSON round trip', () => {
  const g = G.Game.create(15, 'x');
  assert.equal('players' in g.toJSON(), false);
  g.players = ['  An  ', 'B'.repeat(40)];
  const j = JSON.parse(JSON.stringify(g.toJSON()));
  const back = new G.Game(j);
  assert.deepEqual(back.players, ['An', 'B'.repeat(24)]);
  assert.deepEqual(new G.Game({ size: 15, players: [5, null] }).players, ['', '']);
  assert.deepEqual(new G.Game({ size: 15, players: 'junk' }).players, ['', '']);
});

test('portals survive a JSON round trip and bad pairs in stored data are dropped', () => {
  const g = G.Game.create(15, 't');
  g.addPortal(2, 2, 10, 10);
  g.addPortal(5, 8, 12, 2);
  const back = new G.Game(JSON.parse(JSON.stringify(g.toJSON())));
  assert.deepEqual(back.portals, g.portals);
  const bad = new G.Game({ size: 15, portals: [[1, 1, 2, 2], [1, 1, 9, 9], [99, 0, 3, 3], 'x'] });
  assert.equal(bad.portals.length, 1);
  assert.equal(new G.Game({ size: 15 }).portals.length, 0); // older saves have no portals
});

test('engine portal commands come before the block and are part of the job key', () => {
  const g = G.Game.create(15, 't');
  assert.deepEqual(EP.portalCommands(g), []);
  const plain = EP.jobKey(g);
  g.addPortal(2, 2, 10, 11);
  assert.deepEqual(EP.portalCommands(g), ['INFO CLEARPORTALS', 'INFO YXPORTAL 2,2 10,11']);
  assert.notEqual(EP.jobKey(g), plain);
});

test('engine client registers portals only when they changed and START forgets them', () => {
  const sent = [];
  const c = new G.EngineClient(() => {});
  c.worker = { postMessage: (m) => sent.push(m.text) };
  c.state = 'idle';
  const cfg = { rule: 0, threads: 1, hashMB: 1, depth: 0, strength: 100, timeMs: 0 };
  const job = (portals, size = 15) => ({ kind: 'analyze', key: 'k', block: 'YXBOARD\nDONE', portals, size, config: cfg, go: 'YXNBEST 1' });
  const portalLines = () => sent.filter((l) => /PORTAL/.test(l));
  c.startNext = G.EngineClient.prototype.startNext;
  c.next = job(['INFO CLEARPORTALS', 'INFO YXPORTAL 2,2 10,11']);
  c.startNext();
  assert.deepEqual(portalLines(), ['INFO CLEARPORTALS', 'INFO YXPORTAL 2,2 10,11']);
  c.state = 'idle';
  c.next = job(['INFO CLEARPORTALS', 'INFO YXPORTAL 2,2 10,11']);
  c.startNext();
  assert.equal(portalLines().length, 2); // unchanged: nothing resent
  c.state = 'idle';
  c.next = job([]);
  c.startNext();
  assert.equal(portalLines().length, 3); // removed: cleared
  assert.equal(portalLines()[2], 'INFO CLEARPORTALS');
  c.state = 'idle';
  c.next = job([], 19); // a new size sends START, which clears them on the engine: no extra CLEARPORTALS
  c.startNext();
  assert.equal(portalLines().length, 3);
});

test('torus: saved only when on, round trips, and counts as a non-empty game', () => {
  const g = G.Game.create(15, 't');
  assert.equal('torus' in g.toJSON(), false);
  assert.equal(g.setTorus(true), true);
  assert.equal(g.isEmpty(), false);
  const back = new G.Game(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(back.torus, true);
  assert.equal(new G.Game({ size: 15, torus: 'yes' }).torus, false); // only a real true counts
});

test('torus: portal distance is measured the short way round', () => {
  const g = G.Game.create(15, 't');
  assert.equal(g.distance(g.key(0, 7), g.key(14, 7)), 14);
  g.setTorus(true);
  assert.equal(g.distance(g.key(0, 7), g.key(14, 7)), 1);
  assert.equal(g.distance(g.key(0, 0), g.key(14, 14)), 1);
  assert.equal(g.addPortal(0, 7, 14, 7), false); // neighbours across the seam
  assert.equal(g.addPortal(0, 7, 12, 7), true); // 3 apart round the back
});

test('torus: refused while portals are too close across the seam, and the game stays as it was', () => {
  const g = G.Game.create(15, 't');
  assert.equal(g.addPortal(0, 7, 13, 7), true); // 13 apart, but 2 across the seam
  assert.equal(g.setTorus(true), false);
  assert.equal(g.torus, false);
  assert.equal(g.setTorus(false), true);
  const loaded = new G.Game({ size: 15, torus: true, portals: [[0, 7, 13, 7]] });
  assert.equal(loaded.portals.length, 0); // dropped on load, like any pair that breaks the rules
});

test('torus: bendsLines covers portals and torus', () => {
  const g = G.Game.create(15, 't');
  assert.equal(g.bendsLines(), false);
  g.setTorus(true);
  assert.equal(g.bendsLines(), true);
  g.setTorus(false);
  g.addPortal(2, 2, 10, 11);
  assert.equal(g.bendsLines(), true);
});

test('torus: job key differs, and the client sends INFO TORUS first, only on change, and START forgets it', () => {
  const g = G.Game.create(15, 't');
  const plain = EP.jobKey(g);
  g.setTorus(true);
  assert.notEqual(EP.jobKey(g), plain);

  const sent = [];
  const c = new G.EngineClient(() => {});
  c.worker = { postMessage: (m) => sent.push(m.text) };
  c.state = 'idle';
  c.startNext = G.EngineClient.prototype.startNext;
  const cfg = { rule: 0, threads: 1, hashMB: 1, depth: 0, strength: 100, timeMs: 0 };
  const job = (torus, portals = [], size = 15) => ({ kind: 'analyze', key: 'k', block: 'YXBOARD\nDONE', portals, torus, size, config: cfg, go: 'YXNBEST 1' });
  const torusLines = () => sent.filter((l) => /TORUS/.test(l));
  c.next = job(true, ['INFO CLEARPORTALS', 'INFO YXPORTAL 2,2 10,11']);
  c.startNext();
  assert.deepEqual(torusLines(), ['INFO TORUS 1']);
  assert.ok(sent.indexOf('INFO TORUS 1') > sent.indexOf('START 15'));
  assert.ok(sent.indexOf('INFO TORUS 1') < sent.indexOf('INFO YXPORTAL 2,2 10,11')); // before the pairs
  c.state = 'idle';
  c.next = job(true, ['INFO CLEARPORTALS', 'INFO YXPORTAL 2,2 10,11']);
  c.startNext();
  assert.equal(torusLines().length, 1); // unchanged: nothing resent
  c.state = 'idle';
  c.next = job(false);
  c.startNext();
  assert.deepEqual(torusLines(), ['INFO TORUS 1', 'INFO TORUS 0']);
  c.state = 'idle';
  c.next = job(true);
  c.startNext();
  c.state = 'idle';
  c.next = job(false, [], 19); // a new size sends START, which clears the torus engine-side: no INFO TORUS 0
  c.startNext();
  assert.equal(torusLines().length, 3);
});

test('voice: spoken Vietnamese numbers', () => {
  const n = (text) => G.voice.parseNumber(G.voice.normalize(text));
  const cases = {
    'Ba mươi bảy.': 37, 'hai mốt': 21, 'hai mươi mốt': 21, 'hai mươi lăm': 25, 'mười lăm': 15, 'mười': 10, 'bốn mươi tư': 44,
    'một trăm lẻ năm': 105, 'hai trăm hai mươi lăm': 225, '37': 37, 'ba bảy': 37, 'năm': 5, 'hai trăm năm mươi': 250,
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(n(text), want, text);
  // parts out of order or repeated are not numbers
  for (const text of ['hai mươi mốt trăm', 'ba mươi trăm', 'hai trăm ba trăm', 'mười mười', 'hai mươi mươi', 'một hai mươi']) assert.equal(n(text), null, text);
  assert.equal(n('hai mươi 5'), 25);
  for (const text of ['trăm lẻ năm', 'bạn ngủ rồi', '3.15h', 'hạ chăm lạc trí', '']) assert.equal(n(text), null, text);
});

test('voice: a phrase names a cell by label or by spiral number, on any board size', () => {
  const cell = (text, size = 15) => {
    const c = G.voice.parseCell(text, size);
    return c && G.coords.label(c.x, c.y, size);
  };
  for (const text of ['H8', 'h 8', 'hát tám', 'Hát 8.', 'đánh hát tám', 'H-8']) assert.equal(cell(text), 'H8', text);
  assert.equal(cell('bê mười lăm'), 'B15');
  assert.equal(cell('xê ba'), 'C3');
  assert.equal(cell('A1'), 'A1');
  for (const [text, want] of [['hờ tám', 'H8'], ['gờ năm', 'G5'], ['cờ ba', 'C3'], ['đê năm', 'D5'], ['do năm', 'D5']]) assert.equal(cell(text), want, text);
  // chatter and Whisper's silence hallucinations are never cells
  for (const text of ['ê', 'ờ', 'Ừ.', 'hát tám hát tám', 'Hãy subscribe cho kênh Ghiền Mì Gõ', 'Cảm ơn các bạn đã theo dõi']) assert.equal(cell(text), null, text);
  const spiral = G.coords.spiral(15);
  const k = spiral.indexOf(37);
  const c = G.voice.parseCell('ba mươi bảy', 15);
  assert.deepEqual([c.x, c.y], [k % 15, Math.floor(k / 15)]);
  assert.equal(G.voice.parseCell('nước đi ba mươi bảy', 15).kind, 'number');
  // off the board, or not a cell at all
  for (const text of ['P8', 'H16', 'H0', 'hai trăm hai mươi sáu', 'không', 'bạn ngủ rồi', '']) assert.equal(G.voice.parseCell(text, 15), null, text);
  assert.notEqual(G.voice.parseCell('một trăm', 10), null); // 100 is the last cell of a 10x10 board
  assert.equal(G.voice.parseCell('một trăm lẻ một', 10), null);
});

// ---------- feature search ----------

function searchIndex() {
  const text = (lang, key) => G.i18n.STRINGS[lang][`find.${key}`] || '';
  return G.search.createIndex(G.SEARCH_FEATURES.map((f) => ({
    id: f.id,
    fields: {
      title: G.i18n.LANGS.map((l) => text(l, f.id)),
      desc: G.i18n.LANGS.map((l) => text(l, `${f.id}.d`)),
      kw: G.i18n.LANGS.flatMap((l) => text(l, `${f.id}.k`).split(';').filter(Boolean)),
    },
  })));
}
const top = (index, q, n = 1) => G.search.query(index, q).slice(0, n).map((r) => r.id);

test('every searchable feature has a title, description and keywords in every language', () => {
  for (const f of G.SEARCH_FEATURES) {
    for (const lang of G.i18n.LANGS) {
      for (const k of [f.id, `${f.id}.d`, `${f.id}.k`]) assert(G.i18n.STRINGS[lang][`find.${k}`], `${lang} find.${k}`);
    }
  }
  assert.equal(new Set(G.SEARCH_FEATURES.map((f) => f.id)).size, G.SEARCH_FEATURES.length, 'duplicate ids');
});

test('search targets exist in index.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const f of G.SEARCH_FEATURES) {
    for (const sel of f.targets) {
      const id = /^#([\w-]+)$/.exec(sel);
      const attr = /^\[(data-[\w-]+)="([^"]+)"\]$/.exec(sel);
      if (id) assert(html.includes(`id="${id[1]}"`), `${f.id}: ${sel}`);
      if (attr) assert(html.includes(`${attr[1]}="${attr[2]}"`), `${f.id}: ${sel}`);
    }
  }
});

test('search folds tone marks, stop words and typos', () => {
  assert.equal(G.search.fold('Cài đặt ĐỔI màu'), 'cai dat doi mau');
  assert.deepEqual(G.search.tokenize('làm sao để đổi màu'), ['doi', 'mau']);
  assert.deepEqual(G.search.tokenize('how do I change the colours'), ['change', 'colour']);
  assert.equal(G.search.distance('voice', 'viice', 2), 1);
  assert.equal(G.search.distance('abcd', 'abdc', 2), 1, 'adjacent swap');
});

test('search finds a feature from a natural question, with or without tone marks', () => {
  const ix = searchIndex();
  assert.equal(top(ix, 'làm sao để đi quân bằng giọng nói')[0], 'voice');
  assert.equal(top(ix, 'lam sao de doi mau ban co')[0], 'colors');
  assert.equal(top(ix, 'how do I play against the computer')[0], 'engine');
  assert.equal(top(ix, 'dark mode')[0], 'darkmode');
  assert.equal(top(ix, 'tôi muốn sao lưu ván cờ')[0], 'export');
  assert.equal(top(ix, 'tuong')[0], 'walls');
  assert.equal(top(ix, 'portal')[0], 'portals');
});

test('search tolerates typos and completes the word being typed', () => {
  const ix = searchIndex();
  assert.equal(top(ix, 'gioong noi')[0], 'voice');
  assert.equal(top(ix, 'dark moed')[0], 'darkmode');
  assert.equal(top(ix, 'expo')[0], 'export', 'prefix of the last word');
  assert.equal(G.search.complete(ix, 'đổi ngô'), 'đổi ngôn');
  assert.equal(G.search.complete(ix, 'đổi '), null);
  assert.equal(G.search.correct(ix, 'giong noii'), 'giọng nói');
  assert.equal(G.search.correct(ix, 'giọng nói'), null);
});

test('search returns nothing for gibberish and empty input', () => {
  const ix = searchIndex();
  assert.deepEqual(G.search.query(ix, ''), []);
  assert.deepEqual(G.search.query(ix, 'zzqxj'), []);
});
