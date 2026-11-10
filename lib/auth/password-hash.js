/* =====================================================================
   The password hash format, in one place.

   Used by the app (lib/server/auth/password.ts, which adds a queue so only a few
   hashes run at once) and by scripts/owner-recover.mjs (which runs on its own).
   Plain JavaScript without "server-only", so unit tests and scripts can load it.

   Format: "scrypt$N$r$p$salt(base64)$key(base64)". The parameters travel with
   each hash, so they can be raised later: old hashes keep verifying.
   scrypt with OWASP's recommended cost (N=2^16, r=8, p=2 ≈ 64 MiB per hash).
===================================================================== */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const PARAMS = { N: 2 ** 16, r: 8, p: 2 };
export const KEY_LENGTH = 64;
export const MAX_MEMORY = 256 * 1024 * 1024;

/** The raw scrypt key for a password (NFKC-normalised, so "é" typed two ways matches). */
export function deriveKey(password, salt, options) {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export function formatHash(salt, key, params = PARAMS) {
  return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Splits a stored hash into its parts, or null when it is not one of ours. */
export function parseHash(stored) {
  const [scheme, N, r, p, salt, key] = String(stored).split("$");
  if (scheme !== "scrypt" || !key) return null;
  return { N: +N, r: +r, p: +p, salt: Buffer.from(salt, "base64"), key: Buffer.from(key, "base64") };
}

export const keysMatch = (actual, expected) => actual.length === expected.length && timingSafeEqual(actual, expected);

/** `derive` lets the app run the work through its queue; scripts use the default. */
export async function hashPassword(password, derive = deriveKey) {
  const salt = randomBytes(16);
  return formatHash(salt, await derive(password, salt, PARAMS));
}

export async function verifyPassword(password, stored, derive = deriveKey) {
  const parts = parseHash(stored);
  if (!parts) return { ok: false, needsRehash: false };
  const actual = await derive(password, parts.salt, { N: parts.N, r: parts.r, p: parts.p });
  return {
    ok: keysMatch(actual, parts.key),
    needsRehash: parts.N < PARAMS.N || parts.r < PARAMS.r || parts.p < PARAMS.p,
  };
}
