import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, withTransaction, type Db } from "@/lib/server/db";
import {
  STORES,
  STORE_BY_KEY,
  type ChildList,
  type Column,
  type ColumnType,
  type Field,
  type ListStore,
  type ReplaceStore,
  type SingleStore,
} from "@/lib/server/learnex/stores";
import { BadRequestError, ConflictError, ForbiddenError } from "@/lib/server/errors";
import { audit, type Actor } from "@/lib/server/audit";
import { STORE_LABELS, type StoreAccess, type StoreKey } from "@/lib/auth/permissions";
import { sanityProblem } from "@/lib/server/learnex/sanity";

type Rec = Record<string, unknown>;
export type AccessMap = Partial<Record<StoreKey, StoreAccess>>;

/** What one saved change did, for the activity log. */
interface ChangeSummary {
  store: string;
  created?: number;
  updated?: number;
  deleted?: number;
  replaced?: boolean;
  ids?: unknown[];
  /** old and new value of each changed field (first records only) */
  edits?: Record<string, unknown>[];
  /** what deleted records held (first records only) */
  removed?: Record<string, unknown>[];
}

export interface StoreChange {
  store: string;
  /** list modules: records added or changed since the last save */
  upserts?: unknown[];
  /** list modules: ids of records removed since the last save */
  deletes?: unknown[];
  /** list modules: every id, in the app's list order */
  order?: unknown[];
  /** list modules: the client has never saved this module — replace it entirely */
  replace?: boolean;
  /**
   * list modules, optimistic locking: for each record in `upserts` that the client
   * loaded from the database, the version it loaded (see `versions` in loadAll).
   * If the stored record has changed since, the save is refused (409 `conflict`)
   * instead of silently overwriting someone else's work. Optional: a client that
   * sends neither `base` nor `creates` (older browser tabs) is not checked.
   */
  base?: Record<string, string>;
  /** list modules: ids of records the client believes are new; refused if one already exists */
  creates?: unknown[];
  /** settings / users: the whole new value */
  value?: unknown;
}

// Column limits (see db/migrations): text ids are VARCHAR(191), other text is
// TEXT (64 KB), amounts are DECIMAL(65,30).
const MAX_ID_LENGTH = 191;
const MAX_TEXT_BYTES = 65535;
const DECIMAL_INT_DIGITS = 35;
const DECIMAL_FRAC_DIGITS = 30;

// Statements are kept well under MySQL's max_allowed_packet (only 1 MB on
// some installs); a single bigger record (e.g. a photo attachment) still
// goes in one statement of its own.
const BATCH_BYTES = 256 * 1024;
const BATCH_IDS = 1000;

// A single request that deletes at least this many records AND every record the
// module has is a "Clear module" — it needs the same permission as replacing a
// module (see WHOLE_MODULE_PERMISSIONS). Smaller modules can be emptied record
// by record, as the screens allow. This stops the one-shot wipe (and a client
// bug or script sending one); it cannot stop someone who is allowed to delete
// records in a module from deleting them a few at a time over several requests.
// Those requests are all recorded in the activity log.
const MASS_DELETE_MIN = 10;

