import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExecutionDetail from "./ExecutionDetail";

let status = "queued";
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    let body: unknown = {};
    if (url === "/api/executions/4") body = { id: 4, workflow_id: 1, workflow_name: "Invoice Processing", status, trigger_type: "manual", started_at: "2026-10-26T10:00:00Z", finished_at: null, duration_seconds: null, error_message: null, is_demo: false, steps: [] };
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
