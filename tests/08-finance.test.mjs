// Feature tests: Cash & Bank, Accounting (ledger, Profit or Loss, Statement of
// Financial Position), Reports and the Dashboard, driven in the browser.
import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  asOwner,
  captureDialogs,
  card,
  download,
  field,
  launchBrowser,
  loadStores,
  log,
  modal,
  openApp,
  parseCsv,
  pool,
  row,
  shopFixture,
  stores,
  toast,
  today,
  waitSaved,
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

// One ledger line of every kind (the same lines the accounting unit tests
// use): net profit 670; Cash Account 1,650 (opening 1,000), Bank 4,690.
const LEDGER = [
  {
    id: "TXN-1",
    date: "2026-01-05",
    desc: "Sale",
    type: "Income",
    category: "Sales",
    amount: 1000,
    account: "CASH-MAIN",
    kind: "revenue",
  },
  {
    id: "TXN-2",
    date: "2026-01-05",
    desc: "COGS",
    type: "Expense",
    category: "Cost of Goods Sold",
    amount: 600,
    kind: "cogs",
    cash: false,
  },
  {
    id: "TXN-3",
    date: "2026-01-10",
    desc: "Rent",
    type: "Expense",
    category: "Rent",
    amount: 150,
    account: "BANK-MAIN",
  },
  {
    id: "TXN-4",
    date: "2026-01-12",
    desc: "Interest",
    type: "Income",
    category: "Interest Income",
    amount: 20,
    account: "BANK-MAIN",
  },
  {
    id: "TXN-5",
    date: "2026-02-01",
    desc: "Old purchase",
    type: "Expense",
    category: "Stock & Raw Material Purchase",
    amount: 300,
  },
  {
    id: "TXN-6",
    date: "2026-02-02",
    desc: "Capital",
    type: "Income",
    category: "Owner Capital",
    amount: 5000,
    account: "BANK-MAIN",
  },
  {
    id: "TXN-7",
    date: "2026-02-03",
    desc: "Drawings",
    type: "Expense",
    category: "Owner Drawings",
    amount: 200,
  },
  {
    id: "TXN-8",
    date: "2026-02-04",
    desc: "Move",
    type: "Expense",
    category: "Cash Transfer",
    amount: 100,
    account: "BANK-MAIN",
    kind: "transfer",
  },
  {
    id: "TXN-9",
    date: "2026-02-04",
    desc: "Move",
    type: "Income",
    category: "Cash Transfer",
    amount: 100,
    account: "CASH-MAIN",
    kind: "transfer",
  },
  {
    id: "TXN-10",
    date: "2026-02-05",
    desc: "Collected",
    type: "Income",
    category: "Receivable Collection",
    amount: 50,
  },
  {
    id: "TXN-11",
    date: "2026-02-06",
    desc: "Paid supplier",
    type: "Expense",
    category: "Supplier Payment",
    amount: 80,
    account: "BANK-MAIN",
  },
  {
    id: "TXN-12",
    date: "2026-02-07",
    desc: "Credit sale",
    type: "Income",
    category: "Sales",
    amount: 400,
    kind: "revenue",
    cash: false,
  },
];

function financeFixture() {
  const data = shopFixture();
  data.cashAccounts[0].opening = 1000;
  data.ledger = LEDGER;
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
      date: "2026-02-07",
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
      date: "2026-02-08",
      paymentStatus: "Unpaid",
      amountPaid: 0,
    },
  ];
  data.rawMaterialUsage = [
    {
      id: "USE-1001",
      date: "2026-02-09",
      materialId: 401,
      materialName: "Resin",
      qtyUsed: 2,
      remainingQty: 8,
      user: "Ann",
      notes: "mould",
      consumedValue: 200,
    },
  ];
  data.deliveryRuns = [
    {
      id: "DR-1001",
      date: "2026-02-10",
      status: "Completed",
      completedDate: "2026-02-10",
      lineItems: [
        {
          productId: 101,
          name: "Alpha Printer",
          price: 1000,
          cost: 600,
          unit: "pc",
          taken: 3,
          returned: 1,
          sold: 2,
          saleAmount: 1900,
          avgPrice: 950,
          sales: [
            { qty: 1, price: 1000 },
            { qty: 1, price: 900 },
          ],
        },
      ],
      totalTaken: 3,
      soldQty: 2,
      saleAmount: 1900,
      costAmount: 1200,
      dailyExpense: 100,
      profit: 700,
      netProfit: 600,
      expenseTxnIds: [],
    },
  ];
  return data;
}

/* ---------------------------------------------------------- Cash & Bank */

