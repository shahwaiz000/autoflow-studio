import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RunPanel from "./RunPanel";

const catalog = {
  samples: [{ name: "invoices.csv", source: "samples", readable: true, rows: 40, columns: ["a"], size_bytes: 1, modified_at: null, used_by: [] }],
  uploads: [{ name: "abc.xlsx", source: "uploads", readable: true, original_name: "bank march.xlsx", rows: 3, columns: ["a"], size_bytes: 1, modified_at: null, used_by: [] },
            { name: "bad.csv", source: "uploads", readable: false, original_name: "broken.csv", rows: null, columns: [], size_bytes: 1, modified_at: null, used_by: [] }],
};
let calls: { url: string; method: string }[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const body = url === "/api/datasources/uploads" ? { name: "new1.csv", source: "uploads", original_name: "ledger.csv", readable: true } : catalog;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
});
const inputs = [{ name: "bank", label: "Bank statement" }, { name: "ledger", label: "Ledger" }];

test("Run stays disabled until every file is chosen, then sends the choices", async () => {
  const onRun = vi.fn();
  render(<RunPanel inputs={inputs} onRun={onRun} onCancel={() => {}} />);
  const run = screen.getByRole("button", { name: "Run with these files" });
  expect(run).toBeDisabled();
  await screen.findAllByRole("option", { name: "bank march.xlsx" });
  fireEvent.change(screen.getByLabelText("Bank statement", { selector: "select" }), { target: { value: "uploads:abc.xlsx" } });
  expect(run).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Ledger", { selector: "select" }), { target: { value: "samples:invoices.csv" } });
  expect(run).toBeEnabled();
  fireEvent.click(run);
  expect(onRun).toHaveBeenCalledWith({ bank: { source: "uploads", file: "abc.xlsx" }, ledger: { source: "samples", file: "invoices.csv" } });
});

test("files that cannot be read are not offered", async () => {
  render(<RunPanel inputs={inputs} onRun={() => {}} onCancel={() => {}} />);
  await screen.findAllByRole("option", { name: "bank march.xlsx" });
  expect(screen.queryByRole("option", { name: "broken.csv" })).toBeNull();
});

test("a new file can be added on the spot and is chosen automatically", async () => {
  render(<RunPanel inputs={[inputs[0]]} onRun={() => {}} onCancel={() => {}} />);
  await screen.findAllByRole("option", { name: "bank march.xlsx" });
  const file = new File(["a,b\n1,2\n"], "ledger.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("Add a file for Bank statement"), { target: { files: [file] } });
  await waitFor(() => expect(calls.some((c) => c.url === "/api/datasources/uploads" && c.method === "POST")).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "Run with these files" })).toBeEnabled());
});
