import "server-only";
import { ForbiddenError, UnauthorizedError } from "@/lib/server/errors";
import { getSessionUser, type AuthUser } from "@/lib/server/auth/session";
import type { Actor } from "@/lib/server/audit";

/* =====================================================================
   DATA ACCESS LAYER — every API route checks access through here, on the
   server, for every request (never in the browser or in Proxy alone).
===================================================================== */

/**
 * The signed-in user, or a 401. Users who must set a new password can only
 * reach the endpoints that allow it (session info, password change, sign out).
 */
export async function requireUser(options: { allowPendingPasswordChange?: boolean } = {}): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  if (user.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new ForbiddenError("Set a new password before continuing.", "password_change_required");
  }
  return user;
}

export function hasPermission(user: AuthUser, permission: string) {
  return user.permissions.has(permission);
}

export function requirePermission(user: AuthUser, ...anyOf: string[]) {
  if (!anyOf.some((p) => user.permissions.has(p))) throw new ForbiddenError();
}

/**
 * Refuses state-changing requests sent from another website (CSRF). Browsers
 * always send Origin on such requests; it must match the host serving the app.
 * (The SameSite=Lax session cookie is the first line of defense.)
 */
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return; // not a browser cross-site request (e.g. scripts, tests)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {}
  if (!host || originHost !== host) throw new ForbiddenError("Cross-site request refused.", "cross_site");
}

export const actorOf = (user: AuthUser): Actor => ({ userId: user.id, username: user.username });

/** What the browser is told about the signed-in user. */
export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    isOwner: user.isOwner,
    roles: user.roles.map((r) => ({ key: r.key, name: r.name })),
    permissions: [...user.permissions].sort(),
  };
}
