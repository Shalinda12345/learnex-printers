import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  asOwner,
  api,
  backupData,
  count,
  DEAD_DB_BASE,
  log,
  norm,
  one,
  pool,
  rows,
  wipeDatabase,
} from "./helpers.mjs";

before(asOwner); // every API call is made as the owner
after(() => pool.end());

const dataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Real data exported from the original HTML app, plus records covering every
// shape the app produces (and a few awkward values).
function importFixture() {
  const data = backupData();
  data.settings = { ...data.settings, taxRate: "8.5", openingCapital: "", logoNote: "custom ✓" };
  data.salesOrders.push(
    {
      id: "SO-T1",
      invoice: "INV-T1",
      customer: "No list",
      items: 0,
      amount: 10,
      status: "Processing",
      payment: "Pending",
      date: "2026-02-30",
      channel: "Manual",
    },
    {
      id: "SO-T2",
      invoice: "INV-T2",
      customer: "Credit — Rs. ₹",
      customerId: 1760000000000123,
      items: 2,
      lineItems: [
        { productId: 1, name: "HP LaserJet", qty: 2, price: 42500.5, unit: "pc", custom: { a: 1 } },
      ],
      amount: 85001,
      tax: 0,
      status: "Delivered",
      payment: "Pending",
      date: "2026-10-13",
      channel: "Delivery",
      attachment: { name: "bill.png", type: "image/png", dataUrl },
      amountPaid: 0.1 + 0.2,
      payments: [
        { date: "2026-10-13", amount: 0.3 },
        { date: "", amount: "5" },
      ],
      isCredit: true,
      fromDelivery: "DR-1001",
      note: "",
    },
  );
  data.purchaseOrders = [
    {
      id: "PO-4001",
      supplier: "Azure Packaging",
      supplierId: 1,
      items: 3,
      lineItems: [{ materialId: 1, name: "Double Tape", qty: 3, cost: 35.125 }],
      total: 105.38,
      date: "2026-10-12",
      attachment: null,
      paymentStatus: "Unpaid",
      amountPaid: 0,
      cashAccount: null,
      toppedUpFrom: null,
      toppedUpAmount: 0,
      ledgerTxnIds: [null, "TXN-9000"],
    },
  ];
  data.deliveryRuns = [
    {
      id: "DR-1001",
      date: "2026-10-12",
      status: "Completed",
      lineItems: [
        {
          productId: 4,
          name: "HP 12A",
          price: 3200,
          cost: 2100,
          unit: "pc",
          taken: 10,
          returned: 2,
          sales: [
            { qty: 5, price: 3200 },
            { qty: 3, price: 3100 },
          ],
          sold: 8,
          saleAmount: 25300,
          avgPrice: 3162.5,
          over: false,
        },
      ],
      totalTaken: 10,
      completedDate: "2026-10-12",
      soldQty: 8,
      saleAmount: 25300,
      costAmount: 16800,
      dailyExpense: 500,
      profit: 8500,
      netProfit: 8000,
      ledgerTxnId: "TXN-9001",
      creditTxnId: null,
      expenseTxnIds: ["TXN-9002"],
      creditBills: [
        {
          shop: "Shop A",
          note: "",
          items: [
            { productId: 4, name: "HP 12A", unit: "pc", cost: 2100, qty: 1, price: 3100, lineTotal: 3100 },
          ],
          qty: 1,
          total: 3100,
        },
      ],
      creditAmount: 3100,
      cashCollected: 22200,
      creditOrderIds: ["SO-T2"],
    },
    {
      id: "DR-1002",
      date: "2026-10-13",
      status: "Out",
      lineItems: [],
      totalTaken: 0,
      completedDate: null,
      soldQty: 0,
      saleAmount: 0,
      costAmount: 0,
      dailyExpense: 0,
      profit: 0,
      netProfit: 0,
      ledgerTxnId: null,
      creditTxnId: null,
      expenseTxnIds: [],
    },
  ];
  data.rawMaterialUsage = [
    {
      id: "USE-1001",
      date: "2026-10-13",
      materialId: 1,
      materialName: "Double Tape",
      qtyUsed: 2,
      remainingQty: 76,
      user: "Aarav Kapoor",
      notes: "",
      consumedValue: 70,
      ledgerTxnId: "TXN-9003",
    },
  ];
  data.ledger.unshift({
    id: "TXN-9004",
    date: "2026-10-13",
    desc: "Receipt",
    type: "Expense",
    category: "Rent",
    amount: 1234.56,
    account: "CASH-MAIN",
    kind: "opex",
    cash: true,
    attachment: { name: "r.png", type: "image/png", dataUrl },
  });
  data.products.push({
    id: 1760000000000999,
    name: "Odd",
    sku: 12345,
    category: "Accessories",
    price: "12",
    cost: 1e-7,
    stock: 2.5,
    min: 0,
    unit: "pc",
    extraFlag: true,
  });
  return data;
}

