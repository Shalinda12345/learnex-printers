// Two people working at once: a save must never silently overwrite what somebody else
// saved after this person loaded the data (lost updates, double-spent stock, duplicate ids).
// Also the /api/health check used by uptime monitors.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  api,
  asOwner,
  DEAD_DB_BASE,
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

const productsNow = async () => (await stores()).products;
const orderOf = (list) => list.map((p) => p.id);

/** What a browser holds after loading: the records and the version of each. */
async function load() {
  const r = await api("/data");
  assert.equal(r.status, 200);
  return { products: r.body.stores.products, versions: r.body.versions.products };
}

/** The change a browser sends for editing one product (as persistence.js builds it). */
const edit = (loaded, id, changes, extra = {}) => {
  const rec = loaded.products.find((p) => p.id === id);
  return {
    store: "products",
    upserts: [{ ...rec, ...changes }],
    deletes: [],
    order: orderOf(loaded.products),
    base: { [id]: loaded.versions[String(id)] },
    creates: [],
    ...extra,
  };
};

describe("optimistic locking (/data versions, /sync base and creates)", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });

  test("CONC-1 /data gives every record a version and a save returns the new one", async () => {
    const a = await load();
    assert.deepEqual(Object.keys(a.versions).sort(), a.products.map((p) => String(p.id)).sort());
    const r = await api("/sync", { changes: [edit(a, 101, { stock: 7 })] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.deepEqual(Object.keys(r.body.versions.products), ["101"]);
    assert.notEqual(r.body.versions.products["101"], a.versions["101"]);
    // the version the save returned is the one /data now reports
    assert.equal((await load()).versions["101"], r.body.versions.products["101"]);
  });

  test("CONC-2 saving a record somebody else changed meanwhile is refused and changes nothing", async () => {
    const a = await load(); // both people load the same data
    const b = await load();
    const first = await api("/sync", { changes: [edit(a, 101, { stock: 3 })] });
    assert.equal(first.status, 200);
    const second = await api("/sync", { changes: [edit(b, 101, { stock: 8, price: 1 })] });
    log(second.status, second.body.error);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, "conflict");
    assert.match(second.body.error, /101 was changed by someone else/);
    const p = (await productsNow()).find((x) => x.id === 101);
    assert.equal(p.stock, 3, "the first person's save is kept");
    assert.notEqual(p.price, 1);
  });

  test("CONC-3 after a successful save the next save from the same person is accepted", async () => {
    const a = await load();
    const r1 = await api("/sync", { changes: [edit(a, 101, { stock: 9 })] });
    assert.equal(r1.status, 200);
    const next = { ...a, versions: { ...a.versions, ...r1.body.versions.products } };
    next.products = next.products.map((p) => (p.id === 101 ? { ...p, stock: 9 } : p));
    const r2 = await api("/sync", { changes: [edit(next, 101, { stock: 8 })] });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((await productsNow()).find((x) => x.id === 101).stock, 8);
  });

  test("CONC-4 two people selling the same stock at the same moment: one sale is saved, the other refused", async () => {
    const a = await load();
    const b = await load();
    const start = a.products.find((p) => p.id === 101).stock;
    const [ra, rb] = await Promise.all([
      api("/sync", { changes: [edit(a, 101, { stock: start - 3 })] }),
      api("/sync", { changes: [edit(b, 101, { stock: start - 4 })] }),
    ]);
    log("statuses", ra.status, rb.status);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
    const stock = (await productsNow()).find((x) => x.id === 101).stock;
    assert.equal(stock, ra.status === 200 ? start - 3 : start - 4, "the stored stock is the winner's, not a mix");
  });

  test("CONC-5 a new record whose id somebody else just used is refused instead of overwriting theirs", async () => {
    const a = await load();
    const clash = { id: 101, name: "Overwriter", sku: "X", category: "x", price: 1, cost: 1, stock: 1, min: 1, unit: "pc" };
    const r = await api("/sync", {
      changes: [
        {
          store: "products",
          upserts: [clash],
          deletes: [],
          order: [...orderOf(a.products)],
          base: {},
          creates: [101],
        },
      ],
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "conflict");
    assert.match(r.body.error, /101 was just created by someone else/);
    assert.notEqual((await productsNow()).find((x) => x.id === 101).name, "Overwriter");
  });

  test("CONC-6 editing a record somebody else deleted does not bring it back", async () => {
    const a = await load();
    const del = await api("/sync", {
      changes: [
        {
          store: "products",
          upserts: [],
          deletes: [101],
          order: orderOf(a.products).filter((id) => id !== 101),
        },
      ],
    });
    assert.equal(del.status, 200);
    const r = await api("/sync", { changes: [edit(a, 101, { stock: 1 })] });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /deleted by someone else/);
    assert.equal((await productsNow()).some((x) => x.id === 101), false);
  });

  test("CONC-7 one refused change rolls back the whole request, other modules included", async () => {
    const a = await load();
    const b = await load();
    assert.equal((await api("/sync", { changes: [edit(a, 101, { stock: 2 })] })).status, 200);
    const customers = (await stores()).customers;
    const renamed = { ...customers[0], name: "Renamed in the same request" };
    const r = await api("/sync", {
      changes: [
        { store: "customers", upserts: [renamed], deletes: [], order: customers.map((c) => c.id) },
        edit(b, 101, { stock: 99 }),
      ],
    });
    assert.equal(r.status, 409);
    assert.equal((await stores()).customers[0].name, customers[0].name);
  });

  test("CONC-8 re-ordering the list alone does not change any record's version", async () => {
    const a = await load();
    const reversed = orderOf(a.products).reverse();
    const r = await api("/sync", { changes: [{ store: "products", upserts: [], deletes: [], order: reversed }] });
    assert.equal(r.status, 200);
    assert.deepEqual((await load()).versions, a.versions);
  });

  test("CONC-9 a request without versions (an older browser tab) is still accepted, as before", async () => {
    const a = await load();
    const old = edit(a, 101, { stock: 5 });
    delete old.base;
    delete old.creates;
    const r = await api("/sync", { changes: [old] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await productsNow()).find((x) => x.id === 101).stock, 5);
  });

  test("CONC-10 malformed base / creates are a 400, not a crash", async () => {
    const a = await load();
    const bad1 = await api("/sync", { changes: [edit(a, 101, { stock: 1 }, { base: { 101: 5 } })] });
    assert.equal(bad1.status, 400);
    const bad2 = await api("/sync", { changes: [edit(a, 101, { stock: 1 }, { creates: "101" })] });
    assert.equal(bad2.status, 400);
  });
});

