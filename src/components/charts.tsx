"use client";

import { useId } from "react";

export type Series = { key: string; label: string; color: string; points: number[] };

// ─── Live multi-series area/line chart (the "stock ticker") ───────────
export function LiveChart({
  series,
  xLabels,
  height = 260,
  yUnit = "",
  area = true,
  baseZero = true,
}: {
  series: Series[];
  xLabels?: string[];
  height?: number;
  yUnit?: string;
  area?: boolean;
  baseZero?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const W = 760;
  const H = height;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = Math.max(...series.map((s) => s.points.length), 0);
  const allVals = series.flatMap((s) => s.points);
  let yMax = allVals.length ? Math.max(...allVals) : 1;
  let yMin = baseZero ? 0 : allVals.length ? Math.min(...allVals) : 0;
  if (yMax === yMin) yMax = yMin + 1;
  yMax = yMax * 1.1; // headroom

  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

  function linePath(pts: number[]) {
    if (pts.length === 0) return "";
    return pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  }
  function areaPath(pts: number[]) {
    if (pts.length === 0) return "";
    const top = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return `${top} L${x(pts.length - 1).toFixed(1)},${y(yMin).toFixed(1)} L${x(0).toFixed(1)},${y(yMin).toFixed(1)} Z`;
  }

  const labelIdx = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* gridlines + y labels */}
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#f0efed" strokeWidth={1} />
            <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#a8a29e">
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* areas then lines */}
        {area &&
          series.map((s) => (
            <path key={`a-${s.key}`} d={areaPath(s.points)} fill={`url(#grad-${uid}-${s.key})`} />
          ))}
        {series.map((s) => (
          <path key={`l-${s.key}`} d={linePath(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* last-value dots */}
        {series.map((s) =>
          s.points.length ? (
            <circle key={`d-${s.key}`} cx={x(s.points.length - 1)} cy={y(s.points[s.points.length - 1])} r={3.5} fill={s.color} stroke="#fff" strokeWidth={1.5} />
          ) : null,
        )}

        {/* x labels */}
        {xLabels &&
          labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="#a8a29e">
              {xLabels[i] ?? ""}
            </text>
          ))}
      </svg>

      {/* legend + current values */}
      <div className="mt-1 flex flex-wrap gap-4 px-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-neutral-500">{s.label}</span>
            <span className="font-semibold tabular-nums text-neutral-800">
              {s.points.length ? s.points[s.points.length - 1].toFixed(2) : "—"}
              {yUnit && <span className="ml-0.5 font-normal text-neutral-400">{yUnit}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mini sparkline for KPI tiles ────────────────────────────────────
export function Spark({ points, color = "#38a169", height = 34 }: { points: number[]; color?: string; height?: number }) {
  const W = 120;
  const H = height;
  if (points.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} className="w-full" />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max === min ? 1 : max - min;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} className="w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── KPI tile: big value + delta + sparkline ─────────────────────────
export function KpiTile({
  label,
  value,
  unit,
  color = "#1c1917",
  spark,
  sparkColor = "#38a169",
  decimals = 2,
}: {
  label: string;
  value: number | string;
  unit?: string;
  color?: string;
  spark?: number[];
  sparkColor?: string;
  decimals?: number;
}) {
  const numeric = typeof value === "number";
  const delta =
    spark && spark.length >= 2 ? spark[spark.length - 1] - spark[spark.length - 2] : null;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
            {numeric ? (value as number).toFixed(decimals) : value}
            {unit && <span className="ml-1 text-sm font-medium text-neutral-400">{unit}</span>}
          </div>
        </div>
        {delta !== null && Math.abs(delta) > 1e-9 && (
          <span className={`text-xs font-semibold tabular-nums ${delta >= 0 ? "text-green-600" : "text-red-500"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
      {spark && spark.length >= 2 && (
        <div className="mt-2">
          <Spark points={spark} color={sparkColor} />
        </div>
      )}
    </div>
  );
}
