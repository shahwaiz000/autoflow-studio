import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FlowDiagram, { COLORS } from "../components/FlowDiagram";
import { Icon } from "../components/icons";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { api, useApi } from "../lib";
import type { AssistantInfo, Execution, Explanation, FailureInsights, Proposal, Workflow } from "../types";

const EXAMPLES = [
  "Check invoices and alert finance if any are incomplete",
  "Stop the run if any new hire record is incomplete",
  "Clean the customer list: remove duplicates and extra spaces",
  "Summarize the sales orders and check that revenue is numeric",
];
const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const primary = "inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

/* ---------- Tab 1: build a workflow from a sentence ---------- */

function Build() {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [p, setP] = useState<Proposal | null>(null);
  const [name, setName] = useState("");
  const [ran, setRan] = useState<{ ok: boolean; text: string; run: number; wf: number } | null>(null);

  async function suggest() {
    setBusy(true); setProblem(null); setP(null); setRan(null);
    try {
      const r = await api<Proposal>("/assistant/propose", { method: "POST", body: JSON.stringify({ request: text }) });
      setP(r); setName(r.name ?? "");
    } catch (e) { setProblem((e as Error).message); }
    setBusy(false);
  }

  async function save(runNow: boolean) {
    if (!p) return;
    setSaving(true); setProblem(null);
    try {
      const wf = await api<Workflow>("/workflows", { method: "POST", body: JSON.stringify({ name, description: p.description, category: p.category, steps: p.steps }) });
      if (!runNow) { nav(`/builder/${wf.id}`); return; }
      const ex = await api<Execution>(`/workflows/${wf.id}/run`, { method: "POST" });
      setRan({ ok: ex.status === "success", run: ex.id, wf: wf.id, text: `${wf.name} ${ex.status}${ex.error_message ? `: ${ex.error_message}` : ""}` });
    } catch (e) { setProblem((e as Error).message); }
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <Card title="Describe what you want">
        <label htmlFor="ask" className="sr-only">Describe the workflow you want</label>
        <textarea id="ask" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3}
          placeholder="For example: Check invoices and alert finance if any are incomplete" className={field} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={suggest} disabled={busy || text.trim().length < 3} className={primary}>
            <Icon name="sparkles" className="h-4 w-4" /> {busy ? "Thinking..." : "Suggest a workflow"}
          </button>
          <span className="text-xs text-slate-500">{text.length}/500</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Examples">
          {EXAMPLES.map((x) => (
            <button key={x} onClick={() => setText(x)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:border-brand hover:text-brand-dark">{x}</button>
          ))}
        </div>
      </Card>

      {problem && <p role="alert" className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-dark">{problem}</p>}
      {p?.status === "needs_detail" && <p role="status" className="rounded-xl bg-sun-soft px-4 py-3 text-sm text-sun-dark">{p.message}</p>}
      {ran && (
        <p role="status" className={`flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm ${ran.ok ? "bg-mint-soft text-mint-dark" : "bg-coral-soft text-coral-dark"}`}>
          {ran.text}
          <Link className="font-medium underline" to={`/executions/${ran.run}`}>View logs</Link>
          <Link className="font-medium underline" to={`/builder/${ran.wf}`}>Open in builder</Link>
        </p>
      )}

      {p?.status === "ok" && (
        <Card title="Proposed workflow">
          <label className="block text-sm font-medium text-slate-700">Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} />
          </label>
          <p className="mt-2 text-sm text-slate-600">{p.description}</p>
          {p.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-xl bg-sun-soft px-4 py-3 text-sm text-sun-dark" aria-label="Things to know">
              {p.warnings.map((w) => <li key={w} className="flex gap-2"><Icon name="alert" className="mt-0.5 h-4 w-4" />{w}</li>)}
            </ul>
          )}
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3"><FlowDiagram steps={p.steps} /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Why these steps</h3>
              <ol className="mt-2 space-y-2 text-sm">
                {p.reasons.map((r, i) => (
                  <li key={i}><span className="font-medium text-slate-900">{r.step}.</span> <span className="text-slate-600">{r.why}</span></li>
                ))}
              </ol>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            <button onClick={() => save(false)} disabled={saving || !name.trim()} className={primary}>Save and open in builder</button>
            <button onClick={() => save(true)} disabled={saving || !name.trim()} className={secondary}>
              <Icon name="play" className="h-4 w-4" /> Save and run now
            </button>
            <span className="text-xs text-slate-500">Nothing is saved until you click one of these.</span>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------- Tab 2: explain a workflow ---------- */

function ExplainPanel({ id }: { id: number }) {
  const { data, error, loading, reload } = useApi<Explanation>(`/assistant/explain/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "No data"} retry={reload} />;
  const h = data.history;
  return (
    <div className="space-y-4">
      <Card title="In plain words" action={<Link to={`/builder/${data.workflow_id}`} className="text-sm font-medium text-brand-dark hover:underline">Open in builder</Link>}>
        <p className="text-sm text-slate-700">{data.summary}</p>
        <p className="num mt-2 text-xs text-slate-500">
          {h.runs === 0 ? "No finished runs yet." : `${h.runs} finished runs, ${h.failed} failed${h.success_rate !== null ? ` (${h.success_rate}% successful)` : ""}.`}
        </p>
        <ol className="mt-4 space-y-3">
          {data.steps.map((s, i) => (
            <li key={s.id} className="flex gap-3 text-sm">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-slate-800"
                style={{ background: COLORS[s.type]?.[0], border: `1.5px solid ${COLORS[s.type]?.[1]}` }}>{i + 1}</span>
              <div><p className="font-medium text-slate-900">{s.name} <span className="font-normal text-slate-500">({COLORS[s.type]?.[2] ?? s.type})</span></p>
                <p className="text-slate-600">{s.text}</p></div>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Ideas to improve it">
        {data.suggestions.length === 0 ? <p className="text-sm text-slate-600">Nothing to suggest. This workflow covers the basics.</p> : (
          <ul className="space-y-2 text-sm text-slate-700">
            {data.suggestions.map((s) => <li key={s} className="flex gap-2"><Icon name="bolt" className="mt-0.5 h-4 w-4 text-brand" />{s}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Explain() {
  const list = useApi<Workflow[]>("/workflows");
  const [id, setId] = useState<number | null>(null);
  if (list.loading && !list.data) return <Loading />;
  if (list.error || !list.data) return <ErrorBox message={list.error ?? "No data"} retry={list.reload} />;
  return (
    <div className="space-y-4">
      <Card title="Choose a workflow">
        <label htmlFor="wf" className="sr-only">Workflow to explain</label>
        <select id="wf" value={id ?? ""} onChange={(e) => setId(e.target.value ? Number(e.target.value) : null)} className={field}>
          <option value="">Select a workflow...</option>
          {list.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </Card>
      {id !== null && <ExplainPanel key={id} id={id} />}
    </div>
  );
}

/* ---------- Tab 3: failure insights ---------- */

function Failures() {
  const [source, setSource] = useState("all");
  const [days, setDays] = useState(14);
  const { data, error, loading, reload } = useApi<FailureInsights>(`/assistant/failures?days=${days}&source=${source}`);
  return (
    <div className="space-y-4">
      <Card title="Why are runs failing?" action={
        <div className="flex gap-2">
          <select aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select>
          <select aria-label="Which runs" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            <option value="all">All runs</option><option value="live">My runs</option><option value="demo">Demo runs</option>
          </select>
        </div>}>
        {loading && !data ? <Loading /> : error || !data ? <ErrorBox message={error ?? "No data"} retry={reload} /> : (
          <p className="text-sm font-medium text-slate-800">{data.headline}</p>
        )}
      </Card>
      {data && data.items.length === 0 && <Card><Empty title="Nothing to fix" hint="No runs failed in this range." /></Card>}
      {data?.items.map((i) => (
        <Card key={i.reason}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-medium text-slate-900">{i.reason}</h3>
            <span className="num rounded-full bg-coral-soft px-2.5 py-0.5 text-xs font-semibold text-coral-dark">{i.count} {i.count === 1 ? "run" : "runs"}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Seen in: {i.workflows.join(", ")}</p>
          <p className="mt-3 flex gap-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-slate-800"><Icon name="bolt" className="mt-0.5 h-4 w-4 text-brand" />{i.advice}</p>
          {i.example_execution_id && <Link to={`/executions/${i.example_execution_id}`} className="mt-3 inline-block text-sm font-medium text-brand-dark hover:underline">See an example run</Link>}
        </Card>
      ))}
    </div>
  );
}

/* ---------- Page ---------- */

const TABS = [["build", "Build a workflow"], ["explain", "Explain a workflow"], ["failures", "Failure insights"]] as const;

export default function Assistant() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("build");
  const info = useApi<AssistantInfo>("/assistant/info");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Assistant" subtitle="Describe a workflow in plain English, understand an existing one, or find out why runs fail." />
      <div className="mb-5 rounded-xl border border-brand/15 bg-brand-soft px-4 py-3 text-sm text-slate-700">
        <p><span className="mr-2 rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">Rules-based</span>
          This assistant follows keyword rules. It is <strong>not an AI language model</strong>. It is free and works offline.</p>
        {info.data && (
          <details className="mt-2">
            <summary className="cursor-pointer text-brand-dark">What it can and cannot do</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">{info.data.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="mt-2 text-slate-600">Data it knows: {info.data.datasets.map((d) => `${d.label} (${d.file})`).join(", ")}.</p>
          </details>
        )}
      </div>
      <div role="tablist" aria-label="Assistant tools" className="mb-5 flex gap-1 rounded-xl bg-slate-200/60 p-1">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "build" && <Build />}
      {tab === "explain" && <Explain />}
      {tab === "failures" && <Failures />}
    </div>
  );
}
