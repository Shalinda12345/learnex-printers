// Feature tests: Products & Inventory, Suppliers, Raw Materials, Purchases and
// Delivery Stock, driven in the browser against a small known data set.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
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

/* ------------------------------------------------- Products & Inventory */

describe("Products & Inventory", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });
  const names = (page) => page.locator("main tbody tr td:first-child").allInnerTexts();

  test("INV-1 summary cards: stock value at cost, SKUs, low stock and out of stock", async () => {
    const page = await openApp(browser, "Products & Inventory");
    const values = {};
    for (const l of ["Total Stock Value", "Total SKUs", "Low Stock", "Out of Stock"])
      values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    // 600 × 10 + 100 × 3 + 20 × 0
    assert.deepEqual(values, {
      "Total Stock Value": "Rs. 6,300",
      "Total SKUs": "3",
      "Low Stock": "1",
      "Out of Stock": "1",
    });
    assert.match(await page.locator("main").innerText(), /3 products across 3 categories/);
    await page.context().close();
  });

  test("INV-2 each product shows its stock status", async () => {
    const page = await openApp(browser, "Products & Inventory");
    for (const [name, status] of [
      ["Alpha Printer", "In Stock"],
      ["Beta Toner", "Low Stock"],
      ["Gamma Paper", "Out of Stock"],
    ])
      assert.match(await row(page, name).innerText(), new RegExp(status), name);
    await page.context().close();
  });

  test("INV-3 adding a product keeps decimal prices", async () => {
    const page = await openApp(browser, "Products & Inventory");
    await page.getByRole("button", { name: "Add Product" }).click();
    const m = modal(page);
    await field(m, "Product Name").fill("Delta Scanner");
    await field(m, "SKU").fill("DEL-4");
    await field(m, "Category").selectOption("Spare Parts");
    await field(m, "Cost Price").fill("120.5");
    await field(m, "Selling Price").fill("199.99");
    await field(m, "Unit").fill("unit");
    await field(m, "Opening Stock").fill("7");
    await field(m, "Reorder Point (min)").fill("3");
    await m.getByRole("button", { name: "Add Product" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const p = (await stores()).products.find((x) => x.sku === "DEL-4");
    log(message, JSON.stringify(p));
    assert.equal(message, "Delta Scanner added to inventory.");
    assert.ok(Number.isSafeInteger(p.id) && p.id > 103);
    assert.deepEqual(
      { ...p, id: 0 },
      {
        id: 0,
        name: "Delta Scanner",
        sku: "DEL-4",
        category: "Spare Parts",
        price: 199.99,
        cost: 120.5,
        stock: 7,
        min: 3,
        unit: "unit",
      },
    );
    await page.context().close();
  });

  test("INV-4 a product needs a name, SKU, cost and price", async () => {
    const page = await openApp(browser, "Products & Inventory");
    await page.getByRole("button", { name: "Add Product" }).click();
    await field(modal(page), "Product Name").fill("No SKU");
    await field(modal(page), "Cost Price").fill("1");
    await field(modal(page), "Selling Price").fill("2");
    await modal(page).getByRole("button", { name: "Add Product" }).click();
    await page.waitForTimeout(300);
    assert.equal((await stores()).products.length, 3);
    await page.context().close();
  });

  test("INV-5 editing a product changes only that product", async () => {
    const page = await openApp(browser, "Products & Inventory");
    await row(page, "Beta Toner").locator("button").nth(0).click();
    await field(modal(page), "Selling Price").fill("275.5");
    await field(modal(page), "Opening Stock").fill("12");
    await modal(page).getByRole("button", { name: "Save Changes" }).click();
    await waitSaved(page);
    const s = await stores();
    log(JSON.stringify(s.products.find((p) => p.id === 102)));
    assert.deepEqual(
      s.products.find((p) => p.id === 102),
      {
        id: 102,
        name: "Beta Toner",
        sku: "BET-2",
        category: "Ink & Toner",
        price: 275.5,
        cost: 100,
        stock: 12,
        min: 5,
        unit: "pc",
      },
    );
    assert.deepEqual(
      s.products.filter((p) => p.id !== 102),
      shopFixture().products.filter((p) => p.id !== 102),
    );
    assert.match(await row(page, "Beta Toner").innerText(), /In Stock/);
    await page.context().close();
  });

  test("INV-6 deleting a product (after confirming)", async () => {
    const page = await openApp(browser, "Products & Inventory");
    const dialogs = captureDialogs(page);
    await row(page, "Gamma Paper").locator("button").nth(1).click();
    await waitSaved(page);
    assert.deepEqual(dialogs, ['Delete "Gamma Paper"? This cannot be undone.']);
    assert.deepEqual(
      (await stores()).products.map((p) => p.name),
      ["Alpha Printer", "Beta Toner"],
    );
    await page.context().close();
  });

  test("INV-7 search by name or SKU, and filter by category or stock status", async () => {
    const page = await openApp(browser, "Products & Inventory");
    await page.getByPlaceholder("Search name or SKU...").fill("gam-3");
    assert.deepEqual(await names(page), ["Gamma Paper"]);
    await page.getByPlaceholder("Search name or SKU...").fill("toner");
    assert.deepEqual(await names(page), ["Beta Toner"]);
    await page.getByPlaceholder("Search name or SKU...").fill("");
    await page.locator("main select").nth(0).selectOption("Printers");
    assert.deepEqual(await names(page), ["Alpha Printer"]);
    await page.locator("main select").nth(0).selectOption("All");
    await page.locator("main select").nth(1).selectOption("Low Stock");
    assert.deepEqual(await names(page), ["Beta Toner"]);
    await page.locator("main select").nth(1).selectOption("Out of Stock");
    assert.deepEqual(await names(page), ["Gamma Paper"]);
    await page.locator("main select").nth(0).selectOption("Printers");
    await page.getByText("No products match these filters.").waitFor();
    await page.context().close();
  });
});

