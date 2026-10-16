// Unit tests for sales invoices (lib/learnex/invoice.js): what an order's
// invoice shows, and the printable page built from it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { balanceOf, buildInvoice, fmtLongDate, invoiceHtml, paidOf } from "@/lib/learnex/invoice";

const SETTINGS = {
  businessName: "Test Shop",
  businessAddress: "12 Main Street\nColombo 03",
  businessPhone: "011 222 3333",
  businessEmail: "sales@test.lk",
  invoiceNote: "Bank: BOC 123456\nPayment within 30 days",
  taxRate: 10,
};
const ACME = { id: 201, name: "Acme Traders", contact: "Ann", phone: "011", email: "acme@x.lk" };

// An order as the Sales Orders screen saves it: 1 × 1,000 + 2 × 250 at 10% tax.
const order = (patch = {}) => ({
  id: "SO-1043",
  invoice: "INV-2462",
  customer: "Acme Traders",
  customerId: 201,
  items: 3,
  lineItems: [
    { productId: 101, name: "Alpha Printer", qty: 1, price: 1000 },
    { productId: 102, name: "Beta Toner", qty: 2, price: 250 },
  ],
  amount: 1650,
  tax: 150,
  status: "Processing",
  payment: "Pending",
  date: "2026-07-16",
  channel: "Manual",
  amountPaid: 0,
  payments: [],
  accrued: true,
  ...patch,
});

describe("paid and balance", () => {
  test("INVC-1 what has been paid: the recorded amount, or the whole amount for old records marked Paid", () => {
    assert.equal(paidOf(order({ amountPaid: 650 })), 650);
    assert.equal(paidOf({ amount: 500, payment: "Paid" }), 500, "old record without amountPaid");
    assert.equal(paidOf({ amount: 500, payment: "Pending" }), 0);
    assert.equal(balanceOf(order({ amountPaid: 650 })), 1000);
    assert.equal(balanceOf(order({ amountPaid: 2000 })), 0, "never negative");
  });
});

describe("buildInvoice", () => {
  test("INVC-2 lines, totals and the bill-to details come from the order and the customer record", () => {
    const inv = buildInvoice(order(), { settings: SETTINGS, customer: ACME });
    assert.equal(inv.number, "INV-2462");
    assert.equal(inv.orderId, "SO-1043");
    assert.deepEqual(
      inv.lines.map((l) => [l.name, l.qty, l.price, l.amount]),
      [
        ["Alpha Printer", 1, 1000, 1000],
        ["Beta Toner", 2, 250, 500],
      ],
    );
    assert.deepEqual(
      [inv.subtotal, inv.tax, inv.taxRate, inv.total, inv.paid, inv.balance, inv.adjustment],
      [1500, 150, 10, 1650, 0, 1650, 0],
    );
    assert.deepEqual(inv.billTo, { name: "Acme Traders", contact: "Ann", phone: "011", email: "acme@x.lk" });
    assert.equal(inv.business.name, "Test Shop");
    assert.equal(inv.footer, SETTINGS.invoiceNote);
  });

  test("INVC-3 the tax rate is the one the order was charged at, even after the rate in Settings changes", () => {
    // 8% on 41,852 = 3,348; Settings now say 10%
    const inv = buildInvoice(order({ lineItems: [], items: 6, amount: 45200, tax: 3348 }), {
      settings: SETTINGS,
    });
    assert.equal(inv.taxRate, 8);
    assert.equal(inv.subtotal, 41852);
    // a tiny order where working the rate back from the amounts would be off: 8% of 12.34 = 0.99
    const tiny = buildInvoice(
      order({ lineItems: [{ name: "Clip", qty: 1, price: 12.34 }], amount: 13.33, tax: 0.99 }),
      { settings: { taxRate: "8" } },
    );
    assert.equal(tiny.taxRate, 8);
    assert.equal(buildInvoice(order({ amount: 1500, tax: 0 })).taxRate, null, "no tax charged");
  });

  test("INVC-4 an order brought over from the old app (no line items) is billed as one line for its items", () => {
    const inv = buildInvoice(order({ lineItems: [], items: 6, amount: 45200, tax: 3348 }));
    assert.deepEqual(inv.lines, [
      { name: "Goods as per sales order SO-1043", qty: 6, unit: "", price: null, amount: 41852 },
    ]);
    assert.equal(inv.adjustment, 0);
  });

  test("INVC-5 line amounts that don't add up to the billed subtotal show as an adjustment", () => {
    const inv = buildInvoice(order({ amount: 1600, tax: 150 }));
    assert.deepEqual([inv.itemsTotal, inv.adjustment, inv.subtotal], [1500, -50, 1450]);
  });

  test("INVC-6 the status shown on the invoice", () => {
    const status = (patch) => buildInvoice(order(patch)).status.label;
    assert.equal(status({}), "Payment due");
    assert.equal(status({ amountPaid: 650 }), "Partly paid");
    assert.equal(status({ amountPaid: 1650, payment: "Paid" }), "Paid");
    assert.equal(status({ payment: "Overdue" }), "Overdue");
    assert.equal(status({ status: "Cancelled", amountPaid: 1650 }), "Cancelled");
  });

  test("INVC-7 a delivery credit bill or walk-in sale with no customer record is billed to the name on the order", () => {
    const inv = buildInvoice(
      order({
        customer: "Corner Shop",
        customerId: null,
        lineItems: [{ productId: 103, name: "Gamma Paper", qty: 4, price: 50, unit: "ream" }],
        amount: 200,
        tax: 0,
        fromDelivery: "DR-1001",
        note: "Collect Friday",
      }),
    );
    assert.deepEqual(inv.billTo, { name: "Corner Shop", contact: "", phone: "", email: "" });
    assert.equal(inv.lines[0].unit, "ream");
    assert.deepEqual([inv.fromDelivery, inv.note], ["DR-1001", "Collect Friday"]);
  });
});

