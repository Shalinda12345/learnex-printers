import { useState, useEffect } from "react";
import { request } from "@/lib/learnex/auth-client";
import { BACKUP_MODULES, parseBackupFile } from "@/lib/learnex/backup";
import { mergeChanges, mergeRecord } from "@/lib/learnex/merge";

/* =====================================================================
   PERSISTENCE — MySQL via the app's API (/api/learnex/*)

   Every module (products, sales, purchases, ledger, ...) is still a plain
   value in React state. The database is the source of truth:
   - on start-up the app loads every saved module from /api/learnex/data;
   - whenever a module's value changes, only the records that changed are
     sent to /api/learnex/sync. Changes made together (e.g. a POS sale
     touching orders, stock, customers and the ledger) go in one request,
     which the server saves in one transaction — all or nothing.
   A module that has never been saved starts from its demo data and is
   saved straight away.

   Every request is made as the signed-in user. The server only returns
   the modules the user's roles allow, and says which of them they may
   change ("write") — the others are never saved from this browser.
===================================================================== */
const API = "/api/learnex";
const SAVE_DELAY_MS = 400;

// Legacy (pre-database) storage, only read by the one-time import.
const STORAGE_PREFIX = "learnex_erp_v1_";
const DATA_FILENAME = "learnex-data.json";
const LEGACY_META_KEYS = [STORAGE_PREFIX + "__unsaved__", STORAGE_PREFIX + "__lastAutoBackup__"];

let loadedStores = {}; // module key -> value as loaded from the database
let access = {}; // module key -> "read" | "write" (missing = no access)
const initialValues = {}; // module key -> the value the app started with
const synced = {}; // module key -> last value the database confirmed
const pending = new Map(); // module key -> newest value waiting to be saved
let saveTimer = null;
let inFlight = false;
let retryDelay = 1000;
let resetting = false;
const versions = {}; // module key -> { record id -> version it had when last loaded / saved }
let conflictShown = false;
let saveStatus = "saved"; // "saving" | "saved" | "error" | "denied" | "conflict"
let saveError = "";
let reauth = null; // { token, expiresAt }: proof that the password was typed a moment ago (see below)
let mergedStarts = {}; // module key -> my unsaved changes laid over the freshly loaded data (see "conflicts")
let mergeNotice = "";

export function getSaveStatus() {
  return { status: saveStatus, error: saveError };
}

// Called when the server says the session has ended (signed out elsewhere, expired, disabled).
let onSignedOut = () => {};
export function setSignedOutHandler(fn) {
  onSignedOut = fn;
}

/* ------------------------------------------- password re-confirmation
   Restoring a backup, clearing a module and the factory reset need the password typed again
   (POST /api/auth/reauth). The proof it returns is sent along with the saves and the reset
   for the next five minutes. */
export function setReauth(token, expiresAt) {
  reauth = token ? { token, expiresAt } : null;
  // changes held back for want of a confirmation can go now
  if (token && pending.size && saveStatus === "denied") {
    setStatus("saving");
    scheduleSave(0);
  }
}
export const hasFreshReauth = () => !!reauth && reauth.expiresAt > Date.now() + 5000;

async function api(path, body, options = {}) {
  if ((path === "/sync" || path === "/reset") && hasFreshReauth())
    options = { ...options, headers: { ...options.headers, "x-reauth": reauth.token } };
  try {
    return await request(body === undefined ? "GET" : "POST", API + path, body, options);
  } catch (e) {
    if (e.status === 401) onSignedOut();
    throw e;
  }
}

const canRead = (key) => !!access[key];
export const canWrite = (key) => access[key] === "write";

/** Loads every module the user may see. Returns { initialized } — false until data was imported or demo data chosen. */
export async function loadFromDatabase() {
  const data = await api("/data");
  loadedStores = data.stores || {};
  access = data.access || {};
  for (const k of Object.keys(synced)) delete synced[k];
  Object.assign(synced, loadedStores);
  for (const k of Object.keys(versions)) delete versions[k];
  Object.assign(versions, data.versions || {});
  conflictShown = false;
  for (const k of Object.keys(initialValues)) delete initialValues[k];
  pending.clear();
  setStatus("saved");
  applyKeptChanges();
  return { initialized: !!data.initialized };
}

