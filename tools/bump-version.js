// Sets the release version: node tools/bump-version.js <version>   (e.g. 1.2.0)
// The version lives in index.html only: the app-version meta tag (shown in Settings and passed to the engine
// worker) and the ?v= query on every local stylesheet and script. Run it before each deploy so returning
// visitors load the new files instead of cached old ones.
'use strict';

const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^[0-9A-Za-z.-]+$/.test(version)) {
  console.error('usage: node tools/bump-version.js <version>   (letters, digits, dots and dashes)');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const meta = /(<meta name="app-version" content=")([^"]*)(")/;
const asset = /((?:href|src)="(?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[^"]*)?(")/g;
const found = html.match(meta);
if (!found) {
  console.error('index.html has no <meta name="app-version"> tag');
  process.exit(1);
}
const old = found[2];
let count = 0;
const out = html.replace(meta, `$1${version}$3`).replace(asset, (m, head, tail) => {
  count++;
  return `${head}?v=${version}${tail}`;
});
fs.writeFileSync(file, out);
console.log(`index.html: ${old} -> ${version} (${count} asset URLs)`);
