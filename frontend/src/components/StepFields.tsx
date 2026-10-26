/** The settings form for each step type. The visual Builder shows it when a step is selected. */
import { useState } from "react";
import { useApi } from "../lib";
import type { DataCatalog } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cfg = Record<string, any>;
export interface EStep { id: string; type: string; name: string; retries: number; next: string; config: Cfg; pos?: { x: number; y: number } }

export const TYPES: { value: string; label: string; name: string }[] = [
  { value: "trigger", label: "Trigger (start)", name: "Start" },
  { value: "load_csv", label: "Load file (CSV or Excel)", name: "Load data" },
  { value: "validate", label: "Validate data", name: "Check data" },
  { value: "compare", label: "Compare two tables (reconcile)", name: "Match the two files" },
  { value: "condition", label: "Condition (if / else)", name: "Any problems?" },
  { value: "transform", label: "Clean data", name: "Clean data" },
  { value: "notify", label: "Notification (log only)", name: "Notify team" },
  { value: "report", label: "Generate report", name: "Generate report" },
  { value: "end", label: "End", name: "Done" },
];
export const DEFAULTS: Record<string, Cfg> = {
  trigger: { kind: "manual" }, load_csv: { file: "", source: "samples", table: "main" }, validate: { required_columns: [], numeric_columns: [], fail_on_errors: false },
  compare: { left: "", right: "", left_key: "", right_key: "", left_amount: "", right_amount: "", tolerance: 0.01 },
  condition: { field: "invalid_rows", op: ">", value: "0", on_true: "", on_false: "" },
  transform: { operations: ["trim_text", "drop_duplicates"], numeric_columns: [] }, notify: { to: "team", message: "" }, report: {}, end: {},
};
const FIELDS = [["invalid_rows", "Rows with empty cells"], ["missing_values", "Empty cells"], ["duplicate_rows", "Duplicate rows"],
  ["invalid_values", "Non-number values"], ["rows_loaded", "Rows loaded"], ["rows_after_cleaning", "Rows after cleaning"],
  ["values_fixed", "Values reformatted"], ["values_unreadable", "Values that could not be read"],
  ["exceptions", "Reconciliation exceptions"], ["matched_rows", "Rows that matched"], ["amount_mismatches", "Amount differences"],
  ["missing_in_right", "Missing in the second table"], ["missing_in_left", "Missing in the first table"],
  ["duplicate_keys", "Duplicate keys"], ["unreadable_amounts", "Unreadable amounts"]];
const OPS = [[">", "is more than"], [">=", "is at least"], ["<", "is less than"], ["<=", "is at most"], ["==", "equals"], ["!=", "does not equal"]];
const CLEAN = [["trim_text", "Trim extra spaces"], ["drop_duplicates", "Remove duplicate rows"], ["drop_missing", "Remove rows with empty cells"], ["drop_invalid_numbers", "Remove rows with non-number values"],
  ["normalize_amounts", "Turn amounts like \"SAR 1,234.50\" into numbers"], ["parse_dates", "Make dates one format (YYYY-MM-DD)"], ["standardize_text", "Tidy text: trim, single spaces, capitals"]];
const COLUMN_KEY: Record<string, [string, string, string]> = {
  drop_invalid_numbers: ["numeric_columns", "Number columns to check", "amount"],
  normalize_amounts: ["amount_columns", "Amount columns to convert", "amount, fee"],
  parse_dates: ["date_columns", "Date columns to convert", "due_date"],
  standardize_text: ["text_columns", "Text columns to tidy", "invoice_id, vendor"],
};
const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState((value ?? []).join(", "));
  return <input className={input} placeholder={placeholder} value={text}
    onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean)); }} />;
}

const TABLE_RE = /^[a-z][a-z0-9_]{0,30}$/;

/** Which loaded table a step works on. Empty means "the one loaded most recently". */
function TablePick({ c, upd, steps }: { c: Cfg; upd: (k: string, v: any) => void; steps: EStep[] }) {
  const names = [...new Set(steps.filter((s) => s.type === "load_csv").map((s) => s.config.table || "main"))];
  if (names.length < 2) return null;
  return <label className="block text-sm">Works on table
    <select className={input} value={c.table ?? ""} onChange={(e) => upd("table", e.target.value || undefined)}>
      <option value="">The table loaded most recently</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>;
}

