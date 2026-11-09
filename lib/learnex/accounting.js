import { localISO, nextSeqId, numVal, round2, todayISO } from "@/lib/learnex/utils";

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
     fixed_asset    -> NOT P&L. Cash out, a non-current asset (equipment) up.
     loan_in        -> NOT P&L. Cash in, a loan (non-current liability) up.
     loan_out       -> NOT P&L. Cash out, the loan down.

   Records saved BEFORE this upgrade carry no "kind" field, so they are
   classified from their existing category. That is how every purchase
   already sitting in the ledger is now correctly kept out of profit
   without a single stored record being changed or deleted.

   Fixed assets and loans were first filed under stock purchases, customer
   receipts and supplier payments. That put them nowhere on the Statement
   of Financial Position, so their effect was lost in the opening-balance
   line. txnKind() now reads such lines (stored kind or not) as what they
   really are — again without changing a single stored record.
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
];
export const FIXED_ASSET_CATEGORIES = ["Fixed Asset Purchase"];
export const CAPITAL_IN_CATEGORIES = ["Owner Capital", "Capital Introduced"];
export const CAPITAL_OUT_CATEGORIES = ["Owner Drawings", "Drawings"];
export const LOAN_IN_CATEGORIES = ["Loan Received"];
export const LOAN_OUT_CATEGORIES = ["Loan Repayment"];
export const TRANSFER_CATEGORIES = ["Cash Transfer"];
export const AR_COLLECTION_CATEGORIES = ["Receivable Collection"];
export const AP_SETTLEMENT_CATEGORIES = ["Supplier Payment", "Payable Settlement"];
export const COGS_CATEGORIES = ["Cost of Goods Sold", "Raw Materials Consumed"];
export const OTHER_INCOME_CATEGORIES = ["Other Income", "Refund Received", "Investment", "Interest Income"];
// Money handed back to customers (or credited to their invoice) for returned
// goods. It is a deduction from sales — not an operating cost — so it is shown
// under revenue; otherwise a fully returned sale would still report a 100%
// gross margin.
export const SALES_RETURN_CATEGORY = "Sales Returns";
export const NON_PNL_LABEL = {
  asset_purchase: "Asset purchase — Statement of Financial Position",
  fixed_asset: "Fixed asset purchase — Statement of Financial Position",
  capital_in: "Owner's capital — equity",
  capital_out: "Owner's drawings — equity",
  loan_in: "Loan received — liability, not income",
  loan_out: "Loan repaid — liability, not an expense",
  transfer: "Transfer between own accounts",
  ar_collection: "Receivable collected — no new income",
  ap_settlement: "Payable settled — no new expense",
};
export function txnKind(t) {
  if (!t) return "opex";
  const c = t.category || "";
  const stored = t.kind;
  // Lines saved before fixed assets and loans had kinds of their own were filed
  // as stock purchases, customer receipts and supplier payments. Read them as
  // what they are, so those records are corrected without being changed.
  if (FIXED_ASSET_CATEGORIES.includes(c) && (!stored || stored === "asset_purchase")) return "fixed_asset";
  if (LOAN_IN_CATEGORIES.includes(c) && (!stored || stored === "ar_collection")) return "loan_in";
  if (LOAN_OUT_CATEGORIES.includes(c) && (!stored || stored === "ap_settlement")) return "loan_out";
  if (stored) return stored;
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
    cogs = 0,
    salesReturns = 0;
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
    } else if (cat === SALES_RETURN_CATEGORY) {
      salesReturns += amt;
    } else {
      opexByCat[cat] = (opexByCat[cat] || 0) + amt;
    }
  });
  const totalOpex = Object.keys(opexByCat).reduce((s, k) => s + opexByCat[k], 0);
  // Sales returns come off sales, so gross profit and the margins are worked out
  // on what was really sold. Net profit is the same either way.
  const netRevenue = revenue - salesReturns;
  const grossProfit = netRevenue - cogs;
  const operatingProfit = grossProfit - totalOpex;
  const netProfit = operatingProfit + otherIncome;
  const totalIncome = netRevenue + otherIncome;
  return {
    revenue: round2(revenue),
    salesReturns: round2(salesReturns),
    netRevenue: round2(netRevenue),
    otherIncome: round2(otherIncome),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    totalOpex: round2(totalOpex),
    operatingProfit: round2(operatingProfit),
    netProfit: round2(netProfit),
    totalIncome: round2(totalIncome),
    grossMargin: netRevenue ? (grossProfit / netRevenue) * 100 : 0,
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
    fixed_asset: 0,
    capital_in: 0,
    capital_out: 0,
    loan_in: 0,
    loan_out: 0,
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
// Equipment and other fixed assets bought, at cost, as at a date. A purchase is
// money out of an account (an Expense line), so it adds to the asset; a refund
// (an Income line) takes from it. Depreciation is not recorded anywhere yet.
export function fixedAssetsAt(ledger, upto) {
  let cost = 0;
  (ledger || []).forEach((t) => {
    if (upto && t.date > upto) return;
    if (txnKind(t) === "fixed_asset") cost -= signOf(t) * numVal(t.amount, 0);
  });
  return round2(cost);
}
// What is still owed on loans as at a date: money received less money repaid.
export function loansAt(ledger, upto) {
  let received = 0,
    repaid = 0;
  (ledger || []).forEach((t) => {
    if (upto && t.date > upto) return;
    const k = txnKind(t);
    if (k === "loan_in") received += signOf(t) * numVal(t.amount, 0);
    if (k === "loan_out") repaid -= signOf(t) * numVal(t.amount, 0);
  });
  return { received: round2(received), repaid: round2(repaid), balance: round2(received - repaid) };
}
// Goods on a delivery run that has not been closed. They have left the shelf
// (the product's stock was already reduced) but nothing is sold until the run
// closes, so they are still the business's inventory, valued at cost.
export function stockOnDeliveryRuns(deliveryRuns, products) {
  let total = 0;
  (deliveryRuns || []).forEach((r) => {
    if (r.status !== "Ongoing") return;
    (r.lineItems || []).forEach((li) => {
      const p = (products || []).find((x) => x.id === li.productId);
      const cost = li.cost != null ? li.cost : p ? p.cost : 0;
      total += numVal(cost, 0) * numVal(li.taken, 0);
    });
  });
  return round2(total);
}
export function computeFinancialPosition(store) {
  const { ledger, cashAccounts, products, rawMaterials, salesOrders, purchaseOrders, deliveryRuns, settings } =
    store;
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
  const stockOnRuns = stockOnDeliveryRuns(deliveryRuns, products);
  const inventory = round2(finishedGoods + rawMaterialStock + stockOnRuns);
  const currentAssets = round2(cash + receivables + inventory);
  const ppe = fixedAssetsAt(ledger, asOf);
  const nonCurrentAssets = ppe;
  const totalAssets = round2(nonCurrentAssets + currentAssets);
  const payables = payablesFromPOs(purchaseOrders);
  const currentLiabilities = round2(payables);
  const loans = loansAt(ledger, asOf).balance;
  const nonCurrentLiabilities = loans;
  const totalLiabilities = round2(currentLiabilities + nonCurrentLiabilities);
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
    stockOnRuns,
    inventory,
    currentAssets,
    ppe,
    nonCurrentAssets,
    totalAssets,
    payables,
    currentLiabilities,
    loans,
    nonCurrentLiabilities,
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
/* ---- STATEMENT OF CASH FLOWS --------------------------------------- */
// Every movement through the cash and bank accounts is a ledger line, so the
// statement is built the direct way: each cash line is sorted into exactly one
// heading, and opening cash plus the net of all headings must land on the
// balances the Cash & Bank screen shows. A transfer between two own accounts
// nets to nothing, so it sits on a heading of its own.
//   operating  customers, other income, refunds, stock and supplier payments, expenses
//   investing  fixed assets bought
//   financing  owner's capital and drawings, loans received and repaid
const CASH_OPERATING = ["fromCustomers", "otherIncome", "refunds", "paidForStock", "supplierBills", "expenses"];
const CASH_INVESTING = ["fixedAssets"];
const CASH_FINANCING = ["capitalIntroduced", "drawings", "loansReceived", "loansRepaid"];

// "2026-03-01" -> "2026-02-28"
function dayBefore(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return localISO(d);
}
// The heading of the cash flow statement a cash movement belongs to.
function cashFlowHeading(t) {
  const c = t.category || "";
  switch (txnKind(t)) {
    case "revenue":
      return OTHER_INCOME_CATEGORIES.includes(c) ? "otherIncome" : "fromCustomers";
    case "ar_collection":
      return "fromCustomers";
    case "asset_purchase":
      return "paidForStock";
    case "ap_settlement":
      return "supplierBills";
    case "fixed_asset":
      return "fixedAssets";
    case "capital_in":
      return "capitalIntroduced";
    case "capital_out":
      return "drawings";
    case "loan_in":
      return "loansReceived";
    case "loan_out":
      return "loansRepaid";
    case "transfer":
      return "transfers";
    default: // cost of sales and operating expenses
      return c === SALES_RETURN_CATEGORY ? "refunds" : "expenses";
  }
}
// Money in is positive and money out negative. `to` defaults to today and
// `from` to the beginning (opening cash is then the accounts' opening balances).
export function computeCashFlow(store, from, to) {
  const { ledger, cashAccounts } = store;
  const accounts = cashAccounts || [];
  const start = from || "";
  const end = to || todayISO();
  const flow = {};
  [...CASH_OPERATING, ...CASH_INVESTING, ...CASH_FINANCING, "transfers"].forEach((k) => (flow[k] = 0));
  // Profit that did not move cash, and receipts against earlier credit sales:
  // together with the flow above they reconcile net profit to operating cash.
  let collected = 0,
    nonCashRevenue = 0,
    nonCashReturns = 0,
    nonCashCogs = 0,
    nonCashExpenses = 0;
  (ledger || []).forEach((t) => {
    if (!t.date || (start && t.date < start) || t.date > end) return;
    const amt = numVal(t.amount, 0);
    const k = txnKind(t);
    if (isCashTxn(t)) {
      flow[cashFlowHeading(t)] += signOf(t) * amt;
      if (k === "ar_collection") collected += signOf(t) * amt;
    } else if (isPnlTxn(t)) {
      if (k === "revenue") nonCashRevenue += amt;
      else if (k === "cogs") nonCashCogs += amt;
      else if (t.category === SALES_RETURN_CATEGORY) nonCashReturns += amt;
      else nonCashExpenses += amt;
    }
  });
  Object.keys(flow).forEach((k) => (flow[k] = round2(flow[k])));
  const sum = (keys) => round2(keys.reduce((s, k) => s + flow[k], 0));
  const operatingNet = sum(CASH_OPERATING);
  const investingNet = sum(CASH_INVESTING);
  const financingNet = sum(CASH_FINANCING);
  const netChange = round2(operatingNet + investingNet + financingNet + flow.transfers);
  // Opening and closing balances come from the cash accounts themselves, not
  // from the flow above — that is what makes the agreement below a real check.
  const accountRows = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    opening: start ? cashAccountBalance(a.id, ledger, accounts, dayBefore(start)) : round2(numVal(a.opening, 0)),
    closing: cashAccountBalance(a.id, ledger, accounts, end),
  }));
  const openingCash = round2(accountRows.reduce((s, r) => s + r.opening, 0));
  const balancesTotal = round2(accountRows.reduce((s, r) => s + r.closing, 0));
  const closingCash = round2(openingCash + netChange);
  // Net profit -> operating cash. Receivables fall when customers pay and rise
  // with sales on credit; inventory and supplier balances move together, so
  // stock used up, stock bought and supplier bills settled are shown as one.
  const netProfit = computePnL(ledger, start, end).netProfit;
  const receivables = round2(collected - nonCashRevenue + nonCashReturns);
  const inventoryAndPayables = round2(nonCashCogs + nonCashExpenses + flow.paidForStock + flow.supplierBills);
  const profitToCash = round2(netProfit + receivables + inventoryAndPayables);
  return {
    from: start,
    to: end,
    operating: { ...pick(flow, CASH_OPERATING), net: operatingNet },
    investing: { ...pick(flow, CASH_INVESTING), net: investingNet },
    financing: { ...pick(flow, CASH_FINANCING), net: financingNet },
    transfers: flow.transfers,
    netChange,
    openingCash,
    closingCash,
    accounts: accountRows,
    balancesTotal,
    agrees: Math.abs(closingCash - balancesTotal) < 0.005,
    reconciliation: {
      netProfit,
      receivables,
      inventoryAndPayables,
      netOperating: profitToCash,
      agrees: Math.abs(profitToCash - operatingNet) < 0.005,
    },
  };
}
function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

