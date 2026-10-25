import test from "node:test";
import assert from "node:assert/strict";
import { buildClonePlan, clonePayload, defaultCloneSelection, moveDateToMonth } from "./clone.js";

test("moveDateToMonth keeps the day and clamps to the month end", () => {
  assert.equal(moveDateToMonth("2026-09-15", "2026-10"), "2026-10-15");
  assert.equal(moveDateToMonth("2026-01-31", "2026-02"), "2026-02-28");
  assert.equal(moveDateToMonth("2028-01-31", "2028-02"), "2028-02-29");
  assert.equal(moveDateToMonth("2026-10-31", "2026-11"), "2026-11-30");
  assert.equal(moveDateToMonth("", "2026-11"), "2026-11-01");
});

const sep = [
  { id: "a", type: "expense", title: "ผ่อนรถ", amount: 8500, date: "2026-09-05", tag: "รถ", note: "", paid: true },
  { id: "b", type: "expense", title: "เนตบ้าน", amount: 599, date: "2026-09-10", paid: true },
  { id: "c", type: "income", title: "เงินเดือน", amount: 30000, date: "2026-09-30" },
];

test("buildClonePlan marks items already in the target month", () => {
  const oct = [{ id: "x", type: "expense", title: "เนตบ้าน", amount: 599, date: "2026-10-10" }];
  const plan = buildClonePlan(sep, oct, "2026-10");
  assert.deepEqual(plan.map((r) => [r.item.id, r.nextDate, r.exists]), [
    ["a", "2026-10-05", false],
    ["b", "2026-10-10", true],
    ["c", "2026-10-30", false],
  ]);
});

test("same title but different amount is not treated as existing", () => {
  const oct = [{ type: "expense", title: "เนตบ้าน", amount: 650 }];
  assert.equal(buildClonePlan(sep, oct, "2026-10")[1].exists, false);
});

test("defaultCloneSelection selects everything not already there", () => {
  const plan = buildClonePlan(sep, [{ type: "expense", title: "ผ่อนรถ", amount: 8500 }], "2026-10");
  assert.deepEqual([...defaultCloneSelection(plan)].sort(), ["b", "c"]);
});

test("clonePayload resets paid and moves the date", () => {
  assert.deepEqual(clonePayload(sep[0], "2026-10", "uid1"), {
    userId: "uid1", type: "expense", title: "ผ่อนรถ", amount: 8500, date: "2026-10-05", monthKey: "2026-10",
    note: "", tag: "รถ", paid: false, source: "manual", clonedFrom: "a",
  });
});
