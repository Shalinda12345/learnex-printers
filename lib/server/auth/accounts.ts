import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, withLock, withTransaction } from "@/lib/server/db";
import { audit, auditFloodable } from "@/lib/server/audit";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  UnauthorizedError,
} from "@/lib/server/errors";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "@/lib/server/auth/password";
import { createSession, isKnownDevice, rememberDevice, revokeUserSessions, type AuthUser } from "@/lib/server/auth/session";
import { DEFAULT_ROLES, OWNER_ROLE_KEY } from "@/lib/auth/permissions";
import { checkMfaCode, issueTicket, mfaEnabled, userOfTicket } from "@/lib/server/auth/mfa";

// Five wrong passwords in a row lock an account for 15 minutes. Anyone who knows a username
// can cause such a lock, so it is kept short, it never grows, and it is not a wall for the
// real user:
//  - the count is forgotten once a lock has ended or 15 minutes pass without a new failure,
//    so one guess an hour never adds up to a lock (the attacker needs 5 guesses per 15 minutes);
//  - a browser that has signed in to the account before (see rememberDevice in session.ts)
//    can still sign in while the account is locked, with its own, higher limit.
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const FORGET_AFTER_MINUTES = 15;
const TRUSTED_MAX_FAILURES = 25;
// A one-time password handed out by an administrator stops working after this long.
const TEMP_PASSWORD_HOURS = Number(process.env.AUTH_TEMP_PASSWORD_HOURS) > 0 ? Number(process.env.AUTH_TEMP_PASSWORD_HOURS) : 72;

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const USERNAME_RULE = /^[a-zA-Z0-9._@-]{3,64}$/;

export function validateProfile(
  input: { username?: unknown; name?: unknown; email?: unknown },
  { partial = false } = {},
) {
  const out: { username?: string; name?: string; email?: string | null } = {};
  if (!partial || input.username !== undefined) {
    const username = asText(input.username);
    if (!USERNAME_RULE.test(username)) {
      throw new BadRequestError(
        "Username must be 3–64 characters: letters, numbers, dots, dashes, underscores or @.",
      );
    }
    out.username = username;
  }
  if (!partial || input.name !== undefined) {
    const name = asText(input.name);
    if (!name || name.length > 100) throw new BadRequestError("Enter a name (up to 100 characters).");
    out.name = name;
  }
  if (!partial || input.email !== undefined) {
    const email = asText(input.email);
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
      throw new BadRequestError("Enter a valid email address.");
    out.email = email || null;
  }
  return out;
}

/**
 * Sign-in accepts a username or an email, and prefers the username. So nobody may have a
 * username that is another account's email (or an email that is another's username):
 * the real owner of that email would otherwise sign in to the wrong account.
 * `selfId` is the account being edited (0 for a new one).
 */
export async function assertNoIdentityClash(
  db: Pick<PoolConnection, "query">,
  username: string | undefined,
  email: string | null | undefined,
  selfId = 0,
) {
  // (username against username, and email against email, are the unique keys' job)
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM auth_users WHERE id <> ? AND (email_key = lower(?) OR username_key = lower(?)) LIMIT 1`,
    [selfId, username ?? "", email ?? ""],
  );
  if (rows.length)
    throw new ConflictError("That username or email clashes with another account's email or username.");
}

export function uniqueViolation(e: unknown): HttpError | null {
  const err = e as { errno?: number; sqlMessage?: string };
  if (err.errno !== 1062) return null; // ER_DUP_ENTRY
  // "Duplicate entry 'x' for key 'auth_users_username_key'" (MySQL 8 adds the table: 'auth_users.auth_users_...')
  const key = /for key '([^']*)'$/.exec(err.sqlMessage ?? "")?.[1] ?? "";
  if (key.includes("email")) return new ConflictError("Another account already uses that email.");
  if (key.includes("username")) return new ConflictError("That username is already taken.");
  if (key.includes("roles_name")) return new ConflictError("A role with that name already exists.");
  return new ConflictError("That conflicts with an existing record.");
}

/** Creates the built-in roles the first time (later edits made in the app are kept). */
async function ensureDefaultRoles(conn: PoolConnection) {
  for (const role of DEFAULT_ROLES) {
    const [found] = await conn.query<RowDataPacket[]>(`SELECT 1 FROM auth_roles WHERE \`key\` = ?`, [
      role.key,
    ]);
    if (found.length) continue;
    const [res] = await conn.query<ResultSetHeader>(
      `INSERT INTO auth_roles (\`key\`, name, description, is_system) VALUES (?, ?, ?, ?)`,
      [role.key, role.name, role.description, role.isSystem],
    );
    if (role.permissions.length) {
      await conn.query(`INSERT INTO auth_role_permissions (role_id, permission) VALUES ?`, [
        role.permissions.map((p) => [res.insertId, p]),
      ]);
    }
  }
}

