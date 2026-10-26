import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthGate, useAuth } from "./auth";
import { AUTH_LOST } from "./lib";
import Account from "./pages/Account";

let status: unknown;
let calls: { url: string; method: string; body?: string }[] = [];
let loginFails = false;

function Inside() { const { username } = useAuth(); return <p>Secret app for {username ?? "nobody"}</p>; }
const show = (ui = <Inside />) => render(<MemoryRouter><AuthGate>{ui}</AuthGate></MemoryRouter>);

beforeEach(() => {
  calls = []; loginFails = false;
  status = { auth_enabled: true, needs_setup: false, user: null };
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    let ok = true, code = 200, body: unknown = {};
    if (url === "/api/auth/status") body = status;
    else if (url === "/api/auth/login" && loginFails) { ok = false; code = 401; body = { error: { message: "Wrong username or password" } }; }
    else if (url === "/api/auth/login" || url === "/api/auth/setup") status = { auth_enabled: true, needs_setup: false, user: { username: "owner" } };
    else if (url === "/api/auth/logout") status = { auth_enabled: true, needs_setup: false, user: null };
    else if (url === "/api/auth/password") body = { changed: true };
    return Promise.resolve({ ok, status: code, json: () => Promise.resolve(body) });
  }));
});

test("the app stays hidden behind the login page", async () => {
  show();
  expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  expect(screen.queryByText(/Secret app/)).toBeNull();
});

test("logging in shows the app", async () => {
  show();
  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "owner" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Sunshine2026x" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByText("Secret app for owner")).toBeInTheDocument();
  expect(JSON.parse(calls.find((c) => c.url === "/api/auth/login")!.body!)).toEqual({ username: "owner", password: "Sunshine2026x" });
});

test("a wrong password shows the server's message and stays on the login page", async () => {
  loginFails = true;
  show();
  fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "owner" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password");
  expect(screen.queryByText(/Secret app/)).toBeNull();
});

test("first run asks you to create the account", async () => {
  status = { auth_enabled: true, needs_setup: true, user: null };
  show();
  expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
  expect(screen.getByText(/capital letter and a number/)).toBeInTheDocument();
});

test("when login is off the app opens straight away", async () => {
  status = { auth_enabled: false, needs_setup: false, user: null };
  show();
  expect(await screen.findByText("Secret app for nobody")).toBeInTheDocument();
});

test("an ended session sends the person back to the login page", async () => {
  status = { auth_enabled: true, needs_setup: false, user: { username: "owner" } };
  show();
  await screen.findByText("Secret app for owner");
  window.dispatchEvent(new Event(AUTH_LOST));
  expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
});

test("a backend that is down gives a clear message", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("x"))));
  show();
  expect(await screen.findByText(/Cannot reach the backend/, { selector: "p" })).toBeInTheDocument();
});

test("account page changes the password", async () => {
  status = { auth_enabled: true, needs_setup: false, user: { username: "owner" } };
  show(<Account />);
  expect(await screen.findByText("Logged in as owner")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Sunshine2026x" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewSecret2026x" } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  await waitFor(() => expect(calls.some((c) => c.url === "/api/auth/password")).toBe(true));
  expect(JSON.parse(calls.find((c) => c.url === "/api/auth/password")!.body!)).toEqual({ current_password: "Sunshine2026x", new_password: "NewSecret2026x" });
  expect(await screen.findByRole("status")).toHaveTextContent("Password changed");
});
