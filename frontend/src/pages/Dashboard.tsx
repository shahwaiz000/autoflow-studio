import { useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTip, HealthRing, Kpi, RateBar, TimeSavedCard } from "../components/dash";
import { Icon } from "../components/icons";
import { Card, DemoNote, Empty, ErrorBox, Loading, StatusBadge } from "../components/ui";
import { api, comparePeriods, formatDuration, pctChange, timeAgo, useApi } from "../lib";
import type { Analytics, Dashboard as D, Execution, Workflow } from "../types";

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

type RunResult = { ok: boolean; text: string; id?: number };

export default function Dashboard() {
  const dash = useApi<D>("/dashboard");
  const report = useApi<Analytics>("/analytics?days=14");
  const wfs = useApi<Workflow[]>("/workflows");
  const [range, setRange] = useState<7 | 14>(14);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const data = dash.data;
  if (!data && dash.loading) return <Loading />;
  if (!data) return <ErrorBox message={dash.error ?? "No data"} retry={dash.reload} />;

  const t = data.totals;
  const enabled = (wfs.data ?? []).filter((w) => w.enabled);
  const chosen = picked ?? enabled[0]?.id ?? null;
  const { current, previous } = comparePeriods(data.trend);
  const runs7 = current.success + current.failed;
  const prevRuns = previous.success + previous.failed;
  const perf = new Map(data.workflow_performance.map((p) => [p.workflow, p]));
  const rows = (wfs.data ?? [])
    .map((w) => ({ w, p: perf.get(w.name) }))
    .sort((a, b) => (b.p?.runs ?? 0) - (a.p?.runs ?? 0))
    .slice(0, 6);
  const maxReason = Math.max(1, ...data.failure_reasons.map((f) => f.count));

  async function runWorkflow(w: { id: number; name: string }) {
    setBusy(w.id); setResult(null);
    try {
      const ex = await api<Execution>(`/workflows/${w.id}/run`, { method: "POST" });
      setResult({ ok: ex.status === "success", id: ex.id, text: `${w.name} ${ex.status}${ex.error_message ? `: ${ex.error_message}` : ""}` });
      dash.reload(); report.reload(); wfs.reload();
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <DemoNote demo={data.data_source.demo_executions} live={data.data_source.live_executions} />

      {/* Run health: the main view of how automation is doing */}
      <section aria-label="Run health" className="overflow-hidden rounded-2xl bg-navy-900 text-white shadow-lift">
        <div className="grid gap-8 p-6 lg:grid-cols-[auto_minmax(0,1fr)_17rem] lg:items-center lg:p-8">
          <div className="flex items-center gap-6">
            <HealthRing success={t.successful} failed={t.failed} />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">Automation health</h1>
              <p className="num mt-1 text-sm text-slate-300">
                {t.successful} successful and {t.failed} failed, out of {t.successful + t.failed} finished runs
              </p>
              {t.running > 0 && (
                <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-sun/15 px-3 py-1 text-xs font-medium text-sun">
                  <span className="h-2 w-2 animate-pulseDot rounded-full bg-sun" aria-hidden="true" />
                  {t.running} running now
                </p>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-300">Runs per day</h2>
              <div className="flex rounded-lg bg-white/10 p-0.5 text-xs" role="group" aria-label="Chart range">
                {([7, 14] as const).map((r) => (
                  <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${range === r ? "bg-white text-navy-900" : "text-slate-300 hover:text-white"}`}>
                    {r} days
                  </button>
                ))}
              </div>
            </div>
            <div className="h-40">
              <ResponsiveContainer>
                <BarChart data={data.trend.slice(-range).map((d) => ({ ...d, day: dayLabel(d.date) }))} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: "#94a3b8" }} interval={range === 7 ? 0 : 1} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={24} tick={{ fill: "#94a3b8" }} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(255,255,255,0.06)" }} />
                  <Bar dataKey="success" name="Successful" stackId="r" fill="#14b88a" />
                  <Bar dataKey="failed" name="Failed" stackId="r" fill="#ee5a5f" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
            <label htmlFor="quick-run" className="text-sm font-medium text-white">Run a workflow</label>
            <select id="quick-run" value={chosen ?? ""} onChange={(e) => setPicked(Number(e.target.value))} disabled={!enabled.length}
              className="mt-2 w-full rounded-lg border border-white/15 bg-navy-800 px-3 py-2 text-sm text-white">
              {enabled.length === 0 && <option value="">No enabled workflows</option>}
              {enabled.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button onClick={() => { const w = enabled.find((x) => x.id === chosen); if (w) runWorkflow(w); }}
              disabled={chosen === null || busy !== null}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
              <Icon name="play" className="h-4 w-4" /> {busy !== null && busy === chosen ? "Running..." : "Run now"}
            </button>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Link to="/upload" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-slate-200 hover:bg-white/10">
                <Icon name="upload" className="h-4 w-4" /> Upload CSV
              </Link>
              <Link to="/templates" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-slate-200 hover:bg-white/10">
                <Icon name="templates" className="h-4 w-4" /> Templates
              </Link>
            </div>
          </div>
        </div>
      </section>

      {result && (
        <p role="status" className={`mt-4 flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm ${result.ok ? "bg-mint-soft text-mint-dark" : "bg-coral-soft text-coral-dark"}`}>
          <Icon name={result.ok ? "check" : "cross"} className="h-4 w-4" />
          {result.text}
          {result.id && <Link className="font-medium underline" to={`/executions/${result.id}`}>View logs</Link>}
        </p>
      )}

      {/* Key numbers */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon="workflow" label="Total workflows" value={t.workflows}
          hint={`${t.enabled_workflows} enabled, ${t.workflows - t.enabled_workflows} disabled`} />
        <Kpi icon="executions" label="Runs, last 7 days" value={runs7}
          delta={{ pct: pctChange(runs7, prevRuns), emptyText: "No runs in the previous 7 days" }}
          spark={data.trend.map((d) => d.success + d.failed)} />
        <Kpi icon="alert" label="Failed, last 7 days" value={current.failed} tone="#ee5a5f"
          delta={{ pct: pctChange(current.failed, previous.failed), goodWhenDown: true,
            emptyText: current.failed === 0 ? "No failures in the last 14 days" : "No failures in the previous 7 days" }}
          spark={data.trend.map((d) => d.failed)} />
        <Kpi icon="bolt" label="Average run time" value={formatDuration(t.avg_duration_seconds)} tone="#14b88a"
          hint="Across all finished runs"
          spark={report.data?.daily.map((d) => d.avg_duration_seconds)} />
        <TimeSavedCard successful={t.successful} demoRuns={data.data_source.demo_executions} />
      </div>

      {/* Performance and errors */}
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card title="Average run time per day" className="lg:col-span-2">
          {!report.data ? (
            <p className="py-12 text-center text-sm text-slate-500">{report.error ?? "Loading..."}</p>
          ) : (
            <div className="h-60">
              <ResponsiveContainer>
                <AreaChart data={report.data.daily.map((d) => ({ ...d, day: dayLabel(d.date) }))}>
                  <CartesianGrid vertical={false} stroke="#e8eaf3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} interval={1} tick={{ fill: "#64748b" }} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} tick={{ fill: "#64748b" }} tickFormatter={(v: number) => formatDuration(v)} />
                  <Tooltip content={<ChartTip format={formatDuration} />} />
                  <Area type="monotone" dataKey="avg_duration_seconds" name="Average run time" stroke="#5b5ff0" strokeWidth={2.5}
                    fill="#5b5ff0" fillOpacity={0.1} connectNulls dot={{ r: 3, fill: "#5b5ff0", strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Failure summary" action={<span className="num text-xs text-slate-500">{t.failed} failed in total</span>}>
          {data.failure_reasons.length === 0 ? <Empty title="No failures" hint="Nothing has failed yet." /> : (
            <ul className="space-y-4 text-sm">
              {data.failure_reasons.map((f) => (
                <li key={f.reason}>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-700">{f.reason}</span>
                    <span className="num font-semibold text-slate-900">{f.count}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-coral" style={{ width: `${(100 * f.count) / maxReason}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Workflow status and recent activity */}
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card title="Workflow status" className="lg:col-span-2"
          action={<Link to="/workflows" className="text-sm font-medium text-brand-dark hover:underline">All workflows</Link>}>
          {wfs.error && !wfs.data ? <p className="py-8 text-center text-sm text-coral-dark">{wfs.error}</p>
            : rows.length === 0 ? <Empty title="No workflows yet" hint="Create one in the builder or start from a template." /> : (
              <ul className="divide-y divide-slate-100">
                {rows.map(({ w, p }) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 flex-1 basis-48 items-center gap-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${w.enabled ? "bg-mint" : "bg-slate-300"}`}
                        title={w.enabled ? "Enabled" : "Disabled"} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{w.name}</p>
                        <p className="text-xs text-slate-500">{w.category}, {w.step_count} steps{w.enabled ? "" : ", disabled"}</p>
                      </div>
                    </div>
                    <div className="w-28 shrink-0">
                      <RateBar runs={p?.runs ?? 0} failed={p?.failed ?? 0} />
                      <p className="num mt-1 text-xs text-slate-500">
                        {p ? `${p.runs} runs, ${formatDuration(p.avg_duration_seconds)} avg` : "No runs yet"}
                      </p>
                    </div>
                    <div className="w-20 shrink-0">{w.last_status ? <StatusBadge status={w.last_status} /> : <span className="text-xs text-slate-400">Not run</span>}</div>
                    <button onClick={() => runWorkflow(w)} disabled={!w.enabled || busy !== null} aria-label={`Run ${w.name}`}
                      title={w.enabled ? "Run now" : "Enable this workflow to run it"}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:border-brand hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-40">
                      <Icon name="play" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Card>

        <Card title="Recent activity" action={<Link to="/executions" className="text-sm font-medium text-brand-dark hover:underline">All executions</Link>}>
          {data.recent.length === 0 ? <Empty title="No executions yet" hint="Open Workflows and run one." /> : (
            <ol className="space-y-4">
              {data.recent.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${e.status === "success" ? "bg-mint-soft text-mint-dark" : e.status === "failed" ? "bg-coral-soft text-coral-dark" : "bg-sun-soft text-sun-dark"}`}>
                    <Icon name={e.status === "success" ? "check" : e.status === "failed" ? "cross" : "clock"} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm">
                      <Link className="truncate font-medium text-slate-900 hover:text-brand-dark hover:underline" to={`/executions/${e.id}`}>{e.workflow_name}</Link>
                      {e.is_demo && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">Demo</span>}
                    </p>
                    <p className="num text-xs text-slate-500">
                      {timeAgo(e.started_at)}, {formatDuration(e.duration_seconds)}, {e.trigger_type} trigger
                    </p>
                    {e.status === "failed" && e.error_message && (
                      <p className="mt-1 line-clamp-2 text-xs text-coral-dark">{e.error_message}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