const q = (identifier: string) => `\`${identifier}\``;
const isPlainObject = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function isIsoDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m || +m[1] < 1000) return false; // MySQL dates start at year 1000
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// A number as exact decimal text: "1e-7" would reach MySQL as an approximate
// (floating-point) literal, so exponents are spelled out ("0.0000001").
function decimalText(n: number) {
  const s = String(n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, lead, rest = "", exp] = m;
  const digits = lead + rest;
  const point = 1 + Number(exp); // digits before the decimal point
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return sign + digits + "0".repeat(point - digits.length);
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

// Whether DECIMAL(65,30) holds this number exactly. MySQL silently rounds
// extra decimal places (1e-31 would be stored as 0).
function fitsDecimal(n: number) {
  if (!Number.isFinite(n)) return false;
  const [int, frac = ""] = decimalText(Math.abs(n)).split(".");
  return int.length <= DECIMAL_INT_DIGITS && frac.length <= DECIMAL_FRAC_DIGITS;
}

// Whether a JS value can be stored in a column of this type without changing it.
function fits(type: ColumnType, v: unknown): boolean {
  switch (type) {
    case "text":
      return typeof v === "string" && Buffer.byteLength(v) <= MAX_TEXT_BYTES;
    case "bigint":
      return Number.isSafeInteger(v);
    case "integer":
      return Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647;
    case "numeric":
      return typeof v === "number" && fitsDecimal(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && isIsoDate(v);
    case "json":
      return true;
    case "text[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string" || x === null);
  }
}

// A column value as sent to MySQL: JSON columns take JSON text, decimals
// exact decimal text.
function toDb(type: ColumnType, v: unknown) {
  if (v === undefined || v === null) return null;
  if (type === "numeric") return decimalText(v as number);
  if (type === "json" || type === "text[]") return JSON.stringify(v);
  return v;
}

// mysql2 returns DECIMAL and JSON columns as text; the app only ever stores
// JS numbers and JSON values in them, so convert back. (BOOLEAN and DATE
// columns are converted by the pool, see lib/server/db.ts.)
function fromDb(type: ColumnType, v: unknown) {
  if (v === null || v === undefined) return v;
  if (type === "numeric" || type === "bigint") return Number(v);
  if (type === "json" || type === "text[]") return JSON.parse(v as string);
  return v;
}

const isColumn = (f: Field): f is Column => !("child" in f);

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/* record <-> row                                                      */
/* ------------------------------------------------------------------ */

// Splits an app record into column values, `extra` (everything without a
// fitting column) and child lists. null and undefined are treated alike —
// the app never distinguishes a missing field from a null one.
function splitRecord(obj: Rec, fields: Field[]) {
  const row: Rec = {};
  const extra: Rec = {};
  const children = new Map<ChildList, Rec[]>();
  const known = new Set<string>();
  for (const f of fields) {
    if (!isColumn(f)) {
      const { prop } = f.child;
      known.add(prop);
      const v = obj[prop];
      if (Array.isArray(v) && v.every(isPlainObject)) children.set(f.child, v);
      // No list at all is kept as a null marker, so it reloads as "no list"
      // rather than an empty one; anything unexpected is kept verbatim.
      else extra[prop] = v === undefined ? null : v;
      continue;
    }
    known.add(f.prop);
    const v = obj[f.prop];
    if (v === undefined || v === null) continue;
    if (fits(f.type, v)) row[f.col] = v;
    else extra[f.prop] = v;
  }
  for (const k of Object.keys(obj)) {
    if (!known.has(k) && obj[k] !== undefined) extra[k] = obj[k];
  }
  return { row, extra, children };
}

function joinRecord(row: Rec, fields: Field[], children: Map<string, Rec[]>) {
  const extra = (fromDb("json", row.extra) as Rec) || {};
  const obj: Rec = {};
  for (const f of fields) {
    if (!isColumn(f)) {
      const { prop } = f.child;
      obj[prop] = Object.hasOwn(extra, prop) ? extra[prop] : children.get(prop) || [];
      continue;
    }
    const v = row[f.col];
    if (v !== null && v !== undefined) obj[f.prop] = fromDb(f.type, v);
    else if (Object.hasOwn(extra, f.prop)) obj[f.prop] = extra[f.prop];
  }
  for (const k of Object.keys(extra)) if (!Object.hasOwn(obj, k)) obj[k] = extra[k];
  return obj;
}

/* ------------------------------------------------------------------ */
/* SQL helpers                                                          */
/* ------------------------------------------------------------------ */

type SqlColumn = { col: string; type: ColumnType };
const POSITION: SqlColumn = { col: "position", type: "integer" };
const EXTRA: SqlColumn = { col: "extra", type: "json" };

// Bulk insert (or upsert on id) of many rows, a batch per statement.
async function insertRows(
  conn: PoolConnection,
  table: string,
  cols: SqlColumn[],
  rows: Rec[],
  upsert = false,
) {
  if (!rows.length) return;
  let sql = `INSERT INTO ${q(table)} (${cols.map((c) => q(c.col)).join(", ")}) VALUES ?`;
  if (upsert) {
    const sets = cols.filter((c) => c.col !== "id").map((c) => `${q(c.col)} = VALUES(${q(c.col)})`);
    sql += ` ON DUPLICATE KEY UPDATE ${sets.join(", ")}, \`updated_at\` = NOW(6)`;
  }
  let batch: unknown[][] = [];
  let size = 0;
  for (const row of rows) {
    const values = cols.map((c) => toDb(c.type, row[c.col]));
    const rowSize = values.reduce<number>((n, v) => n + (typeof v === "string" ? v.length : 8), 0);
    if (batch.length && size + rowSize > BATCH_BYTES) {
      await conn.query(sql, [batch]);
      batch = [];
      size = 0;
    }
    batch.push(values);
    size += rowSize;
  }
  await conn.query(sql, [batch]);
}

function tableColumns(fields: Field[]): SqlColumn[] {
  return [...fields.filter(isColumn).map(({ col, type }) => ({ col, type })), POSITION, EXTRA];
}

async function markInitialized(conn: PoolConnection, store: string) {
  await conn.query(`INSERT INTO store_state (store) VALUES (?) ON DUPLICATE KEY UPDATE store = store`, [
    store,
  ]);
}

/* ------------------------------------------------------------------ */
/* list modules (records with ids)                                      */
/* ------------------------------------------------------------------ */

// Text ids must fit their VARCHAR(191) column, and can't end with a space:
// MySQL ignores trailing spaces when comparing, so "A " would overwrite "A".
function checkId(def: ListStore, id: unknown): string | number {
  if (
    def.idType === "bigint"
      ? Number.isSafeInteger(id)
      : typeof id === "string" && id !== "" && id.length <= MAX_ID_LENGTH && !id.endsWith(" ")
  ) {
    return id as string | number;
  }
  throw new BadRequestError(`${def.key}: a record has an invalid id ${JSON.stringify(id)}`);
}

function checkUnique(def: ListStore, ids: (string | number)[]) {
  const seen = new Set<string | number>();
  const dupes = new Set<string | number>();
  for (const id of ids) (seen.has(id) ? dupes : seen).add(id);
  if (dupes.size) {
    throw new BadRequestError(`${def.key}: more than one record has the id ${[...dupes].join(", ")}`);
  }
}

async function writeListRecords(
  conn: PoolConnection,
  def: ListStore,
  records: Rec[],
  position: Map<unknown, number>,
) {
  const rows: Rec[] = [];
  const childRows = new Map<ChildList, Rec[]>();
  for (const rec of records) {
    const { row, extra, children } = splitRecord(rec, def.fields);
    rows.push({ ...row, position: position.get(rec.id) ?? 0, extra });
    for (const [child, items] of children) {
      const out = childRows.get(child) || [];
      items.forEach((item, i) => {
        const split = splitRecord(item, child.columns);
        out.push({ ...split.row, [child.parentKey]: rec.id, line_no: i + 1, extra: split.extra });
      });
      childRows.set(child, out);
    }
  }
  await insertRows(conn, def.table, tableColumns(def.fields), rows, true);

  // Child lists are replaced as a whole for every saved record.
  const ids = records.map((r) => r.id);
  for (const f of def.fields) {
    if (isColumn(f)) continue;
    const child = f.child;
    for (const batch of chunks(ids, BATCH_IDS)) {
      await conn.query(`DELETE FROM ${q(child.table)} WHERE ${q(child.parentKey)} IN (?)`, [batch]);
    }
    const cols: SqlColumn[] = [
      { col: child.parentKey, type: def.idType },
      { col: "line_no", type: "integer" },
      ...child.columns.map(({ col, type }) => ({ col, type })),
      EXTRA,
    ];
    await insertRows(conn, child.table, cols, childRows.get(child) || []);
  }
}

// Sets each record's position from the app's list order, touching only the
// rows whose position changed.
async function updatePositions(conn: PoolConnection, def: ListStore, order: (string | number)[]) {
  for (let start = 0; start < order.length; start += BATCH_IDS) {
    const batch = order.slice(start, start + BATCH_IDS);
    const pairs = batch.map((_, i) => (i ? "SELECT ?, ?" : "SELECT ? AS id, ? AS ord")).join(" UNION ALL ");
    await conn.query(
      `UPDATE ${q(def.table)} t JOIN (${pairs}) o ON t.\`id\` = o.id
       SET t.\`position\` = o.ord WHERE t.\`position\` <> o.ord`,
      batch.flatMap((id, i) => [id, start + i + 1]),
    );
  }
}

async function countRows(conn: PoolConnection, table: string) {
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT count(*) AS n FROM ${q(table)}`);
  return Number(rows[0].n);
}

// The activity log says what a save changed, not only which records: the old and new
// value of every field that changed, and what a deleted record held. Because the browser
// works out the figures, this is the trail that shows a price, stock level or amount that
// was altered. Only the first records of a save are described, long values are cut short.
const AUDIT_RECORDS = 25;
const AUDIT_VALUE = 80;
const brief = (v: unknown) => {
  if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean") return v ?? null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > AUDIT_VALUE ? s.slice(0, AUDIT_VALUE) + "…" : s;
};

async function describeChanges(conn: PoolConnection, def: ListStore, upserts: Rec[], deleteIds: unknown[]) {
  const wanted = [...upserts.slice(0, AUDIT_RECORDS).map((r) => r.id), ...deleteIds.slice(0, AUDIT_RECORDS)];
  if (!wanted.length) return {};
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${q(def.table)} WHERE \`id\` IN (?)`, [wanted]);
  const old = new Map(rows.map((r) => [String(r.id), r]));
  const columns = def.fields.filter(isColumn);
  const valueOf = (row: RowDataPacket, f: Column) => (row[f.col] == null ? null : fromDb(f.type, row[f.col]));
  const edits: Rec[] = [];
  for (const rec of upserts.slice(0, AUDIT_RECORDS)) {
    const row = old.get(String(rec.id));
    if (!row) continue;
    const changed: Rec = {};
    for (const f of columns) {
      const from = valueOf(row, f);
      const to = rec[f.prop] ?? null;
      if (JSON.stringify(from) !== JSON.stringify(to) && !(typeof from === "number" && Number(to) === from))
        changed[f.prop] = { from: brief(from), to: brief(to) };
    }
    if (Object.keys(changed).length) edits.push({ id: rec.id, changed });
  }
  const removed: Rec[] = [];
  for (const id of deleteIds.slice(0, AUDIT_RECORDS)) {
    const row = old.get(String(id));
    if (!row) continue;
    const was: Rec = {};
    for (const f of columns) {
      const v = valueOf(row, f);
      if (v !== null) was[f.prop] = brief(v);
    }
    removed.push({ id, was });
  }
  return { ...(edits.length ? { edits } : {}), ...(removed.length ? { removed } : {}) };
}

