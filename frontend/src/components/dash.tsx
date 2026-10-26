import { ReactNode, useState } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { estimateSavedMinutes, formatMinutes } from "../lib";
import { Icon, type IconName } from "./icons";

/* ---------- Success ring ---------- */

export function HealthRing({ success, failed }: { success: number; failed: number }) {
  const total = success + failed;
  const s = total ? (100 * success) / total : 0;
  const f = total ? 100 - s : 0;
  const rate = total ? Math.round((1000 * success) / total) / 10 : null;
  const common = { cx: 70, cy: 70, r: 54, fill: "none", strokeWidth: 14, pathLength: 100 } as const;
  return (
    <div className="relative h-36 w-36 shrink-0" role="img"
      aria-label={rate === null ? "No finished runs yet" : `Success rate ${rate} percent`}>
      <svg viewBox="0 0 140 140" className="h-full w-full">
        <g transform="rotate(-90 70 70)">
          <circle {...common} stroke="rgba(255,255,255,0.10)" />
          {s > 0 && (
            <circle {...common} stroke="#14b88a" strokeDasharray={`${s} 100`} strokeDashoffset={0}
              className="animate-ring" style={{ ["--ring-len" as string]: 100 }} />
          )}
          {f > 0 && (
            <circle {...common} stroke="#ee5a5f" strokeDasharray={`${f} 100`} strokeDashoffset={-s} className="animate-fadeIn" />
          )}
        </g>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        {rate === null ? (
          <p className="px-6 text-xs text-slate-400">No finished runs yet</p>
        ) : (
          <div>
            <p className="num text-3xl font-semibold text-white">{rate}%</p>
            <p className="text-xs text-slate-400">success rate</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Tiny trend line inside a stat card ---------- */

export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full" aria-hidden="true">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12}
            connectNulls dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Stat card ---------- */

export interface Delta { pct: number | null; goodWhenDown?: boolean; emptyText: string }

function DeltaLine({ delta }: { delta: Delta }) {
  if (delta.pct === null) return <p className="text-xs text-slate-500">{delta.emptyText}</p>;
  if (delta.pct === 0) return <p className="text-xs text-slate-500">No change vs previous 7 days</p>;
  const up = delta.pct > 0;
  const good = delta.goodWhenDown ? !up : up;
  return (
    <p className={`inline-flex items-center gap-1 text-xs font-medium ${good ? "text-mint-dark" : "text-coral-dark"}`}>
      <Icon name={up ? "up" : "down"} className="h-3.5 w-3.5" />
      {up ? "+" : ""}{delta.pct}% vs previous 7 days
    </p>
  );
}

export function Kpi({ icon, label, value, hint, delta, spark, tone = "#5b5ff0" }: {
  icon: IconName; label: string; value: ReactNode; hint?: string; delta?: Delta; spark?: (number | null)[]; tone?: string;
}) {
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card transition-shadow hover:shadow-lift">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand"><Icon name={icon} className="h-4 w-4" /></span>
      </div>
      <p className="num mt-2 text-3xl font-semibold text-slate-900">{value}</p>
      <div className="mt-1 min-h-[1rem]">
        {delta ? <DeltaLine delta={delta} /> : hint && <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      {spark && <div className="mt-3"><Sparkline values={spark} color={tone} /></div>}
    </section>
  );
}

/* ---------- Time saved (calculated only from the user's own figure) ---------- */

const MANUAL_KEY = "autoflow.manualMinutesPerRun";

export function TimeSavedCard({ successful, demoRuns }: { successful: number; demoRuns: number }) {
  const [raw, setRaw] = useState<string>(() => {
    try { return localStorage.getItem(MANUAL_KEY) ?? ""; } catch { return ""; }
  });
  const minutes = raw.trim() === "" ? null : Number(raw);
  const saved = estimateSavedMinutes(successful, minutes);
  function change(v: string) {
    setRaw(v);
    try { localStorage.setItem(MANUAL_KEY, v); } catch { /* storage may be blocked; the value still works this session */ }
  }
  return (
    <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card transition-shadow hover:shadow-lift">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Estimated time saved</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand"><Icon name="clock" className="h-4 w-4" /></span>
      </div>
      <p className="num mt-2 text-3xl font-semibold text-slate-900">{saved === null ? "-" : formatMinutes(saved)}</p>
      <p className="mt-1 text-xs text-slate-500">
        {saved === null
          ? "Enter how long one run takes by hand to see an estimate."
          : `${successful} successful runs x ${minutes} min, based on your figure.${demoRuns > 0 ? " Includes demo runs." : ""}`}
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
        <span className="shrink-0">Manual time per run</span>
        <input type="number" inputMode="decimal" min={0} step="any" value={raw} onChange={(e) => change(e.target.value)}
          aria-label="Manual minutes per run" placeholder="min"
          className="w-full min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-800" />
      </label>
    </section>
  );
}

/* ---------- Chart tooltip ---------- */

interface TipProps {
  active?: boolean; label?: string | number;
  payload?: { name?: string; value?: number | string | null; color?: string; dataKey?: string | number }[];
  format?: (v: number) => string;
}

export function ChartTip({ active, payload, label, format }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lift">
      <p className="mb-1 font-medium text-slate-900">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-slate-900">{typeof p.value === "number" && format ? format(p.value) : p.value ?? "-"}</span>
        </p>
      ))}
    </div>
  );
}

/* ---------- Pieces of the workflow list ---------- */

export function RateBar({ runs, failed }: { runs: number; failed: number }) {
  if (runs === 0) return <div className="h-2 w-full rounded-full bg-slate-100" aria-label="No runs yet" />;
  const ok = ((runs - failed) / runs) * 100;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img"
      aria-label={`${Math.round(ok)} percent successful, ${runs} runs`}>
      <div className="bg-mint" style={{ width: `${ok}%` }} />
      <div className="bg-coral" style={{ width: `${100 - ok}%` }} />
    </div>
  );
}