/* ------------------------------------------------------------ Suppliers */

describe("Suppliers", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });

  test("SUP-1 summary cards", async () => {
    const page = await openApp(browser, "Suppliers");
    assert.equal(await card(page, "Total Suppliers").innerText(), "2");
    assert.equal(await card(page, "Active").innerText(), "1");
    assert.equal(await card(page, "Total Purchased (YTD)").innerText(), "Rs. 1,200");
    await page.context().close();
  });

  test("SUP-2 a new supplier starts with nothing purchased", async () => {
    const page = await openApp(browser, "Suppliers");
    await page.getByRole("button", { name: "Add Supplier" }).click();
    const m = modal(page);
    await field(m, "Supplier Name").fill("Ink World");
    await field(m, "Contact Person").fill("Ian");
    await field(m, "Phone").fill("033");
    await field(m, "Email").fill("ink@world.lk");
    await field(m, "Category Supplied").fill("Ink");
    await field(m, "Status").selectOption("On Hold");
    await m.getByRole("button", { name: "Add Supplier" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const sup = (await stores()).suppliers.find((x) => x.name === "Ink World");
    log(message, JSON.stringify(sup));
    assert.equal(message, "Ink World added as a supplier.");
    assert.deepEqual(
      { ...sup, id: 0 },
      {
        id: 0,
        name: "Ink World",
        contact: "Ian",
        phone: "033",
        email: "ink@world.lk",
        category: "Ink",
        status: "On Hold",
        purchased: 0,
      },
    );
    await page.context().close();
  });

  test("SUP-3 search and delete", async () => {
    const page = await openApp(browser, "Suppliers");
    await page.getByPlaceholder("Search supplier...").fill("old");
    assert.deepEqual(await page.locator("main tbody tr td:first-child").allInnerTexts(), ["Old Supplies"]);
    await page.getByPlaceholder("Search supplier...").fill("zzz");
    await page.getByText("No suppliers match this search.").waitFor();
    await page.getByPlaceholder("Search supplier...").fill("");
    await row(page, "Old Supplies").locator("button").click();
    await waitSaved(page);
    assert.deepEqual(
      (await stores()).suppliers.map((x) => x.name),
      ["Paper Mills Ltd"],
    );
    await page.context().close();
  });
});

/* -------------------------------------------------------- Raw Materials */

