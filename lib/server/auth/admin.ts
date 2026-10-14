import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, withTransaction, type Db } from "@/lib/server/db";
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

async function loadRoles(db: Db = pool): Promise<RoleRow[]> {
  // One row per (role, permission); a role without permissions has one row with a null permission.
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT r.id, r.\`key\`, r.name, r.description, r.is_system, rp.permission
     FROM auth_roles r LEFT JOIN auth_role_permissions rp ON rp.role_id = r.id
     ORDER BY r.is_system DESC, r.id, rp.permission`,
  );
  const roles = new Map<number, RoleRow>();
  for (const r of rows) {
    const id = Number(r.id);
    if (!roles.has(id)) {
      roles.set(id, {
        id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        permissions: [],
      });
    }
    if (r.permission !== null) roles.get(id)!.permissions.push(r.permission);
  }
  return [...roles.values()].map((r) => ({
    ...r,
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

async function ownerCount(db: Db) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT count(DISTINCT u.id) AS n FROM auth_users u
     JOIN auth_user_roles ur ON ur.user_id = u.id JOIN auth_roles r ON r.id = ur.role_id
     WHERE r.\`key\` = ? AND u.status = 'active'`,
    [OWNER_ROLE_KEY],
  );
  return Number(rows[0].n);
}

interface TargetUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  status: string;
  roleIds: number[];
}

async function targetUser(db: Db, id: number): Promise<TargetUser> {
  // Lock the user row so concurrent edits to the same account are serialized.
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, username, name, email, status FROM auth_users WHERE id = ? FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("That user doesn't exist.");
  const [roles] = await db.query<RowDataPacket[]>(`SELECT role_id FROM auth_user_roles WHERE user_id = ?`, [
    id,
  ]);
  const { username, name, email, status } = rows[0];
  return {
    id: Number(rows[0].id),
    username,
    name,
    email,
    status,
    roleIds: roles.map((r) => Number(r.role_id)),
  };
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
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.username, u.name, u.email, u.status, u.must_change_password, u.last_login_at, u.locked_until, u.created_at,
            (SELECT count(*) FROM auth_sessions s WHERE s.user_id = u.id AND s.expires_at > NOW(6) AND s.absolute_expires_at > NOW(6)) AS active_sessions
     FROM auth_users u ORDER BY u.status, lower(u.name)`,
  );
  const [grants] = await pool.query<RowDataPacket[]>(
    `SELECT ur.user_id, r.id, r.\`key\`, r.name
     FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id ORDER BY r.id`,
  );
  const rolesOf = new Map<number, { id: number; key: string; name: string }[]>();
  for (const g of grants) {
    const userId = Number(g.user_id);
    rolesOf.set(userId, [...(rolesOf.get(userId) ?? []), { id: Number(g.id), key: g.key, name: g.name }]);
  }
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
    roles: rolesOf.get(Number(u.id)) ?? [],
    activeSessions: Number(u.active_sessions),
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
    const id = await withTransaction(async (conn) => {
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO auth_users (username, name, email, password_hash, must_change_password, created_by)
         VALUES (?, ?, ?, ?, true, ?)`,
        [profile.username, profile.name, profile.email, hash, actor.id],
      );
      const id = res.insertId;
      await conn.query(`INSERT INTO auth_user_roles (user_id, role_id, granted_by) VALUES ?`, [
        roleIds.map((roleId) => [id, roleId, actor.id]),
      ]);
      await audit(
        actorOf(actor),
        "user.create",
        profile.username!,
        {
          name: profile.name,
          roles: roleIds.map((rid) => roles.find((r) => r.id === rid)!.name),
        },
        conn,
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
    const result = await withTransaction(async (conn) => {
      const roles = await loadRoles(conn);
      const target = await targetUser(conn, id);
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
          await conn.query(`DELETE FROM auth_user_roles WHERE user_id = ? AND role_id IN (?)`, [id, removed]);
        if (added.length) {
          await conn.query(`INSERT INTO auth_user_roles (user_id, role_id, granted_by) VALUES ?`, [
            added.map((roleId) => [id, roleId, actor.id]),
          ]);
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
      const values: unknown[] = [];
      for (const [key, col] of [
        ["username", "username"],
        ["name", "name"],
        ["email", "email"],
      ] as const) {
        if (profile[key] !== undefined && profile[key] !== target[col]) {
          values.push(profile[key]);
          fields.push(`${col} = ?`);
          changes[key] = profile[key];
        }
      }
      if (changes.status) {
        values.push(status);
        fields.push(`status = ?`);
      }
      if (fields.length)
        await conn.query(`UPDATE auth_users SET ${fields.join(", ")}, updated_at = NOW(6) WHERE id = ?`, [
          ...values,
          id,
        ]);
      if (changes.status === "disabled" || changes.rolesRemoved) {
        if ((await ownerCount(conn)) < 1)
          throw new ConflictError("There must always be at least one active owner.");
      }
      if (Object.keys(changes).length)
        await audit(actorOf(actor), "user.update", target.username, changes, conn);
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
  await withTransaction(async (conn) => {
    const target = await targetUser(conn, id);
    assertCanManage(actor, target, await loadRoles(conn));
    await conn.query(
      `UPDATE auth_users SET password_hash = ?, must_change_password = true, failed_login_count = 0, locked_until = NULL,
         password_changed_at = NOW(6), updated_at = NOW(6) WHERE id = ?`,
      [hash, id],
    );
    await audit(actorOf(actor), "user.password_reset", target.username, {}, conn);
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
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role_id, count(*) AS n FROM auth_user_roles GROUP BY role_id`,
  );
  const counts = new Map(rows.map((r) => [Number(r.role_id), Number(r.n)]));
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
    return await withTransaction(async (conn) => {
      const [res] = await conn.query<ResultSetHeader>(
        `INSERT INTO auth_roles (\`key\`, name, description) VALUES (?, ?, ?)`,
        [`custom-${randomBytes(6).toString("hex")}`, role.name, role.description],
      );
      const id = res.insertId;
      if (role.permissions.length) {
        await conn.query(`INSERT INTO auth_role_permissions (role_id, permission) VALUES ?`, [
          role.permissions.map((p) => [id, p]),
        ]);
      }
      await audit(actorOf(actor), "role.create", role.name, { permissions: role.permissions }, conn);
      return { id };
    });
  } catch (e) {
    throw uniqueViolation(e) ?? e;
  }
}