/* ---------------------------------------------------------------- setup */

export async function hasAnyUser() {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM auth_users LIMIT 1`);
  return rows.length > 0;
}

export const setupCodeConfigured = () => !!process.env.AUTH_SETUP_CODE;

function sameSecret(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** First run only: creates the owner account (needs the setup code from .env) and signs it in. */
export async function setupOwner(input: Record<string, unknown>, request: Request) {
  const expected = process.env.AUTH_SETUP_CODE;
  if (!expected)
    throw new HttpError(503, "Set AUTH_SETUP_CODE in the server's .env file to create the owner account.");
  if (!sameSecret(asText(input.setupCode), expected))
    throw new ForbiddenError("That setup code is not correct.", "bad_setup_code");
  const profile = validateProfile(input);
  const problem = passwordProblem(input.password, profile.username);
  if (problem) throw new BadRequestError(problem);
  const hash = await hashPassword(input.password as string);
  // Serialize concurrent setup attempts; only the very first account may be created here.
  const userId = await withLock("owner_setup", () =>
    withTransaction(async (conn) => {
      const [existing] = await conn.query<RowDataPacket[]>(`SELECT 1 FROM auth_users LIMIT 1`);
      if (existing.length)
        throw new ForbiddenError("The owner account already exists. Sign in instead.", "setup_done");
      await ensureDefaultRoles(conn);
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO auth_users (username, name, email, password_hash) VALUES (?, ?, ?, ?)`,
        [profile.username, profile.name, profile.email, hash],
      );
      const id = res.insertId;
      await conn.query(
        `INSERT INTO auth_user_roles (user_id, role_id) SELECT ?, id FROM auth_roles WHERE \`key\` = ?`,
        [id, OWNER_ROLE_KEY],
      );
      await audit(
        { userId: id, username: profile.username! },
        "auth.setup",
        profile.username!,
        { name: profile.name },
        conn,
      );
      return id;
    }),
  );
  await createSession(userId, request);
}

/* ---------------------------------------------------------------- login */

const INVALID = () => new UnauthorizedError("Incorrect username or password.", "invalid_credentials");

/** Has a one-time password (set at `changedAt`) outlived its time? */
export const oneTimePasswordExpired = (changedAt: Date | string) =>
  Date.now() - new Date(changedAt).getTime() > TEMP_PASSWORD_HOURS * 3_600_000;

/** Lock for 15 minutes from the 5th failure on (the count starts again after the lock, see above). */
const lockMinutesFor = (failures: number) => (failures >= MAX_FAILED_LOGINS ? LOCK_MINUTES : 0);

/** The one answer for a locked account, whether or not the account exists. */
function lockedError(until: Date | number) {
  const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));
  return new HttpError(
    429,
    `Too many failed attempts. Try again in ${minutes} minute(s), sign in from a browser you have used before, or ask an administrator to reset your password.`,
    "locked",
  );
}

// The longest a real sign-in name can be is an email address. A longer one is
// not an account, so it is not worth a database lookup (or space in the log).
const MAX_LOGIN_NAME = 254;
const shorten = (text: string, max = 100) => (text.length > max ? text.slice(0, max) + "…" : text);

/**
 * Names that are not accounts get the same attempt counting and the same lock
 * as real ones. Otherwise "Too many failed attempts" (429) next to "Incorrect
 * username or password" (401) would tell an attacker which names exist. Kept in
 * memory (a lock on a name nobody has is not worth a table), limited in size,
 * and forgotten when the server restarts.
 */
const MAX_GHOSTS = 100_000; // large, so filling it up to push names out is not practical
const ghosts = new Map<string, { failures: number; lockedUntil: number; last: number }>();
function reserveGhostAttempt(username: string) {
  const key = username.toLowerCase().slice(0, 100);
  const now = Date.now();
  let known = ghosts.get(key);
  if (known && known.lockedUntil > now) return { locked: true as const, until: known.lockedUntil };
  // the same forgetting as for real accounts: after a lock, or after a quiet quarter of an hour
  if (known && (known.lockedUntil > 0 || now - known.last > FORGET_AFTER_MINUTES * 60_000)) known = undefined;
  const failures = (known?.failures ?? 0) + 1;
  const lockMinutes = lockMinutesFor(failures);
  ghosts.delete(key); // re-inserted: the Map keeps the least recently used name first
  ghosts.set(key, { failures, lockedUntil: lockMinutes ? now + lockMinutes * 60_000 : 0, last: now });
  if (ghosts.size > MAX_GHOSTS) ghosts.delete(ghosts.keys().next().value as string);
  return { locked: false as const, failures, lockMinutes };
}

