import { useState, useMemo } from "react";
import {
  BarChart3,
  Boxes,
  DollarSign,
  Download,
  FileText,
  Layers,
  MinusCircle,
  Route,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "@/components/learnex/icons";
import { CATEGORY_COLORS, REVENUE_TREND } from "@/lib/learnex/seed";
import { DonutChart, TrendChart } from "@/components/learnex/charts";
import {
  NON_PNL_LABEL,
  SEED_CASH_ACCOUNTS,
  cashAccountBalance,
  cashAccountOf,
  cashLinesFor,
  computeFinancialPosition,
  computeNonPnL,
  computePnL,
  isPnlTxn,
  payablesFromPOs,
  totalCash,
  txnKind,
} from "@/lib/learnex/accounting";
import { downloadCSV, exportPDF, fmtDate, numVal, round2 } from "@/lib/learnex/utils";

export const REPORT_TYPES = [
  {
    key: "pnl",
    name: "Profit or Loss Statement",
    desc: "Revenue, cost of sales, operating expenses and net profit. Stock and raw material purchases are excluded \u2014 they are asset purchases, not expenses.",
    icon: TrendingUp,
  },
  {
    key: "sfp",
    name: "Statement of Financial Position",
    desc: "Assets, liabilities and equity as at today, with net profit carried in as retained earnings.",
    icon: Layers,
  },
  {
    key: "cash_book",
    name: "Cash Book",
    desc: "Every movement through every cash and bank account, showing how each one is treated.",
    icon: Wallet,
  },
  {
    key: "cash_balances",
    name: "Cash Account Balances",
    desc: "Opening balance, money in, money out and closing balance for each account.",
    icon: DollarSign,
  },
  {
    key: "payables",
    name: "Supplier Payables",
    desc: "Purchase orders recorded as unpaid, with the outstanding balance per supplier.",
    icon: Truck,
  },
  {
    key: "sales_by_product",
    name: "Sales by Product",
    desc: "Units sold and revenue contribution per SKU.",
    icon: BarChart3,
  },
  {
    key: "stock",
    name: "Stock Valuation",
    desc: "Current inventory value at cost and retail price.",
    icon: Boxes,
  },
  {
    key: "customers",
    name: "Customer Statement",
    desc: "Outstanding balances and payment history per customer.",
    icon: Users,
  },
  {
    key: "suppliers",
    name: "Supplier Purchases",
    desc: "Purchase order totals and payment status per supplier.",
    icon: Truck,
  },
  {
    key: "tax",
    name: "Tax Summary",
    desc: "Output tax collected and input tax paid for the period.",
    icon: FileText,
  },
  {
    key: "raw_material_purchases",
    name: "Raw Material Purchases",
    desc: "Every raw material purchase logged, with supplier and cost.",
    icon: Layers,
  },
  {
    key: "raw_material_usage",
    name: "Raw Material Usage",
    desc: "Usage history of raw materials consumed, by date and user.",
    icon: MinusCircle,
  },
  {
    key: "raw_materials_remaining",
    name: "Remaining Raw Materials",
    desc: "Current available quantity and value of each raw material.",
    icon: Boxes,
  },
  {
    key: "delivery_profit",
    name: "Delivery Profit Report",
    desc: "Sales, COGS, daily expense, gross and net profit per delivery run.",
    icon: TrendingUp,
  },
  {
    key: "delivery_item_prices",
    name: "Delivery Item Sales by Price",
    desc: "Every product sold on a delivery run, split by the price it was actually sold at.",
    icon: Route,
  },
  {
    key: "daily_expense",
    name: "Daily Expense Report",
    desc: "Daily expenses recorded during delivery stock closing.",
    icon: Wallet,
  },
];
export function Reports({
  dark,
  cardBg,
  subText,
  hoverRow,
  setToast,
  products,
  customers,
  suppliers,
  ledger,
  salesOrders,
  purchaseOrders,
  rawMaterials,
  rawMaterialUsage,
  deliveryRuns,
  cashAccounts,
  settings,
}) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const inRange = (dateStr) =>
    !dateStr ? false : (!dateFrom || dateStr >= dateFrom) && (!dateTo || dateStr <= dateTo);
  const categorySplit = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.category))];
    return cats.map((name) => ({
      name,
      value: products.filter((p) => p.category === name).reduce((s, p) => s + p.price * p.stock, 0),
    }));
  }, [products]);
  function generate(key, format) {
    let headers = [];
    let rows = [];
    let filename = key;
    let title = key;
    const accs = cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
    if (key === "pnl") {
      // A real Profit or Loss statement: revenue less cost of sales gives
      // gross profit, less operating expenses gives net profit. Stock and
      // raw material purchases are listed separately as excluded items,
      // because they are asset purchases and never expenses.
      const p = computePnL(ledger, dateFrom, dateTo);
      const ex = computeNonPnL(ledger, dateFrom, dateTo);
      headers = ["Profit or Loss Statement", "Amount"];
      rows = [];
      rows.push(["REVENUE", ""]);
      Object.keys(p.revenueByCat).forEach((c) => rows.push(["    " + c, round2(p.revenueByCat[c])]));
      rows.push(["Total Revenue", p.revenue]);
      rows.push(["", ""]);
      rows.push(["LESS: COST OF SALES", ""]);
      Object.keys(p.cogsByCat).forEach((c) => rows.push(["    " + c, round2(p.cogsByCat[c])]));
      rows.push(["Total Cost of Sales", p.cogs]);
      rows.push(["GROSS PROFIT", p.grossProfit]);
      rows.push(["", ""]);
      rows.push(["LESS: OPERATING EXPENSES", ""]);
      Object.keys(p.opexByCat).forEach((c) => rows.push(["    " + c, round2(p.opexByCat[c])]));
      rows.push(["Total Operating Expenses", p.totalOpex]);
      rows.push(["OPERATING PROFIT", p.operatingProfit]);
      if (p.otherIncome) {
        rows.push(["", ""]);
        rows.push(["ADD: OTHER INCOME", ""]);
        Object.keys(p.otherIncomeByCat).forEach((c) =>
          rows.push(["    " + c, round2(p.otherIncomeByCat[c])]),
        );
        rows.push(["Total Other Income", p.otherIncome]);
      }
      rows.push(["NET PROFIT FOR THE PERIOD", p.netProfit]);
      rows.push(["", ""]);
      rows.push(["EXCLUDED FROM PROFIT (asset & equity movements)", ""]);
      rows.push(["    Stock & raw material purchases", ex.asset_purchase]);
      rows.push(["    Owner's capital introduced", ex.capital_in]);
      rows.push(["    Owner's drawings", ex.capital_out]);
      rows.push(["    Transfers between own accounts", ex.transfer]);
      rows.push(["    Customer receipts against invoices already booked", ex.ar_collection]);
      rows.push(["    Supplier bills settled", ex.ap_settlement]);
      filename = "profit_or_loss_statement";
      title = "Profit or Loss Statement";
    } else if (key === "sfp") {
      const pos = computeFinancialPosition({
        ledger,
        cashAccounts: accs,
        products,
        rawMaterials,
        salesOrders,
        purchaseOrders,
        settings,
      });
      headers = [`Statement of Financial Position as at ${fmtDate(pos.asOf)}`, "Amount"];
      rows = [["ASSETS", ""]];
      pos.cashRows.forEach((c) => rows.push(["    " + c.name, c.balance]));
      rows.push(["    Total Cash & Bank", pos.cash]);
      rows.push(["    Trade Receivables", pos.receivables]);
      rows.push(["    Inventory \u2014 Finished Goods (at cost)", pos.finishedGoods]);
      rows.push(["    Inventory \u2014 Raw Materials (at cost)", pos.rawMaterialStock]);
      rows.push(["TOTAL ASSETS", pos.totalAssets]);
      rows.push(["", ""]);
      rows.push(["LIABILITIES", ""]);
      rows.push(["    Trade Payables (unpaid purchase orders)", pos.payables]);
      rows.push(["Total Liabilities", pos.totalLiabilities]);
      rows.push(["", ""]);
      rows.push(["EQUITY", ""]);
      rows.push(["    Opening Capital", pos.openingCapital]);
      rows.push(["    Capital Introduced", pos.capitalIntroduced]);
      rows.push(["    Owner's Drawings", round2(-pos.drawings)]);
      rows.push(["    Retained Earnings (net profit to date)", pos.retained]);
      rows.push(["    Opening Balance Equity (pre-system balances)", pos.openingBalanceEquity]);
      rows.push(["Total Equity", pos.totalEquity]);
      rows.push(["TOTAL LIABILITIES AND EQUITY", pos.totalLiabilitiesAndEquity]);
      filename = "statement_of_financial_position";
      title = "Statement of Financial Position";
    } else if (key === "cash_book") {
      const accNameOf = (id) => {
        const a = accs.find((x) => x.id === id);
        return a ? a.name : id;
      };
      headers = ["Date", "Account", "Description", "Category", "Treatment", "Money In", "Money Out"];
      rows = cashLinesFor(ledger, "All", dateFrom, dateTo).map((t) => [
        fmtDate(t.date),
        accNameOf(cashAccountOf(t)),
        t.desc,
        t.category,
        isPnlTxn(t) ? "Profit or Loss" : NON_PNL_LABEL[txnKind(t)] || "Balance sheet",
        t.type === "Income" ? numVal(t.amount, 0) : "",
        t.type !== "Income" ? numVal(t.amount, 0) : "",
      ]);
      filename = "cash_book";
      title = "Cash Book";
    } else if (key === "cash_balances") {
      headers = ["Account", "Type", "Opening Balance", "Money In", "Money Out", "Closing Balance"];
      rows = accs.map((a) => {
        const lines = cashLinesFor(ledger, a.id, "", dateTo);
        const inn = round2(
          lines.filter((t) => t.type === "Income").reduce((s, t) => s + numVal(t.amount, 0), 0),
        );
        const out = round2(
          lines.filter((t) => t.type !== "Income").reduce((s, t) => s + numVal(t.amount, 0), 0),
        );
        return [
          a.name,
          a.type,
          numVal(a.opening, 0),
          inn,
          out,
          cashAccountBalance(a.id, ledger, accs, dateTo),
        ];
      });
      rows.push(["TOTAL", "", "", "", "", totalCash(ledger, accs, dateTo)]);
      filename = "cash_account_balances";
      title = "Cash Account Balances";
    } else if (key === "payables") {
      headers = ["PO #", "Supplier", "Date", "Total", "Paid", "Outstanding"];
      rows = purchaseOrders
        .filter((o) => o.paymentStatus === "Unpaid")
        .map((o) => [
          o.id,
          o.supplier,
          fmtDate(o.date),
          numVal(o.total, 0),
          numVal(o.amountPaid, 0),
          round2(numVal(o.total, 0) - numVal(o.amountPaid, 0)),
        ]);
      rows.push(["Total Outstanding", "", "", "", "", payablesFromPOs(purchaseOrders)]);
      filename = "supplier_payables";
      title = "Supplier Payables";
    } else if (key === "sales_by_product") {
      const qty = {};
      salesOrders
        .filter((o) => (!dateFrom && !dateTo ? true : inRange(o.date)))
        .forEach((o) =>
          (o.lineItems || []).forEach((li) => {
            if (!qty[li.name]) qty[li.name] = { units: 0, revenue: 0 };
            qty[li.name].units += li.qty;
            qty[li.name].revenue += li.qty * li.price;
          }),
        );
      headers = ["Product", "Units Sold", "Revenue"];
      rows = Object.entries(qty).map(([name, v]) => [name, v.units, v.revenue]);
      filename = "sales_by_product";
      title = "Sales by Product";
    } else if (key === "stock") {
      headers = ["Product", "SKU", "Category", "Cost", "Price", "Stock", "Value at Cost"];
      rows = products.map((p) => [p.name, p.sku, p.category, p.cost, p.price, p.stock, p.cost * p.stock]);
      filename = "stock_valuation";
      title = "Stock Valuation";
    } else if (key === "customers") {
      headers = ["Customer", "Tier", "Orders", "Total Spent", "Outstanding"];
      rows = customers.map((c) => [c.name, c.tier, c.orders, c.spent, c.outstanding]);
      filename = "customer_statement";
      title = "Customer Statement";
    } else if (key === "suppliers") {
      headers = ["Supplier", "Category", "Purchased (YTD)", "Last Order", "Status"];
      rows = suppliers.map((s) => [s.name, s.category, s.purchased, fmtDate(s.lastOrder), s.status]);
      filename = "supplier_purchases";
      title = "Supplier Purchases";
    } else if (key === "tax") {
      const outputTax = salesOrders.reduce((s, o) => s + (o.tax || 0), 0);
      headers = ["Metric", "Amount"];
      rows = [
        ["Output Tax Collected (Sales)", outputTax],
        ["Number of Purchase Orders", purchaseOrders.length],
        ["Total Purchases (Input, incl. tax if applicable)", purchaseOrders.reduce((s, o) => s + o.total, 0)],
      ];
      filename = "tax_summary";
      title = "Tax Summary";
    } else if (key === "raw_material_purchases") {
      headers = ["PO #", "Supplier", "Date", "Material", "Qty", "Unit Cost", "Line Total"];
      purchaseOrders
        .filter((o) => (!dateFrom && !dateTo ? true : inRange(o.date)))
        .forEach((o) =>
          (o.lineItems || []).forEach((li) => {
            rows.push([o.id, o.supplier, fmtDate(o.date), li.name, li.qty, li.cost, li.cost * li.qty]);
          }),
        );
      filename = "raw_material_purchases";
      title = "Raw Material Purchases";
    } else if (key === "raw_material_usage") {
      headers = ["Date", "Material", "Qty Used", "Remaining Qty", "User", "Notes"];
      rows = rawMaterialUsage
        .filter((u) => (!dateFrom && !dateTo ? true : inRange(u.date)))
        .map((u) => [fmtDate(u.date), u.materialName, u.qtyUsed, u.remainingQty, u.user, u.notes || ""]);
      filename = "raw_material_usage";
      title = "Raw Material Usage";
    } else if (key === "raw_materials_remaining") {
      headers = [
        "Material",
        "Category",
        "Supplier",
        "Unit",
        "Available Qty",
        "Avg Cost/Unit",
        "Last Purchase Cost",
        "Stock Value",
      ];
      rows = rawMaterials.map((m) => [
        m.name,
        m.category,
        m.supplier || "",
        m.unit,
        numVal(m.availableQty, 0),
        round2(numVal(m.costPrice, 0)),
        m.lastPurchaseCost === undefined ? "" : round2(m.lastPurchaseCost),
        round2(numVal(m.costPrice, 0) * numVal(m.availableQty, 0)),
      ]);
      filename = "remaining_raw_materials";
      title = "Remaining Raw Materials";
    } else if (key === "delivery_profit") {
      headers = [
        "Run #",
        "Date Closed",
        "Total Sales",
        "COGS",
        "Daily Expense",
        "Gross Profit",
        "Net Profit",
      ];
      rows = deliveryRuns
        .filter((r) => r.status === "Completed" && (!dateFrom && !dateTo ? true : inRange(r.completedDate)))
        .map((r) => [
          r.id,
          fmtDate(r.completedDate),
          r.saleAmount,
          r.costAmount,
          r.dailyExpense || 0,
          r.profit,
          r.netProfit != null ? r.netProfit : r.profit,
        ]);
      filename = "delivery_profit_report";
      title = "Delivery Profit Report";
    } else if (key === "delivery_item_prices") {
      headers = ["Run #", "Date Closed", "Product", "Taken", "Qty Sold", "Unit Price", "Amount", "Remaining"];
      rows = [];
      deliveryRuns
        .filter((r) => r.status === "Completed" && (!dateFrom && !dateTo ? true : inRange(r.completedDate)))
        .forEach((r) => {
          (r.lineItems || []).forEach((li) => {
            const sold = li.sold != null ? li.sold : li.taken - (li.returned || 0);
            if (li.sales && li.sales.length) {
              li.sales.forEach((sale, idx) => {
                rows.push([
                  r.id,
                  fmtDate(r.completedDate),
                  li.name,
                  idx === 0 ? li.taken : "",
                  sale.qty,
                  sale.price,
                  sale.qty * sale.price,
                  idx === 0 ? li.returned || 0 : "",
                ]);
              });
            } else if (sold > 0) {
              rows.push([
                r.id,
                fmtDate(r.completedDate),
                li.name,
                li.taken,
                sold,
                li.price,
                sold * li.price,
                li.returned || 0,
              ]);
            }
          });
        });
      filename = "delivery_item_prices_report";
      title = "Delivery Item Sales by Price";
    } else if (key === "daily_expense") {
      headers = ["Run #", "Date Closed", "Daily Expense"];
      rows = deliveryRuns
        .filter(
          (r) =>
            r.status === "Completed" &&
            (r.dailyExpense || 0) > 0 &&
            (!dateFrom && !dateTo ? true : inRange(r.completedDate)),
        )
        .map((r) => [r.id, fmtDate(r.completedDate), r.dailyExpense]);
      rows.push(["Total", "", rows.reduce((s, r) => s + r[2], 0)]);
      filename = "daily_expense_report";
      title = "Daily Expense Report";
    }
    if (format === "pdf") {
      exportPDF(title, headers, rows);
      setToast("Report opened for PDF export (use your browser's print dialog to save as PDF).");
    } else {
      downloadCSV(`${filename}.csv`, [headers, ...rows]);
      setToast("Report downloaded as CSV — opens directly in Excel.");
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Reports</h1>
          <p className={`text-sm ${subText}`}>
            Generate and export business reports as CSV (Excel-ready) or PDF. Leave the dates blank for
            all-time figures with no limit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`text-xs px-3 py-2 rounded-xl border ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-200"}`}
          />
          <span className={`text-xs ${subText}`}>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={`text-xs px-3 py-2 rounded-xl border ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-200"}`}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
              className={`text-xs font-medium ${dark ? "text-blue-400" : "text-blue-600"}`}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <p className={`text-xs ${subText} -mt-3`}>
        {
          "Date filters apply to reports with a date column (P&L, sales, raw material purchases/usage, delivery and daily expense reports). Daily, weekly, monthly and yearly figures can be produced by setting the range accordingly."
        }
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`xl:col-span-2 rounded-2xl border p-5 ${cardBg} shadow-sm`}>
          <h3 className="font-semibold mb-1">Revenue vs Expenses</h3>
          <p className={`text-xs ${subText} mb-3`}>Sample weekly trend</p>
          <TrendChart data={REVENUE_TREND} dark={dark} />
        </div>
        <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
          <h3 className="font-semibold mb-3">Stock Value by Category</h3>
          <DonutChart data={categorySplit} colors={CATEGORY_COLORS} dark={dark} />
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-3">Standard Reports</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {REPORT_TYPES.map((r) => {
            const Icon = r.icon;
            return (
              <div
                key={r.key}
                className={`text-left rounded-2xl border p-4 ${cardBg} shadow-sm hover:shadow-md transition-all`}
              >
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
                  <Icon size={18} />
                </div>
                <p className="text-sm font-medium">{r.name}</p>
                <p className={`text-xs ${subText} mt-1 leading-relaxed`}>{r.desc}</p>
                <div className="flex items-center gap-3 mt-3">
                  <button
                    onClick={() => generate(r.key, "csv")}
                    className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:underline"
                  >
                    <Download size={12} />
                    {" CSV / Excel"}
                  </button>
                  <button
                    onClick={() => generate(r.key, "pdf")}
                    className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:underline"
                  >
                    <FileText size={12} />
                    {" PDF"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
