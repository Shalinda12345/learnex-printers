import { useState } from "react";
import { Badge, Field, Modal, inputCls } from "@/components/learnex/ui";
import { CATEGORY_COLORS } from "@/lib/learnex/seed";
import { Pencil, Plus, Save, Search, Trash2 } from "@/components/learnex/icons";
import { money, nextNumId, numVal, round2, stockStatus } from "@/lib/learnex/utils";

/* =====================================================================
   INVENTORY — with Add / Edit / Delete product
===================================================================== */
export function ProductModal({ onClose, onSave, initial, dark, cardBg, subText, inputBg }) {
  const [form, setForm] = useState(
    initial || {
      name: "",
      sku: "",
      category: "Printers",
      price: "",
      cost: "",
      stock: "",
      min: "5",
      unit: "pc",
    },
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    if (!form.name || !form.sku || form.price === "" || form.cost === "") return;
    onSave({
      ...form,
      price: round2(form.price),
      cost: round2(form.cost),
      stock: numVal(form.stock, 0),
      min: numVal(form.min, 0),
    });
  }
  return (
    <Modal title={initial ? "Edit Product" : "Add Product"} onClose={onClose} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Product Name" subText={subText}>
          <input
            required={true}
            value={form.name}
            onChange={set("name")}
            className={inputCls(inputBg)}
            placeholder="e.g. HP LaserJet Pro M404dn"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU" subText={subText}>
            <input
              required={true}
              value={form.sku}
              onChange={set("sku")}
              className={inputCls(inputBg)}
              placeholder="e.g. PRN-HP404"
            />
          </Field>
          <Field label="Category" subText={subText}>
            <select value={form.category} onChange={set("category")} className={inputCls(inputBg)}>
              {Object.keys(CATEGORY_COLORS).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Cost Price" subText={subText}>
            <input
              required={true}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.cost}
              onChange={set("cost")}
              className={inputCls(inputBg)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Selling Price" subText={subText}>
            <input
              required={true}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.price}
              onChange={set("price")}
              className={inputCls(inputBg)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Unit" subText={subText}>
            <input
              value={form.unit}
              onChange={set("unit")}
              className={inputCls(inputBg)}
              placeholder="pc / ream / pack"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opening Stock" subText={subText}>
            <input
              type="number"
              min="0"
              value={form.stock}
              onChange={set("stock")}
              className={inputCls(inputBg)}
            />
          </Field>
          <Field label="Reorder Point (min)" subText={subText}>
            <input
              type="number"
              min="0"
              value={form.min}
              onChange={set("min")}
              className={inputCls(inputBg)}
            />
          </Field>
        </div>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} /> {initial ? "Save Changes" : "Add Product"}
        </button>
      </form>
    </Modal>
  );
}
export function Inventory({ dark, cardBg, subText, inputBg, hoverRow, setToast, products, setProducts }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const categories = ["All", ...new Set(products.map((p) => p.category))];
  const filtered = products.filter((p) => {
    const s = stockStatus(p);
    return (
      (category === "All" || p.category === category) &&
      (statusFilter === "All" || s.label === statusFilter) &&
      (p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.sku.toLowerCase().includes(query.toLowerCase()))
    );
  });
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= p.min).length;
  const outOfStock = products.filter((p) => p.stock === 0).length;
  const totalValue = products.reduce((s, p) => s + p.cost * p.stock, 0);
  function saveProduct(data) {
    if (editing) {
      setProducts((prev) => prev.map((p) => (p.id === editing.id ? { ...p, ...data } : p)));
      setToast(`${data.name} updated.`);
    } else {
      const id = nextNumId(products);
      setProducts((prev) => [...prev, { id, ...data }]);
      setToast(`${data.name} added to inventory.`);
    }
    setModalOpen(false);
    setEditing(null);
  }
  function deleteProduct(p) {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    setProducts((prev) => prev.filter((x) => x.id !== p.id));
    setToast(`${p.name} removed from inventory.`);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{"Products & Inventory"}</h1>
          <p className={`text-sm ${subText}`}>
            {products.length}
            {" products across "}
            {categories.length - 1}
            {" categories"}
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Plus size={16} />
          {" Add Product"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Stock Value</p>
          <p className="text-xl font-bold mt-1">{money(totalValue)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total SKUs</p>
          <p className="text-xl font-bold mt-1">{products.length}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Low Stock</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{lowStock}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Out of Stock</p>
          <p className="text-xl font-bold mt-1 text-red-600">{outOfStock}</p>
        </div>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-72 ${inputBg}`}>
            <Search size={15} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or SKU..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
            >
              {["All", "In Stock", "Low Stock", "Out of Stock"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Product</th>
                <th className="font-medium py-3 px-2">SKU</th>
                <th className="font-medium py-3 px-2">Category</th>
                <th className="font-medium py-3 px-2">Cost</th>
                <th className="font-medium py-3 px-2">Price</th>
                <th className="font-medium py-3 px-2">Stock</th>
                <th className="font-medium py-3 px-2">Status</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const s = stockStatus(p);
                return (
                  <tr
                    key={p.id}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                  >
                    <td className="py-3 px-5 font-medium">{p.name}</td>
                    <td className={`py-3 px-2 ${subText}`}>{p.sku}</td>
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: CATEGORY_COLORS[p.category] || "#64748B" }}
                        />
                        {p.category}
                      </span>
                    </td>
                    <td className="py-3 px-2">{money(p.cost)}</td>
                    <td className="py-3 px-2 font-medium">{money(p.price)}</td>
                    <td className="py-3 px-2">
                      {p.stock} {p.unit}
                    </td>
                    <td className="py-3 px-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setEditing(p);
                            setModalOpen(true);
                          }}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteProduct(p)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className={`text-center py-10 text-sm ${subText}`}>
                    No products match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalOpen && (
        <ProductModal
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSave={saveProduct}
          initial={editing}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
        />
      )}
    </div>
  );
}
