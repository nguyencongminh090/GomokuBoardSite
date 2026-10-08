// Engine gate: serves the Rapfi files (Static Assets, binding ASSETS) only to holders of an allow-listed key.
//
//   GET  /challenge     -> { challenge }       random nonce + expiry, MACed, valid for CHALLENGE_TTL seconds
//   POST /token         -> { token, exp }      { challenge, publicKey, signature }: the challenge must be fresh, signed
//                                              by the private key of a public key in allowed-keys.json
//   GET  /engine/<file>?t=<token>              the engine file, if the token is valid and not expired
//
//   GET  /import/playok/gm<id>                 the PlayOK game record (text), so the page can import it: playok.com sends no CORS
//                                              headers. Only that one fixed address is ever fetched (not an open proxy).
//
// The token is an HMAC over its expiry, not bound to a key: revoking a key takes effect once outstanding tokens
// expire (TOKEN_TTL). Secret: `wrangler secret put TOKEN_SECRET`.
'use strict';

const CHALLENGE_TTL = 60; // seconds
const DEFAULT_TOKEN_TTL = 6 * 3600; // seconds; pthreads of the multi build may start workers late in a session
const ALLOWED_KEYS_TTL = 60; // seconds the allow-list may be cached at the edge

const enc = new TextEncoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64u = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', enc.encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function mac(env, text) {
  return b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(text)));
}

// Constant-time string comparison.
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const now = () => Math.floor(Date.now() / 1000);

// "<nonce>.<expiry>.<mac>" / "<expiry>.<mac>": checks the mac (with a purpose prefix) and the expiry.
async function checkStamped(env, purpose, value, parts) {
  const bits = String(value || '').split('.');
  if (bits.length !== parts + 1) return false;
  const body = bits.slice(0, parts).join('.');
  const exp = Number(bits[parts - 1]);
  return Number.isFinite(exp) && exp > now() && same(await mac(env, `${purpose}.${body}`), bits[parts]);
}

function allowedOrigin(env, request) {
  const origin = request.headers.get('Origin') || '';
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin) ? origin : '';
}

function withCors(env, request, res) {
  const headers = new Headers(res.headers);
  const origin = allowedOrigin(env, request);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  // The page is cross-origin isolated (COEP require-corp), so it may only embed resources that opt in.
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function loadAllowed(env) {
  const res = await fetch(env.ALLOWED_KEYS_URL, { cf: { cacheTtl: ALLOWED_KEYS_TTL, cacheEverything: true } });
  const raw = await res.json();
  if (!res.ok || !raw || raw.format !== 'gomoku-allowed-keys' || !Array.isArray(raw.keys)) throw new Error('bad list');
  return raw.keys.map((k) => k && k.publicKey).filter((k) => k && k.kty === 'EC' && k.crv === 'P-256');
}

async function issueChallenge(env) {
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const body = `${nonce}.${now() + CHALLENGE_TTL}`;
  return json({ challenge: `${body}.${await mac(env, `c.${body}`)}` });
}

async function issueToken(env, request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad request' }, 400);
  }
  const { challenge, publicKey, signature } = body || {};
  if (typeof challenge !== 'string' || typeof signature !== 'string' || !publicKey) return json({ error: 'bad request' }, 400);
  if (!(await checkStamped(env, 'c', challenge, 2))) return json({ error: 'challenge expired' }, 401);

  let list;
  try {
    list = await loadAllowed(env);
  } catch (e) {
    return json({ error: 'allow-list unavailable' }, 503);
  }
  const entry = list.find((k) => k.x === publicKey.x && k.y === publicKey.y);
  if (!entry) return json({ error: 'not allowed' }, 403);

  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: entry.x, y: entry.y },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), enc.encode(challenge));
    if (!ok) return json({ error: 'bad signature' }, 403);
  } catch (e) {
    return json({ error: 'bad signature' }, 403);
  }

  const ttl = Number(env.TOKEN_TTL) || DEFAULT_TOKEN_TTL;
  const exp = now() + ttl;
  return json({ token: `${exp}.${await mac(env, `t.${exp}`)}`, exp });
}

async function serveEngine(env, request, url) {
  if (!(await checkStamped(env, 't', url.searchParams.get('t'), 1))) return new Response('Forbidden', { status: 403 });
  const asset = new URL(url);
  asset.search = '';
  return env.ASSETS.fetch(new Request(asset, { method: 'GET' }));
}

async function importPlayok(url) {
  const m = /^\/import\/playok\/(gm\d{1,12})$/.exec(url.pathname);
  if (!m) return new Response('Not found', { status: 404 });
  const res = await fetch(`https://www.playok.com/p/?g=${m[1]}.txt`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return new Response('Not found', { status: res.status === 404 ? 404 : 502 });
  const text = await res.text();
  if (text.length > 50000) return new Response('Too large', { status: 502 });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      const res = new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' },
      });
      return withCors(env, request, res);
    }
    let res;
    if (request.method === 'GET' && url.pathname === '/challenge') res = await issueChallenge(env);
    else if (request.method === 'POST' && url.pathname === '/token') res = await issueToken(env, request);
    else if (request.method === 'GET' && url.pathname.startsWith('/engine/')) res = await serveEngine(env, request, url);
    else if (request.method === 'GET' && url.pathname.startsWith('/import/playok/')) res = await importPlayok(url);
    else res = new Response('Not found', { status: 404 });
    return withCors(env, request, res);
  },
};
