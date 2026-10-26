import { ChangeEvent, useState } from "react";
import { api, uploadFile, useApi } from "../lib";
import type { DataCatalog, DataFile, RunInput, WorkflowInput } from "../types";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
export const fileKey = (f: Pick<DataFile, "source" | "name">) => `${f.source}:${f.name}`;

/** Asks which file to use for each file slot a workflow has, then starts the run. */
export default function RunPanel({ inputs, onRun, onCancel }: {
  inputs: WorkflowInput[]; onRun: (chosen: Record<string, Pick<RunInput, "source" | "file">>) => void; onCancel: () => void;
}) {
  const catalog = useApi<DataCatalog>("/datasources");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const files = [...(catalog.data?.samples ?? []), ...(catalog.data?.uploads ?? [])].filter((f) => f.readable);
  const ready = inputs.every((i) => chosen[i.name]);

  async function add(name: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await uploadFile<DataFile>("/datasources/uploads", form);
      catalog.reload();
      setChosen((c) => ({ ...c, [name]: fileKey(saved) }));
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
    e.target.value = "";
  }

  function start() {
    onRun(Object.fromEntries(inputs.map((i) => {
      const [source, ...rest] = chosen[i.name].split(":");
      return [i.name, { source: source as RunInput["source"], file: rest.join(":") }];
    })));
  }

  return (
    <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-4 text-sm" role="group" aria-label="Choose files for this run">
      <p className="mb-3 font-medium text-slate-900">Choose the file{inputs.length > 1 ? "s" : ""} for this run</p>
      <div className="space-y-3">
        {inputs.map((i) => (
          <div key={i.name}>
            <label className="block">{i.label}
              <select className={field} value={chosen[i.name] ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [i.name]: e.target.value }))}>
                <option value="">Choose a file...</option>
                <optgroup label="Sample files">{(catalog.data?.samples ?? []).filter((f) => f.readable).map((f) => <option key={fileKey(f)} value={fileKey(f)}>{f.name}</option>)}</optgroup>
                <optgroup label="Your uploads">{(catalog.data?.uploads ?? []).filter((f) => f.readable).map((f) => <option key={fileKey(f)} value={fileKey(f)}>{f.original_name ?? f.name}</option>)}</optgroup>
              </select></label>
            <label className="mt-1 block text-xs text-slate-600">or add a new file (CSV or Excel)
              <input type="file" accept=".csv,.xlsx" disabled={busy} onChange={(e) => add(i.name, e)} className="mt-1 block text-xs" aria-label={`Add a file for ${i.label}`} /></label>
          </div>
        ))}
      </div>
      {files.length === 0 && !catalog.loading && <p className="mt-2 text-xs text-slate-500">There are no readable files yet. Add one above.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-coral-dark">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={start} disabled={!ready || busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">Run with these files</button>
        <button onClick={onCancel} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
      </div>
    </div>
  );
}
