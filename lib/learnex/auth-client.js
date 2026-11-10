/* =====================================================================
   Browser calls to the authentication / administration API.
   All checks happen on the server; this is just the transport.
===================================================================== */

/** Sends a JSON request; a failed response throws an Error carrying the server's message, status and code. */
export async function request(method, url, body, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const headers = { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extraHeaders };
  const res = await fetch(url, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    ...rest,
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
/** { mfaRequired: true, ticket } when the account uses two-step sign-in (finish with loginWithCode), otherwise signed in. */
export const login = (username, password) => request("POST", "/api/auth/login", { username, password });
export const loginWithCode = (ticket, code) => request("POST", "/api/auth/mfa/verify", { ticket, code });

/* ------------------------------------------- password re-confirmation, two-step */
/** Proves the password (and code) was typed just now; answers { token, expiresAt } for destructive requests. */
export const reauthenticate = (password, code) => request("POST", "/api/auth/reauth", { password, code });
export const getMfa = () => request("GET", "/api/auth/mfa");
export const startMfaSetup = (password) => request("POST", "/api/auth/mfa/setup", { password });
export const finishMfaSetup = (code) => request("POST", "/api/auth/mfa/enable", { code });
export const disableMfa = (password, code) => request("POST", "/api/auth/mfa/disable", { password, code });
export const resetUserMfa = (id) => request("DELETE", `/api/user/${id}/mfa`);
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