/* ------------------------------------------------------------------ */
/* record versions (optimistic locking)                                 */
/* ------------------------------------------------------------------ */

// A record's version is its `updated_at` to the microsecond, as text. Every list
// table has that column and sets it on each write, so no schema change is needed.
// (Re-ordering the list changes `position` only, not the version.)
const VERSION_SQL = "DATE_FORMAT(`updated_at`, '%Y-%m-%d %H:%i:%s.%f')";
export type Versions = Record<string, string>;

/** Versions of the given records (`lock`: hold them until the transaction ends). */
async function readVersions(db: Db, def: ListStore, ids: (string | number)[], lock = false) {
  const out: Versions = {};
  for (const batch of chunks(ids, BATCH_IDS)) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT \`id\`, ${VERSION_SQL} AS v FROM ${q(def.table)} WHERE \`id\` IN (?)${lock ? " FOR UPDATE" : ""}`,
      [batch],
    );
    for (const r of rows) out[String(r.id)] = r.v;
  }
  return out;
}

// Refuses the save when it would overwrite a record somebody else created or changed
// since this client loaded it. Runs inside the save's transaction with the rows locked,
// so two saves of the same record take turns and the second one sees the first.
async function checkVersions(
  conn: PoolConnection,
  def: ListStore,
  label: string,
  upsertIds: (string | number)[],
  change: StoreChange,
) {
  const { base, creates } = change;
  if (base === undefined && creates === undefined) return; // older client: no checking
  if (base !== undefined && (!isPlainObject(base) || !Object.values(base).every((v) => typeof v === "string")))
    throw new BadRequestError(`${def.key}: base must map record ids to version texts`);
  if (creates !== undefined && !Array.isArray(creates))
    throw new BadRequestError(`${def.key}: creates must be a list of ids`);
  const created = new Set((creates ?? []).map((id) => String(checkId(def, id))));
  const known = (base ?? {}) as Versions;
  const current = await readVersions(conn, def, upsertIds, true);
  const clashes: string[] = [];
  for (const id of upsertIds.map(String)) {
    const now = current[id];
    if (created.has(id)) {
      if (now !== undefined) clashes.push(`${id} was just created by someone else`);
    } else if (Object.hasOwn(known, id)) {
      if (now === undefined) clashes.push(`${id} was deleted by someone else`);
      else if (now !== known[id]) clashes.push(`${id} was changed by someone else`);
    }
  }
  if (clashes.length) {
    const shown = clashes.slice(0, 3).join("; ") + (clashes.length > 3 ? `; and ${clashes.length - 3} more` : "");
    throw new ConflictError(
      `${label}: ${shown}. Reload the page to get the latest data. Nothing was saved.`,
      "conflict",
    );
  }
}

