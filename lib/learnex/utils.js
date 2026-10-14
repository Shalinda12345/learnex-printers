/* =====================================================================
   GENERIC HELPERS
===================================================================== */
export let CURRENCY_SYMBOL = "Rs.";
// Imported bindings are read-only in ES modules, so the app root updates the
// symbol through this setter (importers still see the live value).
export function setCurrencySymbol(symbol) {
  CURRENCY_SYMBOL = symbol;
}
export const round2 = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return (Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 100)) / 100;
};
// A weighted-average unit cost rarely lands on a whole cent (three units for
// Rs. 1,000 is Rs. 333.333...). Storing it to two decimals would leave a few
// cents of inventory value unaccounted for on every purchase, so average costs
// are held to six decimals and only rounded when displayed.
export const round6 = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return (Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 1e6)) / 1e6;
};
// Blends what is already on hand with what is arriving.
export function weightedAvgCost(onHandQty, onHandCost, incomingQty, incomingCost) {
  const q0 = numVal(onHandQty, 0),
    c0 = numVal(onHandCost, 0);
  const q1 = numVal(incomingQty, 0),
    c1 = numVal(incomingCost, 0);
  const totalQty = q0 + q1;
  if (totalQty <= 0) return round6(c1);
  return round6((q0 * c0 + q1 * c1) / totalQty);
}
// Accepts decimals. Shows 2 decimal places only when the amount actually has cents,
// so whole-number amounts still read as "Rs. 42,500".
export const money = (n) => {
  const v = round2(n || 0);
  return (
    `${CURRENCY_SYMBOL} ` +
    v.toLocaleString("en-US", {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
};
// Parses user input that may contain decimals ("1250.75"). Blank/invalid -> fallback.
export const numVal = (v, fallback = 0) => {
  if (v === "" || v === null || v === undefined) return fallback;
  const n = Number(v);
  return isFinite(n) ? n : fallback;
};
// "YYYY-MM-DD" for a Date's LOCAL calendar day.
// IMPORTANT: do not use toISOString() for this — it returns the date in UTC,
// not the user's local time. For anyone east of UTC (e.g. Sri Lanka,
// UTC+5:30), every transaction entered between midnight and roughly
// 5:30 AM local time would silently get filed under YESTERDAY's date
// system-wide (POS, Delivery Stock, Purchases, the Ledger — everything
// that stamps "today").
export function localISO(d) {
  return isoFromYMD(d.getFullYear(), d.getMonth(), d.getDate());
}
export function todayISO() {
  return localISO(new Date());
}
export function isInPeriod(dateStr, period, anchorISO) {
  if (!dateStr) return false;
  if (period === "daily") return dateStr === anchorISO;
  if (period === "weekly") {
    const anchor = new Date(anchorISO + "T00:00:00");
    const d = new Date(dateStr + "T00:00:00");
    const diffDays = Math.round((anchor - d) / 86400000);
    return diffDays >= 0 && diffDays < 7;
  }
  if (period === "monthly") return dateStr.slice(0, 7) === anchorISO.slice(0, 7);
  if (period === "annually") return dateStr.slice(0, 4) === anchorISO.slice(0, 4);
  return true;
}
export const PERIODS = [
  { key: "daily", label: "Daily", tag: "Today" },
  { key: "weekly", label: "Weekly", tag: "This Week" },
  { key: "monthly", label: "Monthly", tag: "This Month" },
  { key: "annually", label: "Annually", tag: "This Year" },
  { key: "all", label: "All Time", tag: "All Time" },
];
export function pad2(n) {
  return String(n).padStart(2, "0");
}
export function isoFromYMD(y, m, d) {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}
export function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}
export function stockStatus(p) {
  if (p.stock === 0) return { label: "Out of Stock", tone: "red" };
  if (p.stock <= p.min) return { label: "Low Stock", tone: "amber" };
  return { label: "In Stock", tone: "green" };
}
export function nextNumId(items) {
  // Base the id on the current timestamp (plus a small random tail)
  // instead of a plain sequential counter, so ids stay unique even
  // across a factory reset or a restored backup, while still
  // guaranteeing it's larger than anything already in the list.
  const maxExisting = items.length ? Math.max(...items.map((i) => i.id)) : 0;
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  return Math.max(candidate, maxExisting + 1);
}
// Human-facing reference numbers (SO-1042, INV-2461, PO-4000, TXN-8821,
// DR-1000, USE-1000): the highest number in the given list, plus one.
export function nextSeqId(items, field, prefix, start = 1000, pad = 0) {
  const nums = items
    .map((i) => parseInt(String(i[field] || "").replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : start;
  const next = max + 1;
  return prefix + (pad ? String(next).padStart(pad, "0") : next);
}
export function rangePresets() {
  const t = todayISO();
  const y = t.slice(0, 4),
    m = t.slice(0, 7);
  const weekStart = localISO(new Date(new Date(t + "T00:00:00").getTime() - 6 * 86400000));
  return [
    { label: "Today", from: t, to: t },
    { label: "Last 7 days", from: weekStart, to: t },
    { label: "This month", from: `${m}-01`, to: t },
    { label: "This year", from: `${y}-01-01`, to: t },
  ];
}
export function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
// Saves text as a file through a temporary download link.
export function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =====================================================================
   REPORT EXPORTS — CSV download and a printable (Save as PDF) page
===================================================================== */
// How a report cell is written out: amounts to the cent, blanks for null.
const cellText = (v) => (typeof v === "number" ? round2(v) : (v ?? ""));
export function downloadCSV(filename, rows) {
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cellText(cell)).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadFile(filename, csv, "text/csv;charset=utf-8;");
}
export function exportPDF(title, headers, rows) {
  const win = window.open("", "_blank");
  if (!win) return;
  const esc = (v) => escapeHtml(cellText(v));
  const html = `<!doctype html><html><head><title>${esc(title)}</title>
<style>
body{font-family:Inter,system-ui,sans-serif;padding:24px;color:#0f172a;}
h1{font-size:18px;margin-bottom:4px;}
p{color:#64748b;font-size:12px;margin-top:0;}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px;}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;}
th{background:#f1f5f9;font-weight:600;}
</style></head><body>
<h1>${esc(title)}</h1>
<p>Generated ${esc(fmtDate(todayISO()))}</p>
<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}
