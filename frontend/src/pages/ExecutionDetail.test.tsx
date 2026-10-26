import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExecutionDetail from "./ExecutionDetail";

let status = "queued";
let steps: unknown[] = [];
let inputs: unknown[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    let body: unknown = {};
    if (url === "/api/executions/4") body = { id: 4, workflow_id: 1, workflow_name: "Invoice Processing", status, trigger_type: "manual", started_at: "2026-10-26T10:00:00Z", finished_at: null, duration_seconds: null, error_message: null, is_demo: false, steps, inputs };
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
