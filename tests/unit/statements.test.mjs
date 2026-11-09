// Unit tests for the Statement of Cash Flows, the Statement of Changes in
// Equity and the corrections made to the Profit or Loss statement and the
// Statement of Financial Position (fixed assets, loans, stock out on delivery
// runs, sales returns). Expected figures are worked out by hand from the
// ledger lines in each test.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BANK_CASH_ID,
  MAIN_CASH_ID,
  computeCashFlow,
  computeEquityChanges,
  computeFinancialPosition,
  computeNonPnL,
  computePnL,
  fixedAssetsAt,
  isPnlTxn,
  loansAt,
  stockOnDeliveryRuns,
  totalCash,
  txnKind,
} from "@/lib/learnex/accounting";
import { EQUITY_COLUMNS, cashFlowRows, equityRows, pnlRows, positionRows } from "@/lib/learnex/statements";
import { round2 } from "@/lib/learnex/utils";

const ACCOUNTS = [
  { id: MAIN_CASH_ID, name: "Cash Account", type: "Cash", opening: 1000 },
  { id: BANK_CASH_ID, name: "Bank Account", type: "Bank", opening: 0 },
];
const M = MAIN_CASH_ID,
  B = BANK_CASH_ID;
let seq = 0;
const line = (o) => ({ id: "T" + ++seq, ...o });

/* ============================ fixed assets and loans ============================ */

describe("fixed assets and loans", () => {
  test("STMT-1 lines filed under the old kinds are read as what they really are", () => {
    // The version before this one filed them as stock purchases, receipts and supplier payments.
    assert.equal(
      txnKind({ type: "Expense", category: "Fixed Asset Purchase", kind: "asset_purchase" }),
      "fixed_asset",
    );
    assert.equal(txnKind({ type: "Income", category: "Loan Received", kind: "ar_collection" }), "loan_in");
    assert.equal(txnKind({ type: "Expense", category: "Loan Repayment", kind: "ap_settlement" }), "loan_out");
    // a kind chosen on purpose for any other reason still wins
    assert.equal(txnKind({ type: "Income", category: "Loan Received", kind: "revenue" }), "revenue");
    assert.equal(txnKind({ type: "Expense", category: "Rent", kind: "opex" }), "opex");
    for (const category of ["Fixed Asset Purchase", "Loan Received", "Loan Repayment"]) {
      assert.equal(isPnlTxn({ type: "Expense", category }), false, `${category} never reaches profit`);
    }
  });

  test("STMT-2 fixed assets are the cost of what was bought; loans are money received less money repaid", () => {
    const ledger = [
      line({ date: "2025-01-05", type: "Expense", category: "Fixed Asset Purchase", amount: 2500, account: B }),
      line({ date: "2025-02-05", type: "Expense", category: "Fixed Asset Purchase", amount: 700 }),
      line({ date: "2025-03-01", type: "Income", category: "Loan Received", amount: 3000, account: B }),
      line({ date: "2025-04-01", type: "Expense", category: "Loan Repayment", amount: 500, account: B }),
    ];
    assert.equal(fixedAssetsAt(ledger), 3200);
    assert.equal(fixedAssetsAt(ledger, "2025-01-31"), 2500, "as at a date");
    assert.deepEqual(loansAt(ledger), { received: 3000, repaid: 500, balance: 2500 });
    assert.deepEqual(loansAt(ledger, "2025-03-31"), { received: 3000, repaid: 0, balance: 3000 });
    assert.equal(fixedAssetsAt([]), 0);
    assert.deepEqual(loansAt(undefined), { received: 0, repaid: 0, balance: 0 });
  });

  test("STMT-3 the position shows non-current assets and liabilities; equity does not move", () => {
    const base = {
      ledger: [],
      cashAccounts: ACCOUNTS,
      products: [{ cost: 10, stock: 5 }],
      settings: { openingCapital: 0 },
      asOf: "2025-12-31",
    };
    const before = computeFinancialPosition(base);
    assert.equal(before.ppe, 0);
    assert.equal(before.loans, 0);
    // equipment 2,500 paid from the bank, a 3,000 loan received, 500 of it repaid
    const ledger = [
      line({ date: "2025-01-05", type: "Income", category: "Loan Received", amount: 3000, account: B }),
      line({ date: "2025-01-06", type: "Expense", category: "Fixed Asset Purchase", amount: 2500, account: B }),
      line({ date: "2025-02-01", type: "Expense", category: "Loan Repayment", amount: 500, account: B }),
    ];
    const after = computeFinancialPosition({ ...base, ledger });
    assert.equal(after.ppe, 2500);
    assert.equal(after.nonCurrentAssets, 2500);
    assert.equal(after.loans, 2500);
    assert.equal(after.nonCurrentLiabilities, 2500);
    assert.equal(after.cash, before.cash + 3000 - 2500 - 500);
    assert.equal(after.currentAssets, round2(after.cash + after.receivables + after.inventory));
    assert.equal(after.totalAssets, round2(after.nonCurrentAssets + after.currentAssets));
    assert.equal(after.totalLiabilities, round2(after.currentLiabilities + after.nonCurrentLiabilities));
    assert.equal(
      after.openingBalanceEquity,
      before.openingBalanceEquity,
      "buying equipment and borrowing change assets and liabilities, not the opening-balance line",
    );
    assert.equal(after.totalEquity, before.totalEquity);
    assert.equal(after.balanced, true);
  });

  test("STMT-4 equipment and loans are kept out of the profit and shown on their own lines", () => {
    const ledger = [
      line({ date: "2025-01-06", type: "Expense", category: "Fixed Asset Purchase", amount: 2500, account: B }),
      line({ date: "2025-01-07", type: "Income", category: "Loan Received", amount: 3000, account: B }),
      line({ date: "2025-01-08", type: "Expense", category: "Loan Repayment", amount: 500, account: B }),
    ];
    assert.equal(computePnL(ledger, "", "").netProfit, 0);
    const ex = computeNonPnL(ledger, "", "");
    assert.deepEqual(
      [ex.fixed_asset, ex.loan_in, ex.loan_out, ex.asset_purchase, ex.ar_collection, ex.ap_settlement],
      [2500, 3000, 500, 0, 0, 0],
      "not counted as stock purchases, customer receipts or supplier payments",
    );
  });
});

