import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { pool, withTransaction, type Db } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { BadRequestError, ConflictError, ForbiddenError, HttpError, UnauthorizedError } from "@/lib/server/errors";
import { generateSecret, matchTotp, otpauthUri } from "@/lib/auth/totp";
import type { AuthUser } from "@/lib/server/auth/session";

/* =====================================================================
   TWO-STEP SIGN-IN (an authenticator app: Google/Microsoft Authenticator, Authy, 1Password…)

   Optional, chosen by each person. After the password is right, the six-digit code is asked
   for as well. Nothing needs a database change: each person's setting is one row in the
   existing `app_meta` table (key "mfa:<user id>"). The authenticator secret is stored
   ENCRYPTED with AUTH_MFA_KEY (a long random value in the server's environment), so a copy of
   the database alone cannot be used to make codes. Without AUTH_MFA_KEY nobody can switch
   it on; if it is later removed, people who switched it on cannot sign in (it fails closed,
   it never lets them in without the code). Lost phone: one of the eight recovery codes, an
   administrator ("Reset two-step"), or scripts/owner-recover.mjs --reset-mfa.
===================================================================== */

interface MfaRecord {
  secret: string; // encrypted (see seal)
  enabled: boolean;
  lastCounter: number; // newest time step already used: a code works once
  failures: number;
  lockedUntil: number; // ms; 0 = not locked
  recovery: string[]; // sha256 of each unused recovery code
  enabledAt?: string;
}

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const TICKET_MS = 5 * 60_000;
const ISSUER = "LEARNEX ERP";
const keyOf = (userId: number) => `mfa:${userId}`;

/* ----------------------------------------------------------------- crypto */

const configuredKey = () => process.env.AUTH_MFA_KEY || "";
export const mfaAvailable = () => configuredKey().length >= 16;

function masterKey() {
  if (!mfaAvailable())
    throw new HttpError(503, "Two-step sign-in needs AUTH_MFA_KEY (at least 16 random characters) in the server's settings.", "mfa_unavailable");
  return createHash("sha256").update(`learnex-mfa|${configuredKey()}`).digest();
}

function seal(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const newRecoveryCode = () => {
  const hex = randomBytes(5).toString("hex"); // 40 bits each, 8 codes
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
};
const normalizeRecovery = (code: string) => code.trim().toLowerCase().replace(/[\s-]/g, "");
const looksLikeRecovery = (code: string) => /^[0-9a-f]{10}$/.test(normalizeRecovery(code));

/* ---------------------------------------------------------------- storage */

async function readRecord(db: Db, userId: number, forUpdate = false): Promise<MfaRecord | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT value FROM app_meta WHERE \`key\` = ?${forUpdate ? " FOR UPDATE" : ""}`,
    [keyOf(userId)],
  );
  return rows[0] ? (JSON.parse(rows[0].value) as MfaRecord) : null;
}

async function writeRecord(db: Db, userId: number, record: MfaRecord) {
  await db.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW(6)`,
    [keyOf(userId), JSON.stringify(record)],
  );
}

export async function mfaEnabled(userId: number, db: Db = pool) {
  return !!(await readRecord(db, userId))?.enabled;
}

/** Which of these people use two-step sign-in (for the user list). */
export async function mfaEnabledAmong(userIds: number[]) {
  if (!userIds.length) return new Set<number>();
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT \`key\`, value FROM app_meta WHERE \`key\` LIKE 'mfa:%'`);
  const out = new Set<number>();
  for (const r of rows) {
    const id = Number(String(r.key).slice(4));
    if (userIds.includes(id) && (JSON.parse(r.value) as MfaRecord).enabled) out.add(id);
  }
  return out;
}

export async function removeMfa(userId: number, db: Db = pool) {
  await db.query(`DELETE FROM app_meta WHERE \`key\` = ?`, [keyOf(userId)]);
}

/* ---------------------------------------------------------- checking codes */

/**
 * Checks a six-digit code or a recovery code for this person. Wrong codes are counted under a
 * row lock (so parallel guesses cannot dodge the count): the 5th wrong one locks two-step
 * sign-in for 15 minutes. A correct code is accepted once.
 */
