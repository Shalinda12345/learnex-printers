// Unit tests for the accounting engine (lib/learnex/accounting.js): how each
// ledger line is classified, cash account balances, the Profit or Loss
// statement and the Statement of Financial Position.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAIN_CASH_ID,
  BANK_CASH_ID,
  NON_PNL_LABEL,
  PNL_KINDS,
  SEED_CASH_ACCOUNTS,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  txnKind,
  isPnlTxn,
  isCashTxn,
  cashAccountOf,
  signOf,
  cashAccountBalance,
  totalCash,
  cashLinesFor,
  computePnL,
  computeNonPnL,
  receivablesFromOrders,
  payablesFromPOs,
  equityMovements,
  computeFinancialPosition,
  makeCashTxn,
  nextTxnId,
  transferEntries,
  withDefaultAccounts,
} from "@/lib/learnex/accounting";
import { todayISO } from "@/lib/learnex/utils";

const ACCOUNTS = [
  { id: MAIN_CASH_ID, name: "Cash Account", type: "Cash", opening: 1000 },
  { id: BANK_CASH_ID, name: "Bank Account", type: "Bank", opening: 0 },
];

// One line of every kind. Lines without `kind` are classified from their
// category, exactly like records saved before the accounting upgrade.
const LEDGER = [
  {
    id: "TXN-1",
    date: "2026-01-05",
    type: "Income",
    category: "Sales",
    amount: 1000,
    account: MAIN_CASH_ID,
    kind: "revenue",
  },
  {
    id: "TXN-2",
    date: "2026-01-05",
    type: "Expense",
    category: "Cost of Goods Sold",
    amount: 600,
    kind: "cogs",
    cash: false,
  },
  { id: "TXN-3", date: "2026-01-10", type: "Expense", category: "Rent", amount: 150, account: BANK_CASH_ID },
  {
    id: "TXN-4",
    date: "2026-01-12",
    type: "Income",
    category: "Interest Income",
    amount: 20,
    account: BANK_CASH_ID,
  },
  {
    id: "TXN-5",
    date: "2026-02-01",
    type: "Expense",
    category: "Stock & Raw Material Purchase",
    amount: 300,
  },
  {
    id: "TXN-6",
    date: "2026-02-02",
    type: "Income",
    category: "Owner Capital",
    amount: 5000,
    account: BANK_CASH_ID,
  },
  { id: "TXN-7", date: "2026-02-03", type: "Expense", category: "Owner Drawings", amount: 200 },
  {
    id: "TXN-8",
    date: "2026-02-04",
    type: "Expense",
    category: "Cash Transfer",
    amount: 100,
    account: BANK_CASH_ID,
    kind: "transfer",
  },
  {
    id: "TXN-9",
    date: "2026-02-04",
    type: "Income",
    category: "Cash Transfer",
    amount: 100,
    account: MAIN_CASH_ID,
    kind: "transfer",
  },
  { id: "TXN-10", date: "2026-02-05", type: "Income", category: "Receivable Collection", amount: 50 },
  {
    id: "TXN-11",
    date: "2026-02-06",
    type: "Expense",
    category: "Supplier Payment",
    amount: 80,
    account: BANK_CASH_ID,
  },
  {
    id: "TXN-12",
    date: "2026-02-07",
    type: "Income",
    category: "Sales",
    amount: 400,
    kind: "revenue",
    cash: false,
  },
];

