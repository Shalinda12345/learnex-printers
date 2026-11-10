/* =====================================================================
   TOTP (RFC 6238) — the six-digit codes of an authenticator app.
   Pure functions on Node's crypto; no server-only imports, so they can be unit-tested.
===================================================================== */
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not a valid base32 secret.");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), as the base32 text an authenticator app asks for. */
export const generateSecret = () => base32Encode(randomBytes(20));

/** The `digits`-digit code for one counter value (RFC 4226). */
export function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = h[h.length - 1] & 15;
  const bin = h.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const STEP_SECONDS = 30;
export const counterAt = (time = Date.now()) => Math.floor(time / 1000 / STEP_SECONDS);
export const totp = (secret, time = Date.now()) => hotp(secret, counterAt(time));

/**
 * The counter a code belongs to, or null. Codes of the previous and the next 30 seconds are
 * accepted too (clocks differ), but never a counter at or before `after`, so one code
 * cannot be used twice.
 */
export function matchTotp(secret, code, { time = Date.now(), after = -1, window = 1 } = {}) {
  const given = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const now = counterAt(time);
  for (let c = now - window; c <= now + window; c++) {
    if (c > after && hotp(secret, c) === given) return c;
  }
  return null;
}

/** The address an authenticator app can be given instead of typing the secret. */
export function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
