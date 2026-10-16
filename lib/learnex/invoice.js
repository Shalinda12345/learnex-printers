/* =====================================================================
   SALES INVOICES — the printable (Save as PDF) invoice for a sales order.

   Every sales order is given its invoice number (INV-…) the day it is
   raised; this turns the order into the document the customer receives.
   The figures are the order's own — the tax it was charged and what has
   been paid against it since — never recalculated from today's settings,
   so a reprint always matches what was billed.
===================================================================== */
import { escapeHtml, money, numVal, round2 } from "@/lib/learnex/utils";

// Paid / balance work for old records too — anything marked Paid counts as fully paid.
export const paidOf = (o) => (o.amountPaid != null ? o.amountPaid : o.payment === "Paid" ? o.amount : 0);
export const balanceOf = (o) => round2(Math.max(0, o.amount - paidOf(o)));

// "Jul 16, 2026" — an invoice needs the year, unlike the app's short dates.
export function fmtLongDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// The rate the stored tax was charged at. Today's rate is used when it gives
// exactly that tax (the usual case, and exact even on tiny orders); otherwise
// the rate changed since, so it is worked back from the amounts.
function taxRateOf(subtotal, tax, currentRate) {
  if (!(tax > 0) || !(subtotal > 0)) return null;
  const rate = numVal(currentRate, NaN);
  if (isFinite(rate) && round2(subtotal * (rate / 100)) === tax) return rate;
  return round2((tax / subtotal) * 100);
}

function invoiceStatus(order, paid, balance) {
  if (order.status === "Cancelled") return { label: "Cancelled", tone: "void" };
  if (balance <= 0.004) return { label: "Paid", tone: "paid" };
  if (order.payment === "Overdue") return { label: "Overdue", tone: "overdue" };
  if (paid > 0) return { label: "Partly paid", tone: "due" };
  return { label: "Payment due", tone: "due" };
}

/** Everything printed on the invoice, worked out from the order. */
export function buildInvoice(order, { settings = {}, customer = null } = {}) {
  const total = round2(order.amount);
  const tax = round2(order.tax || 0);
  const subtotal = round2(total - tax);
  const lines = (order.lineItems || []).map((li) => {
    const qty = numVal(li.qty, 0);
    const price = numVal(li.price, 0);
    return { name: li.name, qty, unit: li.unit || "", price, amount: round2(qty * price) };
  });
  // Orders brought over from the old app only kept a total and an item count.
  if (lines.length === 0) {
    lines.push({
      name: `Goods as per sales order ${order.id}`,
      qty: numVal(order.items, 0) || 1,
      unit: "",
      price: null,
      amount: subtotal,
    });
  }
  const itemsTotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const paid = round2(paidOf(order));
  const balance = balanceOf(order);
  return {
    number: order.invoice || order.id,
    orderId: order.id,
    date: order.date,
    orderStatus: order.status,
    status: invoiceStatus(order, paid, balance),
    business: {
      name: settings.businessName || "",
      address: settings.businessAddress || "",
      phone: settings.businessPhone || "",
      email: settings.businessEmail || "",
    },
    billTo: {
      name: (customer && customer.name) || order.customer || "",
      contact: (customer && customer.contact) || "",
      phone: (customer && customer.phone) || "",
      email: (customer && customer.email) || "",
    },
    lines,
    itemsTotal,
    // Line amounts that don't add up to the billed subtotal (only seen in
    // imported data) are shown as an adjustment, so the page still adds up.
    adjustment: round2(subtotal - itemsTotal),
    subtotal,
    tax,
    taxRate: taxRateOf(subtotal, tax, settings.taxRate),
    total,
    paid,
    balance,
    payments: (order.payments || []).filter((p) => numVal(p.amount, 0) > 0),
    note: order.note || "",
    fromDelivery: order.fromDelivery || "",
    footer: settings.invoiceNote || "",
  };
}

