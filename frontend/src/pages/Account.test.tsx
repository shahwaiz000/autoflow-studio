import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Account from "./Account";

let status: Record<string, unknown> = {};
let posts: { url: string; body: string }[] = [];
let testReply: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { sent_to: "me@mycompany.sa" } };

beforeEach(() => {
  posts = [];
  testReply = { ok: true, status: 200, body: { sent_to: "me@mycompany.sa" } };
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push({ url, body: String(init.body) });
      return Promise.resolve({ ok: testReply.ok, status: testReply.status, json: () => Promise.resolve(testReply.body) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(status) });
  }));
});

test("when email is not set up, it says so and where to set it up, without asking for a password on screen", async () => {
  status = { configured: false, host: null, port: 587, sender: null, security: "starttls", allowed_domains: [] };
  render(<Account />);
  expect(await screen.findByText(/not set up/)).toBeInTheDocument();
  expect(screen.getByText(/never saved in the database/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/password/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Send test email" })).toBeNull();
});

test("when email is set up, it shows the sender and sends a test email", async () => {
  status = { configured: true, host: "smtp.gmail.com", port: 587, sender: "alerts@mycompany.sa", security: "starttls", allowed_domains: ["mycompany.sa"] };
  render(<Account />);
  expect(await screen.findByText("alerts@mycompany.sa")).toBeInTheDocument();
  expect(screen.getByText(/Only these domains can receive alerts: mycompany.sa/)).toBeInTheDocument();
  const send = screen.getByRole("button", { name: "Send test email" });
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Send a test email to"), { target: { value: "me@mycompany.sa" } });
  fireEvent.click(send);
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ url: "/api/email/test", body: JSON.stringify({ to: "me@mycompany.sa" }) });
  expect(await screen.findByText(/Test email sent to me@mycompany.sa/)).toBeInTheDocument();
});

test("a failed test shows the reason", async () => {
  status = { configured: true, host: "smtp.gmail.com", port: 587, sender: "alerts@mycompany.sa", security: "starttls", allowed_domains: [] };
  testReply = { ok: false, status: 502, body: { error: { code: "http_error", message: "The email server refused the username or password. For Gmail, use an app password, not your normal one" } } };
  render(<Account />);
  fireEvent.change(await screen.findByLabelText("Send a test email to"), { target: { value: "me@mycompany.sa" } });
  fireEvent.click(screen.getByRole("button", { name: "Send test email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("app password");
});
