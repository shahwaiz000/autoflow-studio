import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Schedules from "./Schedules";

const sched = {
  id: 1, workflow_id: 1, workflow_name: "Invoice Processing", workflow_enabled: true, kind: "daily", interval_minutes: null,
  time_of_day: "08:30", weekday: null, tz_offset_minutes: 180, enabled: true, summary: "Every day at 08:30 (UTC+3)",
  next_run_at: "2026-10-27T05:30:00Z", last_run_at: null, last_status: null, last_execution_id: null,
};
let calls: { url: string; method: string; body?: string }[] = [];
let running = true;
let schedules: unknown[] = [sched];

beforeEach(() => {
  calls = []; running = true; schedules = [sched];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    let body: unknown = [];
    if (url === "/api/schedules" && method === "GET") body = schedules;
    else if (url === "/api/schedules" && method === "POST") body = { ...sched, id: 2 };
    else if (url === "/api/schedules/status") body = { running, checks_every_seconds: 20, last_check: null, active: 1, note: "Schedules only run while the backend is running." };
    else if (url === "/api/schedules/run-due") body = { ran: [] };
    else if (url.startsWith("/api/workflows")) body = [{ id: 1, name: "Invoice Processing", enabled: true }, { id: 2, name: "Old one", enabled: false }];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
});

const show = () => render(<MemoryRouter><Schedules /></MemoryRouter>);

test("lists schedules in plain words and tells the truth about the scheduler", async () => {
  show();
  expect(await screen.findByText("Every day at 08:30 (UTC+3)")).toBeInTheDocument();
  expect(await screen.findByText(/scheduler is running/i)).toHaveTextContent("Schedules only run while the backend is running");
  expect(screen.getByText("Has not run yet")).toBeInTheDocument();
});

test("warns when the scheduler is not running", async () => {
  running = false;
  show();
  expect(await screen.findByText(/nothing will run by itself/i)).toBeInTheDocument();
});

test("only enabled workflows can be scheduled", async () => {
  show();
  await screen.findByText("Every day at 08:30 (UTC+3)");
  const select = screen.getByLabelText("Workflow") as HTMLSelectElement;
  expect([...select.options].map((o) => o.text)).toEqual(["Invoice Processing"]);
});

test("adds a daily schedule using the chosen time and the computer's time zone", async () => {
  show();
  await screen.findByText("Every day at 08:30 (UTC+3)");
  fireEvent.change(screen.getByLabelText("Time"), { target: { value: "09:15" } });
  fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/schedules" && c.method === "POST")).toBe(true));
  const post = calls.find((c) => c.url === "/api/schedules" && c.method === "POST")!;
  const body = JSON.parse(post.body!);
  expect(body).toMatchObject({ workflow_id: 1, kind: "daily", time_of_day: "09:15" });
  expect(typeof body.tz_offset_minutes).toBe("number");
  expect(body.interval_minutes).toBeUndefined();
  expect(await screen.findByText(/Schedule added/)).toBeInTheDocument();
});

test("interval and weekly schedules send the right fields", async () => {
  show();
  await screen.findByText("Every day at 08:30 (UTC+3)");
  fireEvent.change(screen.getByLabelText("How often"), { target: { value: "interval" } });
  fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "45" } });
  fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
  await waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.url === "/api/schedules")).toHaveLength(1));
  expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toMatchObject({ kind: "interval", interval_minutes: 45 });
  fireEvent.change(screen.getByLabelText("How often"), { target: { value: "weekly" } });
  fireEvent.change(screen.getByLabelText("Day"), { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
  await waitFor(() => expect(calls.filter((c) => c.method === "POST" && c.url === "/api/schedules")).toHaveLength(2));
  const last = JSON.parse(calls.filter((c) => c.method === "POST" && c.url === "/api/schedules")[1].body!);
  expect(last).toMatchObject({ kind: "weekly", weekday: 4 });
});

test("pause sends enabled false", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/schedules/1" && c.method === "PATCH")).toBe(true));
  expect(JSON.parse(calls.find((c) => c.method === "PATCH")!.body!)).toEqual({ enabled: false });
});

test("shows an empty state", async () => {
  schedules = [];
  show();
  expect(await screen.findByText("No schedules yet")).toBeInTheDocument();
});
