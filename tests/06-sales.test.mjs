// Feature tests: Point of Sale, Sales Orders and Customers, driven in the
// browser against a small known data set (see shopFixture in helpers.mjs).
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PNG,
  asOwner,
  captureDialogs,
  card,
  field,
  launchBrowser,
  loadStores,
  log,
  modal,
  openApp,
  pool,
  row,
  shopFixture,
  stores,
  takeConsoleProblems,
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

/* ------------------------------------------------------------------ POS */

describe("Point of Sale", () => {
  let page;
  beforeEach(async () => {
    await loadStores(shopFixture());
  });
  const cart = (p) => p.locator("div.rounded-2xl", { has: p.locator("h3", { hasText: "Current Sale" }) });
  const cartLine = (p, name) => cart(p).locator("div.border-b", { hasText: name });
  const productCard = (p, name) => p.locator("main button", { hasText: name }).first();

  test("POS-1 search and category buttons narrow the product grid; out-of-stock products can't be added", async () => {
    page = await openApp(browser, "Point of Sale");
    const visible = async () =>
      (await page.locator("main button.text-left").allInnerTexts()).map((t) => t.split("\n")[0]);
    assert.deepEqual(await visible(), ["Alpha Printer", "Beta Toner", "Gamma Paper"]);
    await page.getByPlaceholder("Search products or scan barcode...").fill("toner");
    assert.deepEqual(await visible(), ["Beta Toner"]);
    await page.getByPlaceholder("Search products or scan barcode...").fill("");
    await page.locator("main button", { hasText: /^Printers$/ }).click();
    assert.deepEqual(await visible(), ["Alpha Printer"]);
    await page.locator("main button", { hasText: /^All$/ }).click();
    await page.getByPlaceholder("Search products or scan barcode...").fill("nothing like this");
    await page.getByText("No products match your search.").waitFor();
    await page.getByPlaceholder("Search products or scan barcode...").fill("");
    assert.equal(await productCard(page, "Gamma Paper").isDisabled(), true);
    log("search, category filter and the out-of-stock card all behave");
    await page.context().close();
  });

  test("POS-2 the cart: quantities can't go below 1 or above the stock, lines can be removed, totals include tax", async () => {
    page = await openApp(browser, "Point of Sale");
    const complete = page.locator("button", { hasText: "Complete Sale" });
    assert.equal(await complete.isDisabled(), true, "empty cart: can't complete a sale");
    for (let i = 0; i < 5; i++) await productCard(page, "Beta Toner").click();
    assert.equal(
      await cartLine(page, "Beta Toner").locator("span.w-5").innerText(),
      "3",
      "capped at the 3 in stock",
    );
    await cartLine(page, "Beta Toner").locator("button").nth(1).click(); // +
    assert.equal(await cartLine(page, "Beta Toner").locator("span.w-5").innerText(), "3");
    for (let i = 0; i < 4; i++) await cartLine(page, "Beta Toner").locator("button").nth(0).click(); // −
    assert.equal(await cartLine(page, "Beta Toner").locator("span.w-5").innerText(), "1", "never below 1");
    await productCard(page, "Alpha Printer").click();
    await productCard(page, "Alpha Printer").click();
    const text = await cart(page).innerText();
    log(text.replace(/\s+/g, " ").slice(0, 200));
    assert.match(text, /Subtotal\s+Rs\. 2,250/);
    assert.match(text, /Tax \(10%\)\s+Rs\. 225/);
    assert.match(await complete.innerText(), /Rs\. 2,475/);
    await cartLine(page, "Beta Toner").locator("button").nth(2).click(); // remove
    assert.equal(await cartLine(page, "Beta Toner").count(), 0);
    assert.match(await complete.innerText(), /Rs\. 2,200/);
    await page.context().close();
  });

  test("POS-3 a walk-in cash sale saves the order, reduces stock and books revenue + cost of goods sold", async () => {
    page = await openApp(browser, "Point of Sale");
    await productCard(page, "Alpha Printer").click();
    await productCard(page, "Alpha Printer").click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const order = s.salesOrders[0];
    log(message);
    log("order:", JSON.stringify(order));
    log("ledger:", JSON.stringify(s.ledger));
    assert.equal(message, "Sale completed — Rs. 2,200 received via Cash. Invoice INV-2462 generated.");
    assert.deepEqual(
      { ...order, payments: order.payments },
      {
        id: "SO-1043",
        invoice: "INV-2462",
        customer: "Walk-in Customer",
        items: 2,
        lineItems: [{ productId: 101, name: "Alpha Printer", qty: 2, price: 1000 }],
        amount: 2200,
        tax: 200,
        status: "Delivered",
        payment: "Paid",
        date: today(),
        channel: "POS",
        amountPaid: 2200,
        payments: [{ date: today(), amount: 2200 }],
        accrued: true,
      },
    );
    assert.equal(s.products.find((p) => p.id === 101).stock, 8);
    assert.deepEqual(
      s.ledger.map(({ id, category, amount, account, kind, cash }) => ({
        id,
        category,
        amount,
        account,
        kind,
        cash,
      })),
      [
        {
          id: "TXN-8822",
          category: "Sales",
          amount: 2200,
          account: "CASH-MAIN",
          kind: "revenue",
          cash: undefined,
        },
        {
          id: "TXN-8823",
          category: "Cost of Goods Sold",
          amount: 1200,
          account: undefined,
          kind: "cogs",
          cash: false,
        },
      ],
    );
    assert.equal(await cart(page).getByText("Cart is empty").count(), 1, "the cart is cleared");
    assert.deepEqual(takeConsoleProblems(page), []);
    await page.context().close();
  });

  test("POS-4 a card sale to a customer goes to the Bank Account and updates the customer's totals", async () => {
    page = await openApp(browser, "Point of Sale");
    await field(cart(page), "Customer").selectOption("201");
    await productCard(page, "Beta Toner").click();
    await cart(page).getByRole("button", { name: "Card", exact: true }).click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    await waitSaved(page);
    const s = await stores();
    const acme = s.customers.find((c) => c.id === 201);
    log(
      `order customerId=${s.salesOrders[0].customerId}; revenue account=${s.ledger[0].account}; Acme orders=${acme.orders} spent=${acme.spent}`,
    );
    assert.equal(s.salesOrders[0].customer, "Acme Traders");
    assert.equal(s.salesOrders[0].customerId, 201);
    assert.equal(s.ledger[0].account, "BANK-MAIN");
    assert.deepEqual([acme.orders, acme.spent], [1, 275]);
    await page.context().close();
  });

  test("POS-5 a bank payment also goes to the Bank Account", async () => {
    page = await openApp(browser, "Point of Sale");
    await productCard(page, "Alpha Printer").click();
    await cart(page).getByRole("button", { name: "Bank", exact: true }).click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    await waitSaved(page);
    assert.equal((await stores()).ledger[0].account, "BANK-MAIN");
    await page.context().close();
  });
});

