// Unit tests for the shared helpers (lib/learnex/utils.js).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCY_SYMBOL,
  setCurrencySymbol,
  round2,
  round6,
  weightedAvgCost,
  money,
  numVal,
  localISO,
  todayISO,
  isInPeriod,
  PERIODS,
  pad2,
  isoFromYMD,
  daysInMonth,
  fmtDate,
  stockStatus,
  nextNumId,
  nextSeqId,
  rangePresets,
} from "@/lib/learnex/utils";

const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("numbers", () => {
  test("UTIL-1 round2 rounds to cents, including the classic float cases", () => {
    assert.equal(round2(0.1 + 0.2), 0.3);
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(-1.005), -1.01);
    assert.equal(round2("12.3"), 12.3);
    assert.equal(round2(2.675), 2.68);
  });

  test("UTIL-2 round2 turns anything that isn't a finite number into 0", () => {
    for (const v of [NaN, Infinity, -Infinity, "abc", undefined]) assert.equal(round2(v), 0, String(v));
    assert.equal(round2(null), 0);
  });

  test("UTIL-3 round6 keeps average costs to six decimals", () => {
    assert.equal(round6(1 / 3), 0.333333);
    assert.equal(round6(1000 / 3), 333.333333);
    assert.equal(round6("x"), 0);
  });

  test("UTIL-4 weighted average cost blends stock on hand with stock arriving", () => {
    assert.equal(weightedAvgCost(10, 100, 10, 200), 150);
    assert.equal(weightedAvgCost(10, 100, 5, 120), 106.666667);
    assert.equal(weightedAvgCost(0, 0, 5, 80), 80, "nothing on hand: the new cost");
    assert.equal(weightedAvgCost(0, 0, 0, 50), 50, "nothing at all: the incoming cost");
    assert.equal(weightedAvgCost("2", "10", "1", "11"), 10.333333, "form values are text");
  });

  test("UTIL-5 numVal reads form input, falling back for blank or invalid values", () => {
    assert.equal(numVal("1250.75"), 1250.75);
    assert.equal(numVal("", 7), 7);
    assert.equal(numVal(null, 7), 7);
    assert.equal(numVal(undefined), 0);
    assert.equal(numVal("abc", 3), 3);
    assert.equal(numVal(0, 5), 0, "zero is a real value, not blank");
  });
});

describe("money", () => {
  after(() => setCurrencySymbol("Rs."));

  test("UTIL-6 whole amounts show no cents, other amounts always two decimals", () => {
    setCurrencySymbol("Rs.");
    assert.equal(money(42500), "Rs. 42,500");
    assert.equal(money(1250.5), "Rs. 1,250.50");
    assert.equal(money(0.1 + 0.2), "Rs. 0.30");
    assert.equal(money(-5.5), "Rs. -5.50");
    assert.equal(money(null), "Rs. 0");
    assert.equal(money(1234567.891), "Rs. 1,234,567.89");
  });

  test("UTIL-7 the currency symbol can be changed (Settings → Currency)", () => {
    setCurrencySymbol("$");
    assert.equal(CURRENCY_SYMBOL, "$");
    assert.equal(money(10), "$ 10");
  });
});

