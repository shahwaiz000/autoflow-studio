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

type Mark = "matched" | "approved" | "rejected" | "pending";
const MARK_STYLE: Record<Mark, string> = { matched: "bg-[#1f7f69]", approved: "bg-[#6fd9b6]", rejected: "bg-[#f0686c]", pending: "bg-[#f5a623]" };
const MARK_RANK: Record<Mark, number> = { matched: 0, approved: 1, rejected: 2, pending: 3 };
const MAX_MARKS = 120;

/** One mark per matched pair or exception. Long runs are grouped so the strip stays readable; a group shows its most urgent state. */
export function buildMarks(matched: number, approved: number, rejected: number, pending: number): { state: Mark; size: number }[] {
  const units: Mark[] = [
    ...Array<Mark>(Math.max(0, matched)).fill("matched"), ...Array<Mark>(Math.max(0, approved)).fill("approved"),
    ...Array<Mark>(Math.max(0, rejected)).fill("rejected"), ...Array<Mark>(Math.max(0, pending)).fill("pending"),
  ];
  const size = Math.max(1, Math.ceil(units.length / MAX_MARKS));
  const out: { state: Mark; size: number }[] = [];
  for (let i = 0; i < units.length; i += size) {
    const group = units.slice(i, i + size);
    out.push({ state: group.reduce((best, m) => (MARK_RANK[m] > MARK_RANK[best] ? m : best), group[0]), size: group.length });
  }
  return out;
}

function Legend({ color, label, n }: { color: string; label: string; n: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 rounded-[3px] ${color}`} aria-hidden="true" />
      <span className="text-slate-400">{label}</span><span className="num font-medium text-white">{n}</span>
    </li>
  );
}

function Hero({ latest }: { latest: NonNullable<D["latest"]> }) {
  const { review } = latest;
  const marks = buildMarks(latest.matched_rows, review.approved, review.rejected, review.pending);
  const step = Math.min(14, 700 / Math.max(1, marks.length));
  const rate = latest.match_rate == null ? null : latest.match_rate;
  return (
    <section aria-labelledby="hero-title" className="mb-5 overflow-hidden rounded-[18px] bg-navy-900 p-6 text-slate-300 shadow-lift sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="hero-title" className="text-[15px] font-medium text-white">Latest reconciliation: {latest.left ?? "first file"} compared with {latest.right ?? "second file"}</h2>
          <p className="mt-1 text-sm text-slate-400">{latest.workflow}, {timeAgo(latest.started_at)}</p>
        </div>
        <Link to={`/executions/${latest.execution_id}`} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20">Open run #{latest.execution_id}</Link>
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-end">
        <div>
          <p className="text-sm text-slate-400">Match rate</p>
          <p className="num mt-1 flex items-baseline text-[64px] font-semibold leading-none text-white sm:text-[76px]">
            {rate == null ? "-" : <><span>{rate}</span><span className="ml-1 text-[0.45em] font-medium text-slate-400">%</span></>}
          </p>
          <p className="mt-3 text-sm text-slate-300">{latest.matched_rows} of {latest.rows} rows matched</p>
        </div>
        <div className="md:border-l md:border-white/10 md:pl-8">
          <p className="text-sm text-slate-400">Amount at risk</p>
          <p className={`num mt-1 text-[40px] font-semibold leading-none sm:text-[46px] ${latest.amount_at_risk ? "text-[#f5a623]" : "text-[#6fd9b6]"}`}>{money(latest.amount_at_risk)}</p>
          <p className="mt-3 text-sm text-slate-400">Differences plus amounts with no partner</p>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex h-11 items-end gap-[2px] sm:gap-[3px]" role="img"
          aria-label={`${latest.matched_rows} matched, ${review.pending} waiting for review, ${review.approved} approved, ${review.rejected} rejected`}>
          {marks.map((m, i) => (
            <span key={i} style={{ animationDelay: `${Math.round(i * step)}ms`, height: m.state === "matched" ? "62%" : "100%" }}
              className={`min-w-0 flex-1 origin-bottom animate-tickIn rounded-[2px] ${MARK_STYLE[m.state]}`} />
          ))}
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Legend color={MARK_STYLE.matched} label="Matched" n={latest.matched_rows} />
          <Legend color={MARK_STYLE.pending} label="To review" n={review.pending} />
          <Legend color={MARK_STYLE.approved} label="Approved" n={review.approved} />
          <Legend color={MARK_STYLE.rejected} label="Rejected" n={review.rejected} />
        </ul>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
        <p className="text-sm text-slate-400">{latest.exceptions} found, {review.approved} approved, {review.rejected} rejected</p>
        {review.pending > 0 ? (
          <Link to={`/executions/${latest.execution_id}`} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-slate-100">
            Review {review.pending} {review.pending === 1 ? "exception" : "exceptions"}
          </Link>
        ) : <span className="text-sm font-medium text-[#6fd9b6]">{latest.exceptions ? "Every exception is reviewed" : "Nothing to review"}</span>}
      </div>
    </section>
  );
}

function Breakdown({ counts, empty }: { counts: Record<string, number>; empty: string }) {
  const rows = Object.entries(counts).filter(([k, n]) => n > 0 && KIND_LABELS[k]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length) return <p className="text-sm font-medium text-mint-dark">{empty}</p>;
  return (
    <ul className="space-y-4 text-sm">
      {rows.map(([k, n]) => (
        <li key={k}>
          <div className="flex items-baseline justify-between gap-3"><span className="text-slate-700">{KIND_LABELS[k]}</span><span className="num font-semibold text-navy-900">{n}</span></div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-sun transition-[width] duration-500" style={{ width: `${(100 * n) / max}%` }} /></div>
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
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Reconciliation overview" subtitle="How your latest reconciliation went and what still needs attention. Numbers come from real runs.">
        <Link to="/workflows" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-dark">Run a reconciliation</Link>
      </PageHeader>

      {data.last_failure && (
        <p role="alert" className="mb-5 rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-dark">
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
          <Hero latest={latest} />
          <div className="mb-5 grid gap-5 lg:grid-cols-[2fr_3fr]">
            <Card title="What is wrong in the latest run"><Breakdown counts={latest.by_kind} empty="Everything matched. Nothing to review." /></Card>
            <Card title={`Exceptions found per day (last ${data.days} days)`}>
              <div className="h-52" role="img" aria-label="Exceptions found per day">
                <ResponsiveContainer>
                  <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid vertical={false} stroke="#e8ecf0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} interval="preserveStartEnd" minTickGap={28} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: "#edf1fd" }} />
                    <Bar dataKey="exceptions" name="Exceptions" fill="#2b50d8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}

      <Card title="Recent runs" action={<Link className="text-sm font-medium text-brand-dark hover:underline" to="/executions">All runs ({totals.runs})</Link>}>
        {data.recent.length === 0 ? <Empty title="No runs yet" hint="Runs appear here as soon as you run a workflow." /> : (
          <ul className="-mx-2 text-sm">
            {data.recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-3 transition-colors hover:bg-slate-50">
                <Link className="font-medium text-navy-900 hover:text-brand-dark hover:underline" to={`/executions/${e.id}`}>#{e.id} {e.workflow_name}</Link>
                <StatusBadge status={e.status} />
                <span className="text-slate-500">{timeAgo(e.started_at)}, {formatDuration(e.duration_seconds)}</span>
                {e.error_message && <span className="min-w-0 truncate text-coral-dark">{e.error_message}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
