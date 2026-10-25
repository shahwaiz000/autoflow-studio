import { NavLink, Outlet } from "react-router-dom";

const LIVE = [
  { to: "/", label: "Dashboard", end: true }, { to: "/workflows", label: "Workflows" },
  { to: "/builder", label: "Builder" },
  { to: "/templates", label: "Templates" },
  { to: "/executions", label: "Executions" },
  { to: "/analytics", label: "Analytics" },
  { to: "/upload", label: "Upload CSV" },
];
const SOON = ["Data Sources", "AI Assistant"];

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="bg-navy-900 text-slate-300 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-purple-500 font-bold text-white">A</span>
          <span className="font-semibold text-white">AutoFlow Studio</span>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
          {LIVE.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-brand text-white" : "hover:bg-navy-700"}`}>
              {l.label}
            </NavLink>
          ))}
          <p className="mt-4 hidden px-3 text-xs text-slate-500 md:block">Planned</p>
          {SOON.map((s) => (
            <span key={s} aria-disabled="true" title="Not built yet" className="hidden cursor-not-allowed px-3 py-2 text-sm text-slate-500 md:block">{s}</span>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 p-5 md:p-8"><Outlet /></main>
    </div>
  );
}
