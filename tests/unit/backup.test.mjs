// Unit tests for the backup file format (lib/learnex/backup.js): the file is a
// readable HTML page that also carries the data as embedded JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_MODULES,
  esc,
  backupRowToHTML,
  backupTableHTML,
  buildBackupHTML,
  parseBackupFile,
} from "@/lib/learnex/backup";
import { STORE_KEYS } from "@/lib/auth/permissions";

const store = {
  products: [{ id: 1, name: "Printer", price: 1000, tags: ["a", "b"] }],
  customers: [],
  suppliers: [{ id: 2, name: "Paper & Co <Ltd>" }],
  salesOrders: [{ id: "SO-1", lineItems: [{ productId: 1, qty: 2 }] }],
  purchaseOrders: [],
  rawMaterials: [],
  rawMaterialUsage: [],
  deliveryRuns: [],
  ledger: [{ id: "TXN-1", amount: 0.1 + 0.2, desc: "₹ — ✓" }],
  cashAccounts: [{ id: "CASH-MAIN", name: "Cash Account" }],
  settings: { businessName: "Test Shop", taxRate: 8, extra: { a: 1 } },
  users: [{ name: "Aarav" }],
};

test("BAK-1 a backup covers every module the app stores", () => {
  assert.deepEqual(BACKUP_MODULES.map((m) => m.key).sort(), [...STORE_KEYS].sort());
});

test("BAK-2 text is HTML-escaped in the readable part", () => {
  assert.equal(esc("<a & b>"), "&lt;a &amp; b&gt;");
  assert.equal(esc(null), "");
  assert.equal(esc(0), "0");
});

test("BAK-3 a record becomes one table row; nested values are shown as JSON", () => {
  assert.equal(
    backupRowToHTML({ a: 1, b: { x: 1 }, c: "<i>" }),
    '<tr><td>1</td><td>{"x":1}</td><td>&lt;i&gt;</td></tr>',
  );
});

test("BAK-4 a module's table shows its record count, or says it has no records", () => {
  assert.match(backupTableHTML("Products", []), /No records\./);
  const html = backupTableHTML("Products", [
    { id: 1, name: "A" },
    { id: 2, name: "B" },
  ]);
  assert.match(html, /\(2\)/);
  assert.match(html, /<th>id<\/th><th>name<\/th>/);
});

test("BAK-5 the readable page lists the settings and every module", () => {
  const html = buildBackupHTML(store);
  assert.match(html, /<b>businessName<\/b><\/td><td>Test Shop/);
  assert.match(html, /Paper &amp; Co &lt;Ltd&gt;/);
  for (const m of BACKUP_MODULES.filter((x) => x.key !== "settings"))
    assert.ok(html.includes(`<h2>${esc(m.label)}`), m.label);
});

test("BAK-6 a backup file reads back exactly what was saved", () => {
  const payload = parseBackupFile(buildBackupHTML(store));
  assert.equal(payload.app, "LEARNEX ERP");
  assert.equal(payload.backupVersion, 1);
  assert.ok(!Number.isNaN(Date.parse(payload.exportedAt)));
  assert.deepEqual(payload.data, store);
});

test("BAK-7 a record containing the text </script> doesn't break the backup", () => {
  const tricky = { ...store, products: [{ id: 1, name: "Bad </script><b>name</b>" }] };
  const payload = parseBackupFile(buildBackupHTML(tricky));
  assert.equal(payload.data.products[0].name, "Bad </script><b>name</b>");
});

test("BAK-8 plain JSON exports are accepted too", () => {
  assert.deepEqual(parseBackupFile(JSON.stringify({ data: { products: [] } })).data, { products: [] });
  const raw = parseBackupFile(JSON.stringify({ products: [{ id: 1 }] }));
  assert.deepEqual(raw, { data: { products: [{ id: 1 }] }, exportedAt: null });
});

test("BAK-9 anything else is refused with a clear message", () => {
  assert.throws(() => parseBackupFile('{"hello":"world"}'), /doesn't look like a LEARNEX backup/);
  assert.throws(
    () => parseBackupFile('<script type="application/json" id="learnex-backup-data">{"app":"x"}</script>'),
    /doesn't look like a LEARNEX backup/,
  );
  assert.throws(() => parseBackupFile("not json at all"));
});
