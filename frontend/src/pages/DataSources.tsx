import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { api, formatDate, uploadFile, useApi } from "../lib";
import type { DataCatalog, DataFile, DataPreview } from "../types";

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function Preview({ file }: { file: DataFile }) {
  const { data, error } = useApi<DataPreview>(`/datasources/${file.source}/${encodeURIComponent(file.name)}/preview?rows=10`);
  if (error) return <p className="text-sm text-coral-dark">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading preview...</p>;
  if (!data.readable) return <p className="text-sm text-sun-dark">This file has no data rows, or could not be read as a table.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-xs" aria-label={`Preview of ${file.original_name ?? file.name}`}>
        <thead className="bg-slate-50 text-left text-slate-600"><tr>{data.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
        <tbody>{data.rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((v, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5 text-slate-700">{v}</td>)}</tr>)}</tbody>
      </table>
      <p className="border-t border-slate-100 px-3 py-2 text-slate-500">First {data.rows.length} rows of {file.rows ?? "?"}.</p>
    </div>
  );
}

function FileList({ title, files, hint, emptyTitle, onDelete }: {
  title: string; files: DataFile[]; hint: string; emptyTitle: string; onDelete?: (f: DataFile) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title={title} className="mb-6">
      <p className="-mt-2 mb-4 text-sm text-slate-500">{hint}</p>
      {!files.length ? <Empty title={emptyTitle} hint="Nothing here yet." /> : (
        <ul className="divide-y divide-slate-100">
          {files.map((f) => {
            const label = f.original_name ?? f.name;
            return (
              <li key={f.name} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="min-w-[14rem] flex-1">
                    <p className="font-medium text-slate-900">{label}</p>
                    <p className="text-slate-500">
                      {f.readable ? `${f.rows?.toLocaleString()} rows, ${f.columns.length} columns` : "No data rows or not readable"}, {formatBytes(f.size_bytes)}
                      {f.uploaded_at && `, uploaded ${formatDate(f.uploaded_at)}`}
                      {f.source === "uploads" && !f.original_name && ", original name not recorded"}
                      {f.sheets && f.sheets.length > 1 && `, sheets: ${f.sheets.join(", ")}`}
                    </p>
                    {f.used_by.length > 0 && <p className="text-xs text-slate-500">Used by: {f.used_by.join(", ")}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button aria-expanded={open === f.name} onClick={() => setOpen(open === f.name ? null : f.name)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">{open === f.name ? "Hide preview" : "Preview"}</button>
                    {f.execution_id && <Link to={`/executions/${f.execution_id}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-brand-dark hover:bg-slate-50">View run</Link>}
                    {onDelete && <button onClick={() => onDelete(f)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-coral-dark hover:bg-coral-soft">Delete</button>}
                  </div>
                </div>
                {open === f.name && (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-slate-600"><span className="font-medium">Columns:</span> {f.columns.join(", ") || "none"}</p>
                    <Preview file={f} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function DataSources() {
  const { data, error, loading, reload } = useApi<DataCatalog>("/datasources");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await uploadFile<DataFile>("/datasources/uploads", form);
      setMsg({ ok: true, text: `${saved.original_name ?? saved.name} was added` }); reload();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  async function remove(f: DataFile) {
    const label = f.original_name ?? f.name;
    if (!window.confirm(`Delete "${label}"? The file is removed. Past runs stay in the history.`)) return;
    try {
      await api(`/datasources/uploads/${encodeURIComponent(f.name)}`, { method: "DELETE" });
      setMsg({ ok: true, text: `${label} was deleted` }); reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  return (
    <>
      <PageHeader title="Data Sources" subtitle="Your courier, bank and other files. Look inside a file before you reconcile it. You can also pick or add a file on the spot when you run a workflow.">
        <label className="cursor-pointer rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Add a file
          <input type="file" accept=".csv,.xlsx" className="sr-only" aria-label="Add a CSV or Excel file" onChange={add} />
        </label>
      </PageHeader>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mb-4 text-sm ${msg.ok ? "text-mint-dark" : "text-coral-dark"}`}>{msg.text}</p>}
      {loading && !data ? <Loading /> : error ? <ErrorBox message={error} retry={reload} /> : data && (
        <>
          <FileList title="Sample files" files={data.samples} emptyTitle="No sample files"
            hint="Fictional courier and bank files with planted differences, so you can see a reconciliation work. They cannot be deleted." />
          <FileList title="Your uploads" files={data.uploads} emptyTitle="No uploads yet" onDelete={remove}
            hint="CSV and Excel files you added. They are stored on this computer only, under random names." />
        </>
      )}
    </>
  );
}
