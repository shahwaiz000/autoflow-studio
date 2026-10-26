import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DataSources, { formatBytes } from "./DataSources";

const sample = { name: "invoices.csv", source: "samples", rows: 40, columns: ["invoice_id", "vendor"], readable: true, size_bytes: 2048, modified_at: null, used_by: ["Invoice Processing"] };
const upload = { name: "abc123.csv", source: "uploads", rows: 3, columns: ["name", "amount"], readable: true, size_bytes: 40, modified_at: null, used_by: [],
  original_name: "my sales.csv", uploaded_at: "2026-10-26T10:00:00Z", execution_id: 7 };
const orphan = { ...upload, name: "old.csv", original_name: null, uploaded_at: null, execution_id: null };
let calls: { url: string; method: string }[] = [];
let uploads: unknown[] = [upload, orphan];

beforeEach(() => {
  calls = []; uploads = [upload, orphan];
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"; calls.push({ url, method });
    let body: unknown = {};
    if (url === "/api/datasources") body = { samples: [sample], uploads };
    else if (url === "/api/datasources/uploads") body = { name: "n.xlsx", original_name: "new book.xlsx" };
    else if (url.includes("/preview")) body = { name: "x", readable: true, columns: ["name", "amount"], rows: [["Anna", "10"], ["Ben", "20"]] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  }));
});
const show = () => render(<MemoryRouter><DataSources /></MemoryRouter>);

test("formats file sizes", () => {
  expect(formatBytes(500)).toBe("500 B");
  expect(formatBytes(2048)).toBe("2.0 KB");
  expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
});

test("lists samples with the workflows that use them, and uploads by original name", async () => {
  show();
  expect(await screen.findByText("invoices.csv")).toBeInTheDocument();
  expect(screen.getByText(/40 rows, 2 columns/)).toBeInTheDocument();
  expect(screen.getByText("Used by: Invoice Processing")).toBeInTheDocument();
  expect(screen.getByText("my sales.csv")).toBeInTheDocument();
  expect(screen.getByText(/original name not recorded/)).toBeInTheDocument();
});

test("samples have no delete button, uploads do", async () => {
  show();
  await screen.findByText("invoices.csv");
  expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  const sampleCard = screen.getByText("Sample files").closest("section")!;
  expect(within(sampleCard).queryByRole("button", { name: "Delete" })).toBeNull();
});

test("preview shows columns and the first rows", async () => {
  show();
  await screen.findByText("my sales.csv");
  fireEvent.click(screen.getAllByRole("button", { name: "Preview" })[1]);
  expect(await screen.findByRole("table", { name: "Preview of my sales.csv" })).toBeInTheDocument();
  expect(screen.getByText("Anna")).toBeInTheDocument();
  expect(calls.some((c) => c.url === "/api/datasources/uploads/abc123.csv/preview?rows=10")).toBe(true);
});

test("delete asks first, then calls the API and reloads", async () => {
  show();
  await screen.findByText("my sales.csv");
  uploads = [orphan];
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/datasources/uploads/abc123.csv")).toBe(true));
  expect(await screen.findByText("my sales.csv was deleted")).toBeInTheDocument();
});

test("nothing is deleted if the person says no", async () => {
  vi.stubGlobal("confirm", vi.fn(() => false));
  show();
  await screen.findByText("my sales.csv");
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
});

test("empty uploads show a friendly empty state", async () => {
  uploads = [];
  show();
  expect(await screen.findByText("No uploads yet")).toBeInTheDocument();
});


test("a file can be added and the list refreshes", async () => {
  show();
  await screen.findByText("my sales.csv");
  const file = new File(["x"], "new book.xlsx");
  fireEvent.change(screen.getByLabelText("Add a CSV or Excel file"), { target: { files: [file] } });
  expect(await screen.findByText("new book.xlsx was added")).toBeInTheDocument();
  expect(calls.some((c) => c.url === "/api/datasources/uploads" && c.method === "POST")).toBe(true);
  expect(calls.filter((c) => c.url === "/api/datasources").length).toBeGreaterThanOrEqual(2);
});