/**
 * `wholeModules`: may this user replace or empty the module in one go? Without
 * it, `replace` is only the very first save of a module nobody has saved yet,
 * one request may not delete every record of a module that has many, and what
 * is saved must pass the sanity checks (lib/server/learnex/sanity.ts). The same
 * permission means "trusted to write any data, as a backup restore does".
 */
async function syncList(
  conn: PoolConnection,
  def: ListStore,
  change: StoreChange,
  wholeModules: boolean,
  /** receives the new version of every record this change wrote */
  versionsOut?: Record<string, Versions>,
) {
  const upserts = change.upserts ?? [];
  const deletes = change.deletes ?? [];
  if (!Array.isArray(upserts) || !upserts.every(isPlainObject))
    throw new BadRequestError(`${def.key}: upserts must be a list of records`);
  if (!Array.isArray(deletes)) throw new BadRequestError(`${def.key}: deletes must be a list of ids`);
  if (change.order !== undefined && !Array.isArray(change.order))
    throw new BadRequestError(`${def.key}: order must be a list of ids`);
  if (upserts.length && !change.order)
    throw new BadRequestError(`${def.key}: order is required when saving records`);

  const upsertIds = upserts.map((r) => checkId(def, r.id));
  checkUnique(def, upsertIds);
  const order = (change.order ?? []).map((id) => checkId(def, id));
  checkUnique(def, order);
  const position = new Map<unknown, number>(order.map((id, i) => [id, i + 1]));

  const deleteIds = deletes.map((id) => checkId(def, id));
  const label = STORE_LABELS[def.key as StoreKey] ?? def.key;

  // A role that cannot restore a backup may not save impossible figures (negative prices, dates in 2099, ...).
  if (!wholeModules) {
    for (const rec of upserts) {
      const problem = sanityProblem(def.key, rec);
      if (problem)
        throw new BadRequestError(`${label} ${JSON.stringify(rec.id)}: ${problem}. Nothing was saved.`);
    }
  }

  if (change.replace) {
    if (wholeModules) await conn.query(`DELETE FROM ${q(def.table)}`);
    else {
      // Without the restore/reset permission `replace` must never overwrite or clear what is
      // stored: it is only the very first save of a module (nothing saved, nothing in the table).
      const [state] = await conn.query<RowDataPacket[]>(`SELECT 1 FROM store_state WHERE store = ?`, [
        def.key,
      ]);
      const [stored] = await conn.query<RowDataPacket[]>(`SELECT 1 FROM ${q(def.table)} LIMIT 1`);
      if (state.length || stored.length) {
        throw new ForbiddenError(
          `You don't have permission to replace everything in ${label}. Nothing was saved.`,
          "replace_forbidden",
        );
      }
    }
  }

  // Somebody else changed or created one of these records since this client loaded it?
  if (!change.replace) await checkVersions(conn, def, label, upsertIds, change);

  // What the records held before this save (the activity log keeps it).
  const detail = change.replace ? {} : await describeChanges(conn, def, upserts, deleteIds);

  // Deleting every record in one request is "Clear module" — the same power as `replace`.
  const guardWipe = !wholeModules && deleteIds.length >= MASS_DELETE_MIN;
  const before = guardWipe ? await countRows(conn, def.table) : 0;
  let deleted = 0;
  for (const batch of chunks(deleteIds, BATCH_IDS)) {
    const [res] = await conn.query<ResultSetHeader>(`DELETE FROM ${q(def.table)} WHERE \`id\` IN (?)`, [
      batch,
    ]);
    deleted += res.affectedRows;
  }
  if (guardWipe && before >= MASS_DELETE_MIN && deleted >= before) {
    throw new ForbiddenError(
      `You don't have permission to delete every record in ${label} at once (that needs "Clear & factory reset"). Nothing was saved.`,
      "wipe_forbidden",
    );
  }
  let existing = 0;
  for (const batch of chunks(upsertIds, BATCH_IDS)) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT count(*) AS n FROM ${q(def.table)} WHERE \`id\` IN (?)`,
      [batch],
    );
    existing += Number(rows[0].n);
  }
  await writeListRecords(conn, def, upserts, position);
  if (order.length && !change.replace) await updatePositions(conn, def, order);
  await markInitialized(conn, def.key);
  if (versionsOut && upsertIds.length) versionsOut[def.key] = await readVersions(conn, def, upsertIds);
  const summary: ChangeSummary = {
    store: def.key,
    created: upsertIds.length - existing,
    updated: existing,
    deleted,
    ids: [...upsertIds, ...deleteIds].slice(0, 50),
    ...detail,
  };
  if (change.replace) summary.replaced = true;
  return summary;
}