describe("empty database", () => {
  before(wipeDatabase);
  test("API-1 a fresh database reports not-initialized and no modules", async () => {
    const r = await api("/data");
    log(`GET /data -> ${r.status}`, JSON.stringify(r.body));
    assert.equal(r.status, 200);
    assert.equal(r.body.initialized, false);
    assert.deepEqual(r.body.stores, {});
    // the owner may load and save every module
    assert.equal(Object.keys(r.body.access).length, 12);
    assert.ok(Object.values(r.body.access).every((a) => a === "write"));
  });
});

describe("import → reload round trip (real backup + edge cases)", () => {
  const data = importFixture();
  let loaded;
  before(async () => {
    await wipeDatabase();
    const r = await api("/import", { stores: data });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    loaded = (await api("/data")).body;
  });

  test("API-2 import marks the database initialized", () => assert.equal(loaded.initialized, true));

  for (const key of [
    "products",
    "customers",
    "suppliers",
    "salesOrders",
    "purchaseOrders",
    "rawMaterials",
    "rawMaterialUsage",
    "deliveryRuns",
    "ledger",
    "cashAccounts",
    "settings",
    "users",
  ]) {
    test(`API-3 round trip identical: ${key}`, () => {
      const n = Array.isArray(data[key]) ? `${data[key].length} records` : "object";
      log(
        `${key}: ${n} in, ${Array.isArray(loaded.stores[key]) ? loaded.stores[key].length + " records" : "object"} out`,
      );
      assert.deepEqual(norm(loaded.stores[key]), norm(data[key]));
    });
  }

  test("API-4 list order is preserved (newest-first lists stay newest-first)", () => {
    for (const key of ["products", "salesOrders", "ledger", "rawMaterials"]) {
      assert.deepEqual(
        loaded.stores[key].map((r) => r.id),
        data[key].map((r) => r.id),
        key,
      );
    }
    log("first ledger id in and out:", data.ledger[0].id, loaded.stores.ledger[0].id);
  });

  test('API-5 a tax rate typed as text stays text ("8.5", not 8.5)', () => {
    log("settings.taxRate =", JSON.stringify(loaded.stores.settings.taxRate));
    assert.equal(loaded.stores.settings.taxRate, "8.5");
  });
  test("API-6 a record with no line-item list reloads with no list (null), not an empty one", () => {
    const o = loaded.stores.salesOrders.find((x) => x.id === "SO-T1");
    log("SO-T1.lineItems =", JSON.stringify(o.lineItems));
    assert.equal(o.lineItems, null);
  });
  test("API-7 an empty line-item list reloads as [] ", () => {
    const r = loaded.stores.deliveryRuns.find((x) => x.id === "DR-1002");
    log("DR-1002.lineItems =", JSON.stringify(r.lineItems));
    assert.deepEqual(r.lineItems, []);
  });
  test("API-8 attachments (data URLs) survive byte-for-byte", () => {
    const t = loaded.stores.ledger.find((x) => x.id === "TXN-9004");
    log("attachment:", t.attachment.name, t.attachment.dataUrl.length, "chars");
    assert.equal(t.attachment.dataUrl, dataUrl);
  });
  test("API-9 an impossible date (2026-02-30) is kept as typed, not rejected", () => {
    const o = loaded.stores.salesOrders.find((x) => x.id === "SO-T1");
    log("SO-T1.date =", o.date);
    assert.equal(o.date, "2026-02-30");
  });
  test("API-10 16-digit ids (Date.now()-based) keep full precision", () => {
    log("customerId =", loaded.stores.salesOrders.find((x) => x.id === "SO-T2").customerId);
    assert.equal(loaded.stores.salesOrders.find((x) => x.id === "SO-T2").customerId, 1760000000000123);
    assert.ok(loaded.stores.products.some((p) => p.id === 1760000000000999));
  });
  test("API-11 decimals keep exact JS values (0.1+0.2, 1e-7, 35.125)", () => {
    const so = loaded.stores.salesOrders.find((x) => x.id === "SO-T2");
    const odd = loaded.stores.products.find((p) => p.id === 1760000000000999);
    log(
      "amountPaid =",
      so.amountPaid,
      "| cost =",
      odd.cost,
      "| PO cost =",
      loaded.stores.purchaseOrders[0].lineItems[0].cost,
    );
    assert.equal(so.amountPaid, 0.1 + 0.2);
    assert.equal(odd.cost, 1e-7);
  });
  test('API-12 values of the wrong type keep their type (sku 12345 number, price "12" text)', () => {
    const odd = loaded.stores.products.find((p) => p.id === 1760000000000999);
    log("sku =", JSON.stringify(odd.sku), "price =", JSON.stringify(odd.price));
    assert.equal(odd.sku, 12345);
    assert.equal(odd.price, "12");
  });
  test("API-13 fields the schema doesn't know are kept (custom fields, nested objects)", () => {
    const odd = loaded.stores.products.find((p) => p.id === 1760000000000999);
    const li = loaded.stores.salesOrders.find((x) => x.id === "SO-T2").lineItems[0];
    log(
      "extraFlag =",
      odd.extraFlag,
      "| lineItem.custom =",
      JSON.stringify(li.custom),
      "| settings.logoNote =",
      loaded.stores.settings.logoNote,
    );
    assert.equal(odd.extraFlag, true);
    assert.deepEqual(li.custom, { a: 1 });
  });
  test('API-14 id lists containing null survive ([null, "TXN-9000"])', () => {
    log("ledgerTxnIds =", JSON.stringify(loaded.stores.purchaseOrders[0].ledgerTxnIds));
    assert.deepEqual(loaded.stores.purchaseOrders[0].ledgerTxnIds, [null, "TXN-9000"]);
  });
  test("API-15 unicode text survives (₹ — ✓)", () => {
    assert.equal(loaded.stores.salesOrders.find((x) => x.id === "SO-T2").customer, "Credit — Rs. ₹");
  });

  test("API-16 data is stored in real columns and child tables", async () => {
    const p = await one(`SELECT name, price, stock, min_stock FROM products WHERE id = 1`);
    const items = await rows(
      `SELECT line_no, product_id, qty, price FROM sales_order_items WHERE order_id = 'SO-T2'`,
    );
    const pays = await rows(
      `SELECT line_no, date, amount, extra FROM sales_order_payments WHERE order_id = 'SO-T2' ORDER BY line_no`,
    );
    const po = await rows(
      `SELECT material_id, qty, cost FROM purchase_order_items WHERE order_id = 'PO-4001'`,
    );
    const run = await rows(
      `SELECT product_id, taken, sold, over_sold, sales FROM delivery_run_items WHERE run_id = 'DR-1001'`,
    );
    const bill = await one(`SELECT shop, total FROM delivery_credit_bills WHERE run_id = 'DR-1001'`);
    const led = await one(
      `SELECT date, description, amount, account, kind, cash FROM ledger_entries WHERE id = 'TXN-9004'`,
    );
    log("products[1]:", JSON.stringify(p));
    log("sales_order_items(SO-T2):", JSON.stringify(items));
    log("sales_order_payments(SO-T2):", JSON.stringify(pays));
    log("purchase_order_items(PO-4001):", JSON.stringify(po));
    log("delivery_run_items(DR-1001):", JSON.stringify(run));
    log("delivery_credit_bills(DR-1001):", JSON.stringify(bill));
    log("ledger_entries(TXN-9004):", JSON.stringify(led));
    assert.equal(Number(p.price), 42500);
    assert.equal(Number(items[0].qty), 2);
    assert.equal(pays[0].date, "2026-10-13");
    assert.deepEqual(pays[1].extra, { date: "", amount: "5" }, "values that don't fit a column go to extra");
    assert.equal(bill.shop, "Shop A");
    assert.equal(led.description, "Receipt");
  });

  test("API-17 the reporting views join modules together", async () => {
    const sales = await rows(
      `SELECT order_id, invoice, product_name, sku, qty, line_total FROM v_sales_lines ORDER BY order_id, line_no`,
    );
    const purchases = await rows(`SELECT order_id, material_name, qty, line_total FROM v_purchase_lines`);
    const ledger = await rows(
      `SELECT id, signed_amount, account, account_name FROM v_ledger WHERE account IS NOT NULL ORDER BY id`,
    );
    sales.forEach((s) => log("v_sales_lines:", JSON.stringify(s)));
    purchases.forEach((s) => log("v_purchase_lines:", JSON.stringify(s)));
    ledger.forEach((s) => log("v_ledger:", JSON.stringify(s)));
    assert.ok(sales.length >= 2 && purchases.length === 1);
    assert.equal(
      ledger.find((l) => l.id === "TXN-9004").account_name,
      loaded.stores.cashAccounts.find((a) => a.id === "CASH-MAIN").name,
    );
  });
});

