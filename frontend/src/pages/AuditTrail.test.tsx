import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AuditTrail from "./AuditTrail";

let urls: string[] = [];
const events = [{ id: 2, at: "2026-10-26T10:05:00Z", actor: "shahwaiz", action: "rejected", execution_id: 9, exception_id: 4, key: "WB-70008", detail: "pending -> rejected. Note: Courier must resend" }];
function show(path: string, items: unknown[]) {
  urls = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => { urls.push(url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ total: items.length, items }) }); }));
  render(<MemoryRouter initialEntries={[path]}><AuditTrail /></MemoryRouter>);
}

it("lists who decided what, with a link to the run", async () => {
  show("/audit", events);
  expect(await screen.findByText("WB-70008")).toBeInTheDocument();
  expect(screen.getByText("shahwaiz")).toBeInTheDocument();
  expect(screen.getByText(/Courier must resend/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "#9" })).toHaveAttribute("href", "/executions/9");
  expect(screen.queryByRole("button", { name: /delete|edit/i })).toBeNull();
});

it("can show one run only", async () => {
  show("/audit?run=9", events);
  await screen.findByText("WB-70008");
  expect(urls[0]).toContain("execution_id=9");
});

it("explains what appears here before any decision", async () => {
  show("/audit", []);
  expect(await screen.findByText("No decisions yet")).toBeInTheDocument();
});
