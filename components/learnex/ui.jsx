import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Eye, Paperclip, Upload, X } from "@/components/learnex/icons";
import { PERIODS, daysInMonth, isoFromYMD, round2, todayISO } from "@/lib/learnex/utils";
import { getSaveStatus } from "@/lib/learnex/persistence";

export function SaveStatusBadge() {
  const [{ status, error }, setState] = useState(getSaveStatus);
  useEffect(() => {
    const t = setInterval(() => setState(getSaveStatus()), 800);
    return () => clearInterval(t);
  }, []);
  let label, dot, title;
  if (status === "saving") {
    label = "Saving…";
    dot = "bg-amber-500";
    title = "Saving your latest changes to the database…";
  } else if (status === "error") {
    label = "Not saved";
    dot = "bg-red-500";
    title =
      "Couldn't save to the database — retrying automatically. Keep this tab open until it shows Saved." +
      (error ? "\n\n" + error : "");
  } else {
    label = "Saved";
    dot = "bg-emerald-500";
    title = "Everything is saved to the database.";
  }
  return (
    <div
      title={title}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-transparent"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span
        className={
          status === "error" ? "text-red-600" : status === "saving" ? "text-amber-600" : "text-emerald-600"
        }
      >
        {label}
      </span>
    </div>
  );
}
export function PeriodSelector({ period, setPeriod, dark }) {
  return (
    <div
      className={`inline-flex items-center rounded-xl border p-1 gap-1 ${dark ? "border-slate-700 bg-slate-800/60" : "border-slate-200 bg-slate-50"}`}
    >
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => setPeriod(p.key)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p.key ? "bg-blue-600 text-white shadow-sm" : `${dark ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-white"}`}`}
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
  cardBg,
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
  return (
    <div
      className={`w-[272px] rounded-2xl border p-4 ${dark ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50"}`}
    >
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onPrev}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${dark ? "hover:bg-slate-700 text-slate-300" : "hover:bg-white text-slate-600 hover:shadow-sm"}`}
        >
          <ChevronLeft size={15} />
        </button>
        <p className="text-sm font-bold tracking-tight">{monthLabel}</p>
        <button
          onClick={onNext}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${dark ? "hover:bg-slate-700 text-slate-300" : "hover:bg-white text-slate-600 hover:shadow-sm"}`}
        >
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
            <button key={iso} onClick={() => onDayClick(iso)} className={`${base} ${style}`}>
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
export function Badge({ tone, children }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${tones[tone]}`}>{children}</span>
  );
}
export function Toggle({ on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${on ? "bg-blue-600" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}
export function Modal({ title, onClose, children, cardBg, dark, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto rounded-2xl border ${cardBg} shadow-2xl`}
      >
        <div
          className={`flex items-center justify-between px-5 py-4 border-b sticky top-0 ${cardBg} ${dark ? "border-slate-800" : "border-slate-100"}`}
        >
          <h3 className="font-semibold text-sm">{title}</h3>
          <button
            onClick={onClose}
            className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"}`}
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
export function Field({ label, subText, children }) {
  return (
    <div>
      <label className={`text-xs font-medium ${subText}`}>{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
export function FileUpload({ label, value, onChange, dark, subText, inputBg }) {
  const inputRef = useRef(null);
  const [error, setError] = useState("");
  function handleFile(e) {
    var _a;
    const file = (_a = e.target.files) === null || _a === void 0 ? void 0 : _a[0];
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
          onClick={() => {
            var _a;
            return (_a = inputRef.current) === null || _a === void 0 ? void 0 : _a.click();
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${dark ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
        >
          <Upload size={14} /> {value ? "Replace file" : "Upload slip / receipt"}
        </button>
        {value && (
          <span className={`text-xs ${subText} truncate max-w-[180px] flex items-center gap-1`}>
            <Paperclip size={11} /> {value.name}
          </span>
        )}
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-red-500 text-xs font-medium">
            Remove
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <input ref={inputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
    </div>
  );
}
export function AttachmentLink({ attachment, subText }) {
  if (!attachment) return <span className={`text-xs ${subText}`}>{"\u2014"}</span>;
  return (
    <a
      href={attachment.dataUrl}
      download={attachment.name}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      <Eye size={12} />
      {" View slip"}
    </a>
  );
}
export const inputCls = (inputBg) =>
  `mt-0 w-full px-3 py-2.5 rounded-xl border text-sm outline-none ${inputBg}`;
