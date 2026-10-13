import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  UnauthorizedError,
} from "@/lib/server/errors";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "@/lib/server/auth/password";
import { createSession, revokeUserSessions, type AuthUser } from "@/lib/server/auth/session";
import { DEFAULT_ROLES, OWNER_ROLE_KEY } from "@/lib/auth/permissions";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

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
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestError("Enter a valid email address.");
    out.email = email || null;
  }
  return out;
}

export function uniqueViolation(e: unknown): HttpError | null {
  const err = e as { code?: string; constraint?: string };
  if (err.code !== "23505") return null;
  if (err.constraint?.includes("email")) return new ConflictError("Another account already uses that email.");
  if (err.constraint?.includes("username")) return new ConflictError("That username is already taken.");
  if (err.constraint?.includes("roles_name"))
    return new ConflictError("A role with that name already exists.");
  return new ConflictError("That conflicts with an existing record.");
}

/** Creates the built-in roles the first time (later edits made in the app are kept). */
async function ensureDefaultRoles(client: PoolClient) {
  for (const role of DEFAULT_ROLES) {
    const { rows } = await client.query(
      `INSERT INTO auth_roles (key, name, description, is_system) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO NOTHING RETURNING id`,
      [role.key, role.name, role.description, role.isSystem],
    );
    if (rows.length && role.permissions.length) {
      await client.query(
        `INSERT INTO auth_role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`,
        [rows[0].id, role.permissions],
      );
    }
  }
}

/* ---------------------------------------------------------------- setup */

export async function hasAnyUser() {
  const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM auth_users) AS any`);
  return rows[0].any as boolean;
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
  const userId = await withTransaction(async (client) => {
    // Serialize concurrent setup attempts; only the very first account may be created here.
    await client.query(`LOCK TABLE auth_users IN EXCLUSIVE MODE`);
    const { rows: existing } = await client.query(`SELECT 1 FROM auth_users LIMIT 1`);
    if (existing.length)
      throw new ForbiddenError("The owner account already exists. Sign in instead.", "setup_done");
    await ensureDefaultRoles(client);
    const { rows } = await client.query(
      `INSERT INTO auth_users (username, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
      [profile.username, profile.name, profile.email, hash],
    );
    const id = Number(rows[0].id);
    await client.query(
      `INSERT INTO auth_user_roles (user_id, role_id) SELECT $1, id FROM auth_roles WHERE key = $2`,
      [id, OWNER_ROLE_KEY],
    );
    await audit(
      { userId: id, username: profile.username! },
      "auth.setup",
      profile.username!,
      { name: profile.name },
      client,
    );
    return id;
  });
  await createSession(userId, request);
}

/* ---------------------------------------------------------------- login */

const INVALID = () => new UnauthorizedError("Incorrect username or password.", "invalid_credentials");

export async function login(input: Record<string, unknown>, request: Request) {
  const username = asText(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  if (!username || !password) throw new BadRequestError("Enter your username and password.");

  const { rows } = await pool.query(
    `SELECT id, username, password_hash, status, failed_login_count, locked_until
     FROM auth_users WHERE lower(username) = lower($1) OR lower(email) = lower($1)
     ORDER BY lower(username) = lower($1) DESC LIMIT 1`,
    [username],
  );
  const user = rows[0];
  if (!user) {
    await burnPasswordCheck(password); // same timing as a real account
    await audit(null, "auth.login_failed", username, { reason: "unknown_user" });
    throw INVALID();
  }
  const actor = { userId: Number(user.id), username: user.username };
  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    await burnPasswordCheck(password);
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
    await audit(actor, "auth.login_failed", user.username, { reason: "locked" });
    throw new HttpError(
      429,
      `Too many failed attempts. Try again in ${minutes} minute(s), or ask an administrator to reset your password.`,
      "locked",
    );
  }

  const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const failures = user.failed_login_count + 1;
    // Lock after 5 failures; each further failure doubles the lock (max 24h).
    const lockMinutes =
      failures >= MAX_FAILED_LOGINS
        ? Math.min(LOCK_MINUTES * 2 ** (failures - MAX_FAILED_LOGINS), 24 * 60)
        : 0;
    await pool.query(
      `UPDATE auth_users SET failed_login_count = $2,
         locked_until = CASE WHEN $3::int > 0 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
       WHERE id = $1`,
      [user.id, failures, lockMinutes],
    );
    await audit(actor, "auth.login_failed", user.username, {
      reason: "wrong_password",
      failures,
      lockedMinutes: lockMinutes || undefined,
    });
    throw INVALID();
  }
  if (user.status !== "active") {
    await audit(actor, "auth.login_failed", user.username, { reason: "disabled" });
    throw new ForbiddenError("This account has been disabled. Ask an administrator.", "disabled");
  }

  await pool.query(
    `UPDATE auth_users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
       ${needsRehash ? ", password_hash = $2" : ""} WHERE id = $1`,
    needsRehash ? [user.id, await hashPassword(password)] : [user.id],
  );
  await createSession(Number(user.id), request);
  await audit(actor, "auth.login", user.username, {
    userAgent: request.headers.get("user-agent")?.slice(0, 120),
  });
}

/* ------------------------------------------------------ password change */

/** Changes your own password; every other session of yours is signed out. */
export async function changeOwnPassword(user: AuthUser, input: Record<string, unknown>) {
  const { rows } = await pool.query(`SELECT password_hash FROM auth_users WHERE id = $1`, [user.id]);
  const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
  if (!(await verifyPassword(current, rows[0].password_hash)).ok) {
    throw new BadRequestError("Your current password is not correct.");
  }
  const problem = passwordProblem(input.newPassword, user.username);
  if (problem) throw new BadRequestError(problem);
  if (input.newPassword === current)
    throw new BadRequestError("Choose a password different from the current one.");
  await pool.query(
    `UPDATE auth_users SET password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now() WHERE id = $1`,
    [user.id, await hashPassword(input.newPassword as string)],
  );
  const signedOut = await revokeUserSessions(user.id, user.sessionId);
  await audit({ userId: user.id, username: user.username }, "auth.password_change", user.username, {
    otherSessionsSignedOut: signedOut,
  });
}
