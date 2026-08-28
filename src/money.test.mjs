import test from "node:test";
import assert from "node:assert/strict";
import {
  formatThaiDate,
  formatThaiMonthKey,
  groupTransactionsByTag,
  groupYearByMonth,
  isValidDate,
  monthKeyFromDate,
  parseAmount,
  reorderItems,
  sortByDateDesc,
  sumTransactions,
} from "./money.js";

test("parseAmount handles formatted currency strings", () => {
  assert.equal(parseAmount("31,000.50"), 31000.5);
  assert.equal(parseAmount("THB -1,250.00"), -1250);
  assert.equal(parseAmount(""), 0);
});

test("isValidDate only accepts real YYYY-MM-DD values", () => {
  assert.equal(isValidDate("2026-08-23"), true);
  assert.equal(isValidDate("2026-8-23"), false);
  assert.equal(isValidDate("invalid"), false);
});

test("monthKeyFromDate slices the month key", () => {
  assert.equal(monthKeyFromDate("2026-08-23"), "2026-08");
});

test("formatThaiDate renders Buddhist Era date", () => {
  assert.equal(formatThaiDate("2026-08-23"), "23 สิงหาคม 2569");
});

test("formatThaiMonthKey renders Buddhist Era month", () => {
  assert.equal(formatThaiMonthKey("2026-08"), "สิงหาคม 2569");
});

test("sortByDateDesc sorts by date then createdAt seconds", () => {
  const items = [
    { id: "a", date: "2026-08-23", createdAt: { seconds: 10 } },
    { id: "b", date: "2026-08-23", createdAt: { seconds: 20 } },
    { id: "c", date: "2026-08-24", createdAt: { seconds: 1 } },
  ];

  assert.deepEqual(
    sortByDateDesc(items).map((item) => item.id),
    ["c", "b", "a"],
  );
});

test("sumTransactions aggregates income, expense, balance, and count", () => {
  const summary = sumTransactions([
    { type: "income", amount: 30000 },
    { type: "expense", amount: 5000 },
    { type: "expense", amount: 1200 },
  ]);

  assert.deepEqual(summary, {
    incomeTotal: 30000,
    expenseTotal: 6200,
    balance: 23800,
    count: 3,
  });
});

test("groupTransactionsByTag aggregates tagged and untagged items", () => {
  assert.deepEqual(
    groupTransactionsByTag([
      { title: "ค่าเช่า", tag: "บ้าน", type: "expense", amount: 1000 },
      { title: "คืนเงิน", tag: "บ้าน", type: "income", amount: 300 },
      { title: "จิปาถะ", type: "expense", amount: 50 },
    ]),
    [
      {
        tag: "บ้าน",
        total: -700,
        count: 2,
        items: [
          { title: "ค่าเช่า", type: "expense", amount: 1000 },
          { title: "คืนเงิน", type: "income", amount: 300 },
        ],
      },
    ],
  );
});

test("groupYearByMonth groups only the selected year", () => {
  const summary = groupYearByMonth(
    [
      { monthKey: "2026-01", type: "income", amount: 1000 },
      { monthKey: "2026-01", type: "expense", amount: 250 },
      { monthKey: "2026-02", type: "expense", amount: 400 },
      { monthKey: "2025-12", type: "income", amount: 9999 },
    ],
    2026,
  );

  assert.deepEqual(summary[0], {
    monthKey: "2026-01",
    incomeTotal: 1000,
    expenseTotal: 250,
    balance: 750,
  });
  assert.deepEqual(summary[1], {
    monthKey: "2026-02",
    incomeTotal: 0,
    expenseTotal: 400,
    balance: -400,
  });
  assert.equal(summary[11].monthKey, "2026-12");
});

test("reorderItems appends to the end when order is missing", () => {
  const reordered = reorderItems(
    [
      { id: "a", title: "A", order: 1 },
      { id: "b", title: "B", order: 2 },
    ],
    { id: "c", title: "C" },
  );

  assert.deepEqual(
    reordered.map((item) => [item.id, item.order]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ],
  );
});