async function loadList(def: ListStore) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM ${q(def.table)} ORDER BY \`position\`, \`id\``,
  );
  const childrenById = new Map<unknown, Map<string, Rec[]>>();
  for (const f of def.fields) {
    if (isColumn(f)) continue;
    const child = f.child;
    const [childRows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ${q(child.table)} ORDER BY ${q(child.parentKey)}, \`line_no\``,
    );
    for (const r of childRows) {
      const parentId = fromDb(def.idType, r[child.parentKey]);
      const byProp = childrenById.get(parentId) || new Map<string, Rec[]>();
      const list = byProp.get(child.prop) || [];
      list.push(joinRecord(r, child.columns, new Map()));
      byProp.set(child.prop, list);
      childrenById.set(parentId, byProp);
    }
  }
  return rows.map((r) => joinRecord(r, def.fields, childrenById.get(fromDb(def.idType, r.id)) || new Map()));
}

async function loadVersions(def: ListStore) {
  const out: Versions = {};
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT \`id\`, ${VERSION_SQL} AS v FROM ${q(def.table)}`);
  for (const r of rows) out[String(r.id)] = r.v;
  return out;
}

/* ------------------------------------------------------------------ */
/* settings (one object) and users (small list without ids)            */
/* ------------------------------------------------------------------ */

