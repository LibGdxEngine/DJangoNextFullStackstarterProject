// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { signIn } from "next-auth/react";
import { LoginForm } from "../auth/LoginForm";

const push = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
afterEach(cleanup);

function fill(identifier: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: identifier } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /دخول/ }));
}

it("signs in with the credentials provider and opens the dashboard", async () => {
  vi.mocked(signIn).mockResolvedValue({ ok: true, error: null, status: 200, url: null });
  render(<LoginForm />);
  fill("a@example.com", "secret-pass");
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  expect(signIn).toHaveBeenCalledWith("credentials", { redirect: false, identifier: "a@example.com", password: "secret-pass" });
});

it("explains when phone verification is still required", async () => {
  vi.mocked(signIn).mockResolvedValue({ ok: false, error: "PHONE_VERIFICATION_REQUIRED", status: 401, url: null });
  render(<LoginForm />);
  fill("a@example.com", "secret-pass");
  await waitFor(() => expect(screen.getByText(/تأكيد رقم هاتفك/)).toBeDefined());
  expect(push).not.toHaveBeenCalled();
});

it("does not call the backend with empty fields", () => {
  render(<LoginForm />);
  fireEvent.click(screen.getByRole("button", { name: /دخول/ }));
  expect(signIn).not.toHaveBeenCalled();
});
