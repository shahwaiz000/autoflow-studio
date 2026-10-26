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


describe("workflows that ask for files", () => {
  const needs = { ...wf, id: 2, name: "Bank check", inputs: [{ name: "bank", label: "Bank statement" }] };
  let runBodies: string[] = [];
  beforeEach(() => {
    runBodies = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      let body: unknown = [needs]; let code = 200;
      if (url === "/api/workflows?search=") body = [needs];
      else if (url === "/api/datasources") body = { samples: [{ name: "invoices.csv", source: "samples", readable: true, rows: 1, columns: [], size_bytes: 1, modified_at: null, used_by: [] }], uploads: [] };
      else if (url === "/api/workflows/2/run?background=true") { runBodies.push(String(init?.body)); body = { id: 11, status: "queued" }; code = 202; }
      else if (url === "/api/executions/11") body = { id: 11, status: "success", error_message: null };
      return Promise.resolve({ ok: true, status: code, json: () => Promise.resolve(body) });
    }));
  });

  test("Run asks for the files first and does not start anything yet", async () => {
    render(<MemoryRouter><Workflows /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /^Run/ }));
    expect(await screen.findByRole("group", { name: "Choose files for this run" })).toBeInTheDocument();
    expect(runBodies).toHaveLength(0);
  });

  test("the chosen files are sent with the run", async () => {
    render(<MemoryRouter><Workflows /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /^Run/ }));
    await screen.findByRole("option", { name: "invoices.csv" });
    fireEvent.change(screen.getByLabelText("Bank statement", { selector: "select" }), { target: { value: "samples:invoices.csv" } });
    fireEvent.click(screen.getByRole("button", { name: "Run with these files" }));
    await waitFor(() => expect(runBodies).toHaveLength(1));
    expect(JSON.parse(runBodies[0])).toEqual({ inputs: { bank: { source: "samples", file: "invoices.csv" } } });
    expect(await screen.findByText(/Bank check success/, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  test("Cancel closes the panel", async () => {
    render(<MemoryRouter><Workflows /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /^Run/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Choose files for this run" })).toBeNull();
  });
});

describe("deleting a workflow that has runs", () => {
  const old = { ...wf, id: 5, name: "Old demo", built_in: false, run_count: 41 };
  let deletes: string[] = [];
  beforeEach(() => {
    deletes = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") { deletes.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ deleted: true, runs_deleted: 41 }) }); }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([old]) });
    }));
  });

  test("asks clearly first, says how many runs go, and only then erases them", async () => {
    render(<MemoryRouter><Workflows /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(deletes).toEqual([]);  // nothing is sent yet
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("all 41 runs");
    fireEvent.click(screen.getByRole("button", { name: "Delete with its history" }));
    await waitFor(() => expect(deletes).toEqual(["/api/workflows/5?with_history=true"]));
    expect(await screen.findByText("Old demo was deleted with 41 runs")).toBeInTheDocument();
  });

  test("Keep it closes the box without deleting anything", async () => {
    render(<MemoryRouter><Workflows /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deletes).toEqual([]);
  });
});
