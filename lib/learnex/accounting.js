import { nextSeqId, numVal, round2, todayISO } from "@/lib/learnex/utils";

/* =====================================================================
   FINANCIAL CORE  (added in the accounting upgrade)
   ---------------------------------------------------------------------
   A real ERP never treats the purchase of stock or raw materials as an
   expense. Buying materials only swaps one asset (cash) for another
   asset (inventory), so it must NEVER touch the Profit or Loss
   statement. It is recorded as:
        money OUT of a Cash Account   +   inventory value UP
   Consuming a raw material is likewise NOT an expense — it is an
   internal stock movement that only relocates value inside inventory.
   Materials become an expense at one point only: when the finished
   goods are sold (Cost of Goods Sold). That is what makes profit
   meaningful, and it is how a real ERP behaves.

   "Raw Materials Consumed" is kept in the COGS category list purely so
   that entries already recorded under it stay classified exactly as
   they were. No new entry is ever created under it.

   Every ledger line is classified into one of these kinds:
     revenue        -> P&L income
     cogs           -> P&L cost of sales (non-cash, relieves inventory)
     opex           -> P&L operating expense
     asset_purchase -> NOT P&L. Cash out, inventory/asset up.
     capital_in     -> NOT P&L. Owner puts money in (equity).
     capital_out    -> NOT P&L. Owner drawings (equity).
     transfer       -> NOT P&L. Cash moved between our own accounts.
     ar_collection  -> NOT P&L. Customer pays an invoice already booked.
     ap_settlement  -> NOT P&L. We pay a supplier bill already booked.

   Records saved BEFORE this upgrade carry no "kind" field, so they are
   classified from their existing category. That is how every purchase
   already sitting in the ledger is now correctly kept out of profit
   without a single stored record being changed or deleted.
===================================================================== */
// Kept only so that purchases recorded before this account was retired can be
// moved onto the ordinary Cash Account. Nothing posts to it any more.
export const LEGACY_PURCHASES_CASH_ID = "CASH-PUR";
export const MAIN_CASH_ID = "CASH-MAIN";
export const BANK_CASH_ID = "BANK-MAIN";
export const SEED_CASH_ACCOUNTS = [
  {
    id: MAIN_CASH_ID,
    name: "Cash Account",
    type: "Cash",
    opening: 0,
    purpose: "general",
    system: true,
    notes: "Day-to-day cash: sales receipts, operating expenses, and purchases of stock and raw materials.",
  },
  {
    id: BANK_CASH_ID,
    name: "Bank Account",
    type: "Bank",
    opening: 0,
    purpose: "general",
    system: true,
    notes: "Bank balance. Use transfers to move money to or from cash.",
  },
];
// The user's cash accounts, or the built-in ones before any are loaded.
export const withDefaultAccounts = (cashAccounts) =>
  cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
