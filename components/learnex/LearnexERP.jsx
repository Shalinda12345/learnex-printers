import { useState, useEffect } from "react";
import { Accounting } from "@/components/learnex/modules/Accounting";
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  Package,
  Printer,
  ReceiptText,
  Route,
  Search,
  Settings,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Wallet,
  X,
} from "@/components/learnex/icons";
import { setCurrencySymbol } from "@/lib/learnex/utils";
import { CashAccounts } from "@/components/learnex/modules/CashAccounts";
import { Customers } from "@/components/learnex/modules/Customers";
import { Dashboard } from "@/components/learnex/modules/Dashboard";
import { DeliveryStock } from "@/components/learnex/modules/DeliveryStock";
import { Inventory } from "@/components/learnex/modules/Inventory";
import { LEGACY_PURCHASES_CASH_ID, MAIN_CASH_ID, SEED_CASH_ACCOUNTS } from "@/lib/learnex/accounting";
import { POS } from "@/components/learnex/modules/POS";
import { Purchases } from "@/components/learnex/modules/Purchases";
import { RawMaterials } from "@/components/learnex/modules/RawMaterials";
import { Reports } from "@/components/learnex/modules/Reports";
import {
  SEED_CUSTOMERS,
  SEED_LEDGER,
  SEED_PRODUCTS,
  SEED_PURCHASE_ORDERS,
  SEED_RAW_MATERIALS,
  SEED_RAW_MATERIAL_USAGE,
  SEED_SALES_ORDERS,
  SEED_SETTINGS,
  SEED_SUPPLIERS,
  SEED_USERS,
} from "@/lib/learnex/seed";
import { SalesOrders } from "@/components/learnex/modules/SalesOrders";
import { Modal, SaveStatusBadge } from "@/components/learnex/ui";
import { SettingsPage } from "@/components/learnex/modules/SettingsPage";
import { Suppliers } from "@/components/learnex/modules/Suppliers";
import { downloadBackup } from "@/lib/learnex/backup";
import { canWrite, usePersistentState } from "@/lib/learnex/persistence";
import { PasswordChangeForm } from "@/components/learnex/AuthScreens";
import { SCREEN_PERMISSIONS } from "@/lib/auth/permissions";