describe("Raw Materials", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });
  const usageForm = (page) =>
    page.locator("form", { has: page.getByRole("button", { name: "Record Usage" }) });

  test("RM-1 summary cards: value at average cost, stock and low-stock count", async () => {
    const page = await openApp(browser, "Raw Materials");
    const values = {};
    for (const l of [
      "Total Raw Materials Value",
      "Materials",
      "Total Available Stock",
      "Low Stock Materials",
    ])
      values[l] = await card(page, l).innerText();
    log(JSON.stringify(values));
    // 100 × 10 + 40 × 1; Ink Base has 1 of 5 left (≤ 20 %)
    assert.deepEqual(values, {
      "Total Raw Materials Value": "Rs. 1,040",
      Materials: "2",
      "Total Available Stock": "11",
      "Low Stock Materials": "1",
    });
    await page.context().close();
  });

  test("RM-2 adding a material: available quantity defaults to the purchase quantity", async () => {
    const page = await openApp(browser, "Raw Materials");
    await page.getByRole("button", { name: "Add Raw Material" }).click();
    const m = modal(page);
    await field(m, "Material Name").fill("Copper Wire");
    await field(m, "Category").selectOption("Metals");
    await field(m, "Supplier").selectOption("Old Supplies");
    await field(m, "Unit").fill("m");
    await field(m, "Purchase Quantity").fill("25");
    await field(m, "Average Cost (per unit)").fill("12.5");
    await field(m, "Purchase Date").fill("2026-03-01");
    await field(m, "Batch Number (optional)").fill("CW-7");
    await field(m, "Notes").fill("roll");
    await m.getByRole("button", { name: "Add Raw Material" }).click();
    await waitSaved(page);
    const mat = (await stores()).rawMaterials.find((x) => x.name === "Copper Wire");
    log(JSON.stringify(mat));
    assert.deepEqual(
      { ...mat, id: 0 },
      {
        id: 0,
        name: "Copper Wire",
        category: "Metals",
        supplier: "Old Supplies",
        unit: "m",
        purchaseQty: 25,
        availableQty: 25,
        costPrice: 12.5,
        purchaseDate: "2026-03-01",
        batchNumber: "CW-7",
        notes: "roll",
      },
    );
    await page.context().close();
  });

  test("RM-3 editing a material's notes leaves its weighted average cost untouched", async () => {
    const data = shopFixture();
    data.rawMaterials[0].costPrice = 333.333333;
    await loadStores(data);
    const page = await openApp(browser, "Raw Materials");
    await row(page, "Resin").locator("button").nth(0).click();
    await field(modal(page), "Notes").fill("checked");
    await modal(page).getByRole("button", { name: "Save Changes" }).click();
    await waitSaved(page);
    const resin = (await stores()).rawMaterials.find((x) => x.id === 401);
    log(`notes=${resin.notes}; costPrice ${333.333333} -> ${resin.costPrice}`);
    assert.equal(resin.notes, "checked");
    assert.equal(resin.costPrice, 333.333333);
    await page.context().close();
  });

  test("RM-4 deleting a material", async () => {
    const page = await openApp(browser, "Raw Materials");
    await row(page, "Ink Base").locator("button").nth(1).click();
    await waitSaved(page);
    assert.deepEqual(
      (await stores()).rawMaterials.map((x) => x.name),
      ["Resin"],
    );
    await page.context().close();
  });

  test("RM-5 recording usage lowers the available stock and logs who used it — with no expense posted", async () => {
    const page = await openApp(browser, "Raw Materials");
    const f = usageForm(page);
    await field(f, "Date").fill("2026-03-05");
    await field(f, "Raw Material").selectOption("401");
    await field(f, "Quantity Used").fill("4");
    await field(f, "Notes (optional)").fill("batch 7");
    await f.getByRole("button", { name: "Record Usage" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    log(JSON.stringify(s.rawMaterialUsage[0]));
    assert.match(message, /^4 kg of Resin recorded as used on Mar 5\. 6 kg remaining\. Stock movement only/);
    assert.equal(s.rawMaterials.find((x) => x.id === 401).availableQty, 6);
    assert.deepEqual(s.rawMaterialUsage, [
      {
        id: "USE-1001",
        date: "2026-03-05",
        materialId: 401,
        materialName: "Resin",
        qtyUsed: 4,
        remainingQty: 6,
        user: "Test Owner",
        notes: "batch 7",
        consumedValue: 400,
      },
    ]);
    assert.deepEqual(s.ledger, [], "using material is not an expense");
    assert.match(await row(page, "batch 7").innerText(), /Resin\s+4\s+6\s+Test Owner/);
    await page.context().close();
  });

  test("RM-6 using more than is available, or nothing, is refused", async () => {
    const page = await openApp(browser, "Raw Materials");
    const f = usageForm(page);
    await field(f, "Raw Material").selectOption("401");
    await field(f, "Quantity Used").fill("11");
    await f.getByRole("button", { name: "Record Usage" }).click();
    const tooMuch = await toast(page).innerText();
    await field(f, "Quantity Used").fill("0");
    await f.getByRole("button", { name: "Record Usage" }).click();
    await page.waitForTimeout(200);
    const zero = await toast(page).innerText();
    log(`11 kg -> "${tooMuch}"; 0 -> "${zero}"`);
    assert.equal(tooMuch, "Only 10 kg of Resin is available.");
    assert.equal(zero, "Enter a quantity used greater than 0.");
    assert.deepEqual((await stores()).rawMaterialUsage, []);
    await page.context().close();
  });

  test("RM-7 deleting a usage record returns the quantity to stock", async () => {
    const data = shopFixture();
    data.rawMaterials[0].availableQty = 6;
    data.rawMaterialUsage = [
      {
        id: "USE-1001",
        date: "2026-03-05",
        materialId: 401,
        materialName: "Resin",
        qtyUsed: 4,
        remainingQty: 6,
        user: "Ann",
        notes: "",
        consumedValue: 400,
        ledgerTxnId: null,
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Raw Materials");
    await page.getByTitle("Delete this usage record and return the quantity to stock").click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.equal(message, "Usage record removed. 4 kg returned to Resin.");
    assert.equal(s.rawMaterials.find((x) => x.id === 401).availableQty, 10);
    assert.deepEqual(s.rawMaterialUsage, []);
    await page.context().close();
  });

  test("RM-8 usage history can be searched and limited to a date range", async () => {
    const data = shopFixture();
    data.rawMaterialUsage = [
      {
        id: "USE-1002",
        date: "2026-03-10",
        materialId: 402,
        materialName: "Ink Base",
        qtyUsed: 1,
        remainingQty: 0,
        user: "Bob",
        notes: "b",
      },
      {
        id: "USE-1001",
        date: "2026-03-01",
        materialId: 401,
        materialName: "Resin",
        qtyUsed: 2,
        remainingQty: 8,
        user: "Ann",
        notes: "a",
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Raw Materials");
    const history = page
      .locator("div.rounded-2xl", { has: page.getByText("Raw Material Usage History") })
      .last();
    const materials = () => history.locator("tbody tr td:nth-child(2)").allInnerTexts();
    assert.deepEqual(await materials(), ["Ink Base", "Resin"]);
    await page.getByPlaceholder("Search material or user...").fill("ann");
    assert.deepEqual(await materials(), ["Resin"]);
    await page.getByPlaceholder("Search material or user...").fill("");
    await history.locator("input[type=date]").nth(0).fill("2026-03-05");
    assert.deepEqual(await materials(), ["Ink Base"]);
    await history.locator("input[type=date]").nth(1).fill("2026-03-09");
    await history.getByText("No usage recorded yet.").waitFor();
    await page.context().close();
  });

  test("RM-9 with no raw materials the list says so", async () => {
    await loadStores({ ...shopFixture(), rawMaterials: [] });
    const page = await openApp(browser, "Raw Materials");
    await page.waitForTimeout(300);
    const shown = await page.getByText("No raw materials yet.").count();
    log(`empty-list message shown: ${shown > 0}`);
    assert.equal(shown, 1);
    await page.context().close();
  });
});

/* ------------------------------------------------------------ Purchases */

describe("Purchases", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });
  const itemRows = (m) => m.locator("div.space-y-2 > div");

  async function newPurchase(page, { items, settlement = "Paid", account, topUpFrom }) {
    await page.getByRole("button", { name: "New Purchase Order" }).click();
    const m = modal(page);
    await field(m, "Supplier").selectOption("301");
    for (let i = 0; i < items.length; i++) {
      if (i > 0) await m.getByRole("button", { name: "Add line item" }).click();
      const r = itemRows(m).nth(i);
      await r.locator("select").selectOption(String(items[i].materialId));
      await r.getByPlaceholder("Qty").fill(String(items[i].qty));
      await r.getByPlaceholder("Unit cost").fill(String(items[i].cost));
    }
    await field(m, "Settlement").selectOption(settlement);
    if (account) await field(m, "Pay From Account").selectOption(account);
    if (topUpFrom) await m.locator("select", { hasText: "Move from" }).selectOption(topUpFrom);
    await m.getByRole("button", { name: "Save Purchase Order" }).click();
  }

  test("PO-1 a paid purchase adds raw material stock at a weighted average cost and pays from cash — profit untouched", async () => {
    const page = await openApp(browser, "Purchases");
    await newPurchase(page, { items: [{ materialId: 401, qty: 5, cost: 120 }] });
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const resin = s.rawMaterials.find((x) => x.id === 401);
    log(message);
    log("Resin:", JSON.stringify(resin));
    assert.equal(
      message,
      "Purchase order PO-4001 recorded — Rs. 600 paid from Cash Account. Raw material stock updated; this is an asset purchase, so your profit is unaffected.",
    );
    assert.deepEqual(
      [resin.availableQty, resin.purchaseQty, resin.costPrice, resin.lastPurchaseCost],
      [15, 15, 106.666667, 120],
    );
    const sup = s.suppliers.find((x) => x.id === 301);
    assert.deepEqual([sup.purchased, sup.lastOrder], [600, today()]);
    assert.deepEqual(s.purchaseOrders, [
      {
        id: "PO-4001",
        supplier: "Paper Mills Ltd",
        supplierId: 301,
        items: 5,
        lineItems: [{ materialId: 401, name: "Resin", qty: 5, cost: 120 }],
        total: 600,
        date: today(),
        paymentStatus: "Paid",
        amountPaid: 600,
        cashAccount: "CASH-MAIN",
        toppedUpAmount: 0,
        ledgerTxnIds: ["TXN-8822"],
      },
    ]);
    assert.deepEqual(
      s.ledger.map(({ id, category, amount, account, kind, type }) => ({
        id,
        category,
        amount,
        account,
        kind,
        type,
      })),
      [
        {
          id: "TXN-8822",
          category: "Stock & Raw Material Purchase",
          amount: 600,
          account: "CASH-MAIN",
          kind: "asset_purchase",
          type: "Expense",
        },
      ],
    );
    assert.equal(await card(page, "Cash & Bank Available").innerText(), "Rs. 4,400");
    assert.equal(await card(page, "Total Purchased").innerText(), "Rs. 600");
    await page.context().close();
  });

  test("PO-2 a purchase on credit becomes a payable: stock arrives, no cash moves", async () => {
    const page = await openApp(browser, "Purchases");
    await newPurchase(page, { items: [{ materialId: 401, qty: 5, cost: 120 }], settlement: "Unpaid" });
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.match(message, /^Purchase order PO-4001 recorded on credit — Rs\. 600 now shows as a payable\./);
    assert.deepEqual(
      [s.purchaseOrders[0].paymentStatus, s.purchaseOrders[0].amountPaid, s.purchaseOrders[0].ledgerTxnIds],
      ["Unpaid", 0, []],
    );
    assert.deepEqual(s.ledger, []);
    assert.equal(s.rawMaterials.find((x) => x.id === 401).availableQty, 15);
    assert.equal(await card(page, "Owed to Suppliers").innerText(), "Rs. 600");
    assert.match(await row(page, "PO-4001").innerText(), /Unpaid/);
    await page.context().close();
  });

  test("PO-3 paying a supplier later settles the payable without touching profit", async () => {
    const page = await openApp(browser, "Purchases");
    await newPurchase(page, { items: [{ materialId: 401, qty: 5, cost: 120 }], settlement: "Unpaid" });
    await waitSaved(page);
    await row(page, "PO-4001").click();
    await modal(page).getByRole("button", { name: "Pay Rs. 600 to Supplier" }).click();
    await waitSaved(page);
    const s = await stores();
    const po = s.purchaseOrders[0];
    log(JSON.stringify(s.ledger[0]));
    assert.deepEqual(
      [po.paymentStatus, po.amountPaid, po.cashAccount, po.ledgerTxnIds],
      ["Paid", 600, "CASH-MAIN", ["TXN-8822"]],
    );
    assert.deepEqual(
      [s.ledger[0].desc, s.ledger[0].category, s.ledger[0].kind, s.ledger[0].amount, s.ledger[0].account],
      ["Supplier payment — Paper Mills Ltd (PO-4001)", "Supplier Payment", "ap_settlement", 600, "CASH-MAIN"],
    );
    assert.equal(await card(page, "Owed to Suppliers").innerText(), "Rs. 0");
    await page.context().close();
  });

  test("PO-4 paying from an account that is short tops it up from another account first", async () => {
    const page = await openApp(browser, "Purchases");
    await newPurchase(page, {
      items: [{ materialId: 401, qty: 5, cost: 120 }],
      account: "BANK-MAIN",
      topUpFrom: "CASH-MAIN",
    });
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.match(message, /paid from Bank Account, after moving Rs\. 600 across from Cash Account/);
    assert.deepEqual(
      s.ledger.map(({ id, type, category, amount, account, kind }) => [
        id,
        type,
        category,
        amount,
        account,
        kind,
      ]),
      [
        ["TXN-8824", "Expense", "Stock & Raw Material Purchase", 600, "BANK-MAIN", "asset_purchase"],
        ["TXN-8823", "Income", "Cash Transfer", 600, "BANK-MAIN", "transfer"],
        ["TXN-8822", "Expense", "Cash Transfer", 600, "CASH-MAIN", "transfer"],
      ],
    );
    const po = s.purchaseOrders[0];
    assert.deepEqual([po.cashAccount, po.toppedUpFrom, po.toppedUpAmount], ["BANK-MAIN", "CASH-MAIN", 600]);
    assert.deepEqual(po.ledgerTxnIds, ["TXN-8822", "TXN-8823", "TXN-8824"]);
    await page.context().close();
  });

  test("PO-5 several materials in one order; each gets its own weighted average", async () => {
    const page = await openApp(browser, "Purchases");
    await newPurchase(page, {
      items: [
        { materialId: 401, qty: 2, cost: 100 },
        { materialId: 402, qty: 3, cost: 50 },
      ],
    });
    await waitSaved(page);
    const s = await stores();
    const ink = s.rawMaterials.find((x) => x.id === 402);
    assert.deepEqual([s.purchaseOrders[0].total, s.purchaseOrders[0].items], [350, 5]);
    assert.deepEqual([ink.availableQty, ink.costPrice], [4, 47.5]); // (1 × 40 + 3 × 50) / 4
    await page.context().close();
  });

  test("PO-6 deleting a purchase reverses the stock, average cost, cash and supplier total", async () => {
    const page = await openApp(browser, "Purchases");
    await newPurchase(page, { items: [{ materialId: 401, qty: 5, cost: 120 }] });
    await waitSaved(page);
    await row(page, "PO-4001").locator("button").click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const resin = s.rawMaterials.find((x) => x.id === 401);
    log(message);
    log(
      `Resin after delete: available=${resin.availableQty}, purchased=${resin.purchaseQty}, cost=${resin.costPrice}`,
    );
    assert.deepEqual([resin.availableQty, resin.purchaseQty], [10, 10]);
    assert.ok(Math.abs(resin.costPrice - 100) < 0.00001, `average cost restored (${resin.costPrice})`);
    assert.deepEqual(s.ledger, []);
    assert.deepEqual(s.purchaseOrders, []);
    assert.equal(s.suppliers.find((x) => x.id === 301).purchased, 0);
    await page.context().close();
  });

  test("PO-7 search by PO number or supplier", async () => {
    const data = shopFixture();
    data.purchaseOrders = [
      {
        id: "PO-4002",
        supplier: "Old Supplies",
        supplierId: 302,
        items: 1,
        lineItems: [],
        total: 10,
        date: "2026-02-02",
        paymentStatus: "Paid",
        amountPaid: 10,
      },
      {
        id: "PO-4001",
        supplier: "Paper Mills Ltd",
        supplierId: 301,
        items: 1,
        lineItems: [],
        total: 20,
        date: "2026-02-01",
        paymentStatus: "Paid",
        amountPaid: 20,
      },
    ];
    await loadStores(data);
    const page = await openApp(browser, "Purchases");
    const ids = () => page.locator("main tbody tr td:first-child").allInnerTexts();
    await page.getByPlaceholder("Search PO # or supplier...").fill("paper");
    assert.deepEqual(await ids(), ["PO-4001"]);
    await page.getByPlaceholder("Search PO # or supplier...").fill("po-4002");
    assert.deepEqual(await ids(), ["PO-4002"]);
    await page.context().close();
  });

  test("PO-8 with no purchase orders the list says so", async () => {
    const page = await openApp(browser, "Purchases");
    await page.waitForTimeout(300);
    const shown = await page.getByText("No purchase orders yet.").count();
    log(`empty-list message shown: ${shown > 0}`);
    assert.equal(shown, 1);
    await page.context().close();
  });

  test("PO-9 'New Purchase Order' is disabled while there are no suppliers", async () => {
    await loadStores({ ...shopFixture(), suppliers: [] });
    const page = await openApp(browser, "Purchases");
    assert.equal(await page.getByRole("button", { name: "New Purchase Order" }).isDisabled(), true);
    await page.context().close();
  });
});

/* ------------------------------------------------------- Delivery Stock */

describe("Delivery Stock", () => {
  // A run already out for delivery: 4 printers and 2 toners taken (stock already deducted).
  function withOngoingRun() {
    const data = shopFixture();
    data.products[0].stock = 6;
    data.products[1].stock = 1;
    data.deliveryRuns = [
      {
        id: "DR-1001",
        date: today(),
        status: "Ongoing",
        lineItems: [
          {
            productId: 101,
            name: "Alpha Printer",
            price: 1000,
            cost: 600,
            unit: "pc",
            taken: 4,
            returned: 0,
          },
          { productId: 102, name: "Beta Toner", price: 250, cost: 100, unit: "pc", taken: 2, returned: 0 },
        ],
        totalTaken: 6,
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
  const productBlocks = (m) => m.locator("div.space-y-3").first().locator(":scope > div");
  const bills = (m) => m.locator("div.mt-3.space-y-3 > div");
  const closeButton = (m) => m.locator("button[type=submit]");
  async function openClose(page) {
    await row(page, "DR-1001").getByRole("button", { name: "Close Run" }).click();
    return modal(page);
  }

  test("DEL-1 starting a run takes the stock out of inventory", async () => {
    await loadStores(shopFixture());
    const page = await openApp(browser, "Delivery Stock");
    await page.getByRole("button", { name: "New Delivery Run" }).click();
    const m = modal(page);
    const items = m.locator("div.space-y-2 > div");
    await items.nth(0).locator("select").selectOption("101");
    await items.nth(0).locator("input").fill("4");
    await m.getByRole("button", { name: "Add product" }).click();
    await items.nth(1).locator("select").selectOption("102");
    await items.nth(1).locator("input").fill("2");
    await m.getByRole("button", { name: "Start Delivery Run" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const run = s.deliveryRuns[0];
    log(message);
    assert.equal(message, "Delivery run DR-1001 started — stock taken out and deducted from inventory.");
    assert.deepEqual([run.id, run.status, run.totalTaken, run.date], ["DR-1001", "Ongoing", 6, today()]);
    assert.deepEqual(
      run.lineItems.map((l) => [l.productId, l.taken, l.returned]),
      [
        [101, 4, 0],
        [102, 2, 0],
      ],
    );
    assert.deepEqual(
      s.products.map((p) => p.stock),
      [6, 1, 0],
    );
    assert.equal(await card(page, "Out for Delivery").innerText(), "1");
    await page.context().close();
  });

  test("DEL-2 taking more than is in stock is refused", async () => {
    await loadStores(shopFixture());
    const page = await openApp(browser, "Delivery Stock");
    await page.getByRole("button", { name: "New Delivery Run" }).click();
    const m = modal(page);
    await m.locator("div.space-y-2 > div").nth(0).locator("input").fill("11");
    await m
      .getByText("One of your quantities is more than the stock currently available for that product.")
      .waitFor();
    await m.getByRole("button", { name: "Start Delivery Run" }).click();
    await page.waitForTimeout(300);
    assert.deepEqual((await stores()).deliveryRuns, []);
    await page.context().close();
  });

  test("DEL-3 closing a run returns the unsold stock and books the sale and its cost", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await productBlocks(m).nth(0).locator("input[type=number]").nth(0).fill("3"); // 3 of 4 printers sold
    await closeButton(m).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const run = s.deliveryRuns[0];
    log(message);
    assert.equal(
      message,
      "Delivery run DR-1001 closed — Rs. 3,500 in sales, Rs. 1,500 net profit. Remaining stock added back.",
    );
    assert.deepEqual(
      [
        run.status,
        run.completedDate,
        run.soldQty,
        run.saleAmount,
        run.costAmount,
        run.profit,
        run.dailyExpense,
        run.netProfit,
      ],
      ["Completed", today(), 5, 3500, 2000, 1500, 0, 1500],
    );
    assert.deepEqual(
      run.lineItems.map((l) => [l.sold, l.returned, l.saleAmount]),
      [
        [3, 1, 3000],
        [2, 0, 500],
      ],
    );
    assert.deepEqual(
      s.products.map((p) => p.stock),
      [7, 1, 0],
    );
    assert.deepEqual(
      s.ledger.map(({ id, category, amount, account, cash }) => [id, category, amount, account, cash]),
      [
        ["TXN-8822", "Sales", 3500, "CASH-MAIN", true],
        ["TXN-8823", "Cost of Goods Sold", 2000, undefined, undefined],
      ],
    );
    assert.deepEqual(
      [run.ledgerTxnId, run.expenseTxnIds, run.cashCollected],
      ["TXN-8822", ["TXN-8823"], 3500],
    );
    assert.equal(await card(page, "Completed Runs").innerText(), "1");
    assert.equal(await card(page, "Today's Delivery Sales").innerText(), "Rs. 3,500");
    await page.context().close();
  });

  test("DEL-4 a product sold at several prices, plus the day's expense", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    const alpha = productBlocks(m).nth(0);
    await alpha.locator("input[type=number]").nth(0).fill("2");
    await alpha.getByRole("button", { name: "Add another price for this item" }).click();
    await alpha.locator("input[type=number]").nth(2).fill("1");
    await alpha.locator("input[type=number]").nth(3).fill("900");
    await field(m, "Daily Expense").fill("150");
    assert.match(await alpha.innerText(), /Average selling price Rs\. 966\.67/);
    await closeButton(m).click();
    await waitSaved(page);
    const s = await stores();
    const run = s.deliveryRuns[0];
    log(`sales=${run.saleAmount} cost=${run.costAmount} gross=${run.profit} net=${run.netProfit}`);
    assert.deepEqual(
      [run.saleAmount, run.costAmount, run.profit, run.dailyExpense, run.netProfit],
      [3400, 2000, 1400, 150, 1250],
    );
    assert.deepEqual(run.lineItems[0].sales, [
      { qty: 2, price: 1000 },
      { qty: 1, price: 900 },
    ]);
    assert.equal(run.lineItems[0].avgPrice, 966.67);
    const expense = s.ledger.find((t) => t.category === "Daily Expense");
    assert.deepEqual(
      [expense.amount, expense.type, expense.desc],
      [150, "Expense", "Delivery daily expense — DR-1001"],
    );
    await page.context().close();
  });

  test("DEL-5 a credit bill becomes an unpaid sales order; only the cash part reaches the cash account", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await m.getByRole("button", { name: "Add Credit Bill" }).click();
    const bill = bills(m).nth(0);
    await field(bill, "Shop Name (credit bill 1)").fill("Corner Shop");
    await field(bill, "Note / Phone (optional)").fill("077 555");
    await bill.locator("input[type=number]").nth(0).fill("1");
    assert.match(await closeButton(m).innerText(), /Close Run — Record Sale & Create Credit Bills/);
    await closeButton(m).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    const run = s.deliveryRuns[0];
    const order = s.salesOrders[0];
    log(message);
    log("credit order:", JSON.stringify(order));
    assert.equal(
      message,
      "Delivery run DR-1001 closed — Rs. 4,500 in sales (Rs. 1,000 on credit from 1 shop). Credit bills added to Sales Orders.",
    );
    assert.deepEqual(
      [
        order.id,
        order.invoice,
        order.customer,
        order.amount,
        order.payment,
        order.isCredit,
        order.fromDelivery,
        order.channel,
        order.note,
      ],
      ["SO-1043", "INV-2462", "Corner Shop", 1000, "Pending", true, "DR-1001", "Delivery Credit", "077 555"],
    );
    assert.deepEqual(order.lineItems, [
      { productId: 101, name: "Alpha Printer", qty: 1, price: 1000, unit: "pc" },
    ]);
    assert.deepEqual(
      s.ledger.map(({ category, amount, account, cash }) => [category, amount, account, cash]),
      [
        ["Sales", 3500, "CASH-MAIN", true],
        ["Sales", 1000, undefined, false],
        ["Cost of Goods Sold", 2600, undefined, undefined],
      ],
    );
    assert.deepEqual([run.creditAmount, run.cashCollected, run.creditOrderIds], [1000, 3500, ["SO-1043"]]);
    await page.context().close();
  });

  test("DEL-6 credit bills are checked: shop name required, credit can't exceed what was sold; can't sell more than taken", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await m.getByRole("button", { name: "Add Credit Bill" }).click();
    const bill = bills(m).nth(0);
    await bill.locator("input[type=number]").nth(0).fill("1");
    await m.getByText("Enter the shop name for this credit bill.").waitFor();
    assert.equal(await closeButton(m).isDisabled(), true);
    await field(bill, "Shop Name (credit bill 1)").fill("Corner Shop");
    await bill.locator("input[type=number]").nth(0).fill("5");
    await m
      .getByText(/Credit quantity is more than the quantity sold for: Alpha Printer \(sold 4, on credit 5\)/)
      .waitFor();
    assert.equal(await closeButton(m).isDisabled(), true);
    await bill.getByTitle("Remove this credit bill").click();
    await productBlocks(m).nth(0).locator("input[type=number]").nth(0).fill("5");
    await m.getByText("Sold quantity (5) is more than the 4 taken out for this run.").waitFor();
    assert.equal(await closeButton(m).isDisabled(), true);
    await page.context().close();
  });

  test("DEL-7 a delivery credit bill is collected in Sales Orders as a receipt, not as new income", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await m.getByRole("button", { name: "Add Credit Bill" }).click();
    await field(bills(m).nth(0), "Shop Name (credit bill 1)").fill("Corner Shop");
    await bills(m).nth(0).locator("input[type=number]").nth(0).fill("1");
    await closeButton(m).click();
    await waitSaved(page);
    await page.locator("aside nav button", { hasText: "Sales Orders" }).click();
    await row(page, "SO-1043").click();
    assert.match(await modal(page).innerText(), /Credit bill from delivery run DR-1001/);
    await modal(page).getByRole("button", { name: "Settle full balance" }).click();
    await waitSaved(page);
    const receipt = (await stores()).ledger[0];
    log(JSON.stringify(receipt));
    assert.deepEqual(
      [receipt.category, receipt.kind, receipt.amount],
      ["Receivable Collection", "ar_collection", 1000],
    );
    await page.context().close();
  });

  test("DEL-8 correcting a closed run's sale date moves its ledger lines and credit bills too", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await m.getByRole("button", { name: "Add Credit Bill" }).click();
    await field(bills(m).nth(0), "Shop Name (credit bill 1)").fill("Corner Shop");
    await bills(m).nth(0).locator("input[type=number]").nth(0).fill("1");
    await closeButton(m).click();
    await waitSaved(page);
    await row(page, "DR-1001").getByTitle("Correct the sale date for this run").click();
    await field(modal(page), "Correct Sale Date").fill("2026-01-15");
    await modal(page).getByRole("button", { name: "Save Correct Date" }).click();
    const message = await toast(page).innerText();
    await waitSaved(page);
    const s = await stores();
    log(message);
    assert.equal(s.deliveryRuns[0].completedDate, "2026-01-15");
    assert.deepEqual(
      s.ledger.map((t) => t.date),
      ["2026-01-15", "2026-01-15", "2026-01-15"],
    );
    assert.equal(s.salesOrders[0].date, "2026-01-15");
    await page.context().close();
  });

  test("DEL-9 deleting a run that is still out puts all its stock back", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    await row(page, "DR-1001").locator("button").last().click();
    await waitSaved(page);
    const s = await stores();
    assert.deepEqual(s.deliveryRuns, []);
    assert.deepEqual(
      s.products.map((p) => p.stock),
      [10, 3, 0],
    );
    await page.context().close();
  });

  test("DEL-10 deleting a closed run reverses its stock movements, sale, ledger lines and credit bills", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await productBlocks(m).nth(0).locator("input[type=number]").nth(0).fill("3");
    await m.getByRole("button", { name: "Add Credit Bill" }).click();
    await field(bills(m).nth(0), "Shop Name (credit bill 1)").fill("Corner Shop");
    await bills(m).nth(0).locator("input[type=number]").nth(0).fill("1");
    await closeButton(m).click();
    await waitSaved(page);
    const dialogs = captureDialogs(page);
    await row(page, "DR-1001").locator("button").last().click();
    await waitSaved(page);
    const s = await stores();
    log(dialogs[0]);
    log(
      `stock after deleting the closed run: ${s.products.map((p) => `${p.name} ${p.stock}`).join(", ")} (before the run: 10, 3, 0)`,
    );
    assert.deepEqual(s.deliveryRuns, []);
    assert.deepEqual(s.ledger, []);
    assert.deepEqual(s.salesOrders, []);
    assert.deepEqual(
      s.products.map((p) => p.stock),
      [10, 3, 0],
    );
    await page.context().close();
  });

  test("DEL-11 search by run number; the detail view shows the run's figures", async () => {
    await loadStores(withOngoingRun());
    const page = await openApp(browser, "Delivery Stock");
    const m = await openClose(page);
    await closeButton(m).click();
    await waitSaved(page);
    await page.getByPlaceholder("Search run #...").fill("dr-1001");
    await row(page, "DR-1001").click();
    const detail = await modal(page).innerText();
    log(detail.replace(/\s+/g, " ").slice(0, 300));
    assert.match(detail, /Total Sales\s+Rs\. 4,500/);
    assert.match(detail, /Gross Profit\s+Rs\. 1,900/);
    await modal(page).locator("button").first().click(); // close
    await page.getByPlaceholder("Search run #...").fill("dr-9");
    assert.equal(await row(page, "DR-1001").count(), 0);
    await page.context().close();
  });

  test("DEL-12 with no runs the list says so; 'New Delivery Run' needs stock", async () => {
    await loadStores({ ...shopFixture(), products: [{ ...shopFixture().products[2] }] });
    const page = await openApp(browser, "Delivery Stock");
    assert.equal(await page.getByRole("button", { name: "New Delivery Run" }).isDisabled(), true);
    const shown = await page.getByText("No delivery runs yet.").count();
    log(`empty-list message shown: ${shown > 0}`);
    assert.equal(shown, 1);
    await page.context().close();
  });
});
