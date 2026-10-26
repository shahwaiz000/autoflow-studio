import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULTS, EStep, Fields } from "./StepFields";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ samples: [], uploads: [] }) })));
});

const load = (table: string): EStep => ({ id: table, type: "load_csv", name: table, retries: 0, next: "", config: { input: table, table } });

function Harness() {
  const [step, setStep] = useState<EStep>({ id: "c", type: "compare", name: "Match", retries: 0, next: "", config: { ...DEFAULTS.compare } });
  return <Fields step={step} steps={[load("courier"), load("bank"), step]} samples={[]} set={(config) => setStep({ ...step, config })} />;
}

it("offers a compare step with the matching columns and allowed difference", async () => {
  render(<MemoryRouter><Harness /></MemoryRouter>);
  expect(await screen.findByText("Matching column in the first table")).toBeInTheDocument();
  expect(screen.getByLabelText("Allowed difference")).toHaveValue(0.01);
});

it("lets you pick which loaded tables are compared and which columns match", async () => {
  render(<MemoryRouter><Harness /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText("First table"), { target: { value: "courier" } });
  fireEvent.change(screen.getByLabelText("Second table"), { target: { value: "bank" } });
  fireEvent.change(screen.getByLabelText("Matching column in the first table"), { target: { value: "waybill" } });
  expect(screen.getByLabelText("First table")).toHaveValue("courier");
  expect(screen.getByLabelText("Matching column in the first table")).toHaveValue("waybill");
});
