import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useApi } from "../lib";
import { Icon, type IconName } from "./icons";

const LIVE: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Overview", icon: "dashboard", end: true },
  { to: "/workflows", label: "Reconciliations", icon: "workflow" },
  { to: "/executions", label: "Run history", icon: "executions" },
  { to: "/data-sources", label: "Data files", icon: "database" },
  { to: "/schedules", label: "Schedules", icon: "clock" },
  { to: "/assistant", label: "Assistant", icon: "sparkles" },
];
const SOON: { label: string; icon: IconName }[] = [];

function pageTitle(path: string): string {
  if (path === "/") return "Overview";
  if (path.startsWith("/account")) return "Account";
  if (path.startsWith("/builder")) return "Workflow builder";
  if (path.startsWith("/templates")) return "Templates";
  const hit = LIVE.filter((l) => l.to !== "/" && path.startsWith(l.to)).sort((a, b) => b.to.length - a.to.length)[0];
  return hit ? hit.label : "AutoFlow Studio";
}

function Sidebar({ version }: { version?: string }) {
  const { username, loginEnabled, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <Link to="/" className="flex items-center gap-3 px-5 py-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-lift">
          <Icon name="bolt" className="h-5 w-5" />
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold text-white">AutoFlow Studio</span>
          <span className="block text-xs text-slate-400">Workflow automation</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3">
        {LIVE.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-brand" aria-hidden="true" />}
                <Icon name={l.icon} className={`h-[18px] w-[18px] ${isActive ? "text-brand-soft" : "text-slate-400 group-hover:text-slate-200"}`} />
                {l.label}
              </>
            )}
          </NavLink>
        ))}
        {SOON.length > 0 && <p className="px-3 pb-1 pt-6 text-xs font-medium text-slate-500">Planned</p>}
        {SOON.map((s) => (
          <span key={s.label} aria-disabled="true" title="Not built yet"
            className="flex cursor-not-allowed items-center gap-3 px-3 py-2.5 text-sm text-slate-500">
            <Icon name={s.icon} className="h-[18px] w-[18px]" />
            {s.label}
          </span>
        ))}
      </nav>
      {loginEnabled && username && (
        <div className="mx-3 mb-2 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
          <Link to="/account" className="truncate font-medium text-slate-200 hover:text-white" title="Account settings">{username}</Link>
          <button onClick={logout} className="ml-2 shrink-0 text-xs text-slate-400 hover:text-white">Log out</button>
        </div>
      )}
      <p className="px-5 py-4 text-xs text-slate-500">{version ? `Version ${version}` : "Local workspace"}</p>
    </div>
  );
}

export default function Layout() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const health = useApi<{ status: string; version: string }>("/health");

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    const id = window.setInterval(health.reload, 30000);
    return () => window.clearInterval(id);
  }, [health.reload]);

  const online = !!health.data && !health.error;
  const checking = health.loading && !health.data && !health.error;

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden bg-navy-900 md:sticky md:top-0 md:block md:h-screen md:w-64 md:shrink-0">
        <Sidebar version={health.data?.version} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-navy-900/60" />
          <aside id="mobile-menu" className="relative h-full w-72 max-w-[85vw] animate-slideIn bg-navy-900">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-lg p-2 text-slate-300 hover:bg-white/10">
              <Icon name="close" />
            </button>
            <Sidebar version={health.data?.version} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur md:px-8">
          <button aria-label="Open menu" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden">
            <Icon name="menu" />
          </button>
          <h2 className="truncate text-base font-semibold text-slate-900">{pageTitle(pathname)}</h2>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span role="status" title={health.data ? `API version ${health.data.version}` : undefined}
              className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 sm:inline-flex">
              <span className={`h-2 w-2 rounded-full ${checking ? "bg-slate-300" : online ? "bg-mint" : "bg-coral"}`} aria-hidden="true" />
              {checking ? "Checking API" : online ? "API online" : "API offline"}
            </span>
            <Link to="/data-sources" className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex">
              <Icon name="upload" className="h-4 w-4" /> Add files
            </Link>
            <Link to="/builder" className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">
              <Icon name="plus" className="h-4 w-4" /> New workflow
            </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
