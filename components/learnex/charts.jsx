import { useState } from "react";
import { money } from "@/lib/learnex/utils";

/* =====================================================================
   Self-contained chart components (replace recharts) — plain SVG/CSS,
   zero external dependency.
===================================================================== */
const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};

/** Revenue (solid) against expenses (dashed) over a few points, with a value scale and hover details. */
export function TrendChart({ data, dark }) {
  const [hover, setHover] = useState(null);
  if (!data || !data.length) return null;
  const width = 560;
  const height = 240;
  const pad = { l: 44, r: 18, t: 14, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const rawMax = Math.max(1, ...data.flatMap((d) => [d.revenue, d.expenses]));
  // a round top value so the grid lines read as 0 / 25% / 50% / 75% / 100%
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / (mag / 2)) * (mag / 2);
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const x = (i) => pad.l + (data.length > 1 ? i * stepX : innerW / 2);
  const y = (v) => pad.t + innerH - (v / max) * innerH;
  const pts = (key) => data.map((d, i) => `${x(i)},${y(d[key])}`).join(" ");
  const area = `${x(0)},${pad.t + innerH} ${pts("revenue")} ${x(data.length - 1)},${pad.t + innerH}`;
  const grid = [0, 0.25, 0.5, 0.75, 1];
  const axis = dark ? "#94a3b8" : "#64748b";
  const line = dark ? "#1e293b" : "#e2e8f0";
  const revenueColor = dark ? "#60a5fa" : "#2563eb";

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round((px - pad.l) / (stepX || 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }
  const h = hover == null ? null : data[hover];
  const tipW = 132;
  const tipX = h ? Math.min(Math.max(x(hover) - tipW / 2, pad.l), width - pad.r - tipW) : 0;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label="Revenue and expenses over the week"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", height: "auto", maxHeight: 280 }}
      >
        {grid.map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={width - pad.r} y1={y(max * g)} y2={y(max * g)} stroke={line} strokeWidth="1" />
            <text x={pad.l - 8} y={y(max * g) + 4} fontSize="10" textAnchor="end" fill={axis}>
              {compact(max * g)}
            </text>
          </g>
        ))}
        <polygon points={area} fill={revenueColor} opacity="0.1" />
        <polyline points={pts("revenue")} fill="none" stroke={revenueColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline
          points={pts("expenses")}
          fill="none"
          stroke="#94A3B8"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={height - 8} fontSize="11" textAnchor="middle" fill={axis}>
            {d.day}
          </text>
        ))}
        {h && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke={axis} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={x(hover)} cy={y(h.revenue)} r="4.5" fill={revenueColor} stroke={dark ? "#0f172a" : "#fff"} strokeWidth="2" />
            <circle cx={x(hover)} cy={y(h.expenses)} r="4" fill="#94A3B8" stroke={dark ? "#0f172a" : "#fff"} strokeWidth="2" />
            <g transform={`translate(${tipX}, ${pad.t})`}>
              <rect width={tipW} height="56" rx="8" fill={dark ? "#1e293b" : "#0f172a"} opacity="0.96" />
              <text x="10" y="17" fontSize="11" fontWeight="600" fill="#fff">
                {h.day}
              </text>
              <circle cx="14" cy="31" r="3.5" fill={revenueColor} />
              <text x="24" y="34.5" fontSize="10.5" fill="#e2e8f0">
                {money(h.revenue)}
              </text>
              <circle cx="14" cy="46" r="3.5" fill="#94A3B8" />
              <text x="24" y="49.5" fontSize="10.5" fill="#e2e8f0">
                {money(h.expenses)}
              </text>
            </g>
          </g>
        )}
      </svg>
      <div className={`flex items-center justify-center gap-5 text-xs mt-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full" style={{ background: revenueColor }} /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 border-t-2 border-dashed border-slate-400" /> Expenses
        </span>
      </div>
    </div>
  );
}

/** Share of a total split into coloured segments, with the total in the middle and a legend underneath. */
export function DonutChart({ data, colors, dark, legend = true }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let acc = 0;
  const stops =
    data.length && total > 0
      ? data
          .map((d) => {
            const start = (acc / total) * 360;
            acc += d.value;
            const end = (acc / total) * 360;
            return `${colors[d.name] || "#64748B"} ${start}deg ${end}deg`;
          })
          .join(", ")
      : dark
        ? "#1e293b"
        : "#e2e8f0";
  const sub = dark ? "text-slate-400" : "text-slate-500";
  return (
    <div>
      <div className="flex items-center justify-center py-2">
        <div
          role="img"
          aria-label="Share of the total by category"
          style={{
            width: 168,
            height: 168,
            borderRadius: "9999px",
            background: `conic-gradient(${stops})`,
            position: "relative",
          }}
        >
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{
              position: "absolute",
              inset: 26,
              borderRadius: "9999px",
              background: dark ? "#0f172a" : "#ffffff",
            }}
          >
            <span className={`text-[10px] font-medium uppercase tracking-wide ${sub}`}>Total</span>
            <span className="text-sm font-semibold tabular-nums leading-tight px-1">{money(total)}</span>
          </div>
        </div>
      </div>
      {legend && total > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {data.map((d) => (
            <li key={d.name} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colors[d.name] || "#64748B" }} />
              <span className="truncate flex-1">{d.name}</span>
              <span className={`tabular-nums ${sub}`}>{Math.round((d.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HBarList({ data, dark }) {
  const max = Math.max(1, ...data.map((d) => d.sold));
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-1">
            <span className="truncate pr-2">{d.name}</span>
            <span className={`tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>{d.sold}</span>
          </div>
          <div className={`h-2 rounded-full ${dark ? "bg-slate-800" : "bg-slate-100"}`}>
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${(d.sold / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
