import { useCallback, useEffect, useState } from "react";
import { Badge, Field, Modal, inputCls } from "@/components/learnex/ui";
import { Pencil, Plus, Save, ShieldCheck, Trash2, UserPlus } from "@/components/learnex/icons";
import {
  createRole,
  createUser,
  deleteRole,
  listRoles,
  listUsers,
  resetUserPassword,
  setUserRoles,
  signOutUser,
  updateRole,
  updateUser,
} from "@/lib/learnex/auth-client";
import { OWNER_ROLE_KEY, PERMISSIONS } from "@/lib/auth/permissions";

/* =====================================================================
   USERS & ROLES — staff accounts, their roles, and what each role may do.
   Everything here is checked again on the server; the disabled checkboxes
   only show what you're not allowed to hand out.
===================================================================== */

const fmtWhen = (v) => (v ? new Date(v).toLocaleString() : "Never");
const primaryBtn =
  "flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-50";
const iconBtn = (dark) =>
  `w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`;
const textBtn = (dark) =>
  `text-xs font-medium px-2.5 py-1.5 rounded-lg border ${dark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`;

/** Can the signed-in user hand out this role? (Mirrors the server's rule.) */
function canGrant(auth, role) {
  if (auth.user.isOwner) return true;
  if (role.key === OWNER_ROLE_KEY) return false;
  return role.permissions.every((p) => auth.can(p));
}

