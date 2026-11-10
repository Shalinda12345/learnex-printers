/* =====================================================================
   SANITY CHECKS on the business data staff save.

   The browser works out every figure (totals, tax, stock) and the server
   stores what it is sent, so a staff account could save a -500,000 sale, a
   price of -1, stock of -999, or an expense dated 2099 just by calling the
   API directly. These checks refuse values that can never be right, for the
   roles that cannot restore a backup (a role that can restore may write any
   data anyway, and old backups must always be importable as they are).

   What is checked, in plain terms:
     - money (prices, costs, totals, paid amounts) is never negative or absurd
     - quantities (stock, units sold, ...) are never negative or absurd
     - an order is never paid more than it is worth
     - dates are real-looking: not before 2000, not more than a month ahead
     - ledger amounts are never negative, except the one line the app writes
       itself on a sales return: "Cost of goods sold reversed"

   What this is NOT: it does not recompute totals or re-run the accounting, so
   a plausible but wrong figure still gets through. It stops impossible data and
   one-line API abuse, not a determined insider. Anything it does not
   understand (a text where a number belongs, a missing field) is left alone,
   exactly as the store keeps it.

   Pure functions with no server-only imports, so they can be unit-tested.
===================================================================== */

export const MAX_MONEY = 1e13;
export const MAX_QUANTITY = 1e9;
const NOISE = 1e-6; // rounding noise such as -1e-15 is not a negative number
const EARLIEST_DATE = "2000-01-01";
const DAYS_AHEAD = 31;

type Rec = Record<string, unknown>;

interface Spec {
  money?: string[]; // 0 … MAX_MONEY
  signed?: string[]; // -MAX_MONEY … MAX_MONEY (an opening balance can be an overdraft)
  quantity?: string[]; // 0 … MAX_QUANTITY
  dates?: string[];
  children?: Record<string, Spec>; // lists inside the record (line items, payments, ...)
  check?: (rec: Rec) => string | null; // rules that look at several fields
}

