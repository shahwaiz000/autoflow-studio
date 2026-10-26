import { FormEvent, useState } from "react";
import { useAuth } from "../auth";
import { Card, PageHeader } from "../components/ui";
import { api, useApi } from "../lib";
import type { EmailStatus } from "../types";

const input = "mt-1 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm";

function EmailCard() {
  const { data, error, loading } = useApi<EmailStatus>("/email/status");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function test(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await api<{ sent_to: string }>("/email/test", { method: "POST", body: JSON.stringify({ to }) });
      setMsg({ ok: true, text: `Test email sent to ${r.sent_to}. Check that inbox (and spam).` });
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    setBusy(false);
  }
  return (
    <Card title="Email alerts" className="mb-4">
      {loading && !data ? <p className="text-sm text-slate-500">Checking...</p> : error || !data ? <p role="alert" className="text-sm text-coral-dark">{error ?? "Could not read the email settings"}</p> : data.configured ? (
        <form onSubmit={test} className="space-y-3 text-sm">
          <p>Email is <b className="text-mint-dark">set up</b>. Alerts are sent from <b>{data.sender}</b> through {data.host}.
            {data.allowed_domains.length > 0 && <> Only these domains can receive alerts: {data.allowed_domains.join(", ")}.</>}</p>
          <label className="block font-medium text-slate-700">Send a test email to
            <input className={input} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@yourcompany.com" /></label>
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-mint-dark" : "text-coral-dark"}>{msg.text}</p>}
          <button disabled={!to || busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Sending..." : "Send test email"}</button>
        </form>
      ) : (
        <div className="space-y-2 text-sm text-slate-700">
          <p>Email is <b>not set up</b>, so alerts are only written to the run log. Every run says so.</p>
          <p>To turn it on, open the file <code className="rounded bg-slate-100 px-1">backend\.env</code> on this computer and fill in SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM (the file <code className="rounded bg-slate-100 px-1">.env.example</code> shows how, with a Gmail example). Then restart the backend and reload this page.</p>
          <p className="text-xs text-slate-500">The password stays in that file on your computer. It is never saved in the database, shown on screen or sent to GitHub.</p>
        </div>
      )}
    </Card>
  );
}

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
      <EmailCard />
      <Card><p className="text-sm text-slate-600">Login is turned off on this server, so there is no account. Set AUTH_ENABLED=true to turn it on.</p></Card>
    </>
  );
  return (
    <>
      <PageHeader title="Account" subtitle={`Logged in as ${username}`}>
        <button onClick={logout} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Log out</button>
      </PageHeader>
      <EmailCard />
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