describe("saving changes (/sync)", () => {
  before(async () => {
    await wipeDatabase();
    await api("/import", { stores: importFixture() });
  });

  test("API-18 editing one record rewrites only that row", async () => {
    const products = (await api("/data")).body.stores.products;
    const stamp = async () =>
      Object.fromEntries(
        (await rows(`SELECT id, updated_at FROM products`)).map((r) => [r.id, r.updated_at.getTime()]),
      );
    const before = await stamp();
    await new Promise((r) => setTimeout(r, 20));
    const edited = { ...products[2], stock: products[2].stock - 1 };
    const r = await api("/sync", {
      changes: [{ store: "products", upserts: [edited], deletes: [], order: products.map((p) => p.id) }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = await stamp();
    const touched = Object.keys(after).filter((id) => after[id] !== before[id]);
    log(
      `edited product ${edited.id} (stock ${products[2].stock} -> ${edited.stock}); rows rewritten: ${touched.join(", ")}`,
    );
    assert.deepEqual(touched, [String(edited.id)]);
  });

  test("API-19 add + delete + reorder in one change", async () => {
    const before = (await api("/data")).body.stores.products;
    const added = {
      id: 1760000000000555,
      name: "New First",
      sku: "NEW",
      category: "Printers",
      price: 1,
      cost: 1,
      stock: 1,
      min: 0,
      unit: "pc",
    };
    const next = [added, ...before.slice(2), before[0]];
    const r = await api("/sync", {
      changes: [
        { store: "products", upserts: [added], deletes: [before[1].id], order: next.map((p) => p.id) },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const now = (await api("/data")).body.stores.products;
    log(
      `added ${added.id} at the top, deleted ${before[1].id}, moved ${before[0].id} to the end; ${before.length} -> ${now.length} products`,
    );
    assert.deepEqual(norm(now), norm(next));
  });

  test("API-20 deleting an order also deletes its line items and payments", async () => {
    const orders = (await api("/data")).body.stores.salesOrders;
    const itemsBefore = await rows(`SELECT count(*)::int n FROM sales_order_items WHERE order_id = 'SO-T2'`);
    const r = await api("/sync", {
      changes: [
        {
          store: "salesOrders",
          deletes: ["SO-T2"],
          order: orders.filter((o) => o.id !== "SO-T2").map((o) => o.id),
        },
      ],
    });
    assert.equal(r.status, 200);
    const items = await one(
      `SELECT (SELECT count(*) FROM sales_order_items WHERE order_id = 'SO-T2')::int i, (SELECT count(*) FROM sales_order_payments WHERE order_id = 'SO-T2')::int p`,
    );
    log(`SO-T2 line items before: ${itemsBefore[0].n}; after delete: items=${items.i}, payments=${items.p}`);
    assert.deepEqual(items, { i: 0, p: 0 });
  });

  test("API-21 several modules saved in one request are all-or-nothing", async () => {
    const before = (await api("/data")).body.stores;
    const r = await api("/sync", {
      changes: [
        {
          store: "customers",
          upserts: [{ ...before.customers[0], name: "SHOULD NOT SAVE" }],
          order: before.customers.map((c) => c.id),
        },
        { store: "products", upserts: [{ id: "not-a-number" }], order: ["not-a-number"] },
      ],
    });
    const name = (await one(`SELECT name FROM customers WHERE id = $1`, [before.customers[0].id])).name;
    log(`-> ${r.status} ${r.body.error}; customer name in DB is still "${name}"`);
    assert.equal(r.status, 400);
    assert.equal(name, before.customers[0].name);
  });

  test("API-22 settings and users are saved as a whole", async () => {
    const users = [{ name: "Only User", email: "o@x.lk", role: "Administrator", status: "Active" }];
    const settings = { businessName: "X", taxRate: 0, currency: "USD ($)", notifDaily: true };
    const r = await api("/sync", {
      changes: [
        { store: "users", value: users },
        { store: "settings", value: settings },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = (await api("/data")).body.stores;
    log("users:", JSON.stringify(s.users), "| settings:", JSON.stringify(s.settings));
    assert.deepEqual(norm(s.users), norm(users));
    assert.deepEqual(norm(s.settings), norm(settings));
    assert.equal(await count("app_users"), 1);
  });
});

describe("bad requests are refused without changing anything", () => {
  const cases = [
    [
      "API-23 duplicate ids",
      {
        changes: [
          { store: "ledger", upserts: [{ id: "TXN-X" }, { id: "TXN-X" }], order: ["TXN-X", "TXN-X"] },
        ],
      },
      /more than one record/,
    ],
    [
      "API-24 wrong id type for the module",
      { changes: [{ store: "customers", upserts: [{ id: "abc" }], order: ["abc"] }] },
      /invalid id/,
    ],
    [
      "API-25 records without the list order",
      { changes: [{ store: "products", upserts: [{ id: 5 }] }] },
      /order is required/,
    ],
    ["API-26 unknown module", { changes: [{ store: "invoices", value: [] }] }, /unknown module/],
    ["API-27 empty change list", { changes: [] }, /non-empty/],
    [
      "API-28 settings that aren't an object",
      { changes: [{ store: "settings", value: [1, 2] }] },
      /must be an object/,
    ],
    ["API-29 malformed JSON body", "{not json", /JSON object/],
  ];
  for (const [name, body, expected] of cases) {
    test(name, async () => {
      const before = await count("ledger_entries");
      const r = await api("/sync", body);
      log(`-> ${r.status} ${r.body?.error}`);
      assert.equal(r.status, 400);
      assert.match(r.body.error, expected);
      assert.equal(await count("ledger_entries"), before);
    });
  }
});

describe("reset and server errors", () => {
  test("API-30 factory reset deletes every record but keeps the database set up", async () => {
    const r = await api("/reset", {});
    const d = (await api("/data")).body;
    const left = await one(
      `SELECT (SELECT count(*) FROM products)+(SELECT count(*) FROM sales_orders)+(SELECT count(*) FROM sales_order_items)+(SELECT count(*) FROM ledger_entries)+(SELECT count(*) FROM business_settings) AS n`,
    );
    log(
      `reset -> ${r.status}; initialized=${d.initialized}; modules=${JSON.stringify(d.stores)}; rows left=${left.n}`,
    );
    assert.equal(d.initialized, true);
    assert.deepEqual(d.stores, {});
    assert.equal(Number(left.n), 0);
  });

  test("API-31 if the database is down, the API answers 500 with the reason", async () => {
    // /api/auth/me is the first thing the app asks for; it must reach the database.
    const r = await new Client(DEAD_DB_BASE).get("/api/auth/me");
    log(`GET /api/auth/me on a server whose database is unreachable -> ${r.status} ${r.body?.error}`);
    assert.equal(r.status, 500);
    assert.match(r.body.error, /Database error: .*ECONNREFUSED/);
  });
});
