import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const day = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;
const dashboard = {
  totals: { workflows: 2, enabled_workflows: 1, executions: 12, successful: 10, failed: 2, running: 0, success_rate: 83.3, avg_duration_seconds: 1.5 },
  data_source: { demo_executions: 12, live_executions: 0 },
  trend: Array.from({ length: 14 }, (_, i) => ({ date: day(i), success: i >= 7 ? 2 : 1, failed: i === 13 ? 2 : 0 })),
  recent: [{ id: 5, workflow_id: 1, workflow_name: "Invoice Check", status: "failed", trigger_type: "manual", started_at: "2026-10-25T10:00:00Z",
    finished_at: null, duration_seconds: 1.2, error_message: "Step failed: bad amount", is_demo: true }],
  workflow_performance: [{ workflow: "Invoice Check", runs: 12, failed: 2, avg_duration_seconds: 1.5 }],
  failure_reasons: [{ reason: "bad amount", count: 2 }],
};
const report = { days: 14, source: "all", daily: Array.from({ length: 14 }, (_, i) => ({ date: day(i), success: 1, failed: 0, avg_duration_seconds: 1 })) };
const workflows = [
  { id: 1, name: "Invoice Check", description: "", category: "Finance", enabled: true, step_count: 3, run_count: 12, last_status: "failed" },
  { id: 2, name: "Old Flow", description: "", category: "General", enabled: false, step_count: 2, run_count: 0, last_status: null },
];

let calls: { url: string; method: string }[] = [];
beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const body = url.startsWith("/api/dashboard") ? dashboard : url.startsWith("/api/analytics") ? report
      : url.endsWith("/run") ? { ...dashboard.recent[0], id: 6, status: "success", error_message: null } : workflows;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
});

const open = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);

it("shows real totals, the failure summary and labels demo data", async () => {
  open();
  expect(await screen.findByText("Automation health")).toBeInTheDocument();
  expect(screen.getByText("83.3%")).toBeInTheDocument();
  expect(screen.getByText("bad amount", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("Step failed: bad amount")).toBeInTheDocument();
  expect(screen.getByText("Demo data")).toBeInTheDocument();
  expect(screen.getByText("1 enabled, 1 disabled")).toBeInTheDocument();
});

it("does not claim any time saved until the user enters a manual time per run", async () => {
  open();
  await screen.findByText("Estimated time saved");
  expect(screen.getByText("Enter how long one run takes by hand to see an estimate.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Manual minutes per run"), { target: { value: "6" } });
  expect(screen.getByText("1 h")).toBeInTheDocument(); // 10 successful runs x 6 min = 60 min
  expect(screen.getByText(/10 successful runs x 6 min/)).toBeInTheDocument();
});

it("runs the chosen workflow from the quick-run panel and refreshes", async () => {
  open();
  await screen.findByText("Automation health");
  await waitFor(() => expect(screen.getByRole("button", { name: /Run now/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /Run now/ }));
  expect(await screen.findByText(/Invoice Check success/)).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST" && c.url === "/api/workflows/1/run")).toBe(true);
});

it("disables the run button for a disabled workflow", async () => {
  open();
  const btn = await screen.findByRole("button", { name: "Run Old Flow" });
  expect(btn).toBeDisabled();
});
