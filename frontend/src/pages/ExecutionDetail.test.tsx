import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExecutionDetail from "./ExecutionDetail";

let status = "queued";
let steps: unknown[] = [];
let inputs: unknown[] = [];
let result: unknown = null;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    let body: unknown = {};
    if (url === "/api/executions/4") body = { id: 4, workflow_id: 1, workflow_name: "Invoice Processing", status, trigger_type: "manual", started_at: "2026-10-26T10:00:00Z", finished_at: null, duration_seconds: null, error_message: null, is_demo: false, steps, inputs, result };
    else if (url.startsWith("/api/executions/4/exceptions")) body = { total: 2, by_kind: { amount_mismatch: 1, missing_in_right: 1 }, by_decision: { pending: 2, approved: 0, rejected: 0 }, labels: { amount_mismatch: "Amount differs", missing_in_right: "Missing in second file" },
      items: [{ id: 1, kind: "amount_mismatch", key: "W100", left_row: 3, right_row: 5, left_amount: 100, right_amount: 90, difference: -10, reason: "Amounts differ by 10.00", decision: null }, { id: 2, kind: "missing_in_right", key: "W101", left_row: 4, right_row: null, left_amount: 50, right_amount: null, difference: null, reason: "No bank deposit found", decision: null }] };
    else if (url === "/api/workflows/1") body = { id: 1, name: "x", definition: { steps: [] } };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
});
const show = () => render(<MemoryRouter initialEntries={["/executions/4"]}><Routes><Route path="/executions/:id" element={<ExecutionDetail />} /></Routes></MemoryRouter>);

test("a queued run says it is waiting and will update by itself", async () => {
  status = "queued";
  show();
  expect(await screen.findByText(/waiting in the queue/)).toBeInTheDocument();
  expect(screen.getByText(/updates by itself/)).toBeInTheDocument();
});

test("a finished run shows no waiting notice", async () => {
  status = "success";
  show();
  await screen.findByText("Execution #4");
  expect(screen.queryByText(/updates by itself/)).toBeNull();
});


test("shows which files a run used and offers downloads only after a successful report step", async () => {
  status = "success";
  inputs = [{ name: "bank", source: "uploads", file: "abc.xlsx" }];
  steps = [{ position: 1, step_id: "s9", step_type: "report", name: "Report", status: "success", attempts: 1, message: "ok", duration_ms: 1 }];
  show();
  expect(await screen.findByText("Files used in this run")).toBeInTheDocument();
  expect(screen.getByText(/abc.xlsx/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Excel report" })).toHaveAttribute("href", "/api/executions/4/download/report");
});

test("no download buttons when the run had no report step", async () => {
  status = "success"; inputs = []; steps = [];
  show();
  await screen.findByText("Execution #4");
  expect(screen.queryByRole("link", { name: "Excel report" })).toBeNull();
  expect(screen.queryByText("Files used in this run")).toBeNull();
});

test("a reconciliation run shows its totals and every exception with the reason and a CSV link", async () => {
  status = "success";
  steps = [{ position: 1, step_id: "s4", step_type: "compare", name: "Match", status: "success", attempts: 1, message: "ok", duration_ms: 1 },
    { position: 2, step_id: "s7", step_type: "report", name: "Report", status: "success", attempts: 1, message: "ok", duration_ms: 1 }];
  result = { metrics: { matched_rows: 55, exceptions: 2, amount_mismatches: 1, missing_in_right: 1, missing_in_left: 0, duplicate_keys: 0, amount_difference: 10, unmatched_amount: 50 }, details: { comparisons: [{ left: "courier", right: "bank", tolerance: 0.01 }] } };
  show();
  expect(await screen.findByText("Reconciliation")).toBeInTheDocument();
  expect(screen.getByText("55")).toBeInTheDocument();
  expect(screen.getByText(/courier compared with bank/)).toBeInTheDocument();
  expect(await screen.findByText("W100")).toBeInTheDocument();
  expect(screen.getByText("No bank deposit found")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Exceptions (CSV)" })).toHaveAttribute("href", "/api/executions/4/download/exceptions");
  expect(screen.queryByRole("link", { name: "Cleaned data (CSV)" })).toBeNull();  // generic cleaning downloads make no sense here
  expect(screen.getByRole("link", { name: "Excel report" })).toBeInTheDocument();
  result = null;
});

test("a reconciliation grouped by driver shows each driver's exceptions and amount at risk", async () => {
  status = "success";
  steps = [{ position: 1, step_id: "s4", step_type: "compare", name: "Match", status: "success", attempts: 1, message: "ok", duration_ms: 1 }];
  result = { metrics: { matched_rows: 53, exceptions: 10, amount_mismatches: 5, missing_in_right: 2, missing_in_left: 2, duplicate_keys: 1, amount_difference: 123.5, unmatched_amount: 1302.81 },
    details: { comparisons: [{ left: "system", right: "pos", tolerance: 0, group_by: { column: "driver", rows: [
      { group: "DRV-104", rows: 12, exceptions: 2, net_difference: 0.5, no_partner: 790.82, at_risk: 791.32 },
      { group: "DRV-101", rows: 12, exceptions: 3, net_difference: -10, no_partner: 140, at_risk: 150 }] } }] } };
  show();
  expect(await screen.findByText("Exceptions by driver")).toBeInTheDocument();
  expect(screen.getByText("DRV-104")).toBeInTheDocument();
  expect(screen.getByText("791.32")).toBeInTheDocument();
  expect(screen.getByText("+0.50")).toBeInTheDocument();   // positive means the first file recorded more
  expect(within(screen.getByText("DRV-101").closest("tr")!).getByText("-10.00")).toBeInTheDocument();
});