async function syncSingle(conn: PoolConnection, def: SingleStore, value: unknown) {
  if (!isPlainObject(value)) throw new BadRequestError(`${def.key}: value must be an object`);
  const { row, extra } = splitRecord(value, def.fields);
  const cols: SqlColumn[] = [
    { col: "id", type: "integer" },
    ...def.fields.filter(isColumn).map(({ col, type }) => ({ col, type })),
    EXTRA,
  ];
  await insertRows(conn, def.table, cols, [{ ...row, id: 1, extra }], true);
  await markInitialized(conn, def.key);
  return { store: def.key, updated: 1 } as ChangeSummary;
}

async function syncReplace(conn: PoolConnection, def: ReplaceStore, value: unknown) {
  if (!Array.isArray(value) || !value.every(isPlainObject))
    throw new BadRequestError(`${def.key}: value must be a list of records`);
  await conn.query(`DELETE FROM ${q(def.table)}`);
  const rows = value.map((rec, i) => {
    const { row, extra } = splitRecord(rec, def.fields);
    return { ...row, position: i + 1, extra };
  });
  await insertRows(conn, def.table, tableColumns(def.fields), rows);
  await markInitialized(conn, def.key);
  return { store: def.key, replaced: true, created: rows.length } as ChangeSummary;
}

/* ------------------------------------------------------------------ */
/* public API                                                           */
/* ------------------------------------------------------------------ */

async function applyChange(
  conn: PoolConnection,
  change: StoreChange,
  wholeModules: boolean,
  versionsOut: Record<string, Versions>,
): Promise<ChangeSummary> {
  if (!isPlainObject(change)) throw new BadRequestError("each change must be an object");
  const def = STORE_BY_KEY.get(change.store);
  if (!def) throw new BadRequestError(`unknown module ${JSON.stringify(change.store)}`);
  if (def.kind === "list") return syncList(conn, def, change, wholeModules, versionsOut);
  if (def.kind === "single") return syncSingle(conn, def, change.value);
  return syncReplace(conn, def, change.value);
}

const ALL_ACCESS: AccessMap = Object.fromEntries(STORES.map((d) => [d.key, "write"]));

/**
 * Everything the app needs on start-up, limited to the modules the user may
 * load. `stores` leaves out modules never saved; `access` says which modules
 * the user may load ("read") or also save ("write") — others are hidden.
 */
