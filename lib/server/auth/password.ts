import "server-only";
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt with OWASP's recommended cost (N=2^16, r=8, p=2 ≈ 64 MiB per hash).
// The parameters are stored with each hash, so they can be raised later:
// older hashes keep verifying and are upgraded at the user's next login.
const PARAMS = { N: 2 ** 16, r: 8, p: 2 };
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function scrypt(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Checks a password against a stored hash. `needsRehash` = stored with weaker parameters than today's. */
export async function verifyPassword(password: string, stored: string) {
  const [scheme, N, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !key) return { ok: false, needsRehash: false };
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), { N: +N, r: +r, p: +p });
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  const needsRehash = +N < PARAMS.N || +r < PARAMS.r || +p < PARAMS.p;
  return { ok, needsRehash };
}

// Used when the username doesn't exist, so a failed login takes the same time
// either way and doesn't reveal which usernames are real.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}

/** Returns a reason the password is not acceptable, or null. */
export function passwordProblem(password: unknown, username?: string): string | null {
  if (typeof password !== "string") return "Enter a password.";
  if ([...password].length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if ([...password].length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (username && password.trim().toLowerCase() === username.trim().toLowerCase()) {
    return "The password can't be the same as the username.";
  }
  return null;
}

// Easy to read aloud or copy by hand: no 0/O, 1/l/I.
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A one-time password an admin hands to a new or locked-out user (e.g. "k7Qm-xR4p-9TzW"). */
export function generateTemporaryPassword() {
  const group = () =>
    Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}
