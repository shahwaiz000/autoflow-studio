import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Upload from "./Upload";

it("keeps the submit button disabled until a file is chosen", () => {
  render(<MemoryRouter><Upload /></MemoryRouter>);
  expect(screen.getByRole("button", { name: /upload and process/i })).toBeDisabled();
  expect(screen.getByText(/results appear here/i)).toBeInTheDocument();
});