/* --------------------------------------------------------- Sales Orders */

describe("Sales Orders", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });
  const itemRows = (m) => m.locator("div.space-y-2 > div");

  async function newOrder(page, { items, status = "Processing", payment = "Pending", attach }) {
    await page.getByRole("button", { name: "New Order" }).click();
    const m = modal(page);
    await field(m, "Customer").selectOption("201");
    for (let i = 0; i < items.length; i++) {
      if (i > 0) await m.getByRole("button", { name: "Add line item" }).click();
      await itemRows(m).nth(i).locator("select").selectOption(String(items[i].productId));
      await itemRows(m).nth(i).locator("input[type=number]").fill(String(items[i].qty));
    }
    await field(m, "Fulfillment Status").selectOption(status);
    await field(m, "Payment Status").selectOption(payment);
    if (attach) await field(m, "Attach Invoice / Delivery Slip (optional)").setInputFiles(attach);
    await m.getByRole("button", { name: "Create Sales Order" }).click();
  }

  test("SO-1 a paid order reduces stock, adds to the customer's spend and books cash revenue + cost of goods sold", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, { items: [{ productId: 101, qty: 3 }], status: "Delivered", payment: "Paid" });
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const o = s.salesOrders[0];
    log(message);
    assert.equal(message, "Sales order SO-1043 created for Acme Traders — Rs. 3,300.");
    assert.deepEqual(
      [o.amount, o.tax, o.items, o.channel, o.status, o.payment, o.amountPaid, o.accrued],
      [3300, 300, 3, "Manual", "Delivered", "Paid", 3300, true],
    );
    assert.deepEqual(o.payments, [{ date: today(), amount: 3300 }]);
    assert.equal(s.products.find((p) => p.id === 101).stock, 7);
    const acme = s.customers.find((c) => c.id === 201);
    assert.deepEqual([acme.orders, acme.spent, acme.outstanding], [1, 3300, 0]);
    assert.deepEqual(
      s.ledger.map(({ category, amount, account, kind, cash }) => [category, amount, account, kind, cash]),
      [
        ["Sales", 3300, "CASH-MAIN", "revenue", true],
        ["Cost of Goods Sold", 1800, undefined, "cogs", false],
      ],
    );
    await page.context().close();
  });

  test("SO-2 an unpaid order with two items becomes a receivable: revenue is booked, but no cash", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, {
      items: [
        { productId: 101, qty: 1 },
        { productId: 102, qty: 2 },
      ],
    });
    await waitSaved(page);
    const s = await stores();
    const o = s.salesOrders[0];
    log("order:", JSON.stringify({ amount: o.amount, tax: o.tax, items: o.items, lineItems: o.lineItems }));
    assert.deepEqual([o.amount, o.tax, o.items, o.amountPaid, o.payment], [1650, 150, 3, 0, "Pending"]);
    assert.deepEqual(o.payments, []);
    assert.deepEqual(
      s.products.filter((p) => p.id !== 103).map((p) => p.stock),
      [9, 1],
    );
    assert.equal(s.customers.find((c) => c.id === 201).outstanding, 1650);
    assert.deepEqual(
      s.ledger.map(({ amount, account, kind, cash }) => [amount, account, kind, cash]),
      [
        [1650, undefined, "revenue", false],
        [800, undefined, "cogs", false],
      ],
    );
    assert.equal(await card(page, "Outstanding to Collect").innerText(), "Rs. 1,650");
    await page.context().close();
  });

  test("SO-3 ordering more than the stock is refused with a message, and nothing is saved", async () => {
    const page = await openApp(browser, "Sales Orders");
    const dialogs = captureDialogs(page);
    await newOrder(page, { items: [{ productId: 102, qty: 4 }] });
    await page.waitForTimeout(500);
    log("alert:", dialogs.join(" | "));
    assert.deepEqual(dialogs, ["Not enough stock for Beta Toner. Only 3 available."]);
    assert.equal(await modal(page).getByText("New Sales Order").count(), 1, "the form stays open");
    assert.equal((await stores()).salesOrders.length, 0);
    await page.context().close();
  });

  test("SO-4 collecting part of an invoice records a receipt, not new income, and lowers the balance", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, {
      items: [
        { productId: 101, qty: 1 },
        { productId: 102, qty: 2 },
      ],
    });
    await waitSaved(page);
    await row(page, "SO-1043").getByRole("button", { name: "Collect" }).click();
    await field(modal(page), "Amount Received Now").fill("650");
    await modal(page).getByRole("button", { name: "Record" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const o = s.salesOrders[0];
    log(message);
    assert.equal(message, "Rs. 650 received from Acme Traders. Balance remaining Rs. 1,000.");
    assert.deepEqual([o.amountPaid, o.payment], [650, "Pending"]);
    assert.deepEqual(o.payments, [{ date: today(), amount: 650 }]);
    assert.equal(s.customers.find((c) => c.id === 201).outstanding, 1000);
    const receipt = s.ledger[0];
    assert.deepEqual(
      [receipt.category, receipt.kind, receipt.amount, receipt.account],
      ["Receivable Collection", "ar_collection", 650, "CASH-MAIN"],
    );
    assert.match(await modal(page).innerText(), /Balance Due\s+Rs\. 1,000/);
    await page.context().close();
  });

  test("SO-5 'Settle full balance' marks the invoice paid", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, { items: [{ productId: 102, qty: 1 }] });
    await waitSaved(page);
    await row(page, "SO-1043").click();
    await modal(page).getByRole("button", { name: "Settle full balance" }).click();
    await waitSaved(page);
    const s = await stores();
    log(
      `payment=${s.salesOrders[0].payment}, paid=${s.salesOrders[0].amountPaid}, customer outstanding=${s.customers[0].outstanding}`,
    );
    assert.deepEqual([s.salesOrders[0].payment, s.salesOrders[0].amountPaid], ["Paid", 275]);
    assert.equal(s.customers.find((c) => c.id === 201).outstanding, 0);
    assert.equal(await row(page, "SO-1043").getByRole("button", { name: "Collect" }).count(), 0);
    await page.context().close();
  });

  test("SO-6 a payment of 0, or more than the balance, is refused", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, { items: [{ productId: 102, qty: 1 }] });
    await waitSaved(page);
    await row(page, "SO-1043").click();
    await modal(page).getByRole("button", { name: "Record" }).click();
    const blank = await toast(page).innerText();
    await field(modal(page), "Amount Received Now").fill("300");
    await modal(page).getByRole("button", { name: "Record" }).click();
    await page.waitForTimeout(200);
    const tooMuch = await toast(page).innerText();
    log(`blank -> "${blank}"; 300 of 275 -> "${tooMuch}"`);
    assert.equal(blank, "Enter a payment amount greater than 0.");
    assert.equal(tooMuch, "Payment cannot be more than the outstanding balance of Rs. 275.");
    assert.equal((await stores()).salesOrders[0].amountPaid, 0);
    await page.context().close();
  });

  test("SO-7 collecting an invoice raised before the accounting upgrade books the money as sales revenue", async () => {
    const data = shopFixture();
    data.salesOrders = [
      {
        id: "SO-1000",
        invoice: "INV-1000",
        customer: "Bob Retail",
        customerId: 202,
        items: 1,
        amount: 500,
        status: "Delivered",
        payment: "Pending",
        date: "2026-01-02",
      },
    ];
    data.customers[1].outstanding = 500;
    await loadStores(data);
    const page = await openApp(browser, "Sales Orders");
    await row(page, "SO-1000").click();
    await modal(page).getByRole("button", { name: "Settle full balance" }).click();
    await waitSaved(page);
    const t = (await stores()).ledger[0];
    log(JSON.stringify(t));
    assert.deepEqual(
      [t.desc, t.category, t.kind, t.amount],
      ["Payment received — INV-1000", "Sales", "revenue", 500],
    );
    await page.context().close();
  });

  test("SO-8 deleting an order puts the stock back, reverses the customer's totals and removes its ledger lines", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, { items: [{ productId: 101, qty: 2 }] });
    await waitSaved(page);
    await row(page, "SO-1043").locator("button").last().click(); // delete (confirmed)
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.equal(message, "Order SO-1043 deleted.");
    assert.equal(s.salesOrders.length, 0);
    assert.equal(s.products.find((p) => p.id === 101).stock, 10);
    const acme = s.customers.find((c) => c.id === 201);
    assert.deepEqual([acme.orders, acme.spent, acme.outstanding], [0, 0, 0]);
    assert.deepEqual(s.ledger, []);
    await page.context().close();
  });

  test("SO-9 search, status filter and 'credit bills / outstanding' filter", async () => {
    const data = shopFixture();
    data.salesOrders = [
      {
        id: "SO-1001",
        invoice: "INV-1",
        customer: "Acme Traders",
        customerId: 201,
        items: 1,
        amount: 100,
        status: "Processing",
        payment: "Pending",
        date: "2026-02-01",
        amountPaid: 0,
      },
      {
        id: "SO-1002",
        invoice: "INV-2",
        customer: "Bob Retail",
        customerId: 202,
        items: 1,
        amount: 200,
        status: "Delivered",
        payment: "Paid",
        date: "2026-02-02",
        amountPaid: 200,
      },
      {
        id: "SO-1003",
        invoice: "INV-3",
        customer: "Corner Shop",
        customerId: null,
        items: 1,
        amount: 300,
        status: "Delivered",
        payment: "Overdue",
        date: "2026-02-03",
        amountPaid: 0,
        isCredit: true,
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Sales Orders");
    const ids = async () =>
      (await page.locator("main tbody tr td:first-child").allInnerTexts()).filter((t) => /^SO-/.test(t));
    assert.deepEqual(await ids(), ["SO-1001", "SO-1002", "SO-1003"]);
    await page.getByPlaceholder("Search order # or customer...").fill("bob");
    assert.deepEqual(await ids(), ["SO-1002"]);
    await page.getByPlaceholder("Search order # or customer...").fill("so-1001");
    assert.deepEqual(await ids(), ["SO-1001"]);
    await page.getByPlaceholder("Search order # or customer...").fill("");
    await page.locator("main select").nth(0).selectOption("Delivered");
    assert.deepEqual(await ids(), ["SO-1002", "SO-1003"]);
    await page.locator("main select").nth(0).selectOption("All");
    await page.locator("main select").nth(1).selectOption("Credit bills");
    assert.deepEqual(await ids(), ["SO-1003"]);
    await page.locator("main select").nth(1).selectOption("Outstanding balance");
    assert.deepEqual(await ids(), ["SO-1001", "SO-1003"]);
    await page.locator("main select").nth(0).selectOption("Cancelled");
    await page.getByText("No orders match these filters.").waitFor();
    log(
      "summary:",
      await card(page, "Total Order Value").innerText(),
      await card(page, "Overdue Payment").innerText(),
    );
    assert.equal(await card(page, "Total Order Value").innerText(), "Rs. 600");
    assert.equal(await card(page, "Outstanding to Collect").innerText(), "Rs. 400");
    assert.equal(await card(page, "Processing").innerText(), "1");
    assert.equal(await card(page, "Overdue Payment").innerText(), "1");
    await page.context().close();
  });

  test("SO-10 an invoice slip can be attached to a new order and viewed from the list", async () => {
    const page = await openApp(browser, "Sales Orders");
    await newOrder(page, { items: [{ productId: 102, qty: 1 }], attach: PNG });
    await waitSaved(page);
    const a = (await stores()).salesOrders[0].attachment;
    log(`attachment: ${a.name}, ${a.type}, ${a.dataUrl.length} chars`);
    assert.deepEqual([a.name, a.type], ["slip.png", "image/png"]);
    assert.ok(a.dataUrl.startsWith("data:image/png;base64,"));
    assert.equal(await row(page, "SO-1043").getByText("View slip").count(), 1);
    await page.context().close();
  });

  test("SO-11 a slip bigger than 4.5 MB is refused", async () => {
    const page = await openApp(browser, "Sales Orders");
    await page.getByRole("button", { name: "New Order" }).click();
    await field(modal(page), "Attach Invoice / Delivery Slip (optional)").setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(5 * 1024 * 1024),
    });
    await modal(page).getByText("File is too large — please choose a file under 4.5MB.").waitFor();
    assert.equal(await modal(page).getByText("huge.png").count(), 0);
    await page.context().close();
  });

  test("SO-12 'New Order' is disabled while there are no customers", async () => {
    await loadStores({ ...shopFixture(), customers: [] });
    const page = await openApp(browser, "Sales Orders");
    assert.equal(await page.getByRole("button", { name: "New Order" }).isDisabled(), true);
    await page.context().close();
  });
});

