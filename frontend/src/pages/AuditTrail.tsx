import { Link, useSearchParams } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { formatDate, useApi } from "../lib";
import type { AuditList } from "../types";

const LABEL: Record<string, string> = { approved: "Approved", rejected: "Rejected", reopened: "Reopened" };
const TONE: Record<string, string> = { approved: "bg-emerald-50 text-emerald-700", rejected: "bg-red-50 text-red-700", reopened: "bg-slate-100 text-slate-700" };

export default function AuditTrail() {
  const [params] = useSearchParams();
  const run = params.get("run");
  const { data, error, loading, reload } = useApi<AuditList>(`/audit?limit=200${run ? `&execution_id=${encodeURIComponent(run)}` : ""}`);
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Who decided what, and when. Entries are added automatically and cannot be edited or deleted from the app.">
        {run && <Link to="/audit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">Show all runs</Link>}
      </PageHeader>
      {run && <p className="mb-3 text-sm text-slate-600">Showing decisions for run #{run}. <Link className="font-medium text-brand-dark hover:underline" to={`/executions/${run}`}>Back to the run</Link></p>}
      <Card>
        {loading && !data ? <Loading /> : error || !data ? <ErrorBox message={error ?? "No data"} retry={reload} /> : data.items.length === 0 ? (
          <Empty title="No decisions yet" hint="When you approve or reject an exception on a run page, it is recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">When</th><th className="pr-3">Who</th><th className="pr-3">Action</th><th className="pr-3">Run</th><th className="pr-3">Key</th><th>Detail</th></tr></thead>
              <tbody>{data.items.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatDate(e.at)}</td>
                  <td className="pr-3">{e.actor}</td>
                  <td className="pr-3"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${TONE[e.action] ?? ""}`}>{LABEL[e.action] ?? e.action}</span></td>
                  <td className="pr-3">{e.execution_id ? <Link className="text-brand-dark hover:underline" to={`/executions/${e.execution_id}`}>#{e.execution_id}</Link> : "-"}</td>
                  <td className="pr-3 font-mono text-xs">{e.key || "-"}</td>
                  <td className="text-slate-600">{e.detail}</td>
                </tr>))}</tbody>
            </table>
            {data.total > data.items.length && <p className="mt-2 text-xs text-slate-500">Showing the latest {data.items.length} of {data.total}.</p>}
          </div>
        )}
      </Card>
    </>
  );
}