export async function checkMfaCode(
  userId: number,
  rawCode: unknown,
  // reauth only: a code just used to sign in may be typed once more in the same 30 seconds
  { allowSameStep = false }: { allowSameStep?: boolean } = {},
): Promise<boolean> {
  const code = typeof rawCode === "string" ? rawCode : "";
  const result = await withTransaction(async (conn) => {
    const record = await readRecord(conn, userId, true);
    if (!record?.enabled) return "none" as const;
    const locked = record.lockedUntil > Date.now();
    // While locked, only a recovery code is tried (that is the way back in, as the message says);
    // a wrong guess then changes nothing, and the request limiter bounds guessing.
    if (locked && !looksLikeRecovery(code)) return "locked" as const;
    let ok = false;
    if (looksLikeRecovery(code)) {
      const h = sha(normalizeRecovery(code));
      const at = record.recovery.indexOf(h);
      if (at >= 0) {
        record.recovery.splice(at, 1);
        ok = true;
      } else if (locked) {
        return "locked" as const;
      }
    } else {
      const after = allowSameStep ? record.lastCounter - 1 : record.lastCounter;
      const counter = matchTotp(unseal(record.secret), code, { after });
      if (counter !== null) {
        record.lastCounter = Math.max(record.lastCounter, counter);
        ok = true;
      }
    }
    if (ok) {
      record.failures = 0;
      record.lockedUntil = 0;
    } else {
      record.failures += 1;
      if (record.failures >= MAX_FAILURES) {
        record.lockedUntil = Date.now() + LOCK_MS;
        record.failures = 0;
      }
    }
    await writeRecord(conn, userId, record);
    return ok ? ("ok" as const) : ("wrong" as const);
  });
  if (result === "locked")
    throw new HttpError(429, "Too many wrong codes. Try again in 15 minutes, or use a recovery code.", "mfa_locked");
  return result === "ok";
}

/* -------------------------------------------------- the step between the two */

// After the password is right the browser gets a short-lived ticket to prove it for the code
// step. Signed with the master key, so it cannot be made up, and good for 5 minutes.
const sign = (body: string) => createHmac("sha256", masterKey()).update(`mfa-ticket|${body}`).digest("base64url");

export function issueTicket(userId: number) {
  const body = `${userId}.${Date.now() + TICKET_MS}`;
  return `${body}.${sign(body)}`;
}

export function userOfTicket(ticket: unknown): number {
  const bad = () => new UnauthorizedError("That sign-in step has expired. Start again.", "mfa_ticket_invalid");
  if (typeof ticket !== "string") throw bad();
  const [id, exp, signature = ""] = ticket.split(".");
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw bad();
  if (Number(exp) < Date.now()) throw bad();
  return Number(id);
}

/* ------------------------------------------------------------ switching on/off */

/** Step 1: makes a new secret for the person to add to their authenticator app. Nothing is on yet. */
export async function startSetup(user: AuthUser) {
  const existing = await readRecord(pool, user.id);
  if (existing?.enabled) throw new ConflictError("Two-step sign-in is already on. Switch it off first to set it up again.");
  const secret = generateSecret();
  await writeRecord(pool, user.id, {
    secret: seal(secret),
    enabled: false,
    lastCounter: -1,
    failures: 0,
    lockedUntil: 0,
    recovery: [],
  });
  return { secret, uri: otpauthUri({ secret, account: user.username, issuer: ISSUER }) };
}

/** Step 2: the first code from the app proves it works; then it is on, and the recovery codes are shown once. */
export async function finishSetup(user: AuthUser, rawCode: unknown) {
  const codes = await withTransaction(async (conn) => {
    const record = await readRecord(conn, user.id, true);
    if (!record) throw new BadRequestError("Start the setup first.");
    if (record.enabled) throw new ConflictError("Two-step sign-in is already on.");
    const counter = matchTotp(unseal(record.secret), typeof rawCode === "string" ? rawCode : "");
    if (counter === null) throw new BadRequestError("That code is not right. Check the app and try again.");
    const recoveryCodes = Array.from({ length: 8 }, newRecoveryCode);
    await writeRecord(conn, user.id, {
      ...record,
      enabled: true,
      lastCounter: counter,
      failures: 0,
      lockedUntil: 0,
      recovery: recoveryCodes.map((c) => sha(normalizeRecovery(c))),
      enabledAt: new Date().toISOString(),
    });
    await audit({ userId: user.id, username: user.username }, "auth.mfa_enabled", user.username, {}, conn);
    return recoveryCodes;
  });
  return { recoveryCodes: codes };
}

/** Switching it off needs the password AND a current code (a stolen session alone cannot do it). */
export async function disableOwn(user: AuthUser, rawCode: unknown) {
  if (!(await mfaEnabled(user.id))) throw new ConflictError("Two-step sign-in is not on.");
  if (!(await checkMfaCode(user.id, rawCode))) throw new ForbiddenError("That code is not right.", "mfa_wrong_code");
  await removeMfa(user.id);
  await audit({ userId: user.id, username: user.username }, "auth.mfa_disabled", user.username);
}

export async function recoveryCodesLeft(userId: number) {
  return (await readRecord(pool, userId))?.recovery.length ?? 0;
}