describe("invoiceHtml", () => {
  test("INVC-8 the page shows the business, the customer, every line and the totals", () => {
    const html = invoiceHtml(
      order({ amountPaid: 650, payments: [{ date: "2026-07-18", amount: 650 }] }),
      { settings: SETTINGS, customer: ACME },
    );
    assert.match(html, /<title>Invoice INV-2462 - Acme Traders<\/title>/);
    assert.match(html, /<h1>Test Shop<\/h1>/);
    assert.match(html, /12 Main Street<br>Colombo 03<br>011 222 3333 · sales@test.lk/);
    assert.match(html, /<div class="no">INV-2462<\/div>/);
    assert.match(html, /<span class="chip due">Partly paid<\/span>/);
    assert.match(html, /<div class="party-name">Acme Traders<\/div>/);
    assert.match(html, /Attn: Ann<br>011<br>acme@x\.lk/);
    assert.match(html, /<td>Invoice date<\/td><td>Jul 16, 2026<\/td>/);
    assert.match(html, /<td>Alpha Printer<\/td>\s*<td class="num">1<\/td>\s*<td class="num">Rs\. 1,000<\/td>/);
    assert.match(html, /<td>Beta Toner<\/td>\s*<td class="num">2<\/td>\s*<td class="num">Rs\. 250<\/td>\s*<td class="num">Rs\. 500<\/td>/);
    assert.match(html, /<span>Subtotal<\/span><span>Rs\. 1,500<\/span>/);
    assert.match(html, /<span>Tax \(10%\)<\/span><span>Rs\. 150<\/span>/);
    assert.match(html, /<div class="row grand"><span>Total<\/span><span>Rs\. 1,650<\/span>/);
    assert.match(html, /<span>Amount paid<\/span><span>Rs\. 650<\/span>/);
    assert.match(html, /<div class="row due open"><span>Balance due<\/span><span>Rs\. 1,000<\/span>/);
    assert.match(html, /Jul 18, 2026<\/td><td>Rs\. 650/);
    assert.match(html, /<p class="note">Bank: BOC 123456\nPayment within 30 days<\/p>/);
    assert.doesNotMatch(html, /Adjustment/);
  });

  test("INVC-9 no tax line when no tax was charged, and no empty contact blocks", () => {
    const html = invoiceHtml(order({ customerId: null, amount: 1500, tax: 0 }), {
      settings: { businessName: "Test Shop" },
    });
    assert.doesNotMatch(html, /Tax/);
    assert.doesNotMatch(html, /Attn:/);
    assert.doesNotMatch(html, /class="note"/);
    assert.match(html, /<h1>Test Shop<\/h1>\s*<\/div>/, "no address block");
  });

  test("INVC-10 text typed into the app is escaped, never run as markup", () => {
    const html = invoiceHtml(
      order({
        customer: "<script>alert(1)</script>",
        customerId: null,
        lineItems: [{ name: "<img src=x onerror=alert(1)>", qty: 1, price: 1500 }],
        note: "a & b",
      }),
      { settings: { businessName: "Tom & Co <b>" } },
    );
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /<img /);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /<h1>Tom &amp; Co &lt;b&gt;<\/h1>/);
    assert.match(html, /a &amp; b/);
  });
});

test("INVC-11 fmtLongDate includes the year", () => {
  assert.equal(fmtLongDate("2026-07-16"), "Jul 16, 2026");
  assert.equal(fmtLongDate(""), "—");
  assert.equal(fmtLongDate("not a date"), "not a date");
});
