import { useState } from "react";
import { Badge, Field, Modal, inputCls } from "@/components/learnex/ui";
import {
  Building2,
  CheckCircle2,
  Pencil,
  Plus,
  Route,
  Save,
  Search,
  Trash2,
} from "@/components/learnex/icons";
import { MAIN_CASH_ID } from "@/lib/learnex/accounting";
import { fmtDate, money, numVal, round2, todayISO } from "@/lib/learnex/utils";
import { nextSeq } from "@/lib/learnex/persistence";

/* =====================================================================
   DELIVERY STOCK — track stock taken out for delivery runs and the
   stock brought back unsold. Taken stock is deducted from inventory
   immediately; when a run is closed, returned stock is added back to
   inventory automatically, and the sold quantity is booked as sales
   income (with profit shown using each product's cost).
===================================================================== */
export function DeliveryRunModal({ onClose, onSave, dark, cardBg, subText, inputBg, products }) {
  var _a, _b;
  const available = products.filter((p) => p.stock > 0);
  const [date, setDate] = useState(todayISO());
  const [items, setItems] = useState([
    { productId: ((_a = available[0]) === null || _a === void 0 ? void 0 : _a.id) || "", qty: 1 },
  ]);
  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((prev) => {
      var _a;
      return [
        ...prev,
        { productId: ((_a = available[0]) === null || _a === void 0 ? void 0 : _a.id) || "", qty: 1 },
      ];
    });
  }
  function removeRow(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  const lineItems = items
    .map((it) => {
      const p = products.find((x) => x.id === Number(it.productId));
      return p
        ? {
            productId: p.id,
            name: p.name,
            price: p.price,
            cost: p.cost,
            unit: p.unit,
            taken: Number(it.qty) || 0,
            returned: 0,
          }
        : null;
    })
    .filter(Boolean);
  // combine duplicate product rows so stock validation is accurate
  const takenByProduct = {};
  lineItems.forEach((li) => {
    takenByProduct[li.productId] = (takenByProduct[li.productId] || 0) + li.taken;
  });
  const overStock = Object.entries(takenByProduct).find(([pid, qty]) => {
    const p = products.find((x) => x.id === Number(pid));
    return p && qty > p.stock;
  });
  const totalTaken = lineItems.reduce((s, i) => s + i.taken, 0);
  function submit(e) {
    e.preventDefault();
    if (lineItems.length === 0 || totalTaken === 0 || overStock) return;
    onSave({ date, lineItems });
  }
  return (
    <Modal title="New Delivery Run — Stock Taken" onClose={onClose} cardBg={cardBg} dark={dark} wide={true}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Delivery Date" subText={subText}>
          <input
            type="date"
            required={true}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls(inputBg)}
          />
        </Field>
        <div>
          <p className={`text-xs font-medium mb-2 ${subText}`}>Stock Taken for This Run</p>
          <div className="space-y-2">
            {items.map((it, i) => {
              const p = products.find((x) => x.id === Number(it.productId));
              return (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={it.productId}
                    onChange={(e) => updateItem(i, { productId: e.target.value })}
                    className={`${inputCls(inputBg)} flex-1`}
                  >
                    {available.map((p2) => (
                      <option key={p2.id} value={p2.id}>
                        {p2.name}
                        {" ("}
                        {p2.stock}
                        {" in stock)"}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    max={p ? p.stock : undefined}
                    value={it.qty}
                    onChange={(e) => updateItem(i, { qty: e.target.value })}
                    className={`${inputCls(inputBg)} w-24`}
                    placeholder="Qty taken"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addRow}
            disabled={available.length === 0}
            className={`mt-2 text-xs font-medium flex items-center gap-1 disabled:opacity-40 ${dark ? "text-blue-400" : "text-blue-600"}`}
          >
            <Plus size={13} />
            {" Add product"}
          </button>
        </div>
        {overStock && (
          <p className="text-xs text-red-500">
            One of your quantities is more than the stock currently available for that product.
          </p>
        )}
        <div
          className={`flex justify-between items-center pt-3 border-t ${dark ? "border-slate-800" : "border-slate-100"} text-sm`}
        >
          <span className={subText}>Total Units Taken</span>
          <span className="text-lg font-bold">{totalTaken}</span>
        </div>
        <button
          type="submit"
          disabled={available.length === 0}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40"
        >
          <Route size={15} />
          {" Start Delivery Run"}
        </button>
      </form>
    </Modal>
  );
}
export function CompleteDeliveryModal({ run, onClose, onSave, dark, cardBg, subText, inputBg }) {
  // For every product taken out, the seller can record the stock sold at
  // several different prices (e.g. 25 papers at Rs 25 and 50 papers at Rs 30).
  // Whatever is left over is automatically treated as remaining stock and
  // put back into inventory when the run is closed.
  const [priceLines, setPriceLines] = useState(() =>
    run.lineItems.map((li) => [{ qty: String(li.taken), price: String(li.price) }]),
  );
  const [dailyExpense, setDailyExpense] = useState("");
  // Defaults to today, but is editable — closing a run days after it actually
  // happened (e.g. a run started Aug 10 but only closed later) must still
  // post the sale, cash and ledger entries under the real sale date, or the
  // Cash Book and P&L for that date will silently be missing the money.
  const [completedDate, setCompletedDate] = useState(() => run.completedDate || todayISO());
  // Credit bills — optional. Shops that took goods from the delivery without
  // paying. Added only when the "+ Add Credit Bill" button is clicked.
  const [creditBills, setCreditBills] = useState([]);
  function blankCreditItem() {
    const first = run.lineItems[0];
    return {
      productId: first ? String(first.productId) : "",
      qty: "",
      price: first ? String(first.price) : "",
    };
  }
  function addBill() {
    setCreditBills((prev) => [...prev, { shop: "", note: "", items: [blankCreditItem()] }]);
  }
  function removeBill(bi) {
    setCreditBills((prev) => prev.filter((_, i) => i !== bi));
  }
  function updateBill(bi, patch) {
    setCreditBills((prev) => prev.map((b, i) => (i === bi ? { ...b, ...patch } : b)));
  }
  function addBillItem(bi) {
    setCreditBills((prev) =>
      prev.map((b, i) => (i === bi ? { ...b, items: [...b.items, blankCreditItem()] } : b)),
    );
  }
  function removeBillItem(bi, ii) {
    setCreditBills((prev) =>
      prev.map((b, i) =>
        i === bi ? { ...b, items: b.items.length > 1 ? b.items.filter((_, j) => j !== ii) : b.items } : b,
      ),
    );
  }
  function updateBillItem(bi, ii, patch) {
    setCreditBills((prev) =>
      prev.map((b, i) =>
        i === bi ? { ...b, items: b.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) } : b,
      ),
    );
  }
  function onBillProductChange(bi, ii, productId) {
    const li = run.lineItems.find((l) => String(l.productId) === String(productId));
    updateBillItem(bi, ii, { productId, price: li ? String(li.price) : "" });
  }
  function updateLine(i, j, patch) {
    setPriceLines((prev) =>
      prev.map((set, idx) =>
        idx === i ? set.map((ln, jdx) => (jdx === j ? { ...ln, ...patch } : ln)) : set,
      ),
    );
  }
  function addLine(i) {
    setPriceLines((prev) =>
      prev.map((set, idx) => {
        if (idx !== i) return set;
        const li = run.lineItems[i];
        const used = set.reduce((s, ln) => s + (Number(ln.qty) || 0), 0);
        const left = Math.max(0, li.taken - used);
        return [...set, { qty: String(left), price: String(li.price) }];
      }),
    );
  }
  function removeLine(i, j) {
    setPriceLines((prev) =>
      prev.map((set, idx) => (idx === i && set.length > 1 ? set.filter((_, jdx) => jdx !== j) : set)),
    );
  }
  const rows = run.lineItems.map((li, i) => {
    const entries = (priceLines[i] || []).map((ln) => ({
      qty: Math.max(0, numVal(ln.qty, 0)),
      price: Math.max(0, round2(ln.price)),
    }));
    const sold = entries.reduce((s, e) => s + e.qty, 0);
    const saleAmount = round2(entries.reduce((s, e) => s + e.qty * e.price, 0));
    const returned = li.taken - sold;
    return {
      ...li,
      sales: entries.filter((e) => e.qty > 0),
      sold,
      saleAmount,
      returned: Math.max(0, returned),
      avgPrice: sold > 0 ? round2(saleAmount / sold) : 0,
      over: sold > li.taken,
    };
  });
  const anyOver = rows.some((r) => r.over);
  const soldQty = rows.reduce((s, r) => s + r.sold, 0);
  const saleAmount = round2(rows.reduce((s, r) => s + r.saleAmount, 0));
  const costAmount = round2(rows.reduce((s, r) => s + r.sold * r.cost, 0));
  const remainingQty = rows.reduce((s, r) => s + r.returned, 0);
  const dailyExpenseNum = round2(dailyExpense);
  const grossProfit = round2(saleAmount - costAmount);
  const netProfit = round2(grossProfit - dailyExpenseNum);
  // ---- credit bills: normalise, total up and validate against what was sold
  const creditRows = creditBills.map((b) => {
    const items = b.items.map((it) => {
      const li = run.lineItems.find((l) => String(l.productId) === String(it.productId));
      const qty = Math.max(0, numVal(it.qty, 0));
      const price = Math.max(0, round2(it.price));
      return {
        productId: li ? li.productId : null,
        name: li ? li.name : "",
        unit: (li && li.unit) || "pc",
        cost: li ? li.cost : 0,
        qty,
        price,
        lineTotal: round2(qty * price),
      };
    });
    const validItems = items.filter((it) => it.productId != null && it.qty > 0);
    return {
      shop: (b.shop || "").trim(),
      note: (b.note || "").trim(),
      items,
      validItems,
      qty: validItems.reduce((s, it) => s + it.qty, 0),
      total: round2(validItems.reduce((s, it) => s + it.lineTotal, 0)),
    };
  });
  const creditTotal = round2(creditRows.reduce((s, b) => s + b.total, 0));
  const creditQtyByProduct = {};
  creditRows.forEach((b) =>
    b.validItems.forEach((it) => {
      creditQtyByProduct[it.productId] = (creditQtyByProduct[it.productId] || 0) + it.qty;
    }),
  );
  const creditOverRows = rows.filter((r) => (creditQtyByProduct[r.productId] || 0) > r.sold);
  const creditMissingShop = creditRows.some((b) => !b.shop);
  const creditEmptyBill = creditRows.some((b) => b.validItems.length === 0);
  const creditInvalid = creditOverRows.length > 0 || creditMissingShop || creditEmptyBill;
  const cashCollected = round2(saleAmount - creditTotal);
  function submit(e) {
    e.preventDefault();
    if (anyOver || creditInvalid) return;
    onSave(run, rows, {
      dailyExpense: dailyExpenseNum,
      creditBills: creditRows.map((b) => ({
        shop: b.shop,
        note: b.note,
        items: b.validItems,
        qty: b.qty,
        total: b.total,
      })),
      completedDate: completedDate || todayISO(),
    });
  }
  return (
    <Modal
      title={`Close Delivery Run ${run.id} — Sales & Stock Remaining`}
      onClose={onClose}
      cardBg={cardBg}
      dark={dark}
      wide={true}
    >
      <form onSubmit={submit} className="space-y-4">
        <p className={`text-xs ${subText}`}>
          For each product, enter how many units were sold and at what price. Add a price line for every
          different price you sold that product at. Anything not entered is treated as stock remaining and
          goes back into inventory automatically.
        </p>
        <div className="space-y-3">
          {run.lineItems.map((li, i) => {
            const r = rows[i];
            return (
              <div
                key={i}
                className={`rounded-xl border p-3 ${r.over ? "border-red-400" : dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{li.name}</p>
                    <p className={`text-xs ${subText}`}>
                      {"Taken: "}
                      {li.taken} {li.unit || "pc"}
                      {" \u00B7 Normal price "}
                      {money(li.price)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className={`text-[11px] font-medium ${subText}`}>Sold</p>
                      <p className={`text-sm font-bold ${r.over ? "text-red-600" : ""}`}>{r.sold}</p>
                    </div>
                    <div>
                      <p className={`text-[11px] font-medium ${subText}`}>Remaining</p>
                      <p className="text-sm font-bold">{r.returned}</p>
                    </div>
                    <div>
                      <p className={`text-[11px] font-medium ${subText}`}>Amount</p>
                      <p className="text-sm font-bold">{money(r.saleAmount)}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <div className={`flex items-center gap-2 text-[11px] font-medium ${subText}`}>
                    <span className="w-24">Qty sold</span>
                    <span className="w-8">at</span>
                    <span className="w-28">Price each</span>
                    <span className="flex-1 text-right">Line total</span>
                    <span className="w-9" />
                  </div>
                  {(priceLines[i] || []).map((ln, j) => {
                    const q = Math.max(0, numVal(ln.qty, 0));
                    const pr = Math.max(0, round2(ln.price));
                    return (
                      <div key={j} className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max={li.taken}
                          value={ln.qty}
                          onChange={(e) => updateLine(i, j, { qty: e.target.value })}
                          className={`${inputCls(inputBg)} w-24`}
                          placeholder="0"
                        />
                        <span className={`w-8 text-center text-xs ${subText}`}>@</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ln.price}
                          onChange={(e) => updateLine(i, j, { price: e.target.value })}
                          className={`${inputCls(inputBg)} w-28`}
                          placeholder="0"
                        />
                        <span className="flex-1 text-right text-sm font-medium">{money(q * pr)}</span>
                        <button
                          type="button"
                          onClick={() => removeLine(i, j)}
                          disabled={(priceLines[i] || []).length <= 1}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 shrink-0 disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => addLine(i)}
                    className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
                  >
                    <Plus size={13} />
                    {" Add another price for this item"}
                  </button>
                </div>
                {r.over && (
                  <p className="text-xs text-red-500 mt-2">
                    Sold quantity ({r.sold}
                    {") is more than the "}
                    {li.taken}
                    {" taken out for this run."}
                  </p>
                )}
                {!r.over && r.sold > 0 && r.sales.length > 1 && (
                  <p className={`text-[11px] mt-2 ${subText}`}>
                    {"Average selling price "}
                    {money(r.avgPrice)}
                    {" \u00B7 normal price "}
                    {money(li.price)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div
          className={`rounded-xl border p-3 ${creditInvalid ? "border-red-400" : dark ? "border-slate-800" : "border-slate-100"}`}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-2">
                <Building2 size={14} />
                {" Credit Bills (optional)"}
              </p>
              <p className={`text-xs ${subText} mt-0.5`}>
                Only use this if a shop took goods without paying. Each bill becomes an unpaid Sales Order you
                can collect against later.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-[11px] font-medium ${subText}`}>Total on credit</p>
              <p className="text-sm font-bold">{money(creditTotal)}</p>
            </div>
          </div>
          {creditBills.length > 0 && (
            <div className="mt-3 space-y-3">
              {creditRows.map((b, bi) => (
                <div
                  key={bi}
                  className={`rounded-xl border p-3 ${dark ? "border-slate-800 bg-slate-800/30" : "border-slate-200 bg-slate-50/60"}`}
                >
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <Field label={`Shop Name (credit bill ${bi + 1})`} subText={subText}>
                        <input
                          value={creditBills[bi].shop}
                          onChange={(e) => updateBill(bi, { shop: e.target.value })}
                          className={inputCls(inputBg)}
                          placeholder="e.g. New Sarasavi Book Shop"
                        />
                      </Field>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <Field label="Note / Phone (optional)" subText={subText}>
                        <input
                          value={creditBills[bi].note}
                          onChange={(e) => updateBill(bi, { note: e.target.value })}
                          className={inputCls(inputBg)}
                          placeholder="Contact or remark"
                        />
                      </Field>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBill(bi)}
                      title="Remove this credit bill"
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className={`flex items-center gap-2 text-[11px] font-medium mt-3 ${subText}`}>
                    <span className="flex-1 min-w-0">Goods purchased</span>
                    <span className="w-20">Qty</span>
                    <span className="w-24">Price each</span>
                    <span className="w-24 text-right">Line total</span>
                    <span className="w-9" />
                  </div>
                  <div className="space-y-2 mt-1">
                    {creditBills[bi].items.map((it, ii) => (
                      <div key={ii} className="flex items-center gap-2">
                        <select
                          value={it.productId}
                          onChange={(e) => onBillProductChange(bi, ii, e.target.value)}
                          className={`${inputCls(inputBg)} flex-1 min-w-0`}
                        >
                          <option value="">Select goods...</option>
                          {run.lineItems.map((li) => (
                            <option key={li.productId} value={li.productId}>
                              {li.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={it.qty}
                          onChange={(e) => updateBillItem(bi, ii, { qty: e.target.value })}
                          className={`${inputCls(inputBg)} w-20`}
                          placeholder="0"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={it.price}
                          onChange={(e) => updateBillItem(bi, ii, { price: e.target.value })}
                          className={`${inputCls(inputBg)} w-24`}
                          placeholder="0"
                        />
                        <span className="w-24 text-right text-sm font-medium">
                          {money(b.items[ii] ? b.items[ii].lineTotal : 0)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBillItem(bi, ii)}
                          disabled={creditBills[bi].items.length <= 1}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 shrink-0 disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => addBillItem(bi)}
                      className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
                    >
                      <Plus size={13} />
                      {" Add another item to this bill"}
                    </button>
                    <p className="text-sm">
                      <span className={subText}>{"Bill total: "}</span>
                      <span className="font-bold">{money(b.total)}</span>
                    </p>
                  </div>
                  {!b.shop && (
                    <p className="text-xs text-red-500 mt-2">Enter the shop name for this credit bill.</p>
                  )}
                  {b.shop && b.validItems.length === 0 && (
                    <p className="text-xs text-red-500 mt-2">
                      Add at least one item with a quantity greater than 0.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          {creditOverRows.length > 0 && (
            <p className="text-xs text-red-500 mt-2">
              {"Credit quantity is more than the quantity sold for: "}
              {creditOverRows
                .map((r) => `${r.name} (sold ${r.sold}, on credit ${creditQtyByProduct[r.productId] || 0})`)
                .join(", ")}
              . Credit goods must be part of what you recorded as sold above.
            </p>
          )}
          <button
            type="button"
            onClick={addBill}
            disabled={run.lineItems.length === 0}
            className={`mt-3 flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border border-dashed transition-colors disabled:opacity-40 ${dark ? "border-slate-700 text-blue-400 hover:bg-slate-800" : "border-slate-300 text-blue-600 hover:bg-blue-50"}`}
          >
            <Plus size={15} />
            {creditBills.length === 0 ? " Add Credit Bill" : " Add Another Credit Shop"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sale Date" subText={subText}>
            <input
              type="date"
              value={completedDate}
              onChange={(e) => setCompletedDate(e.target.value)}
              className={inputCls(inputBg)}
            />
          </Field>
          <Field label="Daily Expense" subText={subText}>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={dailyExpense}
              onChange={(e) => setDailyExpense(e.target.value)}
              className={inputCls(inputBg)}
              placeholder="0.00"
            />
          </Field>
        </div>
        <p className={`text-xs ${subText} -mt-2`}>
          {
            "Defaults to today — change this if you're closing out a run for an earlier day (e.g. a run started on the 10th but only closed now), so it posts to the Cash Book and P&L on the correct date."
          }
        </p>
        <div
          className={`rounded-xl border p-4 space-y-1.5 text-sm ${dark ? "border-slate-800" : "border-slate-100"}`}
        >
          <div className="flex justify-between">
            <span className={subText}>Units Sold</span>
            <span className="font-medium">{soldQty}</span>
          </div>
          <div className="flex justify-between">
            <span className={subText}>Units Remaining (back to stock)</span>
            <span className="font-medium">{remainingQty}</span>
          </div>
          <div className="flex justify-between">
            <span className={subText}>Total Sales</span>
            <span className="font-medium">{money(saleAmount)}</span>
          </div>
          {creditTotal > 0 && (
            <div className="flex justify-between">
              <span className={subText}>
                {"\u2014 Sold on credit ("}
                {creditRows.length}
                {creditRows.length === 1 ? " shop)" : " shops)"}
              </span>
              <span className="font-medium text-amber-600">{money(creditTotal)}</span>
            </div>
          )}
          {creditTotal > 0 && (
            <div className="flex justify-between">
              <span className={subText}>{"\u2014 Cash collected"}</span>
              <span className="font-medium">{money(cashCollected)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className={subText}>Cost of Goods Sold</span>
            <span className="font-medium">{money(costAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className={subText}>Daily Expense</span>
            <span className="font-medium">{money(dailyExpenseNum)}</span>
          </div>
          <div className="flex justify-between pt-1.5 border-t border-dashed">
            <span className="font-semibold">Gross Profit</span>
            <span className={`font-bold ${grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {money(grossProfit)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Net Profit</span>
            <span className={`font-bold ${netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {money(netProfit)}
            </span>
          </div>
        </div>
        <button
          type="submit"
          disabled={anyOver || creditInvalid}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-emerald-900/20 transition-colors disabled:opacity-40"
        >
          <CheckCircle2 size={15} />
          {creditTotal > 0
            ? " Close Run — Record Sale & Create Credit Bills"
            : " Close Run — Add Remaining Stock Back & Record Sale"}
        </button>
      </form>
    </Modal>
  );
}
export function DeliveryStock({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  products,
  setProducts,
  deliveryRuns,
  setDeliveryRuns,
  ledger,
  setLedger,
  salesOrders,
  setSalesOrders,
}) {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [closingRun, setClosingRun] = useState(null);
  const [selected, setSelected] = useState(null);
  // ---- Correct Sale Date: fixes a run (and everything it posted — the cash
  // sale, cost of goods, daily expense and any credit bills) onto the date it
  // actually happened, for runs that were closed under the wrong date before
  // the Sale Date field existed on the Close Run screen.
  const [editingDateRun, setEditingDateRun] = useState(null);
  const [dateDraft, setDateDraft] = useState("");
  function openDateEdit(run) {
    setEditingDateRun(run);
    setDateDraft(run.completedDate || todayISO());
  }
  function saveDateEdit() {
    const run = editingDateRun;
    if (!run || !dateDraft) {
      setEditingDateRun(null);
      return;
    }
    const relatedIds = [run.ledgerTxnId, run.creditTxnId, ...(run.expenseTxnIds || [])].filter(Boolean);
    if (relatedIds.length) {
      setLedger((prev) => prev.map((t) => (relatedIds.includes(t.id) ? { ...t, date: dateDraft } : t)));
    }
    if (run.creditOrderIds && run.creditOrderIds.length) {
      setSalesOrders((prev) =>
        prev.map((o) => (run.creditOrderIds.includes(o.id) ? { ...o, date: dateDraft } : o)),
      );
    }
    setDeliveryRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, completedDate: dateDraft } : r)));
    setSelected((s) => (s && s.id === run.id ? { ...s, completedDate: dateDraft } : s));
    setToast(
      `Delivery run ${run.id} moved to ${fmtDate(dateDraft)} — its Cash Book, Ledger and P&L entries were updated to match.`,
    );
    setEditingDateRun(null);
  }
  const filtered = deliveryRuns.filter((r) => r.id.toLowerCase().includes(query.toLowerCase()));
  const ongoing = deliveryRuns.filter((r) => r.status === "Ongoing");
  const completed = deliveryRuns.filter((r) => r.status === "Completed");
  const today = todayISO();
  const todaysSales = completed
    .filter((r) => r.completedDate === today)
    .reduce((s, r) => s + r.saleAmount, 0);
  const todaysProfit = completed
    .filter((r) => r.completedDate === today)
    .reduce((s, r) => s + (r.netProfit != null ? r.netProfit : r.profit), 0);
  async function startRun({ date, lineItems }) {
    const merged = {};
    lineItems.forEach((li) => {
      if (merged[li.productId]) merged[li.productId].taken += li.taken;
      else merged[li.productId] = { ...li };
    });
    const finalItems = Object.values(merged);
    setProducts((prev) =>
      prev.map((p) => {
        const li = finalItems.find((l) => l.productId === p.id);
        return li ? { ...p, stock: Math.max(0, p.stock - li.taken) } : p;
      }),
    );
    const runId = await nextSeq(deliveryRuns, "id", "DR-", 1000);
    setDeliveryRuns((prev) => [
      {
        id: runId,
        date,
        status: "Ongoing",
        lineItems: finalItems,
        totalTaken: finalItems.reduce((s, i) => s + i.taken, 0),
        completedDate: null,
        soldQty: null,
        saleAmount: null,
        costAmount: null,
        dailyExpense: null,
        profit: null,
        netProfit: null,
        ledgerTxnId: null,
        creditTxnId: null,
        expenseTxnIds: [],
      },
      ...prev,
    ]);
    setToast(`Delivery run ${runId} started — stock taken out and deducted from inventory.`);
    setModalOpen(false);
  }
  async function closeRun(run, rows, expenses) {
    const dailyExpense = (expenses && expenses.dailyExpense) || 0;
    const creditBills = (expenses && expenses.creditBills) || [];
    setProducts((prev) =>
      prev.map((p) => {
        const row = rows.find((r) => r.productId === p.id);
        return row && row.returned > 0 ? { ...p, stock: p.stock + row.returned } : p;
      }),
    );
    const soldQty = rows.reduce((s, r) => s + r.sold, 0);
    // each row carries its own sale value, built from the price(s) actually charged
    const saleAmount = rows.reduce((s, r) => s + (r.saleAmount != null ? r.saleAmount : r.sold * r.price), 0);
    const costAmount = rows.reduce((s, r) => s + r.sold * r.cost, 0);
    const profit = saleAmount - costAmount; // Gross Profit
    const netProfit = profit - dailyExpense;
    // Use the date the user actually picked when closing the run (defaults to
    // today, but is editable) so a run closed days late still posts to the
    // Cash Book, Ledger and P&L under the real sale date instead of "today".
    const completedDate = (expenses && expenses.completedDate) || todayISO();
    // ---- credit bills become unpaid Sales Orders shown on the Sales Orders page.
    // Computed BEFORE the ledger entries below, because the credit portion of a
    // sale is not cash received and must never hit the Cash Book.
    const creditAmount = round2(creditBills.reduce((s, b) => s + b.total, 0));
    const cashCollected = round2(saleAmount - creditAmount);
    const expenseTxnIds = [];
    const ledgerAdditions = [];
    let cashTxnId = null;
    let creditTxnId = null;
    // Cash actually collected on delivery — this is the only part that should
    // ever increase a Cash Account balance.
    if (cashCollected > 0) {
      cashTxnId = await nextSeq([...ledger, ...ledgerAdditions], "id", "TXN-", 8821);
      ledgerAdditions.push({
        id: cashTxnId,
        date: completedDate,
        desc: `Delivery sales — ${run.id}`,
        type: "Income",
        category: "Sales",
        amount: cashCollected,
        account: MAIN_CASH_ID,
        kind: "revenue",
        cash: true,
        attachment: null,
      });
    }
    // Revenue sold on credit — still counts in P&L on the day of sale (goods
    // left the shop), but is money owed, not money received, so it's flagged
    // as non-cash and never touches the Cash Book. It becomes a receivable via
    // the credit-bill Sales Orders created below, and is booked as an actual
    // cash receipt only when it's later collected.
    if (creditAmount > 0) {
      creditTxnId = await nextSeq([...ledger, ...ledgerAdditions], "id", "TXN-", 8821);
      ledgerAdditions.push({
        id: creditTxnId,
        date: completedDate,
        desc: `Delivery sales on credit — ${run.id}`,
        type: "Income",
        category: "Sales",
        amount: creditAmount,
        account: null,
        kind: "revenue",
        cash: false,
        attachment: null,
      });
    }
    if (costAmount > 0) {
      const cId = await nextSeq([...ledger, ...ledgerAdditions], "id", "TXN-", 8821);
      expenseTxnIds.push(cId);
      ledgerAdditions.push({
        id: cId,
        date: completedDate,
        desc: `Cost of goods sold — ${run.id}`,
        type: "Expense",
        category: "Cost of Goods Sold",
        amount: costAmount,
        attachment: null,
      });
    }
    if (dailyExpense > 0) {
      const eId = await nextSeq([...ledger, ...ledgerAdditions], "id", "TXN-", 8821);
      expenseTxnIds.push(eId);
      ledgerAdditions.push({
        id: eId,
        date: completedDate,
        desc: `Delivery daily expense — ${run.id}`,
        type: "Expense",
        category: "Daily Expense",
        amount: dailyExpense,
        attachment: null,
      });
    }
    const creditOrders = [];
    for (const b of creditBills) {
      const pool = [...(salesOrders || []), ...creditOrders];
      creditOrders.push({
        id: await nextSeq(pool, "id", "SO-", 1042),
        invoice: await nextSeq(pool, "invoice", "INV-", 2461),
        customer: b.shop,
        customerId: null,
        items: b.items.reduce((s, i) => s + i.qty, 0),
        lineItems: b.items.map((i) => ({
          productId: i.productId,
          name: i.name,
          qty: i.qty,
          price: i.price,
          unit: i.unit || "pc",
        })),
        amount: b.total,
        tax: 0,
        status: "Delivered",
        payment: "Pending",
        date: completedDate,
        channel: "Delivery Credit",
        attachment: null,
        amountPaid: 0,
        payments: [],
        isCredit: true,
        fromDelivery: run.id,
        note: b.note || "",
      });
    }
    if (creditOrders.length) {
      setSalesOrders((prev) => [...creditOrders, ...prev]);
    }
    setDeliveryRuns((prev) =>
      prev.map((r) =>
        r.id === run.id
          ? {
              ...r,
              lineItems: rows,
              status: "Completed",
              completedDate,
              soldQty,
              saleAmount,
              costAmount,
              dailyExpense,
              profit,
              netProfit,
              ledgerTxnId: cashTxnId,
              creditTxnId,
              expenseTxnIds,
              creditBills,
              creditAmount,
              cashCollected,
              creditOrderIds: creditOrders.map((o) => o.id),
            }
          : r,
      ),
    );
    if (ledgerAdditions.length) {
      setLedger((prev) => [...ledgerAdditions, ...prev]);
    }
    setToast(
      creditOrders.length
        ? `Delivery run ${run.id} closed — ${money(saleAmount)} in sales (${money(creditAmount)} on credit from ${creditOrders.length} shop${creditOrders.length === 1 ? "" : "s"}). Credit bills added to Sales Orders.`
        : `Delivery run ${run.id} closed — ${money(saleAmount)} in sales, ${money(netProfit)} net profit. Remaining stock added back.`,
    );
    setClosingRun(null);
  }
  function deleteRun(run) {
    if (
      !window.confirm(
        `Delete delivery run ${run.id}? This will reverse its stock movements${run.status === "Completed" ? " and remove its recorded sale" : ""}${run.creditOrderIds && run.creditOrderIds.length ? ` and delete its ${run.creditOrderIds.length} credit bill(s) from Sales Orders` : ""}. This cannot be undone.`,
      )
    )
      return;
    setProducts((prev) =>
      prev.map((p) => {
        const li = run.lineItems.find((l) => l.productId === p.id);
        if (!li) return p;
        if (run.status === "Ongoing") {
          // stock was taken out and never returned — give it back
          return { ...p, stock: p.stock + li.taken };
        }
        // completed: the returned portion was already added back — remove it again
        return { ...p, stock: Math.max(0, p.stock - (li.returned || 0)) };
      }),
    );
    if (run.ledgerTxnId) {
      setLedger((prev) => prev.filter((t) => t.id !== run.ledgerTxnId));
    }
    if (run.creditTxnId) {
      setLedger((prev) => prev.filter((t) => t.id !== run.creditTxnId));
    }
    if (run.expenseTxnIds && run.expenseTxnIds.length) {
      setLedger((prev) => prev.filter((t) => !run.expenseTxnIds.includes(t.id)));
    }
    if (run.creditOrderIds && run.creditOrderIds.length) {
      setSalesOrders((prev) => prev.filter((o) => !run.creditOrderIds.includes(o.id)));
    }
    setDeliveryRuns((prev) => prev.filter((r) => r.id !== run.id));
    setSelected((s) => (s && s.id === run.id ? null : s));
    setClosingRun((r) => (r && r.id === run.id ? null : r));
    setToast(`Delivery run ${run.id} deleted.`);
  }
  const correctDateButton =
    selected && selected.status === "Completed" ? (
      <button
        onClick={() => openDateEdit(selected)}
        className={`flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl transition-colors ${dark ? "text-blue-400 hover:bg-slate-800" : "text-blue-600 hover:bg-blue-50"}`}
      >
        <Pencil size={14} />
        {" Correct Sale Date"}
      </button>
    ) : null;
  const editDateModal = editingDateRun ? (
    <Modal
      title={`Correct Sale Date \u2014 ${editingDateRun.id}`}
      onClose={() => setEditingDateRun(null)}
      cardBg={cardBg}
      dark={dark}
    >
      <div className="space-y-4">
        <p className={`text-xs ${subText}`}>
          {
            "Moves the sale, cost of goods sold, daily expense and any credit-bill entries for this run onto the date below \u2014 everywhere they appear: Cash Book, Ledger, Dashboard and Profit & Loss."
          }
        </p>
        <Field label="Correct Sale Date" subText={subText}>
          <input
            type="date"
            value={dateDraft}
            onChange={(e) => setDateDraft(e.target.value)}
            className={inputCls(inputBg)}
          />
        </Field>
        <button
          onClick={saveDateEdit}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} />
          {" Save Correct Date"}
        </button>
      </div>
    </Modal>
  ) : null;
  return (
    <div className="space-y-5">
      {editDateModal}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Delivery Stock</h1>
          <p className={`text-sm ${subText}`}>
            Record the stock taken out for delivery, then close the run with what came back to update stock,
            sales and profit automatically
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={products.filter((p) => p.stock > 0).length === 0}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40"
        >
          <Plus size={16} />
          {" New Delivery Run"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Out for Delivery</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{ongoing.length}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Completed Runs</p>
          <p className="text-xl font-bold mt-1 text-emerald-600">{completed.length}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Today&apos;s Delivery Sales</p>
          <p className="text-xl font-bold mt-1">{money(todaysSales)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Today&apos;s Net Profit</p>
          <p className={`text-xl font-bold mt-1 ${todaysProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {money(todaysProfit)}
          </p>
        </div>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-72 ${inputBg}`}>
            <Search size={15} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search run #..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Run #</th>
                <th className="font-medium py-3 px-2">Date</th>
                <th className="font-medium py-3 px-2">Products</th>
                <th className="font-medium py-3 px-2">Taken</th>
                <th className="font-medium py-3 px-2">Sold</th>
                <th className="font-medium py-3 px-2">Sale Income</th>
                <th className="font-medium py-3 px-2">Gross Profit</th>
                <th className="font-medium py-3 px-2">Net Profit</th>
                <th className="font-medium py-3 px-2">Status</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(
                (r) => (
                  <tr
                    key={r.id}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors cursor-pointer`}
                    onClick={() => (r.status === "Ongoing" ? setClosingRun(r) : setSelected(r))}
                  >
                    <td className="py-3 px-5 font-medium">{r.id}</td>
                    <td className={`py-3 px-2 ${subText}`}>{fmtDate(r.date)}</td>
                    <td className={`py-3 px-2 ${subText}`}>{r.lineItems.length}</td>
                    <td className="py-3 px-2">{r.totalTaken}</td>
                    <td className="py-3 px-2">{r.soldQty === null ? "—" : r.soldQty}</td>
                    <td className="py-3 px-2 font-medium">
                      {r.saleAmount === null ? "—" : money(r.saleAmount)}
                    </td>
                    <td
                      className={`py-3 px-2 font-medium ${r.profit !== null && r.profit < 0 ? "text-red-600" : ""}`}
                    >
                      {r.profit == null ? "—" : money(r.profit)}
                    </td>
                    <td
                      className={`py-3 px-2 font-medium ${r.netProfit !== null && r.netProfit < 0 ? "text-red-600" : ""}`}
                    >
                      {r.netProfit == null ? "—" : money(r.netProfit)}
                    </td>
                    <td className="py-3 px-2">
                      <Badge tone={r.status === "Completed" ? "green" : "amber"}>
                        {r.status === "Ongoing" ? "Out for Delivery" : "Completed"}
                      </Badge>
                    </td>
                    <td className="py-3 px-5">
                      <div className="flex items-center justify-end gap-1.5">
                        {r.status === "Ongoing" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setClosingRun(r);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            Close Run
                          </button>
                        )}
                        {r.status === "Completed" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDateEdit(r);
                            }}
                            title="Correct the sale date for this run"
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-100 text-slate-500"}`}
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRun(r);
                          }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
                filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className={`text-center py-10 text-sm ${subText}`}>
                      No delivery runs yet. Start one to record the stock taken out for today&apos;s delivery.
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {modalOpen && (
          <DeliveryRunModal
            onClose={() => setModalOpen(false)}
            onSave={startRun}
            dark={dark}
            cardBg={cardBg}
            subText={subText}
            inputBg={inputBg}
            products={products}
          />
        )}
        {closingRun && (
          <CompleteDeliveryModal
            run={closingRun}
            onClose={() => setClosingRun(null)}
            onSave={closeRun}
            dark={dark}
            cardBg={cardBg}
            subText={subText}
            inputBg={inputBg}
          />
        )}
        {selected && (
          <Modal
            title={`Delivery Run ${selected.id}`}
            onClose={() => setSelected(null)}
            cardBg={cardBg}
            dark={dark}
            wide={true}
          >
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className={subText}>Date Taken</span>
                <span className="font-medium">{fmtDate(selected.date)}</span>
              </div>
              <div className="flex justify-between">
                <span className={subText}>Status</span>
                <Badge tone={selected.status === "Completed" ? "green" : "amber"}>
                  {selected.status === "Ongoing" ? "Out for Delivery" : "Completed"}
                </Badge>
              </div>
              {selected.completedDate && (
                <div className="flex justify-between">
                  <span className={subText}>Date Closed</span>
                  <span>{fmtDate(selected.completedDate)}</span>
                </div>
              )}
              <div className={`border-t pt-3 ${dark ? "border-slate-800" : "border-slate-100"}`}>
                <p className={`text-xs font-medium mb-2 ${subText}`}>Items</p>
                <div className={"grid grid-cols-5 gap-2 text-[11px] font-medium mb-1 " + subText}>
                  <span>Product</span>
                  <span className="text-right">Taken</span>
                  <span className="text-right">Sold</span>
                  <span className="text-right">Remaining</span>
                  <span className="text-right">Amount</span>
                </div>
                {selected.lineItems.map((li, i) => {
                  const sold = li.sold != null ? li.sold : li.taken - (li.returned || 0);
                  const amount = li.saleAmount != null ? li.saleAmount : sold * li.price;
                  return (
                    <div key={i} className="py-1">
                      <div className="grid grid-cols-5 gap-2 text-xs">
                        <span className="truncate">{li.name}</span>
                        <span className="text-right">{li.taken}</span>
                        <span className="text-right font-medium">{sold}</span>
                        <span className="text-right">{li.returned || 0}</span>
                        <span className="text-right font-medium">{money(amount)}</span>
                      </div>
                      {li.sales && li.sales.length > 0 && (
                        <div className={`pl-3 mt-0.5 space-y-0.5`}>
                          {li.sales.map((sale, j) => (
                            <div key={j} className={`flex justify-between text-[11px] ${subText}`}>
                              <span>
                                {sale.qty} {li.unit || "pc"}
                                {" at "}
                                {money(sale.price)}
                                {" each"}
                              </span>
                              <span>{money(sale.qty * sale.price)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {selected.creditBills && selected.creditBills.length > 0 && (
                <div className={`border-t pt-3 ${dark ? "border-slate-800" : "border-slate-100"}`}>
                  <p className={`text-xs font-medium mb-2 ${subText}`}>
                    Credit Bills — goods given without payment
                  </p>
                  {selected.creditBills.map((b, i) => (
                    <div
                      key={i}
                      className={`rounded-xl border p-2.5 mb-2 ${dark ? "border-slate-800" : "border-slate-100"}`}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-xs font-semibold">{b.shop}</span>
                        <span className="text-xs font-bold">{money(b.total)}</span>
                      </div>
                      {(b.items || []).map((it, j) => (
                        <div key={j} className={`flex justify-between text-[11px] ${subText} mt-0.5`}>
                          <span>
                            {it.name}
                            {" \u00D7 "}
                            {it.qty}
                            {" at "}
                            {money(it.price)}
                          </span>
                          <span>{money(it.lineTotal)}</span>
                        </div>
                      ))}
                      {b.note && <p className={`text-[11px] mt-1 ${subText}`}>{b.note}</p>}
                    </div>
                  ))}
                  <p className={`text-[11px] ${subText}`}>
                    These appear as unpaid orders on the Sales Orders page, where payments can be recorded.
                  </p>
                </div>
              )}
              {selected.status === "Completed" && (
                <div
                  className={`space-y-1.5 pt-2 border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <div className="flex justify-between">
                    <span className={subText}>Total Sales</span>
                    <span className="font-medium">{money(selected.saleAmount)}</span>
                  </div>
                  {selected.creditAmount > 0 && (
                    <div className="flex justify-between">
                      <span className={subText}>{"\u2014 Sold on credit"}</span>
                      <span className="font-medium text-amber-600">{money(selected.creditAmount)}</span>
                    </div>
                  )}
                  {selected.creditAmount > 0 && (
                    <div className="flex justify-between">
                      <span className={subText}>{"\u2014 Cash collected"}</span>
                      <span className="font-medium">
                        {money(
                          selected.cashCollected != null
                            ? selected.cashCollected
                            : selected.saleAmount - selected.creditAmount,
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className={subText}>Cost of Goods Sold</span>
                    <span className="font-medium">{money(selected.costAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={subText}>Daily Expense</span>
                    <span className="font-medium">{money(selected.dailyExpense || 0)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-dashed">
                    <span className="font-semibold">Gross Profit</span>
                    <span className={selected.profit >= 0 ? "text-emerald-600" : "text-red-600"}>
                      {money(selected.profit)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Net Profit</span>
                    <span
                      className={
                        (selected.netProfit != null ? selected.netProfit : selected.profit) >= 0
                          ? "text-emerald-600"
                          : "text-red-600"
                      }
                    >
                      {money(selected.netProfit != null ? selected.netProfit : selected.profit)}
                    </span>
                  </div>
                </div>
              )}
              {correctDateButton}
              <button
                onClick={() => deleteRun(selected)}
                className="flex items-center gap-2 text-red-500 hover:bg-red-50 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
              >
                <Trash2 size={14} />
                {" Delete Delivery Run"}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
