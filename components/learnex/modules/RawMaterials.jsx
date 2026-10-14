import { useState } from "react";
import { Field, Modal, inputCls } from "@/components/learnex/ui";
import { MinusCircle, Pencil, Plus, Save, Search, Trash2 } from "@/components/learnex/icons";
import { RAW_MATERIAL_CATEGORIES } from "@/lib/learnex/seed";
import { fmtDate, money, nextNumId, numVal, round2, round6, todayISO } from "@/lib/learnex/utils";
import { nextSeq } from "@/lib/learnex/persistence";

/* =====================================================================
   RAW MATERIALS — a module fully separate from finished-goods Inventory.
   Purchased items land here (via Purchases), never in Inventory. Includes
   full CRUD plus a "Use Raw Material" action that consumes stock and logs
   a searchable/filterable usage history.
===================================================================== */
export function RawMaterialModal({ onClose, onSave, initial, dark, cardBg, subText, inputBg, suppliers }) {
  const [form, setForm] = useState(
    initial || {
      name: "",
      category: RAW_MATERIAL_CATEGORIES[0],
      supplier: (suppliers[0] && suppliers[0].name) || "",
      unit: "kg",
      purchaseQty: "",
      availableQty: "",
      costPrice: "",
      purchaseDate: todayISO(),
      batchNumber: "",
      notes: "",
    },
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    if (!form.name || !form.unit || form.costPrice === "") return;
    const purchaseQty = numVal(form.purchaseQty, 0);
    onSave({
      ...form,
      purchaseQty,
      availableQty: form.availableQty === "" ? purchaseQty : numVal(form.availableQty, purchaseQty),
      // Average costs are held to six decimals (see round6 in utils).
      costPrice: round6(form.costPrice),
    });
  }
  return (
    <Modal
      title={initial ? "Edit Raw Material" : "Add Raw Material"}
      onClose={onClose}
      cardBg={cardBg}
      dark={dark}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Material Name" subText={subText}>
          <input
            required={true}
            value={form.name}
            onChange={set("name")}
            className={inputCls(inputBg)}
            placeholder="e.g. ABS Resin Pellets"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" subText={subText}>
            <select value={form.category} onChange={set("category")} className={inputCls(inputBg)}>
              {RAW_MATERIAL_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Supplier" subText={subText}>
            {suppliers.length > 0 ? (
              <select value={form.supplier} onChange={set("supplier")} className={inputCls(inputBg)}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form.supplier}
                onChange={set("supplier")}
                className={inputCls(inputBg)}
                placeholder="Supplier name"
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit" subText={subText}>
            <input
              required={true}
              value={form.unit}
              onChange={set("unit")}
              className={inputCls(inputBg)}
              placeholder="kg / L / pc"
            />
          </Field>
          <Field label="Purchase Quantity" subText={subText}>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={form.purchaseQty}
              onChange={set("purchaseQty")}
              className={inputCls(inputBg)}
            />
          </Field>
          <Field label="Available Quantity" subText={subText}>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={form.availableQty}
              onChange={set("availableQty")}
              className={inputCls(inputBg)}
              placeholder="Defaults to purchase qty"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Average Cost (per unit)" subText={subText}>
            <input
              required={true}
              type="number"
              min="0"
              step="0.000001"
              inputMode="decimal"
              value={form.costPrice}
              onChange={set("costPrice")}
              className={inputCls(inputBg)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Purchase Date" subText={subText}>
            <input
              type="date"
              value={form.purchaseDate}
              onChange={set("purchaseDate")}
              className={inputCls(inputBg)}
            />
          </Field>
        </div>
        <Field label="Batch Number (optional)" subText={subText}>
          <input value={form.batchNumber} onChange={set("batchNumber")} className={inputCls(inputBg)} />
        </Field>
        <p className={`text-xs ${subText}`}>
          You only need to set the average cost when first adding a material. From then on every purchase
          order recalculates it automatically as a weighted average of the stock on hand and the new stock
          arriving. Changing it by hand revalues all remaining stock, so use it only to correct a genuine
          mistake.
        </p>
        <Field label="Notes" subText={subText}>
          <textarea value={form.notes} onChange={set("notes")} rows={2} className={inputCls(inputBg)} />
        </Field>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} /> {initial ? "Save Changes" : "Add Raw Material"}
        </button>
      </form>
    </Modal>
  );
}
export function RawMaterials({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  rawMaterials,
  setRawMaterials,
  rawMaterialUsage,
  setRawMaterialUsage,
  suppliers,
  currentUser,
  ledger,
  setLedger,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [usageQuery, setUsageQuery] = useState("");
  const [usageFrom, setUsageFrom] = useState("");
  const [usageTo, setUsageTo] = useState("");
  const [entryDate, setEntryDate] = useState(todayISO());
  const [entryMaterialId, setEntryMaterialId] = useState("");
  const [entryQty, setEntryQty] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const categories = ["All", ...new Set(rawMaterials.map((m) => m.category))];
  const filtered = rawMaterials.filter(
    (m) =>
      (category === "All" || m.category === category) &&
      (m.name.toLowerCase().includes(query.toLowerCase()) ||
        (m.supplier || "").toLowerCase().includes(query.toLowerCase())),
  );
  const totalValue = rawMaterials.reduce((s, m) => s + m.costPrice * m.availableQty, 0);
  const totalStock = rawMaterials.reduce((s, m) => s + m.availableQty, 0);
  const lowStockCount = rawMaterials.filter(
    (m) => m.availableQty > 0 && m.availableQty <= (m.purchaseQty || 0) * 0.2,
  ).length;
  const filteredUsage = rawMaterialUsage.filter((u) => {
    const matchesQuery =
      (u.materialName || "").toLowerCase().includes(usageQuery.toLowerCase()) ||
      (u.user || "").toLowerCase().includes(usageQuery.toLowerCase());
    const matchesFrom = !usageFrom || u.date >= usageFrom;
    const matchesTo = !usageTo || u.date <= usageTo;
    return matchesQuery && matchesFrom && matchesTo;
  });
  function saveMaterial(data) {
    if (editing) {
      setRawMaterials((prev) => prev.map((m) => (m.id === editing.id ? { ...m, ...data } : m)));
      setToast(`${data.name} updated.`);
    } else {
      const id = nextNumId(rawMaterials);
      setRawMaterials((prev) => [...prev, { id, ...data }]);
      setToast(`${data.name} added to Raw Materials.`);
    }
    setModalOpen(false);
    setEditing(null);
  }
  function deleteMaterial(m) {
    if (!window.confirm(`Delete "${m.name}"? This cannot be undone.`)) return;
    setRawMaterials((prev) => prev.filter((x) => x.id !== m.id));
    setToast(`${m.name} removed from Raw Materials.`);
  }
  function deleteUsage(u) {
    const material = rawMaterials.find((m) => m.id === u.materialId);
    const label = `${u.qtyUsed} ${(material && material.unit) || ""} of ${u.materialName}`.replace(
      /\s+/g,
      " ",
    );
    if (
      !window.confirm(
        `Delete this usage record (${label} on ${fmtDate(u.date)})? The quantity will be added back to Available Quantity. This cannot be undone.`,
      )
    )
      return;
    if (material) {
      setRawMaterials((prev) =>
        prev.map((m) =>
          m.id === material.id
            ? { ...m, availableQty: (Number(m.availableQty) || 0) + (Number(u.qtyUsed) || 0) }
            : m,
        ),
      );
    }
    // New usage records never post to the ledger at all. Only older records
    // saved before this change carry a ledgerTxnId, and that entry is still
    // reversed here so historic data stays consistent. Nothing already
    // entered is altered or re-stated anywhere else.
    if (u.ledgerTxnId) {
      setLedger((prev) => prev.filter((t) => t.id !== u.ledgerTxnId));
    }
    setRawMaterialUsage((prev) => prev.filter((x) => x.id !== u.id));
    setToast(
      material
        ? `Usage record removed. ${u.qtyUsed} ${material.unit} returned to ${u.materialName}.`
        : `Usage record removed. The original material no longer exists, so no stock was returned.`,
    );
  }
  async function saveDailyUsage(e) {
    e.preventDefault();
    const material = rawMaterials.find((m) => m.id === Number(entryMaterialId));
    const qty = Number(entryQty) || 0;
    if (!material) {
      setToast("Select a raw material first.");
      return;
    }
    if (qty <= 0) {
      setToast("Enter a quantity used greater than 0.");
      return;
    }
    if (qty > material.availableQty) {
      setToast(`Only ${material.availableQty} ${material.unit} of ${material.name} is available.`);
      return;
    }
    const remaining = Math.max(0, material.availableQty - qty);
    setRawMaterials((prev) =>
      prev.map((m) => (m.id === material.id ? { ...m, availableQty: remaining } : m)),
    );
    const useDate = entryDate || todayISO();
    // Valued at the weighted average cost so the usage record shows what the
    // consumed material was worth. This is a stock movement only — it is NOT
    // posted to the ledger and NEVER touches the Profit or Loss statement.
    // Like a real ERP, the material cost reaches profit in one place only:
    // Cost of Goods Sold, at the moment the finished goods are actually sold.
    const consumedValue = round2(numVal(material.costPrice, 0) * qty);
    const useId = await nextSeq(rawMaterialUsage, "id", "USE-", 1000);
    setRawMaterialUsage((prev) => [
      {
        id: useId,
        date: useDate,
        materialId: material.id,
        materialName: material.name,
        qtyUsed: qty,
        remainingQty: remaining,
        user: (currentUser && currentUser.name) || "User",
        notes: entryNotes,
        consumedValue,
        ledgerTxnId: null,
      },
      ...prev,
    ]);
    setToast(
      `${qty} ${material.unit} of ${material.name} recorded as used on ${fmtDate(entryDate)}. ${remaining} ${material.unit} remaining. Stock movement only \u2014 no expense posted.`,
    );
    setEntryMaterialId("");
    setEntryQty("");
    setEntryNotes("");
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Raw Materials</h1>
          <p className={`text-sm ${subText}`}>
            {
              "Purchased materials are held as an asset. Recording usage moves stock only \u2014 the cost reaches the Profit or Loss statement as Cost of Goods Sold, when the finished goods are sold."
            }
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
          >
            <Plus size={16} />
            {" Add Raw Material"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Raw Materials Value</p>
          <p className="text-xl font-bold mt-1">{money(totalValue)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Materials</p>
          <p className="text-xl font-bold mt-1">{rawMaterials.length}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Available Stock</p>
          <p className="text-xl font-bold mt-1">{totalStock}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Low Stock Materials</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{lowStockCount}</p>
        </div>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-72 ${inputBg}`}>
            <Search size={15} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or supplier..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Material</th>
                <th className="font-medium py-3 px-2">Category</th>
                <th className="font-medium py-3 px-2">Supplier</th>
                <th className="font-medium py-3 px-2">Unit</th>
                <th className="font-medium py-3 px-2">Purchased</th>
                <th className="font-medium py-3 px-2">Available</th>
                <th className="font-medium py-3 px-2">Avg Cost/Unit</th>
                <th className="font-medium py-3 px-2">Stock Value</th>
                <th className="font-medium py-3 px-2">Batch #</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                >
                  <td className="py-3 px-5 font-medium">{m.name}</td>
                  <td className={`py-3 px-2 ${subText}`}>{m.category}</td>
                  <td className={`py-3 px-2 ${subText}`}>{m.supplier || "\u2014"}</td>
                  <td className={`py-3 px-2 ${subText}`}>{m.unit}</td>
                  <td className="py-3 px-2">{m.purchaseQty}</td>
                  <td className="py-3 px-2 font-medium">{m.availableQty}</td>
                  <td className="py-3 px-2">
                    {money(m.costPrice)}
                    {m.lastPurchaseCost !== undefined &&
                    round2(m.lastPurchaseCost) !== round2(m.costPrice) ? (
                      <p className={`text-xs ${subText}`}>{`last bought at ${money(m.lastPurchaseCost)}`}</p>
                    ) : null}
                  </td>
                  <td className="py-3 px-2 font-medium">
                    {money(round2(numVal(m.costPrice, 0) * numVal(m.availableQty, 0)))}
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{m.batchNumber || "\u2014"}</td>
                  <td className="py-3 px-5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          setEditing(m);
                          setModalOpen(true);
                        }}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => deleteMaterial(m)}
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
                  <td colSpan={10} className={`text-center py-10 text-sm ${subText}`}>
                    No raw materials yet. Add one, or record a Purchase Order to bring materials in.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={`rounded-2xl border ${cardBg} shadow-sm p-5`}>
          <h3 className="font-semibold mb-1">Daily Raw Material Usage</h3>
          <p className={`text-xs ${subText} mb-4`}>
            {
              "Pick the date and record how much of a raw material was used that day. It's deducted from Available Quantity and added to the records below. This is a stock movement only \u2014 no expense is posted to the ledger."
            }
          </p>
          <form
            onSubmit={saveDailyUsage}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
          >
            <Field label="Date" subText={subText}>
              <input
                type="date"
                required={true}
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className={inputCls(inputBg)}
              />
            </Field>
            <Field label="Raw Material" subText={subText}>
              <select
                required={true}
                value={entryMaterialId}
                onChange={(e) => setEntryMaterialId(e.target.value)}
                className={inputCls(inputBg)}
              >
                <option value="">Select material...</option>
                {rawMaterials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {" ("}
                    {m.availableQty} {m.unit}
                    {" available)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity Used" subText={subText}>
              <input
                type="number"
                min="0"
                step="any"
                required={true}
                value={entryQty}
                onChange={(e) => setEntryQty(e.target.value)}
                className={inputCls(inputBg)}
              />
            </Field>
            <Field label="Notes (optional)" subText={subText}>
              <input
                value={entryNotes}
                onChange={(e) => setEntryNotes(e.target.value)}
                className={inputCls(inputBg)}
                placeholder="What was this used for?"
              />
            </Field>
            <button
              type="submit"
              disabled={rawMaterials.length === 0}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40 h-[42px]"
            >
              <MinusCircle size={15} />
              {" Record Usage"}
            </button>
          </form>
          {rawMaterials.length === 0 && (
            <p className="text-xs text-amber-600 mt-3">Add a raw material above before recording usage.</p>
          )}
        </div>
        <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
          <div className="p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div>
              <h3 className="font-semibold">Raw Material Usage History</h3>
              <p className={`text-xs ${subText}`}>Every recorded use of a raw material</p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-56 ${inputBg}`}>
                <Search size={15} className={subText} />
                <input
                  value={usageQuery}
                  onChange={(e) => setUsageQuery(e.target.value)}
                  placeholder="Search material or user..."
                  className="bg-transparent outline-none text-sm w-full"
                />
              </div>
              <input
                type="date"
                value={usageFrom}
                onChange={(e) => setUsageFrom(e.target.value)}
                className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
              />
              <input
                type="date"
                value={usageTo}
                onChange={(e) => setUsageTo(e.target.value)}
                className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr
                  className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <th className="font-medium py-3 px-5">Date</th>
                  <th className="font-medium py-3 px-2">Material</th>
                  <th className="font-medium py-3 px-2">Qty Used</th>
                  <th className="font-medium py-3 px-2">Remaining</th>
                  <th className="font-medium py-3 px-2">User</th>
                  <th className="font-medium py-3 px-2">Notes</th>
                  <th className="font-medium py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsage.map((u) => (
                  <tr
                    key={u.id}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                  >
                    <td className={`py-3 px-5 ${subText}`}>{fmtDate(u.date)}</td>
                    <td className="py-3 px-2 font-medium">{u.materialName}</td>
                    <td className="py-3 px-2">{u.qtyUsed}</td>
                    <td className="py-3 px-2">{u.remainingQty}</td>
                    <td className={`py-3 px-2 ${subText}`}>{u.user}</td>
                    <td className={`py-3 px-2 ${subText} max-w-[240px] truncate`}>{u.notes || "\u2014"}</td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={() => deleteUsage(u)}
                          title="Delete this usage record and return the quantity to stock"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredUsage.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`text-center py-10 text-sm ${subText}`}>
                      No usage recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {modalOpen && (
          <RawMaterialModal
            onClose={() => {
              setModalOpen(false);
              setEditing(null);
            }}
            onSave={saveMaterial}
            initial={editing}
            dark={dark}
            cardBg={cardBg}
            subText={subText}
            inputBg={inputBg}
            suppliers={suppliers}
          />
        )}
      </div>
    </div>
  );
}
