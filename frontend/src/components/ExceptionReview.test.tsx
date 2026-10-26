import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ExceptionReview from "./ExceptionReview";

const item = (id: number, key: string, extra = {}) => ({ id, kind: "missing_in_right", key, left_row: id + 1, right_row: null, left_amount: 100, right_amount: null,
  difference: null, reason: `${key} has no deposit`, decision: null, decided_by: null, decided_at: null, note: null, ...extra });
let items: ReturnType<typeof item>[] = [];
let posted: { url: string; body: { ids: number[]; decision: string; note: string } }[] = [];
const labels = { missing_in_right: "Missing in the second file" };
const counts = () => ({ pending: items.filter((i) => !i.decision).length, approved: items.filter((i) => i.decision === "approved").length, rejected: items.filter((i) => i.decision === "rejected").length });

beforeEach(() => {
  items = [item(1, "WB-1"), item(2, "WB-2"), item(3, "WB-3", { decision: "approved", decided_by: "shahwaiz", decided_at: "2026-10-26T10:00:00Z", note: "Known fee" })];
  posted = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posted.push({ url, body });
      items = items.map((i) => (body.ids.includes(i.id) ? { ...i, decision: body.decision === "pending" ? null : body.decision, note: body.note || null } : i));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ changed: body.ids.length }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ total: items.length, by_kind: { missing_in_right: items.length }, by_decision: counts(), labels, items }) });
  }));
});
const show = () => render(<MemoryRouter><ExceptionReview executionId={7} /></MemoryRouter>);

it("shows review progress, who decided, and their note", async () => {
  show();
  expect(await screen.findByText(/1 of 3/)).toBeInTheDocument();
  expect(screen.getByText(/2 still to review/)).toBeInTheDocument();
  expect(screen.getByText("Known fee")).toBeInTheDocument();
  expect(screen.getByText(/shahwaiz,/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Audit trail for this run" })).toHaveAttribute("href", "/audit?run=7");
});

it("approves the checked exceptions in one go", async () => {
  show();
  fireEvent.click(await screen.findByLabelText("Select WB-1"));
  fireEvent.click(screen.getByLabelText("Select WB-2"));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0].url).toBe("/api/executions/7/exceptions/decide");
  expect(posted[0].body).toEqual({ ids: [1, 2], decision: "approved", note: "" });
  expect(await screen.findByText(/2 updated and recorded in the audit trail/)).toBeInTheDocument();
});

it("will not reject without a note", async () => {
  show();
  fireEvent.click(await screen.findByLabelText("Select WB-1"));
  const reject = screen.getByRole("button", { name: "Reject" });
  expect(reject).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Courier must resend" } });
  expect(reject).toBeEnabled();
  fireEvent.click(reject);
  await waitFor(() => expect(posted[0]?.body).toEqual({ ids: [1], decision: "rejected", note: "Courier must resend" }));
});

it("select all picks everything shown", async () => {
  show();
  fireEvent.click(await screen.findByLabelText("Select all shown"));
  expect(screen.getByText("3 selected")).toBeInTheDocument();
});
