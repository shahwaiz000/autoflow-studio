import { useState } from "react";
import { useNavigate } from "react-router-dom";
import FlowDiagram from "../components/FlowDiagram";
import { Card, ErrorBox, Loading, PageHeader } from "../components/ui";
import { api, useApi } from "../lib";
import type { Template, Workflow } from "../types";

export default function Templates() {
  const { data, error, loading, reload } = useApi<Template[]>("/templates");
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function use(t: Template) {
    setBusy(t.key); setProblem(null);
    try {
      const wf = await api<Workflow>(`/templates/${t.key}/use`, { method: "POST" });
      nav(`/builder/${wf.id}`);  // open the new copy so it can be changed right away
    } catch (e) { setProblem((e as Error).message); }
    setBusy(null);
  }

  return (
    <>
      <PageHeader title="Templates" subtitle="Start from a ready-made workflow. Using a template makes your own copy that you can edit and run." />
      {problem && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{problem}</p>}
      {loading && !data ? <Loading /> : error || !data ? <ErrorBox message={error ?? "No data"} retry={reload} /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((t) => (
            <Card key={t.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{t.name}</h2>
                  <p className="text-xs text-slate-500">{t.category} - {t.step_count} steps</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {t.tags.map((g) => <span key={g} className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-dark">{g}</span>)}
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-600">{t.description}</p>
              <p className="mt-1 text-xs text-slate-500">{t.note}</p>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => use(t)} disabled={busy === t.key}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
                  {busy === t.key ? "Creating..." : "Use template"}
                </button>
                <button onClick={() => setOpen(open === t.key ? null : t.key)} aria-expanded={open === t.key}
                  className="ml-auto text-sm text-brand-dark hover:underline">{open === t.key ? "Hide flow" : "Preview flow"}</button>
              </div>
              {open === t.key && <div className="mt-4 border-t border-slate-100 pt-4"><FlowDiagram steps={t.steps} /></div>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
