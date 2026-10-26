import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const base = {
  days: 30, totals: { reconciliations: 1, runs: 2, failed: 1, running: 0, workflows: 1 },
  trend: Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, runs: 0, matched: 0, exceptions: i === 29 ? 7 : 0 })),
  exceptions_by_kind: { missing_in_right: 3, amount_mismatch: 2 },
  recent: [{ id: 9, workflow_id: 1, workflow_name: "COD Reconciliation", status: "success", trigger_type: "manual", started_at: "2026-10-26T10:00:00Z",
    finished_at: null, duration_seconds: 0.7, error_message: null, is_demo: false }],
  last_failure: { execution_id: 8, workflow: "COD Reconciliation", reason: "Step 'Bank deposits' failed: File not found" },
};
const latest = { execution_id: 9, workflow: "COD Reconciliation", started_at: "2026-10-26T10:00:00Z", left: "courier", right: "bank", rows: 62,
  matched_rows: 55, exceptions: 7, match_rate: 88.7, amount_at_risk: 2103.41, by_kind: { missing_in_right: 3, amount_mismatch: 2, duplicate: 1, missing_in_left: 1 } };

function show(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })));
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
}

it("shows the latest reconciliation: match rate, exceptions, amount at risk and what is wrong", async () => {
  show({ ...base, latest });
  expect(await screen.findByText(/Latest reconciliation: courier compared with bank/)).toBeInTheDocument();
  expect(screen.getByText("88.7%")).toBeInTheDocument();
  expect(screen.getByText("55 of 62 rows matched")).toBeInTheDocument();
  expect(screen.getByText("2,103.41")).toBeInTheDocument();
  expect(screen.getByText("Missing in the second file")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open run #9" })).toHaveAttribute("href", "/executions/9");
});

it("points to the most recent failed run", async () => {
  show({ ...base, latest });
  expect(await screen.findByRole("alert")).toHaveTextContent("File not found");
});

it("before any reconciliation, explains how to run the first one instead of showing empty charts", async () => {
  show({ ...base, latest: null, last_failure: null, recent: [], totals: { reconciliations: 0, runs: 0, failed: 0, running: 0, workflows: 1 } });
  expect(await screen.findByText("No reconciliation has been run yet")).toBeInTheDocument();
  expect(screen.queryByText(/Exceptions found per day/)).toBeNull();
});
