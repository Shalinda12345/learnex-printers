import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  asOwner,
  DEAD_DB_BASE,
  FIXTURE_BACKUP,
  api,
  backupData,
  badge,
  captureSyncRequests,
  count,
  launchBrowser,
  log,
  nav,
  newPage,
  norm,
  one,
  pool,
  rows,
  takeConsoleProblems,
  waitSaved,
  wipeDatabase,
} from "./helpers.mjs";

let browser;
before(async () => {
  await asOwner(); // pages open signed in as the owner
  browser = await launchBrowser();
});
after(async () => {
  await browser.close();
  await pool.end();
});

const fixturePath = fileURLToPath(FIXTURE_BACKUP);
const settingsInput = (page) => page.locator("main input").first();

function assertNoConsoleProblems(page) {
  const problems = takeConsoleProblems(page);
  log(
    problems.length
      ? "console problems:\n        " + problems.join("\n        ")
      : "console: no errors or warnings",
  );
  assert.deepEqual(problems, []);
}

async function moduleCounts() {
  return one(`SELECT
    (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM customers) AS customers,
    (SELECT count(*) FROM suppliers) AS suppliers, (SELECT count(*) FROM sales_orders) AS sales_orders,
    (SELECT count(*) FROM raw_materials) AS raw_materials, (SELECT count(*) FROM ledger_entries) AS ledger,
    (SELECT count(*) FROM cash_accounts) AS cash_accounts, (SELECT count(*) FROM app_users) AS users,
    (SELECT count(*) FROM business_settings) AS settings, (SELECT count(*) FROM store_state) AS modules_saved`);
}
const DEMO = {
  products: 14,
  customers: 8,
  suppliers: 7,
  sales_orders: 10,
  raw_materials: 45,
  ledger: 13,
  cash_accounts: 2,
  users: 4,
  settings: 1,
  modules_saved: 12,
};

