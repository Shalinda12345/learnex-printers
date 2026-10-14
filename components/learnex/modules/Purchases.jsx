import { useState } from "react";
import { AttachmentLink, Badge, Field, FileUpload, Modal, inputCls } from "@/components/learnex/ui";
import {
  MAIN_CASH_ID,
  SEED_CASH_ACCOUNTS,
  cashAccountBalance,
  computeNonPnL,
  payablesFromPOs,
  totalCash,
  txnKind,
} from "@/lib/learnex/accounting";
import { Plus, Save, Search, Trash2, Wallet } from "@/components/learnex/icons";
import { fmtDate, money, numVal, round2, round6, todayISO, weightedAvgCost } from "@/lib/learnex/utils";
import { nextSeq } from "@/lib/learnex/persistence";

/* =====================================================================
   PURCHASES — new page: create purchase orders, upload supplier invoice
   slips, and automatically receive stock + record the expense.
===================================================================== */
export function PurchaseOrderModal({
  onClose,
  onSave,
  dark,
  cardBg,
  subText,
  inputBg,
  rawMaterials,
  suppliers,
  cashAccounts,
  ledger,
}) {
  var _a, _b, _c;
  const [supplierId, setSupplierId] = useState(
    ((_a = suppliers[0]) === null || _a === void 0 ? void 0 : _a.id) || "",
  );
  const [items, setItems] = useState([
    {
      materialId: ((_b = rawMaterials[0]) === null || _b === void 0 ? void 0 : _b.id) || "",
      qty: 1,
      cost: ((_c = rawMaterials[0]) === null || _c === void 0 ? void 0 : _c.costPrice) || 0,
    },
  ]);
  const [attachment, setAttachment] = useState(null);
  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((prev) => {
      var _a, _b;
      return [
        ...prev,
        {
          materialId: ((_a = rawMaterials[0]) === null || _a === void 0 ? void 0 : _a.id) || "",
          qty: 1,
          cost: ((_b = rawMaterials[0]) === null || _b === void 0 ? void 0 : _b.costPrice) || 0,
        },
      ];
    });
  }
  function removeRow(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  const accs = cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
  // Default to the account the money genuinely comes out of. Keeping purchases
  // out of the Profit or Loss statement comes from how they are classified, not
  // from which account pays, so paying from real cash is both simpler and
  // keeps every account balance matching the money actually in hand.
  const generalAcc =
    accs.find((a) => a.purpose === "general" && a.type === "Cash") ||
    accs.find((a) => a.purpose === "general") ||
    accs[0];
  const defaultAcc = generalAcc.id;
  const [payMode, setPayMode] = useState("Paid");
  const [account, setAccount] = useState(defaultAcc);
  const [autoTopUp, setAutoTopUp] = useState(true);
  const [topUpFrom, setTopUpFrom] = useState(defaultAcc);
  const payBalance = cashAccountBalance(account, ledger || [], accs);
  const otherAccs = accs.filter((a) => a.id !== account);
  function onMaterialChange(i, materialId) {
    const m = rawMaterials.find((x) => x.id === Number(materialId));
    updateItem(i, { materialId, cost: m ? m.costPrice : 0 });
  }
  const lineItems = items
    .map((it) => {
      const m = rawMaterials.find((x) => x.id === Number(it.materialId));
      return m ? { materialId: m.id, name: m.name, qty: numVal(it.qty, 0), cost: round2(it.cost) } : null;
    })
    .filter(Boolean);
  const total = round2(lineItems.reduce((s, i) => s + i.cost * i.qty, 0));
  function submit(e) {
    e.preventDefault();
    if (!supplierId || lineItems.length === 0) return;
    onSave({
      supplierId: Number(supplierId),
      lineItems,
      total,
      attachment,
      payMode,
      account,
      autoTopUp,
      topUpFrom,
    });
  }
  return (
    <Modal title="New Purchase Order" onClose={onClose} cardBg={cardBg} dark={dark} wide={true}>
      <form onSubmit={submit} className="space-y-4">
        <p className={`text-xs ${subText}`}>
          A purchase is not an expense. It moves money out of your cash account and adds the same value to
          your raw material stock, so your profit is untouched. The cost only reaches the Profit or Loss
          statement later, as Cost of Goods Sold, when the finished goods are actually sold.
        </p>
        <Field label="Supplier" subText={subText}>
          <select
            required={true}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={inputCls(inputBg)}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {rawMaterials.length === 0 && (
          <p className="text-xs text-amber-600">
            No raw materials exist yet. Add one in the Raw Materials module first, or record this purchase and
            add materials afterward.
          </p>
        )}
        {rawMaterials.length > 0 && (
          <div>
            <p className={`text-xs font-medium mb-2 ${subText}`}>Raw Materials Purchased</p>
            <p className={`text-xs ${subText} mb-2`}>
              Enter the unit cost you actually paid. Each material&apos;s average cost is recalculated from
              the stock already on hand plus what is arriving, so earlier stock is never revalued at the new
              price.
            </p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={it.materialId}
                    onChange={(e) => onMaterialChange(i, e.target.value)}
                    className={`${inputCls(inputBg)} flex-1`}
                  >
                    {rawMaterials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={it.qty}
                    onChange={(e) => updateItem(i, { qty: e.target.value })}
                    className={`${inputCls(inputBg)} w-16`}
                    placeholder="Qty"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={it.cost}
                    onChange={(e) => updateItem(i, { cost: e.target.value })}
                    className={`${inputCls(inputBg)} w-24`}
                    placeholder="Unit cost"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className={`mt-2 text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
            >
              <Plus size={13} />
              {" Add line item"}
            </button>
          </div>
        )}
        <FileUpload
          label="Upload Supplier Invoice / Slip"
          value={attachment}
          onChange={setAttachment}
          dark={dark}
          subText={subText}
          inputBg={inputBg}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Settlement" subText={subText}>
            <select
              value={payMode}
              onChange={(e) => setPayMode(e.target.value)}
              className={inputCls(inputBg)}
            >
              <option value="Paid">{"Paid now \u2014 cash out"}</option>
              <option value="Unpaid">{"On credit \u2014 pay supplier later"}</option>
            </select>
          </Field>
          {payMode === "Paid" && (
            <Field label="Pay From Account" subText={subText}>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className={inputCls(inputBg)}
              >
                {accs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {payMode === "Paid" && (
          <p className={`text-xs ${subText}`}>
            {"Balance in that account right now: "}
            {money(payBalance)}
          </p>
        )}
        {payMode === "Paid" && total > payBalance && otherAccs.length > 0 && (
          <div className={`rounded-xl border p-3 ${dark ? "border-slate-700" : "border-slate-200"}`}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={autoTopUp}
                onChange={(e) => setAutoTopUp(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1">
                <p className="text-xs font-medium">
                  {"This account is short by "}
                  {money(round2(total - payBalance))}
                  {" \u2014 move it across automatically"}
                </p>
                <p className={`text-xs ${subText} mt-1 leading-relaxed`}>
                  The shortfall is transferred in before the purchase is paid, so no account is ever left with
                  a negative balance. The transfer is recorded in the cash book and does not affect profit.
                </p>
                {autoTopUp && (
                  <select
                    value={topUpFrom}
                    onChange={(e) => setTopUpFrom(e.target.value)}
                    className={`${inputCls(inputBg)} mt-2`}
                  >
                    {otherAccs.map((a) => (
                      <option key={a.id} value={a.id}>
                        {"Move from "}
                        {a.name}
                        {" \u2014 "}
                        {money(cashAccountBalance(a.id, ledger || [], accs))}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        )}
        {payMode === "Paid" && total > payBalance && !autoTopUp && (
          <p className="text-xs text-amber-600">
            {
              "Without the transfer this account will go below zero. The purchase is still recorded correctly \u2014 you can top it up later from Cash & Bank."
            }
          </p>
        )}
        {payMode === "Unpaid" && (
          <p className={`text-xs ${subText}`}>
            The goods are received into raw material stock now, and the amount is shown as a trade payable
            until you settle it from the Purchases list.
          </p>
        )}
        <div
          className={`flex justify-between items-center pt-3 border-t ${dark ? "border-slate-800" : "border-slate-100"} text-sm`}
        >
          <span className={subText}>Purchase Total</span>
          <span className="text-lg font-bold">{money(total)}</span>
        </div>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} />
          {" Save Purchase Order"}
        </button>
      </form>
    </Modal>
  );
}
export function Purchases({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  purchaseOrders,
  setPurchaseOrders,
  rawMaterials,
  setRawMaterials,
  suppliers,
  setSuppliers,
  ledger,
  setLedger,
  cashAccounts,
}) {
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const filtered = purchaseOrders.filter(
    (o) =>
      o.id.toLowerCase().includes(query.toLowerCase()) ||
      o.supplier.toLowerCase().includes(query.toLowerCase()),
  );
  const totalValue = purchaseOrders.reduce((s, o) => s + o.total, 0);
  const accs = cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
  // Purchases are paid with ordinary cash, so the default paying account is
  // simply the cash account.
  const purchaseAccId = (accs.find((a) => a.purpose === "general" && a.type === "Cash") || accs[0]).id;
  const cashAvailable = totalCash(ledger, accs);
  const spentOnPurchases = computeNonPnL(ledger, "", "").asset_purchase;
  const outstanding = payablesFromPOs(purchaseOrders);
  const accName = (id) => {
    const a = accs.find((x) => x.id === id);
    return a ? a.name : "Cash";
  };
  const poIsUnpaid = (o) => o.paymentStatus === "Unpaid";
  async function savePurchase({
    supplierId,
    lineItems,
    total,
    attachment,
    payMode,
    account,
    autoTopUp,
    topUpFrom,
  }) {
    const supplier = suppliers.find((s) => s.id === supplierId);
    const date = todayISO();
    const poId = await nextSeq(purchaseOrders, "id", "PO-", 4000);
    const unpaid = payMode === "Unpaid";
    const payAcc = account || purchaseAccId;
    // Purchasing never touches finished-goods inventory. Purchased raw
    // materials increase the matching Raw Material's available quantity.
    if (lineItems.length) {
      setRawMaterials((prev) =>
        prev.map((m) => {
          const li = lineItems.find((l) => l.materialId === m.id);
          if (!li) return m;
          // Weighted average cost. Overwriting the cost with the latest
          // supplier price would silently revalue stock bought earlier at a
          // different price, overstating inventory on the Statement of
          // Financial Position and mis-costing every later consumption.
          const newCost = weightedAvgCost(m.availableQty, m.costPrice, li.qty, li.cost);
          return {
            ...m,
            purchaseQty: round2(numVal(m.purchaseQty, 0) + numVal(li.qty, 0)),
            availableQty: round2(numVal(m.availableQty, 0) + numVal(li.qty, 0)),
            costPrice: newCost,
            lastPurchaseCost: round2(numVal(li.cost, 0)),
          };
        }),
      );
    }
    setSuppliers((prev) =>
      prev.map((s) => (s.id === supplierId ? { ...s, purchased: s.purchased + total, lastOrder: date } : s)),
    );
    // A purchase paid in cash is a payment OUT of a cash account with
    // kind "asset_purchase" — it never enters the Profit or Loss statement.
    // An unpaid purchase posts nothing to cash and becomes a trade payable.
    const additions = [];
    let toppedUp = 0;
    // If the paying account is short, move the shortfall in first. That keeps
    // every account balance equal to the money actually sitting there, instead
    // of letting one account drift below zero.
    if (!unpaid && autoTopUp && topUpFrom && topUpFrom !== payAcc) {
      const bal = cashAccountBalance(payAcc, ledger, accs);
      const shortfall = round2(numVal(total, 0) - bal);
      if (shortfall > 0) {
        const note = `Top-up for ${poId} \u2014 ${accName(topUpFrom)} \u2192 ${accName(payAcc)}`;
        const outId = await nextSeq(ledger, "id", "TXN-", 8821);
        additions.push({
          id: outId,
          date,
          desc: note,
          type: "Expense",
          category: "Cash Transfer",
          amount: shortfall,
          account: topUpFrom,
          kind: "transfer",
          attachment: null,
        });
        const inId = await nextSeq([...ledger, ...additions], "id", "TXN-", 8821);
        additions.push({
          id: inId,
          date,
          desc: note,
          type: "Income",
          category: "Cash Transfer",
          amount: shortfall,
          account: payAcc,
          kind: "transfer",
          attachment: null,
        });
        toppedUp = shortfall;
      }
    }
    const txnId = unpaid ? null : await nextSeq([...ledger, ...additions], "id", "TXN-", 8821);
    if (txnId) {
      additions.push({
        id: txnId,
        date,
        desc: `Stock / raw material purchase \u2014 ${supplier.name} (${poId})`,
        type: "Expense",
        category: "Stock & Raw Material Purchase",
        amount: round2(total),
        account: payAcc,
        kind: "asset_purchase",
        attachment,
      });
    }
    setPurchaseOrders((prev) => [
      {
        id: poId,
        supplier: supplier.name,
        supplierId,
        items: lineItems.reduce((s, i) => s + i.qty, 0),
        lineItems,
        total,
        date,
        attachment,
        paymentStatus: unpaid ? "Unpaid" : "Paid",
        amountPaid: unpaid ? 0 : total,
        cashAccount: unpaid ? null : payAcc,
        toppedUpFrom: toppedUp > 0 ? topUpFrom : null,
        toppedUpAmount: toppedUp,
        ledgerTxnIds: additions.map((a) => a.id),
      },
      ...prev,
    ]);
    if (additions.length) {
      setLedger((prev) => [...additions.slice().reverse(), ...prev]);
    }
    setToast(
      unpaid
        ? `Purchase order ${poId} recorded on credit \u2014 ${money(total)} now shows as a payable. Raw material stock updated; profit unaffected.`
        : toppedUp > 0
          ? `Purchase order ${poId} recorded \u2014 ${money(total)} paid from ${accName(payAcc)}, after moving ${money(toppedUp)} across from ${accName(topUpFrom)}. No account is left below zero and your profit is unaffected.`
          : `Purchase order ${poId} recorded \u2014 ${money(total)} paid from ${accName(payAcc)}. Raw material stock updated; this is an asset purchase, so your profit is unaffected.`,
    );
    setModalOpen(false);
  }
  async function settlePurchase(o) {
    const bal = round2(numVal(o.total, 0) - numVal(o.amountPaid, 0));
    if (bal <= 0) return;
    const acc = purchaseAccId;
    if (!window.confirm(`Pay ${money(bal)} to ${o.supplier} for ${o.id} from "${accName(acc)}"?`)) return;
    const txnId = await nextSeq(ledger, "id", "TXN-", 8821);
    setLedger((prev) => [
      {
        id: txnId,
        date: todayISO(),
        desc: `Supplier payment \u2014 ${o.supplier} (${o.id})`,
        type: "Expense",
        category: "Supplier Payment",
        amount: bal,
        account: acc,
        kind: "ap_settlement",
        attachment: null,
      },
      ...prev,
    ]);
    setPurchaseOrders((prev) =>
      prev.map((x) =>
        x.id === o.id
          ? {
              ...x,
              paymentStatus: "Paid",
              amountPaid: round2(numVal(x.total, 0)),
              cashAccount: acc,
              ledgerTxnIds: [...(x.ledgerTxnIds || []), txnId],
            }
          : x,
      ),
    );
    setSelected((s) =>
      s && s.id === o.id ? { ...s, paymentStatus: "Paid", amountPaid: round2(numVal(s.total, 0)) } : s,
    );
    setToast(
      `${money(bal)} paid to ${o.supplier}. The payable is cleared and your profit is unchanged \u2014 settling a bill is not an expense.`,
    );
  }
  function deletePurchase(o) {
    if (
      !window.confirm(
        `Delete purchase order ${o.id} (${o.supplier})? This reverses the raw material quantities it added, refunds the cash it paid out, and removes it from the supplier's purchase total. This cannot be undone.`,
      )
    )
      return;
    setRawMaterials((prev) =>
      prev.map((m) => {
        const li = (o.lineItems || []).find((l) => l.materialId === m.id);
        if (!li) return m;
        // Reverse the weighted average as well as the quantity, so removing a
        // purchase restores the cost per unit that applied before it: take the
        // value of what is on hand, subtract the value this purchase brought
        // in, and re-divide by what is left.
        const curQty = numVal(m.availableQty, 0);
        const curCost = numVal(m.costPrice, 0);
        const outQty = numVal(li.qty, 0);
        const remQty = round2(curQty - outQty);
        const remValue = curQty * curCost - outQty * numVal(li.cost, 0);
        const restoredCost = remQty > 0 && remValue > 0 ? round6(remValue / remQty) : curCost;
        return {
          ...m,
          purchaseQty: Math.max(0, round2(numVal(m.purchaseQty, 0) - outQty)),
          availableQty: Math.max(0, remQty),
          costPrice: restoredCost,
        };
      }),
    );
    // Previously a deleted purchase order left its cash/expense line behind
    // in the ledger for ever, quietly distorting every figure. Now every
    // line the order created is removed with it.
    const ids = o.ledgerTxnIds || [];
    setLedger((prev) =>
      prev.filter((t) => {
        if (ids.indexOf(t.id) >= 0) return false;
        // legacy orders saved before this upgrade have no stored txn ids
        if (!ids.length && txnKind(t) === "asset_purchase" && t.desc && t.desc.indexOf(o.id) >= 0)
          return false;
        return true;
      }),
    );
    setSuppliers((prev) =>
      prev.map((s) =>
        s.id === o.supplierId
          ? { ...s, purchased: Math.max(0, round2(numVal(s.purchased, 0) - numVal(o.total, 0))) }
          : s,
      ),
    );
    setPurchaseOrders((prev) => prev.filter((x) => x.id !== o.id));
    setSelected((s) => (s && s.id === o.id ? null : s));
    setToast(`Purchase order ${o.id} deleted \u2014 stock, cash and supplier totals all reversed.`);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Purchases</h1>
          <p className={`text-sm ${subText}`}>
            Paid in cash, added to raw material stock, and kept out of the Profit or Loss statement
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={suppliers.length === 0}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40"
        >
          <Plus size={16} />
          {" New Purchase Order"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Purchased</p>
          <p className="text-xl font-bold mt-1">{money(totalValue)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Purchase Orders</p>
          <p className="text-xl font-bold mt-1">{purchaseOrders.length}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>{"Cash & Bank Available"}</p>
          <p className={`text-xl font-bold mt-1 ${cashAvailable >= 0 ? "" : "text-red-600"}`}>
            {money(cashAvailable)}
          </p>
          <p className={`text-xs ${subText} mt-1`}>What you can pay suppliers with</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Owed to Suppliers</p>
          <p className="text-xl font-bold mt-1 text-red-600">{money(outstanding)}</p>
        </div>
      </div>
      <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
        <p className="text-sm font-medium">Why purchases never reduce your profit</p>
        <p
          className={`text-xs ${subText} mt-1 leading-relaxed`}
        >{`Buying stock swaps cash for inventory \u2014 you are no worse off, so nothing is charged to profit. ${money(spentOnPurchases)} has been spent on purchases so far and none of it has touched your profit. Using the material does not charge it either \u2014 that is a stock movement. The cost is charged in one place only: Cost of Goods Sold, when the finished item is sold. It appears on the Profit or Loss statement in the Accounting section.`}</p>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-72 ${inputBg}`}>
            <Search size={15} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search PO # or supplier..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">PO #</th>
                <th className="font-medium py-3 px-2">Supplier</th>
                <th className="font-medium py-3 px-2">Items</th>
                <th className="font-medium py-3 px-2">Total</th>
                <th className="font-medium py-3 px-2">Paid From</th>
                <th className="font-medium py-3 px-2">Date</th>
                <th className="font-medium py-3 px-5">Invoice Slip</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors cursor-pointer`}
                  onClick={() => setSelected(o)}
                >
                  <td className="py-3 px-5 font-medium">{o.id}</td>
                  <td className="py-3 px-2">{o.supplier}</td>
                  <td className={`py-3 px-2 ${subText}`}>{o.items}</td>
                  <td className="py-3 px-2 font-medium">{money(o.total)}</td>
                  <td className="py-3 px-2">
                    {poIsUnpaid(o) ? (
                      <Badge tone="amber">Unpaid</Badge>
                    ) : (
                      <span className={`text-xs ${subText}`}>{accName(o.cashAccount || MAIN_CASH_ID)}</span>
                    )}
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{fmtDate(o.date)}</td>
                  <td className="py-3 px-5">
                    <AttachmentLink attachment={o.attachment} subText={subText} />
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePurchase(o);
                        }}
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
                  <td colSpan={8} className={`text-center py-10 text-sm ${subText}`}>
                    No purchase orders yet. Create one to log a supplier purchase and add stock to Raw
                    Materials.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {modalOpen && (
          <PurchaseOrderModal
            onClose={() => setModalOpen(false)}
            onSave={savePurchase}
            dark={dark}
            cardBg={cardBg}
            subText={subText}
            inputBg={inputBg}
            rawMaterials={rawMaterials}
            suppliers={suppliers}
            cashAccounts={accs}
            ledger={ledger}
          />
        )}
        {selected && (
          <Modal
            title={`Purchase Order ${selected.id}`}
            onClose={() => setSelected(null)}
            cardBg={cardBg}
            dark={dark}
          >
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className={subText}>Supplier</span>
                <span className="font-medium">{selected.supplier}</span>
              </div>
              <div className="flex justify-between">
                <span className={subText}>Date</span>
                <span>{fmtDate(selected.date)}</span>
              </div>
              {selected.lineItems && (
                <div className={`border-t pt-3 ${dark ? "border-slate-800" : "border-slate-100"}`}>
                  <p className={`text-xs font-medium mb-2 ${subText}`}>Items</p>
                  {selected.lineItems.map((li, i) => (
                    <div key={i} className="flex justify-between text-xs py-1">
                      <span>
                        {li.name}
                        {" \u00D7 "}
                        {li.qty}
                      </span>
                      <span>{money(li.cost * li.qty)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div
                className={`flex justify-between pt-2 border-t ${dark ? "border-slate-800" : "border-slate-100"} font-bold`}
              >
                <span>Total</span>
                <span>{money(selected.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className={subText}>Settlement</span>
                <span>
                  {poIsUnpaid(selected) ? (
                    <Badge tone="amber">{`Unpaid \u2014 ${money(round2(numVal(selected.total, 0) - numVal(selected.amountPaid, 0)))} owed`}</Badge>
                  ) : (
                    <Badge tone="green">{`Paid from ${accName(selected.cashAccount || MAIN_CASH_ID)}`}</Badge>
                  )}
                </span>
              </div>
              {selected.toppedUpAmount > 0 && (
                <div className="flex justify-between">
                  <span className={subText}>Account topped up by</span>
                  <span>{`${money(selected.toppedUpAmount)} from ${accName(selected.toppedUpFrom)}`}</span>
                </div>
              )}
              <p className={`text-xs ${subText}`}>
                {
                  "This purchase increased your raw material stock. It was not charged to profit \u2014 you will find it on the Statement of Financial Position under Inventory."
                }
              </p>
              <AttachmentLink attachment={selected.attachment} subText={subText} />
              {poIsUnpaid(selected) && (
                <button
                  onClick={() => settlePurchase(selected)}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-emerald-900/20 transition-colors"
                >
                  <Wallet size={15} />
                  {` Pay ${money(round2(numVal(selected.total, 0) - numVal(selected.amountPaid, 0)))} to Supplier`}
                </button>
              )}
              <button
                onClick={() => deletePurchase(selected)}
                className="flex items-center gap-2 text-red-500 hover:bg-red-50 text-sm font-medium px-3 py-2 rounded-xl transition-colors"
              >
                <Trash2 size={14} />
                {" Delete Purchase Order"}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
