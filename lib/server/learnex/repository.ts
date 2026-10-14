import "server-only";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool, withTransaction } from "@/lib/server/db";
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
import { BadRequestError, ForbiddenError } from "@/lib/server/errors";
import { audit, type Actor } from "@/lib/server/audit";
import { STORE_LABELS, type StoreAccess, type StoreKey } from "@/lib/auth/permissions";

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

async function syncList(conn: PoolConnection, def: ListStore, change: StoreChange) {
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

  if (change.replace) await conn.query(`DELETE FROM ${q(def.table)}`);
  const deleteIds = deletes.map((id) => checkId(def, id));
  let deleted = 0;
  for (const batch of chunks(deleteIds, BATCH_IDS)) {
    const [res] = await conn.query<ResultSetHeader>(`DELETE FROM ${q(def.table)} WHERE \`id\` IN (?)`, [
      batch,
    ]);
    deleted += res.affectedRows;
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
  const summary: ChangeSummary = {
    store: def.key,
    created: upsertIds.length - existing,
    updated: existing,
    deleted,
    ids: [...upsertIds, ...deleteIds].slice(0, 50),
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

async function applyChange(conn: PoolConnection, change: StoreChange): Promise<ChangeSummary> {
  if (!isPlainObject(change)) throw new BadRequestError("each change must be an object");
  const def = STORE_BY_KEY.get(change.store);
  if (!def) throw new BadRequestError(`unknown module ${JSON.stringify(change.store)}`);
  if (def.kind === "list") return syncList(conn, def, change);
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
  for (const def of STORES) {
    if (!saved.has(def.key) || !access[def.key as StoreKey]) continue;
    if (def.kind === "list") stores[def.key] = await loadList(def);
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
  return { initialized, stores, access };
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
 * the same transaction.
 */
export async function saveChanges(
  changes: unknown,
  actor: Actor | null = null,
  access: AccessMap = ALL_ACCESS,
) {
  if (!Array.isArray(changes) || !changes.length)
    throw new BadRequestError("changes must be a non-empty list");
  for (const change of changes) checkWritable(access, isPlainObject(change) ? change.store : undefined);
  await withTransaction(async (conn) => {
    const summaries: ChangeSummary[] = [];
    for (const change of changes) summaries.push(await applyChange(conn, change as StoreChange));
    await audit(actor, "data.save", summaries.map((s) => s.store).join(", "), { changes: summaries }, conn);
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
          await syncList(conn, def, {
            store: def.key,
            replace: true,
            upserts: value,
            order: value.map((r) => (r as Rec)?.id),
          }),
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
