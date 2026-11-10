import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Inbox,
  Info,
  Loader,
  Paperclip,
  Search,
  Upload,
  X,
  XCircle,
} from "@/components/learnex/icons";
import { PERIODS, daysInMonth, isSafeAttachmentUrl, isoFromYMD, round2, todayISO } from "@/lib/learnex/utils";
import { getSaveStatus } from "@/lib/learnex/persistence";

/* =====================================================================
   SHARED UI KIT
   Small building blocks every screen uses, so the whole app looks and
   behaves the same. Styling lives in app/globals.css (.btn, .card, ...).
===================================================================== */

export function Spinner({ size = 16, className = "" }) {
  return <Loader size={size} className={`animate-spin ${className}`} />;
}

/** The "Saved / Saving… / Not saved" indicator in the top bar. */
export function SaveStatusBadge() {
  const [{ status, error }, setState] = useState(getSaveStatus);
  useEffect(() => {
    const t = setInterval(() => setState(getSaveStatus()), 800);
    return () => clearInterval(t);
  }, []);
  let label, dot, title, text;
  if (status === "saving") {
    label = "Saving…";
    dot = "bg-amber-500";
    text = "text-amber-600 dark:text-amber-400";
    title = "Saving your latest changes to the database…";
  } else if (status === "denied") {
    label = "Not allowed";
    dot = "bg-red-500";
    text = "text-red-600 dark:text-red-400";
    title =
      (error || "You don't have permission to make that change.") +
      "\n\nReload the page to see what is saved.";
  } else if (status === "error") {
    label = "Not saved";
    dot = "bg-red-500";
    text = "text-red-600 dark:text-red-400";
    title =
      "Couldn't save to the database — retrying automatically. Keep this tab open until it shows Saved." +
      (error ? "\n\n" + error : "");
  } else {
    label = "Saved";
    dot = "bg-emerald-500";
    text = "text-emerald-700 dark:text-emerald-400";
    title = "Everything is saved to the database.";
  }
  return (
    <div
      title={title}
      role="status"
      className="flex items-center gap-1.5 px-1.5 sm:px-2.5 py-1.5 rounded-lg text-xs font-medium border border-transparent select-none whitespace-nowrap"
    >
      {status === "saving" ? (
        <Spinner size={12} className="text-amber-500 shrink-0" />
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      )}
      <span className={text}>{label}</span>
    </div>
  );
}

