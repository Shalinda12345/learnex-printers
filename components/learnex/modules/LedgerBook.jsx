import { useState, useMemo } from "react";
import { AttachmentLink, Badge, Field, FileUpload, Modal, inputCls } from "@/components/learnex/ui";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  NON_PNL_LABEL,
  SEED_CASH_ACCOUNTS,
  computeNonPnL,
  computePnL,
  isPnlTxn,
  payablesFromPOs,
  receivablesFromOrders,
  totalCash,
  txnKind,
} from "@/lib/learnex/accounting";
import { Plus, ReceiptText, Save, Trash2 } from "@/components/learnex/icons";
import { REVENUE_TREND } from "@/lib/learnex/seed";
import { TrendChart } from "@/components/learnex/charts";
import { fmtDate, money, round2, todayISO } from "@/lib/learnex/utils";
import { nextSeq } from "@/lib/learnex/persistence";

export function LedgerModal({ onClose, onSave, dark, cardBg, subText, inputBg, cashAccounts }) {
  const accs = cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
  const [account, setAccount] = useState((accs.find((a) => a.purpose === "general") || accs[0]).id);
  const [type, setType] = useState("Expense");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [attachment, setAttachment] = useState(null);
  function switchType(t) {
    setType(t);
    setCategory(t === "Income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  }
  function submit(e) {
    e.preventDefault();
    if (!desc || !amount) return;
    const kind = txnKind({ type, category });
    onSave({ type, desc, category, amount: round2(amount), date, attachment, account, kind });
  }
  return (
    <Modal title="New Ledger Entry" onClose={onClose} cardBg={cardBg} dark={dark}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => switchType("Income")}
            className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${type === "Income" ? "bg-emerald-600 text-white border-emerald-600" : dark ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => switchType("Expense")}
            className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${type === "Expense" ? "bg-red-600 text-white border-red-600" : dark ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}
          >
            Expense
          </button>
        </div>
        <Field label="Description" subText={subText}>
          <input
            required={true}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className={inputCls(inputBg)}
            placeholder={
              type === "Income" ? "e.g. Cash sale — walk-in customer" : "e.g. Office electricity bill"
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" subText={subText}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputCls(inputBg)}
            >
              {(type === "Income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
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
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" subText={subText}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls(inputBg)}
            />
          </Field>
          <Field label={type === "Income" ? "Received Into" : "Paid From"} subText={subText}>
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
        </div>
        <div className={`rounded-xl border p-3 ${dark ? "border-slate-700" : "border-slate-200"}`}>
          <p className="text-xs font-medium mb-1">Accounting treatment</p>
          <p className={`text-xs ${subText}`}>
            {isPnlTxn({ type, category })
              ? "Goes into the Profit or Loss statement."
              : (NON_PNL_LABEL[txnKind({ type, category })] || "Balance sheet movement") +
                " \u2014 this will not change your profit."}
          </p>
        </div>
        <FileUpload
          label="Attach Receipt / Slip (optional)"
          value={attachment}
          onChange={setAttachment}
          dark={dark}
          subText={subText}
          inputBg={inputBg}
        />
        <button
          type="submit"
          className={`w-full flex items-center justify-center gap-2 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md transition-colors ${type === "Income" ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/20" : "bg-red-600 hover:bg-red-700 shadow-red-900/20"}`}
        >
          <Save size={15} />
          {" Record "}
          {type}
        </button>
      </form>
    </Modal>
  );
}
export function LedgerBook({
  dark,
  cardBg,
  subText,
  inputBg,
  hoverRow,
  setToast,
  ledger,
  setLedger,
  customers,
  cashAccounts,
  salesOrders,
  purchaseOrders,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("All");
  const accs = cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
  // Income, expenses and profit all come from the Profit or Loss engine, so
  // stock and raw material purchases are excluded from every figure here.
  const pnl = useMemo(() => computePnL(ledger, "", ""), [ledger]);
  const excluded = useMemo(() => computeNonPnL(ledger, "", ""), [ledger]);
  const income = pnl.totalIncome;
  const expenses = round2(pnl.cogs + pnl.totalOpex);
  const net = pnl.netProfit;
  const cashTotal = useMemo(() => totalCash(ledger, accs), [ledger, accs]);
  const receivable = receivablesFromOrders(salesOrders);
  const payable = payablesFromPOs(purchaseOrders);
  const filtered = ledger.filter((t) => typeFilter === "All" || t.type === typeFilter);
  const sorted = [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1));
  async function saveEntry(data) {
    const id = await nextSeq(ledger, "id", "TXN-", 8821);
    setLedger((prev) => [{ id, ...data }, ...prev]);
    setToast(`${data.type} of ${money(data.amount)} recorded.`);
    setModalOpen(false);
  }
  function deleteEntry(t) {
    if (!window.confirm("Delete this ledger entry?")) return;
    setLedger((prev) => prev.filter((x) => x.id !== t.id));
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{"Ledger & Overview"}</h3>
          <p className={`text-sm ${subText}`}>
            Every line recorded, and how each one is treated for accounting
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-md shadow-blue-900/20 transition-colors"
        >
          <Plus size={16} />
          {" New Entry"}
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>{"Total Income (P&L)"}</p>
          <p className="text-xl font-bold mt-1 text-emerald-600">{money(income)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>{"Total Expenses (P&L)"}</p>
          <p className="text-xl font-bold mt-1 text-red-600">{money(expenses)}</p>
          <p className={`text-xs ${subText} mt-1`}>Purchases excluded</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Net Profit (all time)</p>
          <p className={`text-xl font-bold mt-1 ${net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {money(net)}
          </p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>{"Cash & Bank"}</p>
          <p className={`text-xl font-bold mt-1 ${cashTotal >= 0 ? "" : "text-red-600"}`}>
            {money(cashTotal)}
          </p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Accounts Receivable</p>
          <p className="text-xl font-bold mt-1 text-amber-600">{money(receivable)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Accounts Payable</p>
          <p className="text-xl font-bold mt-1 text-red-600">{money(payable)}</p>
        </div>
      </div>
      <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
        <p className="text-sm font-medium">{"Stock & raw material purchases are kept out of profit"}</p>
        <p className={`text-xs ${subText} mt-1 leading-relaxed`}>
          {money(excluded.asset_purchase)}
          {
            " of purchases has been recorded so far. It is paid out of a cash account and sits in inventory on the Statement of Financial Position \u2014 it never reduces the net profit figure above."
          }
        </p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`xl:col-span-2 rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <ReceiptText size={16} className={subText} />
              {" Ledger Entries"}
            </h3>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={`text-xs px-3 py-1.5 rounded-xl border ${inputBg}`}
            >
              {["All", "Income", "Expense"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <th className="font-medium py-2 px-5">Description</th>
                  <th className="font-medium py-2 px-2">Category</th>
                  <th className="font-medium py-2 px-2">Treatment</th>
                  <th className="font-medium py-2 px-2">Date</th>
                  <th className="font-medium py-2 px-2">Amount</th>
                  <th className="font-medium py-2 px-2">Slip</th>
                  <th className="font-medium py-2 px-5" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                  >
                    <td className="py-3 px-5 font-medium">{t.desc}</td>
                    <td className={`py-3 px-2 ${subText}`}>{t.category}</td>
                    <td className="py-3 px-2">
                      <Badge tone={isPnlTxn(t) ? "blue" : "slate"}>
                        {isPnlTxn(t) ? "Profit or Loss" : "Balance sheet"}
                      </Badge>
                    </td>
                    <td className={`py-3 px-2 ${subText}`}>{fmtDate(t.date)}</td>
                    <td
                      className={`py-3 px-2 font-medium ${t.type === "Income" ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {t.type === "Income" ? "+" : "−"}
                      {money(t.amount)}
                    </td>
                    <td className="py-3 px-2">
                      <AttachmentLink attachment={t.attachment} subText={subText} />
                    </td>
                    <td className="py-3 px-5 text-right">
                      <button
                        onClick={() => deleteEntry(t)}
                        className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`text-center py-8 text-sm ${subText}`}>
                      No ledger entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
          <h3 className="font-semibold mb-3">Weekly Revenue vs Expenses</h3>
          <p className={`text-xs ${subText} mb-2`}>Sample trend</p>
          <TrendChart data={REVENUE_TREND} dark={dark} />
        </div>
      </div>
      {modalOpen && (
        <LedgerModal
          onClose={() => setModalOpen(false)}
          onSave={saveEntry}
          dark={dark}
          cardBg={cardBg}
          subText={subText}
          inputBg={inputBg}
          cashAccounts={accs}
        />
      )}
    </div>
  );
}