/** The number in a field, or null when it holds something else (that is left alone). */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\s*[+-]?\d+(\.\d+)?([eE][+-]?\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

const paidWithin = (paid: string, total: string) => (rec: Rec) => {
  const p = numberOf(rec[paid]);
  const t = numberOf(rec[total]);
  return p !== null && t !== null && p > t + 0.01 ? `${paid} (${p}) can't be more than ${total} (${t})` : null;
};

// The one negative the app writes by itself: when goods come back from a customer, the cost
// of goods sold is reversed with a negative "Expense" line of kind "cogs" (SalesOrders.jsx).
const ledgerAmount = (rec: Rec) => {
  const n = numberOf(rec.amount);
  if (n === null) return null;
  if (Math.abs(n) > MAX_MONEY) return `amount (${n}) is unrealistically large`;
  if (n < -NOISE && !(rec.kind === "cogs" && rec.type === "Expense")) return `amount can't be negative (${n})`;
  return null;
};

const SPECS: Record<string, Spec> = {
  products: { money: ["price", "cost"], quantity: ["stock", "min"] },
  customers: { money: ["spent", "outstanding"], quantity: ["orders"] },
  suppliers: { money: ["purchased"], dates: ["lastOrder"] },
  salesOrders: {
    money: ["amount", "tax", "amountPaid"],
    quantity: ["items"],
    dates: ["date"],
    children: {
      lineItems: { money: ["price"], quantity: ["qty", "availableStock"] },
      payments: { money: ["amount"], dates: ["date"] },
    },
    check: paidWithin("amountPaid", "amount"),
  },
  purchaseOrders: {
    money: ["total", "amountPaid", "toppedUpAmount"],
    quantity: ["items"],
    dates: ["date"],
    children: { lineItems: { money: ["cost"], quantity: ["qty"] } },
    check: paidWithin("amountPaid", "total"),
  },
  rawMaterials: {
    money: ["costPrice", "lastPurchaseCost"],
    quantity: ["purchaseQty", "availableQty"],
    dates: ["purchaseDate"],
  },
  rawMaterialUsage: { money: ["consumedValue"], quantity: ["qtyUsed", "remainingQty"], dates: ["date"] },
  deliveryRuns: {
    // profit and netProfit can be a loss, so they are not checked
    money: ["saleAmount", "costAmount", "dailyExpense", "creditAmount", "cashCollected"],
    quantity: ["totalTaken", "soldQty"],
    dates: ["date", "completedDate"],
    children: {
      lineItems: {
        money: ["price", "cost", "saleAmount", "avgPrice"],
        quantity: ["taken", "returned", "sold"],
      },
      creditBills: { money: ["total"], quantity: ["qty"] },
    },
  },
  ledger: { dates: ["date"], check: ledgerAmount },
  cashAccounts: { signed: ["opening"] },
};

const pad = (n: string) => n.padStart(2, "0");

function problemIn(rec: Rec, spec: Spec, where: string, latest: string): string | null {
  const numbers = (fields: string[] | undefined, kind: "money" | "signed" | "quantity") => {
    const max = kind === "quantity" ? MAX_QUANTITY : MAX_MONEY;
    for (const field of fields ?? []) {
      const n = numberOf(rec[field]);
      if (n === null) continue;
      if (kind !== "signed" && n < -NOISE) return `${where}${field} can't be negative (${n})`;
      if (Math.abs(n) > max) return `${where}${field} (${n}) is unrealistically large`;
    }
    return null;
  };
  const found =
    numbers(spec.money, "money") ?? numbers(spec.signed, "signed") ?? numbers(spec.quantity, "quantity");
  if (found) return found;

  for (const field of spec.dates ?? []) {
    const m = typeof rec[field] === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec((rec[field] as string).trim()) : null;
    if (!m) continue;
    const iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if (iso < EARLIEST_DATE) return `${where}${field} (${rec[field]}) is too far in the past`;
    if (iso > latest) return `${where}${field} (${rec[field]}) is too far in the future`;
  }

  const crossCheck = spec.check?.(rec);
  if (crossCheck) return `${where}${crossCheck}`;

  for (const [prop, childSpec] of Object.entries(spec.children ?? {})) {
    const list = rec[prop];
    if (!Array.isArray(list)) continue;
    for (const [i, item] of list.entries()) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const found = problemIn(item as Rec, childSpec, `${prop}[${i + 1}].`, latest);
      if (found) return found;
    }
  }
  return null;
}

// A photo or PDF of a slip is kept inside the record as a data: URL and later opened by a
// click on "View slip". Anything else (javascript:, data:text/html, svg, other sites) is
// refused, so a saved record can never carry a link that runs code or leads elsewhere.
// (The same rule is applied again when the link is shown: lib/learnex/utils.js.)
const SAFE_ATTACHMENT_URL = /^data:(image\/(png|jpe?g|gif|webp|bmp|avif|heic|heif)|application\/pdf);base64,[A-Za-z0-9+/]*={0,2}$/i;

const MAX_RECORD_CHARS = 1_000_000; // a record without its attachment (a big order is a few KB)
const MAX_ATTACHMENT_CHARS = 14_000_000; // ≈ a 10 MB photo or PDF as base64

function attachmentProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "attachment must be a file";
  const { name, dataUrl } = value as Rec;
  if (typeof dataUrl !== "string" || !SAFE_ATTACHMENT_URL.test(dataUrl))
    return "attachment must be a PNG, JPEG, GIF, WebP or PDF file";
  if (dataUrl.length > MAX_ATTACHMENT_CHARS) return "attachment is too large (10 MB at most)";
  if (name !== undefined && name !== null && (typeof name !== "string" || name.length > 255))
    return "attachment name is too long";
  return null;
}

/** What is impossible about this record of module `store`, or null when it looks fine. */
export function sanityProblem(store: string, rec: Rec, now = new Date()): string | null {
  const bad = attachmentProblem(rec.attachment);
  if (bad) return bad;
  // Without this, any account could fill the disk with junk fields on every record.
  if (JSON.stringify({ ...rec, attachment: undefined }).length > MAX_RECORD_CHARS) return "record is unrealistically large";
  const spec = SPECS[store];
  if (!spec) return null;
  const ahead = new Date(now.getTime() + DAYS_AHEAD * 86_400_000);
  return problemIn(rec, spec, "", ahead.toISOString().slice(0, 10));
}
