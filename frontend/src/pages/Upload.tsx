import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Card, PageHeader, StatusBadge } from "../components/ui";
import { uploadCsv } from "../lib";
import type { UploadResult } from "../types";

const Tile = ({ label, value }: { label: string; value: number | undefined }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="text-xl font-semibold text-slate-900">{value ?? "-"}</p>
  </div>
);

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [required, setRequired] = useState("");
  const [numeric, setNumeric] = useState("");
  const [missing, setMissing] = useState("remove");
  const [badNumbers, setBadNumbers] = useState("remove");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(null); setResult(null);
    const form = new FormData();
    form.append("file", file);
    form.append("required_columns", required);
    form.append("numeric_columns", numeric);
    form.append("missing_values", missing);
    form.append("invalid_numbers", badNumbers);
    try { setResult(await uploadCsv<UploadResult>(form)); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  const m = result?.metrics;
  return (
    <>
      <PageHeader title="Upload CSV" subtitle="Check a CSV file for problems, clean it, and download the result. Use fictional data only." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="1. Choose a file" className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-4 text-sm">
            <label className="block">CSV file (max 5 MB)
              <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={field} />
            </label>
            <label className="block">Required columns (optional)
              <input value={required} onChange={(e) => setRequired(e.target.value)} placeholder="invoice_id, vendor, amount" className={field} />
              <span className="text-xs text-slate-500">Separate with commas. The run fails if one is missing.</span>
            </label>
            <label className="block">Columns that must be numbers (optional)
              <input value={numeric} onChange={(e) => setNumeric(e.target.value)} placeholder="amount" className={field} />
            </label>
            <label className="block">Rows with empty cells
              <select value={missing} onChange={(e) => setMissing(e.target.value)} className={field}>
                <option value="remove">Remove them</option><option value="keep">Keep them</option>
              </select>
            </label>
            <label className="block">Rows with non-number values
              <select value={badNumbers} onChange={(e) => setBadNumbers(e.target.value)} className={field}>
                <option value="remove">Remove them</option><option value="keep">Keep them (only report)</option>
              </select>
              <span className="text-xs text-slate-500">Only applies to the number columns above.</span>
            </label>
            <button disabled={!file || busy} className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Processing..." : "Upload and process"}
            </button>
          </form>
        </Card>
        <Card title="2. Results" className="lg:col-span-3">
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          {!error && !result && <p className="py-10 text-center text-sm text-slate-500">Results appear here after you upload a file.</p>}
          {result && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3">
                <StatusBadge status={result.status} />
                <Link className="text-brand-dark hover:underline" to={`/executions/${result.id}`}>View step log</Link>
              </div>
              {result.error_message && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{result.error_message}</p>}
              {result.status === "success" && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Tile label="Rows in file" value={m?.rows_loaded} />
                    <Tile label="Rows with empty cells" value={m?.invalid_rows} />
                    <Tile label="Duplicate rows" value={m?.duplicate_rows} />
                    <Tile label="Non-number values" value={m?.invalid_values} />
                    <Tile label="Empty cells" value={m?.missing_values} />
                    <Tile label="Rows after cleaning" value={m?.rows_after_cleaning} />
                  </div>
                  {m?.missing_by_column && Object.keys(m.missing_by_column).length > 0 && (
                    <p className="text-slate-600">Empty cells by column: {Object.entries(m.missing_by_column).map(([c, n]) => `${c} (${n})`).join(", ")}</p>
                  )}
                  <div className="flex gap-2">
                    <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/api/executions/${result.id}/download/processed`}>Download cleaned CSV</a>
                    <a className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/api/executions/${result.id}/download/summary`}>Download summary</a>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
