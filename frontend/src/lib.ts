import { useCallback, useEffect, useState } from "react";
import type { Execution } from "./types";

/** Sent when the server says the login has ended, so the app can show the login page. */
export const AUTH_LOST = "autoflow-auth-lost";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new Error("Cannot reach the backend. Check that it is running on port 8000.");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event(AUTH_LOST));
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body as T;
}

export function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    api<T>(path).then((d) => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";

type Day = { success: number; failed: number };

/** Totals for the latest `size` days and for the `size` days before them. */
export function comparePeriods(trend: Day[], size = 7) {
  const sum = (days: Day[]) => ({
    success: days.reduce((a, d) => a + d.success, 0),
    failed: days.reduce((a, d) => a + d.failed, 0),
  });
  const current = sum(trend.slice(-size));
  const previous = sum(trend.slice(-size * 2, -size));
  return { current, previous };
}

/** Percent change from previous to current. Returns null when there is nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "-";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Estimated time saved. Only calculated from a figure the user typed in; never from a guess. */
export function estimateSavedMinutes(successfulRuns: number, minutesPerRun: number | null): number | null {
  if (minutesPerRun == null || !Number.isFinite(minutesPerRun) || minutesPerRun <= 0) return null;
  return successfulRuns * minutesPerRun;
}

export function formatMinutes(total: number): string {
  if (total < 60) return `${Math.round(total)} min`;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: "POST", body: form });
  } catch {
    throw new Error("Cannot reach the backend. Check that it is running on port 8000.");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_LOST));
  if (!res.ok) throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
  return body as T;
}

export const uploadCsv = <T,>(form: FormData) => uploadFile<T>("/uploads", form);

export const inProgress = (status: string) => status === "queued" || status === "running";

/** Ask the backend about a run until it is no longer waiting or running (or the time is up). */
export async function waitForRun(id: number, onUpdate?: (ex: Execution) => void, intervalMs = 600, maxMs = 120_000): Promise<Execution> {
  const end = Date.now() + maxMs;
  for (;;) {
    const ex = await api<Execution>(`/executions/${id}`);
    onUpdate?.(ex);
    if (!inProgress(ex.status) || Date.now() >= end) return ex;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
