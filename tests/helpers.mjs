// Shared helpers for the database test suite (run via `npm run test:db`).
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { chromium } from "playwright-core";

export const BASE = process.env.TEST_BASE_URL;
export const DEAD_DB_BASE = process.env.TEST_DEAD_DB_BASE_URL;
export const DATABASE_URL = process.env.TEST_DATABASE_URL;
export const SETUP_CODE = process.env.TEST_SETUP_CODE;
if (!BASE || !DATABASE_URL || !SETUP_CODE) throw new Error("Run these tests with `npm run test:db`.");

// The same connection settings as the app's server (lib/server/db.ts): UTC,
// strict mode, DATE as plain "YYYY-MM-DD" text, BOOLEAN as true/false, JSON
// columns as text.
export const pool = mysql.createPool({
  uri: DATABASE_URL,
  connectionLimit: 3,
  timezone: "Z",
  dateStrings: ["DATE"],
  jsonStrings: true,
  supportBigNumbers: true,
  typeCast: (field, next) => {
    if (field.type !== "TINY" || field.length !== 1) return next();
    const v = next();
    return v === null ? null : v === 1;
  },
});
pool.pool.on("connection", (conn) =>
  conn.query(
    "SET SESSION time_zone = '+00:00', sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    (err) => err && console.error(err),
  ),
);
export const rows = async (sql, params) => (await pool.query(sql, params))[0];
export const one = async (sql, params) => (await rows(sql, params))[0];
export const count = async (table) => (await one(`SELECT count(*) AS n FROM ${table}`)).n;

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
  // TRUNCATE also restarts the ids, but MySQL only allows it on tables other
  // tables point to while foreign key checks are off (for this connection).
  const conn = await pool.getConnection();
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of [
      "auth_sessions",
      "auth_user_roles",
      "auth_role_permissions",
      "auth_roles",
      "audit_log",
      "auth_users",
    ]) {
      await conn.query(`TRUNCATE TABLE ${table}`);
    }
  } finally {
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    conn.release();
  }
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
  return Object.fromEntries(
    (await rows("SELECT `key`, id FROM auth_roles")).map((r) => [r.key, Number(r.id)]),
  );
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

/* ------------------------------------------------------ feature tests */

/** Today's date as the app stamps it (the browser runs on this machine). */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A small, fully known business: every module is present, so no demo data is
 * mixed in and every figure a test checks can be worked out by hand.
 *   Alpha Printer  price 1000, cost 600, stock 10 (min 2)   → in stock
 *   Beta Toner     price 250,  cost 100, stock 3  (min 5)   → low stock
 *   Gamma Paper    price 50,   cost 20,  stock 0  (min 10)  → out of stock
 *   Cash Account opening balance 5,000; tax rate 10 %.
 */
