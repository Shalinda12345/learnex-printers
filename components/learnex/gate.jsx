import { useId, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Eye,
  EyeOff,
  Package,
  Printer,
  ShieldCheck,
  ShoppingCart,
  XCircle,
} from "@/components/learnex/icons";
import { Spinner } from "@/components/learnex/ui";

/* =====================================================================
   The full-screen cards shown before the app opens
   (loading, sign in, first-run setup, import, errors).
   Light, calm, one centred card — with a brand panel beside it on wide screens.
===================================================================== */

const FEATURES = [
  { icon: ShoppingCart, title: "Sell faster", text: "Point of sale, invoices and delivery runs in one place." },
  { icon: Package, title: "Know your stock", text: "Products, raw materials and purchases always add up." },
  { icon: BarChart3, title: "See the whole picture", text: "Cash, profit and financial statements, ready when you are." },
];

function Brand({ light }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-linear-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/40 ring-1 ring-white/10">
        <Printer size={20} className="text-white" />
      </div>
      <div>
        <p className={`font-semibold leading-tight tracking-wide ${light ? "text-slate-900" : "text-white"}`}>LEARNEX ERP</p>
        <p className={`text-xs leading-tight ${light ? "text-slate-500" : "text-slate-400"}`}>Printers &amp; Distributors</p>
      </div>
    </div>
  );
}

export function GateShell({ children, wide }) {
  return (
    <div className="min-h-screen w-full flex bg-slate-50 text-slate-900 font-sans">
      <aside className="hidden lg:flex w-[44%] max-w-[640px] relative overflow-hidden flex-col justify-between p-12 bg-slate-900 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "radial-gradient(60rem 40rem at -10% -10%, rgba(37,99,235,0.35), transparent 60%), radial-gradient(40rem 30rem at 110% 110%, rgba(14,165,233,0.18), transparent 60%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="relative">
          <Brand />
        </div>
        <div className="relative">
          <h2 className="text-3xl font-bold tracking-tight leading-tight text-balance">
            Your whole business,
            <br />
            one calm workspace.
          </h2>
          <ul className="mt-8 space-y-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <li key={f.title} className="flex gap-4">
                  <span className="w-9 h-9 rounded-lg bg-white/10 ring-1 ring-white/10 flex items-center justify-center shrink-0">
                    <Icon size={17} className="text-blue-300" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{f.title}</span>
                    <span className="block text-sm text-slate-400 mt-0.5">{f.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck size={14} />
          Role-based access · every change is recorded
        </p>
      </aside>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="lg:hidden mb-8">
          <Brand light />
        </div>
        <div
          className={`w-full ${wide ? "max-w-lg" : "max-w-md"} bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8 animate-slide-up`}
        >
          {children}
        </div>
        <p className="mt-6 text-xs text-slate-500">LEARNEX Printers &amp; Distributors</p>
      </main>
    </div>
  );
}

export function GateHeading({ children, icon: Icon }) {
  return (
    <div className="mb-1">
      {Icon && (
        <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
          <Icon size={22} />
        </div>
      )}
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">{children}</h1>
    </div>
  );
}

export function GateText({ children, className = "" }) {
  return <p className={`text-sm leading-relaxed text-slate-500 mt-1.5 mb-5 ${className}`}>{children}</p>;
}

export function GateNotice({ children }) {
  return (
    <p
      role="status"
      className="flex gap-2.5 items-start text-sm rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3.5 py-2.5 mb-5"
    >
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function GateError({ children }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="flex gap-2.5 items-start text-sm rounded-xl border border-red-200 bg-red-50 text-red-700 px-3.5 py-2.5 mb-4 whitespace-pre-wrap"
    >
      <XCircle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function GateButton({ variant = "primary", busy, children, className = "", ...props }) {
  const look =
    variant === "secondary" ? "btn-soft" : variant === "ghost" ? "btn-ghost" : "btn-primary";
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`btn btn-lg btn-block ${look} ${className}`}
    >
      {busy && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function GateLink({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className="w-full mt-2 py-2 text-sm text-slate-500 hover:text-slate-900 underline underline-offset-4 decoration-slate-300 hover:decoration-slate-500 rounded-lg"
    >
      {children}
    </button>
  );
}

/** A rough, advisory strength read-out for a new password (the server has the final say). */
function strengthOf(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { label: "Weak", bars: 1, color: "bg-red-500", text: "text-red-600" };
  if (score === 3) return { label: "Okay", bars: 2, color: "bg-amber-500", text: "text-amber-600" };
  if (score === 4) return { label: "Good", bars: 3, color: "bg-emerald-500", text: "text-emerald-600" };
  return { label: "Strong", bars: 4, color: "bg-emerald-600", text: "text-emerald-700" };
}

/**
 * A labelled text field. Password fields get a show/hide button and a caps-lock warning;
 * `meter` adds an advisory strength bar for choosing a new password.
 */
export function GateField({ label, hint, meter, type = "text", ...inputProps }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const isPassword = type === "password";
  const strength = meter ? strengthOf(String(inputProps.value || "")) : null;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          {...inputProps}
          id={id}
          type={isPassword && shown ? "text" : type}
          onKeyUp={(e) => {
            if (isPassword && typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
            inputProps.onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCapsLock(false);
            inputProps.onBlur?.(e);
          }}
          className={`input h-11 ${isPassword ? "pr-11" : ""}`}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide characters" : "Show characters"}
            aria-pressed={shown}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {isPassword && capsLock && <p className="text-xs mt-1.5 text-amber-600">Caps Lock is on.</p>}
      {strength && (
        <div className="mt-2 flex items-center gap-2" aria-live="polite">
          <div className="flex gap-1 flex-1">
            {[1, 2, 3, 4].map((n) => (
              <span
                key={n}
                className={`h-1 flex-1 rounded-full ${n <= strength.bars ? strength.color : "bg-slate-200"}`}
              />
            ))}
          </div>
          <span className={`text-xs font-medium ${strength.text}`}>{strength.label}</span>
        </div>
      )}
      {hint && <p className="text-xs text-slate-500 mt-1.5">{hint}</p>}
    </div>
  );
}

/** Centered spinner card used while the app decides what to show first. */
export function GateLoading({ children = "Loading your data…" }) {
  return (
    <GateShell>
      <div className="flex flex-col items-center py-6 gap-3 text-slate-500" role="status">
        <Spinner size={26} className="text-blue-600" />
        <p className="text-sm">{children}</p>
      </div>
    </GateShell>
  );
}

export function GateSuccessIcon() {
  return <CheckCircle2 size={22} />;
}
