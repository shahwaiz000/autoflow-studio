import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import { formatDate, formatDuration, useApi } from "../lib";
import type { Execution } from "../types";

export default function Executions() {
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi<Execution[]>(`/executions?limit=100${status ? `&status=${status}` : ""}`);
  return (
    <>
      <PageHeader title="Executions" subtitle="Every workflow run, newest first.">
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">All statuses</option><option value="success">Successful</option><option value="failed">Failed</option><option value="running">Running</option>
        </select>
      </PageHeader>
      <Card>
        {loading && !data ? <Loading /> : error ? <ErrorBox message={error} retry={reload} /> : !data?.length ? (
          <Empty title="No executions found" hint="Run a workflow, or change the status filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr>
                {["ID", "Workflow", "Status", "Trigger", "Started", "Duration", ""].map((h) => <th key={h} className="pb-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-2.5 text-slate-500">#{e.id}</td>
                    <td className="font-medium">{e.workflow_name}</td>
                    <td><StatusBadge status={e.status} /></td><td>{e.trigger_type}</td><td>{formatDate(e.started_at)}</td><td>{formatDuration(e.duration_seconds)}</td>
                    <td><Link className="text-brand-dark hover:underline" to={`/executions/${e.id}`}>Details</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