/* ---------------------------------------------------------------- saving */

const sameJSON = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// What changed in one module between the last saved value and `next`.
function diffModule(key, prev, next) {
  if (key === "settings" || key === "users") {
    return prev !== undefined && sameJSON(prev, next) ? null : { store: key, value: next };
  }
  const order = (next || []).map((r) => r.id);
  if (prev === undefined) return { store: key, replace: true, upserts: next || [], order };
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextIds = new Set(order);
  const upserts = (next || []).filter((r) => {
    const old = prevById.get(r.id);
    return old !== r && !sameJSON(old, r);
  });
  // Optimistic locking: the server refuses to overwrite a record somebody else changed
  // since we loaded it (`base`), or to "create" a record whose id somebody else just used.
  const base = {};
  const creates = [];
  for (const r of upserts) {
    if (!prevById.has(r.id)) creates.push(r.id);
    else if (versions[key] && versions[key][String(r.id)] !== undefined) base[String(r.id)] = versions[key][String(r.id)];
  }
  const deletes = prev.map((r) => r.id).filter((id) => !nextIds.has(id));
  const orderChanged = order.length !== prev.length || order.some((id, i) => id !== prev[i].id);
  if (!upserts.length && !deletes.length && !orderChanged) return null;
  return { store: key, upserts, deletes, order, ...(upserts.length ? { base, creates } : {}) };
}

function setStatus(status, error = "") {
  saveStatus = status;
  saveError = error;
}

/* --------------------------------------------------------- conflicts
   When someone else changed the same records, the server refuses the save (nothing is written).
   Dropping it would lose real work (a sale rung up a moment after another till sold the same
   product), so the changes that were about to be saved are kept in this tab's session storage;
   after the reload they are merged into the fresh data (lib/learnex/merge.js) and saved from
   there: stock goes 10 → 9 here and 10 → 8 there, and the result is 7. */
const KEPT_KEY = "learnex.keptChanges";
const KEPT_MAX_AGE_MS = 10 * 60 * 1000;

// What the app was about to save, as { moduleKey: { upserts: [{ base, mine, index }], deletes } } for lists
// and { moduleKey: value } for settings / users. Returns false when it could not be kept.
function keepChanges(batch) {
  try {
    const latest = new Map(batch);
    for (const [k, v] of pending) latest.set(k, v);
    const ops = {};
    const values = {};
    for (const [key, next] of latest) {
      const prev = synced[key];
      if (key === "settings" && !Array.isArray(next)) {
        // kept with what it was based on, so it can be merged with the fresh copy (not replace it)
        if (!sameJSON(prev, next)) values[key] = { base: prev ?? null, mine: next };
        continue;
      }
      // users (a list of people) is merged record by record, like the other lists
      if (!Array.isArray(prev) || !Array.isArray(next)) continue;
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const nextIds = new Set(next.map((r) => r.id));
      const upserts = [];
      next.forEach((r, index) => {
        const old = prevById.get(r.id);
        if (old !== r && !sameJSON(old, r)) upserts.push({ base: old ?? null, mine: r, index });
      });
      const deletes = prev.map((r) => r.id).filter((id) => !nextIds.has(id));
      if (upserts.length || deletes.length) ops[key] = { upserts, deletes };
    }
    if (!Object.keys(ops).length && !Object.keys(values).length) return false;
    sessionStorage.setItem(KEPT_KEY, JSON.stringify({ at: Date.now(), ops, values }));
    return true;
  } catch {
    return false; // storage full (big photos) or blocked
  }
}