export function PeriodSelector({ period, setPeriod, dark }) {
  return (
    <div
      className={`inline-flex items-center rounded-xl border p-1 gap-1 ${dark ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-slate-100/70"}`}
    >
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => setPeriod(p.key)}
          aria-pressed={period === p.key}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${period === p.key ? "bg-blue-600 text-white shadow-sm" : `${dark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-white hover:shadow-xs"}`}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function MiniCalendar({
  year,
  month,
  onPrev,
  onNext,
  rangeStart,
  rangeEnd,
  onDayClick,
  dark,
  subText,
}) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const numDays = daysInMonth(year, month);
  const todayIso = todayISO();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);
  const monthLabel = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  const navBtn = `w-7 h-7 rounded-full flex items-center justify-center transition-colors ${dark ? "hover:bg-slate-700 text-slate-300" : "hover:bg-white text-slate-600 hover:shadow-sm"}`;
  return (
    <div
      className={`w-[272px] rounded-2xl border p-4 ${dark ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50"}`}
    >
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={onPrev} aria-label="Previous month" className={navBtn}>
          <ChevronLeft size={15} />
        </button>
        <p className="text-sm font-bold tracking-tight">{monthLabel}</p>
        <button type="button" onClick={onNext} aria-label="Next month" className={navBtn}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className={`grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold mb-2 ${subText}`}>
        {weekdays.map((w, i) => (
          <div key={`wd-${i}`} className="h-5 flex items-center justify-center">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={`pad-${i}`} className="aspect-square" />;
          const iso = isoFromYMD(year, month, d);
          const isEdge = iso === rangeStart || iso === rangeEnd;
          const inRange = rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd;
          const isToday = iso === todayIso;
          const base =
            "aspect-square rounded-xl text-xs font-semibold flex items-center justify-center transition-all";
          const style = isEdge
            ? "bg-blue-600 text-white shadow-md shadow-blue-900/30 scale-105"
            : inRange
              ? dark
                ? "bg-blue-900/40 text-blue-200"
                : "bg-blue-100 text-blue-700"
              : isToday
                ? dark
                  ? "border border-blue-500 text-blue-300"
                  : "border border-blue-400 text-blue-600"
                : dark
                  ? "hover:bg-slate-700 text-slate-300"
                  : "hover:bg-white hover:shadow-sm text-slate-700";
          return (
            <button type="button" key={iso} onClick={() => onDayClick(iso)} className={`${base} ${style}`}>
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* =====================================================================
   SMALL BUILDING BLOCKS
===================================================================== */
export function useCountUp(target, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    let raf;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const raw = target * (1 - Math.pow(1 - progress, 3));
      setVal(Number.isInteger(target) ? Math.round(raw) : round2(raw));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

const BADGE_TONES = {
  green:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25",
  amber:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/25",
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/25",
  violet:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/25",
  slate:
    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600/60",
};
const BADGE_DOTS = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  slate: "bg-slate-400",
};
export function Badge({ tone = "slate", children, dot = false }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${BADGE_TONES[tone] || BADGE_TONES.slate}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${BADGE_DOTS[tone] || BADGE_DOTS.slate}`} />}
      {children}
    </span>
  );
}

// A headline figure: small label, large value, optional note underneath.
export function StatCard({ label, value, valueClass = "", cardBg, subText, children }) {
  return (
    <div className={`rounded-2xl border p-4 ${cardBg} shadow-sm`}>
      <p className={`text-xs font-medium ${subText}`}>{label}</p>
      <p className={`text-xl font-semibold tracking-tight mt-1 tabular-nums ${valueClass}`}>{value}</p>
      {children}
    </div>
  );
}

export function Toggle({ on, onClick, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${on ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

/* ---------------------------------------------------------------- Modal */
// Only the top-most open dialog reacts to Escape / Tab.
const modalStack = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// wide: true for forms; "xl" when a form's line items need room for long product names.
export function Modal({ title, onClose, children, cardBg, dark, wide }) {
  const maxW = wide === "xl" ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-md";
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const token = {};
    modalStack.push(token);
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement;
    // Put the cursor in the first field so people can type straight away.
    const firstField = panel?.querySelector(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    (firstField || panel)?.focus({ preventScroll: true });
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current?.();
      } else if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (previouslyFocused && document.contains(previouslyFocused))
        previouslyFocused.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px] animate-fade-in"
      // Closing needs the press AND the release on the backdrop, so selecting text in a
      // field and letting go outside the dialog doesn't throw the form away.
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${maxW} max-h-[90vh] overflow-y-auto rounded-2xl border ${cardBg} shadow-2xl outline-none animate-pop-in`}
      >
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b sticky top-0 z-10 ${cardBg} ${dark ? "border-slate-800" : "border-slate-100"}`}
        >
          <h3 id={titleId} className="font-semibold text-base">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className={`-mr-1 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${dark ? "hover:bg-slate-800 text-slate-400 hover:text-white" : "hover:bg-slate-100 text-slate-500 hover:text-slate-900"}`}
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** A label above one form control. The label is tied to the control when the child is a plain input. */
export function Field({ label, subText, children, hint, error, required }) {
  const autoId = useId();
  const isControl =
    isValidElement(children) && ["input", "select", "textarea"].includes(children.type);
  const controlId = isControl ? children.props.id || autoId : undefined;
  const describedBy = [hint ? `${autoId}-hint` : "", error ? `${autoId}-error` : ""].filter(Boolean).join(" ");
  const control = isControl
    ? cloneElement(children, {
        id: controlId,
        "aria-invalid": error ? true : children.props["aria-invalid"],
        "aria-describedby": describedBy || children.props["aria-describedby"],
      })
    : children;
  return (
    <div>
      <label
        htmlFor={controlId}
        data-required={(required ?? (isControl && children.props.required)) ? "true" : undefined}
        className={`text-xs font-medium ${subText}`}
      >
        {label}
      </label>
      <div className="mt-1.5">{control}</div>
      {hint && !error && (
        <p id={`${autoId}-hint`} className={`text-xs mt-1 ${subText}`}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${autoId}-error`} role="alert" className="text-xs mt-1 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function FileUpload({ label, value, onChange, dark, subText }) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");
  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4.5 * 1024 * 1024) {
      setError("File is too large — please choose a file under 4.5MB.");
      return;
    }
    setError("");
    const reader = new FileReader();
    reader.onload = () => onChange({ name: file.name, type: file.type, dataUrl: reader.result });
    reader.readAsDataURL(file);
  }
  return (
    <div>
      <label className={`text-xs font-medium ${subText}`}>{label}</label>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed text-xs font-medium transition-colors ${dark ? "border-slate-600 text-slate-300 hover:bg-slate-800 hover:border-slate-500" : "border-slate-300 text-slate-600 hover:bg-slate-50 hover:border-slate-400"}`}
        >
          <Upload size={14} /> {value ? "Replace file" : "Upload slip / receipt"}
        </button>
        {value && (
          <span className={`text-xs ${subText} truncate max-w-[180px] flex items-center gap-1`}>
            <Paperclip size={11} /> {value.name}
          </span>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-red-500 hover:text-red-600 text-xs font-medium hover:underline"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500 mt-1">
          {error}
        </p>
      )}
      <input ref={inputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
    </div>
  );
}

export function AttachmentLink({ attachment, subText }) {
  if (!attachment) return <span className={`text-xs ${subText}`}>{"—"}</span>;
  if (!isSafeAttachmentUrl(attachment.dataUrl))
    return <span className="text-xs text-red-500">Unsafe file (not shown)</span>;
  return (
    <a
      href={attachment.dataUrl}
      download={attachment.name}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      <Eye size={12} />
      {" View slip"}
    </a>
  );
}

export const inputCls = (inputBg) =>
  `mt-0 input-fill px-3 py-2.5 rounded-xl border text-sm outline-none transition-colors ${inputBg}`;

/* =====================================================================
   PAGE-LEVEL PIECES
===================================================================== */

/** Title + one-line description on the left, the screen's main actions on the right. */
export function PageHeader({ title, subtitle, subText, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className={`text-sm mt-0.5 ${subText}`}>{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap shrink-0">{children}</div>}
    </div>
  );
}

/** Search box with the magnifier and a clear button; lights up as one unit when focused. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  inputBg,
  subText,
  className = "w-full sm:w-72",
  autoFocus,
  onKeyDown,
}) {
  return (
    <div className={`field-shell flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${className} ${inputBg}`}>
      <Search size={15} className={`shrink-0 ${subText}`} />
      <input
        type="text"
        aria-label={placeholder || "Search"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        className="bg-transparent outline-none text-sm w-full min-w-0"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${subText} hover:bg-slate-500/15`}
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}