async function editableRole(conn: PoolConnection, actor: AuthUser, rawId: unknown) {
  const id = Number(rawId);
  const role = (await loadRoles(conn)).find((r) => r.id === id);
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
    await withTransaction(async (conn) => {
      const role = await editableRole(conn, actor, rawId);
      const next = parseRoleInput(input, actor);
      await conn.query(`UPDATE auth_roles SET name = ?, description = ?, updated_at = NOW(6) WHERE id = ?`, [
        next.name,
        next.description,
        role.id,
      ]);
      await conn.query(`DELETE FROM auth_role_permissions WHERE role_id = ?`, [role.id]);
      if (next.permissions.length) {
        await conn.query(`INSERT INTO auth_role_permissions (role_id, permission) VALUES ?`, [
          next.permissions.map((p) => [role.id, p]),
        ]);
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
        conn,
      );
    });
  } catch (e) {
    throw uniqueViolation(e) ?? e;
  }
}

export async function deleteRole(actor: AuthUser, rawId: unknown) {
  await withTransaction(async (conn) => {
    const role = await editableRole(conn, actor, rawId);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT count(*) AS n FROM auth_user_roles WHERE role_id = ?`,
      [role.id],
    );
    const holders = Number(rows[0].n);
    if (holders)
      throw new ConflictError(
        `${holders} user(s) still have the "${role.name}" role. Change their roles first.`,
      );
    await conn.query(`DELETE FROM auth_roles WHERE id = ?`, [role.id]);
    await audit(actorOf(actor), "role.delete", role.name, { permissions: role.permissions }, conn);
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
    where.push(`id < ?`);
  }
  const action = params.get("action");
  if (action) {
    values.push(action + "%");
    where.push(`action LIKE ?`);
  }
  const user = params.get("user");
  if (user) {
    values.push(user.toLowerCase());
    where.push(`lower(username) = ?`);
  }
  values.push(limit);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, at, user_id, username, action, target, details FROM audit_log
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`,
    values,
  );
  return {
    entries: rows.map((r) => ({
      ...r,
      id: Number(r.id),
      user_id: r.user_id && Number(r.user_id),
      details: JSON.parse(r.details),
    })),
    nextBefore: rows.length === limit ? Number(rows[rows.length - 1].id) : null,
  };
}
