import { FormEvent, ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { Icon } from "./components/icons";
import { AUTH_LOST, api } from "./lib";
import type { AuthStatus } from "./types";

interface AuthValue { username: string | null; loginEnabled: boolean; logout: () => Promise<void> }
const AuthContext = createContext<AuthValue>({ username: null, loginEnabled: false, logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-8 shadow-card">
        <span className="mb-5 grid h-10 w-10 place-items-center rounded-xl bg-brand text-white"><Icon name="bolt" className="h-5 w-5" /></span>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function CredentialsForm({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api(setup ? "/auth/setup" : "/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      onDone();
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }
  return (
    <Shell title={setup ? "Create your account" : "Log in"}
      subtitle={setup ? "This is the first time AutoFlow Studio is opened. Choose a username and password for the owner account." : "AutoFlow Studio is locked. Log in to continue."}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">Username
          <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus /></label>
        <label className="block text-sm font-medium text-slate-700">Password
          <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} /></label>
        {setup && <p className="text-xs text-slate-500">At least 10 characters, with a capital letter and a number.</p>}
        {error && <p role="alert" className="text-sm text-coral-dark">{error}</p>}
        <button disabled={busy || !username || !password} className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
          {setup ? "Create account" : "Log in"}</button>
      </form>
    </Shell>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<AuthStatus>("/auth/status").then((s) => { setStatus(s); setError(null); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const onLost = () => setStatus((s) => (s && s.auth_enabled ? { ...s, user: null } : s));
    window.addEventListener(AUTH_LOST, onLost);
    return () => window.removeEventListener(AUTH_LOST, onLost);
  }, []);

  const logout = useCallback(async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* the session ends either way */ }
    load();
  }, [load]);

  if (error) return (
    <Shell title="Cannot reach the backend" subtitle={error}>
      <button onClick={load} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Try again</button>
    </Shell>
  );
  if (!status) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading...</div>;
  if (status.auth_enabled && !status.user) return <CredentialsForm setup={status.needs_setup} onDone={load} />;
  return (
    <AuthContext.Provider value={{ username: status.user?.username ?? null, loginEnabled: status.auth_enabled, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
