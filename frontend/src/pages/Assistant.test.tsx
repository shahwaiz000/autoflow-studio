import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Assistant from "./Assistant";

const info = { provider: "rules", uses_ai_model: false, limits: ["Notifications are recorded in the run log only. Nothing is emailed or sent."],
  datasets: [{ label: "Invoices", file: "invoices.csv", columns: ["invoice_id"] }] };
const proposal = {
  status: "ok", request: "x", name: "Invoices check and alert", description: "Built by the assistant", category: "Finance",
  warnings: ["The assistant does not set schedules. Save the workflow, then add a schedule on the Schedules page."],
  steps: [{ id: "s1", type: "trigger", name: "Start", config: { kind: "manual" } }, { id: "s2", type: "end", name: "Done", config: {} }],
  reasons: [{ step: "Start", why: "Every workflow needs a start." }, { step: "Done", why: "Marks the end." }],
};
const explanation = {
  workflow_id: 1, name: "Invoice Processing", summary: "Invoice Processing has 2 steps.", suggestions: ["Add a Report step so each run leaves a summary."],
  steps: [{ id: "s1", name: "Start", type: "trigger", text: "Starts the workflow when you click Run." }],
  history: { runs: 4, failed: 1, success_rate: 75, last_error: null },
};
const failures = { days: 14, total_runs: 20, total_failed: 3, headline: "3 of 20 runs failed in the last 14 days (15%).",
  items: [{ reason: "Missing required columns: vendor", count: 3, workflows: ["Invoice Processing"], example_execution_id: 9, advice: "The file does not have the columns this workflow expects." }] };

let calls: { url: string; method: string; body?: string }[] = [];
let proposeResult: unknown = proposal;

beforeEach(() => {
  calls = []; proposeResult = proposal;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    let body: unknown = [];
    if (url === "/api/assistant/info") body = info;
    else if (url === "/api/assistant/propose") body = proposeResult;
    else if (url.startsWith("/api/assistant/explain/")) body = explanation;
    else if (url.startsWith("/api/assistant/failures")) body = failures;
    else if (url === "/api/workflows" && method === "GET") body = [{ id: 1, name: "Invoice Processing", enabled: true }];
    else if (url === "/api/workflows" && method === "POST") body = { id: 42, name: "Invoices check and alert" };
    else if (url === "/api/workflows/42/run") body = { id: 77, status: "success", error_message: null };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
});

const open = () => render(
  <MemoryRouter initialEntries={["/assistant"]}>
    <Routes><Route path="/assistant" element={<Assistant />} /><Route path="/builder/:id" element={<p>Builder page</p>} /></Routes>
  </MemoryRouter>);

async function ask(text = "Check invoices and alert finance") {
  open();
  fireEvent.change(screen.getByLabelText("Describe the workflow you want"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Suggest a workflow/ }));
  await screen.findByText("Proposed workflow");
}

it("says plainly that it is rules-based and not an AI model", async () => {
  open();
  expect(await screen.findByText(/not an AI language model/)).toBeInTheDocument();
  expect(await screen.findByText("What it can and cannot do")).toBeInTheDocument();
});

it("shows a proposal with reasons and warnings, and fills examples on click", async () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: /Clean the customer list/ }));
  expect(screen.getByLabelText("Describe the workflow you want")).toHaveValue("Clean the customer list: remove duplicates and extra spaces");
  fireEvent.click(screen.getByRole("button", { name: /Suggest a workflow/ }));
  expect(await screen.findByDisplayValue("Invoices check and alert")).toBeInTheDocument();
  expect(screen.getByText("Every workflow needs a start.")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Things to know" })).toHaveTextContent("Schedules page");
  expect(calls.find((c) => c.url === "/api/assistant/propose")?.method).toBe("POST");
});

it("asks for more detail instead of showing a workflow it could not build", async () => {
  proposeResult = { ...proposal, status: "needs_detail", steps: [], reasons: [], message: "I could not tell which data you want to work with." };
  open();
  fireEvent.change(screen.getByLabelText("Describe the workflow you want"), { target: { value: "make a sandwich" } });
  fireEvent.click(screen.getByRole("button", { name: /Suggest a workflow/ }));
  expect(await screen.findByText(/could not tell which data/)).toBeInTheDocument();
  expect(screen.queryByText("Proposed workflow")).not.toBeInTheDocument();
});

it("saves only when asked, sending the proposal to the real workflows API, then opens the builder", async () => {
  await ask();
  expect(calls.some((c) => c.url === "/api/workflows" && c.method === "POST")).toBe(false);
  fireEvent.change(screen.getByDisplayValue("Invoices check and alert"), { target: { value: "My invoice check" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and open in builder" }));
  expect(await screen.findByText("Builder page")).toBeInTheDocument();
  const saved = JSON.parse(calls.find((c) => c.url === "/api/workflows" && c.method === "POST")!.body!);
  expect(saved.name).toBe("My invoice check");
  expect(saved.steps).toHaveLength(2);
});

it("can save and run in one click and links to the log", async () => {
  await ask();
  fireEvent.click(screen.getByRole("button", { name: /Save and run now/ }));
  expect(await screen.findByText(/Invoices check and alert success/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View logs" })).toHaveAttribute("href", "/executions/77");
});

it("explains a chosen workflow in plain words with ideas", async () => {
  open();
  fireEvent.click(screen.getByRole("tab", { name: "Explain a workflow" }));
  const select = await screen.findByLabelText("Workflow to explain");
  await waitFor(() => expect(within(select).getByRole("option", { name: "Invoice Processing" })).toBeInTheDocument());
  fireEvent.change(select, { target: { value: "1" } });
  expect(await screen.findByText("Invoice Processing has 2 steps.")).toBeInTheDocument();
  expect(screen.getByText("Starts the workflow when you click Run.")).toBeInTheDocument();
  expect(screen.getByText("Add a Report step so each run leaves a summary.")).toBeInTheDocument();
});

it("summarizes failures with advice and a link to an example run", async () => {
  open();
  fireEvent.click(screen.getByRole("tab", { name: "Failure insights" }));
  expect(await screen.findByText("3 of 20 runs failed in the last 14 days (15%).")).toBeInTheDocument();
  expect(screen.getByText("The file does not have the columns this workflow expects.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See an example run" })).toHaveAttribute("href", "/executions/9");
});