/**
 * Takes one of an account's sign-in attempts BEFORE its password is checked.
 *
 * Counting after the check (read the counter, spend ~0.3 s verifying the
 * password, write counter + 1) lets any number of simultaneous guesses read the
 * same old value: 30 parallel wrong passwords left the counter at 1 and the
 * account never locked. Here the account's row is locked only for the few
 * milliseconds it takes to count (never while hashing, so no database
 * connection is tied up), so every attempt gets its own number, and the 5th
 * takes the lock straight away. Guess 6 and later are refused without being
 * checked, however many arrive at once. A correct password clears the count.
 *
 * `trusted`: this browser has signed in to the account before. While the account
 * is locked it is let through to the password check anyway (`bypass`), and the
 * caller counts its wrong passwords with `noteTrustedFailure`; its own limit is higher.
 * (`updated_at` serves as "time of the last failure": nothing else touches it often.)
 */
async function reserveLoginAttempt(userId: number, trusted: boolean) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT failed_login_count AS failures, locked_until,
              (locked_until IS NOT NULL AND locked_until > NOW(6)) AS locked,
              (locked_until IS NOT NULL AND locked_until <= NOW(6)
                 OR updated_at < NOW(6) - INTERVAL ? MINUTE) AS forgotten
       FROM auth_users WHERE id = ? FOR UPDATE`,
      [FORGET_AFTER_MINUTES, userId],
    );
    const row = rows[0];
    if (!row) return null;
    const failures = Number(row.forgotten) ? 0 : Number(row.failures);
    if (Number(row.locked)) {
      if (trusted && failures < TRUSTED_MAX_FAILURES) return { locked: false as const, bypass: true as const, failures, lockMinutes: 0 };
      return { locked: true as const, until: row.locked_until as Date };
    }
    const next = failures + 1;
    const lockMinutes = lockMinutesFor(next);
    await conn.query(
      `UPDATE auth_users SET failed_login_count = ?, updated_at = NOW(6),
         locked_until = CASE WHEN ? > 0 THEN NOW(6) + INTERVAL ? MINUTE ELSE NULL END
       WHERE id = ?`,
      [next, lockMinutes, lockMinutes, userId],
    );
    return { locked: false as const, bypass: false as const, failures: next, lockMinutes };
  });
}

/** A known browser got the password wrong while the account was locked: count it (it never locks it further). */
async function noteTrustedFailure(userId: number) {
  await pool.query(
    `UPDATE auth_users SET failed_login_count = LEAST(failed_login_count + 1, ?), updated_at = NOW(6) WHERE id = ?`,
    [TRUSTED_MAX_FAILURES, userId],
  );
}

/** What a sign-in answers: nothing (signed in), or "now ask for the authenticator code" with the ticket for that step. */
export type LoginResult = { mfaRequired: true; ticket: string } | void;

export async function login(input: Record<string, unknown>, request: Request): Promise<LoginResult> {
  const username = asText(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || !password) throw new BadRequestError("Enter your username and password.");

  let user: RowDataPacket | undefined;
  if (username.length <= MAX_LOGIN_NAME) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, username, password_hash, status, must_change_password, password_changed_at
       FROM auth_users WHERE username_key = lower(?) OR email_key = lower(?)
       ORDER BY username_key = lower(?) DESC LIMIT 1`,
      [username, username, username],
    );
    user = rows[0];
  }
  if (!user) {
    const ghost = reserveGhostAttempt(username); // counted and locked like a real account
    await burnPasswordCheck(password); // same timing as a real account
    await auditFloodable(null, "auth.login_failed", shorten(username), {
      reason: "unknown_user",
      locked: ghost.locked || undefined,
    });
    throw ghost.locked ? lockedError(ghost.until) : INVALID();
  }
  const actor = { userId: Number(user.id), username: user.username };

  // This attempt is counted (and the account possibly locked) before the password is looked at.
  const trusted = await isKnownDevice(Number(user.id), user.password_hash);
  const attempt = await reserveLoginAttempt(Number(user.id), trusted);
  if (!attempt) {
    await burnPasswordCheck(password);
    throw INVALID();
  }
  if (attempt.locked) {
    await burnPasswordCheck(password);
    await auditFloodable(actor, "auth.login_failed", user.username, { reason: "locked" });
    throw lockedError(attempt.until);
  }

  const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
  if (!ok) {
    if (attempt.bypass) await noteTrustedFailure(Number(user.id));
    await audit(actor, "auth.login_failed", user.username, {
      reason: "wrong_password",
      failures: attempt.failures,
      lockedMinutes: attempt.lockMinutes || undefined,
      knownBrowser: attempt.bypass || undefined,
    });
    throw INVALID();
  }

  // The password is right, so this attempt (already counted above) was not a failure after all.
  const active = user.status === "active";
  // A one-time password is only good for a while (it was handed over by an administrator).
  // Checked before anything is reset: a refused sign-in must not clear the failure count.
  if (active && user.must_change_password && oneTimePasswordExpired(user.password_changed_at)) {
    await audit(actor, "auth.login_failed", user.username, { reason: "one_time_password_expired" });
    throw new ForbiddenError(
      "This one-time password has expired. Ask an administrator to reset your password again.",
      "temp_password_expired",
    );
  }
  const newHash = active && needsRehash ? await hashPassword(password) : null;
  await pool.query(
    `UPDATE auth_users SET failed_login_count = 0, locked_until = NULL
       ${active ? ", last_login_at = NOW(6)" : ""}${newHash ? ", password_hash = ?" : ""} WHERE id = ?`,
    newHash ? [newHash, user.id] : [user.id],
  );
  if (!active) {
    await audit(actor, "auth.login_failed", user.username, { reason: "disabled" });
    throw new ForbiddenError("This account has been disabled. Ask an administrator.", "disabled");
  }
  // Two-step sign-in: the password is only the first half. Nothing is signed in yet.
  if (await mfaEnabled(actor.userId)) return { mfaRequired: true, ticket: issueTicket(actor.userId) };
  await completeSignIn(actor, newHash ?? user.password_hash, request);
}

