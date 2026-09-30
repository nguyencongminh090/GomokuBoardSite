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

  G.security = {
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
