/** Tooltip shared by the dashboard charts. */

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
