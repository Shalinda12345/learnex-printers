import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { pool } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { ForbiddenError } from "@/lib/server/errors";
import { verifyPassword } from "@/lib/server/auth/password";
import { checkMfaCode, mfaEnabled } from "@/lib/server/auth/mfa";
import type { AuthUser } from "@/lib/server/auth/session";

/* =====================================================================
   RE-CONFIRMING YOUR PASSWORD before something that cannot be undone
   (restore a backup, clear a module, factory reset).

   A signed-in browser that was left open, or a stolen session, must not be able to wipe the
   business with one click. So these actions also need a short-lived proof that the person
   typed their password (and their authenticator code, when they use one) just now:

     1. POST /api/auth/reauth {password, code?}  →  { token, expiresAt }   (5 minutes)
     2. the token travels in the "x-reauth" header of the destructive request.

   The token is stateless: an HMAC, keyed with the account's password hash, over the account,
   the session and the expiry. It cannot be made without the hash, it only works for the
   session it was issued to, and it stops working when the password changes.
===================================================================== */

const VALID_MS = 5 * 60_000;
export const REAUTH_HEADER = "x-reauth";

async function passwordHashOf(userId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT password_hash FROM auth_users WHERE id = ?`, [userId]);
  return rows[0]?.password_hash as string | undefined;
}

const sign = (hash: string, user: AuthUser, exp: number) =>
  createHmac("sha256", hash).update(`reauth|${user.id}|${user.sessionId}|${exp}`).digest("base64url");

/** Checks the signed-in person's own password (the caller limits how often this may be tried). */
export async function verifyOwnPassword(user: AuthUser, password: unknown) {
  const hash = await passwordHashOf(user.id);
  const ok = hash && typeof password === "string" && (await verifyPassword(password, hash)).ok;
  if (!ok) {
    await audit({ userId: user.id, username: user.username }, "auth.reauth_failed", user.username);
    throw new ForbiddenError("Your password is not correct.", "wrong_password");
  }
  return hash;
}

export async function issueReauth(user: AuthUser, input: Record<string, unknown>) {
  const hash = await verifyOwnPassword(user, input.password);
  if ((await mfaEnabled(user.id)) && !(await checkMfaCode(user.id, input.code, { allowSameStep: true })))
    throw new ForbiddenError("That authenticator code is not right.", "mfa_wrong_code");
  const exp = Date.now() + VALID_MS;
  await audit({ userId: user.id, username: user.username }, "auth.reauth", user.username);
  return { token: `${exp}.${sign(hash, user, exp)}`, expiresAt: exp };
}

/** Did this request come with a fresh, valid proof? */
export async function hasFreshReauth(user: AuthUser, request: Request) {
  const [exp = "", signature = ""] = (request.headers.get(REAUTH_HEADER) ?? "").split(".");
  if (!(Number(exp) > Date.now())) return false;
  const hash = await passwordHashOf(user.id);
  if (!hash) return false;
  const expected = Buffer.from(sign(hash, user, Number(exp)));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
