import { useState } from "react";
import { Badge, EmptyState, Field, Modal, SearchInput, StatCard, inputCls } from "@/components/learnex/ui";
import { Mail, Save, Trash2, UserPlus } from "@/components/learnex/icons";
import { money, nextNumId } from "@/lib/learnex/utils";

/* =====================================================================
   CUSTOMERS — with Add Customer
===================================================================== */
export function CustomerModal({ onClose, onSave, dark, cardBg, subText, inputBg }) {
  const [form, setForm] = useState({ name: "", contact: "", phone: "", email: "", tier: "Retail" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    if (!form.name) return;
    onSave(form);
  }
  return (
    <Modal title="Add Customer" onClose={onClose} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Business / Customer Name" subText={subText}>
          <input required={true} value={form.name} onChange={set("name")} className={inputCls(inputBg)} />
        </Field>
        <Field label="Contact Person" subText={subText}>
          <input value={form.contact} onChange={set("contact")} className={inputCls(inputBg)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" subText={subText}>
            <input value={form.phone} onChange={set("phone")} className={inputCls(inputBg)} />
          </Field>
          <Field label="Email" subText={subText}>
            <input type="email" value={form.email} onChange={set("email")} className={inputCls(inputBg)} />
          </Field>
        </div>
        <Field label="Tier" subText={subText}>
          <select value={form.tier} onChange={set("tier")} className={inputCls(inputBg)}>
            <option>Retail</option>
            <option>Wholesale</option>
          </select>
        </Field>
        <button
          type="submit"
          className="btn btn-primary btn-block"
        >
          <Save size={15} />
          {" Add Customer"}
        </button>
      </form>
    </Modal>
  );
}
export function Customers({ dark, cardBg, subText, inputBg, hoverRow, setToast, customers, setCustomers, seed }) {
  const [query, setQuery] = useState(seed || "");
  const [tierFilter, setTierFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const tiers = ["All", "Wholesale", "Retail"];
  const filtered = customers.filter(
    (c) =>
      (tierFilter === "All" || c.tier === tierFilter) && c.name.toLowerCase().includes(query.toLowerCase()),
  );
  const totalSpent = customers.reduce((s, c) => s + c.spent, 0);
  const totalOutstanding = customers.reduce((s, c) => s + c.outstanding, 0);
  function saveCustomer(data) {
    const id = nextNumId(customers);
    setCustomers((prev) => [...prev, { id, orders: 0, spent: 0, outstanding: 0, ...data }]);
    setToast(`${data.name} added as a customer.`);
    setModalOpen(false);
  }
  function deleteCustomer(c) {
    if (!window.confirm(`Delete customer "${c.name}"?`)) return;
    setCustomers((prev) => prev.filter((x) => x.id !== c.id));
    setToast(`${c.name} removed.`);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Customers</h2>
          <p className={`text-sm ${subText}`}>
            {customers.length}
            {" customer accounts"}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="btn btn-primary"
        >
          <UserPlus size={16} />
          {" Add Customer"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Customers" value={customers.length} cardBg={cardBg} subText={subText} />
        <StatCard label="Lifetime Revenue" value={money(totalSpent)} cardBg={cardBg} subText={subText} />
        <StatCard
          label="Outstanding Balance"
          value={money(totalOutstanding)}
          valueClass="text-amber-600"
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label="Wholesale Accounts"
          value={customers.filter((c) => c.tier === "Wholesale").length}
          cardBg={cardBg}
          subText={subText}
        />
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <SearchInput value={query} onChange={setQuery} placeholder="Search customer..." inputBg={inputBg} subText={subText} className="w-full sm:w-72" />
          <select aria-label="Filter by tier"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
          >
            {tiers.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Customer</th>
                <th className="font-medium py-3 px-2">Contact</th>
                <th className="font-medium py-3 px-2">Tier</th>
                <th className="font-medium py-3 px-2">Orders</th>
                <th className="font-medium py-3 px-2">Total Spent</th>
                <th className="font-medium py-3 px-2">Outstanding</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                >
                  <td className="py-3 px-5 font-medium">{c.name}</td>
                  <td className="py-3 px-2">
                    <p>{c.contact}</p>
                    <p className={`text-xs ${subText} flex items-center gap-1 mt-0.5`}>
                      <Mail size={11} />
                      {c.email}
                    </p>
                  </td>
                  <td className="py-3 px-2">
                    <Badge tone={c.tier === "Wholesale" ? "blue" : "slate"}>{c.tier}</Badge>
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{c.orders}</td>
                  <td className="py-3 px-2 font-medium whitespace-nowrap">{money(c.spent)}</td>
                  <td className="py-3 px-2">
                    {c.outstanding > 0 ? (
                      <span className="text-red-600 font-medium">{money(c.outstanding)}</span>
                    ) : (
                      <span className={subText}>{"—"}</span>
                    )}
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => deleteCustomer(c)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                        title="Delete"
                        aria-label="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-2">
                    <EmptyState compact subText={subText} title="No customers match these filters." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalOpen && (
        <CustomerModal
          onClose={() => setModalOpen(false)}
          onSave={saveCustomer}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
        />
      )}
    </div>
  );
}