describe("first start and everyday use", () => {
  let page, syncs;
  let sale;
  before(async () => {
    await wipeDatabase();
    page = await newPage(browser);
    syncs = captureSyncRequests(page);
  });

  test("UI-1 an empty database shows the one-time setup screen", async () => {
    await page.goto("/");
    await page.getByText("Set up your database").waitFor();
    const buttons = await page.locator("button").allInnerTexts();
    log("setup screen buttons:", buttons.join(" | "));
    assert.ok(buttons.includes("Import from Backup File…"));
    assert.ok(buttons.includes("Start with demo data"));
    assert.ok(!buttons.includes("Import from This Browser"), "only offered when this browser has old data");
    assertNoConsoleProblems(page);
  });

  test("UI-2 'Start with demo data' opens the app and saves every module to the database", async () => {
    await page.getByText("Start with demo data").click();
    await page.locator("aside nav").waitFor();
    await waitSaved(page);
    const counts = await moduleCounts();
    log("rows per table:", JSON.stringify(counts));
    assert.deepEqual(counts, DEMO);
    assertNoConsoleProblems(page);
  });

  test("UI-3 a POS sale saves order, line items, payment, ledger and stock together in ONE request", async () => {
    const stockBefore = Number(
      (await one(`SELECT stock FROM products WHERE name = 'HP 12A Toner Cartridge'`)).stock,
    );
    const ledgerBefore = await count("ledger_entries");
    syncs.length = 0;
    await nav(page, "Point of Sale");
    const product = page.locator("main button", { hasText: "HP 12A Toner Cartridge" }).first();
    await product.click();
    await product.click();
    await page.locator("button", { hasText: "Complete Sale" }).click();
    const toast = await page.getByText(/Sale completed/).innerText();
    await waitSaved(page);
    const invoice = toast.match(/INV-\d+/)[0];
    const order = await one(
      `SELECT id, invoice, amount, payment, channel, position FROM sales_orders WHERE invoice = ?`,
      [invoice],
    );
    const lines = await rows(
      `SELECT product_id, name, qty, price FROM sales_order_items WHERE order_id = ?`,
      [order.id],
    );
    const pays = await rows(`SELECT date, amount FROM sales_order_payments WHERE order_id = ?`, [order.id]);
    const stockAfter = Number(
      (await one(`SELECT stock FROM products WHERE name = 'HP 12A Toner Cartridge'`)).stock,
    );
    const newLedger = await rows(
      `SELECT id, description, type, amount, kind FROM ledger_entries ORDER BY position LIMIT ?`,
      [(await count("ledger_entries")) - ledgerBefore],
    );
    log("toast:", toast);
    log(
      `sync requests: ${syncs.length}; modules in it: ${syncs.map((s) => s.changes.map((c) => c.store).join("+")).join(" / ")}`,
    );
    log("sales_orders:", JSON.stringify(order));
    log("sales_order_items:", JSON.stringify(lines));
    log("sales_order_payments:", JSON.stringify(pays));
    newLedger.forEach((l) => log("new ledger_entries:", JSON.stringify(l)));
    log(`products.stock for HP 12A: ${stockBefore} -> ${stockAfter}`);
    assert.equal(syncs.length, 1, "one atomic request");
    assert.deepEqual(syncs[0].changes.map((c) => c.store).sort(), ["ledger", "products", "salesOrders"]);
    assert.equal(order.position, 1, "newest order is first");
    assert.equal(Number(lines[0].qty), 2);
    assert.equal(Number(pays[0].amount), Number(order.amount));
    assert.equal(stockAfter, stockBefore - 2);
    assert.equal(newLedger.length, 2);
    sale = order;
    assertNoConsoleProblems(page);
  });

  test("UI-4 editing one product sends only that product, not the whole list", async () => {
    syncs.length = 0;
    await nav(page, "Products & Inventory");
    await page.locator("main tr", { hasText: "Canon PIXMA G3010" }).locator("button").first().click();
    await page.getByPlaceholder("0.00").nth(1).fill("22000");
    await page.locator("button", { hasText: "Save Changes" }).click();
    await waitSaved(page);
    const change = syncs.flatMap((s) => s.changes).find((c) => c.store === "products");
    const price = (await one(`SELECT price FROM products WHERE name = 'Canon PIXMA G3010'`)).price;
    log(
      `sent: ${change.upserts.length} upsert(s) [${change.upserts.map((p) => p.name)}], ${change.deletes.length} delete(s); price in DB: ${price}`,
    );
    assert.equal(change.upserts.length, 1);
    assert.deepEqual(change.deletes, []);
    assert.equal(Number(price), 22000);
    assertNoConsoleProblems(page);
  });

  test("UI-5 the top-bar badge shows 'Saving…' while saving, then 'Saved'", async () => {
    await page.route("**/api/learnex/sync", async (route) => {
      await new Promise((r) => setTimeout(r, 2500)); // slow database
      await route.continue();
    });
    await nav(page, "Settings");
    await settingsInput(page).fill("LEARNEX Badge Test");
    await page.locator("button", { hasText: "Save Changes" }).click();
    await badge(page).filter({ hasText: "Saving…" }).waitFor({ timeout: 4000 });
    const during = await badge(page).innerText();
    await waitSaved(page);
    const afterText = await badge(page).innerText();
    await page.unroute("**/api/learnex/sync");
    log(`badge during save: "${during}", after: "${afterText}"`);
    assert.equal(during, "Saving…");
    assert.equal(afterText, "Saved");
    assertNoConsoleProblems(page);
  });

  test("UI-6 if a save fails the badge shows 'Not saved' with the reason, then retries until it is saved", async () => {
    await page.route("**/api/learnex/sync", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Database error: simulated outage" }),
      }),
    );
    await settingsInput(page).fill("LEARNEX Retry Test");
    await page.locator("button", { hasText: "Save Changes" }).click();
    await badge(page).filter({ hasText: "Not saved" }).waitFor({ timeout: 5000 });
    const title = await badge(page).getAttribute("title");
    const inDbDuringOutage = (await one(`SELECT business_name FROM business_settings`)).business_name;
    await page.unroute("**/api/learnex/sync");
    await waitSaved(page, 40000);
    const inDb = (await one(`SELECT business_name FROM business_settings`)).business_name;
    log(`badge: "Not saved", tooltip ends with: "${title.split("\n").pop()}"`);
    log(`business_name in DB during outage: "${inDbDuringOutage}"; after recovery: "${inDb}"`);
    assert.match(title, /simulated outage/);
    assert.equal(inDbDuringOutage, "LEARNEX Badge Test");
    assert.equal(inDb, "LEARNEX Retry Test");
    const problems = takeConsoleProblems(page);
    log(`expected console errors from the simulated outage: ${problems.length}`);
    assert.ok(problems.some((p) => /Could not save to the database/.test(p)));
  });

  test("UI-7 closing the tab with unsaved changes asks for confirmation", async () => {
    let release;
    await page.route("**/api/learnex/sync", async (route) => {
      await new Promise((r) => (release = r));
      await route.continue();
    });
    await settingsInput(page).fill("LEARNEX Unload Test");
    await page.locator("button", { hasText: "Save Changes" }).click();
    await page.waitForTimeout(700); // save request now in flight (held)
    const dialog = new Promise((resolve) =>
      page.once("dialog", async (d) => {
        resolve(d.type());
        await d.dismiss(); // "stay on page"
      }),
    );
    await page.close({ runBeforeUnload: true });
    const type = await dialog;
    log(`dialog shown on close: ${type}; user chose to stay`);
    assert.equal(type, "beforeunload");
    release();
    await waitSaved(page);
    await page.unroute("**/api/learnex/sync");
    assert.equal(
      (await one(`SELECT business_name FROM business_settings`)).business_name,
      "LEARNEX Unload Test",
    );
    assertNoConsoleProblems(page);
  });

  test("UI-8 after wiping browser storage and reloading, everything comes back from MySQL", async () => {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.locator("aside nav").waitFor();
    await nav(page, "Sales Orders");
    await page.getByText(sale.id, { exact: true }).first().waitFor({ timeout: 5000 });
    await nav(page, "Settings");
    const name = await settingsInput(page).inputValue();
    log(`after reload: ${sale.id} is listed in Sales Orders; business name field = "${name}"`);
    assert.equal(name, "LEARNEX Unload Test");
    assertNoConsoleProblems(page);
  });

  test("UI-9 Download Backup contains exactly what is in the database", async () => {
    await page.locator("main button", { hasText: "Data & Backup" }).click();
    const download = page.waitForEvent("download");
    await page.locator("button", { hasText: "Download Backup" }).click();
    const file = await (await download).path();
    const fromFile = backupData(readFileSync(file, "utf8"));
    const fromDb = (await api("/data")).body.stores;
    log(
      `backup file: ${await (await download).suggestedFilename()}, modules: ${Object.keys(fromFile).length}`,
    );
    for (const key of Object.keys(fromDb)) assert.deepEqual(norm(fromFile[key]), norm(fromDb[key]), key);
    assertNoConsoleProblems(page);
  });

  test("UI-10 Restore from Backup replaces the data and saves it to the database", async () => {
    await page.locator("main input[type=file]").setInputFiles(fixturePath);
    await page.getByText(/Backup restored/).waitFor();
    await waitSaved(page);
    const counts = await moduleCounts();
    const smoke = await one(`SELECT name, sku, price FROM products WHERE name = 'Smoke Test Printer'`);
    log("rows per table after restore:", JSON.stringify(counts));
    log("restored product:", JSON.stringify(smoke));
    const fixture = backupData();
    assert.equal(counts.products, fixture.products.length);
    assert.equal(counts.sales_orders, fixture.salesOrders.length);
    assert.ok(smoke);
    assert.deepEqual(norm((await api("/data")).body.stores.salesOrders), norm(fixture.salesOrders));
    assertNoConsoleProblems(page);
  });

  test("UI-11 'Clear a Specific Module' empties only that table", async () => {
    const before = await moduleCounts();
    await page
      .locator("main div.rounded-xl", { has: page.getByText("Customers", { exact: true }) })
      .getByRole("button", { name: /Clear/ })
      .click();
    await waitSaved(page);
    const afterCounts = await moduleCounts();
    log(
      `customers: ${before.customers} -> ${afterCounts.customers}; products: ${before.products} -> ${afterCounts.products}; sales_orders: ${before.sales_orders} -> ${afterCounts.sales_orders}`,
    );
    assert.equal(afterCounts.customers, 0);
    assert.deepEqual({ ...afterCounts, customers: before.customers }, before);
    assertNoConsoleProblems(page);
  });

  test("UI-12 Factory Reset restores the demo data in the database", async () => {
    const reloaded = page.waitForEvent("load");
    await page.locator("button", { hasText: "Factory Reset Everything" }).click();
    await reloaded;
    await page.locator("aside nav").waitFor();
    await waitSaved(page);
    const counts = await moduleCounts();
    const name = (await one(`SELECT business_name FROM business_settings`)).business_name;
    log("rows per table after reset:", JSON.stringify(counts), "| business_name:", name);
    assert.deepEqual(counts, DEMO);
    assert.equal(name, "LEARNEX Printers & Distributors");
    assertNoConsoleProblems(page);
  });
});

