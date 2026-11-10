import { Component, useCallback, useEffect, useRef, useState } from "react";
import { Accounting } from "@/components/learnex/modules/Accounting";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Download,
  FileText,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Printer,
  ReceiptText,
  Route,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Wallet,
  X,
} from "@/components/learnex/icons";
import { CommandPalette, buildActions } from "@/components/learnex/CommandPalette";
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
import { Alert, EmptyState, Modal, SaveStatusBadge, ToastHost } from "@/components/learnex/ui";
import { SettingsPage } from "@/components/learnex/modules/SettingsPage";
import { Suppliers } from "@/components/learnex/modules/Suppliers";
import { downloadBackup } from "@/lib/learnex/backup";
import { canWrite, clearMergeNotice, peekMergeNotice, usePersistentState } from "@/lib/learnex/persistence";
import { TwoStepDialog } from "@/components/learnex/TwoStepDialog";
import { PasswordChangeForm } from "@/components/learnex/AuthScreens";
import { SCREEN_PERMISSIONS } from "@/lib/auth/permissions";

/* =====================================================================
   SMALL HELPERS
===================================================================== */
// Display preferences live in this browser only (not in the database).
const PREF_THEME = "learnex.theme";
const PREF_SIDEBAR = "learnex.sidebar";
function readPref(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

// The menu, in groups. Each screen only shows when the signed-in user's roles allow it.
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    items: [
      { key: "pos", label: "Point of Sale", icon: ShoppingCart },
      { key: "sales", label: "Sales Orders", icon: FileText },
      { key: "delivery", label: "Delivery Stock", icon: Route },
      { key: "customers", label: "Customers", icon: Users },
    ],
  },
  {
    label: "Stock & Purchasing",
    items: [
      { key: "inventory", label: "Products & Inventory", icon: Package },
      { key: "rawmaterials", label: "Raw Materials", icon: Layers },
      { key: "purchases", label: "Purchases", icon: ClipboardList },
      { key: "suppliers", label: "Suppliers", icon: Truck },
    ],
  },
  {
    label: "Finance",
    items: [
      { key: "cash", label: "Cash & Bank", icon: Wallet },
      { key: "accounting", label: "Accounting", icon: ReceiptText },
      { key: "reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [{ key: "settings", label: "Settings", icon: Settings }],
  },
];

/** If one screen throws while rendering, only that screen is replaced — the menu and everything else keep working. */
class ScreenBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("Screen crashed:", error);
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-xl">
        <Alert
          tone="error"
          title="This screen hit a problem"
          action={
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={this.props.onHome}>
                Go to the first screen
              </button>
            </div>
          }
        >
          Your data is safe — nothing was lost. Try again, or open another screen from the menu.
          <span className="block mt-1.5 text-xs opacity-75 break-words">{String(this.state.error?.message || "")}</span>
        </Alert>
      </div>
    );
  }
}

