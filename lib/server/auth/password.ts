import "server-only";
import { randomBytes, randomInt, type ScryptOptions } from "node:crypto";
import { commonPasswordProblem } from "@/lib/auth/common-passwords";
import { deriveKey, hashPassword as hashWith, verifyPassword as verifyWith } from "@/lib/auth/password-hash";
import { HttpError } from "@/lib/server/errors";

// The hash format (scrypt, OWASP's recommended cost; the parameters are stored with each
// hash so older hashes keep verifying and are upgraded at the user's next login) lives in
// lib/auth/password-hash.js, shared with scripts/owner-recover.mjs. This file adds the queue.

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Every hash costs ~0.3 s of CPU and 64 MiB. Instead of a request quota shared by all
// visitors (which one anonymous script could use up to block every real sign-in), at
// most MAX_PARALLEL hashes run at once and the rest wait their turn. Only when a very
// long queue has built up are further requests turned away.
const MAX_PARALLEL = 4;
const MAX_WAITING = 64;
let running = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) {
    if (waiting.length >= MAX_WAITING)
      throw new HttpError(503, "The server is busy. Try again in a few seconds.", "busy", { "Retry-After": "5" });
    await new Promise<void>((resolve) => waiting.push(resolve)); // the finishing hash hands its place over
  } else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

const inQueue = (password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> =>
  inTurn(() => deriveKey(password, salt, options));

export function hashPassword(password: string): Promise<string> {
  return hashWith(password, inQueue);
}

/** Checks a password against a stored hash. `needsRehash` = stored with weaker parameters than today's. */
export function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  return verifyWith(password, stored, inQueue);
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
  return commonPasswordProblem(password);
}

// Easy to read aloud or copy by hand: no 0/O, 1/l/I.
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** A one-time password an admin hands to a new or locked-out user (e.g. "k7Qm-xR4p-9TzW"). */
export function generateTemporaryPassword() {
  const group = () =>
    Array.from({ length: 4 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}
