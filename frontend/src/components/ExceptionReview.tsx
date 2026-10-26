import { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, useApi } from "../lib";
import { ErrorBox, Loading } from "./ui";
import type { ExceptionList } from "../types";

const money = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS: Record<string, string> = { approved: "bg-emerald-50 text-emerald-700", rejected: "bg-red-50 text-red-700" };
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

/** The list of exceptions of one run, with filters, and approve / reject / reopen for the ones a person has checked. */
export default function ExceptionReview({ executionId }: { executionId: number }) {
  const [kind, setKind] = useState("");
  const [decision, setDecision] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const qs = [kind && `kind=${kind}`, decision && `decision=${decision}`].filter(Boolean).join("&");
  const { data, error, loading, reload } = useApi<ExceptionList>(`/executions/${executionId}/exceptions${qs ? `?${qs}` : ""}`);

  if (error) return <ErrorBox message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const all = Object.values(data.by_kind).reduce((a, b) => a + b, 0);
  if (all === 0) return <p className="text-sm text-emerald-700">Everything matched. There are no exceptions.</p>;
  const d = data.by_decision;
  const reviewed = d.approved + d.rejected;
  const visible = data.items.map((i) => i.id);
  const allPicked = visible.length > 0 && visible.every((id) => picked.has(id));
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function decide(value: "approved" | "rejected" | "pending") {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ changed: number }>(`/executions/${executionId}/exceptions/decide`, { method: "POST", body: JSON.stringify({ ids: [...picked], decision: value, note }) });
      setMsg({ ok: true, text: r.changed ? `${r.changed} updated and recorded in the audit trail.` : "Nothing changed: they already had that status." });
      setPicked(new Set()); setNote(""); reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <>
      <p className="mb-3 text-sm text-slate-700" aria-live="polite">
        <b>{reviewed} of {all}</b> reviewed: {d.approved} approved, {d.rejected} rejected, {d.pending} still to review.{" "}
        <Link className="font-medium text-brand-dark hover:underline" to={`/audit?run=${executionId}`}>Audit trail for this run</Link>
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label>Type <select aria-label="Filter by type" className="rounded-lg border border-slate-300 px-2 py-1" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All types ({all})</option>
          {Object.entries(data.labels).filter(([k]) => data.by_kind[k]).map(([k, l]) => <option key={k} value={k}>{l} ({data.by_kind[k]})</option>)}
        </select></label>
        <label>Status <select aria-label="Filter by status" className="rounded-lg border border-slate-300 px-2 py-1" value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="">All</option><option value="pending">Still to review ({d.pending})</option>
          <option value="approved">Approved ({d.approved})</option><option value="rejected">Rejected ({d.rejected})</option>
        </select></label>
        <a className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href={`/api/executions/${executionId}/download/exceptions`}>Exceptions (CSV)</a>
      </div>

      {picked.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
          <span className="font-medium">{picked.size} selected</span>
          <input aria-label="Note" maxLength={300} placeholder="Note (required to reject)" value={note} onChange={(e) => setNote(e.target.value)}
            className="min-w-[14rem] flex-1 rounded-lg border border-slate-300 px-3 py-1.5" />
          <button disabled={busy} onClick={() => decide("approved")} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>Approve</button>
          <button disabled={busy || !note.trim()} onClick={() => decide("rejected")} title={note.trim() ? "" : "Write a note first"} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Reject</button>
          <button disabled={busy} onClick={() => decide("pending")} className={`${btn} border border-slate-300 bg-white hover:bg-slate-100`}>Reopen</button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mb-3 text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
      <p className="mb-2 text-xs text-slate-500">Approve means the difference is understood and accepted. Reject means it needs follow-up, so a note is required.</p>

      {data.items.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No exceptions match these filters.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr>
              <th className="py-2 pr-2"><input type="checkbox" aria-label="Select all shown" checked={allPicked}
                onChange={() => setPicked(allPicked ? new Set() : new Set(visible))} /></th>
              <th className="pr-3">Type</th><th className="pr-3">Key</th><th className="pr-3">Rows</th>
              <th className="pr-3 text-right">First amount</th><th className="pr-3 text-right">Second amount</th><th className="pr-3 text-right">Difference</th>
              <th className="pr-3">Reason</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="py-2 pr-2"><input type="checkbox" aria-label={`Select ${r.key || "row"}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="pr-3 whitespace-nowrap">{data.labels[r.kind] ?? r.kind}</td>
                <td className="pr-3 font-mono text-xs">{r.key || "-"}</td>
                <td className="pr-3 whitespace-nowrap text-slate-500">{[r.left_row && `1st: ${r.left_row}`, r.right_row && `2nd: ${r.right_row}`].filter(Boolean).join(", ") || "-"}</td>
                <td className="pr-3 text-right">{money(r.left_amount)}</td><td className="pr-3 text-right">{money(r.right_amount)}</td><td className="pr-3 text-right">{money(r.difference)}</td>
                <td className="pr-3 text-slate-600">{r.reason}</td>
                <td className="min-w-[9rem]">
                  {r.decision ? (
                    <>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[r.decision]}`}>{r.decision === "approved" ? "Approved" : "Rejected"}</span>
                      <p className="mt-1 text-xs text-slate-500">{r.decided_by}, {formatDate(r.decided_at)}</p>
                      {r.note && <p className="text-xs text-slate-600">{r.note}</p>}
                    </>
                  ) : <span className="text-xs text-slate-400">To review</span>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {data.total > data.items.length && <p className="mt-2 text-xs text-slate-500">Showing the first {data.items.length} of {data.total}. The CSV has all of them.</p>}
    </>
  );
}
