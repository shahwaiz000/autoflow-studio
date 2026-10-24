import { ReactNode } from "react";
import type { Status } from "../types";

const STYLE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700", failed: "bg-red-50 text-red-700",
  running: "bg-amber-50 text-amber-700",
};
const DOT: Record<string, string> = { success: "bg-emerald-500", failed: "bg-red-500", running: "bg-amber-500" };

export function StatusBadge({ status }: { status: Status | string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status] ?? "bg-slate-100 text-slate-600"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status] ?? "bg-slate-400"}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export const Card = ({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
    {title && <h2 className="mb-4 text-sm font-semibold text-slate-900">{title}</h2>}
    {children}
  </section>
);

export const PageHeader = ({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
    {children}
  </div>
);

export const Loading = () => <p role="status" className="py-12 text-center text-sm text-slate-500">Loading...</p>;

export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
    <p className="font-medium">Something went wrong</p>
    <p className="mt-1">{message}</p>
    {retry && <button onClick={retry} className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">Try again</button>}
  </div>
);

export const Empty = ({ title, hint }: { title: string; hint: string }) => (
  <div className="py-12 text-center">
    <p className="font-medium text-slate-700">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{hint}</p>
  </div>
);

export const DemoNote = ({ demo, live }: { demo: number; live: number }) =>
  demo > 0 ? (
    <p className="mb-4 rounded-lg bg-brand-soft px-4 py-2 text-sm text-brand-dark">
      Includes {demo} seeded demo executions (fictional) alongside {live} you ran yourself. Demo runs are labeled in the execution list.
    </p>
  ) : null;
