import { forwardRef, useEffect, useState } from "react";
import DatePicker, { registerLocale } from "react-datepicker";
import th from "date-fns/locale/th";
import "react-datepicker/dist/react-datepicker.css";
import {
  addDoc,
  auth,
  db,
  deleteDoc,
  doc,
  getDocs,
  hasFirebaseConfig,
  normalizeDoc,
  onAuthStateChanged,
  onSnapshot,
  provider,
  query,
  serverTimestamp,
  setDoc,
  shortcutCollection,
  signInWithPopup,
  signOut,
  transactionCollection,
  updateDoc,
  userDoc,
  writeBatch,
} from "./firebase.js";
import {
  DEFAULT_SHORTCUTS,
  formatMoney,
  formatThaiDate,
  formatThaiMonthKey,
  groupTransactionsByTag,
  groupYearByMonth,
  isValidDate,
  monthKeyFromDate,
  parseAmount,
  sortByDateDesc,
  sumTransactions,
  todayString,
} from "./money.js";

registerLocale("th", th);

const PRIVACY_KEY = "privacy-blur-enabled";
const MENU_ITEMS = [
  { id: "dashboard", label: "Dashboard", path: "/" },
  { id: "yearly", label: "สรุปทั้งปี", path: "/yearly" },
  { id: "latest", label: "ล่าสุดทั้งระบบ", path: "/latest" },
  { id: "shortcuts", label: "Shortcuts", path: "/shortcuts" },
];
const TAG_TONES = [
  "bg-cyan-50 text-cyan-700 border-cyan-100",
  "bg-emerald-50 text-emerald-700 border-emerald-100",
  "bg-amber-50 text-amber-700 border-amber-100",
  "bg-rose-50 text-rose-700 border-rose-100",
  "bg-indigo-50 text-indigo-700 border-indigo-100",
  "bg-lime-50 text-lime-700 border-lime-100",
];

