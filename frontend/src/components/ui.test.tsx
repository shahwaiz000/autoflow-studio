import { render, screen } from "@testing-library/react";
import { Empty, StatusBadge } from "./ui";

it("renders a readable status label", () => {
  render(<StatusBadge status="failed" />);
  expect(screen.getByText("Failed")).toBeInTheDocument();
});

it("renders an empty state with guidance", () => {
  render(<Empty title="No executions yet" hint="Run a workflow." />);
  expect(screen.getByText("Run a workflow.")).toBeInTheDocument();
});
