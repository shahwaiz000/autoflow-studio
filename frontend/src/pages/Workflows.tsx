import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHeader, StatusBadge } from "../components/ui";
import RunPanel from "../components/RunPanel";
import { api, useApi, waitForRun } from "../lib";
import type { Execution, RunInput, Workflow } from "../types";

function Steps({ id }: { id: number }) {
  const { data, error } = useApi<Workflow>(`/workflows/${id}`);
  if (error) return <p className="text-sm text-coral-dark">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading steps...</p>;
  return (
    <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
      {data.definition?.steps.map((s, i) => (
        <li key={s.id} className="flex gap-3"><span className="num w-5 text-slate-400">{i + 1}</span>
          <span className="font-medium text-navy-900">{s.name}</span><span className="text-slate-400">{s.type}</span></li>
      ))}
    </ol>
  );
}

export default function Workflows() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [erasing, setErasing] = useState<number | null>(null);
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

  async function remove(w: Workflow, withHistory = false) {
    if (!withHistory && (w.run_count ?? 0) > 0) { setErasing(w.id); return; }  // runs would be erased too, so ask clearly first
    if (!withHistory && !window.confirm(`Delete "${w.name}"? This cannot be undone.`)) return;
    try {
      const r = await api<{ runs_deleted?: number }>(`/workflows/${w.id}${withHistory ? "?with_history=true" : ""}`, { method: "DELETE" });
      setResult({ ok: true, text: `${w.name} was deleted${r.runs_deleted ? ` with ${r.runs_deleted} runs` : ""}` });
      setErasing(null); reload();
    } catch (e) { setResult({ ok: false, text: (e as Error).message }); setErasing(null); }
  }

  return (
    <>
      <PageHeader title="Reconciliations" subtitle="Each one is a saved workflow. Run it on the files you choose, or start from the COD Reconciliation template.">
        <div className="flex flex-wrap gap-2">
          <Link to="/templates" className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-dark">Start from a template</Link>
          <Link to="/builder" className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-navy-900 shadow-card transition-colors hover:bg-slate-50">Build your own</Link>
          <input aria-label="Search workflows" placeholder="Search workflows" value={search} onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border-0 bg-white px-3 py-2 text-sm shadow-card transition-shadow focus:shadow-lift" />
          <select aria-label="Filter by status" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border-0 bg-white px-3 py-2 text-sm shadow-card transition-shadow focus:shadow-lift">
            <option value="">All</option><option value="true">Enabled</option><option value="false">Disabled</option>
          </select>
        </div>
      </PageHeader>
      {result && (
        <p role="status" className={`mb-5 rounded-xl px-4 py-3 text-sm ${result.ok ? "bg-mint-soft text-mint-dark" : "bg-coral-soft text-coral-dark"}`}>
          {result.text} {result.id && <Link className="ml-2 font-medium underline" to={`/executions/${result.id}`}>View logs</Link>}
        </p>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} retry={reload} /> : !data?.length ? (
        <Card><Empty title="No workflows match" hint="Clear the search or filter." /></Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {data.map((w) => (
            <Card key={w.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-navy-900">{w.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{w.category} - {w.step_count} steps - {w.run_count} runs</p>
                </div>
                {w.last_status && <StatusBadge status={w.last_status} />}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{w.description}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button onClick={() => (w.inputs?.length ? setChoosing(choosing === w.id ? null : w.id) : run(w))} disabled={!w.enabled || busy === w.id}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
                  {busy === w.id ? "Running..." : "Run workflow"}
                </button>
                <button onClick={() => toggle(w)} className="rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-navy-900">{w.enabled ? "Disable" : "Enable"}</button>
                <Link to={`/builder/${w.id}`} className="rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-navy-900">Edit</Link>
                {!w.built_in && <button onClick={() => remove(w)} className="rounded-lg px-3 py-2 text-sm text-coral-dark transition-colors hover:bg-coral-soft">Delete</button>}
                <button onClick={() => setOpen(open === w.id ? null : w.id)} aria-expanded={open === w.id} className="ml-auto text-sm text-brand-dark hover:underline">
                  {open === w.id ? "Hide steps" : "View steps"}
                </button>
              </div>
              {erasing === w.id && (
                <div role="alertdialog" aria-label={`Delete ${w.name} with its history`} className="mt-4 rounded-xl bg-coral-soft p-4 text-sm text-coral-dark">
                  <p><b>{w.name}</b> has {w.run_count} runs. Deleting it erases the workflow, its schedules and all {w.run_count} runs with their reports. This cannot be undone.</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => remove(w, true)} className="rounded-lg bg-coral px-3 py-1.5 font-medium text-white transition-colors hover:bg-coral-dark">Delete with its history</button>
                    <button onClick={() => setErasing(null)} className="rounded-lg bg-white px-3 py-1.5 text-navy-900 shadow-card transition-colors hover:bg-slate-50">Keep it</button>
                  </div>
                </div>
              )}
              {choosing === w.id && w.inputs && <RunPanel inputs={w.inputs} onRun={(chosen) => run(w, chosen)} onCancel={() => setChoosing(null)} />}
              {open === w.id && <Steps id={w.id} />}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
