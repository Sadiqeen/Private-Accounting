import dayjs from "dayjs";
import buddhistEra from "dayjs/plugin/buddhistEra.js";
import "dayjs/locale/th.js";

dayjs.extend(buddhistEra);
dayjs.locale("th");

export const DEFAULT_SHORTCUTS = [
  { title: "เงินเดือน", type: "income" },
  { title: "ให้น้อง", type: "expense" },
  { title: "ผ่อนรถ", type: "expense" },
  { title: "โทรศัพท์", type: "expense" },
  { title: "เนตบ้าน", type: "expense" },
  { title: "บัตรเครดิต K+", type: "expense" },
  { title: "บัตรเครดิต UCHOOSE", type: "expense" },
  { title: "นาน", type: "expense" },
];

export function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKeyFromDate(date) {
  return date.slice(0, 7);
}

export function formatMoney(amount) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

export function formatThaiDate(date) {
  if (!date) {
    return "-";
  }

  return dayjs(date).format("DD MMMM BBBB");
}

export function formatThaiMonthKey(monthKey) {
  if (!monthKey) {
    return "-";
  }

  return dayjs(`${monthKey}-01`).format("MMMM BBBB");
}

export function parseAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value || "")
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

export function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(date).valueOf());
}

export function reorderItems(items, target) {
  const ordered = [...items]
    .filter((item) => item.id !== target.id)
    .sort((left, right) => {
      if ((left.order || 0) === (right.order || 0)) {
        return left.title.localeCompare(right.title, "th");
      }

      return (left.order || 0) - (right.order || 0);
    });

  const desiredOrder = Number.isFinite(Number(target.order))
    ? Math.max(1, Math.trunc(Number(target.order)))
    : ordered.length + 1;
  const insertIndex = Math.min(desiredOrder - 1, ordered.length);

  ordered.splice(insertIndex, 0, target);

  return ordered.map((item, index) => ({
    ...item,
    order: index + 1,
  }));
}

export function sortByDateDesc(items) {
  return [...items].sort((left, right) => {
    if (left.date === right.date) {
      return (right.createdAt?.seconds || 0) - (left.createdAt?.seconds || 0);
    }

    return left.date < right.date ? 1 : -1;
  });
}

export function sumTransactions(items) {
  return items.reduce(
    (summary, item) => {
      if (item.type === "income") {
        summary.incomeTotal += item.amount;
      } else {
        summary.expenseTotal += item.amount;
      }

      summary.count += 1;
      summary.balance = summary.incomeTotal - summary.expenseTotal;
      return summary;
    },
    { incomeTotal: 0, expenseTotal: 0, balance: 0, count: 0 },
  );
}

export function groupTransactionsByTag(items) {
  const groups = new Map();

  for (const item of items) {
    const tag = item.tag;
    if (!tag) {
      continue;
    }

    const current = groups.get(tag) || { tag, total: 0, count: 0, items: [] };
    const signedAmount = item.type === "income" ? item.amount : -item.amount;

    current.total += signedAmount;
    current.count += 1;
    current.items.push({
      title: item.title,
      type: item.type,
      amount: item.amount,
    });
    groups.set(tag, current);
  }

  return [...groups.values()].sort((left, right) => left.tag.localeCompare(right.tag, "th"));
}

export function groupYearByMonth(items, year) {
  const summary = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return {
      monthKey: `${year}-${month}`,
      incomeTotal: 0,
      expenseTotal: 0,
      balance: 0,
    };
  });

  for (const item of items) {
    const [itemYear, itemMonth] = String(item.monthKey || "").split("-");
    if (itemYear !== String(year)) {
      continue;
    }

    const target = summary[Number(itemMonth) - 1];
    if (!target) {
      continue;
    }

    if (item.type === "income") {
      target.incomeTotal += item.amount;
    } else {
      target.expenseTotal += item.amount;
    }

    target.balance = target.incomeTotal - target.expenseTotal;
  }

  return summary;
}
