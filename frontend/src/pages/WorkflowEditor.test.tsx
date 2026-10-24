import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkflowEditor from "./WorkflowEditor";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(["invoices.csv"]) })));
});

it("starts with two steps and can add and remove a step", async () => {
  render(<MemoryRouter><WorkflowEditor /></MemoryRouter>);
  expect(await screen.findByLabelText("Step 2 name")).toHaveValue("Done");
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  expect(screen.getByLabelText("Step 3 name")).toHaveValue("Load data");
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[2]);
  expect(screen.queryByLabelText("Step 3 name")).not.toBeInTheDocument();
});