/* =====================================================================
   APP ROOT
===================================================================== */
export function LearnexERP({ auth }) {
  // Screens this user's roles allow (the server enforces the same rules on every save).
  const canOpen = (key) => (SCREEN_PERMISSIONS[key] || []).some(auth.can);
  const [view, setView] = useState(() => Object.keys(SCREEN_PERMISSIONS).find(canOpen) || null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [twoStepOpen, setTwoStepOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    const saved = readPref(PREF_THEME);
    if (saved) return saved === "dark";
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => readPref(PREF_SIDEBAR) !== "collapsed");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Set when a record is picked in the search box: the screen opens with that text already searched.
  const [searchSeed, setSearchSeed] = useState(null);
  // After a reload caused by a save conflict, the first message says what happened to the changes that were kept.
  const [toast, setToast] = useState(() => peekMergeNotice() || null);
  const userMenuRef = useRef(null);
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
  // The theme is also put on <html>, so the page edges, scrollbars and form controls follow it.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  const toggleTheme = useCallback(() => {
    setDark((d) => {
      writePref(PREF_THEME, d ? "light" : "dark");
      return !d;
    });
  }, []);
  const toggleSidebar = () =>
    setSidebarOpen((o) => {
      writePref(PREF_SIDEBAR, o ? "collapsed" : "open");
      return !o;
    });
  const closeToast = useCallback(() => setToast(null), []);
  useEffect(() => clearMergeNotice(), []);

  const bg = dark ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardBg = dark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200/80";
  const subText = dark ? "text-slate-400" : "text-slate-500";
  const hoverRow = dark ? "hover:bg-slate-800/60" : "hover:bg-slate-50";
  const inputBg = dark
    ? "bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-500"
    : "bg-white border-slate-200 text-slate-900 placeholder-slate-400";
  const navGroups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => canOpen(item.key)) })).filter(
    (g) => g.items.length,
  );
  const navItems = navGroups.flatMap((g) => g.items);
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

  // ---- navigation ----
  const go = useCallback((key) => {
    setView(key);
    setSearchSeed(null);
    setMobileNavOpen(false);
  }, []);
  const openRecord = useCallback((key, text) => {
    setView(key);
    setSearchSeed({ view: key, q: text, nonce: Date.now() });
    setMobileNavOpen(false);
  }, []);
  // The text a screen should start its search box with (empty unless a record was picked in the palette).
  const seedFor = (key) => (searchSeed && searchSeed.view === key ? searchSeed.q : "");
  const screenKey = (key) => (searchSeed && searchSeed.view === key ? key + searchSeed.nonce : key);
  const activeLabel = navItems.find((n) => n.key === view)?.label;
  const firstView = navItems[0]?.key || null;

  useEffect(() => {
    document.title = activeLabel ? activeLabel + " · LEARNEX ERP" : "LEARNEX ERP";
  }, [activeLabel]);

  // Ctrl/⌘+K or "/" opens the search; Escape closes the account menu and the mobile menu.
  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Escape") {
        setUserMenuOpen(false);
        setMobileNavOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  // A click anywhere outside the account menu closes it.
  useEffect(() => {
    if (!userMenuOpen) return;
    function onDown(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [userMenuOpen]);

  // Labels hide when the menu is collapsed to icons (desktop only; the phone drawer always shows them).
  const hideWhenCollapsed = sidebarOpen ? "" : "lg:hidden";
  const paletteActions = buildActions({
    dark,
    toggleTheme,
    canBackup: auth.can("data.backup"),
    backup: () => downloadBackup(store, setToast),
    changePassword: () => setChangingPassword(true),
    signOut: () => auth.signOut(),
  });

  return (
    <div className={"min-h-screen w-full " + bg + " font-sans transition-colors duration-300" + (dark ? " dark" : "")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-blue-600 focus:text-white focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <div className="flex h-screen overflow-hidden">
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[2px] lg:hidden animate-fade-in"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <aside
          aria-label="Main menu"
          className={
            "fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] lg:static lg:max-w-none lg:translate-x-0 " +
            (sidebarOpen ? "lg:w-64" : "lg:w-[76px]") +
            " bg-slate-900 border-r border-slate-800 transition-[transform,width] duration-300 flex flex-col shrink-0 " +
            (mobileNavOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full")
          }
        >
          <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-linear-to-br from-blue-500 to-blue-700 flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/40 ring-1 ring-white/10">
              <Printer size={18} className="text-white" />
            </div>
            <div className={"overflow-hidden flex-1 min-w-0 " + hideWhenCollapsed}>
              <p className="text-white font-semibold text-sm leading-tight truncate tracking-wide">LEARNEX</p>
              <p className="text-slate-400 text-[11px] leading-tight truncate">{"Printers & Distributors"}</p>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
              className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>
          <nav className="flex-1 py-3 px-3 overflow-y-auto" aria-label="Screens">
            {navGroups.map((group, gi) => (
              <div key={group.label} className={gi === 0 ? "" : "mt-4"}>
                <p
                  className={
                    "px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 " +
                    hideWhenCollapsed
                  }
                >
                  {group.label}
                </p>
                {!sidebarOpen && gi > 0 && <div className="hidden lg:block mx-3 mb-2 border-t border-slate-800" />}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = view === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => go(item.key)}
                        title={sidebarOpen ? undefined : item.label}
                        aria-current={active ? "page" : undefined}
                        className={
                          "group relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors " +
                          (active
                            ? "bg-blue-500/15 text-white ring-1 ring-inset ring-blue-400/20"
                            : "text-slate-300 hover:bg-white/5 hover:text-white")
                        }
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-blue-400" />
                        )}
                        <Icon
                          size={18}
                          className={"shrink-0 " + (active ? "text-blue-300" : "text-slate-400 group-hover:text-slate-200")}
                        />
                        <span className={"truncate flex-1 text-left " + hideWhenCollapsed}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="p-3 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Collapse" : "Expand menu"}
              title={sidebarOpen ? undefined : "Expand menu"}
              className="hidden lg:flex w-full items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors"
            >
              {sidebarOpen ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
              {sidebarOpen && <span>Collapse</span>}
            </button>
            <p className="lg:hidden px-3 py-1 text-[11px] text-slate-500">LEARNEX ERP</p>
          </div>
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          <header
            className={
              "h-16 flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-6 border-b shrink-0 " +
              (dark ? "border-slate-800 bg-slate-900" : "border-slate-200/80 bg-white")
            }
          >
            <h1 className="sr-only">LEARNEX ERP</h1>
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
                className={
                  "lg:hidden size-9 rounded-xl border flex items-center justify-center shrink-0 " +
                  (dark
                    ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50")
                }
              >
                <Menu size={17} />
              </button>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                title="Search the whole system (Ctrl+K or /)"
                className={
                  "field-shell flex items-center gap-2.5 px-3 h-10 rounded-xl border w-full min-w-0 max-w-md text-left text-sm transition-colors " +
                  (dark
                    ? "bg-slate-800/70 border-slate-700 text-slate-400 hover:border-slate-600"
                    : "bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-white")
                }
              >
                <Search size={16} className="shrink-0" />
                <span className="truncate flex-1 hidden sm:block">Search products, invoices, customers…</span>
                <span className="truncate flex-1 sm:hidden">Search…</span>
                <span className="kbd hidden md:inline-flex">Ctrl K</span>
              </button>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <SaveStatusBadge />
              {auth.can("data.backup") && (
                <button
                  onClick={() => downloadBackup(store, setToast)}
                  title="Download a full backup of everything in the system as one file"
                  className={
                    "hidden sm:flex items-center gap-2 text-xs font-medium px-3 h-9 rounded-xl border transition-colors " +
                    (dark
                      ? "border-slate-700 text-slate-200 hover:bg-slate-800"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50")
                  }
                >
                  <Download size={14} />
                  <span>Backup</span>
                </button>
              )}
              <button
                onClick={toggleTheme}
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                title={dark ? "Switch to light mode" : "Switch to dark mode"}
                className={
                  "w-9 h-9 rounded-xl border flex items-center justify-center transition-colors " +
                  (dark
                    ? "border-slate-700 text-amber-300 hover:bg-slate-800"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50")
                }
              >
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <div
                className={"relative pl-2 sm:pl-3 border-l " + (dark ? "border-slate-800" : "border-slate-200")}
                ref={userMenuRef}
              >
                <button
                  onClick={() => setUserMenuOpen((o) => !o)}
                  title="Account"
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                  className="flex items-center gap-2.5 text-left rounded-xl p-0.5 pr-1.5 sm:pr-2 transition-colors hover:bg-slate-500/10"
                >
                  <div className="w-9 h-9 rounded-xl bg-linear-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center text-sm font-semibold shrink-0 shadow-sm">
                    {currentUserInitials}
                  </div>
                  <div className="hidden md:block min-w-0 max-w-[10rem]">
                    <p className="text-sm font-medium leading-tight truncate">{currentUser.name}</p>
                    <p className={"text-xs leading-tight truncate " + subText}>{currentUser.role}</p>
                  </div>
                  <ChevronDown size={14} className={"hidden md:block shrink-0 " + subText} />
                </button>
                {userMenuOpen && (
                  <div
                    className={
                      "absolute right-0 top-[calc(100%+10px)] w-64 rounded-xl border shadow-lg z-50 p-1.5 animate-pop-in " +
                      cardBg
                    }
                  >
                    <div className={"px-3 py-2.5 border-b mb-1 " + (dark ? "border-slate-800" : "border-slate-100")}>
                      <p className="text-sm font-semibold truncate">{currentUser.name}</p>
                      <p className={"text-xs truncate " + subText}>
                        {"@"}
                        {currentUser.username}
                      </p>
                      <p className={"text-xs mt-1.5 flex items-center gap-1.5 " + subText}>
                        <ShieldCheck size={12} className="shrink-0" />
                        <span className="truncate">{currentUser.role || "No role"}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setChangingPassword(true);
                      }}
                      className={"w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm " + hoverRow}
                    >
                      <KeyRound size={15} className={subText} />
                      Change password
                    </button>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setTwoStepOpen(true);
                      }}
                      className={"w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm " + hoverRow}
                    >
                      <ShieldCheck size={15} className={subText} />
                      Two-step sign-in
                    </button>
                    <button
                      onClick={() => auth.signOut()}
                      className="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      <LogOut size={15} />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main
            id="main"
            tabIndex={-1}
            key={view}
            className="flex-1 overflow-y-auto p-3 sm:p-6 outline-none animate-screen-in"
          >
            <ScreenBoundary resetKey={view} onHome={() => go(firstView)}>
              {!view && (
                <div className={"rounded-2xl border p-6 " + cardBg + " shadow-sm max-w-xl"}>
                  <EmptyState icon={AlertTriangle} title="No access yet" subText={subText}>
                    Your account doesn&apos;t have any roles that open a part of the system. Ask the owner or an
                    administrator to give you a role.
                  </EmptyState>
                </div>
              )}
              {view === "dashboard" && <Dashboard {...theme} {...store} currentUser={currentUser} />}
              {view === "pos" && (
                <POS key={screenKey("pos")} seed={seedFor("pos")} {...theme} {...store} {...helpers} />
              )}
              {view === "inventory" && (
                <Inventory
                  key={screenKey("inventory")}
                  seed={seedFor("inventory")}
                  {...theme}
                  {...store}
                  {...helpers}
                />
              )}
              {view === "sales" && (
                <SalesOrders
                  key={screenKey("sales")}
                  seed={seedFor("sales")}
                  {...theme}
                  {...store}
                  {...helpers}
                />
              )}
              {view === "purchases" && (
                <Purchases
                  key={screenKey("purchases")}
                  seed={seedFor("purchases")}
                  {...theme}
                  {...store}
                  {...helpers}
                />
              )}
              {view === "rawmaterials" && (
                <RawMaterials
                  key={screenKey("rawmaterials")}
                  seed={seedFor("rawmaterials")}
                  {...theme}
                  {...store}
                  {...helpers}
                />
              )}
              {view === "delivery" && <DeliveryStock {...theme} {...store} {...helpers} />}
              {view === "customers" && (
                <Customers
                  key={screenKey("customers")}
                  seed={seedFor("customers")}
                  {...theme}
                  {...store}
                  {...helpers}
                />
              )}
              {view === "suppliers" && (
                <Suppliers
                  key={screenKey("suppliers")}
                  seed={seedFor("suppliers")}
                  {...theme}
                  {...store}
                  {...helpers}
                />
              )}
              {view === "cash" && <CashAccounts {...theme} {...store} {...helpers} />}
              {view === "accounting" && <Accounting {...theme} {...store} {...helpers} />}
              {view === "reports" && <Reports {...theme} {...store} {...helpers} />}
              {view === "settings" && <SettingsPage {...theme} {...store} {...helpers} />}
            </ScreenBoundary>
          </main>
        </div>
      </div>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          navItems={navItems}
          canOpen={canOpen}
          go={go}
          openRecord={openRecord}
          actions={paletteActions}
          products={products}
          customers={customers}
          suppliers={suppliers}
          salesOrders={salesOrders}
          purchaseOrders={purchaseOrders}
          rawMaterials={rawMaterials}
          dark={dark}
        />
      )}
      {changingPassword && (
        <Modal
          title="Change your password"
          onClose={() => setChangingPassword(false)}
          cardBg={cardBg}
          dark={dark}
        >
          <PasswordChangeForm
            onDone={() => {
              setChangingPassword(false);
              setToast("Password changed. Any other devices you were signed in on have been signed out.");
            }}
          />
        </Modal>
      )}
      {twoStepOpen && (
        <TwoStepDialog
          onClose={() => setTwoStepOpen(false)}
          cardBg={cardBg}
          dark={dark}
          subText={subText}
          inputBg={theme.inputBg}
        />
      )}
      <ToastHost toast={toast} onClose={closeToast} />
    </div>
  );
}