export function UsersAndRoles({ auth, dark, cardBg, subText, inputBg, hoverRow, setToast }) {
  const manageUsers = auth.can("users.manage");
  const manageRoles = auth.can("roles.manage");
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState(null); // {} = new user
  const [editingRole, setEditingRole] = useState(null); // {} = new role
  const [oneTimePassword, setOneTimePassword] = useState(null);
  const theme = { dark, cardBg, subText, inputBg };

  const reload = useCallback(async () => {
    try {
      if (manageUsers) {
        const data = await listUsers();
        setUsers(data.users);
        setRoles(data.roles);
      } else {
        setRoles((await listRoles()).roles);
      }
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [manageUsers]);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);

  async function act(fn, success) {
    try {
      const result = await fn();
      if (success) setToast(typeof success === "function" ? success(result) : success);
      await reload();
      return result;
    } catch (e) {
      setToast(e.message);
      return null;
    }
  }

  async function resetPassword(u) {
    if (!window.confirm(`Reset ${u.name}'s password? They will be signed out and get a one-time password.`))
      return;
    const r = await act(() => resetUserPassword(u.id));
    if (r) setOneTimePassword({ user: u, password: r.temporaryPassword, reason: "reset" });
  }
  function toggleStatus(u) {
    const disabling = u.status === "active";
    if (
      disabling &&
      !window.confirm(
        `Disable ${u.name}'s account? They will be signed out and can't sign in until re-enabled.`,
      )
    )
      return;
    act(
      () => updateUser(u.id, { status: disabling ? "disabled" : "active" }),
      `${u.name}'s account ${disabling ? "disabled" : "enabled"}.`,
    );
  }
  function signOutEverywhere(u) {
    act(
      () => signOutUser(u.id),
      (r) => `${u.name} was signed out of ${r.sessions} session(s).`,
    );
  }
  function removeRole(r) {
    if (!window.confirm(`Delete the "${r.name}" role?`)) return;
    act(() => deleteRole(r.id), `Role "${r.name}" deleted.`);
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {manageUsers && (
        <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
          <div className="flex items-center justify-between p-5">
            <div>
              <h3 className="font-semibold">Staff accounts</h3>
              <p className={`text-xs ${subText}`}>
                Everyone who can sign in, and what they&apos;re allowed to do.
              </p>
            </div>
            <button onClick={() => setEditingUser({})} className={primaryBtn}>
              <UserPlus size={15} />
              {" Add User"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr
                  className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <th className="font-medium py-3 px-5">Name</th>
                  <th className="font-medium py-3 px-2">Roles</th>
                  <th className="font-medium py-3 px-2">Status</th>
                  <th className="font-medium py-3 px-2">Last sign-in</th>
                  <th className="font-medium py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const self = u.id === auth.user.id;
                  return (
                    <tr
                      key={u.id}
                      className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                    >
                      <td className="py-3 px-5">
                        <p className="font-medium">
                          {u.name}
                          {self && <span className={`text-xs ${subText}`}>{" (you)"}</span>}
                        </p>
                        <p className={`text-xs ${subText}`}>
                          {"@"}
                          {u.username}
                          {u.email ? ` · ${u.email}` : ""}
                        </p>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r.id} tone={r.key === OWNER_ROLE_KEY ? "blue" : "slate"}>
                              {r.name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={u.status === "active" ? "green" : "red"}>
                            {u.status === "active" ? "Active" : "Disabled"}
                          </Badge>
                          {u.mustChangePassword && <Badge tone="amber">One-time password</Badge>}
                          {u.lockedUntil && <Badge tone="amber">Locked</Badge>}
                        </div>
                      </td>
                      <td className={`py-3 px-2 ${subText} text-xs`}>
                        {fmtWhen(u.lastLoginAt)}
                        {u.activeSessions > 0 && <p>{`${u.activeSessions} active session(s)`}</p>}
                      </td>
                      <td className="py-3 px-5">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button title="Edit" onClick={() => setEditingUser(u)} className={iconBtn(dark)}>
                            <Pencil size={13} />
                          </button>
                          {!self && (
                            <button onClick={() => resetPassword(u)} className={textBtn(dark)}>
                              Reset password
                            </button>
                          )}
                          {!self && u.activeSessions > 0 && (
                            <button onClick={() => signOutEverywhere(u)} className={textBtn(dark)}>
                              Sign out
                            </button>
                          )}
                          {!self && (
                            <button onClick={() => toggleStatus(u)} className={textBtn(dark)}>
                              {u.status === "active" ? "Disable" : "Enable"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="flex items-center justify-between p-5">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldCheck size={16} className={subText} />
              {" Roles"}
            </h3>
            <p className={`text-xs ${subText}`}>
              A role is a set of permissions. Changes apply immediately to everyone who has the role.
            </p>
          </div>
          {manageRoles && (
            <button onClick={() => setEditingRole({})} className={primaryBtn}>
              <Plus size={15} />
              {" New Role"}
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Role</th>
                <th className="font-medium py-3 px-2">Can do</th>
                <th className="font-medium py-3 px-2">Users</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                >
                  <td className="py-3 px-5">
                    <p className="font-medium">{r.name}</p>
                    <p className={`text-xs ${subText}`}>{r.description}</p>
                  </td>
                  <td className={`py-3 px-2 text-xs ${subText}`}>
                    {r.key === OWNER_ROLE_KEY
                      ? "Everything"
                      : PERMISSIONS.filter((p) => r.permissions.includes(p.key))
                          .map((p) => p.label)
                          .join(", ") || "Nothing yet"}
                  </td>
                  <td className="py-3 px-2">{r.userCount}</td>
                  <td className="py-3 px-5">
                    {manageRoles && !r.isSystem && canGrant(auth, r) && (
                      <div className="flex items-center justify-end gap-1.5">
                        <button title="Edit role" onClick={() => setEditingRole(r)} className={iconBtn(dark)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          title={r.userCount ? "Change these users' roles before deleting" : "Delete role"}
                          onClick={() => removeRole(r)}
                          disabled={r.userCount > 0}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <UserModal
          user={editingUser}
          roles={roles}
          auth={auth}
          theme={theme}
          onClose={() => setEditingUser(null)}
          onSaved={async (result, created) => {
            setEditingUser(null);
            await reload();
            if (created)
              setOneTimePassword({ user: created, password: result.temporaryPassword, reason: "new" });
            else setToast("User updated.");
          }}
        />
      )}
      {editingRole && (
        <RoleModal
          role={editingRole}
          auth={auth}
          theme={theme}
          onClose={() => setEditingRole(null)}
          onSaved={async () => {
            setEditingRole(null);
            setToast("Role saved. It applies immediately.");
            await reload();
          }}
        />
      )}
      {oneTimePassword && (
        <OneTimePasswordModal info={oneTimePassword} theme={theme} onClose={() => setOneTimePassword(null)} />
      )}
    </div>
  );
}

function UserModal({ user, roles, auth, theme, onClose, onSaved }) {
  const isNew = !user.id;
  const self = user.id === auth.user.id;
  const [form, setForm] = useState({
    name: user.name || "",
    username: user.username || "",
    email: user.email || "",
    roleIds: (user.roles || []).map((r) => r.id),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleRole = (id) =>
    setForm((f) => ({
      ...f,
      roleIds: f.roleIds.includes(id) ? f.roleIds.filter((x) => x !== id) : [...f.roleIds, id],
    }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        const result = await createUser(form);
        await onSaved(result, { name: form.name, username: form.username });
      } else {
        await updateUser(user.id, { name: form.name, username: form.username, email: form.email });
        const before = (user.roles || [])
          .map((r) => r.id)
          .sort()
          .join();
        if (!self && [...form.roleIds].sort().join() !== before) await setUserRoles(user.id, form.roleIds);
        await onSaved();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? "Add User" : `Edit ${user.name}`}
      onClose={onClose}
      cardBg={theme.cardBg}
      dark={theme.dark}
      wide={true}
    >
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" subText={theme.subText}>
            <input
              required={true}
              value={form.name}
              onChange={set("name")}
              className={inputCls(theme.inputBg)}
            />
          </Field>
          <Field label="Username (used to sign in)" subText={theme.subText}>
            <input
              required={true}
              value={form.username}
              onChange={set("username")}
              className={inputCls(theme.inputBg)}
            />
          </Field>
        </div>
        <Field label="Email (optional)" subText={theme.subText}>
          <input
            type="email"
            value={form.email}
            onChange={set("email")}
            className={inputCls(theme.inputBg)}
          />
        </Field>
        <Field label={self ? "Roles (you can't change your own)" : "Roles"} subText={theme.subText}>
          <div className="space-y-2">
            {roles.map((r) => {
              const allowed = !self && canGrant(auth, r);
              return (
                <label
                  key={r.id}
                  className={`flex items-start gap-2 text-sm ${allowed ? "cursor-pointer" : "opacity-50"}`}
                >
                  <input
                    type="checkbox"
                    checked={form.roleIds.includes(r.id)}
                    disabled={!allowed}
                    onChange={() => toggleRole(r.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span className="font-medium">{r.name}</span>
                    <span className={`block text-xs ${theme.subText}`}>{r.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Field>
        {isNew && (
          <p className={`text-xs ${theme.subText}`}>
            A one-time password is created for the new account. They must choose their own password when they
            first sign in.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`w-full justify-center ${primaryBtn}`}>
          <Save size={15} />
          {busy ? " Saving…" : isNew ? " Create Account" : " Save Changes"}
        </button>
      </form>
    </Modal>
  );
}

function RoleModal({ role, auth, theme, onClose, onSaved }) {
  const isNew = !role.id;
  const [form, setForm] = useState({
    name: role.name || "",
    description: role.description || "",
    permissions: role.permissions || [],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (key) =>
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isNew) await createRole(form);
      else await updateRole(role.id, form);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? "New Role" : `Edit role: ${role.name}`}
      onClose={onClose}
      cardBg={theme.cardBg}
      dark={theme.dark}
      wide={true}
    >
      <form onSubmit={submit} className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role name" subText={theme.subText}>
            <input
              required={true}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputCls(theme.inputBg)}
            />
          </Field>
          <Field label="Description" subText={theme.subText}>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={inputCls(theme.inputBg)}
            />
          </Field>
        </div>
        {groups.map((group) => (
          <div key={group}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${theme.subText}`}>{group}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PERMISSIONS.filter((p) => p.group === group).map((p) => {
                const allowed = auth.can(p.key);
                return (
                  <label
                    key={p.key}
                    className={`flex items-start gap-2 text-sm ${allowed ? "cursor-pointer" : "opacity-50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(p.key)}
                      disabled={!allowed}
                      onChange={() => toggle(p.key)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span className="font-medium">{p.label}</span>
                      <span className={`block text-xs ${theme.subText}`}>{p.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`w-full justify-center ${primaryBtn}`}>
          <Save size={15} />
          {busy ? " Saving…" : " Save Role"}
        </button>
      </form>
    </Modal>
  );
}

function OneTimePasswordModal({ info, theme, onClose }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(info.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Modal
      title={info.reason === "new" ? "Account created" : "Password reset"}
      onClose={onClose}
      cardBg={theme.cardBg}
      dark={theme.dark}
    >
      <div className="p-5 space-y-4">
        <p className="text-sm">
          Give {info.user.name} these sign-in details. The one-time password is shown only now — they&apos;ll
          choose their own password when they first sign in.
        </p>
        <div className={`rounded-xl border p-4 ${theme.dark ? "border-slate-700" : "border-slate-200"}`}>
          <p className={`text-xs ${theme.subText}`}>Username</p>
          <p className="font-medium mb-2">{info.user.username}</p>
          <p className={`text-xs ${theme.subText}`}>One-time password</p>
          <p
            data-testid="one-time-password"
            className="text-lg font-bold tracking-wide"
            style={{ fontFamily: "ui-monospace, Consolas, monospace" }}
          >
            {info.password}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={copy} className={textBtn(theme.dark)}>
            {copied ? "Copied" : "Copy password"}
          </button>
          <button onClick={onClose} className={`flex-1 justify-center ${primaryBtn}`}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
