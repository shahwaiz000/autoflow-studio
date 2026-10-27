import { ReactNode } from "react";
import type { Status } from "../types";

const STYLE: Record<string, string> = {
  success: "bg-mint-soft text-mint-dark", failed: "bg-coral-soft text-coral-dark",
  running: "bg-sun-soft text-sun-dark", queued: "bg-slate-100 text-slate-700",
};
const DOT: Record<string, string> = { success: "bg-mint", failed: "bg-coral", running: "bg-sun", queued: "bg-slate-400" };

export function StatusBadge({ status }: { status: Status | string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status] ?? "bg-slate-100 text-slate-600"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status] ?? "bg-slate-400"}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export const Card = ({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`rounded-[14px] bg-white p-5 shadow-card sm:p-6 ${className}`}>
    {(title || action) && (
      <div className="mb-4 flex items-center justify-between gap-3">
        {title && <h2 className="text-[15px] font-semibold text-navy-900">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const PageHeader = ({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-[26px] font-semibold leading-tight text-navy-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
    {children}
  </div>
);

export const Loading = () => (
  <p role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand" aria-hidden="true" />
    Loading...
  </p>
);

export const ErrorBox = ({ message, retry }: { message: string; retry?: () => void }) => (
  <div role="alert" className="rounded-2xl border border-coral/30 bg-coral-soft p-5 text-sm text-coral-dark">
    <p className="font-medium">Something went wrong</p>
    <p className="mt-1">{message}</p>
    {retry && <button onClick={retry} className="mt-3 rounded-lg bg-coral px-3 py-1.5 text-white hover:bg-coral-dark">Try again</button>}
  </div>
);

export const Empty = ({ title, hint }: { title: string; hint: string }) => (
  <div className="py-12 text-center">
    <p className="font-medium text-slate-700">{title}</p>
    <p className="mt-1 text-sm text-slate-500">{hint}</p>
  </div>
);