export function shopFixture() {
  return {
    products: [
      {
        id: 101,
        name: "Alpha Printer",
        sku: "ALP-1",
        category: "Printers",
        price: 1000,
        cost: 600,
        stock: 10,
        min: 2,
        unit: "pc",
      },
      {
        id: 102,
        name: "Beta Toner",
        sku: "BET-2",
        category: "Ink & Toner",
        price: 250,
        cost: 100,
        stock: 3,
        min: 5,
        unit: "pc",
      },
      {
        id: 103,
        name: "Gamma Paper",
        sku: "GAM-3",
        category: "Paper & Stationery",
        price: 50,
        cost: 20,
        stock: 0,
        min: 10,
        unit: "ream",
      },
    ],
    customers: [
      {
        id: 201,
        name: "Acme Traders",
        contact: "Ann",
        phone: "011",
        email: "acme@x.lk",
        tier: "Wholesale",
        orders: 0,
        spent: 0,
        outstanding: 0,
      },
      {
        id: 202,
        name: "Bob Retail",
        contact: "Bob",
        phone: "012",
        email: "bob@x.lk",
        tier: "Retail",
        orders: 2,
        spent: 500,
        outstanding: 0,
      },
    ],
    suppliers: [
      {
        id: 301,
        name: "Paper Mills Ltd",
        contact: "Pam",
        phone: "021",
        email: "pm@x.lk",
        category: "Paper",
        status: "Active",
        purchased: 0,
        lastOrder: null,
      },
      {
        id: 302,
        name: "Old Supplies",
        contact: "Ola",
        phone: "022",
        email: "os@x.lk",
        category: "Misc",
        status: "On Hold",
        purchased: 1200,
        lastOrder: "2026-01-15",
      },
    ],
    rawMaterials: [
      {
        id: 401,
        name: "Resin",
        category: "Plastics",
        supplier: "Paper Mills Ltd",
        unit: "kg",
        purchaseQty: 10,
        availableQty: 10,
        costPrice: 100,
        lastPurchaseCost: 100,
        purchaseDate: "2026-01-01",
        batchNumber: "B1",
        notes: "",
      },
      {
        id: 402,
        name: "Ink Base",
        category: "Chemicals",
        supplier: "Paper Mills Ltd",
        unit: "L",
        purchaseQty: 5,
        availableQty: 1,
        costPrice: 40,
        purchaseDate: "2026-01-01",
        batchNumber: "",
        notes: "",
      },
    ],
    cashAccounts: [
      {
        id: "CASH-MAIN",
        name: "Cash Account",
        type: "Cash",
        opening: 5000,
        purpose: "general",
        system: true,
        notes: "",
      },
      {
        id: "BANK-MAIN",
        name: "Bank Account",
        type: "Bank",
        opening: 0,
        purpose: "general",
        system: true,
        notes: "",
      },
    ],
    ledger: [],
    salesOrders: [],
    purchaseOrders: [],
    rawMaterialUsage: [],
    deliveryRuns: [],
    settings: {
      businessName: "Test Shop",
      taxRate: 10,
      openingCapital: 0,
      currency: "LKR (Rs.)",
      notifLowStock: true,
      notifOverdue: true,
      notifDaily: false,
    },
    users: [],
  };
}

/** Empty database, then `stores` imported as the business's data. */
export async function loadStores(stores) {
  await wipeDatabase();
  const r = await api("/import", { stores });
  if (r.status !== 200) throw new Error("import failed: " + JSON.stringify(r.body));
}

/** Every module as the app loads it from the database. */
export async function stores() {
  return (await api("/data")).body.stores;
}

/** A signed-in page with the app open (optionally on one screen of the menu). */
export async function openApp(browser, screen, options) {
  const page = await newPage(browser, options);
  await page.goto("/");
  await page.locator("aside nav").waitFor();
  if (screen) await nav(page, screen);
  return page;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The input, select or textarea of the form field labelled exactly `label`. */
export function field(scope, label) {
  return scope
    .locator("label")
    .filter({ hasText: new RegExp(`^\\s*${escapeRe(label)}\\s*$`) })
    .locator("xpath=..")
    .locator("input, select, textarea")
    .first();
}

/** The open dialog (the topmost one). */
export const modal = (page) => page.locator("div.fixed.inset-0").last();

/** The toast message shown at the bottom right. */
export const toast = (page) => page.locator("div.fixed.bottom-6 p").first();

/** The table row of a <main> table that contains `text`. */
export const row = (page, text) => page.locator("main tr", { hasText: text }).first();

/** Clicks something that downloads a file; returns its name and text. */
export async function download(page, click) {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: d.suggestedFilename(), text: readFileSync(await d.path(), "utf8") };
}

/** Parses the app's CSV exports (every cell is quoted). */
export function parseCsv(text) {
  return text
    .split("\n")
    .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"')));
}

/** Records the message of every alert/confirm the page shows (they are accepted). */
export function captureDialogs(page) {
  const messages = [];
  page.on("dialog", (d) => messages.push(d.message()));
  return messages;
}

/** A 1×1 PNG, for attachment uploads. */
export const PNG = {
  name: "slip.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

/** The value shown on a summary card ("Total Customers" → "2"), within `scope` (a page or a part of it). */
export function card(scope, label) {
  return scope
    .locator("p")
    .filter({ hasText: new RegExp(`^${escapeRe(label)}$`) })
    .first()
    .locator("xpath=ancestor::div[contains(concat(' ', @class, ' '), ' rounded-2xl ')][1]")
    .locator("p")
    .nth(1);
}
