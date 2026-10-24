import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Card, ErrorBox, Loading, PageHeader } from "../components/ui";
import { api, useApi } from "../lib";
import type { Workflow } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cfg = Record<string, any>;
export interface EStep { id: string; type: string; name: string; retries: number; next: string; config: Cfg }

export const TYPES: { value: string; label: string; name: string }[] = [
  { value: "trigger", label: "Trigger (start)", name: "Start" },
  { value: "load_csv", label: "Load CSV file", name: "Load data" },
  { value: "validate", label: "Validate data", name: "Check data" },
  { value: "condition", label: "Condition (if / else)", name: "Any problems?" },
  { value: "transform", label: "Clean data", name: "Clean data" },
  { value: "notify", label: "Notification (log only)", name: "Notify team" },
  { value: "report", label: "Generate report", name: "Generate report" },
  { value: "end", label: "End", name: "Done" },
];
const DEFAULTS: Record<string, Cfg> = {
  trigger: { kind: "manual" }, load_csv: { file: "" }, validate: { required_columns: [], numeric_columns: [], fail_on_errors: false },
  condition: { field: "invalid_rows", op: ">", value: "0", on_true: "", on_false: "" },
  transform: { operations: ["trim_text", "drop_duplicates"], numeric_columns: [] }, notify: { to: "team", message: "" }, report: {}, end: {},
};
const FIELDS = [["invalid_rows", "Rows with empty cells"], ["missing_values", "Empty cells"], ["duplicate_rows", "Duplicate rows"],
  ["invalid_values", "Non-number values"], ["rows_loaded", "Rows loaded"], ["rows_after_cleaning", "Rows after cleaning"]];
const OPS = [[">", "is more than"], [">=", "is at least"], ["<", "is less than"], ["<=", "is at most"], ["==", "equals"], ["!=", "does not equal"]];
const CLEAN = [["trim_text", "Trim extra spaces"], ["drop_duplicates", "Remove duplicate rows"], ["drop_missing", "Remove rows with empty cells"], ["drop_invalid_numbers", "Remove rows with non-number values"]];
const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join(", "));
  return <input className={input} placeholder={placeholder} value={text}
    onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean)); }} />;
}

function Fields({ step, steps, samples, set }: { step: EStep; steps: EStep[]; samples: string[]; set: (c: Cfg) => void }) {
  const c = step.config;
  const upd = (k: string, v: any) => set({ ...c, [k]: v });
  const targets = steps.filter((s) => s.id !== step.id);
  const Targets = ({ k }: { k: string }) => (
    <select className={input} value={c[k]} onChange={(e) => upd(k, e.target.value)}>
      <option value="">Choose a step...</option>
      {targets.map((s) => <option key={s.id} value={s.id}>{steps.indexOf(s) + 1}. {s.name || s.type}</option>)}
    </select>
  );
  switch (step.type) {
    case "trigger":
      return <label className="block text-sm">Starts when<select className={input} value={c.kind} onChange={(e) => upd("kind", e.target.value)}>
        <option value="manual">Someone clicks Run</option><option value="upload">A file is uploaded</option></select></label>;
    case "load_csv":
      return <label className="block text-sm">Sample file
        <select className={input} value={c.file} onChange={(e) => upd("file", e.target.value)}>
          <option value="">Choose a file...</option>{samples.map((f) => <option key={f}>{f}</option>)}</select></label>;
    case "validate":
      return <div className="space-y-3 text-sm">
        <label className="block">Required columns<ListInput value={c.required_columns} onChange={(v) => upd("required_columns", v)} placeholder="invoice_id, vendor" /></label>
        <label className="block">Columns that must be numbers<ListInput value={c.numeric_columns} onChange={(v) => upd("numeric_columns", v)} placeholder="amount" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.fail_on_errors} onChange={(e) => upd("fail_on_errors", e.target.checked)} />
          Stop the run if any row has empty cells</label></div>;
    case "condition":
      return <div className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          <select aria-label="Value to check" className={input} value={c.field} onChange={(e) => upd("field", e.target.value)}>{FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select aria-label="Comparison" className={input} value={c.op} onChange={(e) => upd("op", e.target.value)}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <input aria-label="Number" type="number" className={input} value={c.value} onChange={(e) => upd("value", e.target.value)} />
        </div>
        <label className="block">If true, go to<Targets k="on_true" /></label>
        <label className="block">If false, go to<Targets k="on_false" /></label></div>;
    case "transform":
      return <div className="space-y-2 text-sm">
        {CLEAN.map(([v, l]) => <label key={v} className="flex items-center gap-2"><input type="checkbox" checked={c.operations.includes(v)}
          onChange={(e) => upd("operations", e.target.checked ? [...c.operations, v] : c.operations.filter((o: string) => o !== v))} />{l}</label>)}
        {c.operations.includes("drop_invalid_numbers") && <label className="block">Number columns to check
          <ListInput value={c.numeric_columns} onChange={(v) => upd("numeric_columns", v)} placeholder="amount" /></label>}</div>;
    case "notify":
      return <div className="space-y-3 text-sm">
        <label className="block">Send to<input className={input} value={c.to} onChange={(e) => upd("to", e.target.value)} /></label>
        <label className="block">Message<input className={input} value={c.message} onChange={(e) => upd("message", e.target.value)} /></label>
        <p className="text-xs text-slate-500">In this version, notifications are written to the log only. Nothing is sent.</p></div>;
    default:
      return <p className="text-sm text-slate-500">No settings for this step.</p>;
  }
}

