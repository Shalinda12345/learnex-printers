import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Pencil,
  Plus,
  ReceiptText,
  Route,
  Save,
  Trash2,
  Wallet,
} from "@/components/learnex/icons";
import { Badge, Field, FileUpload, Modal, StatCard, inputCls } from "@/components/learnex/ui";
import {
  CASH_ACCOUNT_TYPES,
  NON_PNL_LABEL,
  cashAccountBalance,
  cashAccountOf,
  cashLinesFor,
  computeNonPnL,
  isPnlTxn,
  makeCashTxn,
  payablesFromPOs,
  receivablesFromOrders,
  transferEntries,
  txnKind,
} from "@/lib/learnex/accounting";
import { downloadCSV, fmtDate, money, numVal, round2, todayISO } from "@/lib/learnex/utils";

/* =====================================================================
   CASH & BANK — the cash accounts every payment flows through.
   Sales receipts, operating expenses and purchases of stock and raw
   materials all move through these accounts. What keeps a purchase out of
   the Profit or Loss statement is how it is classified, not which account
   pays for it, so no separate purchasing account is needed.
===================================================================== */
export function CashMoveModal({
  mode,
  cashAccounts,
  ledger,
  onClose,
  onSave,
  dark,
  cardBg,
  subText,
  inputBg,
}) {
  const first = (cashAccounts[0] && cashAccounts[0].id) || "";
  const purchases = (cashAccounts[1] || cashAccounts[0] || {}).id || first;
  const [fromAcc, setFromAcc] = useState(mode === "transfer" ? first : first);
  const [toAcc, setToAcc] = useState(mode === "transfer" ? purchases : purchases);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [desc, setDesc] = useState("");
  const [source, setSource] = useState("Owner Capital");
  const [attachment, setAttachment] = useState(null);
  const titles = { transfer: "Transfer Between Accounts", in: "Record Money In", out: "Record Money Out" };
  const amt = round2(numVal(amount, 0));
  function submit(e) {
    e.preventDefault();
    if (amt <= 0) return;
    onSave({ mode, fromAcc, toAcc, amount: amt, date, desc, source, attachment });
  }
  const accSelect = (value, setter, label) => (
    <Field label={label} subText={subText}>
      <select value={value} onChange={(e) => setter(e.target.value)} className={inputCls(inputBg)}>
        {cashAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {" — "}
            {money(cashAccountBalance(a.id, ledger, cashAccounts))}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <Modal title={titles[mode]} onClose={onClose} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        {mode === "transfer" && (
          <p className={`text-xs ${subText}`}>
            {
              "Moving your own money between your own accounts. This never affects profit — it only changes where the cash sits."
            }
          </p>
        )}
        {mode === "in" && (
          <p className={`text-xs ${subText}`}>
            Money coming into an account that is not a sale: owner&apos;s capital, a loan, or a transfer in
            from outside. Capital and loans are equity/liability movements, so they stay out of the Profit or
            Loss statement.
          </p>
        )}
        {mode === "out" && (
          <p className={`text-xs ${subText}`}>
            {
              "Money leaving an account that is not a business expense — for example the owner taking money out (drawings) or repaying a loan."
            }
          </p>
        )}
        {mode === "transfer" && accSelect(fromAcc, setFromAcc, "From Account")}
        {mode === "transfer" && accSelect(toAcc, setToAcc, "To Account")}
        {mode !== "transfer" &&
          accSelect(mode === "in" ? toAcc : fromAcc, mode === "in" ? setToAcc : setFromAcc, "Account")}
        {mode !== "transfer" && (
          <Field label={mode === "in" ? "Received As" : "Paid As"} subText={subText}>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls(inputBg)}>
              {(mode === "in"
                ? ["Owner Capital", "Loan Received", "Other Income"]
                : ["Owner Drawings", "Loan Repayment", "Supplier Payment"]
              ).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" subText={subText}>
            <input
              required={true}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls(inputBg)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Date" subText={subText}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls(inputBg)}
            />
          </Field>
        </div>
        <Field label="Note (optional)" subText={subText}>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className={inputCls(inputBg)}
            placeholder="e.g. Cash moved to fund this week's material purchases"
          />
        </Field>
        <FileUpload
          label="Attach Slip (optional)"
          value={attachment}
          onChange={setAttachment}
          dark={dark}
          subText={subText}
        />
        {mode === "transfer" && fromAcc === toAcc && (
          <p className="text-xs text-amber-600">Choose two different accounts.</p>
        )}
        <button
          type="submit"
          disabled={mode === "transfer" && fromAcc === toAcc}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors disabled:opacity-40"
        >
          <Save size={15} />
          {" Record"}
        </button>
      </form>
    </Modal>
  );
}
export function CashAccountModal({ initial, onClose, onSave, dark, cardBg, subText, inputBg }) {
  const [form, setForm] = useState(
    initial || { name: "", type: CASH_ACCOUNT_TYPES[0], opening: "", notes: "" },
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    if (!form.name) return;
    onSave({ ...form, opening: round2(numVal(form.opening, 0)) });
  }
  return (
    <Modal
      title={initial ? `Edit ${initial.name}` : "New Cash Account"}
      onClose={onClose}
      cardBg={cardBg}
      dark={dark}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Account Name" subText={subText}>
          <input
            required={true}
            value={form.name}
            onChange={set("name")}
            className={inputCls(inputBg)}
            placeholder={"e.g. Petty Cash — Workshop"}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" subText={subText}>
            <select value={form.type} onChange={set("type")} className={inputCls(inputBg)}>
              {CASH_ACCOUNT_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Opening Balance" subText={subText}>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={form.opening}
              onChange={set("opening")}
              className={inputCls(inputBg)}
              placeholder="0.00"
            />
          </Field>
        </div>
        <p className={`text-xs ${subText}`}>
          The opening balance is the cash that was already in this account before you started recording
          movements here. It is added on top of everything the system tracks, so nothing already entered is
          changed.
        </p>
        <Field label="Notes (optional)" subText={subText}>
          <textarea value={form.notes || ""} onChange={set("notes")} rows={2} className={inputCls(inputBg)} />
        </Field>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Save size={15} />
          {initial ? " Save Changes" : " Create Account"}
        </button>
      </form>
    </Modal>
  );
}
export function CashAccounts({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  cashAccounts,
  setCashAccounts,
  ledger,
  setLedger,
  purchaseOrders,
  salesOrders,
}) {
  const [moveMode, setMoveMode] = useState(null);
  const [accModal, setAccModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [accFilter, setAccFilter] = useState("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kindFilter, setKindFilter] = useState("All");
  const rows = cashAccounts.map((a) => {
    const lines = cashLinesFor(ledger, a.id, "", "");
    const inn = round2(lines.filter((t) => t.type === "Income").reduce((s, t) => s + numVal(t.amount, 0), 0));
    const out = round2(lines.filter((t) => t.type !== "Income").reduce((s, t) => s + numVal(t.amount, 0), 0));
    return { ...a, inn, out, balance: cashAccountBalance(a.id, ledger, cashAccounts), count: lines.length };
  });
  const grand = round2(rows.reduce((s, r) => s + r.balance, 0));
  const spentOnPurchases = computeNonPnL(ledger, "", "").asset_purchase;
  const payables = payablesFromPOs(purchaseOrders);
  const receivables = receivablesFromOrders(salesOrders);
  const book = cashLinesFor(ledger, accFilter, from, to).filter(
    (t) =>
      kindFilter === "All" ||
      (kindFilter === "Purchases" && txnKind(t) === "asset_purchase") ||
      (kindFilter === "Money In" && t.type === "Income") ||
      (kindFilter === "Money Out" && t.type !== "Income"),
  );
  const accName = (id) => {
    const a = cashAccounts.find((x) => x.id === id);
    return a ? a.name : id;
  };
  function saveMove({ mode, fromAcc, toAcc, amount, date, desc, source, attachment }) {
    let additions;
    if (mode === "transfer") {
      const note = desc || `Transfer ${accName(fromAcc)} → ${accName(toAcc)}`;
      additions = transferEntries({ ledger, date, desc: note, amount, from: fromAcc, to: toAcc, attachment });
      setToast(
        `${money(amount)} transferred to ${accName(toAcc)}. Profit is unaffected — this is only a movement of your own cash.`,
      );
    } else if (mode === "in") {
      const kind =
        source === "Owner Capital" ? "capital_in" : source === "Loan Received" ? "ar_collection" : "revenue";
      additions = [
        makeCashTxn({
          ledger,
          date,
          desc: desc || `${source} received`,
          type: "Income",
          category: source,
          amount,
          account: toAcc,
          kind,
          attachment,
        }),
      ];
      setToast(`${money(amount)} recorded into ${accName(toAcc)} as ${source}.`);
    } else {
      const kind = source === "Owner Drawings" ? "capital_out" : "ap_settlement";
      additions = [
        makeCashTxn({
          ledger,
          date,
          desc: desc || source,
          type: "Expense",
          category: source,
          amount,
          account: fromAcc,
          kind,
          attachment,
        }),
      ];
      setToast(`${money(amount)} recorded out of ${accName(fromAcc)} as ${source}.`);
    }
    setLedger((prev) => [...additions, ...prev]);
    setMoveMode(null);
  }
  function saveAccount(data) {
    if (editing) {
      // Balances are always calculated from the ledger; drop any copy an
      // earlier version stored on the account by mistake.
      const calculated = ["inn", "out", "balance", "count"];
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !calculated.includes(k)));
      setCashAccounts((prev) => prev.map((a) => (a.id === editing.id ? clean({ ...a, ...data }) : a)));
      setToast(`${data.name} updated.`);
    } else {
      const id = "ACC-" + Date.now().toString(36).toUpperCase();
      setCashAccounts((prev) => [...prev, { id, purpose: "general", system: false, ...data }]);
      setToast(`${data.name} created.`);
    }
    setAccModal(false);
    setEditing(null);
  }
  function deleteAccount(a) {
    if (a.system) {
      setToast("Built-in accounts cannot be deleted, because other modules post to them.");
      return;
    }
    const used = cashLinesFor(ledger, a.id, "", "").length;
    if (used > 0) {
      setToast(
        `${a.name} has ${used} transaction(s) posted to it and cannot be deleted. Set its opening balance to 0 instead.`,
      );
      return;
    }
    if (!window.confirm(`Delete the cash account "${a.name}"?`)) return;
    setCashAccounts((prev) => prev.filter((x) => x.id !== a.id));
    setToast(`${a.name} deleted.`);
  }
  // One-click repair for an account that has been paid out of without ever
  // being funded. It moves the shortfall across from another account, so the
  // split between accounts finally matches the cash actually in hand. The
  // business total does not change, and profit is untouched.
  function topUpAccount(a) {
    const shortfall = round2(-a.balance);
    if (shortfall <= 0) return;
    const source =
      cashAccounts.find((x) => x.id !== a.id && x.purpose === "general" && x.type === "Cash") ||
      cashAccounts.find((x) => x.id !== a.id && x.purpose === "general") ||
      cashAccounts.find((x) => x.id !== a.id);
    if (!source) {
      setToast(
        "There is no other account to move money from. Add one first, or set an opening balance on this account.",
      );
      return;
    }
    if (
      !window.confirm(
        `Move ${money(shortfall)} from "${source.name}" into "${a.name}"?\n\nThis records a transfer between your own accounts. Your total cash and your profit both stay exactly the same — only the split between the two accounts changes.`,
      )
    )
      return;
    const [out, inn] = transferEntries({
      ledger,
      date: todayISO(),
      desc: `Top-up — ${source.name} → ${a.name}`,
      amount: shortfall,
      from: source.id,
      to: a.id,
    });
    setLedger((prev) => [inn, out, ...prev]);
    setToast(
      `${money(shortfall)} moved from ${source.name} into ${a.name}. Both balances now match your real cash.`,
    );
  }
  function exportBook() {
    downloadCSV("cash_book.csv", [
      ["Date", "Account", "Description", "Category", "Treatment", "Money In", "Money Out"],
      ...book.map((t) => [
        fmtDate(t.date),
        accName(cashAccountOf(t)),
        t.desc,
        t.category,
        isPnlTxn(t) ? "Profit or Loss" : NON_PNL_LABEL[txnKind(t)] || "Balance sheet",
        t.type === "Income" ? numVal(t.amount, 0) : "",
        t.type !== "Income" ? numVal(t.amount, 0) : "",
      ]),
    ]);
    setToast("Cash book exported as CSV.");
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{"Cash & Bank Accounts"}</h1>
          <p className={`text-sm ${subText}`}>
            Every rupee that moves, and which account it moved through. Purchases of stock and raw materials
            are paid from cash like anything else, and still never touch profit.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setMoveMode("transfer")}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
          >
            <Route size={15} />
            {" Transfer"}
          </button>
          <button
            onClick={() => setMoveMode("in")}
            className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-colors ${dark ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            <ArrowDownRight size={15} />
            {" Money In"}
          </button>
          <button
            onClick={() => setMoveMode("out")}
            className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-colors ${dark ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            <ArrowUpRight size={15} />
            {" Money Out"}
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setAccModal(true);
            }}
            className={`flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl border transition-colors ${dark ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            <Plus size={15} />
            {" Account"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={"Total Cash & Bank"}
          value={money(grand)}
          valueClass={grand >= 0 ? "text-emerald-600" : "text-red-600"}
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label={"Spent on Stock & Materials"}
          value={money(spentOnPurchases)}
          cardBg={cardBg}
          subText={subText}
        >
          <p className={`text-xs ${subText} mt-1`}>{"Cash out, inventory in — never an expense"}</p>
        </StatCard>
        <StatCard
          label="Receivable (owed to you)"
          value={money(receivables)}
          valueClass="text-amber-600"
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label="Payable (you owe suppliers)"
          value={money(payables)}
          valueClass="text-red-600"
          cardBg={cardBg}
          subText={subText}
        />
      </div>
      {rows.some((a) => a.balance < 0) && (
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">An account has been paid out of without being funded</p>
              <p className={`text-xs ${subText} mt-1 leading-relaxed`}>
                {
                  "Your total cash is still correct — the money really did leave the business — and your profit is unaffected. But the split between accounts does not match what is in your hand, because the payment came out of an account that had nothing in it. Move the shortfall across from the account the money actually came from:"
                }
              </p>
              <div className="flex gap-2 flex-wrap mt-3">
                {rows
                  .filter((a) => a.balance < 0)
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => topUpAccount(a)}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3.5 py-2 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
                    >
                      <Route size={13} />
                      {` Top up ${a.name} with ${money(round2(-a.balance))}`}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="p-5 pb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Wallet size={16} className={subText} />
            {" Accounts"}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-3 px-5">Account</th>
                <th className="font-medium py-3 px-2">Type</th>
                <th className="font-medium py-3 px-2">Opening</th>
                <th className="font-medium py-3 px-2">Money In</th>
                <th className="font-medium py-3 px-2">Money Out</th>
                <th className="font-medium py-3 px-2">Balance</th>
                <th className="font-medium py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                >
                  <td className="py-3 px-5">
                    <p className="font-medium">{a.name}</p>
                    {a.notes && <p className={`text-xs ${subText} max-w-[180px] line-clamp-2`}>{a.notes}</p>}
                  </td>
                  <td className={`py-3 px-2 ${subText}`}>{a.type}</td>
                  <td className={`py-3 px-2 ${subText}`}>{money(numVal(a.opening, 0))}</td>
                  <td className="py-3 px-2 text-emerald-600">{money(a.inn)}</td>
                  <td className="py-3 px-2 text-red-600">{money(a.out)}</td>
                  <td className={`py-3 px-2 font-bold ${a.balance >= 0 ? "" : "text-red-600"}`}>
                    {money(a.balance)}
                  </td>
                  <td className="py-3 px-5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          // The stored account, not this row (which also carries calculated figures).
                          setEditing(cashAccounts.find((x) => x.id === a.id));
                          setAccModal(true);
                        }}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => deleteAccount(a)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 pb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <ReceiptText size={16} className={subText} />
            {" Cash Book"}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={accFilter}
              onChange={(e) => setAccFilter(e.target.value)}
              className={`text-xs px-3 py-1.5 rounded-xl border ${inputBg}`}
            >
              <option value="All">All accounts</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className={`text-xs px-3 py-1.5 rounded-xl border ${inputBg}`}
            >
              {["All", "Money In", "Money Out", "Purchases"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`text-xs px-3 py-1.5 rounded-xl border ${inputBg}`}
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`text-xs px-3 py-1.5 rounded-xl border ${inputBg}`}
            />
            {(from || to) && (
              <button
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                className={`text-xs font-medium ${dark ? "text-blue-400" : "text-blue-600"}`}
              >
                Clear
              </button>
            )}
            <button
              onClick={exportBook}
              className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
            >
              <Download size={12} />
              {" CSV"}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-2 px-5">Date</th>
                <th className="font-medium py-2 px-2">Description</th>
                <th className="font-medium py-2 px-2">Account</th>
                <th className="font-medium py-2 px-2">Treatment</th>
                <th className="font-medium py-2 px-2 text-right">In</th>
                <th className="font-medium py-2 px-5 text-right">Out</th>
              </tr>
            </thead>
            <tbody>
              {book.slice(0, 400).map((t) => {
                const k = txnKind(t);
                const pnl = isPnlTxn(t);
                return (
                  <tr
                    key={t.id}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                  >
                    <td className={`py-3 px-5 ${subText}`}>{fmtDate(t.date)}</td>
                    <td className="py-3 px-2">
                      <p className="font-medium">{t.desc}</p>
                      <p className={`text-xs ${subText}`}>{t.category}</p>
                    </td>
                    <td className={`py-3 px-2 ${subText}`}>{accName(cashAccountOf(t))}</td>
                    <td className="py-3 px-2">
                      <Badge tone={pnl ? "blue" : "slate"}>
                        {pnl ? "Profit or Loss" : NON_PNL_LABEL[k] || "Balance sheet"}
                      </Badge>
                    </td>
                    <td className="py-3 px-2 text-right text-emerald-600 font-medium">
                      {t.type === "Income" ? money(t.amount) : ""}
                    </td>
                    <td className="py-3 px-5 text-right text-red-600 font-medium">
                      {t.type !== "Income" ? money(t.amount) : ""}
                    </td>
                  </tr>
                );
              })}
              {book.length === 0 && (
                <tr>
                  <td colSpan={6} className={`text-center py-10 text-sm ${subText}`}>
                    No cash movements match these filters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {book.length > 400 && (
          <p className={`text-xs ${subText} p-4`}>
            Showing the 400 most recent movements. Narrow the date range or export to CSV for the full
            history.
          </p>
        )}
      </div>
      {moveMode && (
        <CashMoveModal
          mode={moveMode}
          cashAccounts={cashAccounts}
          ledger={ledger}
          onClose={() => setMoveMode(null)}
          onSave={saveMove}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
        />
      )}
      {accModal && (
        <CashAccountModal
          initial={editing}
          onClose={() => {
            setAccModal(false);
            setEditing(null);
          }}
          onSave={saveAccount}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
        />
      )}
    </div>
  );
}