/* =================================== delivery runs =================================== */

describe("stock out on delivery runs", () => {
  const run = (status, lineItems) => ({ id: "DR-" + ++seq, status, lineItems });

  test("STMT-5 only open runs count, at the cost recorded when the stock was taken", () => {
    const products = [{ id: 1, cost: 999 }, { id: 2, cost: 100 }];
    const runs = [
      run("Ongoing", [
        { productId: 1, taken: 4, cost: 600 },
        { productId: 2, taken: 2 }, // no cost on the line: the product's cost is used
      ]),
      run("Completed", [{ productId: 1, taken: 50, cost: 600 }]),
    ];
    assert.equal(stockOnDeliveryRuns(runs, products), 4 * 600 + 2 * 100);
    assert.equal(stockOnDeliveryRuns([], products), 0);
    assert.equal(stockOnDeliveryRuns(undefined, undefined), 0);
  });

  test("STMT-6 starting a run moves stock out of the shelf without changing assets or equity", () => {
    const products = [{ id: 1, cost: 600, stock: 10 }];
    const store = { ledger: [], cashAccounts: ACCOUNTS, products, settings: {}, asOf: "2025-12-31" };
    const before = computeFinancialPosition(store);
    assert.equal(before.finishedGoods, 6000);
    // 4 printers go on the van: the product's stock drops by 4 and a run is opened
    const after = computeFinancialPosition({
      ...store,
      products: [{ id: 1, cost: 600, stock: 6 }],
      deliveryRuns: [run("Ongoing", [{ productId: 1, taken: 4, cost: 600 }])],
    });
    assert.equal(after.finishedGoods, 3600);
    assert.equal(after.stockOnRuns, 2400);
    assert.equal(after.inventory, before.inventory);
    assert.equal(after.totalAssets, before.totalAssets);
    assert.equal(after.openingBalanceEquity, before.openingBalanceEquity);
  });
});

/* ===================================== sales returns ===================================== */

describe("sales returns on the Profit or Loss statement", () => {
  const sale = (qty) => [
    line({ date: "2025-05-01", type: "Income", category: "Sales", amount: 1000 * qty, account: M, kind: "revenue" }),
    line({
      date: "2025-05-01",
      type: "Expense",
      category: "Cost of Goods Sold",
      amount: 600 * qty,
      kind: "cogs",
      cash: false,
    }),
  ];
  const returned = (qty, { restock }) => [
    line({
      date: "2025-05-02",
      type: "Expense",
      category: "Sales Returns",
      amount: 1000 * qty,
      account: M,
      kind: "opex",
      cash: true,
    }),
    line({
      date: "2025-05-02",
      type: "Expense",
      category: "Cost of Goods Sold",
      amount: -600 * qty,
      kind: "cogs",
      cash: false,
    }),
    ...(restock
      ? []
      : [
          line({
            date: "2025-05-02",
            type: "Expense",
            category: "Returned Goods Written Off",
            amount: 600 * qty,
            kind: "opex",
            cash: false,
          }),
        ]),
  ];

  test("STMT-7 a sale that is returned in full leaves no revenue, no gross profit and no margin", () => {
    const p = computePnL([...sale(1), ...returned(1, { restock: true })], "", "");
    assert.deepEqual(
      [p.revenue, p.salesReturns, p.netRevenue, p.cogs, p.grossProfit, p.totalOpex, p.netProfit],
      [1000, 1000, 0, 0, 0, 0, 0],
    );
    assert.equal(p.grossMargin, 0, "it used to read 100%");
    assert.equal(p.totalIncome, 0);
  });

  test("STMT-8 part of a sale returned and restocked: margins are on what was really sold", () => {
    const p = computePnL([...sale(2), ...returned(1, { restock: true })], "", "");
    assert.deepEqual(
      [p.revenue, p.salesReturns, p.netRevenue, p.cogs, p.grossProfit, p.netProfit],
      [2000, 1000, 1000, 600, 400, 400],
    );
    assert.equal(p.grossMargin, 40);
    assert.equal(p.netMargin, 40);
    assert.deepEqual(p.revenueByCat, { Sales: 2000 });
    assert.deepEqual(p.opexByCat, {}, "returns are not an operating cost");
  });

  test("STMT-9 goods written off are an expense; the net profit is what it always was", () => {
    const p = computePnL([...sale(2), ...returned(1, { restock: false })], "", "");
    // revenue 2,000 - returns 1,000 - cost of sales (1,200 - 600) - written-off goods 600
    assert.deepEqual(
      [p.netRevenue, p.cogs, p.grossProfit, p.totalOpex, p.netProfit],
      [1000, 600, 400, 600, -200],
    );
    assert.deepEqual(p.opexByCat, { "Returned Goods Written Off": 600 });
  });

  test("STMT-10 a statement without returns is unchanged", () => {
    const p = computePnL(sale(1), "", "");
    assert.deepEqual([p.salesReturns, p.netRevenue, p.revenue, p.grossProfit], [0, 1000, 1000, 400]);
  });
});

