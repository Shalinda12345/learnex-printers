import "server-only";
import type { PoolClient } from "pg";
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

type Rec = Record<string, unknown>;

/** A request the server refuses (bad shape / invalid ids) — reported as HTTP 400. */
export class BadRequestError extends Error {}

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

const SQL_TYPE: Record<ColumnType, string> = {
  text: "text",
  bigint: "bigint",
  integer: "integer",
  numeric: "numeric",
  boolean: "boolean",
  date: "date",
  jsonb: "jsonb",
  "text[]": "text[]",
};
const q = (identifier: string) => `"${identifier}"`;
const isPlainObject = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function isIsoDate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Whether a JS value can be stored in a column of this type without changing it.
function fits(type: ColumnType, v: unknown): boolean {
  switch (type) {
    case "text":
      return typeof v === "string";
    case "bigint":
      return Number.isSafeInteger(v);
    case "integer":
      return Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647;
    case "numeric":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "date":
      return typeof v === "string" && isIsoDate(v);
    case "jsonb":
      return true;
    case "text[]":
      return Array.isArray(v) && v.every((x) => typeof x === "string" || x === null);
  }
}

// pg returns numeric/bigint as strings (they can exceed JS precision in
// general); the app only ever stores JS numbers in them, so convert back.
function fromDb(type: ColumnType, v: unknown) {
  return type === "numeric" || type === "bigint" ? Number(v) : v;
}

const isColumn = (f: Field): f is Column => !("child" in f);

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
  const extra = (row.extra as Rec) || {};
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
const EXTRA: SqlColumn = { col: "extra", type: "jsonb" };

// Bulk insert (or upsert on id) of many rows in one statement.
async function insertRows(client: PoolClient, table: string, cols: SqlColumn[], rows: Rec[], upsert = false) {
  if (!rows.length) return;
  const list = cols.map((c) => q(c.col)).join(", ");
  const defs = cols.map((c) => `${q(c.col)} ${SQL_TYPE[c.type]}`).join(", ");
  let sql = `INSERT INTO ${q(table)} (${list}) SELECT ${list} FROM jsonb_to_recordset($1::jsonb) AS x(${defs})`;
  if (upsert) {
    const sets = cols.filter((c) => c.col !== "id").map((c) => `${q(c.col)} = EXCLUDED.${q(c.col)}`);
    sql += ` ON CONFLICT ("id") DO UPDATE SET ${sets.join(", ")}, "updated_at" = now()`;
  }
  await client.query(sql, [JSON.stringify(rows)]);
}

function tableColumns(fields: Field[]): SqlColumn[] {
  return [...fields.filter(isColumn).map(({ col, type }) => ({ col, type })), POSITION, EXTRA];
}

async function markInitialized(client: PoolClient, store: string) {
  await client.query(`INSERT INTO store_state (store) VALUES ($1) ON CONFLICT (store) DO NOTHING`, [store]);
}

/* ------------------------------------------------------------------ */
/* list modules (records with ids)                                      */
/* ------------------------------------------------------------------ */

