// Adds a public key code to allowed-keys.json: node tools/add-key.js <44-char key code> [name]
// Print the fingerprint back to the sender so they can confirm it is the key they meant.
'use strict';

const fs = require('fs');
const path = require('path');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'security.js'), 'utf8'));
const S = window.Gomoku.security;

(async () => {
  const [code, name = ''] = process.argv.slice(2);
  const parsed = code && (await S.parseKeyCode(code));
  if (!parsed) {
    console.error('usage: node tools/add-key.js <key code> [name]   (the code must be a valid public key code)');
    process.exit(1);
  }
  const file = path.join(__dirname, '..', 'allowed-keys.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (list.keys.some((k) => k.fingerprint === parsed.fingerprint)) {
    console.log(`already listed: ${parsed.fingerprint}`);
    return;
  }
  list.keys.push({ name, fingerprint: parsed.fingerprint, publicKey: parsed.publicKey });
  fs.writeFileSync(file, JSON.stringify(list, null, 1) + '\n');
  console.log(`added ${name || '(no name)'}: ${parsed.fingerprint}`);
})();
