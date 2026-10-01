// Checks for the model (coords, game), i18n dictionaries, contrast maths, colour presets and the engine protocol.
// Run: node tests/model.test.js
// The site uses classic scripts that attach to window.Gomoku, so they are evaluated with a stub window.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
for (const f of ['js/i18n.js', 'js/contrast.js', 'js/coords.js', 'js/settings.js', 'js/game.js', 'js/security.js', 'js/threats.js', 'js/engine.js']) {
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
  const T = G.threats;
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
  const T = G.threats;
  // VCF: row three blocked on the left by white; cross four (8,7), white must block (9,7), cross makes an open four in the column
  const b = threatBoard(15, [[5, 7, 0], [6, 7, 0], [7, 7, 0], [7, 5, 0], [7, 6, 0], [4, 7, 1], [1, 1, 1]]);
  const c = T.chain(b, [[8, 7], [9, 7], [7, 8], [1, 2]], 0);
  assert(c, 'chain expected');
  assert.equal(c.kind, 'VCF');
  assert.equal(c.start, 0);
  assert.equal(c.end, 2);
  assert.equal(c.finish, 'open4');
  // a quiet first move is not part of the chain: the chain starts at the first threat of the winning run
  const q = T.chain(b, [[12, 12], [1, 2], [8, 7], [9, 7], [7, 8]], 0);
  assert(q && q.start === 2 && q.end === 4, 'quiet move excluded');
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
  const T = G.threats;
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
  const T = G.threats;
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
  const T = G.threats;
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