/* ---- STATEMENT OF CHANGES IN EQUITY -------------------------------- */
// The owner's equity rolled forward over a period, one column per part of it:
//   capital              opening capital + capital introduced - drawings
//   retained earnings    net profit to date
//   pre-system balances  the Statement of Financial Position's opening-balance
//                        line — stock, cash and balances that existed before
//                        the books began. It does not move, so it is shown at
//                        its current value on every date.
// For a period ending today the closing total is the Statement of Financial
// Position's total equity.
export function computeEquityChanges(store, from, to) {
  const { ledger, settings } = store;
  const start = from || "";
  const end = to || todayISO();
  const today = todayISO();
  const openingCapital = numVal(settings && settings.openingCapital, 0);
  const before = start ? dayBefore(start) : "";
  const eqOpen = before ? equityMovements(ledger, before) : { introduced: 0, drawings: 0 };
  const eqClose = equityMovements(ledger, end);
  const position = computeFinancialPosition({ ...store, asOf: today });
  const preSystem = position.openingBalanceEquity;
  const openRetained = before ? computePnL(ledger, "", before).netProfit : 0;
  const closeRetained = computePnL(ledger, "", end).netProfit;
  const openCapital = round2(openingCapital + eqOpen.introduced - eqOpen.drawings);
  const closeCapital = round2(openingCapital + eqClose.introduced - eqClose.drawings);
  const opening = {
    capital: openCapital,
    retained: openRetained,
    preSystem,
    total: round2(openCapital + openRetained + preSystem),
  };
  const closing = {
    capital: closeCapital,
    retained: closeRetained,
    preSystem,
    total: round2(closeCapital + closeRetained + preSystem),
  };
  return {
    from: start,
    to: end,
    opening,
    profit: round2(closeRetained - openRetained),
    introduced: round2(eqClose.introduced - eqOpen.introduced),
    drawings: round2(eqClose.drawings - eqOpen.drawings),
    closing,
    // Only a statement ending today can be held up against the position.
    agreesWithPosition: end === today ? Math.abs(closing.total - position.totalEquity) < 0.005 : null,
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
