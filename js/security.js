// Key pair and signatures (Web Crypto). The private key is created on this device and only ever stored
// encrypted with a password (PBKDF2 -> AES-GCM); the public key is the part that gets shared.
// No DOM access, so tests can load this file with a stub window.
(function (G) {
  'use strict';

  const CURVE = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
  const KDF_ITERATIONS = 600000; // OWASP guidance for PBKDF2-HMAC-SHA256
  const MIN_PASSWORD = 8;
  const SIG_ALG = 'ECDSA-P256-SHA256';

  const text = new TextEncoder();
  const subtle = () => globalThis.crypto && globalThis.crypto.subtle;

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(password, salt, iterations) {
    const base = await subtle().importKey('raw', text.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // Encrypts key bytes; the box holds everything needed to decrypt them again with the same password.
  async function seal(bytes, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, KDF_ITERATIONS);
    const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { kdf: 'PBKDF2-SHA256', iter: KDF_ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
  }

  // Throws when the password is wrong (AES-GCM fails its authentication check).
  async function open(box, password) {
    const key = await deriveKey(password, fromB64(box.salt), box.iter);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data)));
  }

  const toB64u = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64u = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));

  // P-256 field arithmetic, for the compact key code (a compressed point: 33 bytes -> 44 characters).
  const P = 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n;
  const B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const toBig = (bytes) => BigInt('0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''));
  const toBytes = (n) => Uint8Array.from(n.toString(16).padStart(64, '0').match(/../g), (h) => parseInt(h, 16));
  function powMod(base, exp, mod) {
    let r = 1n;
    for (base %= mod; exp > 0n; exp >>= 1n, base = (base * base) % mod) if (exp & 1n) r = (r * base) % mod;
    return r;
  }

  const cleanJwk = (jwk) => ({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });

  function isPublicJwk(j) {
    return !!j && j.kty === 'EC' && j.crv === 'P-256' && typeof j.x === 'string' && typeof j.y === 'string';
  }

  // Readable identity of a public key: 32 hex digits in groups of four ("A1B2 C3D4 ...").
  async function fingerprint(jwk) {
    const digest = await subtle().digest('SHA-256', text.encode(`${jwk.x}.${jwk.y}`));
    const hex = [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hex.toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
  }

  function importPublic(jwk) {
    return subtle().importKey('jwk', cleanJwk(jwk), CURVE, false, ['verify']);
  }

  async function importPrivate(pkcs8) {
    return subtle().importKey('pkcs8', pkcs8, CURVE, false, ['sign']); // non-extractable once unlocked
  }

  async function sign(privateKey, message) {
    return toB64(await subtle().sign(SIGN, privateKey, text.encode(message)));
  }

  async function verify(jwk, sig, message) {
    return subtle().verify(SIGN, await importPublic(jwk), fromB64(sig), text.encode(message));
  }

  // The exact text that gets signed: the export without its own signature.
  const canonical = (body) => JSON.stringify(body);

  // Short text form of a public key that people can paste into a message: 0x02/0x03 + x, base64url.
  function keyCode(jwk) {
    const y = fromB64u(jwk.y);
    return toB64u(Uint8Array.of(2 + (y[31] & 1), ...fromB64u(jwk.x)));
  }

  // Inverse of keyCode; null unless the text is a real point on the curve.
  async function parseKeyCode(code) {
    try {
      const bytes = fromB64u(String(code).replace(/\s+/g, ''));
      if (bytes.length !== 33 || (bytes[0] !== 2 && bytes[0] !== 3)) return null;
      const x = toBig(bytes.slice(1));
      if (x >= P) return null;
      const rhs = (x * x * x - 3n * x + B) % P;
      let y = powMod((rhs + P) % P, (P + 1n) / 4n, P);
      if ((y * y) % P !== (rhs + P) % P) return null;
      if (Number(y & 1n) !== (bytes[0] & 1)) y = P - y;
      const jwk = { kty: 'EC', crv: 'P-256', x: toB64u(bytes.slice(1)), y: toB64u(toBytes(y)) };
      await importPublic(jwk);
      return { publicKey: jwk, fingerprint: await fingerprint(jwk) };
    } catch (e) {
      return null;
    }
  }

  G.security = {
    keyCode,
    parseKeyCode,
    MIN_PASSWORD,
    supported: () => !!subtle(),
    fingerprint,
    isPublicJwk,
    cleanJwk,

    // New key pair, returned as a storable record. The private half exists only encrypted.
    async createRecord(password) {
      const pair = await subtle().generateKey(CURVE, true, ['sign', 'verify']);
      const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
      const record = {
        version: 1,
        createdAt: Date.now(),
        publicKey: cleanJwk(await subtle().exportKey('jwk', pair.publicKey)),
        private: await seal(pkcs8, password),
      };
      pkcs8.fill(0);
      return record;
    },

    // Decrypts the private key for signing. Throws on a wrong password or on a record whose halves
    // do not belong together.
    async unlock(record, password) {
      const pkcs8 = await open(record.private, password);
      let key;
      try {
        key = await importPrivate(pkcs8);
      } finally {
        pkcs8.fill(0);
      }
      const probe = await sign(key, 'gomoku-board');
      if (!(await verify(record.publicKey, probe, 'gomoku-board'))) throw new Error('key mismatch');
      return key;
    },

    async rewrap(record, oldPassword, newPassword) {
      const pkcs8 = await open(record.private, oldPassword);
      try {
        return { ...record, private: await seal(pkcs8, newPassword) };
      } finally {
        pkcs8.fill(0);
      }
    },

    // Shape check for a record read from storage or a backup file.
    isRecord(r) {
      const p = r && r.private;
      return !!r && isPublicJwk(r.publicKey) && !!p && typeof p.salt === 'string' && typeof p.iv === 'string'
        && typeof p.data === 'string' && Number.isInteger(p.iter) && p.iter > 0 && p.iter <= 10000000;
    },

    // Proof of possession: signs a fresh random challenge with the unlocked private key and checks it against
    // `publicJwk` (an entry of the allow-list), so only the holder of the matching private key passes.
    async proves(privateKey, publicJwk) {
      try {
        const challenge = toB64(crypto.getRandomValues(new Uint8Array(32)));
        return await verify(publicJwk, await sign(privateKey, challenge), challenge);
      } catch (e) {
        return false;
      }
    },

    async signExport(record, privateKey, body) {
      const value = await sign(privateKey, canonical(body));
      return { ...body, signature: { alg: SIG_ALG, publicKey: record.publicKey, value } };
    },

    // status: 'none' (unsigned) | 'valid' | 'invalid'. A valid result carries the signer's key.
    async verifyExport(parsed) {
      const s = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed.signature : undefined;
      if (s === undefined) return { status: 'none' };
      try {
        if (!s || s.alg !== SIG_ALG || !isPublicJwk(s.publicKey) || typeof s.value !== 'string') throw new Error('bad');
        const { signature, ...body } = parsed;
        if (!(await verify(s.publicKey, s.value, canonical(body)))) throw new Error('bad');
        return { status: 'valid', publicKey: cleanJwk(s.publicKey), fingerprint: await fingerprint(s.publicKey) };
      } catch (e) {
        return { status: 'invalid' };
      }
    },

    // Public key file that can be handed to other people.
    async publicKeyFile(jwk) {
      return { format: 'gomoku-public-key', version: 1, fingerprint: await fingerprint(jwk), publicKey: cleanJwk(jwk) };
    },

    // Reads a public key file; returns { publicKey, fingerprint } or null when it is not one.
    async parsePublicKeyFile(raw) {
      if (!raw || raw.format !== 'gomoku-public-key' || !isPublicJwk(raw.publicKey)) return null;
      try {
        await importPublic(raw.publicKey);
        return { publicKey: cleanJwk(raw.publicKey), fingerprint: await fingerprint(raw.publicKey) };
      } catch (e) {
        return null;
      }
    },
  };
})(window.Gomoku = window.Gomoku || {});
