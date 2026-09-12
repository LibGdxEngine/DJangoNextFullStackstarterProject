// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { signIn } from "next-auth/react";
import { LoginForm } from "./LoginForm";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("./SocialAuthButtons", () => ({ SocialAuthButtons: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("associates Arabic labels with login fields and supplies browser autocomplete hints", () => {
  render(<LoginForm />);
  expect(screen.getByLabelText("البريد الإلكتروني أو رقم الهاتف")).toHaveProperty("autocomplete", "username");
  const password = screen.getByLabelText("كلمة المرور");
  expect(password).toHaveProperty("autocomplete", "current-password");
  expect(password.getAttribute("dir")).toBe("ltr");
});

it("retains credentials while counting down and never automatically resubmits", async () => {
  vi.useFakeTimers();
  vi.mocked(signIn).mockResolvedValue({ error: "MOBSER_RETRY_429_2", status: 401, ok: false, url: null });
  render(<LoginForm />);
  const identifier = screen.getByPlaceholderText("ahmed@example.com أو +201039811349") as HTMLInputElement;
  const password = screen.getByPlaceholderText("••••••••") as HTMLInputElement;
  fireEvent.change(identifier, { target: { value: "test@example.com" } });
  fireEvent.change(password, { target: { value: "keep this" } });
  await act(async () => { fireEvent.submit(identifier.closest("form")!); });
  expect((screen.getByRole("button", { name: "حاول مجددًا خلال 2 ث" }) as HTMLButtonElement).disabled).toBe(true);
  expect(identifier.value).toBe("test@example.com");
  expect(password.value).toBe("keep this");
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect((screen.getByRole("button", { name: "تسجيل الدخول" }) as HTMLButtonElement).disabled).toBe(false);
  expect(signIn).toHaveBeenCalledTimes(1);
});
