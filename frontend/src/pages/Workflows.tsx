import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import RunPanel from "../components/RunPanel";
import { api, useApi, waitForRun } from "../lib";
import type { Execution, RunInput, Workflow } from "../types";

function Steps({ id }: { id: number }) {
  const { data, error } = useApi<Workflow>(`/workflows/${id}`);
  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading steps...</p>;
  return (
    <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
      {data.definition?.steps.map((s, i) => (
        <li key={s.id} className="flex gap-3"><span className="w-5 text-slate-400">{i + 1}</span>
          <span className="font-medium">{s.name}</span><span className="text-slate-400">{s.type}</span></li>
      ))}
    </ol>
  );
}

export default function Workflows() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; id?: number } | null>(null);
  const qs = new URLSearchParams({ search, ...(filter ? { enabled: filter } : {}) }).toString();
  const { data, error, loading, reload } = useApi<Workflow[]>(`/workflows?${qs}`);

  async function run(w: Workflow, inputs?: Record<string, Pick<RunInput, "source" | "file">>) {
    setBusy(w.id); setResult(null); setChoosing(null);
    try {
      // The run goes to the background queue, so the page never freezes; we then watch it until it ends.
      const queued = await api<Execution>(`/workflows/${w.id}/run?background=true`, { method: "POST", ...(inputs ? { body: JSON.stringify({ inputs }) } : {}) });
      setResult({ ok: true, id: queued.id, text: `${w.name} is waiting in the queue` });
      const ex = await waitForRun(queued.id, (e) => {
        if (e.status === "running") setResult({ ok: true, id: e.id, text: `${w.name} is running` });
      });
      setResult({ ok: ex.status === "success", id: ex.id, text: `${w.name} ${ex.status}${ex.error_message ? `: ${ex.error_message}` : ""}` });
      reload();
    } catch (e) { setResult({ ok: false, text: (e as Error).message }); }
    setBusy(null);
  }
  async function toggle(w: Workflow) {
    try { await api(`/workflows/${w.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !w.enabled }) }); reload(); }
    catch (e) { setResult({ ok: false, text: (e as Error).message }); }
  }

  async function remove(w: Workflow) {
    if (!window.confirm(`Delete "${w.name}"? This cannot be undone.`)) return;
    try { await api(`/workflows/${w.id}`, { method: "DELETE" }); setResult({ ok: true, text: `${w.name} was deleted` }); reload(); }
    catch (e) { setResult({ ok: false, text: (e as Error).message }); }
  }

  return (
    <>
      <PageHeader title="Workflows" subtitle="Run a workflow to execute it on the backend and record the result.">
        <div className="flex flex-wrap gap-2">
          <Link to="/builder" className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark">Create workflow</Link>
          <input aria-label="Search workflows" placeholder="Search workflows" value={search} onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">All</option><option value="true">Enabled</option><option value="false">Disabled</option>
          </select>
        </div>
      </PageHeader>
      {result && (
        <p role="status" className={`mb-4 rounded-lg px-4 py-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {result.text} {result.id && <Link className="ml-2 font-medium underline" to={`/executions/${result.id}`}>View logs</Link>}
        </p>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} retry={reload} /> : !data?.length ? (
        <Card><Empty title="No workflows match" hint="Clear the search or filter." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((w) => (
            <Card key={w.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{w.name}</h2>
                  <p className="text-xs text-slate-500">{w.category} - {w.step_count} steps - {w.run_count} runs</p>
                </div>
                {w.last_status && <StatusBadge status={w.last_status} />}
              </div>
              <p className="mt-2 text-sm text-slate-600">{w.description}</p>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => (w.inputs?.length ? setChoosing(choosing === w.id ? null : w.id) : run(w))} disabled={!w.enabled || busy === w.id}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
                  {busy === w.id ? "Running..." : "Run workflow"}
                </button>
                <button onClick={() => toggle(w)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">{w.enabled ? "Disable" : "Enable"}</button>
                <Link to={`/builder/${w.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Edit</Link>
                {!w.built_in && <button onClick={() => remove(w)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Delete</button>}
                <button onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id} className="ml-auto text-sm text-brand-dark hover:underline">
                  {open === w.id ? "Hide steps" : "View steps"}
                </button>
              </div>
              {choosing === w.id && w.inputs && <RunPanel inputs={w.inputs} onRun={(chosen) => run(w, chosen)} onCancel={() => setChoosing(null)} />}
              {open === w.id && <Steps id={w.id} />}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