describe("when the database can't be reached", () => {
  test("UI-13 the app shows 'Can't reach the database' (never demo data) and recovers with Try Again", async () => {
    const page = await newPage(browser);
    await page.route("**/api/learnex/data", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Database error: simulated" }),
      }),
    );
    await page.goto("/");
    await page.getByText("Can't reach the database").waitFor();
    const shown = await page.locator("p", { hasText: "simulated" }).innerText();
    const syncsSent = [];
    page.on("request", (r) => r.url().endsWith("/sync") && syncsSent.push(r));
    await page.unroute("**/api/learnex/data");
    await page.getByRole("button", { name: "Try Again" }).click();
    await page.locator("aside nav").waitFor();
    log(
      `error screen shown with: "${shown}"; after Try Again the app opened; saves sent while offline: ${syncsSent.length}`,
    );
    assert.equal(syncsSent.length, 0);
    takeConsoleProblems(page);
    await page.context().close();
  });

  test("UI-14 with MySQL actually unreachable, the error screen shows the real cause", async () => {
    const page = await newPage(browser, { base: DEAD_DB_BASE });
    await page.goto("/");
    await page.getByText("Can't reach the database").waitFor();
    const shown = await page.locator("p", { hasText: "Database error" }).innerText();
    log(`error screen: "${shown}"`);
    assert.match(shown, /Database error: .*ECONNREFUSED/);
    await page.context().close();
  });
});

