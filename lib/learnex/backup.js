import { escapeHtml as esc, downloadFile, localISO, pad2 } from "@/lib/learnex/utils";

/* =====================================================================
   FULL-SYSTEM BACKUP / RESTORE
   Everything below builds one self-contained .html file that is BOTH:
   1) readable on its own — opening it in any browser (no internet, no
      app needed) shows every record in plain tables, so it's still
      useful even if you've lost access to everything else, and
   2) restorable — the same file can be re-uploaded from Settings to put
      every module back exactly as it was, because the raw data is
      embedded inside it as JSON the app can read back out.
   It is deliberately independent of the database, so a downloaded copy
   survives the database (or the server it runs on) failing.
===================================================================== */

export const BACKUP_MODULES = [
  { key: "products", label: "Products & Inventory" },
  { key: "customers", label: "Customers" },
  { key: "suppliers", label: "Suppliers" },
  { key: "salesOrders", label: "Sales Orders" },
  { key: "purchaseOrders", label: "Purchase Orders" },
  { key: "rawMaterials", label: "Raw Materials" },
  { key: "rawMaterialUsage", label: "Raw Material Usage" },
  { key: "deliveryRuns", label: "Delivery Runs" },
  { key: "ledger", label: "Accounting Ledger" },
  { key: "cashAccounts", label: "Cash & Bank Accounts" },
  { key: "settings", label: "Business Settings" },
  { key: "users", label: "Users & Roles" },
];
// A plain-object row -> one <tr>. Nested arrays/objects (line items,
// payment history, etc.) are shown compactly as JSON text so nothing is
// silently dropped from the human-readable view, even fields the table
// columns below don't call out by name.
export function backupRowToHTML(row) {
  return (
    "<tr>" +
    Object.keys(row)
      .map((k) => {
        const v = row[k];
        const text = v && typeof v === "object" ? JSON.stringify(v) : v;
        return `<td>${esc(text)}</td>`;
      })
      .join("") +
    "</tr>"
  );
}
export function backupTableHTML(label, items) {
  if (!items || !items.length) {
    return `<h2>${esc(label)}</h2><p class="empty">No records.</p>`;
  }
  const cols = Object.keys(items[0]);
  return `<h2>${esc(label)} <span class="count">(${items.length})</span></h2>
<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${items.map(backupRowToHTML).join("")}</tbody></table>`;
}
export function buildBackupHTML(store) {
  const now = new Date();
  const payload = {
    app: "LEARNEX ERP",
    backupVersion: 1,
    exportedAt: now.toISOString(),
    data: BACKUP_MODULES.reduce((o, m) => {
      o[m.key] = store[m.key];
      return o;
    }, {}),
  };
  const dateLabel = now.toLocaleString();
  const tables = BACKUP_MODULES.filter((m) => m.key !== "settings") // settings is one object, not a list — shown separately below
    .map((m) => backupTableHTML(m.label, store[m.key]))
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>LEARNEX ERP Backup — ${esc(dateLabel)}</title>
<style>
  body { font-family: -apple-system, Inter, system-ui, sans-serif; margin: 0; padding: 32px; color: #1e293b; background: #f8fafc; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  .notice { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 15px; margin-top: 32px; margin-bottom: 10px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
  .count { color: #94a3b8; font-weight: 400; font-size: 12px; }
  .empty { color: #94a3b8; font-size: 13px; font-style: italic; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; background: white; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  th { background: #f1f5f9; position: sticky; top: 0; }
  tbody tr:nth-child(even) { background: #fafbfc; }
</style>
</head>
<body>
<h1>LEARNEX ERP — Full Data Backup</h1>
<p class="subtitle">Exported ${esc(dateLabel)}</p>
<div class="notice">This file is a complete, self-contained backup. It's readable on its own in any browser, and can also be re-uploaded from <b>Settings &rarr; Data &amp; Backup &rarr; Restore</b> to put every module in the app back exactly as it was here. Keep it somewhere other than this computer alone (email it to yourself, cloud drive, USB) so a single hardware failure can't take out both the live data and the backup.</p>
<h2>Business Settings</h2>
<table><tbody>${Object.keys(store.settings || {})
    .map(
      (k) =>
        `<tr><td><b>${esc(k)}</b></td><td>${esc(typeof store.settings[k] === "object" ? JSON.stringify(store.settings[k]) : store.settings[k])}</td></tr>`,
    )
    .join("")}</tbody></table>
${tables}
<script type="application/json" id="learnex-backup-data">${
    // Every "<" is written as a JSON unicode escape (JSON.parse turns it back
    // into "<"), so text like "</script>" inside a record can't end this block.
    JSON.stringify(payload).replace(/</g, "\\u003c")
  }<\/script>
</body>
</html>`;
}
export function downloadBackup(store, setToast) {
  const now = new Date();
  const stamp = `${localISO(now)}_${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  downloadFile(`learnex_backup_${stamp}.html`, buildBackupHTML(store), "text/html;charset=utf-8;");
  if (setToast) setToast("Backup downloaded — keep it somewhere safe (email, cloud drive, USB).");
}
// Reads a backup .html file (or a raw .json export) back into { data, exportedAt }.
export function parseBackupFile(text) {
  // Preferred path: pull the embedded JSON out of the backup .html file.
  const m = text.match(/<script type="application\/json" id="learnex-backup-data">([\s\S]*?)<\/script>/);
  if (m) {
    const payload = JSON.parse(m[1]);
    if (!payload || !payload.data) throw new Error("This file doesn't look like a LEARNEX backup.");
    return payload;
  }
  // Fallback: a plain .json file containing either { data: {...} } or the data object itself.
  const parsed = JSON.parse(text);
  if (parsed && parsed.data) return parsed;
  if (parsed && (parsed.products || parsed.salesOrders || parsed.ledger))
    return { data: parsed, exportedAt: null };
  throw new Error("This file doesn't look like a LEARNEX backup.");
}
export function restoreFromBackup(file, setters, setToast) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = parseBackupFile(String(reader.result));
      const d = payload.data;
      BACKUP_MODULES.forEach((m) => {
        if (d[m.key] !== undefined) setters[m.key](d[m.key]);
      });
      const when = payload.exportedAt ? new Date(payload.exportedAt).toLocaleString() : "unknown date";
      setToast(
        `Backup restored (originally exported ${when}). Every module listed in the file has been replaced.`,
      );
    } catch (e) {
      console.error("Restore failed", e);
      setToast("Couldn't restore that file — it doesn't look like a valid LEARNEX backup.");
    }
  };
  reader.onerror = () => setToast("Couldn't read that file.");
  reader.readAsText(file);
}