/* ================================== statement of cash flows ================================== */

// The ledger used by the accounting unit tests: opening cash 1,000 + 0.
const LEDGER = [
  { id: "TXN-1", date: "2026-01-05", type: "Income", category: "Sales", amount: 1000, account: M, kind: "revenue" },
  { id: "TXN-2", date: "2026-01-05", type: "Expense", category: "Cost of Goods Sold", amount: 600, kind: "cogs", cash: false },
  { id: "TXN-3", date: "2026-01-10", type: "Expense", category: "Rent", amount: 150, account: B },
  { id: "TXN-4", date: "2026-01-12", type: "Income", category: "Interest Income", amount: 20, account: B },
  { id: "TXN-5", date: "2026-02-01", type: "Expense", category: "Stock & Raw Material Purchase", amount: 300 },
  { id: "TXN-6", date: "2026-02-02", type: "Income", category: "Owner Capital", amount: 5000, account: B },
  { id: "TXN-7", date: "2026-02-03", type: "Expense", category: "Owner Drawings", amount: 200 },
  { id: "TXN-8", date: "2026-02-04", type: "Expense", category: "Cash Transfer", amount: 100, account: B, kind: "transfer" },
  { id: "TXN-9", date: "2026-02-04", type: "Income", category: "Cash Transfer", amount: 100, account: M, kind: "transfer" },
  { id: "TXN-10", date: "2026-02-05", type: "Income", category: "Receivable Collection", amount: 50 },
  { id: "TXN-11", date: "2026-02-06", type: "Expense", category: "Supplier Payment", amount: 80, account: B },
  { id: "TXN-12", date: "2026-02-07", type: "Income", category: "Sales", amount: 400, kind: "revenue", cash: false },
];
const STORE = { ledger: LEDGER, cashAccounts: ACCOUNTS };

