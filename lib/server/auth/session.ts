import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "@/lib/server/db";
import { OWNER_ROLE_KEY, PERMISSION_KEYS, isPermission } from "@/lib/auth/permissions";

/* =====================================================================
   SESSIONS — a random token in an HttpOnly cookie; the database keeps only
   its SHA-256, so sessions can be listed and revoked (sign out, disabled
   account, password reset) and a database leak can't be replayed.
===================================================================== */

const HOUR = 60 * 60 * 1000;
const IDLE_MS = (Number(process.env.AUTH_SESSION_IDLE_HOURS) || 12) * HOUR;
const ABSOLUTE_MS = (Number(process.env.AUTH_SESSION_MAX_DAYS) || 7) * 24 * HOUR;
const TOUCH_EVERY_MS = 60 * 1000; // how often "last seen" / idle expiry is refreshed

// "__Host-" cookies must be Secure, so that name is only used over HTTPS.
const SECURE_COOKIE = "__Host-learnex_session";
const PLAIN_COOKIE = "learnex_session";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  mustChangePassword: boolean;
  roles: { id: number; key: string; name: string }[];
  permissions: Set<string>;
  isOwner: boolean;
  sessionId: string;
}

/** Was this request made over HTTPS (directly or via a proxy that says so)? */
export function isHttps(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(request.url).protocol === "https:";
}

/* ------------------------------------------------------------ known browsers
   After a correct sign-in the browser is given a second cookie that proves it has signed in to
   this account before. Anyone who knows a username can make wrong guesses and so lock the
   account, but only for browsers that do not carry this cookie: the owner's own browser can
   still sign in (see `trusted` in accounts.ts). The cookie is signed with the account's
   password hash, so it cannot be forged and stops working when the password changes. */
const DEVICE_COOKIE = "learnex_device";
const SECURE_DEVICE_COOKIE = "__Host-learnex_device";
const DEVICE_DAYS = 180;

const deviceSignature = (userId: number, passwordHash: string) =>
  createHmac("sha256", passwordHash).update(`learnex-device:${userId}`).digest("base64url");

// One browser can be used by several people (owner, cashier, ...): the cookie holds one
// "id.signature" entry per account, separated by "~", so signing in as one does not make the
// browser forget the others. The newest MAX_DEVICE_ENTRIES are kept.
const MAX_DEVICE_ENTRIES = 8;

async function deviceEntries() {
  const jar = await cookies();
  const value = jar.get(SECURE_DEVICE_COOKIE)?.value ?? jar.get(DEVICE_COOKIE)?.value ?? "";
  return value.split("~").filter((e) => /^\d+\.[A-Za-z0-9_-]+$/.test(e));
}

export async function rememberDevice(userId: number, passwordHash: string, request: Request) {
  const secure = isHttps(request);
  const jar = await cookies();
  const others = (await deviceEntries()).filter((e) => Number(e.split(".")[0]) !== userId);
  const entries = [...others, `${userId}.${deviceSignature(userId, passwordHash)}`].slice(-MAX_DEVICE_ENTRIES);
  jar.set(secure ? SECURE_DEVICE_COOKIE : DEVICE_COOKIE, entries.join("~"), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_DAYS * 24 * 60 * 60,
  });
}

