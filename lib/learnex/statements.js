import { fmtDate, round2 } from "@/lib/learnex/utils";

/* =====================================================================
   STATEMENT EXPORT ROWS
   ---------------------------------------------------------------------
   The rows of each financial statement as they are written to a CSV file
   or a printable page: [label, amount], or one amount per column for the
   Statement of Changes in Equity. The Accounting screen and the Reports
   screen both use these, so the two always produce the same file.
   Amounts are plain numbers; the CSV/PDF writers round them to the cent.
===================================================================== */
const blank = ["", ""];
// Categories largest first, as the statement shows them.
const byAmount = (map) => Object.keys(map).sort((a, b) => map[b] - map[a]);
const indented = (label, value) => ["   " + label, value];

/** Profit or Loss statement, followed by the movements kept out of profit. */
export function pnlRows(pnl, excluded) {
  const r = [["REVENUE", ""]];
  byAmount(pnl.revenueByCat).forEach((c) => r.push(indented(c, round2(pnl.revenueByCat[c]))));
  if (pnl.salesReturns) r.push(indented("Less: Sales returns", -pnl.salesReturns));
  r.push(["Total Revenue", pnl.netRevenue]);
  r.push(blank);
  r.push(["LESS: COST OF SALES", ""]);
  byAmount(pnl.cogsByCat).forEach((c) => r.push(indented(c, round2(pnl.cogsByCat[c]))));
  r.push(["Total Cost of Sales", pnl.cogs]);
  r.push(["GROSS PROFIT", pnl.grossProfit]);
  r.push(blank);
  r.push(["LESS: OPERATING EXPENSES", ""]);
  byAmount(pnl.opexByCat).forEach((c) => r.push(indented(c, round2(pnl.opexByCat[c]))));
  r.push(["Total Operating Expenses", pnl.totalOpex]);
  r.push(["OPERATING PROFIT", pnl.operatingProfit]);
  if (pnl.otherIncome) {
    r.push(blank);
    r.push(["ADD: OTHER INCOME", ""]);
    byAmount(pnl.otherIncomeByCat).forEach((c) => r.push(indented(c, round2(pnl.otherIncomeByCat[c]))));
    r.push(["Total Other Income", pnl.otherIncome]);
  }
  r.push(["NET PROFIT FOR THE PERIOD", pnl.netProfit]);
  r.push(blank);
  r.push(["Excluded from profit (asset, loan & equity movements)", ""]);
  r.push(indented("Stock & raw material purchases (paid from cash account)", excluded.asset_purchase));
  r.push(indented("Fixed asset purchases", excluded.fixed_asset));
  r.push(indented("Owner's capital introduced", excluded.capital_in));
  r.push(indented("Owner's drawings", excluded.capital_out));
  r.push(indented("Loans received", excluded.loan_in));
  r.push(indented("Loans repaid", excluded.loan_out));
  r.push(indented("Transfers between own accounts", excluded.transfer));
  r.push(indented("Customer receipts against invoices already booked", excluded.ar_collection));
  r.push(indented("Supplier bills settled", excluded.ap_settlement));
  return r;
}

/** Statement of Financial Position (non-current and current, assets and liabilities). */
export function positionRows(pos) {
  const r = [["ASSETS", ""]];
  r.push(["NON-CURRENT ASSETS", ""]);
  r.push(indented("Property, Plant & Equipment (at cost)", pos.ppe));
  r.push(indented("Total Non-current Assets", pos.nonCurrentAssets));
  r.push(["CURRENT ASSETS", ""]);
  pos.cashRows.forEach((c) => r.push(indented(c.name, c.balance)));
  r.push(indented("Total Cash & Bank", pos.cash));
  r.push(indented("Trade Receivables", pos.receivables));
  r.push(indented("Inventory — Finished Goods (at cost)", pos.finishedGoods));
  r.push(indented("Inventory — Raw Materials (at cost)", pos.rawMaterialStock));
  r.push(indented("Inventory — Stock out on Delivery Runs (at cost)", pos.stockOnRuns));
  r.push(indented("Total Current Assets", pos.currentAssets));
  r.push(["TOTAL ASSETS", pos.totalAssets]);
  r.push(blank);
  r.push(["LIABILITIES", ""]);
  r.push(["NON-CURRENT LIABILITIES", ""]);
  r.push(indented("Loans Payable", pos.loans));
  r.push(indented("Total Non-current Liabilities", pos.nonCurrentLiabilities));
  r.push(["CURRENT LIABILITIES", ""]);
  r.push(indented("Trade Payables (unpaid purchase orders)", pos.payables));
  r.push(indented("Total Current Liabilities", pos.currentLiabilities));
  r.push(["Total Liabilities", pos.totalLiabilities]);
  r.push(blank);
  r.push(["EQUITY", ""]);
  r.push(indented("Opening Capital", pos.openingCapital));
  r.push(indented("Capital Introduced", pos.capitalIntroduced));
  r.push(indented("Owner's Drawings", -pos.drawings));
  r.push(indented("Retained Earnings (net profit to date)", pos.retained));
  r.push(indented("Opening Balance Equity (pre-system balances)", pos.openingBalanceEquity));
  r.push(["Total Equity", pos.totalEquity]);
  r.push(["TOTAL LIABILITIES AND EQUITY", pos.totalLiabilitiesAndEquity]);
  return r;
}

