import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
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

export async function createSession(userId: number, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const absolute = new Date(now + ABSOLUTE_MS);
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, expires_at, absolute_expires_at, user_agent) VALUES ($1, $2, $3, $4, $5)`,
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

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SECURE_COOKIE);
  jar.delete(PLAIN_COOKIE);
}

/** Ends the current session (sign out). */
export async function destroyCurrentSession() {
  const token = await currentToken();
  if (token) await pool.query(`DELETE FROM auth_sessions WHERE id = $1`, [hashToken(token)]);
  await clearSessionCookie();
}

export async function revokeUserSessions(userId: number, exceptSessionId?: string) {
  const res = await pool.query(`DELETE FROM auth_sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2`, [
    userId,
    exceptSessionId ?? null,
  ]);
  return res.rowCount ?? 0;
}

/**
 * The signed-in user for this request (with roles and permissions), or null.
 * Expired sessions and disabled accounts count as signed out.
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  const token = await currentToken();
  if (!token) return null;
  const id = hashToken(token);
  const { rows } = await pool.query(
    `SELECT s.id AS session_id, s.last_seen_at, s.expires_at, s.absolute_expires_at,
            u.id, u.username, u.name, u.email, u.status, u.must_change_password,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name))
                     FILTER (WHERE r.id IS NOT NULL), '[]') AS roles,
            COALESCE(array_agg(DISTINCT rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
     FROM auth_sessions s
     JOIN auth_users u ON u.id = s.user_id
     LEFT JOIN auth_user_roles ur ON ur.user_id = u.id
     LEFT JOIN auth_roles r ON r.id = ur.role_id
     LEFT JOIN auth_role_permissions rp ON rp.role_id = r.id
     WHERE s.id = $1
     GROUP BY s.id, u.id`,
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
    if (row) await pool.query(`DELETE FROM auth_sessions WHERE id = $1`, [id]);
    return null;
  }
  // Sliding idle timeout (never past the absolute limit).
  if (now - row.last_seen_at.getTime() > TOUCH_EVERY_MS) {
    const expires = new Date(Math.min(now + IDLE_MS, row.absolute_expires_at.getTime()));
    await pool.query(`UPDATE auth_sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1`, [
      id,
      expires,
    ]);
  }
  const roles = (row.roles as { id: string | number; key: string; name: string }[])
    .map((r) => ({ id: Number(r.id), key: r.key, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const isOwner = roles.some((r) => r.key === OWNER_ROLE_KEY);
  return {
    id: Number(row.id),
    username: row.username,
    name: row.name,
    email: row.email,
    mustChangePassword: row.must_change_password,
    roles,
    // The owner always has every permission, including ones added later.
    permissions: new Set(isOwner ? PERMISSION_KEYS : (row.permissions as string[]).filter(isPermission)),
    isOwner,
    sessionId: id,
  };
}
