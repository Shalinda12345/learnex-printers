// Shared helpers for the database test suite (run via `npm run test:db`).
import { readFileSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

export const BASE = process.env.TEST_BASE_URL;
export const DEAD_DB_BASE = process.env.TEST_DEAD_DB_BASE_URL;
export const DATABASE_URL = process.env.TEST_DATABASE_URL;
export const SETUP_CODE = process.env.TEST_SETUP_CODE;
if (!BASE || !DATABASE_URL || !SETUP_CODE) throw new Error("Run these tests with `npm run test:db`.");

// DATE as plain "YYYY-MM-DD" text, the same as the app's server does.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
export const rows = async (sql, params) => (await pool.query(sql, params)).rows;
export const one = async (sql, params) => (await rows(sql, params))[0];
export const count = async (table) => (await one(`SELECT count(*)::int AS n FROM ${table}`)).n;

/* ------------------------------------------------------------ sessions */

/** An HTTP client with its own session cookie — one per simulated person / device. */
export class Client {
  constructor(base = BASE) {
    this.base = base;
    this.cookie = null; // "name=value"
  }
  async call(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (name.includes("learnex_session")) this.cookie = value ? `${name}=${value}` : null;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json, headers: res.headers, setCookie };
  }
  get(path, headers) {
    return this.call("GET", path, undefined, headers);
  }
  post(path, body = {}, headers) {
    return this.call("POST", path, body, headers);
  }
  patch(path, body, headers) {
    return this.call("PATCH", path, body, headers);
  }
  put(path, body, headers) {
    return this.call("PUT", path, body, headers);
  }
  delete(path, headers) {
    return this.call("DELETE", path, undefined, headers);
  }
  async login(username, password) {
    const r = await this.post("/api/auth/login", { username, password });
    if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return this;
  }
}

export const OWNER = {
  name: "Test Owner",
  username: "owner",
  email: "owner@learnex.test",
  password: "Owner-pass-123",
};
export const STAFF_PASSWORD = "Staff-pass-123";

let defaultClient = null;

/** Deletes every account, role, session and log entry (a brand-new install). */
export async function resetAuth() {
  await pool.query(
    `TRUNCATE auth_sessions, auth_user_roles, auth_role_permissions, auth_roles, audit_log, auth_users RESTART IDENTITY CASCADE`,
  );
}

/** Fresh install + owner account; later `api()` calls are made as this owner. */
export async function asOwner() {
  await resetAuth();
  const owner = new Client();
  const r = await owner.post("/api/auth/register", { setupCode: SETUP_CODE, ...OWNER });
  if (r.status !== 200) throw new Error("owner setup failed: " + JSON.stringify(r.body));
  defaultClient = owner;
  return owner;
}

/** The ids of the roles, by key ("sales", "inventory", ...). */
export async function roleIds() {
  return Object.fromEntries((await rows(`SELECT key, id FROM auth_roles`)).map((r) => [r.key, Number(r.id)]));
}

/**
 * Creates a staff account through the API (as `admin`), signs it in with the
 * one-time password and sets its own password. Returns a signed-in client.
 */
export async function createStaff(admin, { username, name = username, roles }) {
  const ids = await roleIds();
  const r = await admin.post("/api/user", { username, name, roleIds: roles.map((k) => ids[k]) });
  if (r.status !== 200) throw new Error(`create ${username} failed: ${JSON.stringify(r.body)}`);
  const staff = await new Client().login(username, r.body.temporaryPassword);
  const c = await staff.post("/api/auth/password", {
    currentPassword: r.body.temporaryPassword,
    newPassword: STAFF_PASSWORD,
  });
  if (c.status !== 200) throw new Error(`password change for ${username} failed: ${JSON.stringify(c.body)}`);
  staff.username = username;
  staff.userId = r.body.id;
  return staff;
}

/** The app's data API (/api/learnex/*) as the owner (or anonymously on another server). */
export async function api(path, body, base = BASE) {
  const client = base === BASE && defaultClient ? defaultClient : new Client(base);
  const r =
    body === undefined
      ? await client.get("/api/learnex" + path)
      : await client.post("/api/learnex" + path, body);
  return { status: r.status, body: r.body };
}

/** Empty business database, as on first install (setup screen will show). Accounts are kept. */
export async function wipeDatabase() {
  const r = await api("/reset", {});
  if (r.status !== 200) throw new Error("reset failed: " + JSON.stringify(r.body));
  await pool.query("DELETE FROM app_meta");
}

/** The app treats a null field and a missing field alike, so compare without them. */
export function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== null && v[k] !== undefined) o[k] = norm(v[k]);
    return o;
  }
  return v;
}

export const FIXTURE_BACKUP = new URL("./fixtures/original-app-backup.html", import.meta.url);
export function backupData(text = readFileSync(FIXTURE_BACKUP, "utf8")) {
  const m = text.match(/<script type="application\/json" id="learnex-backup-data">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]).data;
}

export const log = (...args) => console.log("      ·", ...args);

/* ------------------------------------------------------------- browser */

export async function launchBrowser() {
  return chromium.launch({ channel: "chrome", headless: true });
}

/**
 * New page that records console errors/warnings and page errors. Signed in as
 * `client` (default: the owner from asOwner()); pass `client: null` for a
 * signed-out browser.
 */
export async function newPage(browser, { base = BASE, client = base === BASE ? defaultClient : null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    baseURL: base,
  });
  if (client?.cookie) {
    const eq = client.cookie.indexOf("=");
    await context.addCookies([
      { name: client.cookie.slice(0, eq), value: client.cookie.slice(eq + 1), url: base },
    ]);
  }
  const page = await context.newPage();
  page.consoleProblems = [];
  page.on("pageerror", (e) => page.consoleProblems.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      page.consoleProblems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on("dialog", (d) => (d.type() === "beforeunload" ? undefined : d.accept()));
  return page;
}

/** Returns and clears the console problems recorded so far. */
export function takeConsoleProblems(page) {
  return page.consoleProblems.splice(0);
}

export const nav = (page, label) => page.locator("aside nav button", { hasText: label }).first().click();
export const badge = (page) =>
  page
    .locator("header [title]")
    .filter({ hasText: /^(Saved|Saving…|Not saved|Not allowed)$/ })
    .first();

/** Waits until the top-bar badge says "Saved" (all changes written to the database). */
export async function waitSaved(page, timeout = 15000) {
  await page.waitForTimeout(450); // past the save debounce
  await page.waitForFunction(
    () => [...document.querySelectorAll("header [title]")].some((el) => el.textContent.trim() === "Saved"),
    null,
    { timeout },
  );
}

/** Records the JSON bodies of every /api/learnex/sync request the page makes. */
export function captureSyncRequests(page) {
  const bodies = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/learnex/sync")) bodies.push(req.postDataJSON());
  });
  return bodies;
}
