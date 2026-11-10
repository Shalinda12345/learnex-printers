import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CornerDownLeft,
  Download,
  KeyRound,
  LogOut,
  Moon,
  Search,
  Sun,
} from "@/components/learnex/icons";

/* =====================================================================
   COMMAND PALETTE  (Ctrl+K / ⌘K, or "/" , or click the top-bar search)

   One box to jump anywhere: screens, quick actions, and the records
   themselves (products, customers, suppliers, orders, raw materials).
   Picking a record opens its screen with the search already filled in.
===================================================================== */

const norm = (s) => String(s ?? "").toLowerCase();
const matches = (query, ...fields) => {
  const q = norm(query).trim();
  if (!q) return true;
  const hay = fields.map(norm).join(" ");
  return q.split(/\s+/).every((part) => hay.includes(part));
};

export function CommandPalette({
  onClose,
  navItems,
  canOpen,
  go,
  openRecord,
  actions,
  products,
  customers,
  suppliers,
  salesOrders,
  purchaseOrders,
  rawMaterials,
  dark,
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const out = [];
    const pages = navItems
      .filter((n) => matches(query, n.label))
      .map((n) => ({
        id: `page-${n.key}`,
        group: "Go to",
        label: n.label,
        icon: n.icon,
        run: () => go(n.key),
      }));
    out.push(...pages);
    const acts = actions
      .filter((a) => matches(query, a.label, a.keywords))
      .map((a) => ({ id: `act-${a.id}`, group: "Actions", label: a.label, icon: a.icon, run: a.run }));
    out.push(...acts);

    if (norm(query).trim().length >= 2) {
      const add = (group, view, list, make) => {
        if (!canOpen(view)) return;
        const found = (list || []).map(make).filter((r) => matches(query, r.label, r.hint, r.extra));
        for (const r of found.slice(0, 5)) {
          out.push({
            id: `${view}-${r.key}`,
            group,
            label: r.label,
            hint: r.hint,
            icon: navItems.find((n) => n.key === view)?.icon,
            run: () => openRecord(view, r.search),
          });
        }
      };
      add("Products", "inventory", products, (p) => ({
        key: p.id,
        label: p.name,
        hint: p.sku,
        extra: p.category,
        search: p.name,
      }));
      add("Customers", "customers", customers, (c) => ({
        key: c.id,
        label: c.name,
        hint: c.phone || c.contact || "",
        extra: c.email,
        search: c.name,
      }));
      add("Suppliers", "suppliers", suppliers, (s) => ({
        key: s.id,
        label: s.name,
        hint: s.phone || s.contact || "",
        extra: s.email,
        search: s.name,
      }));
      add("Sales orders", "sales", salesOrders, (o) => ({
        key: o.id,
        label: `${o.id} — ${o.customer}`,
        hint: o.invoice || "",
        search: o.id,
      }));
      add("Purchase orders", "purchases", purchaseOrders, (o) => ({
        key: o.id,
        label: `${o.id} — ${o.supplier}`,
        hint: "",
        search: o.id,
      }));
      add("Raw materials", "rawmaterials", rawMaterials, (m) => ({
        key: m.id,
        label: m.name,
        hint: m.category || "",
        search: m.name,
      }));
    }
    return out;
  }, [
    query,
    navItems,
    actions,
    canOpen,
    go,
    openRecord,
    products,
    customers,
    suppliers,
    salesOrders,
    purchaseOrders,
    rawMaterials,
  ]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  function run(item) {
    if (!item) return;
    onClose();
    item.run();
  }
  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const panel = dark ? "bg-slate-900 border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-900";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  let lastGroup = null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-3 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden animate-pop-in ${panel}`}
      >
        <div className={`flex items-center gap-3 px-4 border-b ${dark ? "border-slate-800" : "border-slate-100"}`}>
          <Search size={17} className={muted} />
          <input aria-label="Search screens, products, customers and orders"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search screens, products, customers, orders…"
            className="flex-1 bg-transparent outline-none text-sm py-4 min-w-0"
          />
          <span className="kbd">Esc</span>
        </div>
        <div id="palette-list" role="listbox" ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <p className={`text-sm text-center py-10 ${muted}`}>
              Nothing found for “{query.trim()}”.
            </p>
          )}
          {results.map((r, i) => {
            const header = r.group !== lastGroup;
            lastGroup = r.group;
            const Icon = r.icon;
            const selected = i === active;
            return (
              <div key={r.id}>
                {header && (
                  <p className={`px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider ${muted}`}>
                    {r.group}
                  </p>
                )}
                <button
                  type="button"
                  id={`palette-${r.id}`}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(r)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left ${selected ? (dark ? "bg-slate-800" : "bg-blue-50 text-blue-900") : ""}`}
                >
                  {Icon && <Icon size={16} className={selected ? "text-blue-500" : muted} />}
                  <span className="truncate flex-1">{r.label}</span>
                  {r.hint && <span className={`text-xs truncate max-w-[40%] ${muted}`}>{r.hint}</span>}
                  {selected && <CornerDownLeft size={13} className={muted} />}
                </button>
              </div>
            );
          })}
        </div>
        <div className={`flex items-center gap-4 px-4 py-2 border-t text-[11px] ${muted} ${dark ? "border-slate-800" : "border-slate-100"}`}>
          <span className="flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span> to move</span>
          <span className="flex items-center gap-1.5"><span className="kbd">↵</span> to open</span>
          <span className="ml-auto flex items-center gap-1">
            <ArrowRight size={11} /> Type 2+ letters to search records
          </span>
        </div>
      </div>
    </div>
  );
}

/** The quick actions offered by the palette (built here so icons stay in one place). */
export function buildActions({ dark, toggleTheme, canBackup, backup, changePassword, signOut }) {
  return [
    {
      id: "theme",
      label: dark ? "Switch to light mode" : "Switch to dark mode",
      keywords: "theme appearance dark light",
      icon: dark ? Sun : Moon,
      run: toggleTheme,
    },
    ...(canBackup
      ? [{ id: "backup", label: "Download a full backup", keywords: "export save", icon: Download, run: backup }]
      : []),
    { id: "password", label: "Change my password", keywords: "account security", icon: KeyRound, run: changePassword },
    { id: "signout", label: "Sign out", keywords: "log out logout", icon: LogOut, run: signOut },
  ];
}
