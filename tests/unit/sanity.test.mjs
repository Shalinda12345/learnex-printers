// Unit tests for the sanity checks on saved business data (lib/server/learnex/sanity.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanityProblem, MAX_MONEY } from "@/lib/server/learnex/sanity";
import {
  SEED_CUSTOMERS,
  SEED_LEDGER,
  SEED_PRODUCTS,
  SEED_RAW_MATERIALS,
  SEED_SALES_ORDERS,
  SEED_SUPPLIERS,
} from "@/lib/learnex/seed";

const NOW = new Date("2026-11-09T12:00:00Z");
const problem = (store, rec) => sanityProblem(store, rec, NOW);

test("SAN-1 the demo data the app starts with is accepted (the checks do not reject normal records)", () => {
  const sets = {
    products: SEED_PRODUCTS,
    customers: SEED_CUSTOMERS,
    suppliers: SEED_SUPPLIERS,
    salesOrders: SEED_SALES_ORDERS,
    rawMaterials: SEED_RAW_MATERIALS,
    ledger: SEED_LEDGER,
  };
  let checked = 0;
  for (const [store, records] of Object.entries(sets)) {
    assert.ok(records.length > 0, store);
    for (const rec of records) {
      assert.equal(problem(store, rec), null, `${store} ${rec.id}`);
      checked++;
    }
  }
  assert.ok(checked >= 90, `${checked} records checked`);
});