// After a reload: lays the kept changes over the data just loaded. Anything that cannot be
// merged safely is dropped (and said so) rather than guessed.
function applyKeptChanges() {
  mergedStarts = {};
  let kept = null;
  try {
    kept = JSON.parse(sessionStorage.getItem(KEPT_KEY) || "null");
    sessionStorage.removeItem(KEPT_KEY);
  } catch {}
  if (!kept || Date.now() - kept.at > KEPT_MAX_AGE_MS) return;
  const keys = Object.keys(kept.ops);
  const usable = keys.every((k) => Array.isArray(loadedStores[k]) && canWrite(k)) &&
    Object.keys(kept.values).every((k) => canWrite(k) && loadedStores[k] && typeof loadedStores[k] === "object" && kept.values[k].base);
  const loaded = {};
  for (const k of keys) loaded[k] = loadedStores[k];
  const result = usable ? mergeChanges(loaded, kept.ops) : { unresolved: ["not allowed"], merged: {}, conflicts: 0 };
  if (usable && !result.unresolved.length) {
    // settings: three-way merge against the freshly loaded copy, never a whole-value overwrite
    for (const [k, { base, mine }] of Object.entries(kept.values)) {
      const r = mergeRecord(base, mine, loadedStores[k]);
      result.merged[k] = r.record;
      result.conflicts += r.conflicts.length;
    }
  }
  if (result.unresolved.length) {
    mergeNotice =
      "Someone else changed the same records, and your last changes could not be added to theirs automatically. Please check your last entries and enter them again if they are missing.";
    return;
  }
  Object.assign(mergedStarts, result.merged);
  mergeNotice = result.conflicts
    ? `Your changes were added on top of someone else's. ${result.conflicts} value(s) were changed by both of you — yours were kept; please check them.`
    : "Someone else changed the same records. Your changes were kept and added on top of theirs.";
}

/** A sentence for the person after the page was reloaded because of a conflict (or ""). */
export const peekMergeNotice = () => mergeNotice;
export function clearMergeNotice() {
  mergeNotice = "";
}

// The badge in the top bar also says so, but a refused save must not go unnoticed.
function announceConflict(message, kept) {
  if (conflictShown || typeof window === "undefined") return;
  conflictShown = true;
  setTimeout(() => {
    const ask = kept
      ? message.replace(/Reload the page.*$/s, "") +
        "\nYour changes have been kept: after reloading they are added on top of the latest data."
      : message;
    if (window.confirm(ask + "\n\nReload now?")) window.location.reload();
  }, 0);
}

function scheduleSave(delay = SAVE_DELAY_MS) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, delay);
}

async function flushSaves() {
  if (inFlight) return; // the running save re-schedules itself when done
  if (!pending.size) return;
  const batch = [...pending.entries()];
  pending.clear();
  const changes = batch.map(([k, v]) => diffModule(k, synced[k], v)).filter(Boolean);
  if (!changes.length) {
    batch.forEach(([k, v]) => (synced[k] = v));
    if (saveStatus !== "error") setStatus("saved");
    return;
  }
  inFlight = true;
  try {
    const saved = await api("/sync", { changes });
    batch.forEach(([k, v]) => (synced[k] = v));
    // the new version of every record just written
    for (const [k, byId] of Object.entries((saved && saved.versions) || {})) Object.assign((versions[k] ||= {}), byId);
    retryDelay = 1000;
    setStatus(pending.size ? "saving" : "saved");
  } catch (e) {
    console.error("Could not save to the database", e);
    if (e.status === 409 && e.code === "conflict") {
      // Someone else changed (or created) the same record. Saving again would overwrite their work, so
      // nothing more is saved from this page until it is reloaded. Nothing in the batch was written.
      setStatus("conflict", e.message);
      announceConflict(e.message, keepChanges(batch));
      return;
    }
    if (e.status === 403 && e.code === "reauth_required") {
      // The password has to be typed again first (restore, clear module). Nothing was written, so
      // the batch is kept and sent as soon as a fresh confirmation arrives (setReauth) or the
      // next change is made; it is not dropped.
      batch.forEach(([k, v]) => {
        if (!pending.has(k)) pending.set(k, v);
      });
      setStatus("denied", e.message);
      return;
    }
    if (e.status === 403 || e.status === 401) {
      // Refused for this user: retrying can't succeed. Nothing in the batch was saved.
      setStatus("denied", e.message);
      return;
    }
    // Put the batch back (unless newer values are already waiting) and retry.
    batch.forEach(([k, v]) => {
      if (!pending.has(k)) pending.set(k, v);
    });
    setStatus("error", e.message);
    scheduleSave(retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  } finally {
    inFlight = false;
    if (pending.size && !["error", "denied", "conflict"].includes(saveStatus)) scheduleSave(0);
  }
}

function queueSave(key, value) {
  if (resetting) return;
  if (synced[key] === value && !pending.has(key)) return; // unchanged since loaded/saved
  if (!canWrite(key)) {
    // Modules the user can only view (or not see) are never saved from here.
    if (value !== initialValues[key])
      setStatus("denied", "You don't have permission to change this. It was not saved.");
    return;
  }
  pending.set(key, value);
  if (!["error", "denied", "conflict"].includes(saveStatus)) setStatus("saving");
  scheduleSave();
}

function hasUnsavedChanges() {
  return pending.size > 0 || inFlight;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!hasUnsavedChanges() || resetting) return;
    e.preventDefault();
    e.returnValue = "Some changes haven't finished saving to the database yet.";
    return e.returnValue;
  });
  // Last chance for changes made in the final moments before the tab closes.
  window.addEventListener("pagehide", () => {
    if (inFlight || !pending.size || resetting) return;
    const changes = [...pending.entries()].map(([k, v]) => diffModule(k, synced[k], v)).filter(Boolean);
    if (changes.length) api("/sync", { changes }, { keepalive: true }).catch(() => {});
  });
}