describe("Statement of Cash Flows", () => {
  test("STMT-11 all time: every cash line lands on one heading and cash closes on the balances", () => {
    const cf = computeCashFlow(STORE, "", "2026-12-31");
    assert.deepEqual(cf.operating, {
      fromCustomers: 1050, // 1,000 sale + 50 collected from a customer
      otherIncome: 20,
      refunds: 0,
      paidForStock: -300,
      supplierBills: -80,
      expenses: -150,
      net: 540,
    });
    assert.deepEqual(cf.investing, { fixedAssets: 0, net: 0 });
    assert.deepEqual(cf.financing, {
      capitalIntroduced: 5000,
      drawings: -200,
      loansReceived: 0,
      loansRepaid: 0,
      net: 4800,
    });
    assert.equal(cf.transfers, 0, "the two sides of a transfer cancel");
    assert.equal(cf.netChange, 5340);
    assert.equal(cf.openingCash, 1000);
    assert.equal(cf.closingCash, 6340);
    assert.equal(cf.balancesTotal, 6340);
    assert.equal(cf.agrees, true);
    assert.deepEqual(
      cf.accounts.map((a) => [a.id, a.opening, a.closing]),
      [
        [M, 1000, 1650],
        [B, 0, 4690],
      ],
    );
  });

  test("STMT-12 net profit is reconciled to operating cash", () => {
    const r = computeCashFlow(STORE, "", "2026-12-31").reconciliation;
    // 670 profit, less 350 (400 of credit sales not yet collected, 50 collected),
    // plus 220 (600 of stock used up, less 300 bought and 80 of supplier bills paid)
    assert.deepEqual(
      [r.netProfit, r.receivables, r.inventoryAndPayables, r.netOperating, r.agrees],
      [670, -350, 220, 540, true],
    );
  });

  test("STMT-13 a period starts from the cash at the end of the day before", () => {
    const jan = computeCashFlow(STORE, "2026-01-01", "2026-01-31");
    assert.deepEqual([jan.operating.net, jan.financing.net, jan.netChange], [870, 0, 870]);
    assert.deepEqual([jan.openingCash, jan.closingCash, jan.balancesTotal, jan.agrees], [1000, 1870, 1870, true]);
    assert.deepEqual(
      [jan.reconciliation.netProfit, jan.reconciliation.receivables, jan.reconciliation.inventoryAndPayables],
      [270, 0, 600],
    );
    const feb = computeCashFlow(STORE, "2026-02-01", "2026-02-28");
    assert.deepEqual([feb.operating.net, feb.financing.net, feb.netChange], [-330, 4800, 4470]);
    assert.equal(feb.openingCash, jan.closingCash, "February opens where January closed");
    assert.deepEqual([feb.closingCash, feb.balancesTotal, feb.agrees], [6340, 6340, true]);
    assert.deepEqual(
      [feb.reconciliation.netProfit, feb.reconciliation.receivables, feb.reconciliation.inventoryAndPayables],
      [400, -350, -380],
    );
    assert.equal(feb.reconciliation.agrees, true);
  });

  test("STMT-14 purchases of equipment are investing; capital, drawings and loans are financing", () => {
    const ledger = [
      line({ date: "2025-03-01", type: "Income", category: "Loan Received", amount: 3000, account: B }),
      line({ date: "2025-03-02", type: "Expense", category: "Fixed Asset Purchase", amount: 2500, account: B }),
      line({ date: "2025-03-03", type: "Expense", category: "Loan Repayment", amount: 500, account: B }),
      line({ date: "2025-03-04", type: "Income", category: "Owner Capital", amount: 100, account: M }),
    ];
    const cf = computeCashFlow({ ledger, cashAccounts: ACCOUNTS }, "2025-03-01", "2025-03-31");
    assert.equal(cf.investing.fixedAssets, -2500);
    assert.equal(cf.investing.net, -2500);
    assert.deepEqual(
      [cf.financing.loansReceived, cf.financing.loansRepaid, cf.financing.capitalIntroduced, cf.financing.net],
      [3000, -500, 100, 2600],
    );
    assert.equal(cf.operating.net, 0, "none of it touches operations");
    assert.equal(cf.netChange, 100);
    assert.equal(cf.agrees, true);
  });

  test("STMT-15 refunds to customers are operating cash out, and so are cost of sales paid in cash", () => {
    const ledger = [
      line({ date: "2025-04-01", type: "Income", category: "Sales", amount: 1100, account: M, kind: "revenue" }),
      line({ date: "2025-04-02", type: "Expense", category: "Sales Returns", amount: 400, account: M, kind: "opex", cash: true }),
      line({ date: "2025-04-02", type: "Expense", category: "Sales Returns", amount: 300, kind: "opex", cash: false }),
      line({ date: "2025-04-03", type: "Expense", category: "Cost of Goods Sold", amount: 50, account: B, kind: "cogs", cash: true }),
    ];
    const cf = computeCashFlow({ ledger, cashAccounts: ACCOUNTS }, "2025-04-01", "2025-04-30");
    assert.deepEqual(
      [cf.operating.fromCustomers, cf.operating.refunds, cf.operating.expenses, cf.operating.net],
      [1100, -400, -50, 650],
    );
    // the non-cash return (300) came off an unpaid invoice, so it lowers receivables
    assert.equal(cf.reconciliation.receivables, 300);
    assert.deepEqual([cf.reconciliation.netProfit, cf.reconciliation.agrees], [350, true]);
  });

  test("STMT-16 a transfer with one side missing shows up instead of vanishing", () => {
    const ledger = [
      line({ date: "2025-04-01", type: "Expense", category: "Cash Transfer", amount: 100, account: M, kind: "transfer" }),
    ];
    const cf = computeCashFlow({ ledger, cashAccounts: ACCOUNTS }, "2025-04-01", "2025-04-30");
    assert.equal(cf.transfers, -100);
    assert.equal(cf.netChange, -100);
    assert.equal(cf.agrees, true, "cash still closes on the balances");
  });

  test("STMT-17 non-cash lines (credit sales, cost of goods sold) move no cash", () => {
    const ledger = [
      line({ date: "2025-04-01", type: "Income", category: "Sales", amount: 900, kind: "revenue", cash: false }),
      line({ date: "2025-04-01", type: "Expense", category: "Cost of Goods Sold", amount: 500, kind: "cogs", cash: false }),
    ];
    const cf = computeCashFlow({ ledger, cashAccounts: ACCOUNTS }, "2025-04-01", "2025-04-30");
    assert.deepEqual([cf.netChange, cf.openingCash, cf.closingCash], [0, 1000, 1000]);
    // 400 profit that is not cash: 900 owed by customers, less 500 of stock used up
    assert.deepEqual(
      [cf.reconciliation.netProfit, cf.reconciliation.receivables, cf.reconciliation.inventoryAndPayables],
      [400, -900, 500],
    );
    assert.equal(cf.reconciliation.netOperating, 0);
  });

  test("STMT-18 an empty period and an empty ledger give zeros, not errors", () => {
    const empty = computeCashFlow({ ledger: [], cashAccounts: ACCOUNTS }, "", "");
    assert.deepEqual([empty.netChange, empty.openingCash, empty.closingCash, empty.agrees], [0, 1000, 1000, true]);
    const none = computeCashFlow({ ledger: undefined, cashAccounts: undefined }, "", "");
    assert.deepEqual([none.netChange, none.openingCash, none.closingCash, none.agrees], [0, 0, 0, true]);
    const quiet = computeCashFlow(STORE, "2027-01-01", "2027-01-31");
    assert.deepEqual([quiet.netChange, quiet.openingCash, quiet.closingCash], [0, 6340, 6340]);
  });
});

