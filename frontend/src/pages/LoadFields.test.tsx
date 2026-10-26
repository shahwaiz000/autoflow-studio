import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { EStep, Fields } from "../components/StepFields";

const catalog = {
  samples: [{ name: "invoices.csv", source: "samples", readable: true, rows: 40, columns: [], size_bytes: 1, modified_at: null, used_by: [], sheets: [] }],
  uploads: [{ name: "abc.xlsx", source: "uploads", readable: true, original_name: "bank march.xlsx", rows: 3, columns: [], size_bytes: 1, modified_at: null, used_by: [], sheets: ["Cover", "Txns"] }],
};
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) })));
});

function Host({ first, others = [] }: { first: EStep; others?: EStep[] }) {
  const [step, setStep] = useState(first);
  return (
    <div>
      <Fields step={step} steps={[step, ...others]} samples={[]} set={(config) => setStep({ ...step, config })} />
      <pre data-testid="config">{JSON.stringify(step.config)}</pre>
    </div>
  );
}
const load = (config: object): EStep => ({ id: "s2", type: "load_csv", name: "Load", retries: 0, next: "", config });
const cfg = () => JSON.parse(screen.getByTestId("config").textContent!);

test("a fixed file can be a sample or one of your uploads", async () => {
  render(<Host first={load({ file: "", source: "samples", table: "main" })} />);
  await screen.findByRole("option", { name: "bank march.xlsx" });
  fireEvent.change(screen.getByLabelText("File"), { target: { value: "uploads:abc.xlsx" } });
  expect(cfg()).toMatchObject({ file: "abc.xlsx", source: "uploads", table: "main" });
});

test("'choose when running' replaces the fixed file with a run-time slot named after the table", async () => {
  render(<Host first={load({ file: "invoices.csv", source: "samples", table: "bank" })} />);
  fireEvent.click(await screen.findByLabelText("Choose the file when the workflow runs"));
  expect(cfg()).toEqual({ table: "bank", input: "bank" });
  expect(screen.queryByLabelText("File")).toBeNull();
  fireEvent.change(screen.getByLabelText(/Name of this table/), { target: { value: "Ledger" } });
  expect(cfg()).toMatchObject({ table: "ledger", input: "ledger" });  // lower-cased, slot follows the table
  fireEvent.click(screen.getByLabelText("Choose the file when the workflow runs"));
  expect(cfg()).toMatchObject({ file: "", source: "samples", table: "ledger" });
});

test("the sheet box suggests the sheets of the chosen Excel file", async () => {
  render(<Host first={load({ file: "abc.xlsx", source: "uploads", table: "main" })} />);
  await screen.findByRole("option", { name: "bank march.xlsx" });
  const options = [...document.querySelectorAll("#sheet-names option")].map((o) => o.getAttribute("value"));
  expect(options).toEqual(["Cover", "Txns"]);
});

test("cleaning options ask for their own columns", async () => {
  const step: EStep = { id: "s3", type: "transform", name: "Tidy", retries: 0, next: "", config: { operations: ["trim_text"], numeric_columns: [] } };
  render(<Host first={step} />);
  fireEvent.click(screen.getByLabelText(/Turn amounts like/));
  expect(await screen.findByLabelText("Amount columns to convert")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/Make dates one format/));
  expect(screen.getByLabelText(/Date columns to convert/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Day comes first/)).toBeChecked();
  fireEvent.change(screen.getByLabelText("Amount columns to convert"), { target: { value: "amount, fee" } });
  expect(cfg().amount_columns).toEqual(["amount", "fee"]);
});

test("a table choice appears only when two files are loaded", async () => {
  const check: EStep = { id: "s4", type: "validate", name: "Check", retries: 0, next: "", config: { required_columns: [], numeric_columns: [], fail_on_errors: false } };
  const { unmount } = render(<Host first={check} others={[load({ table: "main", file: "a.csv" })]} />);
  expect(screen.queryByLabelText("Works on table")).toBeNull();
  unmount();
  render(<Host first={check} others={[load({ table: "bank", file: "a.csv" }), { ...load({ table: "ledger", file: "b.csv" }), id: "s5" }]} />);
  fireEvent.change(screen.getByLabelText("Works on table"), { target: { value: "ledger" } });
  expect(cfg().table).toBe("ledger");
});
