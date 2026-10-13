/* =====================================================================
   Self-contained chart components (replace recharts) — plain SVG/CSS,
   zero external dependency.
===================================================================== */
export function TrendChart({ data, dark }) {
  const width = 560,
    height = 220,
    padBottom = 20;
  const max = Math.max(1, ...data.flatMap((d) => [d.revenue, d.expenses])) * 1.1;
  const stepX = width / (data.length - 1 || 1);
  const scaleY = (v) => height - padBottom - (v / max) * (height - padBottom);
  const pointsFor = (key) => data.map((d, i) => `${i * stepX},${scaleY(d[key])}`).join(" ");
  const areaFor = (key) => `0,${height - padBottom} ${pointsFor(key)} ${width},${height - padBottom}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <polygon points={areaFor("revenue")} fill="#2563EB" opacity="0.12" />
      <polyline points={pointsFor("revenue")} fill="none" stroke="#2563EB" strokeWidth="2.5" />
      <polyline
        points={pointsFor("expenses")}
        fill="none"
        stroke="#94A3B8"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      {data.map((d, i) => (
        <text
          key={i}
          x={i * stepX}
          y={height - 4}
          fontSize="11"
          textAnchor="middle"
          fill={dark ? "#94a3b8" : "#64748b"}
        >
          {d.day}
        </text>
      ))}
    </svg>
  );
}
export function DonutChart({ data, colors, dark }) {
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
  return (
    <div className="flex items-center justify-center py-2">
      <div
        style={{
          width: 168,
          height: 168,
          borderRadius: "9999px",
          background: `conic-gradient(${stops})`,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 26,
            borderRadius: "9999px",
            background: dark ? "#0f172a" : "#ffffff",
          }}
        />
      </div>
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
            <span className={dark ? "text-slate-400" : "text-slate-500"}>{d.sold}</span>
          </div>
          <div className={`h-2 rounded-full ${dark ? "bg-slate-800" : "bg-slate-100"}`}>
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${(d.sold / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