/** Has this browser signed in to this account before (and the password not changed since)? */
export async function isKnownDevice(userId: number, passwordHash: string) {
  const mine = (await deviceEntries()).find((e) => Number(e.split(".")[0]) === userId);
  if (!mine) return false;
  const expected = Buffer.from(deviceSignature(userId, passwordHash));
  const given = Buffer.from(mine.split(".")[1] ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Sessions that ended without a sign-out (closed browser, expired) are only noticed when
// somebody presents them, so they would pile up. Removed at most once an hour
// (AUTH_PRUNE_MINUTES), a few thousand at a time, whenever someone signs in.
const PRUNE_EVERY_MS = (process.env.AUTH_PRUNE_MINUTES !== undefined && process.env.AUTH_PRUNE_MINUTES !== "" && Number(process.env.AUTH_PRUNE_MINUTES) >= 0 ? Number(process.env.AUTH_PRUNE_MINUTES) : 60) * 60_000;
let lastSessionPrune = 0;
async function pruneSessions() {
  if (Date.now() - lastSessionPrune < PRUNE_EVERY_MS) return;
  lastSessionPrune = Date.now();
  await pool
    .query(`DELETE FROM auth_sessions WHERE expires_at < NOW(6) OR absolute_expires_at < NOW(6) LIMIT 5000`)
    .catch(() => {});
}

export async function createSession(userId: number, request: Request) {
  void pruneSessions();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const absolute = new Date(now + ABSOLUTE_MS);
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, expires_at, absolute_expires_at, user_agent) VALUES (?, ?, ?, ?, ?)`,
    [
      hashToken(token),
      userId,
      new Date(Math.min(now + IDLE_MS, absolute.getTime())),
      absolute,
      request.headers.get("user-agent")?.slice(0, 300) ?? null,
    ],
  );
  const secure = isHttps(request);
  const jar = await cookies();
  jar.set(secure ? SECURE_COOKIE : PLAIN_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: absolute,
  });
}

async function currentToken() {
  const jar = await cookies();
  return jar.get(SECURE_COOKIE)?.value ?? jar.get(PLAIN_COOKIE)?.value ?? null;
}

async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SECURE_COOKIE);
  jar.delete(PLAIN_COOKIE);
}

/** Ends the current session (sign out). */
export async function destroyCurrentSession() {
  const token = await currentToken();
  if (token) await pool.query(`DELETE FROM auth_sessions WHERE id = ?`, [hashToken(token)]);
  await clearSessionCookie();
}

export async function revokeUserSessions(userId: number, exceptSessionId?: string) {
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM auth_sessions WHERE user_id = ? AND NOT (id <=> ?)`,
    [userId, exceptSessionId ?? null],
  );
  return res.affectedRows;
}

/**
 * The signed-in user for this request (with roles and permissions), or null.
 * Expired sessions and disabled accounts count as signed out.
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  const token = await currentToken();
  if (!token) return null;
  const id = hashToken(token);
  // One row per (role, permission) the user has; gathered below.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.last_seen_at, s.expires_at, s.absolute_expires_at,
            u.id, u.username, u.name, u.email, u.status, u.must_change_password,
            r.id AS role_id, r.\`key\` AS role_key, r.name AS role_name, rp.permission
     FROM auth_sessions s
     JOIN auth_users u ON u.id = s.user_id
     LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
     LEFT JOIN auth_roles r ON r.id = ur.role_id
     LEFT JOIN auth_role_permissions rp ON rp.role_id = r.id
     WHERE s.id = ?`,
    [id],
  );
  const row = rows[0];
  const now = Date.now();
  if (
    !row ||
    row.status !== "active" ||
    row.expires_at.getTime() <= now ||
    row.absolute_expires_at.getTime() <= now
  ) {
    if (row) await pool.query(`DELETE FROM auth_sessions WHERE id = ?`, [id]);
    return null;
  }
  // Sliding idle timeout (never past the absolute limit).
  if (now - row.last_seen_at.getTime() > TOUCH_EVERY_MS) {
    const expires = new Date(Math.min(now + IDLE_MS, row.absolute_expires_at.getTime()));
    await pool.query(`UPDATE auth_sessions SET last_seen_at = NOW(6), expires_at = ? WHERE id = ?`, [
      expires,
      id,
    ]);
  }
  const byId = new Map<number, { id: number; key: string; name: string }>();
  const granted = new Set<string>();
  for (const r of rows) {
    if (r.role_id !== null)
      byId.set(Number(r.role_id), { id: Number(r.role_id), key: r.role_key, name: r.role_name });
    if (r.permission !== null) granted.add(r.permission);
  }
  const roles = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  const isOwner = roles.some((r) => r.key === OWNER_ROLE_KEY);
  return {
    id: Number(row.id),
    username: row.username,
    name: row.name,
    email: row.email,
    mustChangePassword: row.must_change_password,
    roles,
    // The owner always has every permission, including ones added later.
    permissions: new Set(isOwner ? PERMISSION_KEYS : [...granted].filter(isPermission)),
    isOwner,
    sessionId: id,
  };
}
