import { useState, useMemo } from "react";
import { AlertTriangle, CheckCircle2, Download, Printer, ShieldCheck } from "@/components/learnex/icons";
import { LedgerBook } from "@/components/learnex/modules/LedgerBook";
import {
  NON_PNL_LABEL,
  computeFinancialPosition,
  computeNonPnL,
  computePnL,
  txnKind,
} from "@/lib/learnex/accounting";
import { downloadCSV, exportPDF, fmtDate, money, rangePresets, round2, todayISO } from "@/lib/learnex/utils";

/* =====================================================================
   FINANCIAL STATEMENTS — a proper Profit or Loss statement followed by
   the Statement of Financial Position, the way an accountant produces
   them: revenue less cost of sales gives gross profit, less operating
   expenses gives net profit, and that net profit is then carried into
   the Statement of Financial Position as retained earnings.
===================================================================== */
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
            className={`text-xs font-medium px-3 py-1.5 rounded-xl border transition-colors ${dark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            {p.label}
          </button>
        ))}
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className={`text-xs px-3 py-1.5 rounded-xl border ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-200"}`}
      />
      <span className={`text-xs ${subText}`}>to</span>
      <input
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
  deliveryRuns,
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
  function statementRows() {
    const r = [];
    r.push(["REVENUE", ""]);
    revCats.forEach((c) => r.push(["   " + c, round2(pnl.revenueByCat[c])]));
    r.push(["Total Revenue", pnl.revenue]);
    r.push(["", ""]);
    r.push(["LESS: COST OF SALES", ""]);
    cogsCats.forEach((c) => r.push(["   " + c, round2(pnl.cogsByCat[c])]));
    r.push(["Total Cost of Sales", pnl.cogs]);
    r.push(["GROSS PROFIT", pnl.grossProfit]);
    r.push(["", ""]);
    r.push(["LESS: OPERATING EXPENSES", ""]);
    opexCats.forEach((c) => r.push(["   " + c, round2(pnl.opexByCat[c])]));
    r.push(["Total Operating Expenses", pnl.totalOpex]);
    r.push(["OPERATING PROFIT", pnl.operatingProfit]);
    if (pnl.otherIncome) {
      r.push(["", ""]);
      r.push(["ADD: OTHER INCOME", ""]);
      othCats.forEach((c) => r.push(["   " + c, round2(pnl.otherIncomeByCat[c])]));
      r.push(["Total Other Income", pnl.otherIncome]);
    }
    r.push(["NET PROFIT FOR THE PERIOD", pnl.netProfit]);
    r.push(["", ""]);
    r.push(["Excluded from profit (asset & equity movements)", ""]);
    r.push(["   Stock & raw material purchases (paid from cash account)", excluded.asset_purchase]);
    r.push(["   Owner's capital introduced", excluded.capital_in]);
    r.push(["   Owner's drawings", excluded.capital_out]);
    r.push(["   Transfers between own accounts", excluded.transfer]);
    r.push(["   Customer receipts against invoices already booked", excluded.ar_collection]);
    r.push(["   Supplier bills settled", excluded.ap_settlement]);
    return r;
  }
  function doExport(fmt) {
    const headers = ["Profit or Loss Statement — " + periodLabel, "Amount"];
    if (fmt === "pdf") {
      exportPDF(`Profit or Loss Statement (${periodLabel})`, headers, statementRows());
      setToast("Statement opened — use your browser's print dialog to save as PDF.");
    } else {
      downloadCSV("profit_or_loss_statement.csv", [headers, ...statementRows()]);
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
            {" \u2014 no date limit is applied unless you set one"}
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
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Revenue</p>
          <p className="text-xl font-bold mt-1">{money(pnl.revenue)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Gross Profit</p>
          <p
            className={`text-xl font-bold mt-1 ${pnl.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {money(pnl.grossProfit)}
          </p>
          <p className={`text-xs ${subText} mt-1`}>{round2(pnl.grossMargin)}% margin</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Operating Expenses</p>
          <p className="text-xl font-bold mt-1 text-red-600">{money(pnl.totalOpex)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Net Profit</p>
          <p className={`text-xl font-bold mt-1 ${pnl.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {money(pnl.netProfit)}
          </p>
        </div>
      </div>
      <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-bold text-base">{(settings && settings.businessName) || "Business"}</h3>
            <p className={`text-xs ${subText}`}>
              {"Profit or Loss Statement \u2014 "}
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
          <StmtRow
            label="Total Revenue"
            value={money(pnl.revenue)}
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
          note={"Cash goes down, inventory goes up by the same amount \u2014 so profit is untouched."}
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
                    <td className={`py-2 px-2 ${subText}`}>{fmtDate(t.date)}</td>
                    <td className="py-2 px-2">{t.desc}</td>
                    <td className={`py-2 px-2 ${subText}`}>{NON_PNL_LABEL[txnKind(t)] || t.category}</td>
                    <td className="py-2 px-2 text-right font-medium">{money(t.amount)}</td>
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
        settings,
      }),
    [ledger, cashAccounts, products, rawMaterials, salesOrders, purchaseOrders, settings],
  );
  function rows() {
    const r = [["ASSETS", ""]];
    pos.cashRows.forEach((c) => r.push(["   " + c.name, c.balance]));
    r.push(["   Total Cash & Bank", pos.cash]);
    r.push(["   Trade Receivables", pos.receivables]);
    r.push(["   Inventory — Finished Goods (at cost)", pos.finishedGoods]);
    r.push(["   Inventory — Raw Materials (at cost)", pos.rawMaterialStock]);
    r.push(["TOTAL ASSETS", pos.totalAssets]);
    r.push(["", ""]);
    r.push(["LIABILITIES", ""]);
    r.push(["   Trade Payables (unpaid purchase orders)", pos.payables]);
    r.push(["Total Liabilities", pos.totalLiabilities]);
    r.push(["", ""]);
    r.push(["EQUITY", ""]);
    r.push(["   Opening Capital", pos.openingCapital]);
    r.push(["   Capital Introduced", pos.capitalIntroduced]);
    r.push(["   Owner's Drawings", -pos.drawings]);
    r.push(["   Retained Earnings (net profit to date)", pos.retained]);
    r.push(["   Opening Balance Equity (pre-system balances)", pos.openingBalanceEquity]);
    r.push(["Total Equity", pos.totalEquity]);
    r.push(["TOTAL LIABILITIES AND EQUITY", pos.totalLiabilitiesAndEquity]);
    return r;
  }
  function doExport(fmt) {
    const headers = [`Statement of Financial Position as at ${fmtDate(pos.asOf)}`, "Amount"];
    if (fmt === "pdf") {
      exportPDF(`Statement of Financial Position as at ${fmtDate(pos.asOf)}`, headers, rows());
      setToast("Statement opened — use your browser's print dialog to save as PDF.");
    } else {
      downloadCSV("statement_of_financial_position.csv", [headers, ...rows()]);
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
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Assets</p>
          <p className="text-xl font-bold mt-1">{money(pos.totalAssets)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Total Liabilities</p>
          <p className="text-xl font-bold mt-1 text-red-600">{money(pos.totalLiabilities)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Net Assets / Equity</p>
          <p className="text-xl font-bold mt-1 text-emerald-600">{money(pos.totalEquity)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
          <p className={`text-xs ${subText}`}>Retained Earnings</p>
          <p className={`text-xl font-bold mt-1 ${pos.retained >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {money(pos.retained)}
          </p>
          <p className={`text-xs ${subText} mt-1`}>{"Net profit from the P&L, all time"}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`rounded-2xl border p-6 ${cardBg} shadow-sm`}>
          <h3 className="font-bold text-base mb-1">Assets</h3>
          <p className={`text-xs ${subText} mb-2`}>Everything the business owns</p>
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
              label={"Inventory \u2014 Finished Goods (at cost)"}
              value={money(pos.finishedGoods)}
              indent={true}
              subText={subText}
              dark={dark}
            />
            <StmtRow
              label={"Inventory \u2014 Raw Materials (at cost)"}
              value={money(pos.rawMaterialStock)}
              indent={true}
              subText={subText}
              dark={dark}
              note={
                "Valued at weighted average cost \u2014 the blended cost of the stock actually on hand. This is where your raw material purchases live, as an asset, until the materials are consumed or sold."
              }
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
          <StmtSection title="Liabilities" subText={subText}>
            <StmtRow
              label="Trade Payables"
              value={money(pos.payables)}
              indent={true}
              subText={subText}
              dark={dark}
              note={
                "Purchase orders recorded as unpaid \u2014 goods received but the supplier has not been paid yet."
              }
            />
            <StmtRow
              label="Total Liabilities"
              value={money(pos.totalLiabilities)}
              bold={true}
              top={true}
              subText={subText}
              dark={dark}
            />
          </StmtSection>
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
                "The stock, cash and balances that already existed before this accounting structure was switched on. Standard practice when a business moves onto a new system mid-year \u2014 it keeps the statement balanced without altering a single record you had already entered."
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
            "When you buy raw materials, your Cash Account goes down and Inventory \u2014 Raw Materials goes up by the same amount. Total assets do not change, and profit does not change. Consuming the material later is still only a stock movement, not an expense. The cost reaches the Profit or Loss statement in one place only \u2014 as Cost of Goods Sold, once the finished goods are actually sold. That is what makes the net profit figure trustworthy."
          }
        </p>
      </div>
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
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Accounting</h1>
        <p className={`text-sm ${subText}`}>
          Income and expenses flow into the Profit or Loss statement; asset and equity movements flow into the
          Statement of Financial Position.
        </p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab === t.key ? "bg-blue-600 text-white" : `border ${dark ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "ledger" && <LedgerBook {...props} />}
      {tab === "pnl" && <ProfitLossStatement {...props} />}
      {tab === "position" && <FinancialPosition {...props} />}
    </div>
  );
}