// Like useState, but the value is loaded from and saved to the database.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    // Saved value; demo data for a module never saved; nothing for modules this user can't see.
    const start =
      key in mergedStarts
        ? mergedStarts[key]
        : key in loadedStores
        ? loadedStores[key]
        : canRead(key)
          ? initial
          : Array.isArray(initial)
            ? []
            : initial;
    initialValues[key] = start;
    return start;
  });
  useEffect(() => {
    queueSave(key, value);
  }, [key, value]);
  return [value, setValue];
}

export async function resetAllData() {
  resetting = true;
  clearTimeout(saveTimer);
  pending.clear();
  try {
    await api("/reset", {});
    setReauth(null);
  } catch (e) {
    resetting = false;
    window.alert("Factory reset failed: " + e.message);
    return;
  }
  window.location.reload();
}

/* ------------------------------------------------------ one-time import */

// Keeps only known module keys from a { moduleKey: value } object.
function pickModules(source) {
  const stores = {};
  for (const m of BACKUP_MODULES) if (source && source[m.key] != null) stores[m.key] = source[m.key];
  return stores;
}

/** Data saved by the pre-database version of the app in this browser (same address only). */
export function readBrowserStorageStores() {
  const raw = {};
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX) && !LEGACY_META_KEYS.includes(k))
      .forEach((k) => {
        try {
          raw[k.slice(STORAGE_PREFIX.length)] = JSON.parse(localStorage.getItem(k));
        } catch {}
      });
  } catch {}
  return pickModules(raw);
}

/** Reads learnex-data.json from a data folder the user picks. */
export async function readFolderStores() {
  const handle = await window.showDirectoryPicker({ mode: "read" });
  let text;
  try {
    const file = await (await handle.getFileHandle(DATA_FILENAME)).getFile();
    text = await file.text();
  } catch {
    throw new Error(`No ${DATA_FILENAME} found in "${handle.name}".`);
  }
  const data = text ? JSON.parse(text) || {} : {};
  const raw = {};
  for (const k of Object.keys(data))
    if (k.startsWith(STORAGE_PREFIX)) raw[k.slice(STORAGE_PREFIX.length)] = data[k];
  return { name: handle.name, stores: pickModules(raw) };
}

/** Reads a backup file downloaded from the app (.html, or a .json export). */
export async function readBackupFileStores(file) {
  const payload = parseBackupFile(await file.text());
  return pickModules(payload.data);
}

/** Saves imported modules to the (empty) database. Pass {} to start from demo data. */
export async function importStores(stores) {
  await api("/import", { stores });
}