const INVOICE_CSS = `
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;padding:12px 16px;background:#f1f5f9}
.toolbar button{font:inherit;font-size:13px;font-weight:600;color:#fff;background:#2563eb;border:0;border-radius:10px;padding:9px 16px;cursor:pointer}
.toolbar button:hover{background:#1d4ed8}
.sheet{max-width:794px;margin:0 auto 32px;background:#fff;padding:44px 48px;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.08)}
.muted{color:#64748b}
.small{font-size:12px;line-height:1.6}
.label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 6px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:24px;border-bottom:2px solid #0f172a}
header h1{font-size:20px;margin:0 0 6px}
.doc{text-align:right}
.doc h2{font-size:28px;letter-spacing:.12em;margin:0;color:#2563eb}
.doc .no{font-size:14px;font-weight:600;margin-top:4px}
.chip{display:inline-block;margin-top:10px;padding:3px 10px;border-radius:999px;border:1px solid;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.chip.paid{color:#047857;background:#ecfdf5;border-color:#a7f3d0}
.chip.due{color:#b45309;background:#fffbeb;border-color:#fde68a}
.chip.overdue{color:#b91c1c;background:#fef2f2;border-color:#fecaca}
.chip.void{color:#475569;background:#f1f5f9;border-color:#cbd5e1}
.parties{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin:24px 0 28px}
.party-name{font-size:15px;font-weight:600;margin-bottom:2px}
.meta{border-collapse:collapse;font-size:12px}
.meta td{padding:3px 0}
.meta td:first-child{color:#64748b;padding-right:20px}
.meta td:last-child{text-align:right;font-weight:500}
.items{width:100%;border-collapse:collapse;font-size:12.5px}
.items th{text-align:left;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:9px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.items td{padding:10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
.items .idx{width:32px;color:#94a3b8}
.num,.items th.num{text-align:right;white-space:nowrap}
.summary{display:flex;justify-content:space-between;align-items:flex-start;gap:32px;margin-top:20px}
.side{flex:1;min-width:0}
.side p{margin:0 0 4px}
.side .block{margin-bottom:16px}
.pay{border-collapse:collapse;font-size:12px}
.pay td{padding:2px 20px 2px 0}
.totals{width:290px;flex-shrink:0;font-size:13px}
.totals .row{display:flex;justify-content:space-between;gap:16px;padding:5px 0}
.totals .grand{border-top:2px solid #0f172a;margin-top:4px;padding-top:9px;font-size:15px;font-weight:700}
.totals .due{margin-top:6px;padding:9px 12px;border-radius:10px;background:#f8fafc;font-weight:700}
.totals .due.open{background:#fffbeb;color:#b45309}
footer{margin-top:36px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b}
footer .note{white-space:pre-wrap;color:#0f172a;margin:0 0 10px}
footer .thanks{margin:0;font-weight:600;color:#0f172a}
@media (max-width:640px){
  .sheet{padding:24px 16px;border-radius:0}
  header,.parties,.summary{flex-direction:column}
  .doc{text-align:left}
  .totals{width:100%}
}
@media print{
  body{background:#fff}
  .toolbar{display:none}
  .sheet{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}
  .items tr{break-inside:avoid}
}`;

