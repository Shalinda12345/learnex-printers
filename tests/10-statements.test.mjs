// End-to-end tests for the four financial statements — Profit or Loss, Financial
// Position, Cash Flows and Changes in Equity — driven in the browser.
//
//   1. "the statements" loads a small, fully known business and checks every
//      figure on screen, the date ranges, the exports and the Reports screen.
//   2. "a month in the life of the shop" then runs the business through the real
//      screens — sales, returns, purchases, a delivery run, expenses, capital,
//      a loan, equipment — and checks, after every step, that the statements
//      still agree with each other and with figures worked out by hand.
//
// Every expected number below was worked out by hand (the working is in the
// comments), not copied from what the app showed.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  asOwner,
  card,
  download,
  field,
  launchBrowser,
  loadStores,
  log,
  modal,
  nav,
  newPage,
  openApp,
  parseCsv,
  pool,
  row,
  shopFixture,
  stores,
  takeConsoleProblems,
  toast,
  waitSaved,
  wipeDatabase,
} from "./helpers.mjs";

let browser;
before(async () => {
  await asOwner();
  browser = await launchBrowser();
});
after(async () => {
  await browser.close();
  await pool.end();
});

/* ------------------------------------------------------------------ helpers */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "Rs. 1,650" -> 1650, "(Rs. 200)" -> -200, "Rs. -25" -> -25, "" -> null. */
function num(text) {
  const t = text.trim();
  if (!t) return null;
  // the first number in the text ("Rs." has a dot of its own, so it can't be stripped character by character)
  const n = Number(t.match(/\d[\d,]*(?:\.\d+)?/)[0].replace(/,/g, ""));
  return /^\(/.test(t) || t.includes("-") ? -n : n;
}
const openTab = (page, tab) => page.locator("main button", { hasText: tab }).first().click();
/** One line of a statement (label on the left, amount on the right). */
const stmtRow = (page, label) =>
  page
    .locator("main div.flex.items-start.justify-between", {
      has: page.locator("span.text-sm", { hasText: new RegExp(`^${escapeRe(label)}$`) }),
    })
    .first();
const stmt = async (page, label) => num(await stmtRow(page, label).locator(":scope > span").innerText());
const cardNum = async (page, label) => num(await card(page, label).innerText());
/** The rows of the Changes in Equity table, as text cells. */
const equityTable = async (page) => {
  const rows = await page.locator("main table tbody tr").all();
  return Promise.all(rows.map(async (r) => (await r.locator("td").allInnerTexts()).map((c) => c.trim())));
};
/** Opens an Accounting tab; the screen starts on "Ledger & Overview" each time. */
async function accountingTab(page, tab) {
  await nav(page, "Accounting");
  await openTab(page, tab);
}
const closeModal = (page) => modal(page).locator("h3 + button").click();
/** "Nov 9" — how the app writes today's date on a statement. */
const todayLabel = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
const reportCard = (page, name) =>
  page
    .locator("main div.rounded-2xl")
    .filter({ has: page.locator("p", { hasText: new RegExp(`^${escapeRe(name)}$`) }) });
/** CSV rows as { label: amount } (labels trimmed; blank rows dropped). */
const csvMap = (text) =>
  Object.fromEntries(
    parseCsv(text)
      .filter((r) => r[0] && r[0].trim())
      .map((r) => [r[0].trim(), r[1]]),
  );

/* ========================================================================== */
/* 1. The statements, on a business whose every figure is known               */
/* ========================================================================== */

// Dates are in 2025 so they are always in the past. Cash Account opens with
// 1,000, Bank with 0; the owner's opening capital is 1,000; tax is 10%.
//   Jan 5   sale 1,000 into Cash; its cost of goods 600
//   Jan 10  rent 150 (Bank)          Jan 12  interest 20 (Bank)
//   Feb 1   stock bought 300 (Cash)  Feb 2   capital 5,000 (Bank)
//   Feb 3   drawings 200 (Cash)      Feb 4   transfer 100 Bank -> Cash
//   Feb 5   collected from a customer 50 (Cash)     Feb 6  paid a supplier 80 (Bank)
//   Feb 7   sale on credit 400 (not cash)
//   Feb 10  equipment bought 2,500 (Bank)    Feb 11  loan received 3,000 (Bank)
//   Feb 12  loan repaid 500 (Bank)
//   Mar 1   sale 1,100 into Cash, cost 600   Mar 2   the sale is returned: 1,100
//           refunded from Cash and the 600 of cost taken back out of cost of goods sold
// plus: 450 owed to a supplier, 400 owed by a customer, and 2 printers (cost 600
// each) out on a delivery run that is not closed yet.
function statementsFixture() {
  const data = shopFixture();
  data.cashAccounts[0].opening = 1000;
  data.settings.openingCapital = 1000;
  data.products[0].stock = 8; // 10 printers, 2 of them on the van
  const t = (id, date, desc, type, category, amount, extra = {}) => ({
    id: `TXN-${id}`,
    date,
    desc,
    type,
    category,
    amount,
    ...extra,
  });
  data.ledger = [
    t(1, "2025-01-05", "Sale", "Income", "Sales", 1000, { account: "CASH-MAIN", kind: "revenue" }),
    t(2, "2025-01-05", "COGS", "Expense", "Cost of Goods Sold", 600, { kind: "cogs", cash: false }),
    t(3, "2025-01-10", "Rent", "Expense", "Rent", 150, { account: "BANK-MAIN" }),
    t(4, "2025-01-12", "Interest", "Income", "Interest Income", 20, { account: "BANK-MAIN" }),
    t(5, "2025-02-01", "Stock bought", "Expense", "Stock & Raw Material Purchase", 300),
    t(6, "2025-02-02", "Capital", "Income", "Owner Capital", 5000, { account: "BANK-MAIN" }),
    t(7, "2025-02-03", "Drawings", "Expense", "Owner Drawings", 200),
    t(8, "2025-02-04", "Move", "Expense", "Cash Transfer", 100, { account: "BANK-MAIN", kind: "transfer" }),
    t(9, "2025-02-04", "Move", "Income", "Cash Transfer", 100, { account: "CASH-MAIN", kind: "transfer" }),
    t(10, "2025-02-05", "Collected", "Income", "Receivable Collection", 50),
    t(11, "2025-02-06", "Paid supplier", "Expense", "Supplier Payment", 80, { account: "BANK-MAIN" }),
    t(12, "2025-02-07", "Credit sale", "Income", "Sales", 400, { kind: "revenue", cash: false }),
    t(13, "2025-02-10", "Equipment", "Expense", "Fixed Asset Purchase", 2500, {
      account: "BANK-MAIN",
      kind: "fixed_asset",
    }),
    t(14, "2025-02-11", "Bank loan", "Income", "Loan Received", 3000, { account: "BANK-MAIN", kind: "loan_in" }),
    t(15, "2025-02-12", "Loan repayment", "Expense", "Loan Repayment", 500, {
      account: "BANK-MAIN",
      kind: "loan_out",
    }),
    t(16, "2025-03-01", "Sale", "Income", "Sales", 1100, { account: "CASH-MAIN", kind: "revenue" }),
    t(17, "2025-03-01", "COGS", "Expense", "Cost of Goods Sold", 600, { kind: "cogs", cash: false }),
    t(18, "2025-03-02", "Sales return refund", "Expense", "Sales Returns", 1100, {
      account: "CASH-MAIN",
      kind: "opex",
      cash: true,
    }),
    t(19, "2025-03-02", "COGS reversed", "Expense", "Cost of Goods Sold", -600, { kind: "cogs", cash: false }),
  ];
  data.salesOrders = [
    {
      id: "SO-1001",
      invoice: "INV-1001",
      customer: "Acme Traders",
      customerId: 201,
      items: 2,
      lineItems: [{ productId: 102, name: "Beta Toner", qty: 2, price: 200 }],
      amount: 400,
      tax: 36.36,
      status: "Delivered",
      payment: "Pending",
      date: "2025-02-07",
      channel: "Manual",
      amountPaid: 0,
      accrued: true,
    },
  ];
  data.purchaseOrders = [
    {
      id: "PO-4001",
      supplier: "Paper Mills Ltd",
      supplierId: 301,
      items: 3,
      lineItems: [{ materialId: 401, name: "Resin", qty: 3, cost: 150 }],
      total: 450,
      date: "2025-02-08",
      paymentStatus: "Unpaid",
      amountPaid: 0,
    },
  ];
  data.deliveryRuns = [
    {
      id: "DR-1002",
      date: "2025-03-03",
      status: "Ongoing",
      lineItems: [
        { productId: 101, name: "Alpha Printer", price: 1000, cost: 600, unit: "pc", taken: 2, returned: 0 },
      ],
      totalTaken: 2,
      completedDate: null,
      soldQty: null,
      saleAmount: null,
      costAmount: null,
      dailyExpense: null,
      profit: null,
      netProfit: null,
      ledgerTxnId: null,
      creditTxnId: null,
      expenseTxnIds: [],
    },
  ];
  return data;
}

describe("the statements", () => {
  beforeEach(async () => {
    await loadStores(statementsFixture());
  });

  test("ST-1 Statement of Financial Position: non-current and current items, and it balances", async () => {
    const page = await openApp(browser);
    await accountingTab(page, "Statement of Financial Position");
    const v = {
      ppe: await stmt(page, "Property, Plant & Equipment (at cost)"),
      nonCurrentAssets: await stmt(page, "Total Non-current Assets"),
      mainCash: await stmt(page, "Cash Account"),
      bank: await stmt(page, "Bank Account"),
      cash: await stmt(page, "Total Cash & Bank"),
      receivables: await stmt(page, "Trade Receivables"),
      finishedGoods: await stmt(page, "Inventory — Finished Goods (at cost)"),
      rawMaterials: await stmt(page, "Inventory — Raw Materials (at cost)"),
      onRuns: await stmt(page, "Inventory — Stock out on Delivery Runs (at cost)"),
      currentAssets: await stmt(page, "Total Current Assets"),
      loans: await stmt(page, "Loans Payable"),
      nonCurrentLiabilities: await stmt(page, "Total Non-current Liabilities"),
      payables: await stmt(page, "Trade Payables"),
      currentLiabilities: await stmt(page, "Total Current Liabilities"),
      openingCapital: await stmt(page, "Opening Capital"),
      introduced: await stmt(page, "Capital Introduced"),
      drawings: await stmt(page, "Owner's Drawings"),
      retained: await stmt(page, "Retained Earnings"),
      preSystem: await stmt(page, "Opening Balance Equity"),
      equity: await stmt(page, "Total Equity"),
    };
    log(JSON.stringify(v));
    // Cash Account: 1,000 + 1,000 - 300 - 200 + 100 + 50 + 1,100 - 1,100 = 1,650
    // Bank: -150 + 20 + 5,000 - 100 - 80 - 2,500 + 3,000 - 500 = 4,690
    // inventory: printers 8 x 600 + toner 3 x 100 = 5,100; resin 10 x 100 + ink 1 x 40 = 1,040; on the van 2 x 600 = 1,200
    // current assets 6,340 + 400 + 7,340 = 14,080; plus equipment 2,500 = 16,580
    // liabilities: loan 3,000 - 500 = 2,500 (non-current) + 450 owed to a supplier (current)
    // equity: capital 1,000 + 5,000 - 200 = 5,800, profit 670, opening-balance line 16,580 - 2,950 - 5,800 - 670 = 7,160
    assert.deepEqual(v, {
      ppe: 2500,
      nonCurrentAssets: 2500,
      mainCash: 1650,
      bank: 4690,
      cash: 6340,
      receivables: 400,
      finishedGoods: 5100,
      rawMaterials: 1040,
      onRuns: 1200,
      currentAssets: 14080,
      loans: 2500,
      nonCurrentLiabilities: 2500,
      payables: 450,
      currentLiabilities: 450,
      openingCapital: 1000,
      introduced: 5000,
      drawings: -200,
      retained: 670,
      preSystem: 7160,
      equity: 13630,
    });
    assert.deepEqual(
      [
        await cardNum(page, "Total Assets"),
        await cardNum(page, "Total Liabilities"),
        await cardNum(page, "Net Assets / Equity"),
        await cardNum(page, "Retained Earnings"),
      ],
      [16580, 2950, 13630, 670],
    );
    const text = await page.locator("main").innerText();
    assert.match(text, /Non-current Assets[\s\S]*Current Assets/i);
    assert.match(text, /Non-current Liabilities[\s\S]*Current Liabilities/i);
    assert.match(text, /Total Liabilities\s+Rs\. 2,950/);
    assert.match(text, /Total Liabilities and Equity\s+Rs\. 16,580/);
    assert.match(text, /Balanced — total assets equal total liabilities and equity\./);
    await page.context().close();
  });

  test("ST-2 Profit or Loss: sales returns come off revenue; equipment and loans stay out of profit", async () => {
    const page = await openApp(browser);
    await accountingTab(page, "Profit or Loss");
    // sales 1,000 + 400 + 1,100 = 2,500; returns 1,100; cost of goods 600 + 600 - 600 = 600
    // gross profit 1,400 - 600 = 800; rent 150; interest 20; net profit 670
    assert.deepEqual(
      [
        await cardNum(page, "Revenue"),
        await cardNum(page, "Gross Profit"),
        await cardNum(page, "Operating Expenses"),
        await cardNum(page, "Net Profit"),
      ],
      [1400, 800, 150, 670],
    );
    assert.deepEqual(
      [
        await stmt(page, "Sales"),
        await stmt(page, "Less: Sales Returns"),
        await stmt(page, "Total Revenue"),
        await stmt(page, "Cost of Goods Sold"),
        await stmt(page, "Gross Profit"),
        await stmt(page, "Operating Profit"),
      ],
      [2500, -1100, 1400, -600, 800, 650],
    );
    const text = await page.locator("main").innerText();
    for (const re of [
      /57\.14% margin/,
      /Rent\s+\(Rs\. 150\)/,
      /Interest Income\s+Rs\. 20/,
      /Net Profit for the Period\s+Rs\. 670/,
      /Fixed asset purchases[\s\S]*?Rs\. 2,500/,
      /Loans received[\s\S]*?Rs\. 3,000/,
      /Loans repaid\s+Rs\. 500/,
      /Owner's capital introduced\s+Rs\. 5,000/,
      /Customer receipts against invoices already booked\s+Rs\. 50/,
      /Supplier bills settled\s+Rs\. 80/,
    ])
      assert.match(text, re);
    // ten lines are kept out of profit: stock, capital, drawings, two transfer lines, a collection,
    // a supplier payment, equipment, the loan and its repayment
    await page.getByRole("button", { name: "Show the 10 excluded line(s)" }).click();
    const treatments = await page.locator("main table").last().locator("tbody tr td:nth-child(3)").allInnerTexts();
    assert.ok(treatments.includes("Fixed asset purchase — Statement of Financial Position"), treatments.join("|"));
    assert.ok(treatments.includes("Loan received — liability, not income"));
    assert.ok(treatments.includes("Loan repaid — liability, not an expense"));
    await page.context().close();
  });

  test("ST-3 Statement of Cash Flows: operating, investing and financing, closing on the cash balances", async () => {
    const page = await openApp(browser);
    await accountingTab(page, "Statement of Cash Flows");
    assert.deepEqual(
      [
        await cardNum(page, "Cash from Operations"),
        await cardNum(page, "Cash from Investing"),
        await cardNum(page, "Cash from Financing"),
        await cardNum(page, "Net Change in Cash"),
      ],
      [540, -2500, 7300, 5340],
    );
    // customers 1,000 + 50 + 1,100; refunds 1,100; stock 300; supplier 80; rent 150; interest 20 => 540
    // financing 5,000 - 200 + 3,000 - 500 = 7,300; 540 - 2,500 + 7,300 = 5,340; 1,000 + 5,340 = 6,340
    const v = {};
    for (const [key, label] of Object.entries({
      customers: "Cash received from customers",
      other: "Other income received",
      refunds: "Refunds paid to customers",
      stock: "Paid for stock and raw materials",
      suppliers: "Supplier bills settled",
      expenses: "Operating expenses paid",
      operating: "Net Cash from Operating Activities",
      equipment: "Purchase of property, plant and equipment",
      investing: "Net Cash used in Investing Activities",
      capital: "Owner's capital introduced",
      drawings: "Owner's drawings",
      loansIn: "Loans received",
      loansOut: "Loans repaid",
      financing: "Net Cash from Financing Activities",
      change: "Net Increase / (Decrease) in Cash",
      start: "Cash at the start of the period",
      end: "Cash at the end of the period",
      cashAccount: "Cash Account",
      bank: "Bank Account",
      profit: "Net profit for the period",
      receivables: "Decrease / (increase) in trade receivables",
      inventory: "Decrease / (increase) in inventory, net of trade payables",
      fromProfit: "Net Cash from Operations",
    }))
      v[key] = await stmt(page, label);
    log(JSON.stringify(v));
    assert.deepEqual(v, {
      customers: 2150,
      other: 20,
      refunds: -1100,
      stock: -300,
      suppliers: -80,
      expenses: -150,
      operating: 540,
      equipment: -2500,
      investing: -2500,
      capital: 5000,
      drawings: -200,
      loansIn: 3000,
      loansOut: -500,
      financing: 7300,
      change: 5340,
      start: 1000,
      end: 6340,
      cashAccount: 1650,
      bank: 4690,
      // profit 670, less 350 (400 sold on credit, 50 of it collected), plus 220 (600 of stock used up,
      // less 300 of stock bought and 80 of supplier bills paid) = 540
      profit: 670,
      receivables: -350,
      inventory: 220,
      fromProfit: 540,
    });
    const text = await page.locator("main").innerText();
    assert.match(text, /Agrees with the Cash & Bank balances \(Rs\. 6,340\)\./);
    assert.match(text, /Agrees with the net cash from operating activities above\./);
    assert.equal((await page.locator("main").innerText()).includes("should be nil"), false, "no stray transfer line");
    await page.context().close();
  });

  test("ST-4 Cash Flows: a period opens with the cash the day before, and periods join up", async () => {
    const page = await openApp(browser);
    await accountingTab(page, "Statement of Cash Flows");
    const dates = page.locator("main input[type=date]");
    const read = async () => ({
      customers: await stmt(page, "Cash received from customers"),
      operating: await stmt(page, "Net Cash from Operating Activities"),
      investing: await stmt(page, "Net Cash used in Investing Activities"),
      financing: await stmt(page, "Net Cash from Financing Activities"),
      start: await stmt(page, "Cash at the start of the period"),
      end: await stmt(page, "Cash at the end of the period"),
    });
    const period = async (from, to) => {
      await dates.nth(0).fill(from);
      await dates.nth(1).fill(to);
      return read();
    };
    // January: 1,000 sale + 20 interest - 150 rent
    const jan = await period("2025-01-01", "2025-01-31");
    assert.deepEqual(jan, { customers: 1000, operating: 870, investing: 0, financing: 0, start: 1000, end: 1870 });
    assert.match(await page.locator("main").innerText(), /for Jan 1 to Jan 31/);
    // February: 50 collected - 300 stock - 80 supplier; equipment 2,500; 5,000 - 200 + 3,000 - 500
    const feb = await period("2025-02-01", "2025-02-28");
    assert.deepEqual(feb, {
      customers: 50,
      operating: -330,
      investing: -2500,
      financing: 7300,
      start: 1870,
      end: 6340,
    });
    // March: the sale and its refund cancel out
    const mar = await period("2025-03-01", "2025-03-31");
    assert.deepEqual(mar, { customers: 1100, operating: 0, investing: 0, financing: 0, start: 6340, end: 6340 });
    assert.equal(feb.start, jan.end, "February opens where January closed");
    assert.equal(mar.start, feb.end, "March opens where February closed");
    // the shortcut buttons: today nothing has happened, so cash neither opens nor closes differently
    await page.getByRole("button", { name: "Today", exact: true }).click();
    assert.deepEqual(await read(), {
      customers: 0,
      operating: 0,
      investing: 0,
      financing: 0,
      start: 6340,
      end: 6340,
    });
    await page.getByRole("button", { name: "All time" }).click();
    assert.equal(await stmt(page, "Cash at the end of the period"), 6340);
    // a start date after the end date is explained, instead of showing a statement that cannot be right
    await dates.nth(0).fill("2025-03-01");
    await dates.nth(1).fill("2025-02-01");
    await page.getByText("The start date is after the end date.").waitFor();
    assert.equal(await page.locator("main").getByText("Net Cash from Operating Activities").count(), 0);
    assert.equal(await page.locator("main").getByText("Does not agree").count(), 0, "no false alarm");
    await dates.nth(1).fill("2025-03-31");
    await page.getByText("The start date is after the end date.").waitFor({ state: "detached" });
    assert.equal(await stmt(page, "Cash at the end of the period"), 6340);
    await page.context().close();
  });

  test("ST-5 Statement of Changes in Equity: capital, retained earnings and the opening-balance line", async () => {
    const page = await openApp(browser);
    await accountingTab(page, "Statement of Changes in Equity");
    assert.deepEqual(
      [
        await cardNum(page, "Opening Equity"),
        await cardNum(page, "Profit for the Period"),
        await cardNum(page, "Capital less Drawings"),
        await cardNum(page, "Closing Equity"),
      ],
      [8160, 670, 4800, 13630],
    );
    const header = (await page.locator("main table thead th").allInnerTexts()).map((c) => c.trim());
    assert.deepEqual(header, ["", "Capital", "Retained earnings", "Opening balance equity", "Total equity"]);
    // opening: capital 1,000, no profit yet, opening-balance line 7,160. Then profit 670, capital 5,000, drawings 200
    assert.deepEqual(await equityTable(page), [
      ["Balance at the start (beginning)", "Rs. 1,000", "Rs. 0", "Rs. 7,160", "Rs. 8,160"],
      ["Profit for the period", "", "Rs. 670", "", "Rs. 670"],
      ["Capital introduced", "Rs. 5,000", "", "", "Rs. 5,000"],
      ["Owner's drawings", "(Rs. 200)", "", "", "(Rs. 200)"],
      [`Balance at the end (${todayLabel()})`, "Rs. 5,800", "Rs. 670", "Rs. 7,160", "Rs. 13,630"],
    ]);
    assert.match(
      await page.locator("main").innerText(),
      /Closing equity agrees with Total Equity on the Statement of Financial Position\./,
    );
    // February alone: opens with January's profit (270) and everything before it
    const dates = page.locator("main input[type=date]");
    await dates.nth(0).fill("2025-02-01");
    await dates.nth(1).fill("2025-02-28");
    assert.deepEqual(await equityTable(page), [
      ["Balance at the start (Feb 1)", "Rs. 1,000", "Rs. 270", "Rs. 7,160", "Rs. 8,430"],
      ["Profit for the period", "", "Rs. 400", "", "Rs. 400"],
      ["Capital introduced", "Rs. 5,000", "", "", "Rs. 5,000"],
      ["Owner's drawings", "(Rs. 200)", "", "", "(Rs. 200)"],
      ["Balance at the end (Feb 28)", "Rs. 5,800", "Rs. 670", "Rs. 7,160", "Rs. 13,630"],
    ]);
    assert.match(await page.locator("main").innerText(), /Opening balance equity does not move/);
    await dates.nth(0).fill("2025-03-01");
    await dates.nth(1).fill("2025-02-01");
    await page.getByText("The start date is after the end date.").waitFor();
    assert.equal(await page.locator("main table").count(), 0, "no table for an impossible period");
    await page.context().close();
  });

  test("ST-6 the statements agree with each other", async () => {
    const page = await openApp(browser);
    await accountingTab(page, "Profit or Loss");
    const profit = await cardNum(page, "Net Profit");
    await openTab(page, "Statement of Financial Position");
    const sofp = {
      cash: await stmt(page, "Total Cash & Bank"),
      equity: await stmt(page, "Total Equity"),
      retained: await stmt(page, "Retained Earnings"),
    };
    await openTab(page, "Statement of Cash Flows");
    const cf = {
      closing: await stmt(page, "Cash at the end of the period"),
      profit: await stmt(page, "Net profit for the period"),
    };
    await openTab(page, "Statement of Changes in Equity");
    const eq = { profit: await cardNum(page, "Profit for the Period"), closing: await cardNum(page, "Closing Equity") };
    log(JSON.stringify({ profit, sofp, cf, eq }));
    assert.equal(cf.closing, sofp.cash, "cash flow closing cash = cash on the position");
    assert.equal(eq.closing, sofp.equity, "equity closing = total equity on the position");
    assert.deepEqual([cf.profit, eq.profit, sofp.retained], [profit, profit, profit], "one profit figure everywhere");
    await page.context().close();
  });

  test("ST-7 each statement exports to CSV and opens as a printable page", async () => {
    const page = await openApp(browser);
    const csv = () => download(page, () => page.locator("main button", { hasText: "CSV" }).first().click());
    const files = {};
    for (const [tab, file] of [
      ["Profit or Loss", "profit_or_loss_statement.csv"],
      ["Statement of Financial Position", "statement_of_financial_position.csv"],
      ["Statement of Cash Flows", "statement_of_cash_flows.csv"],
      ["Statement of Changes in Equity", "statement_of_changes_in_equity.csv"],
    ]) {
      await accountingTab(page, tab);
      const d = await csv();
      assert.equal(d.name, file);
      files[tab] = d.text;
    }
    // P&L
    const pnl = csvMap(files["Profit or Loss"]);
    assert.deepEqual(
      [pnl["Less: Sales returns"], pnl["Total Revenue"], pnl["GROSS PROFIT"], pnl["NET PROFIT FOR THE PERIOD"]],
      ["-1100", "1400", "800", "670"],
    );
    assert.deepEqual(
      [pnl["Fixed asset purchases"], pnl["Loans received"], pnl["Loans repaid"]],
      ["2500", "3000", "500"],
    );
    // position
    const pos = csvMap(files["Statement of Financial Position"]);
    assert.deepEqual(
      [
        pos["Property, Plant & Equipment (at cost)"],
        pos["Total Current Assets"],
        pos["TOTAL ASSETS"],
        pos["Loans Payable"],
        pos["Total Liabilities"],
        pos["Total Equity"],
        pos["TOTAL LIABILITIES AND EQUITY"],
      ],
      ["2500", "14080", "16580", "2500", "2950", "13630", "16580"],
    );
    // cash flows
    const cf = csvMap(files["Statement of Cash Flows"]);
    assert.deepEqual(
      [
        cf["Net cash from operating activities"],
        cf["Net cash used in investing activities"],
        cf["Net cash from financing activities"],
        cf["NET INCREASE / (DECREASE) IN CASH"],
        cf["CASH AT THE END OF THE PERIOD"],
        cf["Net cash from operations (reconciled)"],
      ],
      ["540", "-2500", "7300", "5340", "6340", "540"],
    );
    // equity: five columns
    const eq = parseCsv(files["Statement of Changes in Equity"]).filter((r) => r[0]);
    assert.deepEqual(eq[0], [
      "Statement of Changes in Equity — All time (up to today)",
      "Capital",
      "Retained earnings",
      "Opening balance equity",
      "Total equity",
    ]);
    assert.deepEqual(eq.at(-1).slice(1), ["5800", "670", "7160", "13630"]);
    // printable pages
    for (const [tab, title, last] of [
      ["Statement of Cash Flows", "Statement of Cash Flows", /<td>CASH AT THE END OF THE PERIOD<\/td><td>6340<\/td>/],
      ["Statement of Changes in Equity", "Statement of Changes in Equity", /<td>13630<\/td>/],
    ]) {
      await accountingTab(page, tab);
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator("main button", { hasText: "Print / PDF" }).first().click(),
      ]);
      await popup.waitForLoadState();
      const html = await popup.content();
      assert.match(html, new RegExp(`<h1>${title}`));
      assert.match(html, last);
      await popup.close();
    }
    await page.context().close();
  });

  test("ST-8 the Reports screen offers the new statements, with the same figures and a date range", async () => {
    const reports = [
      ["Statement of Cash Flows", "statement_of_cash_flows.csv"],
      ["Statement of Changes in Equity", "statement_of_changes_in_equity.csv"],
      ["Statement of Financial Position", "statement_of_financial_position.csv"],
      ["Profit or Loss Statement", "profit_or_loss_statement.csv"],
    ];
    const out = {};
    for (const [name, file] of reports) {
      // a fresh page each time: Chrome refuses a long run of downloads from one page
      const page = await openApp(browser, "Reports");
      const d = await download(page, () =>
        reportCard(page, name).getByRole("button", { name: "CSV / Excel" }).click(),
      );
      assert.equal(d.name, file);
      out[name] = d.text;
      await page.context().close();
    }
    const cf = csvMap(out["Statement of Cash Flows"]);
    assert.deepEqual(
      [cf["Net cash from operating activities"], cf["NET INCREASE / (DECREASE) IN CASH"], cf["CASH AT THE END OF THE PERIOD"]],
      ["540", "5340", "6340"],
    );
    const pos = csvMap(out["Statement of Financial Position"]);
    assert.deepEqual([pos["TOTAL ASSETS"], pos["Loans Payable"], pos["Total Equity"]], ["16580", "2500", "13630"]);
    const eq = parseCsv(out["Statement of Changes in Equity"]).filter((r) => r[0]);
    assert.deepEqual(eq.at(-1).slice(1), ["5800", "670", "7160", "13630"]);
    // the date range on the Reports screen limits the new statements too
    const page = await openApp(browser, "Reports");
    await page.locator("main input[type=date]").nth(0).fill("2025-01-01");
    await page.locator("main input[type=date]").nth(1).fill("2025-01-31");
    const jan = await download(page, () =>
      reportCard(page, "Statement of Cash Flows").getByRole("button", { name: "CSV / Excel" }).click(),
    );
    const janRows = csvMap(jan.text);
    log("January cash flow:", JSON.stringify(janRows));
    assert.deepEqual(
      [
        janRows["Net cash from operating activities"],
        janRows["Cash at the start of the period"],
        janRows["CASH AT THE END OF THE PERIOD"],
      ],
      ["870", "1000", "1870"],
    );
    const janEquity = await download(page, () =>
      reportCard(page, "Statement of Changes in Equity").getByRole("button", { name: "CSV / Excel" }).click(),
    );
    const janEq = parseCsv(janEquity.text).filter((r) => r[0]);
    assert.deepEqual(janEq[1].slice(1), ["1000", "0", "7160", "8160"], "January opens with the opening capital");
    assert.deepEqual(janEq.at(-1).slice(1), ["1000", "270", "7160", "8430"]);
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      reportCard(page, "Statement of Cash Flows").getByRole("button", { name: "PDF" }).click(),
    ]);
    await popup.waitForLoadState();
    assert.match(await popup.content(), /<h1>Statement of Cash Flows<\/h1>/);
    await popup.close();
    await page.context().close();
  });
});

