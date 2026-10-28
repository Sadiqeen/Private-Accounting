// Pure helpers for "clone selected items from another month". No Firebase / dayjs, so it's easy to test.

/** Same day in the target month, clamped to the month's last day (31 Jan -> 28/29 Feb). */
export function moveDateToMonth(date, monthKey) {
  const [ty, tm] = monthKey.split("-").map(Number);
  const day = Number(String(date || "").slice(8, 10)) || 1;
  const lastDay = new Date(ty, tm, 0).getDate();
  return `${monthKey}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Key used to spot an item that already exists in the target month. */
const sameItemKey = (item) => `${item.type}|${String(item.title || "").trim()}|${Number(item.amount || 0)}`;

/**
 * One row per source item, in source order:
 *   { item, nextDate, exists }   exists = target month already has the same type + title + amount
 */
export function buildClonePlan(sourceItems, targetItems, targetMonth) {
  const existing = new Set(targetItems.map(sameItemKey));
  return sourceItems.map((item) => ({
    item,
    nextDate: moveDateToMonth(item.date, targetMonth),
    exists: existing.has(sameItemKey(item)),
  }));
}

/** Default selection: everything that isn't already in the target month. */
export function defaultCloneSelection(plan) {
  return new Set(plan.filter((row) => !row.exists).map((row) => row.item.id));
}

/** Firestore payload for one cloned item (unpaid again, same title/amount/tag/note). */
export function clonePayload(item, targetMonth, userId) {
  return {
    userId,
    type: item.type,
    title: item.title,
    amount: Number(item.amount || 0),
    date: moveDateToMonth(item.date, targetMonth),
    monthKey: targetMonth,
    note: item.note || "",
    tag: item.tag || "",
    paid: false,
    source: "manual",
    clonedFrom: item.id,
  };
}