export const CASH_ACCOUNT_TYPES = ["Cash", "Bank", "Mobile Wallet", "Petty Cash"];
/* ---- category groups that drive the classification ---------------- */
export const ASSET_PURCHASE_CATEGORIES = [
  "Stock & Raw Material Purchase",
  "Raw Materials",
  "Inventory",
  "Stock Purchase",
  "Raw Material Purchase",
  "Fixed Asset Purchase",
];
export const CAPITAL_IN_CATEGORIES = ["Owner Capital", "Capital Introduced"];
export const CAPITAL_OUT_CATEGORIES = ["Owner Drawings", "Drawings"];
export const TRANSFER_CATEGORIES = ["Cash Transfer"];
export const AR_COLLECTION_CATEGORIES = ["Receivable Collection", "Loan Received"];
export const AP_SETTLEMENT_CATEGORIES = ["Supplier Payment", "Payable Settlement", "Loan Repayment"];
export const COGS_CATEGORIES = ["Cost of Goods Sold", "Raw Materials Consumed"];
export const OTHER_INCOME_CATEGORIES = ["Other Income", "Refund Received", "Investment", "Interest Income"];
export const NON_PNL_LABEL = {
  asset_purchase: "Asset purchase — Statement of Financial Position",
  capital_in: "Owner's capital — equity",
  capital_out: "Owner's drawings — equity",
  transfer: "Transfer between own accounts",
  ar_collection: "Receivable collected — no new income",
  ap_settlement: "Payable settled — no new expense",
};
export function txnKind(t) {
  if (!t) return "opex";
  if (t.kind) return t.kind;
  const c = t.category || "";
  if (ASSET_PURCHASE_CATEGORIES.includes(c)) return "asset_purchase";
  if (CAPITAL_IN_CATEGORIES.includes(c)) return "capital_in";
  if (CAPITAL_OUT_CATEGORIES.includes(c)) return "capital_out";
  if (TRANSFER_CATEGORIES.includes(c)) return "transfer";
  if (AR_COLLECTION_CATEGORIES.includes(c)) return "ar_collection";
  if (AP_SETTLEMENT_CATEGORIES.includes(c)) return "ap_settlement";
  if (COGS_CATEGORIES.includes(c)) return "cogs";
  return t.type === "Income" ? "revenue" : "opex";
}
export const PNL_KINDS = ["revenue", "cogs", "opex"];
export function isPnlTxn(t) {
  return PNL_KINDS.includes(txnKind(t));
}
// Cost of goods sold and material consumption relieve inventory — no cash moves.
export function isCashTxn(t) {
  if (!t) return false;
  if (t.cash === false) return false;
  if (t.cash === true) return true;
  return txnKind(t) !== "cogs";
}
// Which cash account a line belongs to. Lines saved before cash accounts
// existed carry no account and belong to the main Cash Account.
export function cashAccountOf(t) {
  if (t && t.account) return t.account;
  return MAIN_CASH_ID;
}
export function signOf(t) {
  return t.type === "Income" ? 1 : -1;
}
export function cashAccountBalance(accId, ledger, cashAccounts, upto) {
  const acc = (cashAccounts || []).find((a) => a.id === accId);
  let bal = acc ? numVal(acc.opening, 0) : 0;
  (ledger || []).forEach((t) => {
    if (!isCashTxn(t)) return;
    if (cashAccountOf(t) !== accId) return;
    if (upto && t.date > upto) return;
    bal += signOf(t) * numVal(t.amount, 0);
  });
  return round2(bal);
}
export function totalCash(ledger, cashAccounts, upto) {
  return round2(
    (cashAccounts || []).reduce((s, a) => s + cashAccountBalance(a.id, ledger, cashAccounts, upto), 0),
  );
}
export function cashLinesFor(ledger, accId, from, to) {
  return (ledger || [])
    .filter(
      (t) =>
        isCashTxn(t) &&
        (!accId || accId === "All" || cashAccountOf(t) === accId) &&
        (!from || t.date >= from) &&
        (!to || t.date <= to),
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}
/* ---- PROFIT OR LOSS ------------------------------------------------ */
export function computePnL(ledger, from, to) {
  const inR = (d) => !!d && (!from || d >= from) && (!to || d <= to);
  const lines = (ledger || []).filter((t) => inR(t.date) && isPnlTxn(t));
  let revenue = 0,
    otherIncome = 0,
    cogs = 0;
  const revenueByCat = {},
    cogsByCat = {},
    opexByCat = {},
    otherIncomeByCat = {};
  lines.forEach((t) => {
    const amt = numVal(t.amount, 0);
    const k = txnKind(t);
    const cat = t.category || "Uncategorised";
    if (k === "revenue") {
      if (OTHER_INCOME_CATEGORIES.includes(cat)) {
        otherIncome += amt;
        otherIncomeByCat[cat] = (otherIncomeByCat[cat] || 0) + amt;
      } else {
        revenue += amt;
        revenueByCat[cat] = (revenueByCat[cat] || 0) + amt;
      }
    } else if (k === "cogs") {
      cogs += amt;
      cogsByCat[cat] = (cogsByCat[cat] || 0) + amt;
    } else {
      opexByCat[cat] = (opexByCat[cat] || 0) + amt;
    }
  });
  const totalOpex = Object.keys(opexByCat).reduce((s, k) => s + opexByCat[k], 0);
  const grossProfit = revenue - cogs;
  const operatingProfit = grossProfit - totalOpex;
  const netProfit = operatingProfit + otherIncome;
  const totalIncome = revenue + otherIncome;
  return {
    revenue: round2(revenue),
    otherIncome: round2(otherIncome),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    totalOpex: round2(totalOpex),
    operatingProfit: round2(operatingProfit),
    netProfit: round2(netProfit),
    totalIncome: round2(totalIncome),
    grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    netMargin: totalIncome ? (netProfit / totalIncome) * 100 : 0,
    revenueByCat,
    otherIncomeByCat,
    cogsByCat,
    opexByCat,
    lines,
  };
}
// Everything in the period that deliberately stays OUT of the P&L.
export function computeNonPnL(ledger, from, to) {
  const inR = (d) => !!d && (!from || d >= from) && (!to || d <= to);
  const out = {
    asset_purchase: 0,
    capital_in: 0,
    capital_out: 0,
    transfer: 0,
    ar_collection: 0,
    ap_settlement: 0,
    lines: [],
  };
  (ledger || []).forEach((t) => {
    if (!inR(t.date) || isPnlTxn(t)) return;
    const k = txnKind(t);
    out[k] = round2((out[k] || 0) + numVal(t.amount, 0));
    out.lines.push(t);
  });
  return out;
}
/* ---- STATEMENT OF FINANCIAL POSITION ------------------------------- */
export function receivablesFromOrders(salesOrders) {
  return round2(
    (salesOrders || []).reduce((s, o) => {
      if (o.status === "Cancelled" || o.payment === "Paid" || o.payment === "Refunded") return s;
      return s + Math.max(0, numVal(o.amount, 0) - numVal(o.amountPaid, 0));
    }, 0),
  );
}
export function payablesFromPOs(purchaseOrders) {
  // Purchase orders saved before this upgrade carry no paymentStatus and were
  // already paid in cash, so only explicitly unpaid orders become payables.
  return round2(
    (purchaseOrders || []).reduce((s, o) => {
      if (o.paymentStatus !== "Unpaid") return s;
      return s + Math.max(0, numVal(o.total, 0) - numVal(o.amountPaid, 0));
    }, 0),
  );
}
export function equityMovements(ledger, upto) {
  let inn = 0,
    out = 0;
  (ledger || []).forEach((t) => {
    if (upto && t.date > upto) return;
    const k = txnKind(t);
    if (k === "capital_in") inn += numVal(t.amount, 0);
    if (k === "capital_out") out += numVal(t.amount, 0);
  });
  return { introduced: round2(inn), drawings: round2(out) };
}
export function computeFinancialPosition(store) {
  const { ledger, cashAccounts, products, rawMaterials, salesOrders, purchaseOrders, settings } = store;
  const asOf = store.asOf || todayISO();
  const cashRows = (cashAccounts || []).map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: cashAccountBalance(a.id, ledger, cashAccounts, asOf),
  }));
  const cash = round2(cashRows.reduce((s, r) => s + r.balance, 0));
  const receivables = receivablesFromOrders(salesOrders);
  const finishedGoods = round2(
    (products || []).reduce((s, p) => s + numVal(p.cost, 0) * numVal(p.stock, 0), 0),
  );
  const rawMaterialStock = round2(
    (rawMaterials || []).reduce((s, m) => s + numVal(m.costPrice, 0) * numVal(m.availableQty, 0), 0),
  );
  const inventory = round2(finishedGoods + rawMaterialStock);
  const totalAssets = round2(cash + receivables + inventory);
  const payables = payablesFromPOs(purchaseOrders);
  const totalLiabilities = round2(payables);
  const eq = equityMovements(ledger, asOf);
  const openingCapital = numVal(settings && settings.openingCapital, 0);
  const capital = round2(openingCapital + eq.introduced - eq.drawings);
  const retained = computePnL(ledger, "", asOf).netProfit;
  // The system was already in use before double-entry accounting was added, and
  // stock/cash balances existed before then. This line carries those opening
  // balances so the statement always balances — exactly how an accountant
  // handles a mid-year migration into a new system.
  const openingBalanceEquity = round2(totalAssets - totalLiabilities - capital - retained);
  const totalEquity = round2(capital + retained + openingBalanceEquity);
  return {
    asOf,
    cashRows,
    cash,
    receivables,
    finishedGoods,
    rawMaterialStock,
    inventory,
    totalAssets,
    payables,
    totalLiabilities,
    openingCapital,
    capitalIntroduced: eq.introduced,
    drawings: eq.drawings,
    capital,
    retained,
    openingBalanceEquity,
    totalEquity,
    totalLiabilitiesAndEquity: round2(totalLiabilities + totalEquity),
    balanced: Math.abs(round2(totalAssets - (totalLiabilities + totalEquity))) < 0.01,
  };
}
/* ---- building new ledger lines -------------------------------------- */
// The next ledger id after every line in `ledger` (pass the lines being added
// in the same change too, so they don't get the same number).
export const nextTxnId = (ledger) => nextSeqId(ledger || [], "id", "TXN-", 8821);
export function makeCashTxn({ ledger, date, desc, type, category, amount, account, kind, attachment, cash }) {
  return {
    id: nextTxnId(ledger),
    date: date || todayISO(),
    desc,
    type,
    category,
    amount: round2(amount),
    account: account || null,
    kind: kind || undefined,
    cash,
    attachment: attachment || null,
  };
}
// Moving money between our own accounts: a line out of one and a line into
// the other. Profit is unaffected. Returns [out, in].
export function transferEntries({ ledger, date, desc, amount, from, to, attachment = null }) {
  const line = (id, type, account) => ({
    id,
    date: date || todayISO(),
    desc,
    type,
    category: "Cash Transfer",
    amount: round2(amount),
    account,
    kind: "transfer",
    attachment,
  });
  const out = line(nextTxnId(ledger), "Expense", from);
  return [out, line(nextTxnId([...(ledger || []), out]), "Income", to)];
}

/* Categories offered when recording a ledger entry by hand. The purchase and
   equity categories are listed too, so a manual entry can be classified
   correctly instead of being forced into "expense". */
export const INCOME_CATEGORIES = [
  "Sales",
  "Other Income",
  "Refund Received",
  "Interest Income",
  "Owner Capital",
  "Loan Received",
  "Receivable Collection",
];
export const EXPENSE_CATEGORIES = [
  "Payroll",
  "Rent",
  "Utilities",
  "Marketing",
  "Transport",
  "Maintenance",
  "Daily Expense",
  "Cost of Goods Sold",
  "Raw Materials Consumed",
  "Other",
  "Stock & Raw Material Purchase",
  "Fixed Asset Purchase",
  "Owner Drawings",
  "Supplier Payment",
  "Loan Repayment",
];