describe("dates and periods", () => {
  test("UTIL-8 today is the local calendar date (not UTC)", () => {
    assert.equal(todayISO(), localDay(new Date()));
  });

  test("UTIL-9 isInPeriod: daily, weekly (last 7 days), monthly, annually and all time", () => {
    const anchor = "2026-10-13";
    assert.equal(isInPeriod("2026-10-13", "daily", anchor), true);
    assert.equal(isInPeriod("2026-10-12", "daily", anchor), false);
    assert.equal(isInPeriod("2026-10-07", "weekly", anchor), true);
    assert.equal(isInPeriod("2026-10-06", "weekly", anchor), false);
    assert.equal(isInPeriod("2026-10-14", "weekly", anchor), false, "future dates are not in this week");
    assert.equal(isInPeriod("2026-10-01", "monthly", anchor), true);
    assert.equal(isInPeriod("2026-09-30", "monthly", anchor), false);
    assert.equal(isInPeriod("2026-01-01", "annually", anchor), true);
    assert.equal(isInPeriod("2025-12-31", "annually", anchor), false);
    assert.equal(isInPeriod("1999-01-01", "all", anchor), true);
    assert.equal(isInPeriod("", "all", anchor), false, "no date: never in a period");
  });

  test("UTIL-10 the period selector offers daily to all time", () => {
    assert.deepEqual(
      PERIODS.map((p) => p.key),
      ["daily", "weekly", "monthly", "annually", "all"],
    );
  });

  test("UTIL-11 calendar helpers", () => {
    assert.equal(pad2(5), "05");
    assert.equal(pad2(12), "12");
    assert.equal(isoFromYMD(2026, 0, 5), "2026-01-05", "months are 0-based");
    assert.equal(daysInMonth(2024, 1), 29);
    assert.equal(daysInMonth(2026, 1), 28);
    assert.equal(daysInMonth(2026, 11), 31);
  });

  test("UTIL-12 fmtDate shows a short date, or a dash when there is none", () => {
    assert.equal(fmtDate("2026-10-13"), "Oct 13");
    assert.equal(fmtDate(""), "—");
    assert.equal(fmtDate(null), "—");
  });

  test("UTIL-13 date range presets: today, last 7 days, this month, this year", () => {
    const t = todayISO();
    const presets = Object.fromEntries(rangePresets().map((p) => [p.label, p]));
    assert.deepEqual(Object.keys(presets), ["Today", "Last 7 days", "This month", "This year"]);
    assert.deepEqual([presets.Today.from, presets.Today.to], [t, t]);
    const weekAgo = new Date(new Date(t + "T00:00:00").getTime() - 6 * 86400000);
    assert.equal(presets["Last 7 days"].from, localDay(weekAgo));
    assert.equal(presets["This month"].from, t.slice(0, 7) + "-01");
    assert.equal(presets["This year"].from, t.slice(0, 4) + "-01-01");
  });

  test("UTIL-17 localISO uses the local calendar day, zero-padded, even just after midnight", () => {
    assert.equal(localISO(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
    assert.equal(localISO(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
  });
});

describe("stock and ids", () => {
  test("UTIL-14 stock status: out of stock, low (at or below the reorder point), in stock", () => {
    assert.deepEqual(stockStatus({ stock: 0, min: 5 }), { label: "Out of Stock", tone: "red" });
    assert.deepEqual(stockStatus({ stock: 2, min: 5 }), { label: "Low Stock", tone: "amber" });
    assert.deepEqual(stockStatus({ stock: 5, min: 5 }), { label: "Low Stock", tone: "amber" });
    assert.deepEqual(stockStatus({ stock: 6, min: 5 }), { label: "In Stock", tone: "green" });
  });

  test("UTIL-15 new record ids are timestamp-based, unique, larger than existing ones and safe integers", () => {
    const a = nextNumId([]);
    assert.ok(Number.isSafeInteger(a));
    assert.ok(a >= Date.now() * 1000 - 5_000_000);
    assert.equal(nextNumId([{ id: 9e15 }]), 9e15 + 1);
    const many = new Set(Array.from({ length: 50 }, () => nextNumId([])));
    assert.ok(many.size > 1);
  });

  test("UTIL-16 reference numbers continue from the highest one (SO-, INV-, PO-, TXN-…)", () => {
    assert.equal(nextSeqId([{ id: "SO-1042" }, { id: "SO-1050" }], "id", "SO-"), "SO-1051");
    assert.equal(nextSeqId([], "id", "SO-"), "SO-1001");
    assert.equal(nextSeqId([], "id", "X-", 0, 4), "X-0001");
    assert.equal(
      nextSeqId([{ invoice: "INV-2461" }, { invoice: "junk" }], "invoice", "INV-", 2461),
      "INV-2462",
    );
    assert.equal(nextSeqId([], "id", "PO-", 4000), "PO-4001");
  });
});