describe("the page in the browser", () => {
  beforeEach(async () => {
    await loadStores(shopFixture());
  });

  test("CONC-11 saving over somebody else's change shows 'Out of date' and keeps their change", async () => {
    const page = await openApp(browser, "Products & Inventory");
    const seen = [];
    page.removeAllListeners("dialog"); // the shared helper accepts every dialog, which would reload the page
    page.on("dialog", (d) => {
      seen.push(d.message());
      d.dismiss().catch(() => {}); // "Reload now?" -> not now
    });
    // meanwhile somebody else changes Beta Toner
    const fresh = await load();
    assert.equal((await api("/sync", { changes: [edit(fresh, 102, { stock: 40 })] })).status, 200);
    // this page still shows the old data; the user edits the same product
    await row(page, "Beta Toner").locator("button").nth(0).click();
    await field(modal(page), "Selling Price").fill("999");
    await modal(page).getByRole("button", { name: "Save Changes" }).click();
    await page.getByRole("status").filter({ hasText: "Out of date" }).waitFor({ timeout: 15000 });
    const p = (await productsNow()).find((x) => x.id === 102);
    log(`stored: stock ${p.stock}, price ${p.price}; dialog: ${seen[0]?.split("\n")[0]}`);
    assert.equal(p.stock, 40, "the other person's change is kept");
    assert.notEqual(p.price, 999, "the stale edit was not written");
    assert.equal(seen.length, 1);
    assert.match(seen[0], /changed by someone else/);
    await page.context().close();
  });

  test("CONC-12 editing one record twice in a row from one page never conflicts with itself", async () => {
    const page = await openApp(browser, "Products & Inventory");
    for (const price of ["300", "310", "320"]) {
      await row(page, "Beta Toner").locator("button").nth(0).click();
      await field(modal(page), "Selling Price").fill(price);
      await modal(page).getByRole("button", { name: "Save Changes" }).click();
      await page.getByRole("status").filter({ hasText: "Saved" }).waitFor({ timeout: 15000 });
    }
    assert.equal((await productsNow()).find((x) => x.id === 102).price, 320);
    assert.equal(await page.getByRole("status").filter({ hasText: "Out of date" }).count(), 0);
    await page.context().close();
  });
});

describe("health check", () => {
  test("CONC-13 /api/health answers 200 {ok:true} with the database up, with nothing else in it", async () => {
    const r = await fetch(process.env.TEST_BASE_URL + "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(r.headers.get("cache-control"), "no-store");
  });

  test("CONC-14 /api/health answers 503 {ok:false} (no details) when the database can't be reached", async () => {
    const r = await fetch(DEAD_DB_BASE + "/api/health");
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { ok: false });
  });
});
