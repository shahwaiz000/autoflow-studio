import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Workflows from "./Workflows";

const wf = { id: 1, name: "Invoice Processing", description: "", category: "Finance", enabled: true, step_count: 5, built_in: true, created_at: "2026-10-01T00:00:00Z" };
let calls: { url: string; method: string }[] = [];
let polls: string[] = [];

beforeEach(() => {
  calls = []; polls = ["queued", "running", "success"];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"; calls.push({ url, method });
    let body: unknown = [wf]; let code = 200;
    if (url === "/api/workflows/1/run?background=true") { body = { id: 9, status: "queued", steps: [] }; code = 202; }
    else if (url === "/api/executions/9") body = { id: 9, status: polls.shift() ?? "success", error_message: null };
    return Promise.resolve({ ok: true, status: code, json: () => Promise.resolve(body) });
  }));
});

test("Run goes to the background queue and shows each stage until it finishes", async () => {
  render(<MemoryRouter><Workflows /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /^Run/ }));
  expect(await screen.findByText(/waiting in the queue/)).toBeInTheDocument();
  expect(calls.some((c) => c.url === "/api/workflows/1/run?background=true" && c.method === "POST")).toBe(true);
  expect(await screen.findByText(/Invoice Processing success/, undefined, { timeout: 5000 })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("link", { name: "View logs" })).toHaveAttribute("href", "/executions/9"));
});