test("SAN-2 the impossible figures from the security audit are refused", () => {
  assert.match(problem("salesOrders", { id: "SO-1", amount: -500000, amountPaid: 0, date: "2026-02-01" }), /amount can't be negative/);
  // the expense from the audit is wrong twice over (a negative amount AND a date in 2099): either refuses it
  assert.notEqual(problem("ledger", { id: "T1", date: "2099-01-01", type: "Expense", category: "Rent", amount: -1e12 }), null);
  assert.match(
    problem("ledger", { id: "T1", date: "2026-11-01", type: "Expense", category: "Rent", amount: -1e12 }),
    /amount can't be negative/,
  );
  assert.match(problem("ledger", { id: "T2", date: "2099-01-01", type: "Expense", amount: 5 }), /too far in the future/);
  assert.match(problem("products", { id: 1, name: "x", price: -1, cost: 5, stock: 1 }), /price can't be negative/);
  assert.match(problem("products", { id: 1, name: "x", price: 5, cost: 5, stock: -999 }), /stock can't be negative/);
});

test("SAN-3 what the app really writes is accepted: refunds, losses, overdrafts, rounding noise", () => {
  // an order returned in full
  assert.equal(problem("salesOrders", { id: "SO-1", amount: 0, tax: 0, amountPaid: 0, items: 0, lineItems: [], date: "2026-10-01" }), null);
  // "Cost of goods sold reversed" on a return is the one negative ledger line
  assert.equal(
    problem("ledger", { id: "T1", date: "2026-10-01", type: "Expense", category: "Cost of Goods Sold", kind: "cogs", amount: -640 }),
    null,
  );
  // a delivery run can make a loss
  assert.equal(problem("deliveryRuns", { id: "DR-1", date: "2026-10-01", saleAmount: 100, costAmount: 600, profit: -500, netProfit: -520 }), null);
  // an opening balance can be an overdraft
  assert.equal(problem("cashAccounts", { id: "BANK", opening: -1000 }), null);
  // rounding noise is not a negative number
  assert.equal(problem("products", { id: 1, name: "x", price: 5, cost: 5, stock: -1e-12 }), null);
  // a fully paid order
  assert.equal(problem("salesOrders", { id: "SO-2", amount: 110, tax: 10, amountPaid: 110, date: "2026-10-01" }), null);
});

test("SAN-4 other negatives, absurd sizes, overpayment and bad line items are refused", () => {
  assert.match(problem("ledger", { id: "T1", date: "2026-10-01", type: "Expense", kind: "opex", amount: -5 }), /negative/);
  assert.match(problem("ledger", { id: "T1", date: "2026-10-01", type: "Income", kind: "cogs", amount: -5 }), /negative/);
  assert.match(problem("ledger", { id: "T1", date: "2026-10-01", type: "Income", amount: MAX_MONEY * 10 }), /unrealistically large/);
  assert.match(problem("products", { id: 1, price: 1e30, cost: 1, stock: 1 }), /price .* unrealistically large/);
  assert.match(problem("salesOrders", { id: "SO-1", amount: 100, amountPaid: 999999999 }), /amountPaid .* can't be more than amount/);
  assert.match(problem("purchaseOrders", { id: "PO-1", total: 50, amountPaid: 51, date: "2026-10-01" }), /amountPaid .* can't be more than total/);
  assert.match(
    problem("salesOrders", { id: "SO-1", amount: 10, lineItems: [{ qty: 1, price: 5 }, { qty: -2, price: 5 }] }),
    /lineItems\[2\]\.qty can't be negative/,
  );
  assert.match(
    problem("salesOrders", { id: "SO-1", amount: 10, payments: [{ date: "2026-10-01", amount: 5 }, { date: "2026-10-02", amount: -5 }] }),
    /payments\[2\]\.amount can't be negative/,
  );
  assert.match(problem("deliveryRuns", { id: "DR-1", lineItems: [{ taken: -3 }] }), /lineItems\[1\]\.taken can't be negative/);
});

test("SAN-5 dates: real-looking, not before 2000, not more than a month ahead", () => {
  assert.equal(problem("ledger", { id: "T", date: "2026-11-09", amount: 1 }), null); // today
  assert.equal(problem("ledger", { id: "T", date: "2026-12-05", amount: 1 }), null); // within a month
  assert.match(problem("ledger", { id: "T", date: "2026-12-20", amount: 1 }), /too far in the future/);
  assert.match(problem("ledger", { id: "T", date: "1999-12-31", amount: 1 }), /too far in the past/);
  assert.match(problem("ledger", { id: "T", date: "2099-1-5", amount: 1 }), /too far in the future/); // not padded, still a date
  assert.equal(problem("ledger", { id: "T", date: "", amount: 1 }), null);
  assert.equal(problem("ledger", { id: "T", date: null, amount: 1 }), null);
  assert.equal(problem("ledger", { id: "T", date: "n/a", amount: 1 }), null); // not a date at all: left as typed
  assert.match(problem("suppliers", { id: 1, lastOrder: "2099-01-01" }), /lastOrder .* too far in the future/);
});

test("SAN-6 anything it does not understand is left alone, as the store keeps it", () => {
  assert.equal(problem("products", { id: 1, price: "12", cost: "5", stock: "3" }), null); // numbers typed as text
  assert.equal(problem("products", { id: 1, price: "N/A", cost: null, stock: undefined }), null);
  assert.match(problem("products", { id: 1, price: "-5", cost: 1, stock: 1 }), /price can't be negative/); // text that is a number
  assert.equal(problem("products", { id: 1 }), null);
  assert.equal(problem("settings", { taxRate: -5 }), null); // not a module with checks
  assert.equal(problem("nonsense", { amount: -5 }), null);
});

test("SAN-ATT only photos and PDFs may be attached; links that run code or leave the app are refused", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const ok = (attachment) => sanityProblem("ledger", { id: "T", date: "2026-01-01", type: "Expense", amount: 1, attachment });
  assert.equal(ok(null), null);
  assert.equal(ok({ name: "a.png", type: "image/png", dataUrl: png }), null);
  assert.equal(ok({ name: "a.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0=" }), null);
  for (const dataUrl of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4=", "https://evil.example/x.png", 5])
    assert.match(ok({ name: "x", dataUrl }), /attachment/, String(dataUrl));
  assert.match(ok("javascript:alert(1)"), /attachment/);
});

test("SAN-STUB the small stand-in the app holds instead of a stored file is accepted; a real file over 2.5 MB is not", () => {
  const rec = (attachment) => ({ id: "T", date: "2026-01-01", type: "Expense", amount: 1, attachment });
  assert.equal(sanityProblem("ledger", rec({ name: "bill.png", type: "image/png", size: 123, stored: true })), null);
  const small = "data:image/png;base64," + "A".repeat(1000);
  assert.equal(sanityProblem("ledger", rec({ name: "x.png", dataUrl: small })), null);
  const big = "data:image/png;base64," + "A".repeat(3_800_000);
  assert.match(sanityProblem("ledger", rec({ name: "x.png", dataUrl: big })), /2\.5 MB/);
});