describe("one-time import of existing data", () => {
  async function freshSetupPage(init) {
    await wipeDatabase();
    const page = await newPage(browser);
    if (init) await page.addInitScript(init.fn, init.arg);
    await page.goto("/");
    await page.getByText("Set up your database").waitFor();
    return page;
  }
  async function reviewRows(page) {
    return page
      .locator("table tr")
      .evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ").trim()));
  }

  test("UI-15 import from a backup file (from the original HTML app)", async () => {
    const page = await freshSetupPage();
    const chooser = page.waitForEvent("filechooser");
    await page.getByText("Import from Backup File…").click();
    await (await chooser).setFiles(fixturePath);
    await page.getByText("Import this data?").waitFor();
    const review = await reviewRows(page);
    review.forEach((r) => log("review:", r));
    await page.getByText("Import into Database").click();
    await page.locator("aside nav").waitFor();
    await waitSaved(page);
    const counts = await moduleCounts();
    log("rows per table:", JSON.stringify(counts));
    const fixture = backupData();
    assert.ok(review.includes(`Products & Inventory ${fixture.products.length} record(s)`));
    assert.equal(counts.products, fixture.products.length);
    assert.deepEqual(norm((await api("/data")).body.stores.ledger), norm(fixture.ledger));
    assertNoConsoleProblems(page);
    await page.context().close();
  });

  test("UI-16 import from this browser's old storage (only offered when it exists)", async () => {
    const page = await freshSetupPage();
    await page.evaluate(() => {
      localStorage.setItem(
        "learnex_erp_v1_products",
        JSON.stringify([
          {
            id: 1,
            name: "Browser Product A",
            sku: "BA",
            category: "Printers",
            price: 10,
            cost: 5,
            stock: 3,
            min: 1,
            unit: "pc",
          },
          {
            id: 2,
            name: "Browser Product B",
            sku: "BB",
            category: "Printers",
            price: 20,
            cost: 9,
            stock: 4,
            min: 1,
            unit: "pc",
          },
        ]),
      );
      localStorage.setItem(
        "learnex_erp_v1_settings",
        JSON.stringify({ businessName: "From Browser", taxRate: 5, currency: "LKR (Rs.)" }),
      );
      localStorage.setItem("learnex_erp_v1___unsaved__", "1"); // old bookkeeping key — must be ignored
    });
    await page.reload();
    await page.getByText("Import from This Browser").click();
    const review = await reviewRows(page);
    review.forEach((r) => log("review:", r));
    await page.getByText("Import into Database").click();
    await page.locator("aside nav").waitFor();
    await waitSaved(page);
    const products = await rows(`SELECT name FROM products ORDER BY position`);
    const settings = await one(`SELECT business_name, tax_rate FROM business_settings`);
    const counts = await moduleCounts();
    log(
      "products in DB:",
      products.map((p) => p.name).join(", "),
      "| settings:",
      JSON.stringify(settings),
      "| customers (not in source, so demo):",
      counts.customers,
    );
    assert.deepEqual(review, ["Products & Inventory 2 record(s)", "Business Settings included"]);
    assert.deepEqual(
      products.map((p) => p.name),
      ["Browser Product A", "Browser Product B"],
    );
    assert.equal(settings.business_name, "From Browser");
    assert.equal(counts.customers, 8);
    assertNoConsoleProblems(page);
    await page.context().close();
  });

  // The native folder picker can't be clicked by a test, so it is replaced by
  // a stand-in that returns a folder containing learnex-data.json.
  const fakeFolder = {
    fn: ({ name, files }) => {
      window.showDirectoryPicker = async () => ({
        name,
        getFileHandle: async (fileName) => {
          if (!(fileName in files)) throw new DOMException("not found", "NotFoundError");
          return { getFile: async () => new File([files[fileName]], fileName) };
        },
      });
    },
  };

  test("UI-17 import from a data folder (learnex-data.json written by the folder version)", async () => {
    const data = backupData();
    const fileJson = JSON.stringify(
      Object.fromEntries(Object.entries(data).map(([k, v]) => ["learnex_erp_v1_" + k, v])),
    );
    const page = await freshSetupPage({
      ...fakeFolder,
      arg: { name: "Shop PC Data", files: { "learnex-data.json": fileJson } },
    });
    await page.getByText("Import from Data Folder…").click();
    await page.getByText("Import this data?").waitFor();
    const source = await page.getByText(/Found in/).innerText();
    log(source, (await reviewRows(page)).length, "modules");
    await page.getByText("Import into Database").click();
    await page.locator("aside nav").waitFor();
    await waitSaved(page);
    const loaded = (await api("/data")).body.stores;
    for (const key of Object.keys(data)) assert.deepEqual(norm(loaded[key]), norm(data[key]), key);
    log("all 12 modules in the database match the folder file");
    assert.match(source, /Shop PC Data/);
    assertNoConsoleProblems(page);
    await page.context().close();
  });

  test("UI-18 a folder without learnex-data.json is explained, nothing is imported", async () => {
    const page = await freshSetupPage({ ...fakeFolder, arg: { name: "Empty Folder", files: {} } });
    await page.getByText("Import from Data Folder…").click();
    const msg = await page.locator("p", { hasText: "No learnex-data.json" }).innerText();
    const initialized = (await api("/data")).body.initialized;
    log(`message: "${msg}"; database initialized: ${initialized}`);
    assert.equal(initialized, false);
    await page.context().close();
  });

  test("UI-19 an invalid backup file is explained, nothing is imported", async () => {
    const page = await freshSetupPage();
    const chooser = page.waitForEvent("filechooser");
    await page.getByText("Import from Backup File…").click();
    await (
      await chooser
    ).setFiles({
      name: "notes.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"hello":"world"}'),
    });
    const msg = await page.locator("p", { hasText: "LEARNEX backup" }).innerText();
    const initialized = (await api("/data")).body.initialized;
    log(`message: "${msg}"; database initialized: ${initialized}`);
    assert.equal(initialized, false);
    await page.context().close();
  });
});