/* =====================================================================
   APP ROOT
===================================================================== */
export function LearnexERP({ auth }) {
  // Screens this user's roles allow (the server enforces the same rules on every save).
  const canOpen = (key) => (SCREEN_PERMISSIONS[key] || []).some(auth.can);
  const [view, setView] = useState(() => Object.keys(SCREEN_PERMISSIONS).find(canOpen) || null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [dark, setDark] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState(null);
  // ---- global persisted data stores ----
  const [products, setProducts] = usePersistentState("products", SEED_PRODUCTS);
  const [customers, setCustomers] = usePersistentState("customers", SEED_CUSTOMERS);
  const [suppliers, setSuppliers] = usePersistentState("suppliers", SEED_SUPPLIERS);
  const [salesOrders, setSalesOrders] = usePersistentState("salesOrders", SEED_SALES_ORDERS);
  const [purchaseOrders, setPurchaseOrders] = usePersistentState("purchaseOrders", SEED_PURCHASE_ORDERS);
  const [rawMaterials, setRawMaterials] = usePersistentState("rawMaterials", SEED_RAW_MATERIALS);
  const [rawMaterialUsage, setRawMaterialUsage] = usePersistentState(
    "rawMaterialUsage",
    SEED_RAW_MATERIAL_USAGE,
  );
  const [deliveryRuns, setDeliveryRuns] = usePersistentState("deliveryRuns", []);
  const [ledger, setLedger] = usePersistentState("ledger", SEED_LEDGER);
  const [cashAccounts, setCashAccounts] = usePersistentState("cashAccounts", SEED_CASH_ACCOUNTS);
  const [settings, setSettings] = usePersistentState("settings", SEED_SETTINGS);
  const [users, setUsers] = usePersistentState("users", SEED_USERS);
  setCurrencySymbol((settings.currency.match(/\(([^)]+)\)/) || [, "Rs."])[1]);
  // Self-heal: make sure the built-in cash accounts always exist, even for a
  // browser that already has saved data from before the accounting upgrade.
  // Nothing existing is modified — only missing accounts are added.
  useEffect(() => {
    if (!canWrite("cashAccounts")) return;
    const missing = SEED_CASH_ACCOUNTS.filter((s) => !(cashAccounts || []).some((a) => a.id === s.id));
    if (missing.length) setCashAccounts((prev) => [...missing, ...(prev || [])]);
  }, [cashAccounts, setCashAccounts]);
  // Raw materials are always bought with ordinary cash, so the separate
  // purchase account has been retired. Any movement that was posted to it is
  // moved onto the Cash Account. Amounts, dates and descriptions are all kept
  // exactly as they were — only the account they sit in changes, so the totals
  // and the profit figure do not move.
  useEffect(() => {
    if (!canWrite("cashAccounts")) return;
    if ((cashAccounts || []).some((a) => a.id === LEGACY_PURCHASES_CASH_ID))
      setCashAccounts((prev) => (prev || []).filter((a) => a.id !== LEGACY_PURCHASES_CASH_ID));
  }, [cashAccounts, setCashAccounts]);
  useEffect(() => {
    if (!canWrite("ledger")) return;
    if ((ledger || []).some((t) => t.account === LEGACY_PURCHASES_CASH_ID))
      setLedger((prev) =>
        (prev || []).map((t) =>
          t.account === LEGACY_PURCHASES_CASH_ID ? { ...t, account: MAIN_CASH_ID } : t,
        ),
      );
  }, [ledger, setLedger]);
  useEffect(() => {
    if (!canWrite("purchaseOrders")) return;
    if ((purchaseOrders || []).some((o) => o.cashAccount === LEGACY_PURCHASES_CASH_ID))
      setPurchaseOrders((prev) =>
        (prev || []).map((o) =>
          o.cashAccount === LEGACY_PURCHASES_CASH_ID ? { ...o, cashAccount: MAIN_CASH_ID } : o,
        ),
      );
  }, [purchaseOrders, setPurchaseOrders]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const bg = dark ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardBg = dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100";
  const subText = dark ? "text-slate-400" : "text-slate-500";
  const hoverRow = dark ? "hover:bg-slate-800/60" : "hover:bg-slate-50";
  const inputBg = dark
    ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500"
    : "bg-white border-slate-200 text-slate-900 placeholder-slate-400";
  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "pos", label: "Point of Sale", icon: ShoppingCart },
    { key: "inventory", label: "Products & Inventory", icon: Package },
    { key: "sales", label: "Sales Orders", icon: FileText },
    { key: "purchases", label: "Purchases", icon: ClipboardList },
    { key: "rawmaterials", label: "Raw Materials", icon: Layers },
    { key: "delivery", label: "Delivery Stock", icon: Route },
    { key: "customers", label: "Customers", icon: Users },
    { key: "suppliers", label: "Suppliers", icon: Truck },
    { key: "cash", label: "Cash & Bank", icon: Wallet },
    { key: "accounting", label: "Accounting", icon: ReceiptText },
    { key: "reports", label: "Reports", icon: BarChart3 },
    { key: "settings", label: "Settings", icon: Settings },
  ].filter((item) => canOpen(item.key));
  const theme = { dark, cardBg, subText, hoverRow, inputBg };
  const store = {
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
    settings,
    setSettings,
    users,
    setUsers,
  };
  // The signed-in account (the old "users" list is no longer who is using the app).
  const currentUser = {
    name: auth.user.name,
    username: auth.user.username,
    role: auth.user.roles.map((r) => r.name).join(", "),
  };
  const helpers = { setToast, currentUser, auth };
  const currentUserInitials =
    currentUser.name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "U";
  return (
    <div
      className={`min-h-screen w-full ${bg} font-sans transition-colors duration-300`}
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      <div className="flex h-screen overflow-hidden">
        <aside
          className={`${sidebarOpen ? "w-64" : "w-[76px]"} ${dark ? "bg-slate-900 border-slate-800" : "bg-[#1E293B] border-slate-800"} border-r transition-all duration-300 flex flex-col shrink-0`}
        >
          <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-700/50">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/40">
              <Printer size={18} className="text-white" />
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-white font-semibold text-sm leading-tight truncate">LEARNEX</p>
                <p className="text-slate-400 text-[11px] leading-tight truncate">
                  {"Printers & Distributors"}
                </p>
              </div>
            )}
          </div>
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${active ? "bg-blue-600 text-white shadow-md shadow-blue-900/30" : "text-slate-300 hover:bg-slate-800"}`}
                >
                  <Icon size={18} className="shrink-0" />
                  {sidebarOpen && <span className="truncate flex-1 text-left">{item.label}</span>}
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-slate-700/50">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800 text-sm"
            >
              <Menu size={18} />
              {sidebarOpen && <span>Collapse</span>}
            </button>
          </div>
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          <header
            className={`h-16 flex items-center justify-between px-6 border-b ${dark ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-white"} shrink-0`}
          >
            <div className="flex items-center gap-3 flex-1 max-w-md">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full ${inputBg}`}>
                <Search size={16} className={subText} />
                <input
                  placeholder="Search products, invoices, customers..."
                  className="bg-transparent outline-none text-sm w-full"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <SaveStatusBadge />
              {auth.can("data.backup") && (
                <button
                  onClick={() => downloadBackup(store, setToast)}
                  title="Download a full backup of everything in the system as one file"
                  className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-xl border transition-colors ${dark ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">Backup</span>
                </button>
              )}
              <button
                onClick={() => setDark((d) => !d)}
                className={`w-9 h-9 rounded-xl border flex items-center justify-center ${dark ? "border-slate-700 text-amber-300" : "border-slate-200 text-slate-600"}`}
              >
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <div className="relative pl-3 border-l border-slate-200/20">
                <button
                  onClick={() => setUserMenuOpen((o) => !o)}
                  title="Account"
                  className="flex items-center gap-2 bg-transparent text-left cursor-pointer"
                  style={{ border: "none", padding: 0, color: "inherit", font: "inherit" }}
                >
                  <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                    {currentUserInitials}
                  </div>
                  {sidebarOpen && (
                    <div className="hidden sm:block">
                      <p className="text-sm font-medium leading-tight">{currentUser.name}</p>
                      <p className={`text-xs ${subText} leading-tight`}>{currentUser.role}</p>
                    </div>
                  )}
                </button>
                {userMenuOpen && (
                  <div
                    className={`rounded-xl border shadow-lg z-50 p-2 ${cardBg}`}
                    style={{ position: "absolute", right: 0, top: "calc(100% + 10px)", width: 230 }}
                  >
                    <div className={`px-3 py-2 border-b ${dark ? "border-slate-800" : "border-slate-100"}`}>
                      <p className="text-sm font-medium truncate">{currentUser.name}</p>
                      <p className={`text-xs ${subText} truncate`}>
                        {"@"}
                        {currentUser.username}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setChangingPassword(true);
                      }}
                      className={`w-full text-left px-3 py-2 mt-1 rounded-lg text-sm bg-transparent ${hoverRow}`}
                      style={{ border: "none", color: "inherit", cursor: "pointer" }}
                    >
                      Change password
                    </button>
                    <button
                      onClick={() => auth.signOut()}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-600 bg-transparent hover:bg-red-50"
                      style={{ border: "none", cursor: "pointer" }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            {!view && (
              <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm max-w-xl`}>
                <h3 className="font-semibold mb-1">No access yet</h3>
                <p className={`text-sm ${subText}`}>
                  Your account doesn&apos;t have any roles that open a part of the system. Ask the owner or an
                  administrator to give you a role.
                </p>
              </div>
            )}
            {view === "dashboard" && <Dashboard {...theme} {...store} />}
            {view === "pos" && <POS {...theme} {...store} {...helpers} />}
            {view === "inventory" && <Inventory {...theme} {...store} {...helpers} />}
            {view === "sales" && <SalesOrders {...theme} {...store} {...helpers} />}
            {view === "purchases" && <Purchases {...theme} {...store} {...helpers} />}
            {view === "rawmaterials" && <RawMaterials {...theme} {...store} {...helpers} />}
            {view === "delivery" && <DeliveryStock {...theme} {...store} {...helpers} />}
            {view === "customers" && <Customers {...theme} {...store} {...helpers} />}
            {view === "suppliers" && <Suppliers {...theme} {...store} {...helpers} />}
            {view === "cash" && <CashAccounts {...theme} {...store} {...helpers} />}
            {view === "accounting" && <Accounting {...theme} {...store} {...helpers} />}
            {view === "reports" && <Reports {...theme} {...store} {...helpers} />}
            {view === "settings" && <SettingsPage {...theme} {...store} {...helpers} />}
          </main>
        </div>
      </div>
      {changingPassword && (
        <Modal
          title="Change your password"
          onClose={() => setChangingPassword(false)}
          cardBg={cardBg}
          dark={dark}
        >
          <div className="p-5">
            <PasswordChangeForm
              onDone={() => {
                setChangingPassword(false);
                setToast("Password changed. Any other devices you were signed in on have been signed out.");
              }}
            />
          </div>
        </Modal>
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50" style={{ animation: "fadein .2s ease-out" }}>
          <div className="bg-slate-900 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 max-w-sm border border-slate-700">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p className="text-sm">{toast}</p>
            <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white ml-2">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
