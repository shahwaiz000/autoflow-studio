import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { Icon } from "../components/icons";
import { api, formatDate, timeAgo, useApi } from "../lib";
import type { Schedule, SchedulerStatus, Workflow } from "../types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const field = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

/** The offset of the computer's own clock, so "08:30" means 08:30 where the person is. */
const localOffset = () => -new Date().getTimezoneOffset();

export default function Schedules() {
  const list = useApi<Schedule[]>("/schedules");
  const status = useApi<SchedulerStatus>("/schedules/status");
  const wfs = useApi<Workflow[]>("/workflows");
  const [wid, setWid] = useState("");
  const [kind, setKind] = useState<"interval" | "daily" | "weekly">("daily");
  const [minutes, setMinutes] = useState("60");
  const [time, setTime] = useState("08:30");
  const [weekday, setWeekday] = useState("0");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const workflows = (wfs.data ?? []).filter((w) => w.enabled);
  const chosen = wid || String(workflows[0]?.id ?? "");

  function refresh() { list.reload(); status.reload(); }

  async function add() {
    if (!chosen) { setMsg({ ok: false, text: "Choose a workflow first" }); return; }
    setBusy(true); setMsg(null);
    try {
      const body = {
        workflow_id: Number(chosen), kind, tz_offset_minutes: localOffset(),
        ...(kind === "interval" ? { interval_minutes: Number(minutes) } : { time_of_day: time }),
        ...(kind === "weekly" ? { weekday: Number(weekday) } : {}),
      };
      const s = await api<Schedule>("/schedules", { method: "POST", body: JSON.stringify(body) });
      setMsg({ ok: true, text: `Schedule added: ${s.workflow_name}, ${s.summary.toLowerCase()}` });
      refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }
  async function toggle(s: Schedule) {
    try { await api(`/schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) }); refresh(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  async function remove(s: Schedule) {
    if (!window.confirm(`Delete the schedule for "${s.workflow_name}"? The workflow itself stays.`)) return;
    try { await api(`/schedules/${s.id}`, { method: "DELETE" }); refresh(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  async function runDue() {
    setMsg(null);
    try {
      const r = await api<{ ran: { workflow: string; status: string }[] }>("/schedules/run-due", { method: "POST" });
      setMsg({ ok: true, text: r.ran.length ? r.ran.map((x) => `${x.workflow}: ${x.status}`).join("; ") : "Nothing was due right now." });
      refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  const st = status.data;
  return (
    <>
      <PageHeader title="Schedules" subtitle="Run a workflow by itself every few minutes, every day, or every week.">
        <button onClick={runDue} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Check for due runs now</button>
      </PageHeader>

      <p role="status" className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${st?.running ? "bg-mint-soft text-mint-dark" : "bg-sun-soft text-sun-dark"}`}>
        <Icon name="clock" className="h-4 w-4" />
        {st
          ? st.running
            ? `The scheduler is running and looks for due runs every ${st.checks_every_seconds} seconds. ${st.note}`
            : "The scheduler is not running, so nothing will run by itself. Start the backend normally to turn it on."
          : "Checking the scheduler..."}
      </p>

      <Card title="Add a schedule" className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Workflow<br />
            <select aria-label="Workflow" className={field} value={chosen} onChange={(e) => setWid(e.target.value)}>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <label className="text-sm">How often<br />
            <select aria-label="How often" className={field} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="interval">Every few minutes</option><option value="daily">Every day</option><option value="weekly">Every week</option>
            </select></label>
          {kind === "interval" && (
            <label className="text-sm">Minutes<br />
              <input aria-label="Minutes" type="number" min={5} max={10080} className={`${field} w-28`} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
          )}
          {kind === "weekly" && (
            <label className="text-sm">Day<br />
              <select aria-label="Day" className={field} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select></label>
          )}
          {kind !== "interval" && (
            <label className="text-sm">Time<br />
              <input aria-label="Time" type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} /></label>
          )}
          <button onClick={add} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">Add schedule</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Times use your computer's clock (UTC{localOffset() >= 0 ? "+" : "-"}{Math.abs(localOffset()) / 60}). The shortest repeat is 5 minutes.</p>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm ${msg.ok ? "text-mint-dark" : "text-coral-dark"}`}>{msg.text}</p>}
      </Card>

      <Card title="Your schedules">
        {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox message={list.error} retry={list.reload} /> : !list.data?.length ? (
          <Empty title="No schedules yet" hint="Add one above. The workflow will then run by itself while the backend is running." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
                <div className="min-w-[14rem] flex-1">
                  <p className="font-medium text-slate-900">{s.workflow_name}</p>
                  <p className="text-slate-600">{s.summary}</p>
                  {!s.workflow_enabled && <p className="text-xs text-sun-dark">This workflow is disabled, so runs are skipped.</p>}
                </div>
                <div className="text-slate-600">
                  <p>{s.enabled ? `Next: ${formatDate(s.next_run_at)}` : "Paused"}</p>
                  <p className="text-xs text-slate-500">
                    {s.last_run_at ? <>Last: {timeAgo(s.last_run_at)}, {s.last_status}{s.last_execution_id && <> <Link className="font-medium text-brand-dark hover:underline" to={`/executions/${s.last_execution_id}`}>view run</Link></>}</> : "Has not run yet"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggle(s)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium hover:bg-slate-50">{s.enabled ? "Pause" : "Resume"}</button>
                  <button onClick={() => remove(s)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-coral-dark hover:bg-coral-soft">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
