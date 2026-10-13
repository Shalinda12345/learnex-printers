import { useState, useEffect } from "react";
import { BACKUP_MODULES, parseBackupFile } from "@/lib/learnex/backup";

/* =====================================================================
   PERSISTENCE — PostgreSQL via the app's API (/api/learnex/*)

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
export const STORAGE_PREFIX = "learnex_erp_v1_";
export const DATA_FILENAME = "learnex-data.json";
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
let saveStatus = "saved"; // "saving" | "saved" | "error" | "denied"
let saveError = "";

export function getSaveStatus() {
  return { status: saveStatus, error: saveError };
}

// Called when the server says the session has ended (signed out elsewhere, expired, disabled).
let onSignedOut = () => {};
export function setSignedOutHandler(fn) {
  onSignedOut = fn;
}

async function api(path, body, options = {}) {
  const res = await fetch(API + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const error = new Error((data && data.error) || `Server responded ${res.status}`);
    error.status = res.status;
    error.code = data && data.code;
    if (res.status === 401) onSignedOut();
    throw error;
  }
  return data;
}

export const canRead = (key) => !!access[key];
export const canWrite = (key) => access[key] === "write";

/** Loads every module the user may see. Returns { initialized } — false until data was imported or demo data chosen. */
export async function loadFromDatabase() {
  const data = await api("/data");
  loadedStores = data.stores || {};
  access = data.access || {};
  for (const k of Object.keys(synced)) delete synced[k];
  Object.assign(synced, loadedStores);
  for (const k of Object.keys(initialValues)) delete initialValues[k];
  pending.clear();
  setStatus("saved");
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
  const deletes = prev.map((r) => r.id).filter((id) => !nextIds.has(id));
  const orderChanged = order.length !== prev.length || order.some((id, i) => id !== prev[i].id);
  if (!upserts.length && !deletes.length && !orderChanged) return null;
  return { store: key, upserts, deletes, order };
}

function setStatus(status, error = "") {
  saveStatus = status;
  saveError = error;
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
    await api("/sync", { changes });
    batch.forEach(([k, v]) => (synced[k] = v));
    retryDelay = 1000;
    setStatus(pending.size ? "saving" : "saved");
  } catch (e) {
    console.error("Could not save to the database", e);
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
    if (pending.size && saveStatus !== "error" && saveStatus !== "denied") scheduleSave(0);
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
  if (saveStatus !== "error" && saveStatus !== "denied") setStatus("saving");
  scheduleSave();
}

export function hasUnsavedChanges() {
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
      key in loadedStores
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

// Human-facing reference numbers (SO-1042, INV-2461, PO-4000, TXN-8821,
// DR-1000, USE-1000): the highest number in the given list, plus one.
export function nextSeq(items, field, prefix, start = 1000) {
  const nums = items
    .map((i) => parseInt(String(i[field] || "").replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const localMax = nums.length ? Math.max(...nums) : start;
  return Promise.resolve(prefix + (localMax + 1));
}

export async function resetAllData() {
  resetting = true;
  clearTimeout(saveTimer);
  pending.clear();
  try {
    await api("/reset", {});
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
