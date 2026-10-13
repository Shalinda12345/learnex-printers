import { useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CalendarIcon,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  Layers,
  MinusCircle,
  Package,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "@/components/learnex/icons";
import { Badge, MiniCalendar, PeriodSelector, useCountUp } from "@/components/learnex/ui";
import { CATEGORY_COLORS, REVENUE_TREND } from "@/lib/learnex/seed";
import { CURRENCY_SYMBOL, PERIODS, fmtDate, isInPeriod, money, round2, todayISO } from "@/lib/learnex/utils";
import { DonutChart, HBarList, TrendChart } from "@/components/learnex/charts";
import {
  SEED_CASH_ACCOUNTS,
  computeNonPnL,
  computePnL,
  payablesFromPOs,
  receivablesFromOrders,
  totalCash,
} from "@/lib/learnex/accounting";

/* =====================================================================
   DASHBOARD
===================================================================== */
export function KpiCard({
  icon: Icon,
  label,
  value,
  prefix,
  suffix,
  trend,
  trendUp,
  cardBg,
  subText,
  tone = "blue",
}) {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  const toneBg = {
    blue: "bg-blue-50 text-blue-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  return (
    <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-xs font-medium ${subText}`}>{label}</p>
          <p className="text-2xl font-bold mt-1.5 tracking-tight">
            {prefix}
            {animated.toLocaleString(
              "en-US",
              typeof value === "number" && !Number.isInteger(value)
                ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                : {},
            )}
            {suffix}
          </p>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${toneBg}`}>
          <Icon size={18} />
        </div>
      </div>
      {trend && (
        <div className="flex items-center gap-1 mt-3">
          {trendUp ? (
            <ArrowUpRight size={14} className="text-emerald-500" />
          ) : (
            <ArrowDownRight size={14} className="text-red-500" />
          )}
          <span className={`text-xs font-medium ${trendUp ? "text-emerald-500" : "text-red-500"}`}>
            {trend}
          </span>
          <span className={`text-xs ${subText}`}>vs last period</span>
        </div>
      )}
    </div>
  );
}
export function Dashboard({
  dark,
  cardBg,
  subText,
  hoverRow,
  products,
  salesOrders,
  ledger,
  rawMaterials,
  rawMaterialUsage,
  deliveryRuns,
  cashAccounts,
  purchaseOrders,
  settings,
}) {
  const [period, setPeriod] = useState("monthly");
  const anchor = todayISO();
  const periodTag = (PERIODS.find((p) => p.key === period) || {}).tag || "";
  const periodLedger = useMemo(
    () => ledger.filter((t) => isInPeriod(t.date, period, anchor)),
    [ledger, period, anchor],
  );
  const periodSalesOrders = useMemo(
    () => salesOrders.filter((o) => isInPeriod(o.date, period, anchor)),
    [salesOrders, period, anchor],
  );
  const lowStock = products.filter((p) => p.stock > 0 && p.stock <= p.min).length;
  const stockValue = products.reduce((s, p) => s + p.cost * p.stock, 0);
  // Profit comes from the Profit or Loss engine, so buying stock or raw
  // materials no longer eats into it — those are asset purchases that live on
  // the Statement of Financial Position instead.
  const accs = cashAccounts && cashAccounts.length ? cashAccounts : SEED_CASH_ACCOUNTS;
  const pnl = useMemo(() => computePnL(periodLedger, "", ""), [periodLedger]);
  const excludedPeriod = useMemo(() => computeNonPnL(periodLedger, "", ""), [periodLedger]);
  const income = pnl.totalIncome;
  const expenses = round2(pnl.cogs + pnl.totalOpex);
  const profit = pnl.netProfit;
  const cashTotal = useMemo(() => totalCash(ledger, accs), [ledger, accs]);
  const payableTotal = payablesFromPOs(purchaseOrders);
  const receivableTotal = receivablesFromOrders(salesOrders);
  const pendingOrders = periodSalesOrders.filter(
    (o) => o.status === "Processing" || o.status === "Shipped",
  ).length;
  const completedOrders = periodSalesOrders.filter((o) => o.status === "Delivered").length;
  const recentSales = [...periodSalesOrders].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const categorySplit = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.category))];
    return cats.map((name) => ({
      name,
      value: products.filter((p) => p.category === name).reduce((s, p) => s + p.price * p.stock, 0),
    }));
  }, [products]);
  const topProducts = useMemo(() => {
    const qty = {};
    periodSalesOrders.forEach((o) =>
      (o.lineItems || []).forEach((li) => {
        qty[li.name] = (qty[li.name] || 0) + li.qty;
      }),
    );
    const arr = Object.entries(qty).map(([name, sold]) => ({ name, sold }));
    arr.sort((a, b) => b.sold - a.sold);
    return arr.length ? arr.slice(0, 5) : [{ name: "No sales yet", sold: 0 }];
  }, [periodSalesOrders]);
  const anchorDate = new Date(anchor + "T00:00:00");
  const [calYear, setCalYear] = useState(anchorDate.getFullYear());
  const [calMonth, setCalMonth] = useState(anchorDate.getMonth());
  const [rangeStart, setRangeStart] = useState(null);
  const [rangeEnd, setRangeEnd] = useState(null);
  function handleDayClick(iso) {
    if (!rangeStart || rangeEnd) {
      setRangeStart(iso);
      setRangeEnd(null);
    } else if (iso < rangeStart) {
      setRangeEnd(rangeStart);
      setRangeStart(iso);
    } else {
      setRangeEnd(iso);
    }
  }
  function goPrevMonth() {
    setCalMonth((m) => {
      if (m === 0) {
        setCalYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }
  function goNextMonth() {
    setCalMonth((m) => {
      if (m === 11) {
        setCalYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }
  function clearRange() {
    setRangeStart(null);
    setRangeEnd(null);
  }
  const effectiveEnd = rangeEnd || rangeStart;
  const rangeLedger = useMemo(
    () => (rangeStart ? ledger.filter((t) => t.date >= rangeStart && t.date <= effectiveEnd) : []),
    [ledger, rangeStart, effectiveEnd],
  );
  const rangeSalesOrders = useMemo(
    () => (rangeStart ? salesOrders.filter((o) => o.date >= rangeStart && o.date <= effectiveEnd) : []),
    [salesOrders, rangeStart, effectiveEnd],
  );
  const rangePnl = computePnL(rangeLedger, "", "");
  const rangeIncome = rangePnl.totalIncome;
  const rangeExpenses = round2(rangePnl.cogs + rangePnl.totalOpex);
  const rangeProfit = rangePnl.netProfit;
  const rangeLabel = rangeStart
    ? rangeEnd && rangeEnd !== rangeStart
      ? `${fmtDate(rangeStart)} – ${fmtDate(rangeEnd)}`
      : fmtDate(rangeStart)
    : null;
  const rawMaterialsValue = (rawMaterials || []).reduce((s, m) => s + m.costPrice * m.availableQty, 0);
  const rawMaterialStock = (rawMaterials || []).reduce((s, m) => s + m.availableQty, 0);
  const materialsUsedToday = (rawMaterialUsage || [])
    .filter((u) => u.date === anchor)
    .reduce((s, u) => s + u.qtyUsed, 0);
  const completedDeliveryRunsToday = (deliveryRuns || []).filter(
    (r) => r.status === "Completed" && r.completedDate === anchor,
  );
  const deliveryNetProfitToday = completedDeliveryRunsToday.reduce(
    (s, r) => s + (r.netProfit != null ? r.netProfit : r.profit || 0),
    0,
  );
  const totalDailyExpenses = (deliveryRuns || []).reduce((s, r) => s + (r.dailyExpense || 0), 0);
  return (
    <div className="space-y-6">
      <div
        className={`rounded-2xl p-6 bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-lg shadow-blue-900/20`}
      >
        <p className="text-blue-100 text-sm">Welcome back</p>
        <h1 className="text-2xl font-bold mt-1">{"LEARNEX Printers & Distributors \u2014 Overview"}</h1>
        <p className="text-blue-100 text-sm mt-1">
          Here&apos;s how your business is performing, based on everything recorded so far.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Viewing</h3>
          <p className={`text-xs ${subText}`}>
            {
              "Choose the period for income, profit, expenses and order figures below. Choose All Time for figures with no date limit. Profit excludes stock and raw material purchases \u2014 those are paid in cash and held as inventory instead."
            }
          </p>
        </div>
        <PeriodSelector period={period} setPeriod={setPeriod} dark={dark} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <KpiCard
          icon={DollarSign}
          label={`Income (${periodTag})`}
          value={income}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="blue"
        />
        <KpiCard
          icon={TrendingUp}
          label={`Net Profit (${periodTag})`}
          value={profit}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="emerald"
        />
        <KpiCard
          icon={Wallet}
          label={`Expenses (${periodTag})`}
          value={expenses}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="amber"
        />
        <KpiCard
          icon={Boxes}
          label={`Orders (${periodTag})`}
          value={periodSalesOrders.length}
          cardBg={cardBg}
          subText={subText}
          tone="blue"
        />
        <KpiCard
          icon={Clock}
          label={`Pending (${periodTag})`}
          value={pendingOrders}
          cardBg={cardBg}
          subText={subText}
          tone="amber"
        />
        <KpiCard
          icon={CheckCircle2}
          label={`Completed (${periodTag})`}
          value={completedOrders}
          cardBg={cardBg}
          subText={subText}
          tone="emerald"
        />
        <KpiCard
          icon={Package}
          label="Stock Value (Current)"
          value={stockValue}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="slate"
        />
        <KpiCard
          icon={Wallet}
          label={"Cash & Bank (Current)"}
          value={cashTotal}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="emerald"
        />
        <KpiCard
          icon={ClipboardList}
          label={`Purchases (${periodTag}, not an expense)`}
          value={excludedPeriod.asset_purchase}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="slate"
        />
        <KpiCard
          icon={Users}
          label="Receivable (Current)"
          value={receivableTotal}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="amber"
        />
        <KpiCard
          icon={Truck}
          label="Payable (Current)"
          value={payableTotal}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="red"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Low Stock Items (Current)"
          value={lowStock}
          cardBg={cardBg}
          subText={subText}
          tone="amber"
        />
        <KpiCard
          icon={Layers}
          label="Total Raw Materials Value"
          value={rawMaterialsValue}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="blue"
        />
        <KpiCard
          icon={Boxes}
          label="Raw Material Stock"
          value={rawMaterialStock}
          cardBg={cardBg}
          subText={subText}
          tone="slate"
        />
        <KpiCard
          icon={MinusCircle}
          label="Materials Used Today"
          value={materialsUsedToday}
          cardBg={cardBg}
          subText={subText}
          tone="amber"
        />
        <KpiCard
          icon={TrendingUp}
          label="Delivery Net Profit Today"
          value={deliveryNetProfitToday}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone={deliveryNetProfitToday >= 0 ? "emerald" : "red"}
        />
        <KpiCard
          icon={Wallet}
          label="Total Daily Expenses"
          value={totalDailyExpenses}
          prefix={`${CURRENCY_SYMBOL} `}
          cardBg={cardBg}
          subText={subText}
          tone="amber"
        />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`xl:col-span-2 rounded-2xl border p-5 ${cardBg} shadow-sm`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold">Revenue vs Expenses</h3>
              <p className={`text-xs ${subText}`}>Sample weekly trend</p>
            </div>
            <Badge tone="blue">This Week</Badge>
          </div>
          <TrendChart data={REVENUE_TREND} dark={dark} />
        </div>
        <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
          <h3 className="font-semibold mb-1">Stock Value by Category</h3>
          <p className={`text-xs ${subText} mb-2`}>Current inventory worth</p>
          <DonutChart data={categorySplit} colors={CATEGORY_COLORS} dark={dark} />
          <div className="space-y-1.5 mt-2">
            {categorySplit.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: CATEGORY_COLORS[c.name] || "#64748B" }}
                  />
                  <span className={subText}>{c.name}</span>
                </div>
                <span className="font-medium">{money(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`xl:col-span-2 rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
          <div className="flex items-center justify-between p-5 pb-3">
            <h3 className="font-semibold">Recent Sales</h3>
            <Badge tone="slate">{periodTag}</Badge>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr
                className={`text-left ${subText} text-xs border-t ${dark ? "border-slate-800" : "border-slate-100"}`}
              >
                <th className="font-medium py-2 px-5">Invoice</th>
                <th className="font-medium py-2 px-2">Customer</th>
                <th className="font-medium py-2 px-2">Amount</th>
                <th className="font-medium py-2 px-2">Status</th>
                <th className="font-medium py-2 px-5">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentSales.map((s) => (
                <tr
                  key={s.id}
                  className={`border-t ${dark ? "border-slate-800" : "border-slate-100"} ${hoverRow} transition-colors`}
                >
                  <td className="py-3 px-5 font-medium">{s.invoice || s.id}</td>
                  <td className="py-3 px-2">{s.customer}</td>
                  <td className="py-3 px-2 font-medium">{money(s.amount)}</td>
                  <td className="py-3 px-2">
                    <Badge tone={s.payment === "Paid" ? "green" : s.payment === "Pending" ? "amber" : "red"}>
                      {s.payment}
                    </Badge>
                  </td>
                  <td className="py-3 px-5 text-slate-500">{fmtDate(s.date)}</td>
                </tr>
              ))}
              {recentSales.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className={`text-center py-8 text-sm ${subText}`}
                  >{`No sales recorded for ${periodTag.toLowerCase()}.`}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
          <h3 className="font-semibold mb-3">
            {"Top Selling Products "}
            <span className={`text-xs font-normal ${subText}`}>({periodTag})</span>
          </h3>
          <HBarList data={topProducts} dark={dark} />
        </div>
      </div>
      <div className={`rounded-2xl border p-5 ${cardBg} shadow-sm`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CalendarIcon size={16} className={subText} />
            <h3 className="font-semibold">Pick a Date or Range</h3>
          </div>
          {rangeStart && (
            <button
              onClick={clearRange}
              className={`text-xs font-medium px-2.5 py-1.5 rounded-lg ${dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              Clear
            </button>
          )}
        </div>
        <p className={`text-xs ${subText} mb-4`}>
          Click a date to select it, then click a second date to see totals for that range.
        </p>
        <div className="flex flex-col lg:flex-row gap-6">
          <MiniCalendar
            year={calYear}
            month={calMonth}
            onPrev={goPrevMonth}
            onNext={goNextMonth}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onDayClick={handleDayClick}
            dark={dark}
            subText={subText}
          />
          <div className="flex-1">
            {rangeStart ? (
              <div className="space-y-4">
                <div className={`text-sm font-medium ${subText}`}>{rangeLabel}</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <KpiCard
                    icon={DollarSign}
                    label="Income"
                    value={rangeIncome}
                    prefix={`${CURRENCY_SYMBOL} `}
                    cardBg={cardBg}
                    subText={subText}
                    tone="blue"
                  />
                  <KpiCard
                    icon={TrendingUp}
                    label="Net Profit"
                    value={rangeProfit}
                    prefix={`${CURRENCY_SYMBOL} `}
                    cardBg={cardBg}
                    subText={subText}
                    tone="emerald"
                  />
                  <KpiCard
                    icon={Wallet}
                    label="Expenses"
                    value={rangeExpenses}
                    prefix={`${CURRENCY_SYMBOL} `}
                    cardBg={cardBg}
                    subText={subText}
                    tone="amber"
                  />
                  <KpiCard
                    icon={Boxes}
                    label="Orders"
                    value={rangeSalesOrders.length}
                    cardBg={cardBg}
                    subText={subText}
                    tone="blue"
                  />
                  <KpiCard
                    icon={Clock}
                    label="Pending"
                    value={
                      rangeSalesOrders.filter((o) => o.status === "Processing" || o.status === "Shipped")
                        .length
                    }
                    cardBg={cardBg}
                    subText={subText}
                    tone="amber"
                  />
                  <KpiCard
                    icon={CheckCircle2}
                    label="Completed"
                    value={rangeSalesOrders.filter((o) => o.status === "Delivered").length}
                    cardBg={cardBg}
                    subText={subText}
                    tone="emerald"
                  />
                </div>
              </div>
            ) : (
              <div className={`h-full flex items-center justify-center text-sm ${subText} text-center px-6`}>
                Select a date on the calendar to see income, expenses, net profit and orders for that day or
                range.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