export async function loadAll(access: AccessMap = ALL_ACCESS) {
  const initialized = await isInitialized();
  const [state] = await pool.query<RowDataPacket[]>(`SELECT store FROM store_state`);
  const saved = new Set(state.map((r) => r.store as string));
  const stores: Rec = {};
  // Version of every record, so a save can tell whether someone else changed it meanwhile.
  const versions: Record<string, Versions> = {};
  for (const def of STORES) {
    if (!saved.has(def.key) || !access[def.key as StoreKey]) continue;
    if (def.kind === "list") {
      stores[def.key] = await loadList(def);
      versions[def.key] = await loadVersions(def);
    }
    else if (def.kind === "single") {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${q(def.table)} WHERE \`id\` = 1`);
      if (rows.length) stores[def.key] = joinRecord(rows[0], def.fields, new Map());
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM ${q(def.table)} ORDER BY \`position\`, \`id\``,
      );
      stores[def.key] = rows.map((r) => joinRecord(r, def.fields, new Map()));
    }
  }
  return { initialized, stores, access, versions };
}

function checkWritable(access: AccessMap, store: unknown) {
  if (typeof store === "string" && STORE_BY_KEY.has(store) && access[store as StoreKey] !== "write") {
    throw new ForbiddenError(
      `You don't have permission to change ${STORE_LABELS[store as StoreKey] ?? store}. Nothing was saved.`,
      "store_forbidden",
    );
  }
}

/**
 * Saves a batch of module changes atomically (all or nothing). Every module
 * touched must be writable for the user; the activity log entry is written in
 * the same transaction. `wholeModules` says whether the user may replace or
 * empty a module in one request (restore / reset permission); it is off unless
 * the caller turns it on.
 */
export async function saveChanges(
  changes: unknown,
  actor: Actor | null = null,
  access: AccessMap = ALL_ACCESS,
  { wholeModules = false }: { wholeModules?: boolean } = {},
) {
  if (!Array.isArray(changes) || !changes.length)
    throw new BadRequestError("changes must be a non-empty list");
  for (const change of changes) checkWritable(access, isPlainObject(change) ? change.store : undefined);
  return withTransaction(async (conn) => {
    const summaries: ChangeSummary[] = [];
    const versions: Record<string, Versions> = {};
    for (const change of changes)
      summaries.push(await applyChange(conn, change as StoreChange, wholeModules, versions));
    await audit(actor, "data.save", summaries.map((s) => s.store).join(", "), { changes: summaries }, conn);
    // the new version of every record written, for the next save from this client
    return { ok: true, versions };
  });
}

/**
 * One-time import of existing data (browser storage, data folder or backup
 * file). Every module present in `stores` replaces what's in the database;
 * modules not present start from the app's demo data.
 */
export async function importAll(stores: unknown, actor: Actor | null = null) {
  if (!isPlainObject(stores)) throw new BadRequestError("stores must be an object");
  await withTransaction(async (conn) => {
    const imported: ChangeSummary[] = [];
    for (const def of STORES) {
      const value = stores[def.key];
      if (value === undefined || value === null) continue;
      if (def.kind === "list") {
        if (!Array.isArray(value)) throw new BadRequestError(`${def.key}: expected a list`);
        imported.push(
          // Importing is already limited to the restore permission (see the import route).
          await syncList(
            conn,
            def,
            { store: def.key, replace: true, upserts: value, order: value.map((r) => (r as Rec)?.id) },
            true,
          ),
        );
      } else if (def.kind === "single") imported.push(await syncSingle(conn, def, value));
      else imported.push(await syncReplace(conn, def, value));
    }
    await conn.query(
      `INSERT INTO app_meta (\`key\`, value) VALUES ('initialized', ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW(6)`,
      [JSON.stringify(new Date())],
    );
    await audit(
      actor,
      "data.import",
      null,
      { modules: imported.map(({ store, created }) => ({ store, records: created })) },
      conn,
    );
  });
}

/** Factory reset: removes every business record; the app then starts again from its demo data. */
export async function resetAll(actor: Actor | null = null) {
  const tables = [
    "store_state",
    ...STORES.flatMap((def) => [
      def.table,
      ...def.fields.flatMap((f) => (isColumn(f) ? [] : [f.child.table])),
    ]),
  ];
  // DELETE rather than TRUNCATE: in MySQL, TRUNCATE can't run inside a
  // transaction (or on a table other tables point to).
  await withTransaction(async (conn) => {
    for (const table of tables) await conn.query(`DELETE FROM ${q(table)}`);
    await audit(actor, "data.reset", null, {}, conn);
  });
}

export async function isInitialized() {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT 1 FROM app_meta WHERE \`key\` = 'initialized'`);
  return rows.length > 0;
}
