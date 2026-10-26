import { Link, useParams } from "react-router-dom";
import { Card, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import FlowDiagram from "../components/FlowDiagram";
import { useEffect } from "react";
import { formatDate, formatDuration, inProgress, useApi } from "../lib";
import type { Execution, Workflow } from "../types";

function RunDiagram({ ex }: { ex: Execution }) {
  const { data } = useApi<Workflow>(`/workflows/${ex.workflow_id}`);
  if (!data?.definition) return null;
  const results = Object.fromEntries((ex.steps ?? []).map((s) => [s.step_id, s.status]));
  return (
    <Card title="Flow of this run" className="mb-4">
      <FlowDiagram steps={data.definition.steps} results={results} />
      <p className="mt-1 text-center text-xs text-slate-400">Drawn from the workflow as it is saved now.</p>
    </Card>
  );
}

export default function ExecutionDetail() {
  const { id } = useParams();
  const { data: ex, error, loading, reload } = useApi<Execution>(`/executions/${id}`);
  const waiting = !!ex && inProgress(ex.status);
  useEffect(() => {  // a run that is still waiting or running refreshes itself
    if (!waiting) return;
    const t = window.setInterval(reload, 1000);
    return () => window.clearInterval(t);
  }, [waiting, reload]);
  if (loading && !ex) return <Loading />;
  if (error || !ex) return <ErrorBox message={error ?? "Not found"} retry={reload} />;
  return (
    <>
      <Link to="/executions" className="mb-3 inline-block text-sm text-brand-dark hover:underline">Back to executions</Link>
      <PageHeader title={`Execution #${ex.id}`} subtitle={ex.workflow_name}><StatusBadge status={ex.status} /></PageHeader>
      {waiting && <p role="status" className="mb-4 rounded-lg bg-sun-soft px-4 py-2 text-sm text-sun-dark">{ex.status === "queued" ? "This run is waiting in the queue." : "This run is in progress."} The page updates by itself.</p>}
      {ex.is_demo && <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600">This is a seeded demo execution (fictional). Its step log is illustrative.</p>}
      <Card className="mb-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-slate-500">Started</dt><dd className="font-medium">{formatDate(ex.started_at)}</dd></div>
          <div><dt className="text-slate-500">Duration</dt><dd className="font-medium">{formatDuration(ex.duration_seconds)}</dd></div>
          <div><dt className="text-slate-500">Trigger</dt><dd className="font-medium">{ex.trigger_type}</dd></div>
          <div><dt className="text-slate-500">Steps run</dt><dd className="font-medium">{ex.steps?.length ?? 0}</dd></div>
        </dl>
        {ex.error_message && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{ex.error_message}</p>}
      </Card>
      {!!ex.inputs?.length && (
        <Card title="Files used in this run" className="mb-4">
          <ul className="space-y-1 text-sm">{ex.inputs.map((i) => <li key={i.name}><span className="font-medium">{i.name}:</span> {i.file} <span className="text-slate-500">({i.source === "samples" ? "sample file" : "your upload"})</span></li>)}</ul>
        </Card>
      )}
      {ex.status === "success" && ex.steps?.some((s) => s.step_type === "report" && s.status === "success") && (
        <Card title="Download" className="mb-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark" href={`/api/executions/${ex.id}/download/report`}>Excel report</a>
            <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/api/executions/${ex.id}/download/processed`}>Cleaned data (CSV)</a>
            <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/api/executions/${ex.id}/download/summary`}>Column summary (CSV)</a>
          </div>
        </Card>
      )}
      <RunDiagram ex={ex} />
      <Card title="Step log">
        <ol className="space-y-3">
          {ex.steps?.map((s) => (
            <li key={s.position} className="flex gap-3 text-sm">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${s.status === "success" ? "bg-emerald-500" : "bg-red-500"}`} />
              <div className="min-w-0">
                <p className="font-medium">{s.name} <span className="font-normal text-slate-400">{s.step_type} - {s.duration_ms} ms{s.attempts > 1 ? ` - ${s.attempts} attempts` : ""}</span></p>
                <p className="break-words text-slate-600">{s.message}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
