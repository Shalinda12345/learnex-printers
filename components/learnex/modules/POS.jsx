import { useState } from "react";
import { Badge, Field, inputCls } from "@/components/learnex/ui";
import { CATEGORY_COLORS } from "@/lib/learnex/seed";
import { Minus, Package, Plus, Search, ShoppingCart, Trash2 } from "@/components/learnex/icons";
import { nextTxnId, withDefaultAccounts } from "@/lib/learnex/accounting";
import { money, nextSeqId, numVal, round2, stockStatus, todayISO } from "@/lib/learnex/utils";

/* =====================================================================
   POS
===================================================================== */
export function POS({
  dark,
  cardBg,
  subText,
  inputBg,
  setToast,
  products,
  setProducts,
  customers,
  setCustomers,
  salesOrders,
  setSalesOrders,
  ledger,
  setLedger,
  settings,
  cashAccounts,
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState([]);
  const [payment, setPayment] = useState("Cash");
  const accs = withDefaultAccounts(cashAccounts);
  // Money paid by Card or Bank never touches the physical cash drawer, so it
  // must land in a Bank-type account, not the Cash account — otherwise the
  // Cash Account balance ends up overstated (money that was never actually
  // handed over in cash) and the Bank Account understated.
  const posAccountId =
    payment === "Cash"
      ? (accs.find((a) => a.type === "Cash" && a.purpose === "general") || accs[0]).id
      : (accs.find((a) => a.type === "Bank") || accs.find((a) => a.purpose === "general") || accs[0]).id;
  const [customerId, setCustomerId] = useState("walkin");
  const categories = ["All", ...new Set(products.map((p) => p.category))];
  const filtered = products.filter(
    (p) =>
      (category === "All" || p.category === category) && p.name.toLowerCase().includes(query.toLowerCase()),
  );
  function addToCart(p) {
    if (p.stock === 0) return;
    setCart((c) => {
      const existing = c.find((i) => i.id === p.id);
      if (existing) return c.map((i) => (i.id === p.id ? { ...i, qty: Math.min(i.qty + 1, p.stock) } : i));
      return [...c, { ...p, qty: 1 }];
    });
  }
  function changeQty(id, delta) {
    setCart((c) =>
      c.map((i) => (i.id === id ? { ...i, qty: Math.max(1, Math.min(i.qty + delta, i.stock)) } : i)),
    );
  }
  function removeItem(id) {
    setCart((c) => c.filter((i) => i.id !== id));
  }
  const subtotal = round2(cart.reduce((s, i) => s + i.price * i.qty, 0));
  const taxRate = Number(settings.taxRate) || 0;
  const tax = round2(subtotal * (taxRate / 100));
  const total = round2(subtotal + tax);
  function checkout() {
    if (cart.length === 0) return;
    // reduce stock
    setProducts((prev) =>
      prev.map((p) => {
        const item = cart.find((i) => i.id === p.id);
        return item ? { ...p, stock: Math.max(0, p.stock - item.qty) } : p;
      }),
    );
    const customer =
      customerId === "walkin"
        ? { id: "walkin", name: "Walk-in Customer" }
        : customers.find((c) => c.id === Number(customerId));
    const invoice = nextSeqId(salesOrders, "invoice", "INV-", 2461);
    const soId = nextSeqId(salesOrders, "id", "SO-", 1042);
    const date = todayISO();
    const newOrder = {
      id: soId,
      invoice,
      customer: customer.name,
      customerId: customer.id === "walkin" ? null : customer.id,
      items: cart.reduce((s, i) => s + i.qty, 0),
      lineItems: cart.map((i) => ({ productId: i.id, name: i.name, qty: i.qty, price: i.price })),
      amount: total,
      tax,
      status: "Delivered",
      payment: "Paid",
      date,
      channel: "POS",
      amountPaid: total,
      payments: [{ date, amount: total }],
      accrued: true,
    };
    setSalesOrders((prev) => [newOrder, ...prev]);
    if (customer.id !== "walkin") {
      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, orders: c.orders + 1, spent: c.spent + total } : c)),
      );
    }
    // Revenue and the cost of the goods that just left the shelf are booked
    // together, so gross profit on the Profit or Loss statement is real.
    const cogsAmount = round2(
      cart.reduce((s, i) => {
        const p = products.find((x) => x.id === i.id);
        return s + (p ? numVal(p.cost, 0) : 0) * i.qty;
      }, 0),
    );
    const additions = [
      {
        id: nextTxnId(ledger),
        date,
        desc: `POS sale — ${invoice} (${customer.name})`,
        type: "Income",
        category: "Sales",
        amount: round2(total),
        account: posAccountId,
        kind: "revenue",
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
    setToast(`Sale completed — ${money(total)} received via ${payment}. Invoice ${invoice} generated.`);
    setCart([]);
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 h-full">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border flex-1 ${inputBg}`}>
            <Search size={16} className={subText} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products or scan barcode..."
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${category === c ? "bg-blue-600 text-white" : `border ${dark ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((p) => {
            const status = stockStatus(p);
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={p.stock === 0}
                className={`text-left rounded-2xl border p-4 ${cardBg} shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:cursor-not-allowed`}
              >
                <div
                  className="w-full h-16 rounded-xl mb-3 flex items-center justify-center"
                  style={{ background: `${CATEGORY_COLORS[p.category] || "#64748B"}18` }}
                >
                  <Package size={22} style={{ color: CATEGORY_COLORS[p.category] || "#64748B" }} />
                </div>
                <p className="text-sm font-medium leading-tight line-clamp-2">{p.name}</p>
                <p className={`text-xs ${subText} mt-1`}>{p.sku}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="font-bold text-sm">{money(p.price)}</span>
                  <Badge tone={status.tone}>{p.stock === 0 ? "Out" : `${p.stock} left`}</Badge>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className={`col-span-full text-center py-10 text-sm ${subText}`}>
              No products match your search.
            </p>
          )}
        </div>
      </div>
      <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm flex flex-col h-fit lg:sticky lg:top-0`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Current Sale</h3>
          <Badge tone="blue">
            {cart.length}
            {" items"}
          </Badge>
        </div>
        <Field label="Customer" subText={subText}>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputCls(inputBg)}
          >
            <option value="walkin">Walk-in Customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex-1 space-y-3 max-h-[300px] overflow-y-auto pr-1 mt-3">
          {cart.length === 0 && (
            <div className={`text-center py-10 text-sm ${subText}`}>
              <ShoppingCart size={28} className="mx-auto mb-2 opacity-40" />
              {"Cart is empty — tap a product to add it."}
            </div>
          )}
          {cart.map((i) => (
            <div
              key={i.id}
              className={`flex items-center gap-2 pb-3 border-b ${dark ? "border-slate-800" : "border-slate-100"}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{i.name}</p>
                <p className={`text-xs ${subText}`}>
                  {money(i.price)}
                  {" × "}
                  {i.qty}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => changeQty(i.id, -1)}
                  className={`w-6 h-6 rounded-lg border flex items-center justify-center ${dark ? "border-slate-700" : "border-slate-200"}`}
                >
                  <Minus size={12} />
                </button>
                <span className="text-sm w-5 text-center">{i.qty}</span>
                <button
                  onClick={() => changeQty(i.id, 1)}
                  className={`w-6 h-6 rounded-lg border flex items-center justify-center ${dark ? "border-slate-700" : "border-slate-200"}`}
                >
                  <Plus size={12} />
                </button>
                <button
                  onClick={() => removeItem(i.id)}
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50 ml-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5 mt-3 text-sm">
          <div className="flex justify-between">
            <span className={subText}>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className={subText}>Tax ({taxRate}%)</span>
            <span>{money(tax)}</span>
          </div>
          <div className="flex justify-between text-base font-bold pt-2 border-t border-dashed">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </div>
        <div className="mt-4">
          <p className={`text-xs font-medium mb-2 ${subText}`}>Payment Method</p>
          <div className="grid grid-cols-3 gap-2">
            {["Cash", "Card", "Bank"].map((m) => (
              <button
                key={m}
                onClick={() => setPayment(m)}
                className={`py-2 rounded-xl text-xs font-medium border transition-colors ${payment === m ? "bg-blue-600 text-white border-blue-600" : dark ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={checkout}
          className="mt-4 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40"
          disabled={cart.length === 0}
        >
          {"Complete Sale — "}
          {money(total)}
        </button>
      </div>
    </div>
  );
}