/* ========================================================================== */
/* Other starting points: a brand-new business, and the built-in demo data    */
/* ========================================================================== */

const AGREE_MESSAGES = [
  ["Statement of Financial Position", /Balanced — total assets equal total liabilities and equity\./],
  ["Statement of Cash Flows", /Agrees with the Cash & Bank balances \(Rs\. [\d,.-]+\)\./],
  ["Statement of Cash Flows", /Agrees with the net cash from operating activities above\./],
  [
    "Statement of Changes in Equity",
    /Closing equity agrees with Total Equity on the Statement of Financial Position\./,
  ],
];

describe("other starting points", () => {
  test("ST-9 a brand-new business: every statement is nil, with no errors", async () => {
    const data = shopFixture();
    Object.assign(data, { products: [], customers: [], suppliers: [], rawMaterials: [] });
    data.cashAccounts.forEach((a) => (a.opening = 0));
    await loadStores(data);
    const page = await openApp(browser);
    await accountingTab(page, "Profit or Loss");
    assert.deepEqual(
      [await cardNum(page, "Revenue"), await cardNum(page, "Gross Profit"), await cardNum(page, "Net Profit")],
      [0, 0, 0],
    );
    assert.match(await page.locator("main").innerText(), /0% margin/);
    await accountingTab(page, "Statement of Financial Position");
    assert.deepEqual(
      [
        await cardNum(page, "Total Assets"),
        await cardNum(page, "Total Liabilities"),
        await cardNum(page, "Net Assets / Equity"),
      ],
      [0, 0, 0],
    );
    await accountingTab(page, "Statement of Cash Flows");
    assert.deepEqual(
      [
        await stmt(page, "Net Cash from Operating Activities"),
        await stmt(page, "Cash at the start of the period"),
        await stmt(page, "Cash at the end of the period"),
      ],
      [0, 0, 0],
    );
    await accountingTab(page, "Statement of Changes in Equity");
    assert.deepEqual(await equityTable(page), [
      ["Balance at the start (beginning)", "Rs. 0", "Rs. 0", "Rs. 0", "Rs. 0"],
      ["Profit for the period", "", "Rs. 0", "", "Rs. 0"],
      ["Capital introduced", "Rs. 0", "", "", "Rs. 0"],
      ["Owner's drawings", "Rs. 0", "", "", "Rs. 0"],
      [`Balance at the end (${todayLabel()})`, "Rs. 0", "Rs. 0", "Rs. 0", "Rs. 0"],
    ]);
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });

  test("ST-10 the built-in demo data (older-style ledger lines) agrees on every statement", async () => {
    await wipeDatabase();
    const page = await newPage(browser);
    await page.goto("/");
    await page.getByText("Start with demo data").click();
    await page.locator("aside nav").waitFor();
    await waitSaved(page);
    let current = "";
    for (const [tab, message] of AGREE_MESSAGES) {
      if (tab !== current) {
        await accountingTab(page, tab);
        current = tab;
      }
      const text = await page.locator("main").innerText();
      assert.match(text, message, tab);
      assert.equal(text.includes("Out of balance"), false, tab);
      assert.equal(text.includes("does not agree"), false, tab);
    }
    // the same story in numbers, read from the position and the equity statement
    await accountingTab(page, "Statement of Financial Position");
    const equity = await cardNum(page, "Net Assets / Equity");
    await accountingTab(page, "Statement of Changes in Equity");
    assert.equal(await cardNum(page, "Closing Equity"), equity, "closing equity = total equity");
    await accountingTab(page, "Statement of Cash Flows");
    const closing = await stmt(page, "Cash at the end of the period");
    await accountingTab(page, "Statement of Financial Position");
    assert.equal(await stmt(page, "Total Cash & Bank"), closing, "closing cash = cash on the position");
    log(`demo data: equity ${equity}, cash ${closing}`);
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });
});