/* ============================ statement of changes in equity ============================ */

// Dates in the past, so "today" never changes what is included.
const L25 = [
  { id: "A", date: "2025-01-10", type: "Income", category: "Sales", amount: 1000, account: M, kind: "revenue" },
  { id: "B", date: "2025-01-10", type: "Expense", category: "Cost of Goods Sold", amount: 400, kind: "cogs", cash: false },
  { id: "C", date: "2025-02-05", type: "Income", category: "Owner Capital", amount: 3000, account: B },
  { id: "D", date: "2025-02-20", type: "Expense", category: "Owner Drawings", amount: 500 },
  { id: "E", date: "2025-03-03", type: "Expense", category: "Rent", amount: 200, account: B },
  { id: "F", date: "2025-03-15", type: "Income", category: "Sales", amount: 600, account: M, kind: "revenue" },
  { id: "G", date: "2025-03-15", type: "Expense", category: "Cost of Goods Sold", amount: 250, kind: "cogs", cash: false },
];
const EQ_STORE = {
  ledger: L25,
  cashAccounts: ACCOUNTS,
  products: [{ cost: 10, stock: 5 }],
  settings: { openingCapital: 1000 },
};

describe("Statement of Changes in Equity", () => {
  test("STMT-19 the position behind the figures: cash 4,900 + stock 50, capital 3,500, profit 750", () => {
    const pos = computeFinancialPosition(EQ_STORE);
    assert.deepEqual(
      [pos.cash, pos.inventory, pos.totalAssets, pos.capital, pos.retained, pos.openingBalanceEquity, pos.totalEquity],
      [4900, 50, 4950, 3500, 750, 700, 4950],
    );
  });

  test("STMT-20 all time: opening capital grows by profit and capital introduced, less drawings", () => {
    const eq = computeEquityChanges(EQ_STORE, "", "");
    assert.deepEqual(eq.opening, { capital: 1000, retained: 0, preSystem: 700, total: 1700 });
    assert.deepEqual([eq.profit, eq.introduced, eq.drawings], [750, 3000, 500]);
    assert.deepEqual(eq.closing, { capital: 3500, retained: 750, preSystem: 700, total: 4950 });
    assert.equal(eq.agreesWithPosition, true, "closing equity is the position's total equity");
    assert.equal(eq.closing.total, computeFinancialPosition(EQ_STORE).totalEquity);
  });

  test("STMT-21 a period opens with everything that happened before it, and the chain is unbroken", () => {
    const feb = computeEquityChanges(EQ_STORE, "2025-02-01", "2025-02-28");
    assert.deepEqual(feb.opening, { capital: 1000, retained: 600, preSystem: 700, total: 2300 });
    assert.deepEqual([feb.profit, feb.introduced, feb.drawings], [0, 3000, 500]);
    assert.deepEqual(feb.closing, { capital: 3500, retained: 600, preSystem: 700, total: 4800 });
    assert.equal(feb.agreesWithPosition, null, "only a statement that ends today can be compared");
    const mar = computeEquityChanges(EQ_STORE, "2025-03-01", "2025-03-31");
    assert.deepEqual(mar.opening, feb.closing, "March opens where February closed");
    assert.deepEqual([mar.profit, mar.introduced, mar.drawings], [150, 0, 0]);
    assert.deepEqual(mar.closing, { capital: 3500, retained: 750, preSystem: 700, total: 4950 });
  });

  test("STMT-22 the profit of the period is the profit on the Profit or Loss statement", () => {
    for (const [from, to] of [
      ["2025-01-01", "2025-01-31"],
      ["2025-02-01", "2025-03-31"],
      ["2025-03-10", "2025-03-20"],
      ["", "2025-02-28"],
    ]) {
      const eq = computeEquityChanges(EQ_STORE, from, to);
      assert.equal(eq.profit, computePnL(L25, from, to).netProfit, `${from || "start"} to ${to}`);
      assert.equal(
        round2(eq.opening.total + eq.profit + eq.introduced - eq.drawings),
        eq.closing.total,
        "opening + movements = closing",
      );
    }
  });

  test("STMT-23 a loss and drawings together shrink the owner's stake", () => {
    const ledger = [
      line({ date: "2025-01-10", type: "Expense", category: "Rent", amount: 300, account: M }),
      line({ date: "2025-01-11", type: "Expense", category: "Owner Drawings", amount: 100, account: M }),
    ];
    const eq = computeEquityChanges(
      { ledger, cashAccounts: ACCOUNTS, settings: { openingCapital: 1000 } },
      "2025-01-01",
      "2025-01-31",
    );
    assert.deepEqual([eq.profit, eq.drawings], [-300, 100]);
    assert.equal(eq.closing.total, eq.opening.total - 300 - 100);
    assert.equal(eq.closing.capital, 900);
    assert.equal(eq.closing.retained, -300);
  });
});

