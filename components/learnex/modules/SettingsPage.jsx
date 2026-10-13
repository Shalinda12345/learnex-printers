import { useState } from "react";
import { Toggle } from "@/components/learnex/ui";
import { Building2, Download, Save, Trash2 } from "@/components/learnex/icons";
import { resetAllData } from "@/lib/learnex/persistence";
import { downloadBackup, restoreFromBackup } from "@/lib/learnex/backup";
import { UsersAndRoles } from "@/components/learnex/modules/UsersAndRoles";
import { ActivityLog } from "@/components/learnex/modules/ActivityLog";

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
  auth,
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
  const tabs = [
    { key: "business", label: "Business Profile", allowed: auth.can("settings.manage") },
    { key: "users", label: "Users & Roles", allowed: auth.can("users.manage") || auth.can("roles.manage") },
    { key: "notifications", label: "Notifications", allowed: auth.can("settings.manage") },
    {
      key: "data",
      label: "Data & Backup",
      allowed: auth.can("data.backup") || auth.can("data.restore") || auth.can("data.reset"),
    },
    { key: "activity", label: "Activity Log", allowed: auth.can("audit.view") },
  ].filter((t) => t.allowed);
  const [tab, setTab] = useState(() => (tabs[0] ? tabs[0].key : null));
  const [form, setForm] = useState(settings);
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
        <UsersAndRoles
          auth={auth}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
          hoverRow={hoverRow}
          setToast={setToast}
        />
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
              Your data is stored in the MySQL database on the server running this app, not in this
              browser. Changes are saved automatically as you work; the status badge in the top bar shows
              whether your latest changes have been saved.
            </p>
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
            <h3 className="font-semibold mb-1">Database</h3>
            <p className={`text-sm ${subText}`}>
              Every module — products, orders, purchases, deliveries, customers, suppliers, the ledger, cash
              accounts, settings and users — is kept in its own table in MySQL. Back the database up
              regularly (for example with mysqldump), and download a backup file below as an extra copy.
            </p>
          </div>
          {auth.can("data.backup") && (
            <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
              <h3 className="font-semibold mb-1">Download Backup</h3>
              <p className={`text-sm ${subText}`}>
                Saves every product, order, customer, supplier, ledger entry and setting into one file on your
                device. It opens directly in any browser so you can read your data even without the app, and
                can be re-uploaded below to restore everything exactly as it was.
              </p>
              <button
                onClick={() => downloadBackup(backupStore, setToast)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
              >
                <Download size={15} />
                {" Download Backup"}
              </button>
            </div>
          )}
          {auth.can("data.restore") && (
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
          )}
          {auth.can("data.reset") && (
            <>
              <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm space-y-3`}>
                <h3 className="font-semibold mb-1">Clear a Specific Module</h3>
                <p className={`text-sm ${subText} mb-2`}>
                  Delete all records in just one module. Every other module — including settings and users —
                  is left exactly as it is.
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
                  This clears absolutely everything — every module above, plus the business settings — and
                  restores the original demo data. Staff accounts, roles and the activity log are kept. Prefer
                  the module-specific clearing above unless you really want to start over completely.
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
            </>
          )}
        </div>
      )}
      {tab === "activity" && (
        <ActivityLog dark={dark} cardBg={cardBg} subText={subText} inputBg={inputBg} hoverRow={hoverRow} />
      )}
    </div>
  );
}