/** Statement of Cash Flows: money in is positive, money out negative. */
export function cashFlowRows(cf) {
  const o = cf.operating,
    i = cf.investing,
    f = cf.financing;
  const rec = cf.reconciliation;
  const r = [["CASH FLOWS FROM OPERATING ACTIVITIES", ""]];
  r.push(indented("Cash received from customers", o.fromCustomers));
  r.push(indented("Other income received", o.otherIncome));
  r.push(indented("Refunds paid to customers", o.refunds));
  r.push(indented("Paid for stock and raw materials", o.paidForStock));
  r.push(indented("Supplier bills settled", o.supplierBills));
  r.push(indented("Operating expenses paid", o.expenses));
  r.push(["Net cash from operating activities", o.net]);
  r.push(blank);
  r.push(["CASH FLOWS FROM INVESTING ACTIVITIES", ""]);
  r.push(indented("Purchase of property, plant and equipment", i.fixedAssets));
  r.push(["Net cash used in investing activities", i.net]);
  r.push(blank);
  r.push(["CASH FLOWS FROM FINANCING ACTIVITIES", ""]);
  r.push(indented("Owner's capital introduced", f.capitalIntroduced));
  r.push(indented("Owner's drawings", f.drawings));
  r.push(indented("Loans received", f.loansReceived));
  r.push(indented("Loans repaid", f.loansRepaid));
  r.push(["Net cash from financing activities", f.net]);
  r.push(blank);
  if (cf.transfers) r.push(["Transfers between own accounts (net)", cf.transfers]);
  r.push(["NET INCREASE / (DECREASE) IN CASH", cf.netChange]);
  r.push(["Cash at the start of the period", cf.openingCash]);
  r.push(["CASH AT THE END OF THE PERIOD", cf.closingCash]);
  cf.accounts.forEach((a) => r.push(indented(a.name, a.closing)));
  r.push(blank);
  r.push(["RECONCILIATION OF NET PROFIT TO CASH FROM OPERATIONS", ""]);
  r.push(indented("Net profit for the period", rec.netProfit));
  r.push(indented("Decrease / (increase) in trade receivables", rec.receivables));
  r.push(indented("Decrease / (increase) in inventory, net of trade payables", rec.inventoryAndPayables));
  r.push(["Net cash from operations (reconciled)", rec.netOperating]);
  return r;
}

/** Statement of Changes in Equity: one amount per column of equity. */
export const EQUITY_COLUMNS = ["Capital", "Retained earnings", "Opening balance equity", "Total equity"];
export function equityRows(eq) {
  const o = eq.opening,
    c = eq.closing;
  const when = (iso, fallback) => (iso ? fmtDate(iso) : fallback);
  return [
    [`Balance at the start (${when(eq.from, "beginning")})`, o.capital, o.retained, o.preSystem, o.total],
    ["Profit for the period", "", eq.profit, "", eq.profit],
    ["Capital introduced", eq.introduced, "", "", eq.introduced],
    ["Owner's drawings", -eq.drawings, "", "", -eq.drawings],
    [`Balance at the end (${when(eq.to, "today")})`, c.capital, c.retained, c.preSystem, c.total],
  ];
}