/* ======================================= export rows ======================================= */

describe("statement export rows", () => {
  const value = (rows, label) => rows.find((r) => String(r[0]).trim() === label)?.[1];

  test("STMT-24 the Profit or Loss rows carry the same totals as the statement", () => {
    const ledger = [
      line({ date: "2025-05-01", type: "Income", category: "Sales", amount: 2000, account: M, kind: "revenue" }),
      line({ date: "2025-05-01", type: "Expense", category: "Cost of Goods Sold", amount: 1200, kind: "cogs", cash: false }),
      line({ date: "2025-05-02", type: "Expense", category: "Sales Returns", amount: 1000, account: M, kind: "opex", cash: true }),
      line({ date: "2025-05-02", type: "Expense", category: "Cost of Goods Sold", amount: -600, kind: "cogs", cash: false }),
      line({ date: "2025-05-03", type: "Expense", category: "Rent", amount: 100, account: M }),
      line({ date: "2025-05-04", type: "Income", category: "Interest Income", amount: 20, account: B }),
      line({ date: "2025-05-05", type: "Expense", category: "Fixed Asset Purchase", amount: 700, account: B }),
      line({ date: "2025-05-06", type: "Income", category: "Loan Received", amount: 900, account: B }),
    ];
    const rows = pnlRows(computePnL(ledger, "", ""), computeNonPnL(ledger, "", ""));
    assert.equal(value(rows, "Sales"), 2000);
    assert.equal(value(rows, "Less: Sales returns"), -1000);
    assert.equal(value(rows, "Total Revenue"), 1000);
    assert.equal(value(rows, "Total Cost of Sales"), 600);
    assert.equal(value(rows, "GROSS PROFIT"), 400);
    assert.equal(value(rows, "Total Operating Expenses"), 100);
    assert.equal(value(rows, "Total Other Income"), 20);
    assert.equal(value(rows, "NET PROFIT FOR THE PERIOD"), 320);
    assert.equal(value(rows, "Fixed asset purchases"), 700);
    assert.equal(value(rows, "Loans received"), 900);
    assert.equal(value(rows, "Loans repaid"), 0);
  });

  test("STMT-25 the position rows list non-current and current items and agree with the totals", () => {
    const pos = computeFinancialPosition({
      ledger: [
        line({ date: "2025-01-06", type: "Expense", category: "Fixed Asset Purchase", amount: 2500, account: B }),
        line({ date: "2025-01-07", type: "Income", category: "Loan Received", amount: 3000, account: B }),
      ],
      cashAccounts: ACCOUNTS,
      products: [{ cost: 10, stock: 5 }],
      settings: {},
      asOf: "2025-12-31",
    });
    const rows = positionRows(pos);
    const labels = rows.map((r) => String(r[0]).trim());
    for (const l of [
      "NON-CURRENT ASSETS",
      "Property, Plant & Equipment (at cost)",
      "CURRENT ASSETS",
      "Total Current Assets",
      "NON-CURRENT LIABILITIES",
      "Loans Payable",
      "CURRENT LIABILITIES",
      "Total Current Liabilities",
    ]) {
      assert.ok(labels.includes(l), l);
    }
    assert.ok(labels.indexOf("NON-CURRENT ASSETS") < labels.indexOf("CURRENT ASSETS"));
    assert.equal(value(rows, "Property, Plant & Equipment (at cost)"), 2500);
    assert.equal(value(rows, "Loans Payable"), 3000);
    assert.equal(value(rows, "TOTAL ASSETS"), pos.totalAssets);
    assert.equal(value(rows, "Total Liabilities"), 3000);
    assert.equal(value(rows, "TOTAL LIABILITIES AND EQUITY"), pos.totalAssets);
    assert.equal(
      round2(value(rows, "Total Non-current Assets") + value(rows, "Total Current Assets")),
      value(rows, "TOTAL ASSETS"),
    );
  });

  test("STMT-26 the cash flow rows run from the headings to the closing cash", () => {
    const cf = computeCashFlow(STORE, "", "2026-12-31");
    const rows = cashFlowRows(cf);
    assert.equal(value(rows, "Net cash from operating activities"), 540);
    assert.equal(value(rows, "Net cash used in investing activities"), 0);
    assert.equal(value(rows, "Net cash from financing activities"), 4800);
    assert.equal(value(rows, "NET INCREASE / (DECREASE) IN CASH"), 5340);
    assert.equal(value(rows, "Cash at the start of the period"), 1000);
    assert.equal(value(rows, "CASH AT THE END OF THE PERIOD"), 6340);
    assert.equal(value(rows, "Cash Account"), 1650);
    assert.equal(value(rows, "Bank Account"), 4690);
    assert.equal(value(rows, "Net cash from operations (reconciled)"), 540);
    assert.equal(value(rows, "Transfers between own accounts (net)"), undefined, "nil, so not listed");
  });

  test("STMT-27 the equity rows have one amount per column", () => {
    const eq = computeEquityChanges(EQ_STORE, "2025-03-01", "2025-03-31");
    const rows = equityRows(eq);
    assert.equal(EQUITY_COLUMNS.length, 4);
    for (const r of rows) assert.equal(r.length, 1 + EQUITY_COLUMNS.length, r[0]);
    assert.deepEqual(rows[0].slice(1), [3500, 600, 700, 4800]);
    assert.deepEqual(rows[1].slice(1), ["", 150, "", 150]);
    assert.deepEqual(rows[4].slice(1), [3500, 750, 700, 4950]);
    assert.match(rows[0][0], /^Balance at the start \(Mar 1\)$/);
    assert.match(rows[4][0], /^Balance at the end \(Mar 31\)$/);
  });
});

