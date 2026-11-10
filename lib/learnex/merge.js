/* =====================================================================
   RE-APPLYING MY CHANGES ON TOP OF SOMEONE ELSE'S

   Two cashiers selling the same product at the same moment each work out "stock minus what I
   sold" from the stock they last loaded. The server refuses the second save rather than let it
   overwrite the first ("Out of date"). Throwing that sale away would lose a real sale, so the
   browser instead keeps what it was about to save, reloads, and merges it into the fresh data:

     per field, comparing  base (what I loaded)  mine (what I changed it to)  theirs (now stored)
       - I did not change it                         → theirs
       - only I changed it (or we agree)             → mine
       - both changed a NUMBER (stock, a total)      → theirs + (mine − base)    "my sale on top of theirs"
       - both changed something else                 → mine, and it is counted as a conflict

   A new record whose reference number was just taken by someone else (SO-1043, INV-2462,
   TXN-8823 … both tills pick "highest + 1") is renumbered, and the new number is carried
   into the other new records of the same save that mention the old one.
   Pure functions, no browser APIs, so they can be unit-tested.
===================================================================== */

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const round6 = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

/** Three-way merge of one record. Returns { record, conflicts: [field, ...] }. */
export function mergeRecord(base, mine, theirs) {
  const record = {};
  const conflicts = [];
  const keys = [...new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)])];
  for (const k of keys) {
    const b = base[k];
    const m = mine[k];
    const t = theirs[k];
    let v;
    if (same(m, b)) v = t;
    else if (same(t, b) || same(t, m)) v = m;
    else if (isNum(m) && isNum(b) && isNum(t)) v = round6(t + (m - b));
    else {
      v = m;
      conflicts.push(k);
    }
    if (v !== undefined) record[k] = v;
  }
  return { record, conflicts };
}

// Fields that must be unique text, per module; the others (timestamp ids) cannot realistically clash.
const SEQUENTIAL = {
  salesOrders: ["id", "invoice"],
  purchaseOrders: ["id"],
  deliveryRuns: ["id"],
  rawMaterialUsage: ["id"],
  ledger: ["id"],
};
const SEQUENCE_PATTERN = /^([A-Za-z]+-)(\d+)$/;

function nextInSequence(prefix, taken) {
  let max = 0;
  for (const value of taken) {
    const m = SEQUENCE_PATTERN.exec(String(value));
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return prefix + (max + 1);
}

// Replaces whole reference numbers inside any text in `value` (deeply).
function renameTokens(value, renames) {
  if (typeof value === "string") {
    // one pass over the text, so a number that was renamed is not renamed a second time
    const escaped = [...renames.keys()].map((from) => from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!escaped.length) return value;
    return value.replace(new RegExp(`(?<![A-Za-z0-9-])(?:${escaped.join("|")})(?![0-9])`, "g"), (hit) => renames.get(hit));
  }
  if (Array.isArray(value)) return value.map((v) => renameTokens(v, renames));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renameTokens(v, renames);
    return out;
  }
  return value;
}

/**
 * @param loaded  { moduleKey: [records] }  the freshly loaded data (only list modules)
 * @param ops     { moduleKey: { upserts: [{ base|null, mine, index }], deletes: [ids] } }
 * @returns { merged: { moduleKey: [records] }, conflicts: number, unresolved: string[] }
 *   `unresolved` is not empty when something could not be merged safely (then use nothing).
 */
export function mergeChanges(loaded, ops) {
  const unresolved = [];
  const renames = new Map(); // old reference number -> new one, across all modules
  const taken = {}; // per module and field: values in use (theirs + the ones handed out here)
  const takenIn = (store, field) =>
    (taken[`${store}.${field}`] ||= new Set((loaded[store] || []).map((r) => r[field]).filter(Boolean)));

  // 1. new records whose reference number is already used by someone else
  for (const [store, op] of Object.entries(ops)) {
    const fields = SEQUENTIAL[store] || [];
    for (const { base, mine } of op.upserts) {
      if (base) continue;
      for (const field of fields) {
        const value = mine[field];
        if (!value || !takenIn(store, field).has(value)) continue;
        const m = SEQUENCE_PATTERN.exec(String(value));
        if (!m) {
          unresolved.push(`${store}: ${value}`);
          continue;
        }
        const fresh = nextInSequence(m[1], takenIn(store, field));
        takenIn(store, field).add(fresh);
        renames.set(value, fresh);
      }
      // a clash on a module with plain numeric ids (never seen in practice) cannot be repaired
      if (!fields.length && (loaded[store] || []).some((r) => r.id === mine.id)) unresolved.push(`${store}: ${mine.id}`);
    }
  }
  if (unresolved.length) return { merged: {}, conflicts: 0, unresolved };

  // 2. merge module by module
  const merged = {};
  let conflicts = 0;
  for (const [store, op] of Object.entries(ops)) {
    const list = (loaded[store] || []).slice();
    const at = (id) => list.findIndex((r) => r.id === id);
    const mineOf = (rec) => (renames.size ? renameTokens(rec, renames) : rec);
    for (const { base, mine: rawMine, index } of op.upserts) {
      const mine = mineOf(rawMine);
      const where = at(mine.id);
      if (base && where >= 0) {
        const result = mergeRecord(base, mine, list[where]);
        conflicts += result.conflicts.length;
        list[where] = result.record;
      } else if (where >= 0) {
        unresolved.push(`${store}: ${mine.id}`);
      } else {
        // new (or deleted meanwhile): put it back where it was in my list
        list.splice(Math.min(Math.max(index ?? 0, 0), list.length), 0, mine);
      }
    }
    merged[store] = list.filter((r) => !op.deletes.some((id) => id === r.id));
  }
  return { merged, conflicts, unresolved };
}
