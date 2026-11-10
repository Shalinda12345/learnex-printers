import { useState } from "react";
import { AttachmentLink, Badge, EmptyState, Field, FileUpload, Modal, SearchInput, StatCard, inputCls } from "@/components/learnex/ui";
import { MAIN_CASH_ID, nextTxnId } from "@/lib/learnex/accounting";
import { balanceOf as balOf, openInvoice, paidOf } from "@/lib/learnex/invoice";
import { Plus, Printer, Save, Trash2, Wallet } from "@/components/learnex/icons";
import { fmtDate, money, nextSeqId, numVal, round2, todayISO } from "@/lib/learnex/utils";

/* =====================================================================
   SALES ORDERS — with New Order form (+ optional invoice attachment)
   and a printable invoice for every order
===================================================================== */
// Order item columns: Item Name | Qty | Unit Price | Amount | Remove — always in a single row
const itemRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1fr) 5rem 6.5rem 7rem 2.5rem",
  columnGap: "0.5rem",
  alignItems: "center",
};
const itemGrid = "sales-order-item-row";
export function SalesOrderModal({ onClose, onSave, dark, cardBg, subText, inputBg, products, customers }) {
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const newRow = () => {
    const first = products[0];
    return { productId: first?.id || "", qty: 1, unitPrice: first ? first.price : 0 };
  };
  const [items, setItems] = useState(() => [newRow()]);
  const [status, setStatus] = useState("Processing");
  const [payment, setPayment] = useState("Pending");
  const [attachment, setAttachment] = useState(null);
  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function onProductChange(i, productId) {
    const p = products.find((x) => x.id === Number(productId));
    updateItem(i, { productId, unitPrice: p ? p.price : 0 });
  }
  function addRow() {
    setItems((prev) => [...prev, newRow()]);
  }
  function removeRow(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  const lineItems = items
    .map((it) => {
      const p = products.find((x) => x.id === Number(it.productId));
      if (!p) return null;
      const price =
        it.unitPrice !== undefined && it.unitPrice !== ""
          ? Math.max(0, numVal(it.unitPrice, 0))
          : (p.price ?? 0);
      return {
        productId: p.id,
        name: p.name,
        qty: Number(it.qty) || 0,
        price: round2(price),
        availableStock: p.stock,
      };
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
    <Modal title="New Sales Order" onClose={onClose} cardBg={cardBg} dark={dark} wide="xl">
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
          <div className="flex items-center justify-between mb-2">
            <p className={`text-xs font-semibold ${subText}`}>Order Items</p>
            <span className={`text-[11px] ${subText}`}>Each line item in one row</span>
          </div>
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[560px]">
              <div
                className={`sales-order-item-row ${itemGrid} mb-2 text-[11px] font-semibold uppercase tracking-wider ${subText} px-1`}
                style={itemRowStyle}
              >
                <span>Item Name</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Unit Price</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              <div className="space-y-2">
                {items.map((it, i) => {
                  const product = products.find((x) => x.id === Number(it.productId));
                  const qty = Number(it.qty) || 0;
                  const itemPrice =
                    it.unitPrice !== undefined && it.unitPrice !== ""
                      ? Math.max(0, numVal(it.unitPrice, 0))
                      : (product ? product.price : 0);
                  const rowAmount = round2(qty * itemPrice);
                  return (
                    <div
                      key={i}
                      className={`sales-order-item-row ${itemGrid}`}
                      style={itemRowStyle}
                    >
                      <div className="min-w-0">
                        <select aria-label="Product"
                          value={it.productId}
                          onChange={(e) => onProductChange(i, e.target.value)}
                          title={product ? product.name : ""}
                          className={inputCls(inputBg)}
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
                        {product && qty > product.stock && (
                          <p className="text-[11px] text-red-600 font-medium mt-0.5 truncate">
                            Only {product.stock} in stock
                          </p>
                        )}
                      </div>
                      <input
                        type="number"
                        min="1"
                        value={it.qty}
                        onChange={(e) => updateItem(i, { qty: e.target.value })}
                        placeholder="Qty"
                        aria-label="Quantity"
                        className={`${inputCls(inputBg)} text-center px-2`}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={it.unitPrice !== undefined ? it.unitPrice : (product ? product.price : "")}
                        onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                        placeholder="Price"
                        aria-label="Unit Price"
                        className={`${inputCls(inputBg)} text-right px-2`}
                      />
                      <span className="h-[42px] flex items-center justify-end text-sm font-semibold tabular-nums whitespace-nowrap px-1">
                        {money(rowAmount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        disabled={items.length <= 1}
                        title={items.length <= 1 ? "At least one item is required" : "Remove line"}
                        aria-label="Remove line"
                        className="w-9 h-[42px] rounded-xl flex items-center justify-center text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
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
        />
        <div
          className={`flex justify-between items-center pt-3 border-t ${dark ? "border-slate-800" : "border-slate-100"} text-sm`}
        >
          <span className={subText}>Order Subtotal</span>
          <span className="text-lg font-bold">{money(subtotal)}</span>
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-block"
        >
          <Save size={15} />
          {" Create Sales Order"}
        </button>
      </form>
    </Modal>
  );
}
// What happens to goods a customer brings back.
const RETURN_STOCK = "stock";
const RETURN_EXPENSE = "expense";
const RETURN_OPTIONS = [
  { value: RETURN_STOCK, label: "Add to stock again" },
  { value: RETURN_EXPENSE, label: "Add to expenses (damaged / not resellable)" },
];
export function ReturnModal({ order, onClose, onSave, dark, cardBg, subText, inputBg }) {
  const lines = order.lineItems || [];
  const [lineIdx, setLineIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [disposition, setDisposition] = useState(RETURN_STOCK);
  const line = lines[lineIdx];
  const qtyN = Math.floor(Number(qty) || 0);
  const taxRatio = order.tax > 0 && order.amount - order.tax > 0 ? order.tax / (order.amount - order.tax) : 0;
  const refund = line ? round2(line.price * qtyN * (1 + taxRatio)) : 0;
  function submit(e) {
    e.preventDefault();
    if (!line || qtyN < 1 || qtyN > line.qty) return;
    onSave({ lineIdx, qty: qtyN, disposition });
  }
  return (
    <Modal title={`Return — Order ${order.id}`} onClose={onClose} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Returned Item" subText={subText}>
          <select
            value={lineIdx}
            onChange={(e) => {
              setLineIdx(Number(e.target.value));
              setQty(1);
            }}
            className={inputCls(inputBg)}
          >
            {lines.map((li, i) => (
              <option key={i} value={i}>
                {li.name} ({li.qty} on this order)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Return Quantity" subText={subText}>
          <input
            type="number"
            min="1"
            max={line ? line.qty : 1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputCls(inputBg)}
          />
          {line && qtyN > line.qty && (
            <p className="text-[11px] text-red-600 font-medium mt-0.5">Only {line.qty} on this order.</p>
          )}
        </Field>
        <Field label="Returns" subText={subText}>
          <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className={inputCls(inputBg)}>
            {RETURN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <p className={`text-xs ${subText}`}>
          {disposition === RETURN_STOCK
            ? "The items go back into stock and their cost is taken out of cost of goods sold."
            : "The items are not restocked; their cost is booked as an expense."}
          {" The returned amount is reduced from this sales order."}
        </p>
        <div
          className={`flex justify-between items-center pt-3 border-t ${dark ? "border-slate-800" : "border-slate-100"} text-sm`}
        >
          <span className={subText}>Amount reduced from order</span>
          <span className="text-lg font-bold">{money(refund)}</span>
        </div>
        <button
          type="submit"
          disabled={!line || qtyN < 1 || qtyN > line.qty}
          className="btn btn-warning btn-block"
        >
          {" Record Return"}
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
  seed,
}) {
  const [query, setQuery] = useState(seed || "");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [kindFilter, setKindFilter] = useState("All orders");
  const [payAmt, setPayAmt] = useState("");
  const [returnOrder, setReturnOrder] = useState(null);
  const statuses = ["All", "Processing", "Shipped", "Delivered", "Cancelled"];
  const kinds = ["All orders", "Credit bills", "Outstanding balance"];
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
  function recordPayment(o, rawAmt) {
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
    // Invoices raised after the accounting upgrade (and delivery credit bills)
    // already recognised their revenue on the day of sale, so collecting the
    // money is only a cash receipt against the receivable — never income
    // counted twice.
    const txnId = nextTxnId(ledger);
    if (o.accrued || o.fromDelivery) {
      setLedger((prev) => [
        {
          id: txnId,
          date,
          desc: `Receipt from ${o.customer} — ${o.invoice || o.id}`,
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
          desc: `Payment received — ${o.invoice || o.id}`,
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
  function printInvoice(o) {
    const customer = o.customerId ? customers.find((c) => c.id === o.customerId) : null;
    if (openInvoice(o, { settings, customer })) {
      setToast(`Invoice ${o.invoice || o.id} opened — use your browser's print dialog to print or save as PDF.`);
    } else {
      setToast("The invoice window was blocked — allow pop-ups for this site and try again.");
    }
  }
  const statusTone = { Processing: "amber", Shipped: "blue", Delivered: "green", Cancelled: "red" };
  const paymentTone = { Paid: "green", Pending: "amber", Overdue: "red", Refunded: "slate" };
  function saveOrder({ customerId, lineItems, subtotal, status, payment, attachment }) {
    const taxRate = Number(settings.taxRate) || 0;
    const tax = round2(subtotal * (taxRate / 100));
    const total = round2(subtotal + tax);
    const customer = customers.find((c) => c.id === customerId);
    const date = todayISO();
    const invoice = nextSeqId(salesOrders, "invoice", "INV-", 2461);
    const soId = nextSeqId(salesOrders, "id", "SO-", 1042);
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
        id: nextTxnId(ledger),
        date,
        desc: `Sales revenue — ${invoice} (${customer.name})`,
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
        id: nextTxnId([...ledger, ...additions]),
        date,
        desc: `Cost of goods sold — ${invoice}`,
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
  function returnItems(o, { lineIdx, qty, disposition }) {
    const li = (o.lineItems || [])[lineIdx];
    if (!li || qty < 1 || qty > li.qty) return;
    const date = todayISO();
    const taxRatio = o.tax > 0 && o.amount - o.tax > 0 ? o.tax / (o.amount - o.tax) : 0;
    const goods = round2(li.price * qty);
    const refund = Math.min(o.amount, round2(goods * (1 + taxRatio)));
    const newAmount = round2(o.amount - refund);
    const paid = paidOf(o);
    const balBefore = balOf(o);
    const newPaid = Math.min(paid, newAmount);
    const cashRefund = round2(paid - newPaid); // already-collected money handed back
    const balDrop = round2(Math.min(refund, balBefore)); // unpaid part simply cancelled
    const lineItems = o.lineItems
      .map((x, i) => (i === lineIdx ? { ...x, qty: x.qty - qty } : x))
      .filter((x) => x.qty > 0);
    const updated = {
      ...o,
      lineItems,
      items: lineItems.reduce((s, x) => s + x.qty, 0),
      amount: newAmount,
      tax: round2(Math.max(0, (o.tax || 0) - (refund - goods))),
      amountPaid: newPaid,
      payment: newAmount <= 0.004 ? "Refunded" : newAmount - newPaid <= 0.004 ? "Paid" : o.payment,
      returns: [
        ...(o.returns || []),
        { date, productId: li.productId, name: li.name, qty, amount: refund, disposition },
      ],
    };
    const product = products.find((p) => p.id === li.productId);
    const cost = round2((product ? numVal(product.cost, 0) : 0) * qty);
    const ref = o.invoice || o.id;
    if (disposition === RETURN_STOCK && product) {
      setProducts((prev) => prev.map((p) => (p.id === li.productId ? { ...p, stock: p.stock + qty } : p)));
    }
    setSalesOrders((prev) => prev.map((x) => (x.id === o.id ? updated : x)));
    if (o.customerId) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === o.customerId
            ? {
              ...c,
              spent: Math.max(0, round2(c.spent - refund)),
              outstanding: Math.max(0, round2(c.outstanding - balDrop)),
            }
            : c,
        ),
      );
    }
    // Ledger: reverse the sale as a "Sales Returns" line (cash only for money
    // actually handed back), take the cost back out of cost of goods sold, and
    // for written-off goods book that cost as an expense instead.
    const additions = [];
    const push = (t) => additions.push({ id: nextTxnId([...ledger, ...additions]), date, attachment: null, ...t });
    if (refund - cashRefund > 0.004) {
      push({
        desc: `Sales return — ${ref} (${li.name} × ${qty})`,
        type: "Expense",
        category: "Sales Returns",
        amount: round2(refund - cashRefund),
        account: null,
        kind: "opex",
        cash: false,
      });
    }
    if (cashRefund > 0.004) {
      push({
        desc: `Sales return refund — ${ref} (${li.name} × ${qty})`,
        type: "Expense",
        category: "Sales Returns",
        amount: cashRefund,
        account: MAIN_CASH_ID,
        kind: "opex",
        cash: true,
      });
    }
    if (cost > 0) {
      push({
        desc: `Cost of goods sold reversed — ${ref} return`,
        type: "Expense",
        category: "Cost of Goods Sold",
        amount: -cost,
        account: null,
        kind: "cogs",
        cash: false,
      });
      if (disposition === RETURN_EXPENSE) {
        push({
          desc: `Returned goods written off — ${ref} (${li.name} × ${qty})`,
          type: "Expense",
          category: "Returned Goods Written Off",
          amount: cost,
          account: null,
          kind: "opex",
          cash: false,
        });
      }
    }
    if (additions.length) setLedger((prev) => [...additions, ...prev]);
    setSelected(updated);
    setReturnOrder(null);
    setToast(
      `${qty} × ${li.name} returned from ${o.id} — ${money(refund)} reduced` +
        (disposition === RETURN_STOCK ? ", added back to stock." : ", added to expenses.") +
        (cashRefund > 0 ? ` Refund of ${money(cashRefund)} paid out.` : ""),
    );
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
          <h2 className="text-xl font-bold">Sales Orders</h2>
          <p className={`text-sm ${subText}`}>
            {salesOrders.length}
            {" orders on record"}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={customers.length === 0 || products.length === 0}
          className="btn btn-primary"
        >
          <Plus size={16} />
          {" New Order"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total Order Value" value={money(totalValue)} cardBg={cardBg} subText={subText} />
        <StatCard
          label="Outstanding to Collect"
          value={money(creditOutstanding)}
          valueClass={creditOutstanding > 0 ? "text-amber-600" : ""}
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard label="Total Orders" value={salesOrders.length} cardBg={cardBg} subText={subText} />
        <StatCard
          label="Processing"
          value={processing}
          valueClass="text-amber-600"
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label="Overdue Payment"
          value={overdue}
          valueClass="text-red-600"
          cardBg={cardBg}
          subText={subText}
        />
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <SearchInput value={query} onChange={setQuery} placeholder="Search order # or customer..." inputBg={inputBg} subText={subText} className="w-full sm:w-72" />
          <div className="flex gap-2">
            <select aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`text-xs px-3 py-2 rounded-xl border ${inputBg}`}
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select aria-label="Filter by order type"
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
                  <td className="py-3 px-5 font-medium whitespace-nowrap">{o.id}</td>
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
                  <td className="py-3 px-2 font-medium whitespace-nowrap">{money(o.amount)}</td>
                  <td className={`py-3 px-2 ${subText} whitespace-nowrap`}>{money(paidOf(o))}</td>
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
                  <td className={`py-3 px-2 ${subText} whitespace-nowrap`}>{fmtDate(o.date)}</td>
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
                          className="btn btn-success btn-sm"
                        >
                          Collect
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          printInvoice(o);
                        }}
                        title={`Print invoice ${o.invoice || o.id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        <Printer size={12} />
                        {" Invoice"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setReturnOrder(o);
                        }}
                        disabled={!(o.lineItems && o.lineItems.length > 0)}
                        title="Return items from this order"
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-30 ${dark ? "border-amber-700 text-amber-400 hover:bg-slate-800" : "border-amber-300 text-amber-700 hover:bg-amber-50"}`}
                      >
                        Return
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteOrder(o);
                        }}
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
                  <td colSpan={11} className="py-2">
                    <EmptyState compact subText={subText} title="No orders match these filters." />
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
      {returnOrder && (
        <ReturnModal
          order={returnOrder}
          onClose={() => setReturnOrder(null)}
          onSave={(r) => returnItems(returnOrder, r)}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
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
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={`border-b ${dark ? "border-slate-800 text-slate-400" : "border-slate-200 text-slate-500"} text-[11px]`}>
                        <th className="text-left py-1.5 font-medium">Item Name</th>
                        <th className="text-center py-1.5 font-medium w-12">Qty</th>
                        <th className="text-right py-1.5 font-medium w-20">Unit Price</th>
                        <th className="text-right py-1.5 font-medium w-24">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selected.lineItems.map((li, i) => (
                        <tr key={i} className="py-1">
                          <td className="py-1.5 font-medium">{li.name}</td>
                          <td className="text-center py-1.5">{li.qty}</td>
                          <td className="text-right py-1.5 whitespace-nowrap">{money(li.price)}</td>
                          <td className="text-right py-1.5 font-semibold whitespace-nowrap">{money(li.price * li.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                    className="btn btn-success h-[42px] shrink-0"
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
              onClick={() => printInvoice(selected)}
              className="btn btn-primary btn-block mt-2"
            >
              <Printer size={14} />
              {" Print Invoice"}
            </button>
            {selected.returns && selected.returns.length > 0 && (
              <div className={`pt-2 border-t border-dashed ${dark ? "border-slate-800" : "border-slate-200"}`}>
                <p className={`text-[11px] font-medium mb-1 ${subText}`}>Returns</p>
                {selected.returns.map((r, i) => (
                  <div key={i} className={`flex justify-between text-[11px] ${subText}`}>
                    <span>
                      {fmtDate(r.date)} — {r.name} × {r.qty} ({r.disposition === RETURN_STOCK ? "to stock" : "to expenses"})
                    </span>
                    <span className="font-medium">−{money(r.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                setReturnOrder(selected);
                setSelected(null);
              }}
              disabled={!(selected.lineItems && selected.lineItems.length > 0)}
              className="btn btn-warning btn-block mt-2"
            >
              {" Return Items"}
            </button>
            <button
              onClick={() => deleteOrder(selected)}
              className="btn btn-danger btn-block mt-2"
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