/* ============== properties that must hold for any ledger (seeded, repeatable) ============== */

// A small deterministic random generator, so a failing case can be replayed from its seed.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DAYS = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
const ACCOUNT_IDS = [M, B, "ACC-X", null];
// [type, category, kind, cash]
const KINDS = [
  ["Income", "Sales", "revenue", true],
  ["Income", "Sales", "revenue", false],
  ["Income", "Interest Income", "revenue", true],
  ["Income", "Other Income", "revenue", true],
  ["Expense", "Cost of Goods Sold", "cogs", false],
  ["Expense", "Rent", "opex", true],
  ["Expense", "Utilities", "opex", true],
  ["Expense", "Sales Returns", "opex", true],
  ["Expense", "Sales Returns", "opex", false],
  ["Expense", "Returned Goods Written Off", "opex", false],
  ["Expense", "Stock & Raw Material Purchase", "asset_purchase", true],
  ["Expense", "Fixed Asset Purchase", "fixed_asset", true],
  ["Income", "Owner Capital", "capital_in", true],
  ["Expense", "Owner Drawings", "capital_out", true],
  ["Income", "Loan Received", "loan_in", true],
  ["Expense", "Loan Repayment", "loan_out", true],
  ["Income", "Receivable Collection", "ar_collection", true],
  ["Expense", "Supplier Payment", "ap_settlement", true],
];
function randomLedger(rand, n) {
  const ledger = [];
  const pickOf = (arr) => arr[Math.floor(rand() * arr.length)];
  for (let i = 0; i < n; i++) {
    const date = pickOf(DAYS);
    const amount = Math.round((1 + rand() * 1999) * 100) / 100;
    if (rand() < 0.08) {
      // a transfer: a line out of one account and a line into another
      const [from, to] = rand() < 0.5 ? [M, B] : [B, M];
      for (const [type, account] of [["Expense", from], ["Income", to]])
        ledger.push({ id: `R${i}-${type}`, date, type, category: "Cash Transfer", amount, account, kind: "transfer" });
      continue;
    }
    const [type, category, kind, cash] = pickOf(KINDS);
    const t = { id: `R${i}`, date, type, category, amount, account: pickOf(ACCOUNT_IDS), kind };
    if (kind === "cogs" || cash === false) t.cash = false;
    ledger.push(t);
  }
  return ledger;
}
const THREE_ACCOUNTS = [...ACCOUNTS, { id: "ACC-X", name: "Wallet", type: "Mobile Wallet", opening: 250.5 }];