export default function WorkflowEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const samples = useApi<string[]>("/samples");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [steps, setSteps] = useState<EStep[]>(id ? [] : [
    { id: "s1", type: "trigger", name: "Start", retries: 0, next: "", config: { ...DEFAULTS.trigger } },
    { id: "s2", type: "end", name: "Done", retries: 0, next: "", config: {} }]);
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [builtIn, setBuiltIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState("load_csv");

  useEffect(() => {
    if (!id) return;
    api<Workflow>(`/workflows/${id}`).then((w) => {
      setName(w.name); setDescription(w.description); setCategory(w.category); setBuiltIn(!!w.built_in);
      setSteps((w.definition?.steps ?? []).map((s) => ({ id: s.id, type: s.type, name: s.name, retries: s.retries ?? 0, next: s.next ?? "", config: { ...s.config } })));
    }).catch((e: Error) => setLoadError(e.message)).finally(() => setLoading(false));
  }, [id]);

  const patch = (i: number, p: Partial<EStep>) => setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => setSteps((all) => {
    const j = i + d; if (j < 0 || j >= all.length) return all;
    const copy = [...all]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });
  const remove = (i: number) => setSteps((all) => {
    const gone = all[i].id;
    return all.filter((_, j) => j !== i).map((s) => ({ ...s, next: s.next === gone ? "" : s.next,
      config: { ...s.config, ...(s.config.on_true === gone ? { on_true: "" } : {}), ...(s.config.on_false === gone ? { on_false: "" } : {}) } }));
  });
  function add() {
    const n = Math.max(0, ...steps.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0))) + 1;
    const t = TYPES.find((x) => x.value === newType)!;
    setSteps([...steps, { id: `s${n}`, type: newType, name: t.name, retries: 0, next: "", config: JSON.parse(JSON.stringify(DEFAULTS[newType])) }]);
  }

  async function save() {
    setSaving(true); setError(null);
    const payload = { name, description, category, steps: steps.map((s) => ({
      id: s.id, type: s.type, name: s.name, retries: s.retries, ...(s.next && s.type !== "end" ? { next: s.next } : {}),
      config: s.type === "condition" ? { ...s.config, value: s.config.value === "" ? "" : Number(s.config.value) } : s.config })) };
    try {
      await api(id ? `/workflows/${id}` : "/workflows", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
      nav("/workflows");
    } catch (e) { setError((e as Error).message); }
    setSaving(false);
  }

  if (loading) return <Loading />;
  if (loadError) return <ErrorBox message={loadError} />;
  return (
    <>
      <Link to="/workflows" className="mb-3 inline-block text-sm text-brand-dark hover:underline">Back to workflows</Link>
      <PageHeader title={id ? "Edit workflow" : "Create workflow"} subtitle="Steps run from top to bottom. Use a Condition step to branch.">
        <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">{saving ? "Saving..." : "Save workflow"}</button>
      </PageHeader>
      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      <Card title="Details" className="mb-4">
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <label>Name<input className={input} value={name} disabled={builtIn} maxLength={120} onChange={(e) => setName(e.target.value)} />
            {builtIn && <span className="text-xs text-slate-500">Built-in names cannot be changed.</span>}</label>
          <label>Category<input className={input} value={category} maxLength={60} onChange={(e) => setCategory(e.target.value)} /></label>
          <label className="sm:col-span-3">Description<input className={input} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
      </Card>
      <div className="space-y-3">
        {steps.map((s, i) => (
          <Card key={s.id}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-dark">{i + 1}</span>
              <input aria-label={`Step ${i + 1} name`} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium" value={s.name} maxLength={120} onChange={(e) => patch(i, { name: e.target.value })} />
              <select aria-label={`Step ${i + 1} type`} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" value={s.type}
                onChange={(e) => patch(i, { type: e.target.value, config: JSON.parse(JSON.stringify(DEFAULTS[e.target.value])), next: "" })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
              <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded border px-2 py-1 text-sm disabled:opacity-30">Up</button>
              <button aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)} className="rounded border px-2 py-1 text-sm disabled:opacity-30">Down</button>
              <button onClick={() => remove(i)} className="rounded border border-red-200 px-2 py-1 text-sm text-red-700 hover:bg-red-50">Remove</button>
            </div>
            <Fields step={s} steps={steps} samples={samples.data ?? []} set={(config) => patch(i, { config })} />
            {!["trigger", "end", "condition"].includes(s.type) && (
              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2">
                <label>Try again if it fails
                  <select className={input} value={s.retries} onChange={(e) => patch(i, { retries: Number(e.target.value) })}>
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? "No retries" : `${n} ${n === 1 ? "retry" : "retries"}`}</option>)}</select></label>
                <label>After this step, go to
                  <select className={input} value={s.next} onChange={(e) => patch(i, { next: e.target.value })}>
                    <option value="">The next step in the list</option>
                    {steps.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{steps.indexOf(x) + 1}. {x.name || x.type}</option>)}</select></label>
              </div>)}
          </Card>))}
      </div>
      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Add a step:</span>
          <select aria-label="Step type to add" className="rounded-lg border border-slate-300 px-3 py-2" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          <button onClick={add} className="rounded-lg border border-brand px-3 py-2 font-medium text-brand-dark hover:bg-brand-soft">Add step</button>
        </div>
      </Card>
    </>
  );
}