/* ========================================================================== */
/* 2. A month in the life of the shop                                         */
/* ========================================================================== */

// The shop starts as shopFixture(): Cash Account 5,000, no bank money, tax 10%,
//   Alpha Printer 10 @ cost 600 (price 1,000)    Beta Toner 3 @ 100 (price 250)
//   Resin 10 @ 100, Ink Base 1 @ 40               no owner capital recorded
// so assets are 5,000 + 6,300 of finished goods + 1,040 of raw materials = 12,340.
// There are no liabilities, no capital and no profit yet, so the Statement of
// Financial Position's opening-balance line is 12,340. It stands for what existed
// before the books began, so it must stay 12,340 whatever the shop does from here:
// if any step is posted wrongly, the difference lands in that line and shows.
const START_OPENING_BALANCE = 12340;

describe("a month in the life of the shop", () => {
  let page;
  before(async () => {
    await loadStores(shopFixture());
    page = await openApp(browser, "Point of Sale");
  });
  after(() => page.context().close());

  /** The Statement of Financial Position as it is on screen now. */
  async function position() {
    await accountingTab(page, "Statement of Financial Position");
    const get = (label) => stmt(page, label);
    return {
      ppe: await get("Property, Plant & Equipment (at cost)"),
      cash: await get("Total Cash & Bank"),
      receivables: await get("Trade Receivables"),
      finishedGoods: await get("Inventory — Finished Goods (at cost)"),
      rawMaterials: await get("Inventory — Raw Materials (at cost)"),
      onRuns: await get("Inventory — Stock out on Delivery Runs (at cost)"),
      loans: await get("Loans Payable"),
      payables: await get("Trade Payables"),
      capital: (await get("Opening Capital")) + (await get("Capital Introduced")) + (await get("Owner's Drawings")),
      retained: await get("Retained Earnings"),
      openingBalance: await get("Opening Balance Equity"),
      totalAssets: await cardNum(page, "Total Assets"),
      totalLiabilities: await cardNum(page, "Total Liabilities"),
      equity: await cardNum(page, "Net Assets / Equity"),
    };
  }
  /**
   * After a step: the opening-balance line has not moved, the statement still
   * balances, and the balances the step should have changed are what was worked out.
   */
  async function expectPosition(step, expected) {
    const p = await position();
    const why = `${step}: ${JSON.stringify(p)}`;
    assert.equal(
      p.openingBalance,
      START_OPENING_BALANCE,
      `${step}: the opening-balance line moved to ${p.openingBalance} — something was posted that the statements do not account for`,
    );
    assert.equal(p.totalAssets, p.totalLiabilities + p.equity, `${step}: assets = liabilities + equity`);
    assert.deepEqual({ ...p, ...expected }, p, why);
    return p;
  }
  const productCard = (name) => page.locator("main button", { hasText: name }).first();
  const cart = () => page.locator("div.rounded-2xl", { has: page.locator("h3", { hasText: "Current Sale" }) });
  const itemRows = (m) => m.locator("div.space-y-2 > div");

  async function salesOrder({ items, status, payment }) {
    await nav(page, "Sales Orders");
    await page.getByRole("button", { name: "New Order" }).click();
    const m = modal(page);
    await field(m, "Customer").selectOption("201");
    for (let i = 0; i < items.length; i++) {
      if (i > 0) await m.getByRole("button", { name: "Add line item" }).click();
      await itemRows(m).nth(i).locator("select").selectOption(String(items[i].productId));
      await itemRows(m).nth(i).locator("input[type=number]").first().fill(String(items[i].qty));
    }
    await field(m, "Fulfillment Status").selectOption(status);
    await field(m, "Payment Status").selectOption(payment);
    await m.getByRole("button", { name: "Create Sales Order" }).click();
  }
  async function returnItem(orderId, { disposition }) {
    await nav(page, "Sales Orders");
    await row(page, orderId).click();
    await modal(page).getByRole("button", { name: "Return Items" }).click();
    const m = modal(page);
    await field(m, "Returned Item").selectOption("0");
    await field(m, "Return Quantity").fill("1");
    await field(m, "Returns").selectOption(disposition);
    await m.getByRole("button", { name: "Record Return" }).click();
  }
  async function purchase({ qty, cost, settlement }) {
    await nav(page, "Purchases");
    await page.getByRole("button", { name: "New Purchase Order" }).click();
    const m = modal(page);
    await field(m, "Supplier").selectOption("301");
    const r = itemRows(m).nth(0);
    await r.locator("select").selectOption("401");
    await r.getByPlaceholder("Qty").fill(String(qty));
    await r.getByPlaceholder("Unit cost").fill(String(cost));
    await field(m, "Settlement").selectOption(settlement);
    await m.getByRole("button", { name: "Save Purchase Order" }).click();
  }
  async function cashMove(button, { account, source, amount }) {
    await nav(page, "Cash & Bank");
    await page.getByRole("button", { name: button }).click();
    const m = modal(page);
    await field(m, "Account").selectOption(account);
    await field(m, source.label).selectOption(source.value);
    await field(m, "Amount").fill(String(amount));
    await m.getByRole("button", { name: "Record" }).click();
  }
  async function ledgerEntry({ category, amount, account, description }) {
    await accountingTab(page, "Ledger & Overview"); // the screen remembers the tab it was left on
    await page.getByRole("button", { name: "New Entry" }).click();
    const m = modal(page);
    await field(m, "Description").fill(description);
    await field(m, "Category").selectOption(category);
    await field(m, "Amount").fill(String(amount));
    await field(m, "Paid From").selectOption(account);
    await m.getByRole("button", { name: "Record Expense" }).click();
  }

  test("J01 a cash sale at the till: 2 printers, 2,000 + 10% tax = 2,200", async () => {
    await nav(page, "Point of Sale");
    await productCard("Alpha Printer").click();
    await productCard("Alpha Printer").click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    assert.match(await toast(page).innerText(), /^Sale completed — Rs\. 2,200 received via Cash\./);
    await waitSaved(page);
    // cash 5,000 + 2,200; printers 8 x 600 + toner 300 = 5,100; profit 2,200 - 1,200 = 1,000
    await expectPosition("J01", {
      cash: 7200,
      finishedGoods: 5100,
      totalAssets: 13340,
      equity: 13340,
      retained: 1000,
    });
  });

  test("J02 a card sale to a customer lands in the bank: 1 toner, 250 + 25 tax = 275", async () => {
    await nav(page, "Point of Sale");
    await field(cart(), "Customer").selectOption("201");
    await productCard("Beta Toner").click();
    await cart().getByRole("button", { name: "Card", exact: true }).click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    assert.match(await toast(page).innerText(), /^Sale completed — Rs\. 275 received via Card\./);
    await waitSaved(page);
    // cash 7,200 + 275; toner 2 x 100 + printers 4,800 = 5,000; profit 1,000 + 275 - 100 = 1,175
    await expectPosition("J02", {
      cash: 7475,
      finishedGoods: 5000,
      totalAssets: 13515,
      equity: 13515,
      retained: 1175,
    });
  });

  test("J03 an order on credit: 1 printer + 1 toner = 1,250 + 125 tax = 1,375, not yet paid", async () => {
    await salesOrder({
      items: [
        { productId: 101, qty: 1 },
        { productId: 102, qty: 1 },
      ],
      status: "Delivered",
      payment: "Pending",
    });
    assert.match(await toast(page).innerText(), /^Sales order SO-1045 created for Acme Traders — Rs\. 1,375\./);
    await waitSaved(page);
    // nothing in cash; 1,375 owed by the customer; printers 7 x 600 + toner 100 = 4,300
    // assets 7,475 + 1,375 + 4,300 + 1,040 = 14,190; profit 1,175 + 1,375 - 700 = 1,850
    await expectPosition("J03", {
      cash: 7475,
      receivables: 1375,
      finishedGoods: 4300,
      totalAssets: 14190,
      equity: 14190,
      retained: 1850,
    });
  });

  test("J04 the customer pays 375 of it: cash up, receivable down, profit untouched", async () => {
    await nav(page, "Sales Orders");
    await row(page, "SO-1045").getByRole("button", { name: "Collect" }).click();
    await field(modal(page), "Amount Received Now").fill("375");
    await modal(page).getByRole("button", { name: "Record" }).click();
    assert.match(await toast(page).innerText(), /^Rs\. 375 received from Acme Traders\. Balance remaining Rs\. 1,000\./);
    await closeModal(page);
    await waitSaved(page);
    // assets 7,850 + 1,000 + 4,300 + 1,040 = 14,190, as before: collecting money is not new income
    await expectPosition("J04", {
      cash: 7850,
      receivables: 1000,
      finishedGoods: 4300,
      totalAssets: 14190,
      equity: 14190,
      retained: 1850,
    });
  });

  test("J05 the customer returns the printer, which goes back on the shelf", async () => {
    // 1,000 + 10% = 1,100 comes off the order (1,375 -> 275). The customer had paid 375,
    // so 100 is handed back and the other 1,000 comes off what they still owed.
    await returnItem("SO-1045", { disposition: "stock" });
    assert.match(
      await toast(page).innerText(),
      /^1 × Alpha Printer returned from SO-1045 — Rs\. 1,100 reduced, added back to stock\. Refund of Rs\. 100 paid out\./,
    );
    await closeModal(page);
    await waitSaved(page);
    // cash 7,850 - 100; owed 0; printers 8 x 600 + toner 100 = 4,900
    // profit: sales returns 1,100, cost of goods 700 - 600 = 100 => 1,850 - 1,100 + 600 = 1,350
    await expectPosition("J05", {
      cash: 7750,
      receivables: 0,
      finishedGoods: 4900,
      totalAssets: 13690,
      equity: 13690,
      retained: 1350,
    });
  });

  test("J06 a printer from the cash sale comes back damaged: refunded, not restocked, written off", async () => {
    // 1,100 refunded from cash; the printer's 600 of cost is an expense, not stock
    await returnItem("SO-1043", { disposition: "expense" });
    assert.match(await toast(page).innerText(), /added to expenses\. Refund of Rs\. 1,100 paid out\./);
    await closeModal(page);
    await waitSaved(page);
    // cash 7,750 - 1,100; stock unchanged 4,900; profit 1,350 - 1,100 (returns) + 600 (cost reversed) - 600 (written off) = 250
    await expectPosition("J06", {
      cash: 6650,
      finishedGoods: 4900,
      totalAssets: 12590,
      equity: 12590,
      retained: 250,
    });
    // the Profit or Loss statement so far: sales 3,850 - returns 2,200 = 1,650; cost of goods 800; written off 600
    await accountingTab(page, "Profit or Loss");
    assert.deepEqual(
      [await stmt(page, "Total Revenue"), await stmt(page, "Gross Profit"), await cardNum(page, "Net Profit")],
      [1650, 850, 250],
    );
  });

  test("J07 raw materials bought for cash: 5 resin at 120 = 600", async () => {
    await purchase({ qty: 5, cost: 120, settlement: "Paid" });
    assert.match(await toast(page).innerText(), /^Purchase order PO-4001 recorded — Rs\. 600 paid from Cash Account\./);
    await waitSaved(page);
    // cash 6,650 - 600; resin 15 at an average 106.67 = 1,600 + ink 40 = 1,640; nothing to profit
    await expectPosition("J07", {
      cash: 6050,
      rawMaterials: 1640,
      totalAssets: 12590,
      equity: 12590,
      retained: 250,
    });
  });

  test("J08 raw materials bought on credit: 5 resin at 130 = 650 owed to the supplier", async () => {
    await purchase({ qty: 5, cost: 130, settlement: "Unpaid" });
    assert.match(await toast(page).innerText(), /^Purchase order PO-4002 recorded on credit — Rs\. 650 now shows as a payable\./);
    await waitSaved(page);
    // resin 20 at an average 112.50 = 2,250 + ink 40 = 2,290; 650 owed; no cash moved
    await expectPosition("J08", {
      rawMaterials: 2290,
      payables: 650,
      totalAssets: 13240,
      totalLiabilities: 650,
      equity: 12590,
    });
  });

  test("J09 the supplier is paid: cash down, the payable cleared, profit untouched", async () => {
    await nav(page, "Purchases");
    await row(page, "PO-4002").click();
    await modal(page).getByRole("button", { name: "Pay Rs. 650 to Supplier" }).click();
    await closeModal(page);
    await waitSaved(page);
    await expectPosition("J09", {
      cash: 5400,
      payables: 0,
      totalAssets: 12590,
      totalLiabilities: 0,
      equity: 12590,
    });
  });

  test("J10 a delivery run goes out with 3 printers: the stock is still the shop's, on the van", async () => {
    await nav(page, "Delivery Stock");
    await page.getByRole("button", { name: "New Delivery Run" }).click();
    const m = modal(page);
    await itemRows(m).nth(0).locator("select").selectOption("101");
    await itemRows(m).nth(0).locator("input").fill("3");
    await m.getByRole("button", { name: "Start Delivery Run" }).click();
    await waitSaved(page);
    // printers on the shelf 8 -> 5: 5 x 600 + toner 100 = 3,100; 3 x 600 = 1,800 on the van; nothing is sold yet,
    // so assets, equity and profit are exactly as before
    await expectPosition("J10", {
      finishedGoods: 3100,
      onRuns: 1800,
      totalAssets: 12590,
      equity: 12590,
    });
  });

  test("J11 the run is closed: 2 sold (1 of them on credit), 1 back, 150 of expenses", async () => {
    await nav(page, "Delivery Stock");
    await row(page, "DR-1001").getByRole("button", { name: "Close Run" }).click();
    const m = modal(page);
    const alpha = m.locator("div.space-y-3").first().locator(":scope > div").nth(0);
    await alpha.locator("input[type=number]").nth(0).fill("2"); // 2 of 3 sold, so 1 comes back
    await m.getByRole("button", { name: "Add Credit Bill" }).click();
    const bill = m.locator("div.mt-3.space-y-3 > div").nth(0);
    await field(bill, "Shop Name (credit bill 1)").fill("Corner Shop");
    await bill.locator("input[type=number]").nth(0).fill("1");
    await field(m, "Daily Expense").fill("150");
    await m.locator("button[type=submit]").click();
    assert.match(
      await toast(page).innerText(),
      /^Delivery run DR-1001 closed — Rs\. 2,000 in sales \(Rs\. 1,000 on credit from 1 shop\)/,
    );
    await waitSaved(page);
    // 1,000 in cash and 1,000 on credit; cost of goods 2 x 600 = 1,200; 150 of expenses paid from cash
    // cash 5,400 + 1,000 - 150; owed 1,000; printers 6 x 600 + toner 100 = 3,700; the van is empty
    // profit 250 + 2,000 - 1,200 - 150 = 900
    await expectPosition("J11", {
      cash: 6250,
      receivables: 1000,
      finishedGoods: 3700,
      onRuns: 0,
      totalAssets: 13240,
      equity: 13240,
      retained: 900,
    });
  });

  test("J12 the corner shop pays its credit bill: cash in, receivable cleared, no new income", async () => {
    await nav(page, "Sales Orders");
    await row(page, "Corner Shop").click();
    await modal(page).getByRole("button", { name: "Settle full balance" }).click();
    await closeModal(page);
    await waitSaved(page);
    await expectPosition("J12", {
      cash: 7250,
      receivables: 0,
      totalAssets: 13240,
      equity: 13240,
      retained: 900,
    });
  });

  test("J13 rent of 300 is paid from cash: an expense", async () => {
    await ledgerEntry({ category: "Rent", amount: 300, account: "CASH-MAIN", description: "Shop rent" });
    await waitSaved(page);
    await expectPosition("J13", { cash: 6950, totalAssets: 12940, equity: 12940, retained: 600 });
  });

  test("J14 the owner puts 2,000 into the bank: capital, not income", async () => {
    await cashMove("Money In", {
      account: "BANK-MAIN",
      source: { label: "Received As", value: "Owner Capital" },
      amount: 2000,
    });
    await waitSaved(page);
    await expectPosition("J14", { cash: 8950, capital: 2000, totalAssets: 14940, equity: 14940 });
  });

  test("J15 the owner draws 500 in cash: equity down, not an expense", async () => {
    await cashMove("Money Out", {
      account: "CASH-MAIN",
      source: { label: "Paid As", value: "Owner Drawings" },
      amount: 500,
    });
    await waitSaved(page);
    await expectPosition("J15", { cash: 8450, capital: 1500, totalAssets: 14440, equity: 14440 });
  });

  test("J16 a loan of 3,000 is received: a liability, not income", async () => {
    await cashMove("Money In", {
      account: "BANK-MAIN",
      source: { label: "Received As", value: "Loan Received" },
      amount: 3000,
    });
    await waitSaved(page);
    await expectPosition("J16", {
      cash: 11450,
      loans: 3000,
      totalAssets: 17440,
      totalLiabilities: 3000,
      equity: 14440,
    });
  });

  test("J17 equipment for 2,500 is bought from the bank: cash becomes a non-current asset", async () => {
    await ledgerEntry({
      category: "Fixed Asset Purchase",
      amount: 2500,
      account: "BANK-MAIN",
      description: "Cutting machine",
    });
    await waitSaved(page);
    await expectPosition("J17", {
      cash: 8950,
      ppe: 2500,
      loans: 3000,
      totalAssets: 17440,
      totalLiabilities: 3000,
      equity: 14440,
    });
  });

  test("J18 500 of the loan is repaid: cash and the liability both down", async () => {
    await cashMove("Money Out", {
      account: "BANK-MAIN",
      source: { label: "Paid As", value: "Loan Repayment" },
      amount: 500,
    });
    await waitSaved(page);
    await expectPosition("J18", {
      cash: 8450,
      loans: 2500,
      totalAssets: 16940,
      totalLiabilities: 2500,
      equity: 14440,
    });
  });

  test("J19 1,000 moves from the cash drawer to the bank: nothing changes but where the money is", async () => {
    await nav(page, "Cash & Bank");
    await page.getByRole("button", { name: "Transfer" }).click();
    const m = modal(page);
    await field(m, "From Account").selectOption("CASH-MAIN");
    await field(m, "To Account").selectOption("BANK-MAIN");
    await field(m, "Amount").fill("1000");
    await m.getByRole("button", { name: "Record" }).click();
    await waitSaved(page);
    await expectPosition("J19", { cash: 8450, totalAssets: 16940, equity: 14440 });
  });

  test("J20 everything was saved the way the statements read it", async () => {
    const s = await stores();
    const kinds = Object.fromEntries(
      ["Fixed Asset Purchase", "Loan Received", "Loan Repayment", "Owner Capital", "Owner Drawings"].map((c) => [
        c,
        s.ledger.find((t) => t.category === c)?.kind,
      ]),
    );
    log(JSON.stringify(kinds));
    assert.deepEqual(kinds, {
      "Fixed Asset Purchase": "fixed_asset",
      "Loan Received": "loan_in",
      "Loan Repayment": "loan_out",
      "Owner Capital": "capital_in",
      "Owner Drawings": "capital_out",
    });
    const cashKinds = s.ledger.filter((t) => t.category === "Sales Returns").map((t) => [t.amount, t.cash]);
    assert.deepEqual(
      cashKinds.sort((a, b) => a[0] - b[0]),
      [
        [100, true],
        [1000, false],
        [1100, true],
      ],
    );
  });

  test("J21 Profit or Loss at month end", async () => {
    await accountingTab(page, "Profit or Loss");
    // sales 2,200 + 275 + 1,375 + 2,000 = 5,850; returns 1,100 + 1,100 = 2,200; net revenue 3,650
    // cost of goods 1,200 + 100 + 700 - 600 - 600 + 1,200 = 2,000; gross profit 1,650 (45.21%)
    // expenses: goods written off 600 + delivery expenses 150 + rent 300 = 1,050; net profit 600
    assert.deepEqual(
      [
        await cardNum(page, "Revenue"),
        await cardNum(page, "Gross Profit"),
        await cardNum(page, "Operating Expenses"),
        await cardNum(page, "Net Profit"),
      ],
      [3650, 1650, 1050, 600],
    );
    assert.deepEqual(
      [
        await stmt(page, "Sales"),
        await stmt(page, "Less: Sales Returns"),
        await stmt(page, "Total Revenue"),
        await stmt(page, "Cost of Goods Sold"),
        await stmt(page, "Returned Goods Written Off"),
        await stmt(page, "Daily Expense"),
        await stmt(page, "Rent"),
        await stmt(page, "Total Operating Expenses"),
        await stmt(page, "Operating Profit"),
      ],
      [5850, -2200, 3650, -2000, -600, -150, -300, -1050, 600],
    );
    const text = await page.locator("main").innerText();
    assert.match(text, /45\.21% margin/);
    assert.match(text, /Net Profit for the Period\s+Rs\. 600/);
    // kept out of profit: 600 of stock bought, 2,500 of equipment, 2,000 capital, 500 drawings, 3,000 + 500 of loan,
    // 2 x 1,000 moved between accounts, 1,375 collected from customers, 650 paid to the supplier
    for (const re of [
      /Stock & raw material purchases[\s\S]*?Rs\. 600/,
      /Fixed asset purchases[\s\S]*?Rs\. 2,500/,
      /Owner's capital introduced\s+Rs\. 2,000/,
      /Owner's drawings\s+Rs\. 500/,
      /Loans received[\s\S]*?Rs\. 3,000/,
      /Loans repaid\s+Rs\. 500/,
      /Transfers between own accounts\s+Rs\. 2,000/,
      /Customer receipts against invoices already booked\s+Rs\. 1,375/,
      /Supplier bills settled\s+Rs\. 650/,
    ])
      assert.match(text, re);
  });

  test("J22 Statement of Financial Position at month end", async () => {
    const p = await expectPosition("J22", {
      ppe: 2500,
      cash: 8450,
      receivables: 0,
      finishedGoods: 3700,
      rawMaterials: 2290,
      onRuns: 0,
      loans: 2500,
      payables: 0,
      capital: 1500,
      retained: 600,
      openingBalance: 12340,
      totalAssets: 16940,
      totalLiabilities: 2500,
      equity: 14440,
    });
    log(JSON.stringify(p));
    // 2,500 + (8,450 + 0 + 3,700 + 2,290) = 16,940 = liabilities 2,500 + equity (1,500 + 600 + 12,340)
    const text = await page.locator("main").innerText();
    assert.match(text, /Total Non-current Assets\s+Rs\. 2,500/);
    assert.match(text, /Total Current Assets\s+Rs\. 14,440/);
    assert.match(text, /Total Non-current Liabilities\s+Rs\. 2,500/);
    assert.match(text, /Total Equity\s+Rs\. 14,440/);
    assert.match(text, /Balanced — total assets equal total liabilities and equity\./);
  });

  test("J23 Statement of Cash Flows at month end", async () => {
    await accountingTab(page, "Statement of Cash Flows");
    // customers 2,200 + 275 + 375 + 1,000 + 1,000 = 4,850; refunds 100 + 1,100; stock 600; supplier 650;
    // expenses 150 + 300 => 4,850 - 1,200 - 600 - 650 - 450 = 1,950
    // equipment -2,500; financing 2,000 - 500 + 3,000 - 500 = 4,000; change 1,950 - 2,500 + 4,000 = 3,450; 5,000 + 3,450 = 8,450
    assert.deepEqual(
      [
        await cardNum(page, "Cash from Operations"),
        await cardNum(page, "Cash from Investing"),
        await cardNum(page, "Cash from Financing"),
        await cardNum(page, "Net Change in Cash"),
      ],
      [1950, -2500, 4000, 3450],
    );
    const v = {};
    for (const [key, label] of Object.entries({
      customers: "Cash received from customers",
      refunds: "Refunds paid to customers",
      stock: "Paid for stock and raw materials",
      suppliers: "Supplier bills settled",
      expenses: "Operating expenses paid",
      capital: "Owner's capital introduced",
      drawings: "Owner's drawings",
      loansIn: "Loans received",
      loansOut: "Loans repaid",
      start: "Cash at the start of the period",
      end: "Cash at the end of the period",
      cashAccount: "Cash Account",
      bank: "Bank Account",
      profit: "Net profit for the period",
      receivables: "Decrease / (increase) in trade receivables",
      inventory: "Decrease / (increase) in inventory, net of trade payables",
      fromProfit: "Net Cash from Operations",
    }))
      v[key] = await stmt(page, label);
    log(JSON.stringify(v));
    // Cash Account 5,000 + 2,200 + 375 - 100 - 1,100 - 600 - 650 + 1,000 - 150 + 1,000 - 300 - 500 - 1,000 = 5,175
    // Bank 275 + 2,000 + 3,000 - 2,500 - 500 + 1,000 = 3,275
    // receivables: 1,375 collected - (1,375 + 1,000 sold on credit) + 1,000 returned off an unpaid balance = 0
    // inventory and payables: 2,000 cost of goods + 600 written off - 600 stock bought - 650 supplier bills = 1,350
    assert.deepEqual(v, {
      customers: 4850,
      refunds: -1200,
      stock: -600,
      suppliers: -650,
      expenses: -450,
      capital: 2000,
      drawings: -500,
      loansIn: 3000,
      loansOut: -500,
      start: 5000,
      end: 8450,
      cashAccount: 5175,
      bank: 3275,
      profit: 600,
      receivables: 0,
      inventory: 1350,
      fromProfit: 1950,
    });
    const text = await page.locator("main").innerText();
    assert.match(text, /Agrees with the Cash & Bank balances \(Rs\. 8,450\)\./);
    assert.match(text, /Agrees with the net cash from operating activities above\./);
    assert.equal(text.includes("should be nil"), false, "the transfer and its other half cancel out");
  });

  test("J24 Statement of Changes in Equity at month end", async () => {
    await accountingTab(page, "Statement of Changes in Equity");
    // no opening capital was recorded: capital is 2,000 - 500 = 1,500; profit 600; the opening-balance line 12,340
    assert.deepEqual(await equityTable(page), [
      ["Balance at the start (beginning)", "Rs. 0", "Rs. 0", "Rs. 12,340", "Rs. 12,340"],
      ["Profit for the period", "", "Rs. 600", "", "Rs. 600"],
      ["Capital introduced", "Rs. 2,000", "", "", "Rs. 2,000"],
      ["Owner's drawings", "(Rs. 500)", "", "", "(Rs. 500)"],
      [`Balance at the end (${todayLabel()})`, "Rs. 1,500", "Rs. 600", "Rs. 12,340", "Rs. 14,440"],
    ]);
    assert.match(
      await page.locator("main").innerText(),
      /Closing equity agrees with Total Equity on the Statement of Financial Position\./,
    );
  });

  test("J25 today's cash flow is the whole story (everything happened today); the Reports screen agrees", async () => {
    await accountingTab(page, "Statement of Cash Flows");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    assert.deepEqual(
      [await stmt(page, "Cash at the start of the period"), await stmt(page, "Cash at the end of the period")],
      [5000, 8450],
    );
    await page.getByRole("button", { name: "All time" }).click();
    // the same figures from the exported file
    await nav(page, "Reports");
    const d = await download(page, () =>
      reportCard(page, "Statement of Cash Flows").getByRole("button", { name: "CSV / Excel" }).click(),
    );
    const cf = csvMap(d.text);
    assert.deepEqual(
      [cf["Net cash from operating activities"], cf["NET INCREASE / (DECREASE) IN CASH"], cf["CASH AT THE END OF THE PERIOD"]],
      ["1950", "3450", "8450"],
    );
  });

  test("J26 no errors or warnings in the browser console during the whole month", async () => {
    const problems = takeConsoleProblems(page);
    log(problems.length ? problems.join("\n        ") : "console: no errors or warnings");
    assert.deepEqual(problems, []);
  });
});