/* ------------------------------------------------------------ Customers */

describe("Customers", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });

  test("CUS-1 the summary cards add up the customer list", async () => {
    const page = await openApp(browser, "Customers");
    const values = {};
    for (const l of ["Total Customers", "Lifetime Revenue", "Outstanding Balance", "Wholesale Accounts"])
      values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    assert.deepEqual(values, {
      "Total Customers": "2",
      "Lifetime Revenue": "Rs. 500",
      "Outstanding Balance": "Rs. 0",
      "Wholesale Accounts": "1",
    });
    await page.context().close();
  });

  test("CUS-2 a new customer is saved with zero orders, spend and balance", async () => {
    const page = await openApp(browser, "Customers");
    await page.getByRole("button", { name: "Add Customer" }).click();
    const m = modal(page);
    await field(m, "Business / Customer Name").fill("Corner Shop");
    await field(m, "Contact Person").fill("Chamari");
    await field(m, "Phone").fill("077 123 4567");
    await field(m, "Email").fill("corner@shop.lk");
    await field(m, "Tier").selectOption("Wholesale");
    await m.getByRole("button", { name: "Add Customer" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const c = (await stores()).customers.find((x) => x.name === "Corner Shop");
    log(message, JSON.stringify(c));
    assert.equal(message, "Corner Shop added as a customer.");
    assert.ok(Number.isSafeInteger(c.id));
    assert.deepEqual(
      { ...c, id: undefined },
      {
        id: undefined,
        name: "Corner Shop",
        contact: "Chamari",
        phone: "077 123 4567",
        email: "corner@shop.lk",
        tier: "Wholesale",
        orders: 0,
        spent: 0,
        outstanding: 0,
      },
    );
    await page.context().close();
  });

  test("CUS-3 a customer can't be added without a name", async () => {
    const page = await openApp(browser, "Customers");
    await page.getByRole("button", { name: "Add Customer" }).click();
    await modal(page).getByRole("button", { name: "Add Customer" }).click();
    await page.waitForTimeout(300);
    assert.equal(
      await modal(page).getByText("Add Customer").first().isVisible(),
      true,
      "the form stays open",
    );
    assert.equal((await stores()).customers.length, 2);
    await page.context().close();
  });

  test("CUS-4 search and the tier filter", async () => {
    const page = await openApp(browser, "Customers");
    const names = async () => await page.locator("main tbody tr td:first-child").allInnerTexts();
    await page.getByPlaceholder("Search customer...").fill("acme");
    assert.deepEqual(await names(), ["Acme Traders"]);
    await page.getByPlaceholder("Search customer...").fill("");
    await page.locator("main select").selectOption("Retail");
    assert.deepEqual(await names(), ["Bob Retail"]);
    await page.getByPlaceholder("Search customer...").fill("acme");
    await page.getByText("No customers match these filters.").waitFor();
    await page.context().close();
  });

  test("CUS-5 deleting a customer (after confirming)", async () => {
    const page = await openApp(browser, "Customers");
    const dialogs = captureDialogs(page);
    await row(page, "Bob Retail").locator("button").click();
    await waitSaved(page);
    log("confirm:", dialogs[0]);
    assert.deepEqual(dialogs, ['Delete customer "Bob Retail"?']);
    assert.deepEqual(
      (await stores()).customers.map((c) => c.name),
      ["Acme Traders"],
    );
    await page.context().close();
  });
});