/** What a list shows when there is nothing to list (or nothing matches the filters). */
export function EmptyState({ icon: Icon = Inbox, title, children, action, subText, compact }) {
  return (
    <div className={`flex flex-col items-center text-center mx-auto max-w-sm ${compact ? "py-6" : "py-10"}`}>
      <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
        <Icon size={20} className={subText} />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {children && <p className={`text-sm mt-1 ${subText}`}>{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const ALERT_TONES = {
  info: {
    box: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-500/10 dark:border-blue-500/25 dark:text-blue-100",
    icon: "text-blue-600 dark:text-blue-400",
    Icon: Info,
  },
  success: {
    box: "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/25 dark:text-emerald-100",
    icon: "text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  warning: {
    box: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-100",
    icon: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  error: {
    box: "bg-red-50 border-red-200 text-red-900 dark:bg-red-500/10 dark:border-red-500/25 dark:text-red-100",
    icon: "text-red-600 dark:text-red-400",
    Icon: XCircle,
  },
};
/** A highlighted note: tone = info | success | warning | error. */
export function Alert({ tone = "info", title, children, action, className = "" }) {
  const t = ALERT_TONES[tone] || ALERT_TONES.info;
  const Icon = t.Icon;
  return (
    <div
      role={tone === "error" ? "alert" : "note"}
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${t.box} ${className}`}
    >
      <Icon size={18} className={`shrink-0 mt-0.5 ${t.icon}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}

/**
 * The row of section buttons under a page title (Settings, Accounting ...).
 * Keeps the `flex gap-2` row that the rest of the app (and the tests) address.
 */
export function TabBar({ tabs, value, onChange, dark }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            aria-current={active ? "true" : undefined}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${active ? "bg-blue-600 text-white shadow-sm" : `border ${dark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- Toast */
// Messages are plain strings all over the app; work out the tone from the wording
// unless the caller passes { message, tone }.
const WARNING_RE =
  /^(enter |select |choose |only |nothing |built-in|payment cannot|the invoice window was blocked|not enough|there is no|no )|couldn't|can't|cannot|unable|isn't|aren't|must |already /i;
const ERROR_RE = /\b(failed|error|denied|not allowed|forbidden|went wrong)\b/i;
const INFO_RE = /\bopened\b/i;
export function toastTone(message) {
  const text = typeof message === "string" ? message : "";
  if (ERROR_RE.test(text)) return "error";
  if (WARNING_RE.test(text)) return "warning";
  if (INFO_RE.test(text)) return "info";
  return "success";
}
const TOAST_ICON = {
  success: { Icon: CheckCircle2, cls: "text-emerald-400" },
  info: { Icon: Info, cls: "text-blue-400" },
  warning: { Icon: AlertTriangle, cls: "text-amber-400" },
  error: { Icon: XCircle, cls: "text-red-400" },
};

/** The little message that appears at the bottom-right after an action. */
export function ToastHost({ toast, onClose }) {
  const [paused, setPaused] = useState(false);
  const message = toast && typeof toast === "object" ? toast.message : toast;
  const tone = (toast && typeof toast === "object" && toast.tone) || toastTone(message);
  useEffect(() => {
    if (!message || paused) return;
    const t = setTimeout(onClose, tone === "success" || tone === "info" ? 3500 : 6500);
    return () => clearTimeout(t);
  }, [message, tone, paused, onClose]);
  if (!message) return null;
  const { Icon, cls } = TOAST_ICON[tone] || TOAST_ICON.success;
  return (
    <div className="fixed bottom-6 right-6 left-6 sm:left-auto z-[60] flex justify-end pointer-events-none">
      <div
        role={tone === "error" || tone === "warning" ? "alert" : "status"}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="pointer-events-auto animate-slide-up bg-slate-900 text-white pl-4 pr-3 py-3 rounded-xl shadow-2xl flex items-start gap-3 w-full sm:w-auto sm:max-w-md border border-slate-700/70 ring-1 ring-black/10"
      >
        <Icon size={18} className={`shrink-0 mt-0.5 ${cls}`} />
        <p className="text-sm leading-snug">{message}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss message"
          className="text-slate-400 hover:text-white ml-1 w-6 h-6 -my-0.5 rounded-md flex items-center justify-center shrink-0 hover:bg-white/10"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/** Grey shimmering blocks shown while something loads. */
export function Skeleton({ className = "" }) {
  return <div className={`skeleton ${className}`} />;
}
