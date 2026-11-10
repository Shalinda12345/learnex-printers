import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeChanges, mergeRecord } from "@/lib/learnex/merge";

const product = (stock, extra = {}) => ({ id: 1, name: "Toner", price: 100, stock, ...extra });

test("MRG-1 two tills each sell from the same stock: both sales are counted (10 → 9 and 10 → 8 gives 7)", () => {
  const { record, conflicts } = mergeRecord(product(10), product(9), product(8));
  assert.equal(record.stock, 7);
  assert.deepEqual(conflicts, []);
});

test("MRG-2 a field I did not touch takes the other person's change", () => {
  const { record } = mergeRecord(product(10), product(9), product(10, { price: 120 }));
  assert.equal(record.price, 120);
  assert.equal(record.stock, 9);
});

test("MRG-3 a field only I changed keeps my change; both changing the same text is a counted conflict (mine wins)", () => {
  assert.equal(mergeRecord(product(10), product(10, { name: "Mine" }), product(10)).record.name, "Mine");
  const both = mergeRecord(product(10), product(10, { name: "Mine" }), product(10, { name: "Theirs" }));
  assert.equal(both.record.name, "Mine");
  assert.deepEqual(both.conflicts, ["name"]);
});

test("MRG-4 decimals do not drift (0.1 + 0.2 style sums are rounded)", () => {
  assert.equal(mergeRecord({ v: 1 }, { v: 1.1 }, { v: 1.2 }).record.v, 1.3);
});

test("MRG-5 a new sale is added to the fresh data, in the place it had in my list", () => {
  const loaded = { salesOrders: [{ id: "SO-1043", invoice: "INV-2462", amount: 5 }] };
  const sale = { id: "SO-1044", invoice: "INV-2463", amount: 7 };
  const { merged, unresolved } = mergeChanges(loaded, { salesOrders: { upserts: [{ base: null, mine: sale, index: 0 }], deletes: [] } });
  assert.deepEqual(unresolved, []);
  assert.deepEqual(merged.salesOrders.map((o) => o.id), ["SO-1044", "SO-1043"]);
});

test("MRG-6 both tills picked SO-1043: mine is renumbered, with its invoice and the ledger lines that mention them", () => {
  const loaded = {
    salesOrders: [{ id: "SO-1043", invoice: "INV-2462", amount: 5 }],
    ledger: [{ id: "TXN-8822", desc: "POS sale — INV-2462 (Walk-in)" }],
    products: [product(8)],
  };
  const ops = {
    salesOrders: { upserts: [{ base: null, mine: { id: "SO-1043", invoice: "INV-2462", amount: 9 }, index: 0 }], deletes: [] },
    ledger: { upserts: [{ base: null, mine: { id: "TXN-8822", desc: "POS sale — INV-2462 (Ann)" }, index: 0 }], deletes: [] },
    products: { upserts: [{ base: product(10), mine: product(9), index: 0 }], deletes: [] },
  };
  const { merged, unresolved } = mergeChanges(loaded, ops);
  assert.deepEqual(unresolved, []);
  const mine = merged.salesOrders.find((o) => o.amount === 9);
  assert.equal(mine.id, "SO-1044");
  assert.equal(mine.invoice, "INV-2463");
  const line = merged.ledger.find((t) => t.desc.includes("Ann"));
  assert.equal(line.id, "TXN-8823");
  assert.equal(line.desc, "POS sale — INV-2463 (Ann)");
  assert.equal(merged.ledger.find((t) => t.desc.includes("Walk-in")).desc, "POS sale — INV-2462 (Walk-in)", "their records are untouched");
  assert.equal(merged.products[0].stock, 7);
});

test("MRG-7 INV-24 is not mistaken for part of INV-246 when renumbering", () => {
  const loaded = { salesOrders: [{ id: "SO-5", invoice: "INV-24" }] };
  const ops = { salesOrders: { upserts: [{ base: null, mine: { id: "SO-6", invoice: "INV-24", note: "see INV-246" }, index: 0 }], deletes: [] } };
  const { merged } = mergeChanges(loaded, ops);
  const mine = merged.salesOrders.find((o) => o.id === "SO-6");
  assert.equal(mine.invoice, "INV-25");
  assert.equal(mine.note, "see INV-246");
});

test("MRG-8 deletes are applied; a record someone else deleted that I edited is put back", () => {
  const loaded = { customers: [{ id: 2, name: "B" }] };
  const ops = { customers: { upserts: [{ base: { id: 1, name: "A" }, mine: { id: 1, name: "A2" }, index: 0 }], deletes: [2] } };
  const { merged } = mergeChanges(loaded, ops);
  assert.deepEqual(merged.customers, [{ id: 1, name: "A2" }]);
});

test("MRG-9 a clash that cannot be repaired (same numeric id) makes the whole merge unresolved", () => {
  const loaded = { customers: [{ id: 7, name: "Theirs" }] };
  const ops = { customers: { upserts: [{ base: null, mine: { id: 7, name: "Mine" }, index: 0 }], deletes: [] } };
  const result = mergeChanges(loaded, ops);
  assert.equal(result.unresolved.length, 1);
});

test("MRG-10 two of my ledger lines TXN-8822 and TXN-8823 both clash: they get fresh numbers, never the same one twice", () => {
  const loaded = { ledger: [{ id: "TXN-8822" }, { id: "TXN-8823" }] };
  const ops = {
    ledger: {
      upserts: [
        { base: null, mine: { id: "TXN-8822", desc: "sale" }, index: 0 },
        { base: null, mine: { id: "TXN-8823", desc: "cost of sale TXN-8822" }, index: 1 },
      ],
      deletes: [],
    },
  };
  const { merged, unresolved } = mergeChanges(loaded, ops);
  assert.deepEqual(unresolved, []);
  const mine = merged.ledger.filter((t) => t.desc);
  assert.equal(new Set(merged.ledger.map((t) => t.id)).size, 4, "all four ids are different");
  const sale = mine.find((t) => t.desc === "sale");
  assert.match(mine.find((t) => t.desc.startsWith("cost")).desc, new RegExp(`cost of sale ${sale.id}$`), "the second line points at the renamed first one");
});