/** The second half of a two-step sign-in: the ticket from the password step plus the authenticator (or recovery) code. */
export async function loginWithCode(input: Record<string, unknown>, request: Request) {
  const userId = userOfTicket(input.ticket);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, username, password_hash, status FROM auth_users WHERE id = ?`,
    [userId],
  );
  const user = rows[0];
  if (!user || user.status !== "active") throw new ForbiddenError("This account is not available.", "disabled");
  const actor = { userId: Number(user.id), username: user.username as string };
  if (!(await checkMfaCode(actor.userId, input.code))) {
    await audit(actor, "auth.login_failed", actor.username, { reason: "wrong_mfa_code" });
    throw new UnauthorizedError("That code is not right.", "mfa_wrong_code");
  }
  await completeSignIn(actor, user.password_hash, request);
}

/** Everything that follows a fully checked sign-in: the session, the known-browser cookie and the log entry. */
export async function completeSignIn(
  actor: { userId: number; username: string },
  passwordHash: string,
  request: Request,
) {
  await createSession(actor.userId, request);
  await rememberDevice(actor.userId, passwordHash, request);
  await audit(actor, "auth.login", actor.username, {
    userAgent: request.headers.get("user-agent")?.slice(0, 120),
  });
}

/* ------------------------------------------------------ password change */

/** Changes your own password; every other session of yours is signed out. */
export async function changeOwnPassword(user: AuthUser, input: Record<string, unknown>, request: Request) {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT password_hash FROM auth_users WHERE id = ?`, [
    user.id,
  ]);
  const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
  if (!(await verifyPassword(current, rows[0].password_hash)).ok) {
    throw new BadRequestError("Your current password is not correct.");
  }
  const problem = passwordProblem(input.newPassword, user.username);
  if (problem) throw new BadRequestError(problem);
  if (input.newPassword === current)
    throw new BadRequestError("Choose a password different from the current one.");
  const newHash = await hashPassword(input.newPassword as string);
  await pool.query(
    `UPDATE auth_users SET password_hash = ?, must_change_password = false, password_changed_at = NOW(6), updated_at = NOW(6) WHERE id = ?`,
    [newHash, user.id],
  );
  await rememberDevice(user.id, newHash, request); // the old cookie stops working with the old password
  const signedOut = await revokeUserSessions(user.id, user.sessionId);
  await audit({ userId: user.id, username: user.username }, "auth.password_change", user.username, {
    otherSessionsSignedOut: signedOut,
  });
}