describe("properties for any ledger", () => {
  test("STMT-28 cash flow: every period reconciles to the balances and to net profit", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = random(seed);
      const ledger = randomLedger(rand, 5 + Math.floor(rand() * 60));
      const a = DAYS[Math.floor(rand() * 365)];
      const b = DAYS[Math.floor(rand() * 365)];
      const [from, to] = a <= b ? [a, b] : [b, a];
      for (const [f, t] of [
        [from, to],
        ["", to],
        [from, "2025-12-31"],
        ["", "2025-12-31"],
      ]) {
        const cf = computeCashFlow({ ledger, cashAccounts: THREE_ACCOUNTS }, f, t);
        const why = `seed ${seed}, ${f || "start"} to ${t}`;
        assert.equal(cf.agrees, true, `${why}: closing cash ${cf.closingCash} vs balances ${cf.balancesTotal}`);
        assert.equal(cf.reconciliation.agrees, true, `${why}: profit ${cf.reconciliation.netOperating} vs cash ${cf.operating.net}`);
        assert.equal(
          cf.netChange,
          round2(cf.operating.net + cf.investing.net + cf.financing.net + cf.transfers),
          why,
        );
        assert.equal(cf.balancesTotal, totalCash(ledger, THREE_ACCOUNTS, t), why);
      }
    }
  });

  test("STMT-29 cash flow: back-to-back periods join up and add up to the whole", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const rand = random(1000 + seed);
      const ledger = randomLedger(rand, 10 + Math.floor(rand() * 50));
      const store = { ledger, cashAccounts: THREE_ACCOUNTS };
      const first = computeCashFlow(store, "2025-01-01", "2025-06-30");
      const second = computeCashFlow(store, "2025-07-01", "2025-12-31");
      const whole = computeCashFlow(store, "2025-01-01", "2025-12-31");
      assert.equal(second.openingCash, first.closingCash, `seed ${seed}`);
      assert.equal(whole.netChange, round2(first.netChange + second.netChange), `seed ${seed}`);
      assert.equal(whole.operating.net, round2(first.operating.net + second.operating.net), `seed ${seed}`);
    }
  });

  test("STMT-30 equity: opening + movements = closing, profit = the P&L's, and today's closing = the position's", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = random(5000 + seed);
      const ledger = randomLedger(rand, 5 + Math.floor(rand() * 60));
      const store = {
        ledger,
        cashAccounts: THREE_ACCOUNTS,
        products: [{ cost: 12.5, stock: Math.floor(rand() * 40) }],
        rawMaterials: [{ costPrice: 3.25, availableQty: Math.floor(rand() * 100) }],
        settings: { openingCapital: Math.round(rand() * 5000) },
      };
      const a = DAYS[Math.floor(rand() * 365)];
      const b = DAYS[Math.floor(rand() * 365)];
      const [from, to] = a <= b ? [a, b] : [b, a];
      const eq = computeEquityChanges(store, from, to);
      const why = `seed ${seed}, ${from} to ${to}`;
      assert.equal(eq.profit, computePnL(ledger, from, to).netProfit, why);
      assert.ok(
        Math.abs(eq.opening.total + eq.profit + eq.introduced - eq.drawings - eq.closing.total) < 0.011,
        `${why}: ${eq.opening.total} + ${eq.profit} + ${eq.introduced} - ${eq.drawings} != ${eq.closing.total}`,
      );
      const today = computeEquityChanges(store, from, "");
      assert.equal(today.agreesWithPosition, true, why);
      assert.equal(today.closing.total, computeFinancialPosition(store).totalEquity, why);
    }
  });

  test("STMT-31 buying equipment, borrowing, repaying, capital, drawings, income, expenses and transfers never move the opening-balance line", () => {
    const rand = random(777);
    const base = {
      ledger: randomLedger(rand, 25),
      cashAccounts: THREE_ACCOUNTS,
      products: [{ cost: 600, stock: 7 }],
      rawMaterials: [{ costPrice: 100, availableQty: 4 }],
      settings: { openingCapital: 2000 },
      asOf: "2025-12-31",
    };
    const plug = computeFinancialPosition(base).openingBalanceEquity;
    const amount = 1234.56;
    const recipes = {
      "fixed asset bought": [["Expense", "Fixed Asset Purchase"]],
      "loan received": [["Income", "Loan Received"]],
      "loan received then repaid": [["Income", "Loan Received"], ["Expense", "Loan Repayment"]],
      "capital introduced": [["Income", "Owner Capital"]],
      "drawings": [["Expense", "Owner Drawings"]],
      "cash sale": [["Income", "Sales"]],
      "rent paid": [["Expense", "Rent"]],
      "interest earned": [["Income", "Interest Income"]],
    };
    for (const [name, steps] of Object.entries(recipes)) {
      const added = steps.map(([type, category], i) => ({
        id: `X${i}`,
        date: "2025-06-15",
        type,
        category,
        amount,
        account: M,
      }));
      const after = computeFinancialPosition({ ...base, ledger: [...base.ledger, ...added] });
      assert.equal(after.openingBalanceEquity, plug, name);
      assert.equal(after.balanced, true, name);
    }
    // a transfer between two accounts
    const moved = transferLines(amount);
    const afterTransfer = computeFinancialPosition({ ...base, ledger: [...base.ledger, ...moved] });
    assert.equal(afterTransfer.openingBalanceEquity, plug, "transfer");
    assert.equal(afterTransfer.cash, computeFinancialPosition(base).cash, "total cash is unchanged");
  });
});
function transferLines(amount) {
  return [
    { id: "TX1", date: "2025-06-16", type: "Expense", category: "Cash Transfer", amount, account: M, kind: "transfer" },
    { id: "TX2", date: "2025-06-16", type: "Income", category: "Cash Transfer", amount, account: B, kind: "transfer" },
  ];
}