function LoadFields({ c, upd, set }: { c: Cfg; upd: (k: string, v: any) => void; set: (c: Cfg) => void }) {
  const files = useApi<DataCatalog>("/datasources").data;
  const table = c.table || "main";
  const atRun = !!c.input;
  const all = [...(files?.samples ?? []), ...(files?.uploads ?? [])];
  const known = all.some((f) => f.source === (c.source ?? "samples") && f.name === c.file);
  const sheets = all.find((f) => f.source === (c.source ?? "samples") && f.name === c.file)?.sheets ?? [];
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={atRun}
        onChange={(e) => set(e.target.checked ? { table, input: table, ...(c.sheet ? { sheet: c.sheet } : {}) } : { file: "", source: "samples", table, ...(c.sheet ? { sheet: c.sheet } : {}) })} />
        Choose the file when the workflow runs</label>
      {!atRun && (
        <label className="block">File
          <select className={input} value={c.file ? `${c.source ?? "samples"}:${c.file}` : ""}
            onChange={(e) => { const [source, ...rest] = e.target.value.split(":"); set({ ...c, source, file: rest.join(":") }); }}>
            <option value="">Choose a file...</option>
            {c.file && !known && <option value={`${c.source ?? "samples"}:${c.file}`}>{c.file}</option>}
            <optgroup label="Sample files">{(files?.samples ?? []).map((f) => <option key={f.name} value={`samples:${f.name}`}>{f.name}</option>)}</optgroup>
            <optgroup label="Your uploads">{(files?.uploads ?? []).map((f) => <option key={f.name} value={`uploads:${f.name}`}>{f.original_name ?? f.name}</option>)}</optgroup>
          </select></label>
      )}
      <label className="block">Name of this table
        <input className={input} value={table} aria-invalid={!TABLE_RE.test(table)}
          onChange={(e) => { const t = e.target.value.toLowerCase(); set({ ...c, table: t, ...(atRun ? { input: t } : {}) }); }} />
        <span className="text-xs text-slate-500">Lowercase letters, numbers and underscore. Later steps use this name when a workflow loads more than one file.</span></label>
      <label className="block">Excel sheet (optional)
        <input className={input} list="sheet-names" placeholder="First sheet" value={c.sheet ?? ""} onChange={(e) => upd("sheet", e.target.value || undefined)} />
        <datalist id="sheet-names">{sheets.map((s) => <option key={s} value={s} />)}</datalist></label>
    </div>
  );
}

function CompareFields({ c, upd, steps }: { c: Cfg; upd: (k: string, v: any) => void; steps: EStep[] }) {
  const names = [...new Set(steps.filter((s) => s.type === "load_csv").map((s) => s.config.table || "main"))];
  const pick = (k: string, label: string) => (
    <label className="block">{label}
      <select className={input} value={c[k] ?? ""} onChange={(e) => upd(k, e.target.value)}>
        <option value="">Choose a table...</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>);
  const text = (k: string, label: string, ph: string) => (
    <label className="block">{label}<input className={input} placeholder={ph} value={c[k] ?? ""} onChange={(e) => upd(k, e.target.value)} /></label>);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">{pick("left", "First table")}{pick("right", "Second table")}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("left_key", "Matching column in the first table", "waybill")}{text("right_key", "Matching column in the second table", "reference")}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("left_amount", "Amount column in the first table (optional)", "cod_amount")}{text("right_amount", "Amount column in the second table (optional)", "amount")}</div>
      <label className="block">Allowed difference
        <input type="number" step="0.01" min="0" className={input} value={c.tolerance ?? 0.01} onChange={(e) => upd("tolerance", Number(e.target.value))} /></label>
      <p className="text-xs text-slate-500">Each row in the first table is matched to one row in the second by the matching column. Rows with no partner, duplicates and amounts that differ become exceptions with a reason. A table is created by a Load file step, so add those first.</p>
    </div>);
}

export function Fields({ step, steps, samples, set }: { step: EStep; steps: EStep[]; samples: string[]; set: (c: Cfg) => void }) {
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
        <option value="manual">Someone clicks Run</option><option value="upload">A file is uploaded</option><option value="schedule">On a schedule</option></select></label>;
    case "load_csv":
      return <LoadFields c={c} upd={upd} set={set} />;
    case "compare":
      return <CompareFields c={c} upd={upd} steps={steps} />;
    case "validate":
      return <div className="space-y-3 text-sm">
        <label className="block">Required columns<ListInput value={c.required_columns} onChange={(v) => upd("required_columns", v)} placeholder="invoice_id, vendor" /></label>
        <label className="block">Columns that must be numbers<ListInput value={c.numeric_columns} onChange={(v) => upd("numeric_columns", v)} placeholder="amount" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={c.fail_on_errors} onChange={(e) => upd("fail_on_errors", e.target.checked)} />
          Stop the run if any row has empty cells</label>
        <TablePick c={c} upd={upd} steps={steps} /></div>;
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
        {Object.entries(COLUMN_KEY).filter(([op]) => c.operations.includes(op)).map(([op, [key, label, ph]]) =>
          <label key={op} className="block">{label}<ListInput value={c[key] ?? []} onChange={(v) => upd(key, v)} placeholder={ph} /></label>)}
        {c.operations.includes("parse_dates") && <label className="flex items-center gap-2"><input type="checkbox" checked={c.dayfirst !== false}
          onChange={(e) => upd("dayfirst", e.target.checked)} />Day comes first in dates like 05/10/2026 (5 October)</label>}
        <TablePick c={c} upd={upd} steps={steps} /></div>;
    case "notify":
      return <div className="space-y-3 text-sm">
        <label className="block">Send to<input className={input} value={c.to} onChange={(e) => upd("to", e.target.value)} /></label>
        <label className="block">Message<input className={input} value={c.message} onChange={(e) => upd("message", e.target.value)} /></label>
        <p className="text-xs text-slate-500">In this version, notifications are written to the log only. Nothing is sent.</p></div>;
    case "report":
      return <div className="space-y-3 text-sm"><TablePick c={c} upd={upd} steps={steps} />
        <p className="text-xs text-slate-500">Writes a column summary, the cleaned data and an Excel workbook you can download from the run.</p></div>;
    default:
      return <p className="text-sm text-slate-500">No settings for this step.</p>;
  }
}