describe("classifying ledger lines", () => {
  test("ACCT-1 a stored kind always wins over the category", () => {
    assert.equal(txnKind({ type: "Income", category: "Owner Capital", kind: "revenue" }), "revenue");
  });

  test("ACCT-2 lines without a kind are classified from their category", () => {
    const cases = {
      "Stock & Raw Material Purchase": "asset_purchase",
      "Raw Materials": "asset_purchase",
      Inventory: "asset_purchase",
      "Stock Purchase": "asset_purchase",
      "Raw Material Purchase": "asset_purchase",
      "Fixed Asset Purchase": "asset_purchase",
      "Owner Capital": "capital_in",
      "Capital Introduced": "capital_in",
      "Owner Drawings": "capital_out",
      Drawings: "capital_out",
      "Cash Transfer": "transfer",
      "Receivable Collection": "ar_collection",
      "Loan Received": "ar_collection",
      "Supplier Payment": "ap_settlement",
      "Payable Settlement": "ap_settlement",
      "Loan Repayment": "ap_settlement",
      "Cost of Goods Sold": "cogs",
      "Raw Materials Consumed": "cogs",
    };
    for (const [category, kind] of Object.entries(cases)) {
      assert.equal(txnKind({ type: "Expense", category }), kind, category);
    }
  });

  test("ACCT-3 any other income is revenue and any other expense is an operating expense", () => {
    assert.equal(txnKind({ type: "Income", category: "Sales" }), "revenue");
    assert.equal(txnKind({ type: "Income", category: "Something new" }), "revenue");
    assert.equal(txnKind({ type: "Expense", category: "Rent" }), "opex");
    assert.equal(txnKind({ type: "Expense" }), "opex");
    assert.equal(txnKind(null), "opex");
  });

  test("ACCT-4 only revenue, cost of sales and operating expenses reach profit", () => {
    assert.deepEqual(PNL_KINDS, ["revenue", "cogs", "opex"]);
    assert.equal(isPnlTxn({ type: "Income", category: "Sales" }), true);
    assert.equal(isPnlTxn({ type: "Expense", category: "Cost of Goods Sold" }), true);
    assert.equal(isPnlTxn({ type: "Expense", category: "Rent" }), true);
    for (const category of [
      "Stock & Raw Material Purchase",
      "Owner Capital",
      "Owner Drawings",
      "Cash Transfer",
      "Supplier Payment",
    ]) {
      assert.equal(isPnlTxn({ type: "Expense", category }), false, category);
    }
  });

  test("ACCT-5 every non-profit kind has a label explaining where it goes", () => {
    for (const kind of [
      "asset_purchase",
      "capital_in",
      "capital_out",
      "transfer",
      "ar_collection",
      "ap_settlement",
    ]) {
      assert.ok(NON_PNL_LABEL[kind], kind);
    }
  });

  test("ACCT-6 cost of goods sold moves no cash unless a line says otherwise", () => {
    assert.equal(isCashTxn({ type: "Expense", category: "Cost of Goods Sold" }), false);
    assert.equal(isCashTxn({ type: "Expense", category: "Cost of Goods Sold", cash: true }), true);
    assert.equal(isCashTxn({ type: "Income", category: "Sales", cash: false }), false);
    assert.equal(isCashTxn({ type: "Expense", category: "Rent" }), true);
    assert.equal(isCashTxn(null), false);
  });

  test("ACCT-7 a line without an account belongs to the Cash Account; income adds, expenses subtract", () => {
    assert.equal(cashAccountOf({}), MAIN_CASH_ID);
    assert.equal(cashAccountOf({ account: BANK_CASH_ID }), BANK_CASH_ID);
    assert.equal(signOf({ type: "Income" }), 1);
    assert.equal(signOf({ type: "Expense" }), -1);
  });

  test("ACCT-8 every category offered in the ledger form is classified as intended", () => {
    assert.ok(INCOME_CATEGORIES.includes("Sales") && EXPENSE_CATEGORIES.includes("Rent"));
    assert.equal(txnKind({ type: "Income", category: "Owner Capital" }), "capital_in");
    assert.equal(txnKind({ type: "Expense", category: "Fixed Asset Purchase" }), "asset_purchase");
  });
});

describe("cash account balances", () => {
  test("ACCT-9 balance = opening + money in − money out, skipping non-cash lines and other accounts", () => {
    // Cash: 1000 opening + 1000 sale − 300 purchase − 200 drawings + 100 transfer in + 50 collection
    assert.equal(cashAccountBalance(MAIN_CASH_ID, LEDGER, ACCOUNTS), 1650);
    // Bank: −150 rent + 20 interest + 5000 capital − 100 transfer out − 80 supplier payment
    assert.equal(cashAccountBalance(BANK_CASH_ID, LEDGER, ACCOUNTS), 4690);
    assert.equal(totalCash(LEDGER, ACCOUNTS), 6340);
  });

  test("ACCT-10 a balance can be taken as at a date", () => {
    assert.equal(cashAccountBalance(MAIN_CASH_ID, LEDGER, ACCOUNTS, "2026-01-31"), 2000);
    assert.equal(cashAccountBalance(BANK_CASH_ID, LEDGER, ACCOUNTS, "2026-01-31"), -130);
    assert.equal(totalCash(LEDGER, ACCOUNTS, "2026-01-31"), 1870);
  });

  test("ACCT-11 an unknown account has no opening balance; text openings are read as numbers", () => {
    assert.equal(cashAccountBalance("NOPE", LEDGER, ACCOUNTS), 0);
    assert.equal(cashAccountBalance("X", [], [{ id: "X", opening: "250.5" }]), 250.5);
    assert.equal(totalCash([], []), 0);
  });

  test("ACCT-12 the cash book lists cash lines newest first, by account and date range", () => {
    const all = cashLinesFor(LEDGER, "All", "", "");
    assert.equal(all.length, 10, "the two non-cash lines are left out");
    assert.ok(!all.some((t) => t.id === "TXN-2" || t.id === "TXN-12"));
    assert.deepEqual(
      all.map((t) => t.date),
      [...all.map((t) => t.date)].sort().reverse(),
    );
    assert.deepEqual(
      cashLinesFor(LEDGER, BANK_CASH_ID, "2026-02-01", "2026-02-28").map((t) => t.id),
      ["TXN-11", "TXN-8", "TXN-6"],
    );
    assert.equal(cashLinesFor(LEDGER, "", "", "").length, 10, "no account filter = all accounts");
  });
});

