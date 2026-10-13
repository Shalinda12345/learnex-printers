import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/server/errors";
import { generateTemporaryPassword, hashPassword } from "@/lib/server/auth/password";
import { revokeUserSessions, type AuthUser } from "@/lib/server/auth/session";
import { actorOf } from "@/lib/server/auth/dal";
import { uniqueViolation, validateProfile } from "@/lib/server/auth/accounts";
import { OWNER_ROLE_KEY, PERMISSION_KEYS, isPermission } from "@/lib/auth/permissions";

/* =====================================================================
   USER & ROLE ADMINISTRATION
   Rules that stop anyone from giving themselves (or others) more power
   than they have:
   - you can only grant permissions you hold yourself;
   - only an owner can assign the Owner role or change an owner's account;
   - nobody can change their own roles or disable themselves;
   - there must always be at least one active owner.
   Accounts are disabled, never deleted, so the activity log keeps its history.
===================================================================== */

interface RoleRow {
  id: number;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

async function loadRoles(client: Pick<PoolClient, "query"> = pool): Promise<RoleRow[]> {
  const { rows } = await client.query(
    `SELECT r.id, r.key, r.name, r.description, r.is_system,
            COALESCE(array_agg(rp.permission ORDER BY rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
     FROM auth_roles r LEFT JOIN auth_role_permissions rp ON rp.role_id = r.id
     GROUP BY r.id ORDER BY r.is_system DESC, r.id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    permissions: r.key === OWNER_ROLE_KEY ? PERMISSION_KEYS : r.permissions.filter(isPermission),
  }));
}

const holdsAll = (actor: AuthUser, permissions: string[]) =>
  actor.isOwner || permissions.every((p) => actor.permissions.has(p));

function assertCanGrantRole(actor: AuthUser, role: RoleRow) {
  if (role.key === OWNER_ROLE_KEY ? !actor.isOwner : !holdsAll(actor, role.permissions)) {
    throw new ForbiddenError(
      `You can't assign or remove the "${role.name}" role — it has permissions you don't have.`,
      "escalation",
    );
  }
}

async function ownerCount(client: Pick<PoolClient, "query">) {
  const { rows } = await client.query(
    `SELECT count(DISTINCT u.id)::int AS n FROM auth_users u
     JOIN auth_user_roles ur ON ur.user_id = u.id JOIN auth_roles r ON r.id = ur.role_id
     WHERE r.key = $1 AND u.status = 'active'`,
    [OWNER_ROLE_KEY],
  );
  return rows[0].n as number;
}

interface TargetUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  status: string;
  roleIds: number[];
}

async function targetUser(client: Pick<PoolClient, "query">, id: number): Promise<TargetUser> {
  // Lock the user row so concurrent edits to the same account are serialized.
  const { rows } = await client.query(
    `SELECT id, username, name, email, status FROM auth_users WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("That user doesn't exist.");
  const roles = await client.query(`SELECT role_id FROM auth_user_roles WHERE user_id = $1`, [id]);
  return { ...rows[0], id: Number(rows[0].id), roleIds: roles.rows.map((r) => Number(r.role_id)) };
}

function assertCanManage(actor: AuthUser, target: { roleIds: number[] }, roles: RoleRow[]) {
  const owner = roles.find((r) => r.key === OWNER_ROLE_KEY);
  if (owner && target.roleIds.includes(owner.id) && !actor.isOwner) {
    throw new ForbiddenError("Only an owner can change an owner's account.", "owner_protected");
  }
}

function parseId(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError("That user doesn't exist.");
  return id;
}

function parseRoleIds(value: unknown, roles: RoleRow[]) {
  if (!Array.isArray(value)) throw new BadRequestError("Choose at least one role.");
  const ids = [...new Set(value.map(Number))];
  if (!ids.length) throw new BadRequestError("Choose at least one role.");
  for (const id of ids)
    if (!roles.some((r) => r.id === id)) throw new BadRequestError("One of the chosen roles doesn't exist.");
  return ids;
}

/* ---------------------------------------------------------------- users */

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.name, u.email, u.status, u.must_change_password, u.last_login_at, u.locked_until, u.created_at,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles,
            (SELECT count(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.expires_at > now() AND s.absolute_expires_at > now())::int AS active_sessions
     FROM auth_users u
     LEFT JOIN auth_user_roles ur ON ur.user_id = u.id LEFT JOIN auth_roles r ON r.id = ur.role_id
     GROUP BY u.id ORDER BY u.status, lower(u.name)`,
  );
  return rows.map((u) => ({
    id: Number(u.id),
    username: u.username,
    name: u.name,
    email: u.email,
    status: u.status,
    mustChangePassword: u.must_change_password,
    lastLoginAt: u.last_login_at,
    lockedUntil: u.locked_until && u.locked_until > new Date() ? u.locked_until : null,
    createdAt: u.created_at,
    roles: (u.roles as { id: string; key: string; name: string }[]).map((r) => ({ ...r, id: Number(r.id) })),
    activeSessions: u.active_sessions,
  }));
}

/** Creates a staff account with a one-time password the admin hands over. */
export async function createUser(actor: AuthUser, input: Record<string, unknown>) {
  const profile = validateProfile(input);
  const roles = await loadRoles();
  const roleIds = parseRoleIds(input.roleIds, roles);
  roleIds.forEach((id) => assertCanGrantRole(actor, roles.find((r) => r.id === id)!));
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  try {
    const id = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO auth_users (username, name, email, password_hash, must_change_password, created_by)
         VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
        [profile.username, profile.name, profile.email, hash, actor.id],
      );
      const id = Number(rows[0].id);
      await client.query(
        `INSERT INTO auth_user_roles (user_id, role_id, granted_by) SELECT $1, unnest($2::bigint[]), $3`,
        [id, roleIds, actor.id],
      );
      await audit(
        actorOf(actor),
        "user.create",
        profile.username!,
        {
          name: profile.name,
          roles: roleIds.map((rid) => roles.find((r) => r.id === rid)!.name),
        },
        client,
      );
      return id;
    });
    return { id, temporaryPassword };
  } catch (e) {
    throw uniqueViolation(e) ?? e;
  }
}

/** Edits name/email/roles/status. Disabling an account signs it out everywhere. */
export async function updateUser(actor: AuthUser, rawId: unknown, input: Record<string, unknown>) {
  const id = parseId(rawId);
  const profile = validateProfile(input, { partial: true });
  const status = input.status;
  if (status !== undefined && status !== "active" && status !== "disabled")
    throw new BadRequestError("Unknown status.");
  try {
    const result = await withTransaction(async (client) => {
      const roles = await loadRoles(client);
      const target = await targetUser(client, id);
      assertCanManage(actor, target, roles);
      const changes: Record<string, unknown> = {};

      if (input.roleIds !== undefined) {
        const roleIds = parseRoleIds(input.roleIds, roles);
        const added = roleIds.filter((r) => !target.roleIds.includes(r));
        const removed = target.roleIds.filter((r) => !roleIds.includes(r));
        if ((added.length || removed.length) && id === actor.id) {
          throw new ForbiddenError(
            "You can't change your own roles — ask another administrator or the owner.",
            "self_change",
          );
        }
        [...added, ...removed].forEach((rid) => assertCanGrantRole(actor, roles.find((r) => r.id === rid)!));
        if (removed.length)
          await client.query(
            `DELETE FROM auth_user_roles WHERE user_id = $1 AND role_id = ANY($2::bigint[])`,
            [id, removed],
          );
        if (added.length) {
          await client.query(
            `INSERT INTO auth_user_roles (user_id, role_id, granted_by) SELECT $1, unnest($2::bigint[]), $3`,
            [id, added, actor.id],
          );
        }
        const name = (rid: number) => roles.find((r) => r.id === rid)!.name;
        if (added.length) changes.rolesAdded = added.map(name);
        if (removed.length) changes.rolesRemoved = removed.map(name);
      }
      if (status !== undefined && status !== target.status) {
        if (id === actor.id) throw new ForbiddenError("You can't disable your own account.", "self_change");
        changes.status = status;
      }
      const fields: string[] = [];
      const values: unknown[] = [id];
      for (const [key, col] of [
        ["username", "username"],
        ["name", "name"],
        ["email", "email"],
      ] as const) {
        if (profile[key] !== undefined && profile[key] !== target[col]) {
          values.push(profile[key]);
          fields.push(`${col} = $${values.length}`);
          changes[key] = profile[key];
        }
      }
      if (changes.status) {
        values.push(status);
        fields.push(`status = $${values.length}`);
      }
      if (fields.length)
        await client.query(
          `UPDATE auth_users SET ${fields.join(", ")}, updated_at = now() WHERE id = $1`,
          values,
        );
      if (changes.status === "disabled" || changes.rolesRemoved) {
        if ((await ownerCount(client)) < 1)
          throw new ConflictError("There must always be at least one active owner.");
      }
      if (Object.keys(changes).length)
        await audit(actorOf(actor), "user.update", target.username, changes, client);
      return { disabled: changes.status === "disabled" };
    });
    if (result.disabled) await revokeUserSessions(id);
  } catch (e) {
    throw uniqueViolation(e) ?? e;
  }
}

/** Issues a new one-time password; the user must change it at next sign-in. Signs them out everywhere. */
export async function resetUserPassword(actor: AuthUser, rawId: unknown) {
  const id = parseId(rawId);
  if (id === actor.id)
    throw new ForbiddenError("Use “Change password” to change your own password.", "self_change");
  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);
  await withTransaction(async (client) => {
    const target = await targetUser(client, id);
    assertCanManage(actor, target, await loadRoles(client));
    await client.query(
      `UPDATE auth_users SET password_hash = $2, must_change_password = true, failed_login_count = 0, locked_until = NULL,
         password_changed_at = now(), updated_at = now() WHERE id = $1`,
      [id, hash],
    );
    await audit(actorOf(actor), "user.password_reset", target.username, {}, client);
  });
  await revokeUserSessions(id);
  return { temporaryPassword };
}

export async function signOutUser(actor: AuthUser, rawId: unknown) {
  const id = parseId(rawId);
  const target = await targetUser(pool, id);
  assertCanManage(actor, target, await loadRoles());
  const count = await revokeUserSessions(id, id === actor.id ? actor.sessionId : undefined);
  await audit(actorOf(actor), "user.sign_out", target.username, { sessions: count });
  return { sessions: count };
}

/* ---------------------------------------------------------------- roles */

export async function listRoles() {
  const roles = await loadRoles();
  const { rows } = await pool.query(
    `SELECT role_id, count(*)::int AS n FROM auth_user_roles GROUP BY role_id`,
  );
  const counts = new Map(rows.map((r) => [Number(r.role_id), r.n as number]));
  return roles.map((r) => ({ ...r, userCount: counts.get(r.id) ?? 0 }));
}

function parseRoleInput(input: Record<string, unknown>, actor: AuthUser) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 60) throw new BadRequestError("Enter a role name (up to 60 characters).");
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 300) : "";
  if (!Array.isArray(input.permissions)) throw new BadRequestError("Choose the role's permissions.");
  const permissions = [...new Set(input.permissions as string[])];
  const unknown = permissions.filter((p) => typeof p !== "string" || !isPermission(p));
  if (unknown.length) throw new BadRequestError(`Unknown permission(s): ${unknown.join(", ")}`);
  if (!holdsAll(actor, permissions)) {
    throw new ForbiddenError("A role can only include permissions you have yourself.", "escalation");
  }
  return { name, description, permissions };
}

export async function createRole(actor: AuthUser, input: Record<string, unknown>) {
  const role = parseRoleInput(input, actor);
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO auth_roles (key, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [`custom-${randomBytes(6).toString("hex")}`, role.name, role.description],
      );
      const id = Number(rows[0].id);
      if (role.permissions.length) {
        await client.query(
          `INSERT INTO auth_role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`,
          [id, role.permissions],
        );
      }
      await audit(actorOf(actor), "role.create", role.name, { permissions: role.permissions }, client);
      return { id };
    });
  } catch (e) {
    throw uniqueViolation(e) ?? e;
  }
}

async function editableRole(client: PoolClient, actor: AuthUser, rawId: unknown) {
  const id = Number(rawId);
  const role = (await loadRoles(client)).find((r) => r.id === id);
  if (!role) throw new NotFoundError("That role doesn't exist.");
  if (role.isSystem) throw new ForbiddenError(`The ${role.name} role can't be changed.`, "system_role");
  if (!holdsAll(actor, role.permissions)) {
    throw new ForbiddenError("You can't change a role that has permissions you don't have.", "escalation");
  }
  return role;
}

/** Changes take effect immediately for everyone holding the role (permissions are checked on every request). */
export async function updateRole(actor: AuthUser, rawId: unknown, input: Record<string, unknown>) {
  try {
    await withTransaction(async (client) => {
      const role = await editableRole(client, actor, rawId);
      const next = parseRoleInput(input, actor);
      await client.query(
        `UPDATE auth_roles SET name = $2, description = $3, updated_at = now() WHERE id = $1`,
        [role.id, next.name, next.description],
      );
      await client.query(`DELETE FROM auth_role_permissions WHERE role_id = $1`, [role.id]);
      if (next.permissions.length) {
        await client.query(
          `INSERT INTO auth_role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`,
          [role.id, next.permissions],
        );
      }
      await audit(
        actorOf(actor),
        "role.update",
        next.name,
        {
          renamedFrom: next.name !== role.name ? role.name : undefined,
          added: next.permissions.filter((p) => !role.permissions.includes(p)),
          removed: role.permissions.filter((p) => !next.permissions.includes(p)),
        },
        client,
      );
    });
  } catch (e) {
    throw uniqueViolation(e) ?? e;
  }
}

export async function deleteRole(actor: AuthUser, rawId: unknown) {
  await withTransaction(async (client) => {
    const role = await editableRole(client, actor, rawId);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM auth_user_roles WHERE role_id = $1`, [
      role.id,
    ]);
    if (rows[0].n)
      throw new ConflictError(
        `${rows[0].n} user(s) still have the "${role.name}" role. Change their roles first.`,
      );
    await client.query(`DELETE FROM auth_roles WHERE id = $1`, [role.id]);
    await audit(actorOf(actor), "role.delete", role.name, { permissions: role.permissions }, client);
  });
}

/* ---------------------------------------------------------- activity log */

export async function listAudit(params: URLSearchParams) {
  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 500);
  const where: string[] = [];
  const values: unknown[] = [];
  const before = Number(params.get("before"));
  if (before > 0) {
    values.push(before);
    where.push(`id < $${values.length}`);
  }
  const action = params.get("action");
  if (action) {
    values.push(action + "%");
    where.push(`action LIKE $${values.length}`);
  }
  const user = params.get("user");
  if (user) {
    values.push(user.toLowerCase());
    where.push(`lower(username) = $${values.length}`);
  }
  values.push(limit);
  const { rows } = await pool.query(
    `SELECT id, at, user_id, username, action, target, details FROM audit_log
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT $${values.length}`,
    values,
  );
  return {
    entries: rows.map((r) => ({ ...r, id: Number(r.id), user_id: r.user_id && Number(r.user_id) })),
    nextBefore: rows.length === limit ? Number(rows[rows.length - 1].id) : null,
  };
}
