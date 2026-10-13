import React, { useState } from "react";
import { Badge, Toggle } from "@/components/learnex/ui";
import {
  Building2,
  Download,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "@/components/learnex/icons";
import { resetAllData } from "@/lib/learnex/persistence";
import { downloadBackup, restoreFromBackup } from "@/lib/learnex/backup";

/* =====================================================================
   SETTINGS
===================================================================== */
export function SettingsPage({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  settings,
  setSettings,
  users,
  setUsers,
  products,
  setProducts,
  customers,
  setCustomers,
  suppliers,
  setSuppliers,
  salesOrders,
  setSalesOrders,
  purchaseOrders,
  setPurchaseOrders,
  rawMaterials,
  setRawMaterials,
  rawMaterialUsage,
  setRawMaterialUsage,
  deliveryRuns,
  setDeliveryRuns,
  ledger,
  setLedger,
  cashAccounts,
  setCashAccounts,
}) {
  const backupStore = {
    products,
    customers,
    suppliers,
    salesOrders,
    purchaseOrders,
    rawMaterials,
    rawMaterialUsage,
    deliveryRuns,
    ledger,
    cashAccounts,
    settings,
    users,
  };
  const [tab, setTab] = useState("business");
  const [form, setForm] = useState(settings);
  const [renaming, setRenaming] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  function startRename(u) {
    setRenaming(u.email);
    setNameDraft(u.name);
  }
  function saveRename(email) {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setToast("Name cannot be empty.");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, name: trimmed } : u)));
    setRenaming(null);
    setToast("User name updated.");
  }
  function deleteUser(u) {
    if (users.length <= 1) {
      setToast("You can't delete the last remaining user.");
      return;
    }
    if (!window.confirm(`Remove "${u.name}" (${u.email}) from Users & Roles? This cannot be undone.`)) return;
    setUsers((prev) => prev.filter((x) => x.email !== u.email));
    setToast(`${u.name} removed.`);
  }
  const tabs = [
    { key: "business", label: "Business Profile" },
    { key: "users", label: "Users & Roles" },
    { key: "notifications", label: "Notifications" },
    { key: "data", label: "Data & Backup" },
  ];
  function saveChanges() {
    setSettings(form);
    setToast("Settings saved.");
  }
  const clearableModules = [
    { key: "products", label: "Products & Inventory", count: products.length, action: () => setProducts([]) },
    {
      key: "rawMaterials",
      label: "Raw Materials",
      count: rawMaterials.length,
      action: () => setRawMaterials([]),
    },
    {
      key: "rawMaterialUsage",
      label: "Raw Material Usage History",
      count: rawMaterialUsage.length,
      action: () => setRawMaterialUsage([]),
    },
    {
      key: "purchaseOrders",
      label: "Purchase Orders",
      count: purchaseOrders.length,
      action: () => setPurchaseOrders([]),
    },
    {
      key: "salesOrders",
      label: "Sales Orders",
      count: salesOrders.length,
      action: () => setSalesOrders([]),
    },
    {
      key: "deliveryRuns",
      label: "Delivery Runs",
      count: deliveryRuns.length,
      action: () => setDeliveryRuns([]),
    },
    { key: "customers", label: "Customers", count: customers.length, action: () => setCustomers([]) },
    { key: "suppliers", label: "Suppliers", count: suppliers.length, action: () => setSuppliers([]) },
    { key: "ledger", label: "Accounting Ledger", count: ledger.length, action: () => setLedger([]) },
  ];
  function clearModule(m) {
    if (
      !window.confirm(
        `Delete all ${m.count} record(s) in "${m.label}"? Everything else in the system will be left untouched. This cannot be undone.`,
      )
    )
      return;
    m.action();
    setToast(`${m.label} cleared — all other data was left untouched.`);
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className={`text-sm ${subText}`}>Manage your business profile, users and preferences</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === t.key ? "bg-blue-600 text-white" : `border ${dark ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "business" && (
        <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm max-w-2xl space-y-5`}>
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={16} className={subText} />
            <h3 className="font-semibold">Business Profile</h3>
          </div>
          <div>
            <label className={`text-xs font-medium ${subText}`}>Business Name</label>
            <input
              value={form.businessName}
              onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
              className={`mt-1.5 w-full px-3 py-2.5 rounded-xl border text-sm ${inputBg}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={`text-xs font-medium ${subText}`}>Default Tax Rate (%)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.taxRate}
                onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))}
                className={`mt-1.5 w-full px-3 py-2.5 rounded-xl border text-sm ${inputBg}`}
              />
            </div>
            <div>
              <label className={`text-xs font-medium ${subText}`}>Opening Capital</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={form.openingCapital === undefined ? "" : form.openingCapital}
                onChange={(e) => setForm((f) => ({ ...f, openingCapital: e.target.value }))}
                className={`mt-1.5 w-full px-3 py-2.5 rounded-xl border text-sm ${inputBg}`}
                placeholder="0.00"
              />
              <p className={`text-xs ${subText} mt-1`}>
                The owner&apos;s capital already in the business. Shown under Equity on the Statement of
                Financial Position.
              </p>
            </div>
            <div>
              <label className={`text-xs font-medium ${subText}`}>Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className={`mt-1.5 w-full px-3 py-2.5 rounded-xl border text-sm ${inputBg}`}
              >
                <option>LKR (Rs.)</option>
                <option>USD ($)</option>
                <option>{"INR (\u20B9)"}</option>
              </select>
            </div>
          </div>
          <button
            onClick={saveChanges}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
          >
            <Save size={15} />
            {" Save Changes"}
          </button>
        </div>
      )}
      {tab === "users" && (
        <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
          <div className="flex items-center justify-between p-5">
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldCheck size={16} className={subText} />
              {" Users & Roles"}
            </h3>
            <button
              onClick={() =>
                setToast(
                  "Multi-user login requires a backend/server and isn't included in this local single-user build.",
                )
              }
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3.5 py-2 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
            >
              <UserPlus size={14} />
              {" Invite User"}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-2 px-5">Name</th>
                <th className="font-medium py-2 px-2">Email</th>
                <th className="font-medium py-2 px-2">Role</th>
                <th className="font-medium py-2 px-2">Status</th>
                <th className="font-medium py-2 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isEditing = renaming === u.email;
                return (
                  <tr
                    key={u.email}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                  >
                    <td className="py-3 px-5 font-medium">
                      {isEditing ? (
                        <input
                          autoFocus={true}
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(u.email);
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          className={`w-full px-2 py-1 rounded-lg border text-sm ${inputBg}`}
                        />
                      ) : (
                        u.name
                      )}
                    </td>
                    <td className={`py-3 px-2 ${subText}`}>{u.email}</td>
                    <td className="py-3 px-2">{u.role}</td>
                    <td className="py-3 px-2">
                      <Badge tone={u.status === "Active" ? "green" : "amber"}>{u.status}</Badge>
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <React.Fragment>
                            <button
                              onClick={() => saveRename(u.email)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-emerald-600 hover:bg-emerald-50"
                            >
                              <Save size={13} />
                            </button>
                            <button
                              onClick={() => setRenaming(null)}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`}
                            >
                              <X size={13} />
                            </button>
                          </React.Fragment>
                        ) : (
                          <React.Fragment>
                            <button
                              onClick={() => startRename(u)}
                              className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteUser(u)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                            >
                              <Trash2 size={13} />
                            </button>
                          </React.Fragment>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tab === "notifications" && (
        <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm max-w-xl space-y-5`}>
          <h3 className="font-semibold mb-1">Notification Preferences</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Low stock alerts</p>
              <p className={`text-xs ${subText}`}>
                Notify when a product falls at or below its reorder point.
              </p>
            </div>
            <Toggle
              on={form.notifLowStock}
              onClick={() => setForm((f) => ({ ...f, notifLowStock: !f.notifLowStock }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Overdue invoice alerts</p>
              <p className={`text-xs ${subText}`}>Notify when a customer payment becomes overdue.</p>
            </div>
            <Toggle
              on={form.notifOverdue}
              onClick={() => setForm((f) => ({ ...f, notifOverdue: !f.notifOverdue }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Daily summary email</p>
              <p className={`text-xs ${subText}`}>
                Receive a daily digest of sales, expenses and stock movement.
              </p>
            </div>
            <Toggle
              on={form.notifDaily}
              onClick={() => setForm((f) => ({ ...f, notifDaily: !f.notifDaily }))}
            />
          </div>
          <button
            onClick={saveChanges}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
          >
            <Save size={15} />
            {" Save Preferences"}
          </button>
        </div>
      )}
      {tab === "data" && (
        <div className="space-y-4 max-w-2xl">
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-4`}>
            <h3 className="font-semibold mb-1">{"Data & Backup"}</h3>
            <p className={`text-sm ${subText}`}>
              Your data is stored in the PostgreSQL database on the server running this app, not in this
              browser. Changes are saved automatically as you work; the status badge in the top bar shows
              whether your latest changes have been saved.
            </p>
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
            <h3 className="font-semibold mb-1">Database</h3>
            <p className={`text-sm ${subText}`}>
              Every module — products, orders, purchases, deliveries, customers, suppliers, the ledger, cash
              accounts, settings and users — is kept in its own table in PostgreSQL. Back the database up
              regularly (for example with pg_dump), and download a backup file below as an extra copy.
            </p>
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
            <h3 className="font-semibold mb-1">Download Backup</h3>
            <p className={`text-sm ${subText}`}>
              Saves every product, order, customer, supplier, ledger entry and setting into one file on your
              device. It opens directly in any browser so you can read your data even without the app, and can
              be re-uploaded below to restore everything exactly as it was.
            </p>
            <button
              onClick={() => downloadBackup(backupStore, setToast)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
            >
              <Download size={15} />
              {" Download Backup"}
            </button>
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
            <h3 className="font-semibold mb-1">Restore from Backup</h3>
            <p className={`text-sm ${subText}`}>
              Choose a backup file downloaded from this app. Every module the file contains will completely
              replace what&apos;s currently in the system, and is saved to the database straight away. Use
              this to recover from a mistake or to move data over from another installation.
            </p>
            <input
              type="file"
              accept=".html,.json"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                if (
                  !window.confirm(
                    `Restore from "${file.name}"?\n\nThis will replace products, customers, suppliers, sales orders, purchase orders, raw materials, delivery runs, the ledger, cash accounts, settings and users with what's in this file. This cannot be undone.`,
                  )
                ) {
                  e.target.value = "";
                  return;
                }
                restoreFromBackup(
                  file,
                  {
                    products: setProducts,
                    customers: setCustomers,
                    suppliers: setSuppliers,
                    salesOrders: setSalesOrders,
                    purchaseOrders: setPurchaseOrders,
                    rawMaterials: setRawMaterials,
                    rawMaterialUsage: setRawMaterialUsage,
                    deliveryRuns: setDeliveryRuns,
                    ledger: setLedger,
                    cashAccounts: setCashAccounts,
                    settings: setSettings,
                    users: setUsers,
                  },
                  setToast,
                );
                e.target.value = "";
              }}
              className={`block w-full text-sm rounded-xl border p-2.5 ${inputBg}`}
            />
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
            <h3 className="font-semibold mb-1">Clear a Specific Module</h3>
            <p className={`text-sm ${subText} mb-2`}>
              Delete all records in just one module. Every other module — including settings and users — is
              left exactly as it is.
            </p>
            <div className="space-y-2">
              {clearableModules.map((m) => (
                <div
                  key={m.key}
                  className={`flex items-center justify-between rounded-xl border p-3 ${dark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <div>
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className={`text-xs ${subText}`}>
                      {m.count}
                      {" record(s)"}
                    </p>
                  </div>
                  <button
                    onClick={() => clearModule(m)}
                    disabled={m.count === 0}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 size={13} />
                    {" Clear"}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
            <h3 className="font-semibold mb-1 text-red-600">Factory Reset</h3>
            <p className={`text-sm ${subText}`}>
              This clears absolutely everything — every module above, plus settings and users — and restores
              the original demo data. Prefer the module-specific clearing above unless you really want to
              start over completely.
            </p>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "This will permanently delete ALL data in every module — products, raw materials, purchases, sales, deliveries, customers, suppliers, ledger, settings and users — and restore the original demo data. This cannot be undone. Continue?",
                  )
                )
                  resetAllData();
              }}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-red-900/20 transition-colors"
            >
              <Trash2 size={15} />
              {" Factory Reset Everything"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
