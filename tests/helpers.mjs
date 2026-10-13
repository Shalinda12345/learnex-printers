// Shared helpers for the database test suite (run via `npm run test:db`).
import { readFileSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

export const BASE = process.env.TEST_BASE_URL;
export const DEAD_DB_BASE = process.env.TEST_DEAD_DB_BASE_URL;
export const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!BASE || !DATABASE_URL) throw new Error("Run these tests with `npm run test:db`.");

// DATE as plain "YYYY-MM-DD" text, the same as the app's server does.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
export const rows = async (sql, params) => (await pool.query(sql, params)).rows;
export const one = async (sql, params) => (await rows(sql, params))[0];
export const count = async (table) => (await one(`SELECT count(*)::int AS n FROM ${table}`)).n;

export async function api(path, body, base = BASE) {
  const init =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: typeof body === "string" ? body : JSON.stringify(body),
        };
  const res = await fetch(base + "/api/learnex" + path, init);
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

/** Empty database, as on first install (setup screen will show). */
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

/** New page that records console errors/warnings and page errors. */
export async function newPage(browser, { base = BASE } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    baseURL: base,
  });
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
    .filter({ hasText: /Saved|Saving|Not saved/ })
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