describe("Profit or Loss statement", () => {
  test("ACCT-13 revenue, cost of sales, operating expenses and other income add up to net profit", () => {
    const p = computePnL(LEDGER, "", "");
    assert.equal(p.revenue, 1400); // two sales, one of them on credit
    assert.equal(p.otherIncome, 20);
    assert.equal(p.cogs, 600);
    assert.equal(p.grossProfit, 800);
    assert.equal(p.totalOpex, 150);
    assert.equal(p.operatingProfit, 650);
    assert.equal(p.netProfit, 670);
    assert.equal(p.totalIncome, 1420);
    assert.ok(Math.abs(p.grossMargin - (800 / 1400) * 100) < 1e-9);
    assert.ok(Math.abs(p.netMargin - (670 / 1420) * 100) < 1e-9);
    assert.deepEqual(p.revenueByCat, { Sales: 1400 });
    assert.deepEqual(p.otherIncomeByCat, { "Interest Income": 20 });
    assert.deepEqual(p.cogsByCat, { "Cost of Goods Sold": 600 });
    assert.deepEqual(p.opexByCat, { Rent: 150 });
    assert.equal(p.lines.length, 5);
  });

  test("ACCT-14 purchases, capital, drawings, transfers, collections and supplier payments never touch profit", () => {
    const ex = computeNonPnL(LEDGER, "", "");
    assert.deepEqual(
      { ...ex, lines: ex.lines.length },
      {
        asset_purchase: 300,
        capital_in: 5000,
        capital_out: 200,
        transfer: 200,
        ar_collection: 50,
        ap_settlement: 80,
        lines: 7,
      },
    );
  });

  test("ACCT-15 a date range limits both statements; lines without a date are never counted", () => {
    const jan = computePnL(LEDGER, "2026-01-01", "2026-01-31");
    assert.deepEqual(
      [jan.revenue, jan.otherIncome, jan.cogs, jan.totalOpex, jan.netProfit],
      [1000, 20, 600, 150, 270],
    );
    assert.equal(computeNonPnL(LEDGER, "2026-01-01", "2026-01-31").lines.length, 0);
    const undated = computePnL([{ id: "X", type: "Income", category: "Sales", amount: 99 }], "", "");
    assert.equal(undated.revenue, 0);
  });

  test("ACCT-16 an empty ledger gives zero margins instead of dividing by zero", () => {
    const p = computePnL([], "", "");
    assert.deepEqual([p.netProfit, p.grossMargin, p.netMargin], [0, 0, 0]);
  });

  test("ACCT-17 amounts typed as text are summed as numbers, and cents are rounded", () => {
    const p = computePnL(
      [
        { id: "A", date: "2026-01-01", type: "Income", category: "Sales", amount: "0.1" },
        { id: "B", date: "2026-01-01", type: "Income", category: "Sales", amount: 0.2 },
      ],
      "",
      "",
    );
    assert.equal(p.revenue, 0.3);
  });
});