describe("Cash & Bank", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });
  const book = (page) =>
    page.locator("div.rounded-2xl", { has: page.locator("h3", { hasText: "Cash Book" }) });

  test("CASH-1 each account's opening balance, money in/out and balance; the total", async () => {
    const page = await openApp(browser, "Cash & Bank");
    assert.equal(await card(page, "Total Cash & Bank").innerText(), "Rs. 5,000");
    assert.match(
      await row(page, "Cash Account").innerText(),
      /Cash\s+Rs\. 5,000\s+Rs\. 0\s+Rs\. 0\s+Rs\. 5,000/,
    );
    assert.match(await row(page, "Bank Account").innerText(), /Bank\s+Rs\. 0\s+Rs\. 0\s+Rs\. 0\s+Rs\. 0/);
    await page.context().close();
  });

  test("CASH-2 a transfer between accounts moves money without touching profit", async () => {
    const page = await openApp(browser, "Cash & Bank");
    await page.getByRole("button", { name: "Transfer" }).click();
    const m = modal(page);
    await field(m, "From Account").selectOption("CASH-MAIN");
    await field(m, "To Account").selectOption("BANK-MAIN");
    await field(m, "Amount").fill("1200");
    await m.getByRole("button", { name: "Record" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.equal(
      message,
      "Rs. 1,200 transferred to Bank Account. Profit is unaffected — this is only a movement of your own cash.",
    );
    assert.deepEqual(
      s.ledger.map(({ id, type, category, amount, account, kind, desc }) => [
        id,
        type,
        category,
        amount,
        account,
        kind,
        desc,
      ]),
      [
        [
          "TXN-8822",
          "Expense",
          "Cash Transfer",
          1200,
          "CASH-MAIN",
          "transfer",
          "Transfer Cash Account → Bank Account",
        ],
        [
          "TXN-8823",
          "Income",
          "Cash Transfer",
          1200,
          "BANK-MAIN",
          "transfer",
          "Transfer Cash Account → Bank Account",
        ],
      ],
    );
    assert.match(
      await row(page, "Cash Account").innerText(),
      /Rs\. 5,000\s+Rs\. 0\s+Rs\. 1,200\s+Rs\. 3,800/,
    );
    assert.match(await row(page, "Bank Account").innerText(), /Rs\. 0\s+Rs\. 1,200\s+Rs\. 0\s+Rs\. 1,200/);
    assert.equal(await card(page, "Total Cash & Bank").innerText(), "Rs. 5,000");
    await page.context().close();
  });

  test("CASH-3 a transfer needs two different accounts", async () => {
    const page = await openApp(browser, "Cash & Bank");
    await page.getByRole("button", { name: "Transfer" }).click();
    await field(modal(page), "To Account").selectOption("CASH-MAIN");
    await modal(page).getByText("Choose two different accounts.").waitFor();
    assert.equal(await modal(page).getByRole("button", { name: "Record" }).isDisabled(), true);
    await page.context().close();
  });

  test("CASH-4 money in: owner's capital and loans stay out of profit; other income counts", async () => {
    const page = await openApp(browser, "Cash & Bank");
    for (const [source, amount] of [
      ["Owner Capital", "2000"],
      ["Loan Received", "500"],
      ["Other Income", "75"],
    ]) {
      await page.getByRole("button", { name: "Money In" }).click();
      await field(modal(page), "Account").selectOption("BANK-MAIN");
      await field(modal(page), "Received As").selectOption(source);
      await field(modal(page), "Amount").fill(amount);
      await modal(page).getByRole("button", { name: "Record" }).click();
      await waitSaved(page);
    }
    const s = await stores();
    log(s.ledger.map((t) => `${t.category} ${t.amount} → ${t.kind}`).join(" | "));
    assert.deepEqual(
      s.ledger.map(({ type, category, amount, account, kind, desc }) => [
        type,
        category,
        amount,
        account,
        kind,
        desc,
      ]),
      [
        ["Income", "Other Income", 75, "BANK-MAIN", "revenue", "Other Income received"],
        ["Income", "Loan Received", 500, "BANK-MAIN", "ar_collection", "Loan Received received"],
        ["Income", "Owner Capital", 2000, "BANK-MAIN", "capital_in", "Owner Capital received"],
      ],
    );
    assert.equal(await card(page, "Total Cash & Bank").innerText(), "Rs. 7,575");
    await page.context().close();
  });

  test("CASH-5 money out: drawings are equity; supplier and loan payments settle what is owed", async () => {
    const page = await openApp(browser, "Cash & Bank");
    for (const [source, amount] of [
      ["Owner Drawings", "300"],
      ["Supplier Payment", "40"],
      ["Loan Repayment", "60"],
    ]) {
      await page.getByRole("button", { name: "Money Out" }).click();
      await field(modal(page), "Account").selectOption("CASH-MAIN");
      await field(modal(page), "Paid As").selectOption(source);
      await field(modal(page), "Amount").fill(amount);
      await modal(page).getByRole("button", { name: "Record" }).click();
      await waitSaved(page);
    }
    const s = await stores();
    assert.deepEqual(
      s.ledger.map(({ type, category, amount, kind }) => [type, category, amount, kind]),
      [
        ["Expense", "Loan Repayment", 60, "ap_settlement"],
        ["Expense", "Supplier Payment", 40, "ap_settlement"],
        ["Expense", "Owner Drawings", 300, "capital_out"],
      ],
    );
    assert.equal(await card(page, "Total Cash & Bank").innerText(), "Rs. 4,600");
    await page.context().close();
  });

  test("CASH-6 a new account starts with its opening balance", async () => {
    const page = await openApp(browser, "Cash & Bank");
    await page.getByRole("button", { name: "Account", exact: true }).click();
    const m = modal(page);
    await field(m, "Account Name").fill("Mobile Wallet");
    await field(m, "Type").selectOption("Mobile Wallet");
    await field(m, "Opening Balance").fill("250");
    await field(m, "Notes (optional)").fill("eZ cash");
    await m.getByRole("button", { name: "Create Account" }).click();
    await waitSaved(page);
    const acc = (await stores()).cashAccounts.find((a) => a.name === "Mobile Wallet");
    log(JSON.stringify(acc));
    assert.match(acc.id, /^ACC-/);
    assert.deepEqual(
      { ...acc, id: "" },
      {
        id: "",
        name: "Mobile Wallet",
        type: "Mobile Wallet",
        opening: 250,
        purpose: "general",
        system: false,
        notes: "eZ cash",
      },
    );
    assert.match(await row(page, "Mobile Wallet").innerText(), /Rs\. 250\s+Rs\. 0\s+Rs\. 0\s+Rs\. 250/);
    await page.context().close();
  });

  test("CASH-7 editing an account saves only the account's own details", async () => {
    const page = await openApp(browser, "Cash & Bank");
    await row(page, "Bank Account").locator("button").nth(0).click();
    await field(modal(page), "Account Name").fill("Bank — BOC");
    await field(modal(page), "Opening Balance").fill("100");
    await modal(page).getByRole("button", { name: "Save Changes" }).click();
    await waitSaved(page);
    const acc = (await stores()).cashAccounts.find((a) => a.id === "BANK-MAIN");
    log(JSON.stringify(acc));
    assert.deepEqual([acc.name, acc.opening], ["Bank — BOC", 100]);
    assert.deepEqual(
      Object.keys(acc).filter((k) => ["inn", "out", "balance", "count"].includes(k)),
      [],
      "calculated figures (balance, money in/out) must not be stored on the account",
    );
    await page.context().close();
  });

  test("CASH-8 built-in accounts and accounts with transactions can't be deleted; unused ones can", async () => {
    const data = shopFixture();
    data.cashAccounts.push(
      {
        id: "ACC-USED",
        name: "Petty Cash",
        type: "Petty Cash",
        opening: 0,
        purpose: "general",
        system: false,
      },
      {
        id: "ACC-SPARE",
        name: "Spare Wallet",
        type: "Mobile Wallet",
        opening: 0,
        purpose: "general",
        system: false,
      },
    );
    data.ledger = [
      {
        id: "TXN-1",
        date: "2026-02-01",
        desc: "Tea",
        type: "Expense",
        category: "Other",
        amount: 5,
        account: "ACC-USED",
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Cash & Bank");
    await row(page, "Cash Account").locator("button").nth(1).click();
    const builtIn = await toast(page).innerText();
    await row(page, "Petty Cash").locator("button").nth(1).click();
    await page.waitForTimeout(200);
    const used = await toast(page).innerText();
    log(`built-in -> "${builtIn}"; used -> "${used}"`);
    assert.equal(builtIn, "Built-in accounts cannot be deleted, because other modules post to them.");
    assert.equal(
      used,
      "Petty Cash has 1 transaction(s) posted to it and cannot be deleted. Set its opening balance to 0 instead.",
    );
    await row(page, "Spare Wallet").locator("button").nth(1).click();
    await waitSaved(page);
    assert.deepEqual(
      (await stores()).cashAccounts.map((a) => a.id),
      ["CASH-MAIN", "BANK-MAIN", "ACC-USED"],
    );
    await page.context().close();
  });

  test("CASH-9 an account paid out of without funds can be topped up from another account in one click", async () => {
    const data = shopFixture();
    data.ledger = [
      {
        id: "TXN-8822",
        date: "2026-02-01",
        desc: "Rent",
        type: "Expense",
        category: "Rent",
        amount: 400,
        account: "BANK-MAIN",
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Cash & Bank");
    await page.getByText("An account has been paid out of without being funded").waitFor();
    await page.getByRole("button", { name: "Top up Bank Account with Rs. 400" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.equal(
      message,
      "Rs. 400 moved from Cash Account into Bank Account. Both balances now match your real cash.",
    );
    assert.deepEqual(
      s.ledger.slice(0, 2).map(({ id, type, amount, account, kind }) => [id, type, amount, account, kind]),
      [
        ["TXN-8824", "Income", 400, "BANK-MAIN", "transfer"],
        ["TXN-8823", "Expense", 400, "CASH-MAIN", "transfer"],
      ],
    );
    assert.match(await row(page, "Bank Account").innerText(), /Rs\. 400\s+Rs\. 400\s+Rs\. 0/);
    assert.equal(await page.getByText("An account has been paid out of without being funded").count(), 0);
    await page.context().close();
  });

  test("CASH-10 the cash book: filters by account, kind and dates, and exports to CSV", async () => {
    const data = shopFixture();
    data.ledger = [
      {
        id: "TXN-1",
        date: "2026-02-01",
        desc: "Sale",
        type: "Income",
        category: "Sales",
        amount: 1000,
        account: "CASH-MAIN",
        kind: "revenue",
      },
      {
        id: "TXN-2",
        date: "2026-02-05",
        desc: "Rent",
        type: "Expense",
        category: "Rent",
        amount: 150,
        account: "BANK-MAIN",
      },
      {
        id: "TXN-3",
        date: "2026-02-10",
        desc: "Stock",
        type: "Expense",
        category: "Stock & Raw Material Purchase",
        amount: 300,
        account: "CASH-MAIN",
        kind: "asset_purchase",
      },
      {
        id: "TXN-4",
        date: "2026-02-10",
        desc: "COGS",
        type: "Expense",
        category: "Cost of Goods Sold",
        amount: 600,
        kind: "cogs",
        cash: false,
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Cash & Bank");
    const b = book(page);
    const descs = async () => await b.locator("tbody tr td:nth-child(2) p.font-medium").allInnerTexts();
    assert.deepEqual(
      await descs(),
      ["Stock", "Rent", "Sale"],
      "newest first; cost of goods sold moves no cash",
    );
    await b.locator("select").nth(0).selectOption("BANK-MAIN");
    assert.deepEqual(await descs(), ["Rent"]);
    await b.locator("select").nth(0).selectOption("All");
    await b.locator("select").nth(1).selectOption("Purchases");
    assert.deepEqual(await descs(), ["Stock"]);
    await b.locator("select").nth(1).selectOption("Money In");
    assert.deepEqual(await descs(), ["Sale"]);
    await b.locator("select").nth(1).selectOption("All");
    await b.locator("input[type=date]").nth(0).fill("2026-02-04");
    assert.deepEqual(await descs(), ["Stock", "Rent"]);
    await b.getByRole("button", { name: "Clear" }).click();
    const { name, text } = await download(page, () => b.getByRole("button", { name: "CSV" }).click());
    const csv = parseCsv(text);
    log(name, JSON.stringify(csv));
    assert.equal(name, "cash_book.csv");
    assert.deepEqual(csv, [
      ["Date", "Account", "Description", "Category", "Treatment", "Money In", "Money Out"],
      [
        "Feb 10",
        "Cash Account",
        "Stock",
        "Stock & Raw Material Purchase",
        "Asset purchase — Statement of Financial Position",
        "",
        "300",
      ],
      ["Feb 5", "Bank Account", "Rent", "Rent", "Profit or Loss", "", "150"],
      ["Feb 1", "Cash Account", "Sale", "Sales", "Profit or Loss", "1000", ""],
    ]);
    await page.context().close();
  });
});

/* ----------------------------------------------------------- Accounting */

describe("Accounting", () => {
  beforeEach(async () => {
    await loadStores(financeFixture());
  });
  const openTab = async (page, tab) => page.locator("main button", { hasText: tab }).first().click();

  test("ACC-1 a manual expense goes to the Profit or Loss statement and out of the chosen account", async () => {
    await loadStores(shopFixture());
    const page = await openApp(browser, "Accounting");
    await page.getByRole("button", { name: "New Entry" }).click();
    const m = modal(page);
    await field(m, "Description").fill("Electricity");
    await field(m, "Category").selectOption("Utilities");
    await field(m, "Amount").fill("150.75");
    await field(m, "Date").fill("2026-02-20");
    await field(m, "Paid From").selectOption("BANK-MAIN");
    assert.match(await m.innerText(), /Goes into the Profit or Loss statement\./);
    await m.getByRole("button", { name: "Record Expense" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const t = (await stores()).ledger[0];
    log(message, JSON.stringify(t));
    assert.equal(message, "Expense of Rs. 150.75 recorded.");
    assert.deepEqual(t, {
      id: "TXN-8822",
      date: "2026-02-20",
      desc: "Electricity",
      type: "Expense",
      category: "Utilities",
      amount: 150.75,
      account: "BANK-MAIN",
      kind: "opex",
    });
    await page.context().close();
  });

  test("ACC-2 owner's capital entered as income is shown as equity, not profit", async () => {
    await loadStores(shopFixture());
    const page = await openApp(browser, "Accounting");
    await page.getByRole("button", { name: "New Entry" }).click();
    const m = modal(page);
    await m.getByRole("button", { name: "Income", exact: true }).click();
    await field(m, "Description").fill("Top-up from owner");
    await field(m, "Category").selectOption("Owner Capital");
    await field(m, "Amount").fill("10000");
    await field(m, "Received Into").selectOption("BANK-MAIN");
    assert.match(await m.innerText(), /Owner's capital — equity — this will not change your profit\./);
    await m.getByRole("button", { name: "Record Income" }).click();
    await waitSaved(page);
    const t = (await stores()).ledger[0];
    assert.deepEqual(
      [t.type, t.category, t.kind, t.account, t.date],
      ["Income", "Owner Capital", "capital_in", "BANK-MAIN", today()],
    );
    assert.equal(await card(page, "Net Profit (all time)").innerText(), "Rs. 0");
    await page.context().close();
  });

  test("ACC-3 the ledger overview: P&L totals, cash, receivables and payables", async () => {
    const page = await openApp(browser, "Accounting");
    const values = {};
    for (const l of [
      "Total Income (P&L)",
      "Total Expenses (P&L)",
      "Net Profit (all time)",
      "Cash & Bank",
      "Accounts Receivable",
      "Accounts Payable",
    ])
      values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    assert.deepEqual(values, {
      "Total Income (P&L)": "Rs. 1,420",
      "Total Expenses (P&L)": "Rs. 750",
      "Net Profit (all time)": "Rs. 670",
      "Cash & Bank": "Rs. 6,340",
      "Accounts Receivable": "Rs. 400",
      "Accounts Payable": "Rs. 450",
    });
    assert.match(await page.locator("main").innerText(), /Rs\. 300 of purchases has been recorded so far/);
    await page.context().close();
  });

  test("ACC-4 ledger entries: treatment badges, income/expense filter and delete", async () => {
    const page = await openApp(browser, "Accounting");
    assert.match(await row(page, "Old purchase").innerText(), /Balance sheet/);
    assert.match(await row(page, "Rent").innerText(), /Profit or Loss/);
    const ledgerCard = page.locator("div.rounded-2xl", {
      has: page.locator("h3", { hasText: "Ledger Entries" }),
    });
    await ledgerCard.locator("select").selectOption("Income");
    const shown = await ledgerCard.locator("tbody tr td:first-child").allInnerTexts();
    assert.deepEqual(shown.sort(), ["Capital", "Collected", "Credit sale", "Interest", "Move", "Sale"]);
    await ledgerCard.locator("select").selectOption("All");
    const dialogs = captureDialogs(page);
    await row(page, "Drawings").locator("button").click();
    await waitSaved(page);
    assert.deepEqual(dialogs, ["Delete this ledger entry?"]);
    assert.equal(
      (await stores()).ledger.some((t) => t.id === "TXN-7"),
      false,
    );
    await page.context().close();
  });

  test("ACC-5 the Profit or Loss statement, with the items deliberately kept out of profit", async () => {
    const page = await openApp(browser, "Accounting");
    await openTab(page, "Profit or Loss");
    const values = {};
    for (const l of ["Revenue", "Gross Profit", "Operating Expenses", "Net Profit"])
      values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    assert.deepEqual(values, {
      Revenue: "Rs. 1,400",
      "Gross Profit": "Rs. 800",
      "Operating Expenses": "Rs. 150",
      "Net Profit": "Rs. 670",
    });
    const text = await page.locator("main").innerText();
    for (const re of [
      /57\.14% margin/,
      /Sales\s+Rs\. 1,400/,
      /Cost of Goods Sold\s+\(Rs\. 600\)/,
      /Rent\s+\(Rs\. 150\)/,
      /Operating Profit\s+Rs\. 650/,
      /Interest Income\s+Rs\. 20/,
      /Net Profit for the Period\s+Rs\. 670/,
      /Net margin 47\.18%/,
      /Stock & raw material purchases[\s\S]*?Rs\. 300/,
      /Owner's capital introduced\s+Rs\. 5,000/,
      /Owner's drawings\s+Rs\. 200/,
      /Transfers between own accounts\s+Rs\. 200/,
      /Customer receipts against invoices already booked\s+Rs\. 50/,
      /Supplier bills settled\s+Rs\. 80/,
    ])
      assert.match(text, re);
    await page.getByRole("button", { name: "Show the 7 excluded line(s)" }).click();
    assert.equal(await page.locator("main table").last().locator("tbody tr").count(), 7);
    await page.context().close();
  });

  test("ACC-6 the statement can be limited to a date range, or a preset", async () => {
    const page = await openApp(browser, "Accounting");
    await openTab(page, "Profit or Loss");
    await page.locator("main input[type=date]").nth(0).fill("2026-01-01");
    await page.locator("main input[type=date]").nth(1).fill("2026-01-31");
    assert.equal(await card(page, "Net Profit").innerText(), "Rs. 270");
    assert.match(await page.locator("main").innerText(), /For Jan 1 to Jan 31/);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByText("No revenue recorded in this period").waitFor();
    await page.getByRole("button", { name: "All time" }).click();
    assert.equal(await card(page, "Net Profit").innerText(), "Rs. 670");
    await page.context().close();
  });

  test("ACC-7 the Profit or Loss statement exports to CSV and opens as a printable page", async () => {
    const page = await openApp(browser, "Accounting");
    await openTab(page, "Profit or Loss");
    const { name, text } = await download(page, () =>
      page.locator("main button", { hasText: "CSV" }).first().click(),
    );
    const csv = parseCsv(text);
    log(name, csv.length, "rows");
    assert.equal(name, "profit_or_loss_statement.csv");
    assert.deepEqual(csv[0], ["Profit or Loss Statement — All time", "Amount"]);
    const rows = Object.fromEntries(csv.filter((r) => r[0]).map((r) => [r[0].trim(), r[1]]));
    assert.deepEqual(
      [
        rows["Total Revenue"],
        rows["Total Cost of Sales"],
        rows["GROSS PROFIT"],
        rows["Total Operating Expenses"],
        rows["Total Other Income"],
        rows["NET PROFIT FOR THE PERIOD"],
      ],
      ["1400", "600", "800", "150", "20", "670"],
    );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.locator("main button", { hasText: "Print / PDF" }).first().click(),
    ]);
    await popup.waitForLoadState();
    const html = await popup.content();
    assert.match(html, /<h1>Profit or Loss Statement \(All time\)<\/h1>/);
    assert.match(html, /NET PROFIT FOR THE PERIOD<\/td><td>670/);
    await popup.close();
    await page.context().close();
  });

  test("ACC-8 the Statement of Financial Position balances and exports", async () => {
    const page = await openApp(browser, "Accounting");
    await openTab(page, "Statement of Financial Position");
    const values = {};
    for (const l of ["Total Assets", "Total Liabilities", "Net Assets / Equity", "Retained Earnings"])
      values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    // cash 6,340 + receivables 400 + products 6,300 + raw materials 1,040
    assert.deepEqual(values, {
      "Total Assets": "Rs. 14,080",
      "Total Liabilities": "Rs. 450",
      "Net Assets / Equity": "Rs. 13,630",
      "Retained Earnings": "Rs. 670",
    });
    const text = await page.locator("main").innerText();
    for (const re of [
      /Cash Account\s+Rs\. 1,650/,
      /Bank Account\s+Rs\. 4,690/,
      /Trade Receivables\s+[^\n]+\s+Rs\. 400/,
      /Inventory — Finished Goods \(at cost\)\s+Rs\. 6,300/,
      /Inventory — Raw Materials \(at cost\)\s+[^\n]+\s+Rs\. 1,040/,
      /Trade Payables\s+[^\n]+\s+Rs\. 450/,
      /Capital Introduced\s+Rs\. 5,000/,
      /Owner's Drawings\s+\(Rs\. 200\)/,
      /Balanced — total assets equal total liabilities and equity\./,
    ])
      assert.match(text, re);
    const { name, text: csvText } = await download(page, () =>
      page.locator("main button", { hasText: "CSV" }).first().click(),
    );
    const rows = Object.fromEntries(parseCsv(csvText).map((r) => [r[0].trim(), r[1]]));
    assert.equal(name, "statement_of_financial_position.csv");
    assert.deepEqual(
      [rows["TOTAL ASSETS"], rows["Total Liabilities"], rows["TOTAL LIABILITIES AND EQUITY"]],
      ["14080", "450", "14080"],
    );
    await page.context().close();
  });
});

/* -------------------------------------------------------------- Reports */

describe("Reports", () => {
  // A fresh page per report: Chrome refuses the 11th download in a row from one page.
  let page;
  before(async () => {
    await loadStores(financeFixture());
  });
  beforeEach(async () => {
    page = await openApp(browser, "Reports");
  });
  afterEach(() => page.context().close());
  const reportCard = (name) =>
    page
      .locator("main div.rounded-2xl")
      .filter({ has: page.locator("p", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
  const csvOf = async (name) => {
    const d = await download(page, () =>
      reportCard(name).getByRole("button", { name: "CSV / Excel" }).click(),
    );
    return { file: d.name, rows: parseCsv(d.text) };
  };

  const expected = {
    "Profit or Loss Statement": [
      "profit_or_loss_statement.csv",
      (rows) => rows.find((r) => r[0] === "NET PROFIT FOR THE PERIOD")[1] === "670",
    ],
    "Statement of Financial Position": [
      "statement_of_financial_position.csv",
      (rows) => rows.find((r) => r[0] === "TOTAL ASSETS")[1] === "14080",
    ],
    "Cash Book": ["cash_book.csv", (rows) => rows.length === 11],
    "Cash Account Balances": [
      "cash_account_balances.csv",
      (rows) =>
        JSON.stringify(rows.slice(1)) ===
        JSON.stringify([
          ["Cash Account", "Cash", "1000", "1150", "500", "1650"],
          ["Bank Account", "Bank", "0", "5020", "330", "4690"],
          ["TOTAL", "", "", "", "", "6340"],
        ]),
    ],
    "Supplier Payables": [
      "supplier_payables.csv",
      (rows) => rows[1][0] === "PO-4001" && rows.at(-1)[5] === "450",
    ],
    "Sales by Product": [
      "sales_by_product.csv",
      (rows) => JSON.stringify(rows[1]) === JSON.stringify(["Beta Toner", "2", "400"]),
    ],
    "Stock Valuation": [
      "stock_valuation.csv",
      (rows) =>
        rows
          .slice(1)
          .map((r) => r[6])
          .join() === "6000,300,0",
    ],
    "Customer Statement": [
      "customer_statement.csv",
      (rows) => rows.length === 3 && rows[1][0] === "Acme Traders",
    ],
    "Supplier Purchases": ["supplier_purchases.csv", (rows) => rows.length === 3 && rows[2][2] === "1200"],
    "Tax Summary": ["tax_summary.csv", (rows) => rows[1][1] === "36.36" && rows[3][1] === "450"],
    "Raw Material Purchases": [
      "raw_material_purchases.csv",
      (rows) =>
        JSON.stringify(rows[1]) ===
        JSON.stringify(["PO-4001", "Paper Mills Ltd", "Feb 8", "Resin", "3", "150", "450"]),
    ],
    "Raw Material Usage": [
      "raw_material_usage.csv",
      (rows) => JSON.stringify(rows[1]) === JSON.stringify(["Feb 9", "Resin", "2", "8", "Ann", "mould"]),
    ],
    "Remaining Raw Materials": [
      "remaining_raw_materials.csv",
      (rows) => rows[1][0] === "Resin" && rows[1][7] === "1000",
    ],
    "Delivery Profit Report": [
      "delivery_profit_report.csv",
      (rows) =>
        JSON.stringify(rows[1]) ===
        JSON.stringify(["DR-1001", "Feb 10", "1900", "1200", "100", "700", "600"]),
    ],
    "Delivery Item Sales by Price": [
      "delivery_item_prices_report.csv",
      (rows) => rows.length === 3 && rows[2][5] === "900",
    ],
    "Daily Expense Report": [
      "daily_expense_report.csv",
      (rows) => rows[1][2] === "100" && rows.at(-1)[2] === "100",
    ],
  };

  for (const [name, [file, check]] of Object.entries(expected)) {
    test(`REP ${name}: CSV export`, async () => {
      const { file: got, rows } = await csvOf(name);
      log(`${got}: ${rows.length} rows; first data row ${JSON.stringify(rows[1] || [])}`);
      assert.equal(got, file);
      assert.ok(check(rows), JSON.stringify(rows));
    });
  }

  test("REP-17 a date range limits the dated reports (sales by product)", async () => {
    await page.locator("main input[type=date]").nth(0).fill("2026-03-01");
    const { rows } = await csvOf("Sales by Product");
    await page.getByRole("button", { name: "Clear" }).click();
    log(`sales by product from Mar 1: ${rows.length - 1} rows`);
    assert.deepEqual(rows, [["Product", "Units Sold", "Revenue"]]);
  });

  test("REP-18 every report also opens as a printable page", async () => {
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      reportCard("Stock Valuation").getByRole("button", { name: "PDF" }).click(),
    ]);
    await popup.waitForLoadState();
    const html = await popup.content();
    assert.match(html, /<h1>Stock Valuation<\/h1>/);
    assert.match(html, /<td>Alpha Printer<\/td>/);
    await popup.close();
  });
});

/* ------------------------------------------------------------ Dashboard */

describe("Dashboard", () => {
  beforeEach(async () => {
    await loadStores(financeFixture());
  });
  const settle = (page) => page.waitForTimeout(1300); // KPI figures count up

  test("DASH-1 all-time figures", async () => {
    const page = await openApp(browser, "Dashboard");
    await page.getByRole("button", { name: "All Time" }).click();
    await settle(page);
    const labels = [
      "Income (All Time)",
      "Net Profit (All Time)",
      "Expenses (All Time)",
      "Orders (All Time)",
      "Completed (All Time)",
      "Stock Value (Current)",
      "Cash & Bank (Current)",
      "Purchases (All Time, not an expense)",
      "Receivable (Current)",
      "Payable (Current)",
      "Low Stock Items (Current)",
      "Total Raw Materials Value",
      "Raw Material Stock",
      "Total Daily Expenses",
    ];
    const values = {};
    for (const l of labels) values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    assert.deepEqual(values, {
      "Income (All Time)": "Rs. 1,420",
      "Net Profit (All Time)": "Rs. 670",
      "Expenses (All Time)": "Rs. 750",
      "Orders (All Time)": "1",
      "Completed (All Time)": "1",
      "Stock Value (Current)": "Rs. 6,300",
      "Cash & Bank (Current)": "Rs. 6,340",
      "Purchases (All Time, not an expense)": "Rs. 300",
      "Receivable (Current)": "Rs. 400",
      "Payable (Current)": "Rs. 450",
      "Low Stock Items (Current)": "1",
      "Total Raw Materials Value": "Rs. 1,040",
      "Raw Material Stock": "11",
      "Total Daily Expenses": "Rs. 100",
    });
    assert.match(await page.locator("main").innerText(), /INV-1001\s+Acme Traders\s+Rs\. 400\s+Pending/);
    await page.context().close();
  });

  test("DASH-2 the period selector limits income, profit and orders to that period", async () => {
    const page = await openApp(browser, "Dashboard");
    await settle(page);
    assert.equal(
      await card(page, "Income (This Month)").innerText(),
      "Rs. 0",
      "nothing in the fixture is dated this month",
    );
    await page.getByText("No sales recorded for this month.").waitFor();
    await page.getByRole("button", { name: "Annually" }).click();
    await settle(page);
    const yearIncome = await card(page, "Income (This Year)").innerText();
    log(`this month: Rs. 0; this year: ${yearIncome}`);
    assert.equal(yearIncome, today().startsWith("2026") ? "Rs. 1,420" : "Rs. 0");
    await page.context().close();
  });

  test("DASH-3 picking dates on the calendar shows that range's figures", async () => {
    const page = await openApp(browser, "Dashboard");
    const cal = page.locator('div[class*="w-[272px]"]');
    // The calendar opens on this month; move to January 2026.
    const [y, m] = today().split("-").map(Number);
    const monthsBack = (y - 2026) * 12 + (m - 1);
    for (let i = 0; i < Math.abs(monthsBack); i++)
      await cal
        .locator("button")
        .nth(monthsBack > 0 ? 0 : 1)
        .click();
    assert.match(await cal.innerText(), /January 2026/);
    await cal.locator("button", { hasText: /^5$/ }).click();
    await cal.locator("button", { hasText: /^12$/ }).click();
    await settle(page);
    const panel = page.locator("div.rounded-2xl", {
      has: page.locator("h3", { hasText: "Pick a Date or Range" }),
    });
    const values = {};
    for (const l of ["Income", "Net Profit", "Expenses", "Orders"])
      values[l] = await card(panel, l).innerText();
    log("Jan 5 – Jan 12:", JSON.stringify(values));
    assert.match(await panel.innerText(), /Jan 5 – Jan 12/);
    assert.deepEqual(values, {
      Income: "Rs. 1,020",
      "Net Profit": "Rs. 270",
      Expenses: "Rs. 750",
      Orders: "0",
    });
    await panel.getByRole("button", { name: "Clear" }).click();
    await panel.getByText("Select a date on the calendar").waitFor();
    await page.context().close();
  });
});
