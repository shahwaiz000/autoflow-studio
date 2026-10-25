import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Templates from "./Templates";

const sample = [{ key: "k", name: "Invoice Check with Alert", description: "d", category: "Finance", tags: ["Branching"], note: "n",
  step_count: 2, steps: [{ id: "a", type: "trigger", name: "Start" }, { id: "b", type: "end", name: "Done" }] }];

it("lists templates with a button to use each one", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(sample) })));
  render(<MemoryRouter><Templates /></MemoryRouter>);
  expect(await screen.findByText("Invoice Check with Alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use template" })).toBeEnabled();
  expect(screen.getByText("Branching")).toBeInTheDocument();
});