describe("Statement of Financial Position", () => {
  const orders = [
    { amount: 100, amountPaid: 30 },
    { amount: 50, status: "Cancelled" },
    { amount: 70, payment: "Paid" },
    { amount: 60, payment: "Refunded" },
    { amount: 40 },
    { amount: 10, amountPaid: 20 },
  ];
  const pos = [
    { paymentStatus: "Unpaid", total: 500, amountPaid: 100 },
    { paymentStatus: "Paid", total: 300 },
    { total: 200 },
    { paymentStatus: "Unpaid", total: 50 },
  ];

  test("ACCT-18 receivables: unpaid balances only (cancelled, paid and refunded orders owe nothing)", () => {
    assert.equal(receivablesFromOrders(orders), 110);
    assert.equal(receivablesFromOrders(undefined), 0);
  });

  test("ACCT-19 payables: only purchase orders explicitly recorded as unpaid", () => {
    assert.equal(payablesFromPOs(pos), 450);
    assert.equal(payablesFromPOs([]), 0);
  });

  test("ACCT-20 capital introduced and drawings, optionally up to a date", () => {
    assert.deepEqual(equityMovements(LEDGER), { introduced: 5000, drawings: 200 });
    assert.deepEqual(equityMovements(LEDGER, "2026-02-02"), { introduced: 5000, drawings: 0 });
  });

  test("ACCT-21 assets, liabilities and equity are computed and the statement balances", () => {
    const s = computeFinancialPosition({
      ledger: LEDGER,
      cashAccounts: ACCOUNTS,
      products: [
        { cost: 10, stock: 5 },
        { cost: "2.5", stock: 4 },
      ],
      rawMaterials: [{ costPrice: 3, availableQty: 10 }],
      salesOrders: orders,
      purchaseOrders: pos,
      settings: { openingCapital: 1000 },
      asOf: "2026-12-31",
    });
    assert.deepEqual(
      s.cashRows.map((r) => [r.id, r.balance]),
      [
        [MAIN_CASH_ID, 1650],
        [BANK_CASH_ID, 4690],
      ],
    );
    assert.equal(s.cash, 6340);
    assert.equal(s.receivables, 110);
    assert.equal(s.finishedGoods, 60);
    assert.equal(s.rawMaterialStock, 30);
    assert.equal(s.inventory, 90);
    assert.equal(s.totalAssets, 6540);
    assert.equal(s.payables, 450);
    assert.equal(s.totalLiabilities, 450);
    assert.equal(s.capital, 5800); // 1000 opening + 5000 introduced − 200 drawings
    assert.equal(s.retained, 670); // net profit to date
    assert.equal(s.openingBalanceEquity, -380);
    assert.equal(s.totalEquity, 6090);
    assert.equal(s.totalLiabilitiesAndEquity, 6540);
    assert.equal(s.balanced, true);
  });

  test("ACCT-22 without a date the statement is as at today", () => {
    const s = computeFinancialPosition({ ledger: [], cashAccounts: SEED_CASH_ACCOUNTS, settings: {} });
    assert.equal(s.asOf, todayISO());
    assert.equal(s.totalAssets, 0);
  });
});

describe("posting a cash movement", () => {
  test("ACCT-23 makeCashTxn numbers the line after the highest TXN id and fills defaults", () => {
    const t = makeCashTxn({
      ledger: LEDGER,
      desc: "Rent",
      type: "Expense",
      category: "Rent",
      amount: 99.999,
    });
    assert.equal(t.id, "TXN-13");
    assert.equal(t.date, todayISO());
    assert.equal(t.amount, 100);
    assert.equal(t.account, null);
    assert.equal(t.kind, undefined);
    assert.equal(t.cash, undefined);
    assert.equal(t.attachment, null);
  });

  test("ACCT-24 the first ledger line is TXN-8822; given values are kept", () => {
    const t = makeCashTxn({
      ledger: [],
      date: "2026-03-01",
      desc: "Capital",
      type: "Income",
      category: "Owner Capital",
      amount: 10,
      account: BANK_CASH_ID,
      kind: "capital_in",
      cash: true,
    });
    assert.deepEqual(t, {
      id: "TXN-8822",
      date: "2026-03-01",
      desc: "Capital",
      type: "Income",
      category: "Owner Capital",
      amount: 10,
      account: BANK_CASH_ID,
      kind: "capital_in",
      cash: true,
      attachment: null,
    });
  });
});

describe("moving money between own accounts", () => {
  test("ACCT-25 a transfer is a line out of one account and a line into the other, under the next ids", () => {
    const [out, inn] = transferEntries({
      ledger: LEDGER,
      date: "2026-03-02",
      desc: "Top-up",
      amount: 50.005,
      from: MAIN_CASH_ID,
      to: BANK_CASH_ID,
    });
    assert.equal(out.id, nextTxnId(LEDGER));
    assert.equal(inn.id, nextTxnId([...LEDGER, out]));
    assert.deepEqual(
      [out.type, out.account, inn.type, inn.account],
      ["Expense", MAIN_CASH_ID, "Income", BANK_CASH_ID],
    );
    for (const t of [out, inn]) {
      assert.equal(t.category, "Cash Transfer");
      assert.equal(t.kind, "transfer");
      assert.equal(t.amount, 50.01);
      assert.equal(t.attachment, null);
      assert.equal(isPnlTxn(t), false, "a transfer never touches profit");
    }
    const after = [...LEDGER, out, inn];
    assert.equal(totalCash(after, ACCOUNTS), totalCash(LEDGER, ACCOUNTS), "total cash is unchanged");
  });

  test("ACCT-26 the built-in accounts stand in until the user's accounts are loaded", () => {
    assert.equal(withDefaultAccounts(undefined), SEED_CASH_ACCOUNTS);
    assert.equal(withDefaultAccounts([]), SEED_CASH_ACCOUNTS);
    assert.equal(withDefaultAccounts(ACCOUNTS), ACCOUNTS);
  });
});
