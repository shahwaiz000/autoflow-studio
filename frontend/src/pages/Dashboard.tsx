import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTip } from "../components/dash";
import { Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDuration, timeAgo, useApi } from "../lib";
import type { Dashboard as D } from "../types";

export const KIND_LABELS: Record<string, string> = {
  amount_mismatch: "Amount differs", missing_in_right: "Missing in the second file", missing_in_left: "Missing in the first file",
  unreadable_amount: "Amount missing or unreadable", duplicate: "Duplicate key", missing_key: "No key",
};
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function Tile({ label, value, tone = "text-slate-900", hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`num mt-1 text-2xl font-semibold ${tone}`}>{value}</dd>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Breakdown({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const rows = Object.entries(counts).filter(([k, n]) => n > 0 && KIND_LABELS[k]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length) return <p className="text-sm text-emerald-700">{empty}</p>;
  return (
    <ul className="space-y-3 text-sm">
      {rows.map(([k, n]) => (
        <li key={k}>
          <div className="flex justify-between"><span>{KIND_LABELS[k]}</span><span className="num font-medium">{n}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${(100 * n) / max}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<D>("/dashboard");
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorBox message={error ?? "No data"} retry={reload} />;
  const { latest, totals } = data;
  const trend = data.trend.map((d) => ({ ...d, label: dayLabel(d.date) }));

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Reconciliation overview" subtitle="How your latest reconciliation went and what still needs attention. Numbers come from real runs.">
        <Link to="/workflows" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark">Run a reconciliation</Link>
      </PageHeader>

      {data.last_failure && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-800">
          The most recent failed run was <b>{data.last_failure.workflow}</b>{data.last_failure.reason ? `: ${data.last_failure.reason}` : ""}.{" "}
          <Link className="font-medium underline" to={`/executions/${data.last_failure.execution_id}`}>Open it</Link>
        </p>
      )}

      {!latest ? (
        <Card>
          <Empty title="No reconciliation has been run yet"
            hint="Open Reconciliations, choose COD Reconciliation, then pick a courier collections file and a bank deposits file. The sample files are a good first try." />
        </Card>
      ) : (
        <>
          <Card title={`Latest reconciliation: ${latest.left ?? "first file"} compared with ${latest.right ?? "second file"}`}
            action={<Link className="text-sm font-medium text-brand-dark hover:underline" to={`/executions/${latest.execution_id}`}>Open run #{latest.execution_id}</Link>}
            className="mb-4">
            <p className="mb-4 text-sm text-slate-500">{latest.workflow}, {timeAgo(latest.started_at)}</p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Match rate" value={latest.match_rate == null ? "-" : `${latest.match_rate}%`} hint={`${latest.matched_rows} of ${latest.rows} rows matched`} />
              <Tile label="Exceptions to review" value={latest.review.pending} tone={latest.review.pending ? "text-amber-600" : "text-emerald-600"}
                hint={`${latest.exceptions} found, ${latest.review.approved} approved, ${latest.review.rejected} rejected`} />
              <Tile label="Amount at risk" value={money(latest.amount_at_risk)} hint="Differences plus amounts with no partner" />
              <Tile label="Rows compared" value={latest.rows} />
            </dl>
          </Card>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card title="What is wrong in the latest run"><Breakdown counts={latest.by_kind} empty="Everything matched. Nothing to review." /></Card>
            <Card title={`Exceptions found per day (last ${data.days} days)`}>
              <div className="h-52" role="img" aria-label="Exceptions found per day">
                <ResponsiveContainer>
                  <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="exceptions" name="Exceptions" fill="#f59e0b" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}

      <Card title="Recent runs" action={<Link className="text-sm font-medium text-brand-dark hover:underline" to="/executions">All runs ({totals.runs})</Link>}>
        {data.recent.length === 0 ? <Empty title="No runs yet" hint="Runs appear here as soon as you run a workflow." /> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Link className="font-medium text-brand-dark hover:underline" to={`/executions/${e.id}`}>#{e.id} {e.workflow_name}</Link>
                <StatusBadge status={e.status} />
                <span className="text-slate-500">{timeAgo(e.started_at)}, {formatDuration(e.duration_seconds)}</span>
                {e.error_message && <span className="min-w-0 truncate text-red-700">{e.error_message}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
