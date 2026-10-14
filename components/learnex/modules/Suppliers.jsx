import { useState } from "react";
import { Badge, Field, Modal, StatCard, inputCls } from "@/components/learnex/ui";
import { Building2, Phone, Plus, Save, Search, Trash2 } from "@/components/learnex/icons";
import { fmtDate, money, nextNumId } from "@/lib/learnex/utils";

/* =====================================================================
   SUPPLIERS — with Add Supplier
===================================================================== */
export function SupplierModal({ onClose, onSave, dark, cardBg, subText, inputBg }) {
  const [form, setForm] = useState({
    name: "",
    contact: "",
    phone: "",
    email: "",
    category: "",
    status: "Active",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    if (!form.name) return;
    onSave(form);
  }
  return (
    <Modal title="Add Supplier" onClose={onClose} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Supplier Name" subText={subText}>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category Supplied" subText={subText}>
            <input
              value={form.category}
              onChange={set("category")}
              className={inputCls(inputBg)}
              placeholder="e.g. Printers"
            />
          </Field>
          <Field label="Status" subText={subText}>
            <select value={form.status} onChange={set("status")} className={inputCls(inputBg)}>
              <option>Active</option>
              <option>On Hold</option>
            </select>
          </Field>
        </div>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} />
          {" Add Supplier"}
        </button>
      </form>
    </Modal>
  );
}
export function Suppliers({ dark, cardBg, subText, inputBg, hoverRow, setToast, suppliers, setSuppliers }) {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const filtered = suppliers.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
  const totalPurchased = suppliers.reduce((s, x) => s + x.purchased, 0);
  const active = suppliers.filter((s) => s.status === "Active").length;
  function saveSupplier(data) {
    const id = nextNumId(suppliers);
    setSuppliers((prev) => [...prev, { id, purchased: 0, lastOrder: null, ...data }]);
    setToast(`${data.name} added as a supplier.`);
    setModalOpen(false);
  }
  function deleteSupplier(s) {
    if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
    setSuppliers((prev) => prev.filter((x) => x.id !== s.id));
    setToast(`${s.name} removed.`);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Suppliers</h1>
          <p className={`text-sm ${subText}`}>
            {suppliers.length}
            {" supplier relationships"}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Plus size={16} />
          {" Add Supplier"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Suppliers" value={suppliers.length} cardBg={cardBg} subText={subText} />
        <StatCard
          label="Active"
          value={active}
          valueClass="text-emerald-600"
          cardBg={cardBg}
          subText={subText}
        />
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm col-span-2`}>
          <p className={`text-xs ${subText}`}>Total Purchased (YTD)</p>
          <p className="text-xl font-bold mt-1">{money(totalPurchased)}</p>
        </div>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-72 ${inputBg}`}>
            <Search size={15} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search supplier..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Supplier</th>
                <th className="font-medium py-3 px-2">Contact</th>
                <th className="font-medium py-3 px-2">Category</th>
                <th className="font-medium py-3 px-2">Purchased (YTD)</th>
                <th className="font-medium py-3 px-2">Last Order</th>
                <th className="font-medium py-3 px-2">Status</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                >
                  <td className="py-3 px-5 font-medium flex items-center gap-2">
                    <Building2 size={14} className={subText} />
                    {s.name}
                  </td>
                  <td className="py-3 px-2">
                    <p>{s.contact}</p>
                    <p className={`text-xs ${subText} flex items-center gap-1 mt-0.5`}>
                      <Phone size={11} />
                      {s.phone}
                    </p>
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{s.category}</td>
                  <td className="py-3 px-2 font-medium">{money(s.purchased)}</td>
                  <td className={`py-3 px-2 ${subText}`}>{fmtDate(s.lastOrder)}</td>
                  <td className="py-3 px-2">
                    <Badge tone={s.status === "Active" ? "green" : "amber"}>{s.status}</Badge>
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => deleteSupplier(s)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className={`text-center py-10 text-sm ${subText}`}>
                    No suppliers match this search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalOpen && (
        <SupplierModal
          onClose={() => setModalOpen(false)}
          onSave={saveSupplier}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
        />
      )}
    </div>
  );
}
