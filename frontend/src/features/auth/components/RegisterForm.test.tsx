// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { signIn } from "next-auth/react";
import { AuthApiError, browserAuthApi } from "@/lib/api/browser-auth";
import { RegisterForm } from "./RegisterForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/api/browser-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/browser-auth")>(),
  browserAuthApi: { signup: vi.fn(), confirmVerification: vi.fn(), resendVerification: vi.fn() },
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

it("creates a real signup challenge, confirms its code, and signs in", async () => {
  vi.mocked(browserAuthApi.signup).mockResolvedValue({ verification_required: true, challenge_id: "challenge-id", destination: "+2010****78", expires_in: 300 });
  vi.mocked(browserAuthApi.confirmVerification).mockResolvedValue({ message: "verified", access: "redacted", refresh: "redacted", user: { id: "1", email: "test@example.com", phone: "+201012345678", status: "active", first_name: "", last_name: "" } });
  vi.mocked(signIn).mockResolvedValue({ ok: true, error: null, status: 200, url: "/account" });
  render(<RegisterForm />);
  fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("رقم الهاتف"), { target: { value: "+201012345678" } });
  fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "Password123!" } });
  fireEvent.click(screen.getByRole("button", { name: "إنشاء حساب" }));
  await screen.findByLabelText("رمز التأكيد");
  expect(browserAuthApi.signup).toHaveBeenCalledWith(expect.objectContaining({ email: "test@example.com", phone: "+201012345678" }));
  fireEvent.change(screen.getByLabelText("رمز التأكيد"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "تأكيد وإنشاء الحساب" }));
  await waitFor(() => expect(browserAuthApi.confirmVerification).toHaveBeenCalledWith({ challenge_id: "challenge-id", code: "123456" }));
  await waitFor(() => expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({ identifier: "test@example.com", password: "Password123!" })));
  expect(replace).toHaveBeenCalledWith("/account");
});

function fillSignup() {
  fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("رقم الهاتف"), { target: { value: "+201012345678" } });
  fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "Password123!" } });
}

async function showChallenge() {
  vi.mocked(browserAuthApi.signup).mockResolvedValue({ verification_required: true, challenge_id: "challenge-id", destination: "+2010****78", expires_in: 300 });
  render(<RegisterForm />);
  fillSignup();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "إنشاء حساب" })); });
  fireEvent.change(screen.getByLabelText("رمز التأكيد"), { target: { value: "123456" } });
}

it("preserves signup data and prevents retries until Retry-After expires", async () => {
  vi.useFakeTimers();
  vi.mocked(browserAuthApi.signup).mockRejectedValue(new AuthApiError("Throttled", 429, "throttled", {}, undefined, 2));
  render(<RegisterForm />);
  fillSignup();
  const email = screen.getByLabelText("البريد الإلكتروني") as HTMLInputElement;
  await act(async () => { fireEvent.submit(email.closest("form")!); });
  expect(screen.getByRole("button", { name: "حاول مجددًا خلال 2 ث" })).toHaveProperty("disabled", true);
  await act(async () => { fireEvent.submit(email.closest("form")!); });
  expect(browserAuthApi.signup).toHaveBeenCalledTimes(1);
  expect(email.value).toBe("test@example.com");
  expect(screen.getByLabelText("كلمة المرور")).toHaveProperty("value", "Password123!");
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole("button", { name: "إنشاء حساب" })).toHaveProperty("disabled", false);
  expect(browserAuthApi.signup).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.submit(email.closest("form")!); });
  expect(browserAuthApi.signup).toHaveBeenCalledTimes(2);
});

it.each(["confirm", "resend"])("blocks both verification actions after a %s rate limit and enables them on expiry", async (action) => {
  vi.useFakeTimers();
  const limited = action === "confirm" ? browserAuthApi.confirmVerification : browserAuthApi.resendVerification;
  vi.mocked(limited).mockRejectedValue(new AuthApiError("Throttled", 429, "throttled", {}, undefined, 2));
  await showChallenge();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: action === "confirm" ? "تأكيد وإنشاء الحساب" : "إعادة إرسال الرمز" })); });
  expect(screen.getByRole("alert").textContent).toContain("محاولات كثيرة");
  expect(screen.getByRole("button", { name: "حاول مجددًا خلال 2 ث" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "إعادة إرسال الرمز" })).toHaveProperty("disabled", true);
  await act(async () => {
    fireEvent.submit(screen.getByLabelText("رمز التأكيد").closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "إعادة إرسال الرمز" }));
  });
  expect(limited).toHaveBeenCalledTimes(1);
  expect(signIn).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole("button", { name: "تأكيد وإنشاء الحساب" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "إعادة إرسال الرمز" })).toHaveProperty("disabled", false);
  expect(limited).toHaveBeenCalledTimes(1);
});

it("does not claim verification succeeded when its request fails", async () => {
  vi.mocked(browserAuthApi.confirmVerification).mockRejectedValue(new TypeError("Network failed"));
  await showChallenge();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "تأكيد وإنشاء الحساب" })); });
  expect(screen.getByRole("alert").textContent).toContain("تعذر إكمال الطلب");
  expect(screen.getByRole("alert").textContent).not.toContain("تم تأكيد الرقم");
  expect(signIn).not.toHaveBeenCalled();
});
