import { FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { Card, PageHeader } from "../components/ui";
import { api } from "../lib";

const input = "mt-1 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default function Account() {
  const { username, loginEnabled, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
      setCurrent(""); setNext("");
      setMsg({ ok: true, text: "Password changed. Other devices were logged out." });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  }

  if (!loginEnabled) return (
    <>
      <PageHeader title="Account" />
      <Card><p className="text-sm text-slate-600">Login is turned off on this server, so there is no account. Set AUTH_ENABLED=true to turn it on.</p></Card>
    </>
  );
  return (
    <>
      <PageHeader title="Account" subtitle={`Logged in as ${username}`}>
        <button onClick={logout} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Log out</button>
      </PageHeader>
      <Card title="Change password">
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">Current password
            <input className={input} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
          <label className="block text-sm font-medium text-slate-700">New password
            <input className={input} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
          <p className="text-xs text-slate-500">At least 10 characters, with a capital letter and a number.</p>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-mint-dark" : "text-coral-dark"}`}>{msg.text}</p>}
          <button disabled={!current || !next} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">Change password</button>
        </form>
      </Card>
    </>
  );
}