function tagTone(tag) {
  const score = [...String(tag)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TAG_TONES[score % TAG_TONES.length];
}

function paidButtonClass(paid, extra = "") {
  const tone = paid
    ? "border border-emerald-600 bg-emerald-600 text-white"
    : "border border-amber-500 bg-amber-400 text-slate-950";
  return `${tone} inline-flex items-center justify-center font-bold ${extra}`;
}

function emptyTransactionForm() {
  return {
    type: "expense",
    title: "",
    amount: "",
    defaultAmountHint: "",
    date: todayString(),
    tag: "",
    paid: false,
    note: "",
  };
}

function emptyShortcutForm() {
  return {
    title: "",
    type: "expense",
    defaultAmount: "",
    active: true,
  };
}

function monthInputToYear(monthKey) {
  return Number(monthKey.slice(0, 4));
}

function dateStringToDate(date) {
  return date ? new Date(`${date}T00:00:00`) : null;
}

function monthKeyToDate(monthKey) {
  return monthKey ? new Date(`${monthKey}-01T00:00:00`) : null;
}

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function shiftMonthKey(monthKey, offset) {
  const base = monthKeyToDate(monthKey);
  if (!base) {
    return monthKey;
  }

  return toMonthKey(new Date(base.getFullYear(), base.getMonth() + offset, 1));
}

function moveDateToMonth(date, monthKey) {
  const source = dateStringToDate(date);
  const target = monthKeyToDate(monthKey);
  if (!source || !target) {
    return `${monthKey}-01`;
  }

  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toDateString(new Date(target.getFullYear(), target.getMonth(), Math.min(source.getDate(), lastDay)));
}

function menuIdFromPath(pathname) {
  const match = MENU_ITEMS.find((item) => item.path === pathname);
  return match?.id || "dashboard";
}

function pathFromMenuId(menuId) {
  return MENU_ITEMS.find((item) => item.id === menuId)?.path || "/";
}

function explainFirebaseError(message) {
  if (String(message).includes("Missing or insufficient permissions")) {
    return "Firestore ยังไม่อนุญาต user นี้ กรุณา deploy rules จากไฟล์ firestore.rules แล้วลองใหม่";
  }

  return message;
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [shortcuts, setShortcuts] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState(todayString().slice(0, 7));
  const [cloneSourceMonth, setCloneSourceMonth] = useState(() => shiftMonthKey(todayString().slice(0, 7), -1));
  const [transactionForm, setTransactionForm] = useState(emptyTransactionForm);
  const [shortcutForm, setShortcutForm] = useState(emptyShortcutForm);
  const [editingTransactionId, setEditingTransactionId] = useState("");
  const [editingShortcutId, setEditingShortcutId] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcutModalOpen, setShortcutModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [cloneSaving, setCloneSaving] = useState(false);
  const [shortcutsReady, setShortcutsReady] = useState(false);
  const [shortcutSeedRequested, setShortcutSeedRequested] = useState(false);
  const [activeMenu, setActiveMenu] = useState(() => menuIdFromPath(window.location.pathname));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [confirmState, setConfirmState] = useState({
    open: false,
    message: "",
    onConfirm: null,
  });
  const [privacyBlur, setPrivacyBlur] = useState(
    () => localStorage.getItem(PRIVACY_KEY) === "true",
  );

  useEffect(() => {
    localStorage.setItem(PRIVACY_KEY, String(privacyBlur));
  }, [privacyBlur]);

  useEffect(() => {
    if (!feedback && !error) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setFeedback("");
      setError("");
    }, 2800);

    return () => window.clearTimeout(timeoutId);
  }, [feedback, error]);

  useEffect(() => {
    const onPopState = () => {
      setActiveMenu(menuIdFromPath(window.location.pathname));
      setMobileMenuOpen(false);
      setMobileControlsOpen(false);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setCloneSourceMonth(shiftMonthKey(selectedMonth, -1));
  }, [selectedMonth]);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return undefined;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (!user) {
      setTransactions([]);
      setShortcuts([]);
      setShortcutsReady(false);
      setShortcutSeedRequested(false);
      return undefined;
    }

    const unsubTransactions = onSnapshot(
      query(transactionCollection(user.uid)),
      (snapshot) => {
        setTransactions(
          sortByDateDesc(
            snapshot.docs.map(normalizeDoc).map((item) => ({
              ...item,
              amount: Number(item.amount || 0),
            })),
          ),
        );
      },
      (snapshotError) => setError(explainFirebaseError(snapshotError.message)),
    );

    const unsubShortcuts = onSnapshot(
      query(shortcutCollection(user.uid)),
      (snapshot) => {
        setShortcutsReady(true);
        setShortcuts(
          snapshot.docs
            .map(normalizeDoc)
            .map((item) => ({
              ...item,
              defaultAmount: Number(item.defaultAmount || 0),
              active: item.active !== false,
            }))
            .sort((left, right) => (left.createdAt?.seconds || 0) - (right.createdAt?.seconds || 0)),
        );
      },
      (snapshotError) => setError(explainFirebaseError(snapshotError.message)),
    );

    return () => {
      unsubTransactions();
      unsubShortcuts();
    };
  }, [user]);

  const monthTransactions = transactions.filter(
    (item) => item.monthKey === selectedMonth,
  );
  const cloneSourceTransactions = transactions.filter(
    (item) => item.monthKey === cloneSourceMonth,
  );
  const orderedMonthTransactions = [...monthTransactions].sort((left, right) => {
    const leftTemplateOrder = left.source === "template"
      ? Number(left.templateOrder || Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    const rightTemplateOrder = right.source === "template"
      ? Number(right.templateOrder || Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;

    if (leftTemplateOrder !== rightTemplateOrder) {
      return leftTemplateOrder - rightTemplateOrder;
    }

    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }

    return (left.createdAt?.seconds || 0) - (right.createdAt?.seconds || 0);
  });
  const pendingExpenses = orderedMonthTransactions.filter(
    (item) => item.type === "expense" && !item.paid,
  );
  const pendingExpenseTotal = pendingExpenses.reduce(
    (total, item) => total + Number(item.amount || 0),
    0,
  );
  const monthSummary = sumTransactions(monthTransactions);
  const tagSummary = groupTransactionsByTag(monthTransactions);
  const yearSummary = groupYearByMonth(transactions, monthInputToYear(selectedMonth));
  const visibleShortcuts = shortcuts.filter((item) => item.active);
  const tagOptions = Array.from(
    new Set(transactions.map((item) => item.tag).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "th"));
  const amountPlaceholder = transactionForm.amount
    ? "จำนวนเงิน"
    : transactionForm.defaultAmountHint || "จำนวนเงิน";

  useEffect(() => {
    async function seedShortcuts() {
      const batch = writeBatch(db);

      DEFAULT_SHORTCUTS.forEach((item) => {
        batch.set(doc(shortcutCollection(user.uid)), {
          userId: user.uid,
          title: item.title,
          type: item.type,
          defaultAmount: Number(item.defaultAmount || 0),
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
    }

    if (!user || !shortcutsReady || shortcuts.length || shortcutSeedRequested) {
      return;
    }

    setShortcutSeedRequested(true);
    seedShortcuts().catch((seedError) => {
      setShortcutSeedRequested(false);
      setError(explainFirebaseError(seedError.message));
    });
  }, [shortcuts, shortcutsReady, shortcutSeedRequested, user]);

  async function handleGoogleLogin() {
    try {
      setError("");
      const result = await signInWithPopup(auth, provider);
      await setDoc(
        userDoc(result.user.uid),
        {
          uid: result.user.uid,
          email: result.user.email || "",
          displayName: result.user.displayName || "",
          createdAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (loginError) {
      setError(explainFirebaseError(loginError.message));
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (logoutError) {
      setError(explainFirebaseError(logoutError.message));
    }
  }

  function updateTransactionForm(field, value) {
    setTransactionForm((current) => ({ ...current, [field]: value }));
  }

  function updateShortcutForm(field, value) {
    setShortcutForm((current) => ({ ...current, [field]: value }));
  }

  function navigateToMenu(menuId) {
    const nextPath = pathFromMenuId(menuId);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setActiveMenu(menuId);
    setMobileMenuOpen(false);
    setMobileControlsOpen(false);
  }

  function applyShortcut(shortcut) {
    setDrawerOpen(true);
    setTransactionForm((current) => ({
      ...current,
      title: shortcut.title,
      type: shortcut.type,
      amount: shortcut.defaultAmount ? String(shortcut.defaultAmount) : "",
      defaultAmountHint: shortcut.defaultAmount ? String(shortcut.defaultAmount) : "",
    }));
  }

  function resetTransactionEditor() {
    setEditingTransactionId("");
    setTransactionForm(emptyTransactionForm());
    setDrawerOpen(false);
  }

  function resetShortcutEditor() {
    setEditingShortcutId("");
    setShortcutForm(emptyShortcutForm());
    setShortcutModalOpen(false);
  }

  function openConfirm(message, onConfirm) {
    setConfirmState({
      open: true,
      message,
      onConfirm,
    });
  }

  function closeConfirm() {
    setConfirmState({
      open: false,
      message: "",
      onConfirm: null,
    });
  }

  async function handleSaveTransaction(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFeedback("");

    try {
      const amount = parseAmount(transactionForm.amount);
      if (!transactionForm.title.trim()) {
        throw new Error("กรุณากรอกชื่อรายการ");
      }
      if (amount <= 0) {
        throw new Error("จำนวนเงินต้องมากกว่า 0");
      }
      if (!["income", "expense"].includes(transactionForm.type)) {
        throw new Error("ประเภทรายการไม่ถูกต้อง");
      }
      if (!isValidDate(transactionForm.date)) {
        throw new Error("วันที่ไม่ถูกต้อง");
      }

      const payload = {
        userId: user.uid,
        type: transactionForm.type,
        title: transactionForm.title.trim(),
        amount,
        date: transactionForm.date,
        monthKey: monthKeyFromDate(transactionForm.date),
        tag: transactionForm.tag.trim(),
        paid: transactionForm.type === "expense" ? Boolean(transactionForm.paid) : false,
        note: transactionForm.note.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingTransactionId) {
        await updateDoc(
          doc(transactionCollection(user.uid), editingTransactionId),
          payload,
        );
        setFeedback("อัปเดตรายการแล้ว");
      } else {
        await addDoc(transactionCollection(user.uid), {
          ...payload,
          source: "manual",
          createdAt: serverTimestamp(),
        });
        setFeedback("บันทึกรายการแล้ว");
      }

      resetTransactionEditor();
    } catch (saveError) {
      setError(explainFirebaseError(saveError.message));
    } finally {
      setSaving(false);
    }
  }

  function handleEditTransaction(item) {
    setEditingTransactionId(item.id);
    setTransactionForm({
      type: item.type,
      title: item.title,
      amount: String(item.amount),
      date: item.date,
      tag: item.tag || "",
      paid: Boolean(item.paid),
      note: item.note || "",
      defaultAmountHint: "",
    });
    setDrawerOpen(true);
  }

  async function handleTogglePaid(item) {
    if (item.type !== "expense") {
      return;
    }

    try {
      await updateDoc(doc(transactionCollection(user.uid), item.id), {
        paid: !Boolean(item.paid),
        updatedAt: serverTimestamp(),
      });
    } catch (saveError) {
      setError(explainFirebaseError(saveError.message));
    }
  }

  async function handleDeleteTransaction(id) {
    openConfirm("ลบรายการนี้ใช่ไหม", async () => {
      try {
        await deleteDoc(doc(transactionCollection(user.uid), id));
        setFeedback("ลบรายการแล้ว");
      } catch (deleteError) {
        setError(explainFirebaseError(deleteError.message));
      } finally {
        closeConfirm();
      }
    });
  }

  async function handleCloneMonth() {
    setCloneSaving(true);
    setError("");
    setFeedback("");

    try {
      if (!cloneSourceTransactions.length) {
        throw new Error(`${formatThaiMonthKey(cloneSourceMonth)} ไม่มีรายการให้ clone`);
      }

      const batch = writeBatch(db);
      for (const item of cloneSourceTransactions) {
        const nextDate = moveDateToMonth(item.date, selectedMonth);
        batch.set(doc(transactionCollection(user.uid)), {
          userId: user.uid,
          type: item.type,
          title: item.title,
          amount: Number(item.amount || 0),
          date: nextDate,
          monthKey: selectedMonth,
          note: item.note || "",
          tag: item.tag || "",
          paid: false,
          source: "manual",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      setFeedback(`clone ${cloneSourceTransactions.length} รายการแล้ว`);
    } catch (cloneError) {
      setError(explainFirebaseError(cloneError.message));
    } finally {
      setCloneSaving(false);
    }
  }

  async function handleSaveShortcut(event) {
    event.preventDefault();
    setShortcutSaving(true);
    setError("");
    setFeedback("");

    try {
      const defaultAmount = parseAmount(shortcutForm.defaultAmount);
      if (!shortcutForm.title.trim()) {
        throw new Error("กรุณากรอกชื่อ shortcut");
      }
      if (defaultAmount <= 0) {
        throw new Error("จำนวนเงิน shortcut ต้องมากกว่า 0");
      }

      const payload = {
        userId: user.uid,
        title: shortcutForm.title.trim(),
        type: shortcutForm.type,
        defaultAmount,
        active: Boolean(shortcutForm.active),
      };

      if (editingShortcutId) {
        await updateDoc(doc(shortcutCollection(user.uid), editingShortcutId), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(shortcutCollection(user.uid)), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setFeedback(editingShortcutId ? "อัปเดต shortcut แล้ว" : "เพิ่ม shortcut แล้ว");
      resetShortcutEditor();
    } catch (saveError) {
      setError(explainFirebaseError(saveError.message));
    } finally {
      setShortcutSaving(false);
    }
  }

  function handleEditShortcut(item) {
    setEditingShortcutId(item.id);
    setShortcutForm({
      title: item.title,
      type: item.type,
      defaultAmount: String(item.defaultAmount),
      active: Boolean(item.active),
    });
    setShortcutModalOpen(true);
  }

  async function handleDeleteShortcut(id) {
    openConfirm("ลบ shortcut นี้ใช่ไหม", async () => {
      try {
        await deleteDoc(doc(shortcutCollection(user.uid), id));
        setFeedback("ลบ shortcut แล้ว");
      } catch (deleteError) {
        setError(explainFirebaseError(deleteError.message));
      } finally {
        closeConfirm();
      }
    });
  }

  if (!hasFirebaseConfig) {
    return (
      <div className="min-h-screen bg-stone-950 px-4 py-10 text-stone-50">
        <div className="mx-auto max-w-xl rounded-3xl border border-amber-300/20 bg-stone-900/90 p-6 shadow-2xl shadow-stone-950/40">
          <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Private Accounting</p>
          <h1 className="mt-3 text-3xl font-semibold">Firebase config ยังไม่ครบ</h1>
          <p className="mt-4 text-sm leading-6 text-stone-300">
            เพิ่มค่า env ตามไฟล์ <code>.env.example</code> แล้วรันใหม่ เพื่อเปิดใช้งาน
            Google login และ Firestore
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return <FullPageMessage title="กำลังโหลด..." body="กำลังเช็กสถานะการล็อกอิน" />;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-950 px-4 py-8 text-stone-50">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center">
          <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[2rem] border border-white/10 bg-white/8 p-6 shadow-2xl shadow-black/30 backdrop-blur lg:p-10">
              <p className="text-sm uppercase tracking-[0.35em] text-amber-300">Private Accounting</p>
              <h1 className="mt-4 text-4xl font-semibold leading-tight lg:text-5xl">
                ระบบรายรับรายจ่ายที่เร็วพอจะใช้แทนชีตเดิมบนมือถือ
              </h1>
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="mt-8 rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200"
              >
                Sign in with Google
              </button>
              {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={privacyBlur ? "privacy-blur min-h-screen" : "min-h-screen"}>
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(9,15,27,0.88)] backdrop-blur">
        <div className="flex w-full flex-col items-start gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-6 xl:px-8">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Private Accounting</p>
            <h1 className="text-sm font-semibold leading-tight text-white sm:text-base">เดือน {formatThaiMonthKey(selectedMonth)}</h1>
          </div>

          <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setMobileControlsOpen(false);
                setMobileMenuOpen((current) => !current);
              }}
              className="win-button px-3 py-1.5 text-xs font-medium lg:hidden"
              aria-label="Open menu"
            >
              เมนู
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setMobileControlsOpen((current) => !current);
              }}
              className="win-button px-3 py-1.5 text-xs font-medium lg:hidden"
              aria-label="Open controls"
            >
              ควบคุม
            </button>
            <button
              type="button"
              onClick={() => setPrivacyBlur((current) => !current)}
              className="hidden px-3 py-1.5 text-xs font-medium lg:inline-block win-button"
            >
              {privacyBlur ? "Show" : "Blur"}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="hidden px-3 py-1.5 text-xs font-medium lg:inline-block win-button-primary"
            >
              Logout
            </button>
          </div>
        </div>
        <div className="hidden w-full overflow-x-auto gap-px border-t border-white/10 bg-slate-950/30 px-4 lg:flex lg:px-6 xl:px-8">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToMenu(item.id)}
              className={
                activeMenu === item.id
                  ? "shrink-0 whitespace-nowrap bg-white px-3 py-2 text-sm font-medium text-slate-900"
                  : "shrink-0 whitespace-nowrap bg-transparent px-3 py-2 text-sm text-slate-300"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <datalist id="transaction-tags">
        {tagOptions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="h-full w-[280px] max-w-[84vw] border-r border-white/10 bg-slate-950 px-4 py-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.25em] text-cyan-200">Menu</p>
                <p className="mt-1 text-sm font-medium text-white">{formatThaiMonthKey(selectedMonth)}</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="win-button px-2.5 py-1 text-xs"
              >
                ปิด
              </button>
            </div>
            <div className="grid gap-1.5">
              {MENU_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateToMenu(item.id)}
                  className={
                    activeMenu === item.id
                      ? "bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-900"
                      : "bg-white/5 px-3 py-2.5 text-left text-sm text-slate-200"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {mobileControlsOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden"
          onClick={() => setMobileControlsOpen(false)}
        >
          <div
            className="ml-auto h-full w-[280px] max-w-[84vw] border-l border-white/10 bg-slate-950 px-4 py-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.25em] text-cyan-200">Controls</p>
                <p className="mt-1 text-sm font-medium text-white">{formatThaiMonthKey(selectedMonth)}</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileControlsOpen(false)}
                className="win-button px-2.5 py-1 text-xs"
              >
                ปิด
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPrivacyBlur((current) => !current)}
                className="win-button px-3 py-2 text-xs font-medium"
              >
                {privacyBlur ? "Show" : "Blur"}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="win-button-primary px-3 py-2 text-xs font-medium"
              >
                Logout
              </button>
            </div>
            {activeMenu === "dashboard" ? (
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="bg-white px-3 py-1.5 text-xs text-slate-900">
                    {monthSummary.count} รายการ
                  </span>
                  <span className="bg-white/10 px-3 py-1.5 text-xs text-slate-200">
                    shortcut {visibleShortcuts.length}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(true);
                      setEditingTransactionId("");
                      setTransactionForm(emptyTransactionForm());
                      setMobileControlsOpen(false);
                    }}
                    className="win-button-primary w-full px-3 py-2 text-sm font-medium"
                  >
                    + เพิ่มรายการ
                  </button>
                </div>
                <div className="mt-4">
                  <p className="mb-2 text-[11px] uppercase tracking-[0.25em] text-cyan-200">Shortcuts</p>
                  <div className="grid grid-cols-2 gap-2">
                    {visibleShortcuts.map((shortcut) => (
                      <button
                        key={shortcut.id || shortcut.title}
                        type="button"
                        onClick={() => {
                          applyShortcut(shortcut);
                          setMobileControlsOpen(false);
                        }}
                        className="win-chip w-full px-3 py-1.5 text-left text-xs"
                      >
                        {shortcut.title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeMenu === "dashboard" ? (
        <main className="w-full px-4 py-4 lg:px-6 xl:px-8">
          <section className="space-y-4">
          <div className="win-panel p-2.5 sm:p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex w-full items-center overflow-hidden border border-slate-300 bg-white sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setSelectedMonth((current) => shiftMonthKey(current, -1))}
                      className="win-button min-w-[40px] border-0 border-r border-slate-300 px-3 py-2 text-sm"
                    >
                      ‹
                    </button>
                    <div className="min-w-0 flex-1 border-r border-slate-300 sm:min-w-[190px]">
                      <DatePicker
                        selected={monthKeyToDate(selectedMonth)}
                        onChange={(date) => {
                          if (date) {
                            setSelectedMonth(toMonthKey(date));
                          }
                        }}
                        locale="th"
                        dateFormat="MMMM yyyy"
                        showMonthYearPicker
                        customInput={
                          <PickerButton
                            className="win-input w-full border-0 px-3 py-2 text-center text-sm font-medium"
                            placeholder="เลือกเดือน"
                          />
                        }
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedMonth((current) => shiftMonthKey(current, 1))}
                      className="win-button min-w-[40px] border-0 px-3 py-2 text-sm"
                    >
                      ›
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(todayString().slice(0, 7))}
                    className="win-button w-full px-3 py-2 text-sm sm:w-auto"
                  >
                    เดือนนี้
                  </button>
                </div>
                <div className="hidden flex-wrap items-center gap-2 lg:flex">
                  <span className="bg-slate-900 px-3 py-1.5 text-xs text-white">
                    {monthSummary.count} รายการ
                  </span>
                  <span className="bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
                    shortcut {visibleShortcuts.length}
                  </span>
                </div>
              </div>

              <div className="hidden grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center">
                <button
                  type="button"
                  onClick={() => {
                    setDrawerOpen(true);
                    setEditingTransactionId("");
                    setTransactionForm(emptyTransactionForm());
                  }}
                  className="win-button-primary w-full px-3 py-2 text-sm font-medium sm:w-auto"
                >
                  + เพิ่มรายการ
                </button>
              </div>
            </div>
            <div className="mt-3 hidden border-t border-slate-200 pt-3 lg:block">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                  Shortcuts
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {visibleShortcuts.map((shortcut) => (
                  <button
                    key={shortcut.id || shortcut.title}
                    type="button"
                    onClick={() => applyShortcut(shortcut)}
                    className="win-chip w-full px-3 py-1.5 text-left text-xs sm:w-auto sm:text-center"
                  >
                    {shortcut.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <SummaryCard label="รายรับ" value={monthSummary.incomeTotal} tone="income" />
            <SummaryCard label="รายจ่าย" value={monthSummary.expenseTotal} tone="expense" />
            <SummaryCard label="คงเหลือ" value={monthSummary.balance} tone="balance" />
          </div>

          <div className={tagSummary.length || pendingExpenses.length ? "grid gap-4 lg:grid-cols-[2fr_1fr] lg:items-start" : ""}>
          <div className="win-panel p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#10324d]">รายการเดือนนี้</h2>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <div className="bg-slate-100 px-2.5 py-1 text-xs text-slate-600">คงเหลือ</div>
                <div className="bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white" data-money>
                  {formatMoney(monthSummary.balance)}
                </div>
              </div>
            </div>

            <div className="mt-3">
              {monthTransactions.length ? (
                <>
                  <div className="hidden lg:block">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs data-table">
                        <thead className="text-left text-slate-500">
                          <tr className="border-b border-slate-200">
                            <th className="pb-2 pr-3 font-medium">#</th>
                            <th className="pb-2 pr-3 text-center font-medium">สถานะ</th>
                            <th className="pb-2 pr-3 font-medium">วันที่</th>
                            <th className="pb-2 pr-3 font-medium">แท็ก</th>
                            <th className="pb-2 pr-3 font-medium">รายการ</th>
                            <th className="pb-2 pr-3 text-right font-medium">รายรับ</th>
                            <th className="pb-2 pr-3 text-right font-medium">รายจ่าย</th>
                            <th className="pb-2 text-right font-medium">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderedMonthTransactions.map((item, index) => (
                            <tr key={item.id} className="border-b border-slate-100 align-middle">
                              <td className="py-2 pr-3 text-slate-500">{index + 1}</td>
                              <td className="py-2 pr-3 text-center">
                                {item.type === "expense" ? (
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePaid(item)}
                                    title={item.paid ? "จ่ายแล้ว" : "รอจ่าย"}
                                    aria-label={item.paid ? "จ่ายแล้ว" : "รอจ่าย"}
                                    className={paidButtonClass(item.paid, "mx-auto h-4 w-4 text-[9px]")}
                                  >
                                    {item.paid ? "✓" : "!"}
                                  </button>
                                ) : "-"}
                              </td>
                              <td className="py-2 pr-3 text-slate-600">{formatThaiDate(item.date)}</td>
                              <td className="py-2 pr-3">
                                {item.tag ? (
                                  <span className={`inline-block max-w-28 break-words border px-2 py-1 text-[11px] ${tagTone(item.tag)}`}>
                                    {item.tag}
                                  </span>
                                ) : "-"}
                              </td>
                              <td className="py-2 pr-3">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium text-slate-900">{item.title}</p>
                                  </div>
                                  {item.note ? (
                                    <span
                                      title={item.note}
                                      className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500"
                                    >
                                      โน้ต
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td data-money className="py-2 pr-3 text-right font-semibold text-cyan-700">
                                {item.type === "income" ? formatMoney(item.amount) : "-"}
                              </td>
                              <td data-money className="py-2 pr-3 text-right font-semibold text-rose-600">
                                {item.type === "expense" ? formatMoney(item.amount) : "-"}
                              </td>
                              <td className="py-2 text-right">
                                <div className="flex justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleEditTransaction(item)}
                                    className="win-button min-w-[52px] px-2.5 py-1 text-[11px]"
                                  >
                                    แก้ไข
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteTransaction(item.id)}
                                    className="win-button-danger min-w-[44px] px-2.5 py-1 text-[11px]"
                                  >
                                    ลบ
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-200 align-middle">
                            <td className="py-3 pr-3" />
                            <td className="py-3 pr-3" />
                            <td className="py-3 pr-3" />
                            <td className="py-3 pr-3" />
                            <td className="py-3 pr-6 text-right font-semibold text-slate-700">รวม</td>
                            <td data-money className="py-3 pr-3 text-right font-semibold text-cyan-700">
                              {formatMoney(monthSummary.incomeTotal)}
                            </td>
                            <td data-money className="py-3 pr-3 text-right font-semibold text-rose-600">
                              {formatMoney(monthSummary.expenseTotal)}
                            </td>
                            <td className="py-3" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <div className="grid gap-2 lg:hidden">
                    {orderedMonthTransactions.map((item, index) => (
                      <article
                        key={item.id}
                        className="overflow-hidden border border-slate-200 bg-white/80 px-3 py-3"
                      >
                        <div className="flex flex-col gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{index + 1}</span>
                              <p className="min-w-0 break-words font-medium text-slate-900">{item.title}</p>
                              {item.tag ? (
                                <span className={`border px-2 py-0.5 text-[10px] ${tagTone(item.tag)}`}>
                                  {item.tag}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-end justify-between gap-3">
                            <p className="text-xs text-slate-500">
                              {formatThaiDate(item.date)} {item.note ? `• ${item.note}` : ""}
                            </p>
                            <p
                              data-money
                              className={
                                item.type === "income"
                                  ? "text-right text-lg font-bold text-cyan-700"
                                  : "text-right text-lg font-bold text-rose-600"
                              }
                            >
                              {item.type === "income" ? "+" : "-"}
                              {formatMoney(item.amount)}
                            </p>
                          </div>
                          {item.type === "expense" ? (
                            <button
                              type="button"
                              onClick={() => handleTogglePaid(item)}
                              title={item.paid ? "จ่ายแล้ว" : "รอจ่าย"}
                              aria-label={item.paid ? "จ่ายแล้ว" : "รอจ่าย"}
                              className={paidButtonClass(item.paid, "h-5 w-5 text-[9px]")}
                            >
                              {item.paid ? "✓" : "!"}
                            </button>
                          ) : null}
                          <div className="flex justify-end gap-1.5 border-t border-slate-200 pt-2">
                            <button
                              type="button"
                              onClick={() => handleEditTransaction(item)}
                              className="win-button px-2.5 py-1 text-[10px] text-slate-500"
                            >
                              แก้ไข
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTransaction(item.id)}
                              className="win-button-danger px-2.5 py-1 text-[10px]"
                            >
                              ลบ
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  title="ยังไม่มีรายการของเดือนนี้"
                >
                  <div className="mx-auto mt-3 max-w-xs">
                    <DatePicker
                      selected={monthKeyToDate(cloneSourceMonth)}
                      onChange={(date) => {
                        if (date) {
                          setCloneSourceMonth(toMonthKey(date));
                        }
                      }}
                      locale="th"
                      dateFormat="MMMM yyyy"
                      showMonthYearPicker
                      customInput={
                        <PickerButton
                          className="win-input w-full px-3 py-2 text-center text-sm font-medium"
                          placeholder="เลือกเดือนที่จะ clone"
                        />
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCloneMonth}
                    disabled={cloneSaving}
                    className="win-button-primary mt-3 px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cloneSaving ? "กำลัง clone..." : `Clone จาก ${formatThaiMonthKey(cloneSourceMonth)}`}
                  </button>
                </EmptyState>
              )}
            </div>
          </div>

          {tagSummary.length || pendingExpenses.length ? (
            <div className="space-y-4">
              {pendingExpenses.length ? (
                <div className="win-panel p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-[#10324d]">รอจ่าย</h2>
                    <span className="bg-amber-400 px-3 py-1 text-xs font-medium text-slate-950">
                      {formatMoney(pendingExpenseTotal)}
                    </span>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-xs data-table">
                      <thead className="text-left text-slate-500">
                        <tr className="border-b border-slate-200">
                          <th className="pb-2 pr-3 font-medium">วันที่</th>
                          <th className="pb-2 pr-3 font-medium">แท็ก</th>
                          <th className="pb-2 pr-3 font-medium">รายการ</th>
                          <th className="pb-2 text-right font-medium">จำนวนเงิน</th>
                          <th className="pb-2 text-right font-medium">อัปเดต</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingExpenses.map((item) => (
                          <tr key={item.id} className="border-b border-slate-100">
                            <td className="py-2 pr-3 text-slate-600">{formatThaiDate(item.date)}</td>
                            <td className="py-2 pr-3">
                              {item.tag ? (
                                <span className={`inline-block max-w-24 break-words border px-2 py-1 text-[11px] ${tagTone(item.tag)}`}>
                                  {item.tag}
                                </span>
                              ) : "-"}
                            </td>
                            <td className="py-2 pr-3 font-medium text-slate-900">{item.title}</td>
                            <td data-money className="py-2 text-right font-semibold text-rose-600">
                              {formatMoney(item.amount)}
                            </td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleTogglePaid(item)}
                                title="เปลี่ยนเป็นจ่ายแล้ว"
                                aria-label="เปลี่ยนเป็นจ่ายแล้ว"
                                className="ml-auto border border-emerald-600 bg-emerald-600 px-2 py-1 text-[10px] font-medium text-white"
                              >
                                จ่ายแล้ว
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {tagSummary.length ? (
                <div className="win-panel p-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-[#10324d]">สรุปตามแท็ก</h2>
                <span className="bg-slate-900 px-3 py-1 text-xs text-white">
                  {tagSummary.length} แท็ก
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs data-table">
                  <thead className="text-left text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="w-32 pb-2 pr-3 font-medium">แท็ก</th>
                      <th className="pb-2 pr-3 font-medium">รายการ</th>
                      <th className="pb-2 text-right font-medium">ยอดรวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tagSummary.map((item) => (
                      <tr key={item.tag} className="border-b border-slate-100">
                        <td className="w-32 py-2 pr-3 align-top">
                          <span className={`inline-block max-w-full break-words border px-2 py-1 text-[11px] ${tagTone(item.tag)}`}>
                            {item.tag}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {item.items.map((tagItem, index) => (
                              <span key={`${tagItem.title}-${index}`} className="bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                                {tagItem.title} {formatMoney(tagItem.amount)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td
                          data-money
                          className={item.total >= 0 ? "py-2 text-right font-semibold text-cyan-700" : "py-2 text-right font-semibold text-rose-600"}
                        >
                          {formatMoney(Math.abs(item.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
              ) : null}
            </div>
          ) : null}
          </div>

          </section>
        </main>
      ) : null}

      {activeMenu === "yearly" ? (
        <main className="w-full px-4 py-4 lg:px-6 xl:px-8">
          <section className="win-panel p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">สรุปทั้งปี</h2>
              </div>
              <span className="bg-slate-900 px-3 py-1 text-xs text-white">
                {yearSummary.length} months
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="pb-2">เดือน</th>
                    <th className="pb-2">รายรับ</th>
                    <th className="pb-2">รายจ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  {yearSummary.map((item) => (
                    <tr key={item.monthKey} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-medium text-slate-800">{formatThaiMonthKey(item.monthKey)}</td>
                      <td className="py-2 pr-4 text-cyan-700" data-money>
                        {formatMoney(item.incomeTotal)}
                      </td>
                      <td className="py-2 pr-4 text-rose-600" data-money>
                        {formatMoney(item.expenseTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      ) : null}

      {activeMenu === "latest" ? (
        <main className="w-full px-4 py-4 lg:px-6 xl:px-8">
          <section className="win-panel p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">ล่าสุดทั้งระบบ</h2>
              </div>
              <span className="bg-slate-900 px-3 py-1 text-xs text-white">{transactions.length} items</span>
            </div>
            <div className="mt-3 grid gap-2">
              {transactions.length ? (
                transactions.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between border border-slate-200 bg-white/80 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {formatThaiDate(item.date)} • {item.type}
                        {item.tag ? ` • ${item.tag}` : ""}
                      </p>
                    </div>
                    <p
                      data-money
                      className={
                        item.type === "income"
                          ? "text-sm font-medium text-cyan-700"
                          : "text-sm font-medium text-rose-600"
                      }
                    >
                      {item.type === "income" ? "+" : "-"}
                      {formatMoney(item.amount)}
                    </p>
                  </div>
                ))
              ) : (
                <EmptyState title="ยังไม่มีรายการ" />
              )}
            </div>
          </section>
        </main>
      ) : null}

      {activeMenu === "shortcuts" ? (
        <main className="w-full px-4 py-4 lg:px-6 xl:px-8">
          <section className="win-panel p-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Shortcuts</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-slate-900 px-3 py-1 text-xs text-white">
                  {shortcuts.length} items
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingShortcutId("");
                    setShortcutForm(emptyShortcutForm());
                    setShortcutModalOpen(true);
                  }}
                  className="win-button-primary px-3 py-1 text-xs font-medium"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              {shortcuts.length ? (
                shortcuts.map((item) => (
                  <article key={item.id} className="overflow-hidden border border-slate-200 bg-white/80 px-3 py-3">
                    <div className="flex flex-col gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900">{item.title}</p>
                          <span className={item.active ? "bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-emerald-700" : "bg-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-600"}>
                            {item.active ? "active" : "inactive"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {item.type}
                        </p>
                      </div>
                      <div className="flex items-end justify-between gap-3 border-t border-slate-200 pt-2">
                        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">จำนวนเงิน</span>
                        <p data-money className="text-right text-lg font-bold text-slate-900">
                          {formatMoney(item.defaultAmount)}
                        </p>
                      </div>
                      <div className="flex justify-end gap-1.5 border-t border-slate-200 pt-2">
                        <button
                          type="button"
                          onClick={() => handleEditShortcut(item)}
                          className="win-button px-2.5 py-1 text-[10px] text-slate-500"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteShortcut(item.id)}
                          className="win-button-danger px-2.5 py-1 text-[10px]"
                        >
                          ลบ
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <EmptyState title="ยังไม่มี shortcut" />
              )}
            </div>
          </section>
        </main>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setDrawerOpen(true);
          setEditingTransactionId("");
          setTransactionForm(emptyTransactionForm());
        }}
        className="win-button-primary fixed right-4 bottom-4 px-4 py-3 text-sm font-semibold lg:hidden"
      >
        + Quick Add
      </button>

      {drawerOpen ? (
        <div className="fixed inset-0 z-30 flex items-end bg-[#083a5d]/55 lg:items-center lg:justify-center">
          <div className="win-panel w-full p-4 lg:max-w-md">
            <div className="mx-auto mb-3 h-1.5 w-14 bg-[#7db9de] lg:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#10324d]">
                {editingTransactionId ? "แก้ไขรายการ" : "Quick Add"}
              </h2>
              <button
                type="button"
                onClick={resetTransactionEditor}
                className="win-button px-3 py-1 text-xs"
              >
                ปิด
              </button>
            </div>
            <form className="mt-3 space-y-2.5" onSubmit={handleSaveTransaction}>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateTransactionForm("type", "expense")}
                  className={
                    transactionForm.type === "expense"
                      ? "border border-[#a92f48] bg-[#e64c66] px-3 py-2.5 text-sm font-medium text-white"
                      : "win-input px-3 py-2.5 text-sm"
                  }
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => updateTransactionForm("type", "income")}
                  className={
                    transactionForm.type === "income"
                      ? "border border-[#007d7c] bg-[#00aba9] px-3 py-2.5 text-sm font-medium text-white"
                      : "win-input px-3 py-2.5 text-sm"
                  }
                >
                  Income
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleShortcuts.map((shortcut) => (
                  <button
                    key={shortcut.id || shortcut.title}
                    type="button"
                    onClick={() => applyShortcut(shortcut)}
                    className="win-chip px-3 py-1 text-xs"
                  >
                    {shortcut.title}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={transactionForm.title}
                onChange={(event) => updateTransactionForm("title", event.target.value)}
                placeholder="ชื่อรายการ"
                className="win-input w-full px-3 py-2.5 text-sm"
              />
              <input
                type="text"
                value={transactionForm.tag}
                onChange={(event) => updateTransactionForm("tag", event.target.value)}
                placeholder="แท็ก"
                list="transaction-tags"
                className="win-input w-full px-3 py-2.5 text-sm"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                pattern="[0-9]*"
                value={transactionForm.amount}
                onChange={(event) => updateTransactionForm("amount", event.target.value)}
                placeholder={amountPlaceholder}
                className="win-input w-full px-3 py-2.5 text-sm"
              />
              <DatePicker
                selected={dateStringToDate(transactionForm.date)}
                onChange={(date) => {
                  if (date) {
                    updateTransactionForm("date", toDateString(date));
                  }
                }}
                locale="th"
                dateFormat="dd MMMM yyyy"
                customInput={
                  <PickerButton
                    className="win-input w-full px-3 py-2.5 text-left text-sm"
                    placeholder="เลือกวันที่"
                  />
                }
              />
              <textarea
                value={transactionForm.note}
                onChange={(event) => updateTransactionForm("note", event.target.value)}
                rows="3"
                placeholder="โน้ตเพิ่มเติม"
                className="win-input w-full px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={saving}
                className="win-button-primary w-full px-4 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {saving ? "กำลังบันทึก..." : editingTransactionId ? "Save Changes" : "Save Transaction"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {shortcutModalOpen ? (
        <div className="fixed inset-0 z-30 flex items-end bg-[#083a5d]/55 lg:items-center lg:justify-center">
          <div className="win-panel w-full p-4 lg:max-w-md">
            <div className="mx-auto mb-3 h-1.5 w-14 bg-[#7db9de] lg:hidden" />
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#10324d]">
                {editingShortcutId ? "แก้ไข shortcut" : "Add shortcut"}
              </h2>
              <button
                type="button"
                onClick={resetShortcutEditor}
                className="win-button px-3 py-1 text-xs"
              >
                ปิด
              </button>
            </div>
            <form className="mt-3 space-y-2.5" onSubmit={handleSaveShortcut}>
              <input
                type="text"
                value={shortcutForm.title}
                onChange={(event) => updateShortcutForm("title", event.target.value)}
                placeholder="ชื่อ shortcut"
                className="win-input w-full px-3 py-2 text-sm"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={shortcutForm.type}
                  onChange={(event) => updateShortcutForm("type", event.target.value)}
                  className="win-input win-select px-3 py-2 text-sm"
                >
                  <option value="expense">expense</option>
                  <option value="income">income</option>
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  pattern="[0-9]*"
                  value={shortcutForm.defaultAmount}
                  onChange={(event) => updateShortcutForm("defaultAmount", event.target.value)}
                  placeholder="จำนวนเงินเริ่มต้น"
                  className="win-input px-3 py-2 text-sm"
                />
              </div>
              <label className="win-input flex items-center gap-2 px-3 py-2 text-sm text-[#10324d]">
                <input
                  type="checkbox"
                  checked={shortcutForm.active}
                  onChange={(event) => updateShortcutForm("active", event.target.checked)}
                />
                active
              </label>
              <button
                type="submit"
                disabled={shortcutSaving}
                className="win-button-primary w-full px-4 py-2.5 text-sm font-medium disabled:opacity-60"
              >
                {shortcutSaving ? "กำลังบันทึก..." : editingShortcutId ? "Save Shortcut" : "Add Shortcut"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {feedback || error ? (
        <div className="pointer-events-none fixed top-4 right-4 z-50">
          <div
            className={
              error
                ? "min-w-[220px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-lg"
                : "min-w-[220px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-lg"
            }
          >
            {error || feedback}
          </div>
        </div>
      ) : null}

      {confirmState.open ? (
        <div className="fixed inset-0 z-40 flex items-end bg-[#083a5d]/55 lg:items-center lg:justify-center">
          <div className="win-panel w-full p-4 lg:max-w-sm">
            <h2 className="text-base font-semibold text-[#10324d]">ยืนยันรายการ</h2>
            <p className="mt-3 text-sm text-slate-700">{confirmState.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeConfirm}
                className="win-button px-4 py-2 text-sm"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => confirmState.onConfirm?.()}
                className="win-button-danger px-4 py-2 text-sm"
              >
                ยืนยัน
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FullPageMessage({ title, body }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f5f9a] p-4">
      <div className="win-panel p-8 text-center">
        <h1 className="text-2xl font-semibold text-[#10324d]">{title}</h1>
        <p className="mt-3 text-sm text-[#4f7590]">{body}</p>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, tone }) {
  const toneClass = {
    income: "win-tile win-tile-income",
    expense: "win-tile win-tile-expense",
    balance: "win-tile win-tile-balance",
  }[tone];

  return (
    <article className={`${toneClass} px-3 py-3`}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/90">{label}</p>
      <p data-money className="mt-1.5 text-lg font-bold sm:text-xl">
        {formatMoney(value)}
      </p>
    </article>
  );
}

function EmptyState({ title, children }) {
  return (
    <div className="border border-dashed border-[#7db9de] bg-[#eef6fb] px-4 py-6 text-center">
      <p className="font-medium text-[#10324d]">{title}</p>
      {children}
    </div>
  );
}

const PickerButton = forwardRef(function PickerButton(
  { value, onClick, className, placeholder },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={className}
    >
      {value || placeholder}
    </button>
  );
});

export default App;
