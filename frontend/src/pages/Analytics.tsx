import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { formatDuration, useApi } from "../lib";
import type { Analytics as A } from "../types";

const Tile = ({ label, value }: { label: string; value: string | number }) => (
  <Card><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p></Card>
);
const select = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default function Analytics() {
  const [days, setDays] = useState(14);
  const [source, setSource] = useState("all");
  const qs = `days=${days}&source=${source}`;
  const { data, error, loading, reload } = useApi<A>(`/analytics?${qs}`);

  const header = (
    <PageHeader title="Analytics" subtitle="Calculated from stored executions. Use the filter to separate demo data from your own runs.">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))} className={select}>
          <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
        <select aria-label="Data source" value={source} onChange={(e) => setSource(e.target.value)} className={select}>
          <option value="all">All data</option><option value="live">My runs only</option><option value="demo">Demo data only</option>
        </select>
        <a href={`/api/analytics/export?${qs}`} className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark">Export CSV</a>
      </div>
    </PageHeader>
  );

  if (loading && !data) return <>{header}<Loading /></>;
  if (error || !data) return <>{header}<ErrorBox message={error ?? "No data"} retry={reload} /></>;
  const t = data.totals;
  const days_ = data.daily.map((d) => ({ ...d, day: d.date.slice(5) }));

  return (
    <>
      {header}
      {source === "demo" && <p className="mb-4 rounded-lg bg-brand-soft px-4 py-2 text-sm text-brand-dark">You are looking at seeded demo data (fictional).</p>}
      {t.executions === 0 ? (
        <Card><Empty title="No executions in this range" hint="Run a workflow, or choose a longer time range or different data source." /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Executions" value={t.executions} />
            <Tile label="Success rate" value={t.success_rate === null ? "-" : `${t.success_rate}%`} />
            <Tile label="Failed runs" value={t.failed} />
            <Tile label="Average duration" value={formatDuration(t.avg_duration_seconds)} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Execution volume">
              <div className="h-64"><ResponsiveContainer><BarChart data={days_}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="day" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} />
                <Tooltip /><Legend />
                <Bar dataKey="success" name="Successful" stackId="a" fill="#10b981" /><Bar dataKey="failed" name="Failed" stackId="a" fill="#ef4444" />
              </BarChart></ResponsiveContainer></div>
            </Card>
            <Card title="Average duration per day (seconds)">
              <div className="h-64"><ResponsiveContainer><LineChart data={days_}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="day" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip /><Line type="monotone" dataKey="avg_duration_seconds" name="Avg seconds" stroke="#5b5ff0" strokeWidth={2} connectNulls />
              </LineChart></ResponsiveContainer></div>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card title="Workflow comparison" className="lg:col-span-2">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr>{["Workflow", "Runs", "Failed", "Success rate", "Avg. duration"].map((h) => <th key={h} className="pb-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>{data.workflows.map((w) => (
                  <tr key={w.workflow} className="border-t border-slate-100">
                    <td className="py-2 font-medium">{w.workflow}</td><td>{w.runs}</td><td>{w.failed}</td><td>{w.success_rate}%</td><td>{formatDuration(w.avg_duration_seconds)}</td>
                  </tr>))}</tbody>
              </table></div>
            </Card>
            <Card title="Common failure reasons">
              {data.failure_reasons.length === 0 ? <Empty title="No failures" hint="Nothing failed in this range." /> : (
                <ul className="space-y-3 text-sm">{data.failure_reasons.map((f) => (
                  <li key={f.reason} className="flex justify-between gap-3"><span className="break-words text-slate-600">{f.reason}</span><span className="font-semibold">{f.count}</span></li>))}</ul>
              )}
              <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Runs by trigger</h3>
              <ul className="space-y-1 text-sm">{data.triggers.map((x) => <li key={x.trigger} className="flex justify-between"><span className="text-slate-600">{x.trigger}</span><span className="font-semibold">{x.count}</span></li>)}</ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
