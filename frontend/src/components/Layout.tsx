import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { useApi } from "../lib";
import { Icon, type IconName } from "./icons";

type NavItem = { to: string; label: string; icon: IconName; end?: boolean };
const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Reconcile", items: [
    { to: "/", label: "Overview", icon: "dashboard", end: true },
    { to: "/workflows", label: "Reconciliations", icon: "workflow" },
    { to: "/executions", label: "Run history", icon: "executions" },
    { to: "/audit", label: "Audit trail", icon: "check" },
  ] },
  { title: "Set up", items: [
    { to: "/data-sources", label: "Data files", icon: "database" },
    { to: "/schedules", label: "Schedules", icon: "clock" },
    { to: "/assistant", label: "Assistant", icon: "sparkles" },
  ] },
];
const LIVE = GROUPS.flatMap((g) => g.items);

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
      <Link to="/" className="flex items-center gap-3 px-6 pb-7 pt-7">
        <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-brand text-white shadow-lift">
          <Icon name="bolt" className="h-5 w-5" />
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold text-white">AutoFlow Studio</span>
          <span className="block text-xs text-slate-400">COD reconciliation</span>
        </span>
      </Link>
      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-1.5 px-3 text-xs font-medium text-slate-500">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end}
                  className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${isActive ? "bg-white/[0.09] text-white" : "text-slate-400 hover:bg-white/[0.05] hover:text-white"}`}>
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute -left-3 top-2 h-5 w-[3px] rounded-r-full bg-mint" aria-hidden="true" />}
                      <Icon name={l.icon} className={`h-[18px] w-[18px] transition-colors ${isActive ? "text-mint" : "text-slate-500 group-hover:text-slate-300"}`} />
                      {l.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      {loginEnabled && username && (
        <div className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2.5 text-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy-700 text-xs font-semibold uppercase text-slate-200" aria-hidden="true">{username.slice(0, 1)}</span>
          <Link to="/account" className="min-w-0 flex-1 truncate font-medium text-slate-200 hover:text-white" title="Account settings">{username}</Link>
          <button onClick={logout} className="shrink-0 text-xs text-slate-400 transition-colors hover:text-white">Log out</button>
        </div>
      )}
      <p className="px-6 py-4 text-xs text-slate-600">{version ? `Version ${version}` : "Local workspace"}</p>
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-canvas/85 px-4 backdrop-blur md:px-10">
          <button aria-label="Open menu" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(true)}
            className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-white md:hidden">
            <Icon name="menu" />
          </button>
          <h2 className="truncate text-sm font-medium text-slate-500">{pageTitle(pathname)}</h2>
          <div className="ml-auto flex items-center gap-3">
            <span role="status" title={health.data ? `API version ${health.data.version}` : undefined}
              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-card">
              <span className={`h-2 w-2 rounded-full ${checking ? "bg-slate-300" : online ? "bg-mint" : "bg-coral"}`} aria-hidden="true" />
              {checking ? "Checking API" : online ? "API online" : "API offline"}
            </span>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-10 pt-2 md:px-10"><Outlet /></main>
      </div>
    </div>
  );
}
