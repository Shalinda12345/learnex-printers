import { useState, useMemo } from "react";
import { AlertTriangle, CheckCircle2, Download, Printer, ShieldCheck } from "@/components/learnex/icons";
import { LedgerBook } from "@/components/learnex/modules/LedgerBook";
import { StatCard, TabBar } from "@/components/learnex/ui";
import {
  NON_PNL_LABEL,
  computeCashFlow,
  computeEquityChanges,
  computeFinancialPosition,
  computeNonPnL,
  computePnL,
  txnKind,
} from "@/lib/learnex/accounting";
import { EQUITY_COLUMNS, cashFlowRows, equityRows, pnlRows, positionRows } from "@/lib/learnex/statements";
import { downloadCSV, exportPDF, fmtDate, money, rangePresets, round2, todayISO } from "@/lib/learnex/utils";

/* =====================================================================
   FINANCIAL STATEMENTS — the four statements an accountant produces:
   the Profit or Loss statement (revenue less cost of sales gives gross
   profit, less operating expenses gives net profit), the Statement of
   Financial Position (what the business owns and owes, with that net
   profit carried in as retained earnings), the Statement of Cash Flows
   (where the cash came from and went) and the Statement of Changes in
   Equity (how the owner's stake moved).
===================================================================== */
// A deduction or outflow is shown in brackets, an inflow plainly.
const signedMoney = (v) => (v < 0 ? `(${money(-v)})` : money(v));
export function StmtRow({ label, value, indent, bold, tone, dark, subText, top, note }) {
  const toneCls = tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-600" : "";
  return (
    <div
      className={`flex items-start justify-between py-2 px-1 ${top ? `border-t ${dark ? "border-slate-800" : "border-slate-100"} mt-1` : ""}`}
    >
      <div className={indent ? "pl-5" : ""}>
        <span className={`text-sm ${bold ? "font-semibold" : ""}`}>{label}</span>
        {note && <p className={`text-xs ${subText} mt-0.5 max-w-xl`}>{note}</p>}
      </div>
      <span className={`text-sm ${bold ? "font-bold" : ""} ${toneCls} whitespace-nowrap`}>{value}</span>
    </div>
  );
}
export function StmtSection({ title, subText, children }) {
  return (
    <div className="mt-4">
      <p className={`text-xs font-semibold ${subText} uppercase tracking-wide mb-1`}>{title}</p>
      {children}
    </div>
  );
}
export function DateRangeBar({ from, to, setFrom, setTo, dark, subText, presets }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {presets &&
        presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
            className="btn btn-secondary btn-sm"
          >
            {p.label}
          </button>
        ))}
      <input aria-label="From date"
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className={`text-xs px-3 py-1.5 rounded-xl border ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-200"}`}
      />
      <span className={`text-xs ${subText}`}>to</span>
      <input aria-label="To date"
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className={`text-xs px-3 py-1.5 rounded-xl border ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-200"}`}
      />
      {(from || to) && (
        <button
          onClick={() => {
            setFrom("");
            setTo("");
          }}
          className={`text-xs font-medium ${dark ? "text-blue-400" : "text-blue-600"}`}
        >
          All time
        </button>
      )}
    </div>
  );
}
export function ProfitLossStatement({
  dark,
  cardBg,
  subText,
  hoverRow,
  setToast,
  ledger,
  settings,
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showLines, setShowLines] = useState(false);
  const pnl = useMemo(() => computePnL(ledger, from, to), [ledger, from, to]);
  const excluded = useMemo(() => computeNonPnL(ledger, from, to), [ledger, from, to]);
  const periodLabel =
    !from && !to
      ? "All time"
      : `${from ? fmtDate(from) : "the beginning"} to ${to ? fmtDate(to) : fmtDate(todayISO())}`;
  const opexCats = Object.keys(pnl.opexByCat).sort((a, b) => pnl.opexByCat[b] - pnl.opexByCat[a]);
  const cogsCats = Object.keys(pnl.cogsByCat).sort((a, b) => pnl.cogsByCat[b] - pnl.cogsByCat[a]);
  const revCats = Object.keys(pnl.revenueByCat).sort((a, b) => pnl.revenueByCat[b] - pnl.revenueByCat[a]);
  const othCats = Object.keys(pnl.otherIncomeByCat).sort(
    (a, b) => pnl.otherIncomeByCat[b] - pnl.otherIncomeByCat[a],
  );
  function doExport(fmt) {
    const headers = ["Profit or Loss Statement — " + periodLabel, "Amount"];
    const rows = pnlRows(pnl, excluded);
    if (fmt === "pdf") {
      exportPDF(`Profit or Loss Statement (${periodLabel})`, headers, rows);
      setToast("Statement opened — use your browser's print dialog to save as PDF.");
    } else {
      downloadCSV("profit_or_loss_statement.csv", [headers, ...rows]);
      setToast("Profit or Loss statement exported as CSV.");
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Profit or Loss Statement</h3>
          <p className={`text-xs ${subText}`}>
            {"For "}
            {periodLabel}
            {" — no date limit is applied unless you set one"}
          </p>
        </div>
        <DateRangeBar
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          dark={dark}
          subText={subText}
          presets={rangePresets()}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Revenue" value={money(pnl.netRevenue)} cardBg={cardBg} subText={subText} />
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Gross Profit</p>
          <p
            className={`text-xl font-bold mt-1 ${pnl.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {money(pnl.grossProfit)}
          </p>
          <p className={`text-xs ${subText} mt-1`}>{round2(pnl.grossMargin)}% margin</p>
        </div>
        <StatCard
          label="Operating Expenses"
          value={money(pnl.totalOpex)}
          valueClass="text-red-600"
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label="Net Profit"
          value={money(pnl.netProfit)}
          valueClass={pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}
          cardBg={cardBg}
          subText={subText}
        />
      </div>
      <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-bold text-base">{(settings && settings.businessName) || "Business"}</h3>
            <p className={`text-xs ${subText}`}>
              {"Profit or Loss Statement — "}
              {periodLabel}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => doExport("csv")}
              className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
            >
              <Download size={12} />
              {" CSV"}
            </button>
            <button
              onClick={() => doExport("pdf")}
              className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
            >
              <Printer size={12} />
              {" Print / PDF"}
            </button>
          </div>
        </div>
        <StmtSection title="Revenue" subText={subText}>
          {revCats.length === 0 && (
            <StmtRow
              label="No revenue recorded in this period"
              value={money(0)}
              indent={true}
              subText={subText}
              dark={dark}
            />
          )}
          {revCats.map((c) => (
            <StmtRow
              key={c}
              label={c}
              value={money(pnl.revenueByCat[c])}
              indent={true}
              subText={subText}
              dark={dark}
            />
          ))}
          {pnl.salesReturns > 0 && (
            <StmtRow
              label="Less: Sales Returns"
              value={`(${money(pnl.salesReturns)})`}
              indent={true}
              subText={subText}
              dark={dark}
              note="Money refunded to customers, or taken off their invoices, for goods they brought back."
            />
          )}
          <StmtRow
            label="Total Revenue"
            value={money(pnl.netRevenue)}
            bold={true}
            top={true}
            subText={subText}
            dark={dark}
          />
        </StmtSection>
        <StmtSection title="Less: Cost of Sales" subText={subText}>
          {cogsCats.length === 0 && (
            <StmtRow
              label="No cost of sales recorded"
              value={money(0)}
              indent={true}
              subText={subText}
              dark={dark}
            />
          )}
          {cogsCats.map((c) => (
            <StmtRow
              key={c}
              label={c}
              value={`(${money(pnl.cogsByCat[c])})`}
              indent={true}
              subText={subText}
              dark={dark}
            />
          ))}
          <StmtRow
            label="Gross Profit"
            value={money(pnl.grossProfit)}
            bold={true}
            top={true}
            tone={pnl.grossProfit >= 0 ? "pos" : "neg"}
            subText={subText}
            dark={dark}
          />
        </StmtSection>
        <StmtSection title="Less: Operating Expenses" subText={subText}>
          {opexCats.length === 0 && (
            <StmtRow
              label="No operating expenses recorded"
              value={money(0)}
              indent={true}
              subText={subText}
              dark={dark}
            />
          )}
          {opexCats.map((c) => (
            <StmtRow
              key={c}
              label={c}
              value={`(${money(pnl.opexByCat[c])})`}
              indent={true}
              subText={subText}
              dark={dark}
            />
          ))}
          <StmtRow
            label="Total Operating Expenses"
            value={`(${money(pnl.totalOpex)})`}
            bold={true}
            top={true}
            subText={subText}
            dark={dark}
          />
          <StmtRow
            label="Operating Profit"
            value={money(pnl.operatingProfit)}
            bold={true}
            tone={pnl.operatingProfit >= 0 ? "pos" : "neg"}
            subText={subText}
            dark={dark}
          />
        </StmtSection>
        {pnl.otherIncome > 0 && (
          <StmtSection title="Add: Other Income" subText={subText}>
            {othCats.map((c) => (
              <StmtRow
                key={c}
                label={c}
                value={money(pnl.otherIncomeByCat[c])}
                indent={true}
                subText={subText}
                dark={dark}
              />
            ))}
          </StmtSection>
        )}
        <div className={`mt-3 pt-3 border-t ${dark ? "border-slate-700" : "border-slate-200"}`}>
          <div className="flex items-center justify-between">
            <span className="font-bold">Net Profit for the Period</span>
            <span className={`font-bold text-lg ${pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {money(pnl.netProfit)}
            </span>
          </div>
          <p className={`text-xs ${subText} mt-1`}>
            {"Carried to the Statement of Financial Position as retained earnings. Net margin "}
            {round2(pnl.netMargin)}%.
          </p>
        </div>
      </div>
      <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
        <h3 className="font-semibold flex items-center gap-2 mb-1">
          <ShieldCheck size={16} className={subText} />
          {" Deliberately excluded from profit"}
        </h3>
        <p className={`text-xs ${subText} mb-3`}>
          These movements are real money, but they are not income or expenses. They belong on the Statement of
          Financial Position, which is why buying stock or raw materials no longer reduces your profit.
        </p>
        <StmtRow
          label={"Stock & raw material purchases"}
          value={money(excluded.asset_purchase)}
          indent={true}
          subText={subText}
          dark={dark}
          note={"Cash goes down, inventory goes up by the same amount — so profit is untouched."}
        />
        <StmtRow
          label="Fixed asset purchases"
          value={money(excluded.fixed_asset)}
          indent={true}
          subText={subText}
          dark={dark}
          note={"Equipment bought — a non-current asset. Cash goes down and the asset goes up."}
        />
        <StmtRow
          label="Owner's capital introduced"
          value={money(excluded.capital_in)}
          indent={true}
          subText={subText}
          dark={dark}
        />
        <StmtRow
          label="Owner's drawings"
          value={money(excluded.capital_out)}
          indent={true}
          subText={subText}
          dark={dark}
        />
        <StmtRow
          label="Loans received"
          value={money(excluded.loan_in)}
          indent={true}
          subText={subText}
          dark={dark}
          note={"Borrowed money is a liability that has to be repaid — it is not income."}
        />
        <StmtRow
          label="Loans repaid"
          value={money(excluded.loan_out)}
          indent={true}
          subText={subText}
          dark={dark}
        />
        <StmtRow
          label="Transfers between own accounts"
          value={money(excluded.transfer)}
          indent={true}
          subText={subText}
          dark={dark}
        />
        <StmtRow
          label="Customer receipts against invoices already booked"
          value={money(excluded.ar_collection)}
          indent={true}
          subText={subText}
          dark={dark}
        />
        <StmtRow
          label="Supplier bills settled"
          value={money(excluded.ap_settlement)}
          indent={true}
          subText={subText}
          dark={dark}
        />
        <button
          onClick={() => setShowLines((s) => !s)}
          className={`text-xs font-medium mt-3 ${dark ? "text-blue-400" : "text-blue-600"}`}
        >
          {showLines ? "Hide the individual lines" : `Show the ${excluded.lines.length} excluded line(s)`}
        </button>
        {showLines && (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr
                  className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <th className="font-medium py-2 px-2">Date</th>
                  <th className="font-medium py-2 px-2">Description</th>
                  <th className="font-medium py-2 px-2">Treatment</th>
                  <th className="font-medium py-2 px-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {excluded.lines.slice(0, 200).map((t) => (
                  <tr
                    key={t.id}
                    className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow}`}
                  >
                    <td className={`py-2 px-2 ${subText} whitespace-nowrap`}>{fmtDate(t.date)}</td>
                    <td className="py-2 px-2">{t.desc}</td>
                    <td className={`py-2 px-2 ${subText}`}>{NON_PNL_LABEL[txnKind(t)] || t.category}</td>
                    <td className="py-2 px-2 text-right font-medium whitespace-nowrap">{money(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
export function FinancialPosition({
  dark,
  cardBg,
  subText,
  setToast,
  ledger,
  cashAccounts,
  products,
  rawMaterials,
  salesOrders,
  purchaseOrders,
  deliveryRuns,
  settings,
}) {
  const pos = useMemo(
    () =>
      computeFinancialPosition({
        ledger,
        cashAccounts,
        products,
        rawMaterials,
        salesOrders,
        purchaseOrders,
        deliveryRuns,
        settings,
      }),
    [ledger, cashAccounts, products, rawMaterials, salesOrders, purchaseOrders, deliveryRuns, settings],
  );
  function doExport(fmt) {
    const headers = [`Statement of Financial Position as at ${fmtDate(pos.asOf)}`, "Amount"];
    const rows = positionRows(pos);
    if (fmt === "pdf") {
      exportPDF(`Statement of Financial Position as at ${fmtDate(pos.asOf)}`, headers, rows);
      setToast("Statement opened — use your browser's print dialog to save as PDF.");
    } else {
      downloadCSV("statement_of_financial_position.csv", [headers, ...rows]);
      setToast("Statement of Financial Position exported as CSV.");
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Statement of Financial Position</h3>
          <p className={`text-xs ${subText}`}>
            {"What the business owns and owes as at "}
            {fmtDate(pos.asOf)}. Inventory and receivables are always shown at their current position.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => doExport("csv")}
            className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
          >
            <Download size={12} />
            {" CSV"}
          </button>
          <button
            onClick={() => doExport("pdf")}
            className={`text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`}
          >
            <Printer size={12} />
            {" Print / PDF"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Assets" value={money(pos.totalAssets)} cardBg={cardBg} subText={subText} />
        <StatCard
          label="Total Liabilities"
          value={money(pos.totalLiabilities)}
          valueClass="text-red-600"
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label="Net Assets / Equity"
          value={money(pos.totalEquity)}
          valueClass="text-emerald-600"
          cardBg={cardBg}
          subText={subText}
        />
        <StatCard
          label="Retained Earnings"
          value={money(pos.retained)}
          valueClass={pos.retained >= 0 ? "text-emerald-600" : "text-red-600"}
          cardBg={cardBg}
          subText={subText}
        >
          <p className={`text-xs ${subText} mt-1`}>{"Net profit from the P&L, all time"}</p>
        </StatCard>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
          <h3 className="font-bold text-base mb-1">Assets</h3>
          <p className={`text-xs ${subText} mb-2`}>Everything the business owns</p>
          <StmtSection title="Non-current Assets" subText={subText}>
            <StmtRow
              label="Property, Plant & Equipment (at cost)"
              value={money(pos.ppe)}
              indent={true}
              subText={subText}
              dark={dark}
              note="Equipment and other fixed assets bought, recorded as Fixed Asset Purchase. Kept at cost — depreciation is not recorded yet."
            />
            <StmtRow
              label="Total Non-current Assets"
              value={money(pos.nonCurrentAssets)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
          </StmtSection>
          <StmtSection title="Current Assets" subText={subText}>
            {pos.cashRows.map((c) => (
              <StmtRow
                key={c.id}
                label={c.name}
                value={money(c.balance)}
                indent={true}
                subText={subText}
                dark={dark}
                tone={c.balance < 0 ? "neg" : undefined}
              />
            ))}
            <StmtRow
              label={"Total Cash & Bank"}
              value={money(pos.cash)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
            <StmtRow
              label="Trade Receivables"
              value={money(pos.receivables)}
              indent={true}
              subText={subText}
              dark={dark}
              note="Unpaid and part-paid customer invoices, including delivery credit bills."
            />
            <StmtRow
              label={"Inventory — Finished Goods (at cost)"}
              value={money(pos.finishedGoods)}
              indent={true}
              subText={subText}
              dark={dark}
            />
            <StmtRow
              label={"Inventory — Raw Materials (at cost)"}
              value={money(pos.rawMaterialStock)}
              indent={true}
              subText={subText}
              dark={dark}
              note={
                "Valued at weighted average cost — the blended cost of the stock actually on hand. This is where your raw material purchases live, as an asset, until the materials are consumed or sold."
              }
            />
            <StmtRow
              label={"Inventory — Stock out on Delivery Runs (at cost)"}
              value={money(pos.stockOnRuns)}
              indent={true}
              subText={subText}
              dark={dark}
              note="Goods taken out on a delivery run that is still open. They have left the shelf but are not sold until the run is closed."
            />
            <StmtRow
              label="Total Current Assets"
              value={money(pos.currentAssets)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
          </StmtSection>
          <div
            className={`mt-3 pt-3 border-t ${dark ? "border-slate-700" : "border-slate-200"} flex items-center justify-between`}
          >
            <span className="font-bold">Total Assets</span>
            <span className="font-bold text-lg">{money(pos.totalAssets)}</span>
          </div>
        </div>
        <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
          <h3 className="font-bold text-base mb-1">{"Liabilities & Equity"}</h3>
          <p className={`text-xs ${subText} mb-2`}>How those assets are funded</p>
          <StmtSection title="Non-current Liabilities" subText={subText}>
            <StmtRow
              label="Loans Payable"
              value={money(pos.loans)}
              indent={true}
              subText={subText}
              dark={dark}
              note="Loans received less loans repaid, recorded from Cash & Bank. Shown in full as non-current."
            />
            <StmtRow
              label="Total Non-current Liabilities"
              value={money(pos.nonCurrentLiabilities)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
          </StmtSection>
          <StmtSection title="Current Liabilities" subText={subText}>
            <StmtRow
              label="Trade Payables"
              value={money(pos.payables)}
              indent={true}
              subText={subText}
              dark={dark}
              note={
                "Purchase orders recorded as unpaid — goods received but the supplier has not been paid yet."
              }
            />
            <StmtRow
              label="Total Current Liabilities"
              value={money(pos.currentLiabilities)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
          </StmtSection>
          <div
            className={`mt-3 pt-3 border-t ${dark ? "border-slate-700" : "border-slate-200"} flex items-center justify-between`}
          >
            <span className="font-bold">Total Liabilities</span>
            <span className="font-bold">{money(pos.totalLiabilities)}</span>
          </div>
          <StmtSection title="Equity" subText={subText}>
            <StmtRow
              label="Opening Capital"
              value={money(pos.openingCapital)}
              indent={true}
              subText={subText}
              dark={dark}
            />
            <StmtRow
              label="Capital Introduced"
              value={money(pos.capitalIntroduced)}
              indent={true}
              subText={subText}
              dark={dark}
            />
            <StmtRow
              label="Owner's Drawings"
              value={`(${money(pos.drawings)})`}
              indent={true}
              subText={subText}
              dark={dark}
            />
            <StmtRow
              label="Retained Earnings"
              value={money(pos.retained)}
              indent={true}
              subText={subText}
              dark={dark}
              tone={pos.retained >= 0 ? "pos" : "neg"}
              note="The net profit figure from the Profit or Loss statement, all time."
            />
            <StmtRow
              label="Opening Balance Equity"
              value={money(pos.openingBalanceEquity)}
              indent={true}
              subText={subText}
              dark={dark}
              note={
                "The stock, cash and balances that already existed before this accounting structure was switched on. Standard practice when a business moves onto a new system mid-year — it keeps the statement balanced without altering a single record you had already entered."
              }
            />
            <StmtRow
              label="Total Equity"
              value={money(pos.totalEquity)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
          </StmtSection>
          <div
            className={`mt-3 pt-3 border-t ${dark ? "border-slate-700" : "border-slate-200"} flex items-center justify-between`}
          >
            <span className="font-bold">Total Liabilities and Equity</span>
            <span className="font-bold text-lg">{money(pos.totalLiabilitiesAndEquity)}</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {pos.balanced ? (
              <CheckCircle2 size={14} className="text-emerald-500" />
            ) : (
              <AlertTriangle size={14} className="text-amber-500" />
            )}
            <span className={`text-xs ${subText}`}>
              {pos.balanced
                ? "Balanced — total assets equal total liabilities and equity."
                : "Out of balance — check the opening balances on your cash accounts."}
            </span>
          </div>
        </div>
      </div>
      <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
        <h3 className="font-semibold mb-2">How to read this</h3>
        <p className={`text-sm ${subText} leading-relaxed`}>
          {
            "When you buy raw materials, your Cash Account goes down and Inventory — Raw Materials goes up by the same amount. Total assets do not change, and profit does not change. Consuming the material later is still only a stock movement, not an expense. The cost reaches the Profit or Loss statement in one place only — as Cost of Goods Sold, once the finished goods are actually sold. That is what makes the net profit figure trustworthy."
          }
        </p>
      </div>
    </div>
  );
}
// Export buttons shared by the statements below.
function ExportButtons({ onExport, dark }) {
  const cls = `text-xs font-medium flex items-center gap-1 ${dark ? "text-blue-400" : "text-blue-600"}`;
  return (
    <div className="flex gap-3">
      <button onClick={() => onExport("csv")} className={cls}>
        <Download size={12} />
        {" CSV"}
      </button>
      <button onClick={() => onExport("pdf")} className={cls}>
        <Printer size={12} />
        {" Print / PDF"}
      </button>
    </div>
  );
}
// Shown in place of a statement when the start date is after the end date.
// (Same look as the other warnings in the app: this app's stylesheet is a fixed
// list of classes, so only classes already in it can be used.)
function BackwardsRange({ cardBg, subText }) {
  return (
    <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium">The start date is after the end date.</p>
          <p className={`text-xs ${subText} mt-1`}>Choose an end date on or after the start date.</p>
        </div>
      </div>
    </div>
  );
}
// "All time (up to today)" or "Mar 1 to Mar 31".
const cashPeriodLabel = (from, to) =>
  !from && !to
    ? "All time (up to today)"
    : `${from ? fmtDate(from) : "the beginning"} to ${to ? fmtDate(to) : fmtDate(todayISO())}`;

export function CashFlowStatement({
  dark,
  cardBg,
  subText,
  setToast,
  ledger,
  cashAccounts,
  settings,
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const cf = useMemo(
    () => computeCashFlow({ ledger, cashAccounts }, from, to),
    [ledger, cashAccounts, from, to],
  );
  const periodLabel = cashPeriodLabel(from, to);
  const backwards = !!from && !!to && from > to;
  const o = cf.operating,
    inv = cf.investing,
    fin = cf.financing,
    rec = cf.reconciliation;
  function doExport(fmt) {
    const headers = ["Statement of Cash Flows — " + periodLabel, "Amount"];
    const rows = cashFlowRows(cf);
    if (fmt === "pdf") {
      exportPDF(`Statement of Cash Flows (${periodLabel})`, headers, rows);
      setToast("Statement opened — use your browser's print dialog to save as PDF.");
    } else {
      downloadCSV("statement_of_cash_flows.csv", [headers, ...rows]);
      setToast("Statement of Cash Flows exported as CSV.");
    }
  }
  const row = (label, value, extra = {}) => (
    <StmtRow
      key={label}
      label={label}
      value={signedMoney(value)}
      indent={!extra.bold}
      subText={subText}
      dark={dark}
      tone={extra.tone}
      {...extra}
    />
  );
  const tone = (v) => (v >= 0 ? "pos" : "neg");
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Statement of Cash Flows</h3>
          <p className={`text-xs ${subText}`}>
            {"Where the cash came from and where it went, for "}
            {periodLabel}
            {" — every movement through your Cash & Bank accounts"}
          </p>
        </div>
        <DateRangeBar
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          dark={dark}
          subText={subText}
          presets={rangePresets()}
        />
      </div>
      {backwards ? (
        <BackwardsRange cardBg={cardBg} subText={subText} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Cash from Operations"
              value={signedMoney(o.net)}
              valueClass={o.net >= 0 ? "text-emerald-600" : "text-red-600"}
              cardBg={cardBg}
              subText={subText}
            />
            <StatCard
              label="Cash from Investing"
              value={signedMoney(inv.net)}
              valueClass={inv.net >= 0 ? "" : "text-red-600"}
              cardBg={cardBg}
              subText={subText}
            />
            <StatCard
              label="Cash from Financing"
              value={signedMoney(fin.net)}
              valueClass={fin.net >= 0 ? "" : "text-red-600"}
              cardBg={cardBg}
              subText={subText}
            />
            <StatCard
              label="Net Change in Cash"
              value={signedMoney(cf.netChange)}
              valueClass={cf.netChange >= 0 ? "text-emerald-600" : "text-red-600"}
              cardBg={cardBg}
              subText={subText}
            />
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-bold text-base">{(settings && settings.businessName) || "Business"}</h3>
                <p className={`text-xs ${subText}`}>
                  {"Statement of Cash Flows — "}
                  {periodLabel}
                </p>
              </div>
              <ExportButtons onExport={doExport} dark={dark} />
            </div>
            <StmtSection title="Cash Flows from Operating Activities" subText={subText}>
              {row("Cash received from customers", o.fromCustomers, {
                note: "Sales paid in cash, bank or card, and money collected against credit invoices.",
              })}
              {row("Other income received", o.otherIncome)}
              {row("Refunds paid to customers", o.refunds, {
                note: "Cash handed back for returned goods.",
              })}
              {row("Paid for stock and raw materials", o.paidForStock)}
              {row("Supplier bills settled", o.supplierBills, {
                note: "Payments against purchases made on credit earlier.",
              })}
              {row("Operating expenses paid", o.expenses)}
              {row("Net Cash from Operating Activities", o.net, { bold: true, top: true, tone: tone(o.net) })}
            </StmtSection>
            <StmtSection title="Cash Flows from Investing Activities" subText={subText}>
              {row("Purchase of property, plant and equipment", inv.fixedAssets)}
              {row("Net Cash used in Investing Activities", inv.net, { bold: true, top: true, tone: tone(inv.net) })}
            </StmtSection>
            <StmtSection title="Cash Flows from Financing Activities" subText={subText}>
              {row("Owner's capital introduced", fin.capitalIntroduced)}
              {row("Owner's drawings", fin.drawings)}
              {row("Loans received", fin.loansReceived)}
              {row("Loans repaid", fin.loansRepaid)}
              {row("Net Cash from Financing Activities", fin.net, { bold: true, top: true, tone: tone(fin.net) })}
            </StmtSection>
            <div className={`mt-4 pt-3 border-t ${dark ? "border-slate-700" : "border-slate-200"}`}>
              {cf.transfers !== 0 &&
                row("Transfers between own accounts (net — should be nil)", cf.transfers, {
                  note: "Moving money between your own accounts nets to nothing. A balance here means one side of a transfer is missing.",
                })}
              {row("Net Increase / (Decrease) in Cash", cf.netChange, { bold: true, tone: tone(cf.netChange) })}
              {row("Cash at the start of the period", cf.openingCash, { indent: false })}
              {row("Cash at the end of the period", cf.closingCash, { bold: true, top: true })}
              {cf.accounts.map((a) => (
                <StmtRow
                  key={a.id}
                  label={a.name}
                  value={signedMoney(a.closing)}
                  indent={true}
                  subText={subText}
                  dark={dark}
                  tone={a.closing < 0 ? "neg" : undefined}
                />
              ))}
              <div className="flex items-center gap-2 mt-3">
                {cf.agrees ? (
                  <CheckCircle2 size={14} className="text-emerald-500" />
                ) : (
                  <AlertTriangle size={14} className="text-amber-500" />
                )}
                <span className={`text-xs ${subText}`}>
                  {cf.agrees
                    ? `Agrees with the Cash & Bank balances (${money(cf.balancesTotal)}).`
                    : `Does not agree with the Cash & Bank balances (${money(cf.balancesTotal)}) — a ledger line is missing a date or sits on an account that no longer exists.`}
                </span>
              </div>
            </div>
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
            <h3 className="font-bold text-base mb-1">Why profit and cash are different</h3>
            <p className={`text-xs ${subText} mb-2`}>
              Net profit counts a sale when it is made and a cost when the stock is sold; cash only counts money
              that actually moved.
            </p>
            <StmtSection title="Net Profit to Cash from Operations" subText={subText}>
              {row("Net profit for the period", rec.netProfit, { tone: tone(rec.netProfit) })}
              {row("Decrease / (increase) in trade receivables", rec.receivables, {
                note: "Sales on credit are profit but not yet cash; money collected from customers is cash that was already counted as profit.",
              })}
              {row("Decrease / (increase) in inventory, net of trade payables", rec.inventoryAndPayables, {
                note: "Stock sold is a cost with no cash going out now; stock bought and supplier bills paid are cash going out that never touched profit.",
              })}
              {row("Net Cash from Operations", rec.netOperating, { bold: true, top: true, tone: tone(rec.netOperating) })}
            </StmtSection>
            <div className="flex items-center gap-2 mt-3">
              {rec.agrees ? (
                <CheckCircle2 size={14} className="text-emerald-500" />
              ) : (
                <AlertTriangle size={14} className="text-amber-500" />
              )}
              <span className={`text-xs ${subText}`}>
                {rec.agrees
                  ? "Agrees with the net cash from operating activities above."
                  : "Does not agree with the net cash from operating activities above."}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function EquityStatement({
  dark,
  cardBg,
  subText,
  hoverRow,
  setToast,
  ledger,
  cashAccounts,
  products,
  rawMaterials,
  salesOrders,
  purchaseOrders,
  deliveryRuns,
  settings,
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const eq = useMemo(
    () =>
      computeEquityChanges(
        { ledger, cashAccounts, products, rawMaterials, salesOrders, purchaseOrders, deliveryRuns, settings },
        from,
        to,
      ),
    [ledger, cashAccounts, products, rawMaterials, salesOrders, purchaseOrders, deliveryRuns, settings, from, to],
  );
  const periodLabel = cashPeriodLabel(from, to);
  const backwards = !!from && !!to && from > to;
  const rows = equityRows(eq);
  function doExport(fmt) {
    const headers = ["Statement of Changes in Equity — " + periodLabel, ...EQUITY_COLUMNS];
    if (fmt === "pdf") {
      exportPDF(`Statement of Changes in Equity (${periodLabel})`, headers, rows);
      setToast("Statement opened — use your browser's print dialog to save as PDF.");
    } else {
      downloadCSV("statement_of_changes_in_equity.csv", [headers, ...rows]);
      setToast("Statement of Changes in Equity exported as CSV.");
    }
  }
  // A blank cell stays blank; a number is shown as money, negatives in brackets.
  const cell = (v) => (v === "" ? "" : signedMoney(v));
  const border = dark ? "border-slate-800" : "border-slate-100";
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Statement of Changes in Equity</h3>
          <p className={`text-xs ${subText}`}>
            {"How the owner's stake in the business moved over "}
            {periodLabel}
          </p>
        </div>
        <DateRangeBar
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          dark={dark}
          subText={subText}
          presets={rangePresets()}
        />
      </div>
      {backwards ? (
        <BackwardsRange cardBg={cardBg} subText={subText} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Opening Equity" value={signedMoney(eq.opening.total)} cardBg={cardBg} subText={subText} />
            <StatCard
              label="Profit for the Period"
              value={signedMoney(eq.profit)}
              valueClass={eq.profit >= 0 ? "text-emerald-600" : "text-red-600"}
              cardBg={cardBg}
              subText={subText}
            />
            <StatCard
              label="Capital less Drawings"
              value={signedMoney(round2(eq.introduced - eq.drawings))}
              valueClass={eq.introduced - eq.drawings >= 0 ? "" : "text-red-600"}
              cardBg={cardBg}
              subText={subText}
            />
            <StatCard
              label="Closing Equity"
              value={signedMoney(eq.closing.total)}
              valueClass="text-emerald-600"
              cardBg={cardBg}
              subText={subText}
            />
          </div>
          <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-base">{(settings && settings.businessName) || "Business"}</h3>
                <p className={`text-xs ${subText}`}>
                  {"Statement of Changes in Equity — "}
                  {periodLabel}
                </p>
              </div>
              <ExportButtons onExport={doExport} dark={dark} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-left ${subText} text-xs border-t ${border}`}>
                    <th className="font-medium py-2 px-2"><span className="sr-only">Actions</span></th>
                    {EQUITY_COLUMNS.map((c) => (
                      <th key={c} className="font-medium py-2 px-2 text-right">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const balance = i === 0 || i === rows.length - 1;
                    return (
                      <tr key={r[0]} className={`border-t ${border} ${hoverRow}`}>
                        <td className={`py-2.5 px-2 ${balance ? "font-semibold" : "pl-5"}`}>{r[0]}</td>
                        {r.slice(1).map((v, j) => (
                          <td
                            key={j}
                            className={`py-2.5 px-2 text-right whitespace-nowrap ${balance || j === 3 ? "font-semibold" : ""}`}
                          >
                            {cell(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2 mt-3">
              {eq.agreesWithPosition === false ? (
                <AlertTriangle size={14} className="text-amber-500" />
              ) : (
                <CheckCircle2 size={14} className="text-emerald-500" />
              )}
              <span className={`text-xs ${subText}`}>
                {eq.agreesWithPosition === null
                  ? "Closing equity is shown as at the end date. Opening balance equity does not move, so it is shown at its current value."
                  : eq.agreesWithPosition
                    ? "Closing equity agrees with Total Equity on the Statement of Financial Position."
                    : "Closing equity does not agree with Total Equity on the Statement of Financial Position."}
              </span>
            </div>
          </div>
          <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
            <h3 className="font-semibold mb-2">How to read this</h3>
            <p className={`text-sm ${subText} leading-relaxed`}>
              {
                "Capital is what the owner has put in (opening capital and capital introduced) less what has been taken out as drawings. Retained earnings is the profit the business has kept. Opening balance equity is the stock, cash and balances that already existed before these books began. When profit is larger than drawings, the owner's stake grows."
              }
            </p>
          </div>
        </>
      )}
    </div>
  );
}
export function Accounting(props) {
  const [tab, setTab] = useState("ledger");
  const { dark, subText } = props;
  const tabs = [
    { key: "ledger", label: "Ledger & Overview" },
    { key: "pnl", label: "Profit or Loss" },
    { key: "position", label: "Statement of Financial Position" },
    { key: "cashflow", label: "Statement of Cash Flows" },
    { key: "equity", label: "Statement of Changes in Equity" },
  ];
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Accounting</h2>
        <p className={`text-sm ${subText}`}>
          Income and expenses flow into the Profit or Loss statement; asset, loan and equity movements flow into
          the Statement of Financial Position; the Statements of Cash Flows and Changes in Equity show how cash
          and the owner&apos;s stake moved.
        </p>
      </div>
      <TabBar tabs={tabs} value={tab} onChange={setTab} dark={dark} />
      {tab === "ledger" && <LedgerBook {...props} />}
      {tab === "pnl" && <ProfitLossStatement {...props} />}
      {tab === "position" && <FinancialPosition {...props} />}
      {tab === "cashflow" && <CashFlowStatement {...props} />}
      {tab === "equity" && <EquityStatement {...props} />}
    </div>
  );
}