/** The invoice as a complete, self-contained HTML page. */
export function invoiceHtml(order, opts) {
  const inv = buildInvoice(order, opts);
  const esc = escapeHtml;
  const multiline = (s) => esc(s).replace(/\r?\n/g, "<br>");
  const joinLines = (parts) => parts.filter(Boolean).map(esc).join("<br>");
  const row = (label, value, cls = "") =>
    `<div class="row${cls ? " " + cls : ""}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

  const businessDetails = [
    inv.business.address && multiline(inv.business.address),
    joinLines([[inv.business.phone, inv.business.email].filter(Boolean).join(" · ")]),
  ].filter(Boolean);
  const billToDetails = joinLines([
    inv.billTo.contact && `Attn: ${inv.billTo.contact}`,
    inv.billTo.phone,
    inv.billTo.email,
  ]);
  const itemRows = inv.lines
    .map(
      (l, i) => `<tr>
<td class="idx">${i + 1}</td>
<td>${esc(l.name)}</td>
<td class="num">${esc(l.qty)}${l.unit ? " " + esc(l.unit) : ""}</td>
<td class="num">${l.price == null ? "" : esc(money(l.price))}</td>
<td class="num">${esc(money(l.amount))}</td>
</tr>`,
    )
    .join("");
  const totals = [
    Math.abs(inv.adjustment) >= 0.01 && row("Items", money(inv.itemsTotal)),
    Math.abs(inv.adjustment) >= 0.01 && row("Adjustment", money(inv.adjustment)),
    row("Subtotal", money(inv.subtotal)),
    inv.tax > 0 && row(inv.taxRate != null ? `Tax (${inv.taxRate}%)` : "Tax", money(inv.tax)),
    row("Total", money(inv.total), "grand"),
    row("Amount paid", money(inv.paid)),
    row("Balance due", money(inv.balance), inv.balance > 0 ? "due open" : "due"),
  ]
    .filter(Boolean)
    .join("");
  const side = [
    inv.payments.length > 0 &&
      `<div class="block"><p class="label">Payments received</p><table class="pay"><tbody>${inv.payments
        .map((p) => `<tr><td class="muted">${esc(fmtLongDate(p.date))}</td><td>${esc(money(p.amount))}</td></tr>`)
        .join("")}</tbody></table></div>`,
    inv.note && `<div class="block"><p class="label">Note</p><p class="small">${multiline(inv.note)}</p></div>`,
    inv.fromDelivery &&
      `<div class="block"><p class="small muted">Credit bill from delivery run ${esc(inv.fromDelivery)}.</p></div>`,
  ]
    .filter(Boolean)
    .join("");
  const title = `Invoice ${inv.number}${inv.billTo.name ? " - " + inv.billTo.name : ""}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${INVOICE_CSS}</style></head><body>
<div class="toolbar"><button type="button" id="print-invoice">Print / Save as PDF</button></div>
<main class="sheet">
<header>
<div>
<h1>${esc(inv.business.name || "Invoice")}</h1>
${businessDetails.length ? `<div class="small muted">${businessDetails.join("<br>")}</div>` : ""}
</div>
<div class="doc">
<h2>INVOICE</h2>
<div class="no">${esc(inv.number)}</div>
<span class="chip ${inv.status.tone}">${esc(inv.status.label)}</span>
</div>
</header>
<section class="parties">
<div>
<p class="label">Bill to</p>
<div class="party-name">${esc(inv.billTo.name)}</div>
${billToDetails ? `<div class="small muted">${billToDetails}</div>` : ""}
</div>
<table class="meta"><tbody>
<tr><td>Invoice date</td><td>${esc(fmtLongDate(inv.date))}</td></tr>
<tr><td>Sales order</td><td>${esc(inv.orderId)}</td></tr>
${inv.orderStatus ? `<tr><td>Order status</td><td>${esc(inv.orderStatus)}</td></tr>` : ""}
</tbody></table>
</section>
<table class="items">
<thead><tr><th class="idx">#</th><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
<tbody>${itemRows}</tbody>
</table>
<section class="summary">
<div class="side">${side}</div>
<div class="totals">${totals}</div>
</section>
<footer>
${inv.footer ? `<p class="note">${esc(inv.footer)}</p>` : ""}
<p class="thanks">Thank you for your business.</p>
</footer>
</main>
</body></html>`;
}

/**
 * Opens the invoice in a new window and brings up the print dialog (where it
 * can also be saved as a PDF). Returns false when the browser blocked the window.
 */
export function openInvoice(order, opts) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(invoiceHtml(order, opts));
  win.document.close();
  // Wired from here rather than an inline handler, so it works whatever
  // script policy the new window inherits.
  const btn = win.document.getElementById("print-invoice");
  if (btn) btn.addEventListener("click", () => win.print());
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}
