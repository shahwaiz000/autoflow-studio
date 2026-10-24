import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { Card, DemoNote, Empty, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDate, formatDuration, useApi } from "../lib";
import type { Dashboard as D } from "../types";

const Stat = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <Card>
    <p className="text-sm text-slate-500">{label}</p>
    <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
  </Card>
);

export default function Dashboard() {
  const { data, error, loading, reload } = useApi<D>("/dashboard");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "No data"} retry={reload} />;
  const t = data.totals;
  const donut = [
    { name: "Successful", value: t.successful, color: "#10b981" },
    { name: "Failed", value: t.failed, color: "#ef4444" },
    { name: "Running", value: t.running, color: "#f59e0b" },
  ];
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live metrics calculated from stored executions." />
      <DemoNote demo={data.data_source.demo_executions} live={data.data_source.live_executions} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Total workflows" value={t.workflows} hint={`${t.enabled_workflows} enabled`} />
        <Stat label="Successful runs" value={t.successful} />
        <Stat label="Failed runs" value={t.failed} />
        <Stat label="Running now" value={t.running} />
        <Stat label="Avg. duration" value={formatDuration(t.avg_duration_seconds)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Execution trend (14 days)" className="lg:col-span-2">
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={data.trend.map((d) => ({ ...d, day: d.date.slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Area type="monotone" dataKey="success" name="Successful" stroke="#10b981" fill="#10b98122" />
                <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" fill="#ef444422" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Success rate">
          {t.success_rate === null ? <Empty title="No finished runs" hint="Run a workflow to see its success rate." /> : (
            <div className="relative h-52">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={donut} dataKey="value" innerRadius={62} outerRadius={84} paddingAngle={2}>
                    {donut.map((s) => <Cell key={s.name} fill={s.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <p className="pointer-events-none absolute inset-0 grid place-items-center text-2xl font-semibold">{t.success_rate}%</p>
            </div>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Recent executions" className="lg:col-span-2">
          {data.recent.length === 0 ? <Empty title="No executions yet" hint="Open Workflows and run one." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="pb-2 font-medium">Workflow</th><th className="font-medium">Status</th><th className="font-medium">Duration</th><th className="font-medium">Started</th></tr></thead>
                <tbody>
                  {data.recent.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="py-2"><Link className="text-brand-dark hover:underline" to={`/executions/${e.id}`}>{e.workflow_name}</Link></td>
                      <td><StatusBadge status={e.status} /></td><td>{formatDuration(e.duration_seconds)}</td><td>{formatDate(e.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Top failure reasons">
          {data.failure_reasons.length === 0 ? <Empty title="No failures" hint="Nothing has failed yet." /> : (
            <ul className="space-y-3 text-sm">
              {data.failure_reasons.map((f) => (
                <li key={f.reason} className="flex justify-between gap-3"><span className="text-slate-600">{f.reason}</span><span className="font-semibold">{f.count}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Runs per workflow" className="mt-4">
        <div className="h-60">
          <ResponsiveContainer>
            <BarChart data={data.workflow_performance} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="workflow" width={150} fontSize={12} />
              <Tooltip /><Bar dataKey="runs" name="Runs" fill="#5b5ff0" radius={[0, 4, 4, 0]} />
              <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
