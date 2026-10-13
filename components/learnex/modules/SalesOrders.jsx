import { useState } from "react";
import { AttachmentLink, Badge, Field, FileUpload, Modal, inputCls } from "@/components/learnex/ui";
import { MAIN_CASH_ID } from "@/lib/learnex/accounting";
import { Plus, Save, Search, Trash2, Wallet } from "@/components/learnex/icons";
import { fmtDate, money, numVal, round2, todayISO } from "@/lib/learnex/utils";
import { nextSeq } from "@/lib/learnex/persistence";

/* =====================================================================
   SALES ORDERS — with New Order form (+ optional invoice attachment)
===================================================================== */
export function SalesOrderModal({ onClose, onSave, dark, cardBg, subText, inputBg, products, customers }) {
  var _a, _b;
  const [customerId, setCustomerId] = useState(
    ((_a = customers[0]) === null || _a === void 0 ? void 0 : _a.id) || "",
  );
  const [items, setItems] = useState([
    { productId: ((_b = products[0]) === null || _b === void 0 ? void 0 : _b.id) || "", qty: 1 },
  ]);
  const [status, setStatus] = useState("Processing");
  const [payment, setPayment] = useState("Pending");
  const [attachment, setAttachment] = useState(null);
  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addRow() {
    setItems((prev) => {
      var _a;
      return [
        ...prev,
        { productId: ((_a = products[0]) === null || _a === void 0 ? void 0 : _a.id) || "", qty: 1 },
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
        ? { productId: p.id, name: p.name, qty: Number(it.qty) || 0, price: p.price, availableStock: p.stock }
        : null;
    })
    .filter(Boolean);
  const subtotal = round2(lineItems.reduce((s, i) => s + i.price * i.qty, 0));
  function submit(e) {
    e.preventDefault();
    if (!customerId || lineItems.length === 0) return;
    for (const li of lineItems) {
      if (li.qty > li.availableStock) {
        alert(`Not enough stock for ${li.name}. Only ${li.availableStock} available.`);
        return;
      }
    }
    onSave({ customerId: Number(customerId), lineItems, subtotal, status, payment, attachment });
  }
  return (
    <Modal title="New Sales Order" onClose={onClose} cardBg={cardBg} dark={dark} wide={true}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer" subText={subText}>
          <select
            required={true}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputCls(inputBg)}
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <p className={`text-xs font-medium mb-2 ${subText}`}>Order Items</p>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={it.productId}
                  onChange={(e) => updateItem(i, { productId: e.target.value })}
                  className={`${inputCls(inputBg)} flex-1`}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {" ("}
                      {p.stock}
                      {" in stock)"}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={it.qty}
                  onChange={(e) => updateItem(i, { qty: e.target.value })}
                  className={`${inputCls(inputBg)} w-20`}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fulfillment Status" subText={subText}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls(inputBg)}>
              {["Processing", "Shipped", "Delivered", "Cancelled"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment Status" subText={subText}>
            <select
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              className={inputCls(inputBg)}
            >
              {["Paid", "Pending", "Overdue"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <FileUpload
          label="Attach Invoice / Delivery Slip (optional)"
          value={attachment}
          onChange={setAttachment}
          dark={dark}
          subText={subText}
          inputBg={inputBg}
        />
        <div
          className={`flex justify-between items-center pt-3 border-t ${dark ? "border-slate-800" : "border-slate-100"} text-sm`}
        >
          <span className={subText}>Order Subtotal</span>
          <span className="text-lg font-bold">{money(subtotal)}</span>
        </div>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} />
          {" Create Sales Order"}
        </button>
      </form>
    </Modal>
  );
}
export function SalesOrders({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  salesOrders,
  setSalesOrders,
  products,
  setProducts,
  customers,
  setCustomers,
  ledger,
  setLedger,
  settings,
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [kindFilter, setKindFilter] = useState("All orders");
  const [payAmt, setPayAmt] = useState("");
  const statuses = ["All", "Processing", "Shipped", "Delivered", "Cancelled"];
  const kinds = ["All orders", "Credit bills", "Outstanding balance"];
  // paid/balance work for old records too — anything marked Paid counts as fully paid
  const paidOf = (o) => (o.amountPaid != null ? o.amountPaid : o.payment === "Paid" ? o.amount : 0);
  const balOf = (o) => round2(Math.max(0, o.amount - paidOf(o)));
  const filtered = salesOrders.filter(
    (o) =>
      (statusFilter === "All" || o.status === statusFilter) &&
      (kindFilter === "All orders" || (kindFilter === "Credit bills" ? !!o.isCredit : balOf(o) > 0)) &&
      (o.id.toLowerCase().includes(query.toLowerCase()) ||
        o.customer.toLowerCase().includes(query.toLowerCase())),
  );
  const totalValue = salesOrders.reduce((s, o) => s + o.amount, 0);
  const processing = salesOrders.filter((o) => o.status === "Processing").length;
  const overdue = salesOrders.filter((o) => o.payment === "Overdue").length;
  const creditOutstanding = round2(salesOrders.reduce((s, o) => s + balOf(o), 0));
  async function recordPayment(o, rawAmt) {
    const bal = balOf(o);
    const amt = round2(rawAmt);
    if (!(amt > 0)) {
      setToast("Enter a payment amount greater than 0.");
      return;
    }
    if (amt > bal + 0.004) {
      setToast(`Payment cannot be more than the outstanding balance of ${money(bal)}.`);
      return;
    }
    const date = todayISO();
    const newPaid = round2(paidOf(o) + amt);
    const newBal = round2(o.amount - newPaid);
    const updated = {
      ...o,
      amountPaid: newPaid,
      payment: newBal <= 0.004 ? "Paid" : "Pending",
      payments: [...(o.payments || []), { date, amount: amt }],
    };
    setSalesOrders((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
    if (o.customerId) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === o.customerId ? { ...c, outstanding: Math.max(0, round2(c.outstanding - amt)) } : c,
        ),
      );
    }
    // delivery credit bills were already booked as sales income when the run
    // was closed, so collecting the money must not book the income twice
    // Invoices raised after the accounting upgrade already recognised their
    // revenue on the day of sale, so collecting the money is only a cash
    // receipt against the receivable — never income counted twice.
    const txnId = await nextSeq(ledger, "id", "TXN-", 8821);
    if (o.accrued || o.fromDelivery) {
      setLedger((prev) => [
        {
          id: txnId,
          date,
          desc: `Receipt from ${o.customer} \u2014 ${o.invoice || o.id}`,
          type: "Income",
          category: "Receivable Collection",
          amount: amt,
          account: MAIN_CASH_ID,
          kind: "ar_collection",
          attachment: null,
        },
        ...prev,
      ]);
    } else {
      setLedger((prev) => [
        {
          id: txnId,
          date,
          desc: `Payment received \u2014 ${o.invoice || o.id}`,
          type: "Income",
          category: "Sales",
          amount: amt,
          account: MAIN_CASH_ID,
          kind: "revenue",
          attachment: null,
        },
        ...prev,
      ]);
    }
    setSelected(updated);
    setPayAmt("");
    setToast(
      newBal <= 0.004
        ? `${money(amt)} received from ${o.customer}. Bill settled in full.`
        : `${money(amt)} received from ${o.customer}. Balance remaining ${money(newBal)}.`,
    );
  }
  const statusTone = { Processing: "amber", Shipped: "blue", Delivered: "green", Cancelled: "red" };
  const paymentTone = { Paid: "green", Pending: "amber", Overdue: "red", Refunded: "slate" };
  async function saveOrder({ customerId, lineItems, subtotal, status, payment, attachment }) {
    const taxRate = Number(settings.taxRate) || 0;
    const tax = round2(subtotal * (taxRate / 100));
    const total = round2(subtotal + tax);
    const customer = customers.find((c) => c.id === customerId);
    const date = todayISO();
    const invoice = await nextSeq(salesOrders, "invoice", "INV-", 2461);
    const soId = await nextSeq(salesOrders, "id", "SO-", 1042);
    setProducts((prev) =>
      prev.map((p) => {
        const li = lineItems.find((l) => l.productId === p.id);
        return li ? { ...p, stock: Math.max(0, p.stock - li.qty) } : p;
      }),
    );
    setSalesOrders((prev) => [
      {
        id: soId,
        invoice,
        customer: customer.name,
        customerId: customer.id,
        items: lineItems.reduce((s, i) => s + i.qty, 0),
        lineItems,
        amount: total,
        tax,
        status,
        payment,
        date,
        channel: "Manual",
        attachment,
        amountPaid: payment === "Paid" ? total : 0,
        payments: payment === "Paid" ? [{ date, amount: total }] : [],
        accrued: true,
      },
      ...prev,
    ]);
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customer.id
          ? {
              ...c,
              orders: c.orders + 1,
              spent: c.spent + total,
              outstanding: c.outstanding + (payment === "Paid" ? 0 : total),
            }
          : c,
      ),
    );
    // Revenue is recognised when the invoice is raised. If the customer has
    // not paid yet, no cash moved — the amount sits in trade receivables and
    // the later receipt is recorded as a collection, not as new income.
    const cogsAmount = round2(
      lineItems.reduce((s, li) => {
        const p = products.find((x) => x.id === li.productId);
        return s + (p ? numVal(p.cost, 0) : 0) * li.qty;
      }, 0),
    );
    const additions = [
      {
        id: await nextSeq(ledger, "id", "TXN-", 8821),
        date,
        desc: `Sales revenue \u2014 ${invoice} (${customer.name})`,
        type: "Income",
        category: "Sales",
        amount: round2(total),
        account: payment === "Paid" ? MAIN_CASH_ID : null,
        kind: "revenue",
        cash: payment === "Paid",
        attachment: null,
      },
    ];
    if (cogsAmount > 0) {
      additions.push({
        id: await nextSeq([...ledger, ...additions], "id", "TXN-", 8821),
        date,
        desc: `Cost of goods sold \u2014 ${invoice}`,
        type: "Expense",
        category: "Cost of Goods Sold",
        amount: cogsAmount,
        account: null,
        kind: "cogs",
        cash: false,
        attachment: null,
      });
    }
    setLedger((prev) => [...additions, ...prev]);
    setToast(`Sales order ${soId} created for ${customer.name} — ${money(total)}.`);
    setModalOpen(false);
  }
  function deleteOrder(o) {
    if (
      !window.confirm(
        `Delete order ${o.id} for ${o.customer}? This restores any stock it used and cannot be undone.`,
      )
    )
      return;
    setProducts((prev) =>
      prev.map((p) => {
        const li = (o.lineItems || []).find((l) => l.productId === p.id);
        return li ? { ...p, stock: p.stock + li.qty } : p;
      }),
    );
    if (o.customerId) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === o.customerId
            ? {
                ...c,
                orders: Math.max(0, c.orders - 1),
                spent: Math.max(0, c.spent - o.amount),
                outstanding: Math.max(0, c.outstanding - (o.payment === "Paid" ? 0 : o.amount)),
              }
            : c,
        ),
      );
    }
    // Remove every ledger line this invoice created — the revenue, its cost of
    // goods sold, and any receipts booked against it. Previously only the
    // revenue line was removed, leaving orphaned costs behind for ever.
    setLedger((prev) => prev.filter((t) => !(o.invoice && t.desc && t.desc.indexOf(o.invoice) >= 0)));
    setSalesOrders((prev) => prev.filter((x) => x.id !== o.id));
    setSelected(null);
    setToast(`Order ${o.id} deleted.`);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Sales Orders</h1>
          <p className={`text-sm ${subText}`}>
            {salesOrders.length}
            {" orders on record"}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={customers.length === 0 || products.length === 0}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40"
        >
          <Plus size={16} />
          {" New Order"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Order Value</p>
          <p className="text-xl font-bold mt-1">{money(totalValue)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Outstanding to Collect</p>
          <p className={`text-xl font-bold mt-1 ${creditOutstanding > 0 ? "text-amber-600" : ""}`}>
            {money(creditOutstanding)}
          </p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Orders</p>
          <p className="text-xl font-bold mt-1">{salesOrders.length}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Processing</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{processing}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Overdue Payment</p>
          <p className="text-xl font-bold mt-1 text-red-600">{overdue}</p>
        </div>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border w-full sm:w-72 ${inputBg}`}>
            <Search size={15} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search order # or customer..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
            >
              {kinds.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Order #</th>
                <th className="font-medium py-3 px-2">Customer / Shop</th>
                <th className="font-medium py-3 px-2">Items</th>
                <th className="font-medium py-3 px-2">Amount</th>
                <th className="font-medium py-3 px-2">Paid</th>
                <th className="font-medium py-3 px-2">Balance</th>
                <th className="font-medium py-3 px-2">Status</th>
                <th className="font-medium py-3 px-2">Payment</th>
                <th className="font-medium py-3 px-2">Date</th>
                <th className="font-medium py-3 px-2">Slip</th>
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
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <span>{o.customer}</span>
                      {o.isCredit && <Badge tone="amber">Credit</Badge>}
                    </div>
                    {o.lineItems && o.lineItems.length > 0 && (
                      <p className={`text-[11px] ${subText} truncate max-w-[240px]`}>
                        {o.lineItems.map((li) => `${li.name} × ${li.qty}`).join(", ")}
                      </p>
                    )}
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{o.items}</td>
                  <td className="py-3 px-2 font-medium">{money(o.amount)}</td>
                  <td className={`py-3 px-2 ${subText}`}>{money(paidOf(o))}</td>
                  <td
                    className={`py-3 px-2 font-medium ${balOf(o) > 0 ? "text-amber-600" : "text-emerald-600"}`}
                  >
                    {money(balOf(o))}
                  </td>
                  <td className="py-3 px-2">
                    <Badge tone={statusTone[o.status] || "slate"}>{o.status}</Badge>
                  </td>
                  <td className="py-3 px-2">
                    <Badge tone={paymentTone[o.payment] || "slate"}>{o.payment}</Badge>
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{fmtDate(o.date)}</td>
                  <td className="py-3 px-2">
                    <AttachmentLink attachment={o.attachment} subText={subText} />
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex items-center justify-end gap-1.5">
                      {balOf(o) > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPayAmt("");
                            setSelected(o);
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          Collect
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteOrder(o);
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
                  <td colSpan={11} className={`text-center py-10 text-sm ${subText}`}>
                    No orders match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {modalOpen && (
        <SalesOrderModal
          onClose={() => setModalOpen(false)}
          onSave={saveOrder}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
          products={products}
          customers={customers}
        />
      )}
      {selected && (
        <Modal title={`Order ${selected.id}`} onClose={() => setSelected(null)} cardBg={cardBg} dark={dark}>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className={subText}>Customer</span>
              <span className="font-medium">{selected.customer}</span>
            </div>
            <div className="flex justify-between">
              <span className={subText}>Invoice</span>
              <span className="font-medium">{selected.invoice || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className={subText}>Date</span>
              <span>{fmtDate(selected.date)}</span>
            </div>
            <div className="flex justify-between">
              <span className={subText}>Status</span>
              <Badge tone={statusTone[selected.status] || "slate"}>{selected.status}</Badge>
            </div>
            <div className="flex justify-between">
              <span className={subText}>Payment</span>
              <Badge tone={paymentTone[selected.payment] || "slate"}>{selected.payment}</Badge>
            </div>
            {selected.lineItems && selected.lineItems.length > 0 && (
              <div className={`border-t pt-3 ${dark ? "border-slate-800" : "border-slate-100"}`}>
                <p className={`text-xs font-medium mb-2 ${subText}`}>Line Items</p>
                {selected.lineItems.map((li, i) => (
                  <div key={i} className="flex justify-between text-xs py-1">
                    <span>
                      {li.name}
                      {" \u00D7 "}
                      {li.qty}
                    </span>
                    <span>{money(li.price * li.qty)}</span>
                  </div>
                ))}
              </div>
            )}
            <div
              className={`flex justify-between pt-2 border-t ${dark ? "border-slate-800" : "border-slate-100"} font-bold`}
            >
              <span>Total</span>
              <span>{money(selected.amount)}</span>
            </div>
            <div
              className={`rounded-xl border p-3 space-y-2 ${dark ? "border-slate-800" : "border-slate-100"}`}
            >
              <div className="flex justify-between text-sm">
                <span className={subText}>Amount Paid</span>
                <span className="font-medium">{money(paidOf(selected))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className={subText}>Balance Due</span>
                <span className={`font-bold ${balOf(selected) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                  {money(balOf(selected))}
                </span>
              </div>
              {selected.payments && selected.payments.length > 0 && (
                <div
                  className={`pt-2 border-t border-dashed ${dark ? "border-slate-800" : "border-slate-200"}`}
                >
                  <p className={`text-[11px] font-medium mb-1 ${subText}`}>Payments received</p>
                  {selected.payments.map((p, i) => (
                    <div key={i} className={`flex justify-between text-[11px] ${subText}`}>
                      <span>{fmtDate(p.date)}</span>
                      <span className="font-medium">{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {balOf(selected) > 0 && (
                <div className="flex items-end gap-2 pt-1">
                  <div className="flex-1">
                    <Field label="Amount Received Now" subText={subText}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={payAmt}
                        onChange={(e) => setPayAmt(e.target.value)}
                        className={inputCls(inputBg)}
                        placeholder={money(balOf(selected))}
                      />
                    </Field>
                  </div>
                  <button
                    onClick={() => recordPayment(selected, payAmt)}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-emerald-900/20 transition-colors h-[42px] shrink-0"
                  >
                    <Wallet size={15} />
                    {" Record"}
                  </button>
                </div>
              )}
              {balOf(selected) > 0 && (
                <button
                  onClick={() => recordPayment(selected, balOf(selected))}
                  className={`text-xs font-medium ${dark ? "text-blue-400" : "text-blue-600"}`}
                >
                  Settle full balance
                </button>
              )}
            </div>
            {selected.note && <p className={`text-xs ${subText}`}>{selected.note}</p>}
            {selected.fromDelivery && (
              <p className={`text-[11px] ${subText}`}>
                {"Credit bill from delivery run "}
                {selected.fromDelivery}. The sale was already recorded when that run was closed, so collecting
                payment here only clears the balance.
              </p>
            )}
            <AttachmentLink attachment={selected.attachment} subText={subText} />
            <button
              onClick={() => deleteOrder(selected)}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-red-900/20 transition-colors mt-2"
            >
              <Trash2 size={14} />
              {" Delete Order"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