function checkId(def: ListStore, id: unknown): string | number {
  if (def.idType === "bigint" ? Number.isSafeInteger(id) : typeof id === "string" && id !== "") {
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
  client: PoolClient,
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
  await insertRows(client, def.table, tableColumns(def.fields), rows, true);

  // Child lists are replaced as a whole for every saved record.
  const ids = records.map((r) => r.id);
  for (const f of def.fields) {
    if (isColumn(f)) continue;
    const child = f.child;
    await client.query(
      `DELETE FROM ${q(child.table)} WHERE ${q(child.parentKey)} = ANY($1::${def.idType}[])`,
      [ids],
    );
    const cols: SqlColumn[] = [
      { col: child.parentKey, type: def.idType },
      { col: "line_no", type: "integer" },
      ...child.columns.map(({ col, type }) => ({ col, type })),
      EXTRA,
    ];
    await insertRows(client, child.table, cols, childRows.get(child) || []);
  }
}

async function syncList(client: PoolClient, def: ListStore, change: StoreChange) {
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

  if (change.replace) await client.query(`DELETE FROM ${q(def.table)}`);
  const deleteIds = deletes.map((id) => checkId(def, id));
  if (deleteIds.length) {
    await client.query(`DELETE FROM ${q(def.table)} WHERE "id" = ANY($1::${def.idType}[])`, [deleteIds]);
  }
  await writeListRecords(client, def, upserts, position);
  if (order.length && !change.replace) {
    await client.query(
      `UPDATE ${q(def.table)} t SET "position" = o.ord::integer
       FROM unnest($1::${def.idType}[]) WITH ORDINALITY AS o(id, ord)
       WHERE t."id" = o.id AND t."position" IS DISTINCT FROM o.ord::integer`,
      [order],
    );
  }
  await markInitialized(client, def.key);
}

async function loadList(def: ListStore) {
  const { rows } = await pool.query(`SELECT * FROM ${q(def.table)} ORDER BY "position", "id"`);
  const childrenById = new Map<unknown, Map<string, Rec[]>>();
  for (const f of def.fields) {
    if (isColumn(f)) continue;
    const child = f.child;
    const res = await pool.query(`SELECT * FROM ${q(child.table)} ORDER BY ${q(child.parentKey)}, "line_no"`);
    for (const r of res.rows) {
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

async function syncSingle(client: PoolClient, def: SingleStore, value: unknown) {
  if (!isPlainObject(value)) throw new BadRequestError(`${def.key}: value must be an object`);
  const { row, extra } = splitRecord(value, def.fields);
  const cols: SqlColumn[] = [
    { col: "id", type: "integer" },
    ...def.fields.filter(isColumn).map(({ col, type }) => ({ col, type })),
    EXTRA,
  ];
  await insertRows(client, def.table, cols, [{ ...row, id: 1, extra }], true);
  await markInitialized(client, def.key);
}

async function syncReplace(client: PoolClient, def: ReplaceStore, value: unknown) {
  if (!Array.isArray(value) || !value.every(isPlainObject))
    throw new BadRequestError(`${def.key}: value must be a list of records`);
  await client.query(`DELETE FROM ${q(def.table)}`);
  const rows = value.map((rec, i) => {
    const { row, extra } = splitRecord(rec, def.fields);
    return { ...row, position: i + 1, extra };
  });
  await insertRows(client, def.table, tableColumns(def.fields), rows);
  await markInitialized(client, def.key);
}

/* ------------------------------------------------------------------ */
/* public API                                                           */
/* ------------------------------------------------------------------ */

async function applyChange(client: PoolClient, change: StoreChange) {
  if (!isPlainObject(change)) throw new BadRequestError("each change must be an object");
  const def = STORE_BY_KEY.get(change.store);
  if (!def) throw new BadRequestError(`unknown module ${JSON.stringify(change.store)}`);
  if (def.kind === "list") await syncList(client, def, change);
  else if (def.kind === "single") await syncSingle(client, def, change.value);
  else await syncReplace(client, def, change.value);
}

/** Everything the app needs on start-up. Modules never saved are left out. */
export async function loadAll() {
  const meta = await pool.query(`SELECT value FROM app_meta WHERE key = 'initialized'`);
  const state = await pool.query(`SELECT store FROM store_state`);
  const saved = new Set(state.rows.map((r) => r.store as string));
  const stores: Rec = {};
  for (const def of STORES) {
    if (!saved.has(def.key)) continue;
    if (def.kind === "list") stores[def.key] = await loadList(def);
    else if (def.kind === "single") {
      const { rows } = await pool.query(`SELECT * FROM ${q(def.table)} WHERE "id" = 1`);
      if (rows.length) stores[def.key] = joinRecord(rows[0], def.fields, new Map());
    } else {
      const { rows } = await pool.query(`SELECT * FROM ${q(def.table)} ORDER BY "position", "id"`);
      stores[def.key] = rows.map((r) => joinRecord(r, def.fields, new Map()));
    }
  }
  return { initialized: meta.rowCount! > 0, stores };
}

/** Saves a batch of module changes atomically (all or nothing). */
export async function saveChanges(changes: unknown) {
  if (!Array.isArray(changes) || !changes.length)
    throw new BadRequestError("changes must be a non-empty list");
  await withTransaction(async (client) => {
    for (const change of changes) await applyChange(client, change as StoreChange);
  });
}

/**
 * One-time import of existing data (browser storage, data folder or backup
 * file). Every module present in `stores` replaces what's in the database;
 * modules not present start from the app's demo data.
 */
export async function importAll(stores: unknown) {
  if (!isPlainObject(stores)) throw new BadRequestError("stores must be an object");
  await withTransaction(async (client) => {
    for (const def of STORES) {
      const value = stores[def.key];
      if (value === undefined || value === null) continue;
      if (def.kind === "list") {
        if (!Array.isArray(value)) throw new BadRequestError(`${def.key}: expected a list`);
        await syncList(client, def, {
          store: def.key,
          replace: true,
          upserts: value,
          order: value.map((r) => (r as Rec)?.id),
        });
      } else if (def.kind === "single") await syncSingle(client, def, value);
      else await syncReplace(client, def, value);
    }
    await client.query(
      `INSERT INTO app_meta (key, value) VALUES ('initialized', to_jsonb(now()))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    );
  });
}

/** Factory reset: removes every record; the app then starts again from its demo data. */
export async function resetAll() {
  const tables = [
    "store_state",
    ...STORES.flatMap((def) => [
      def.table,
      ...def.fields.flatMap((f) => (isColumn(f) ? [] : [f.child.table])),
    ]),
  ];
  await pool.query(`TRUNCATE ${tables.map(q).join(", ")} RESTART IDENTITY`);
}
