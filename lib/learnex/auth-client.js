/* =====================================================================
   Browser calls to the authentication / administration API.
   All checks happen on the server; this is just the transport.
===================================================================== */

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error((data && data.error) || `Server responded ${res.status}`);
    error.status = res.status;
    error.code = data && data.code;
    throw error;
  }
  return data;
}

/* ------------------------------------------------------------ session */
/** { user, setupRequired, setupAvailable } — user is null when signed out. */
export const getMe = () => request("GET", "/api/auth/me");
export const login = (username, password) => request("POST", "/api/auth/login", { username, password });
export const logout = () => request("POST", "/api/auth/logout", {});
/** First run only: create the owner account. */
export const registerOwner = (details) => request("POST", "/api/auth/register", details);
export const changePassword = (currentPassword, newPassword) =>
  request("POST", "/api/auth/password", { currentPassword, newPassword });

/* -------------------------------------------------------------- users */
export const listUsers = () => request("GET", "/api/user");
export const createUser = (details) => request("POST", "/api/user", details);
export const updateUser = (id, changes) => request("PATCH", `/api/user/${id}`, changes);
export const setUserRoles = (id, roleIds) => request("PUT", `/api/user/${id}/role`, { roleIds });
export const resetUserPassword = (id) => request("POST", `/api/user/${id}/password`, {});
export const signOutUser = (id) => request("DELETE", `/api/user/${id}/sessions`);

/* -------------------------------------------------------------- roles */
export const listRoles = () => request("GET", "/api/roles");
export const createRole = (role) => request("POST", "/api/roles", role);
export const updateRole = (id, role) => request("PATCH", `/api/roles/${id}`, role);
export const deleteRole = (id) => request("DELETE", `/api/roles/${id}`);

/* ------------------------------------------------------- activity log */
export const listAudit = (params = {}) =>
  request("GET", "/api/audit?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString());
