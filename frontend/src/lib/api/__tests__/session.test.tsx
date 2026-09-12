// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useSession } from "next-auth/react";
import SessionProvider from "@/components/SessionProvider";
import LoginPage from "@/app/login/page";
import { registerSessionExpiry } from "../browser";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../browser", () => ({ registerSessionExpiry: vi.fn().mockReturnValue(() => {}) }));
vi.mock("@/features/auth/components/LoginForm", () => ({ LoginForm: () => <div>Sign in form</div> }));
afterEach(cleanup);

it("connects protected failures to token-specific NextAuth updates", async () => {
  const update = vi.fn().mockResolvedValue({ expires: "2099-01-01", sessionExpired: true });
  vi.mocked(useSession).mockReturnValue({ data: null, status: "unauthenticated", update });
  render(<SessionProvider><div>Child</div></SessionProvider>);
  await waitFor(() => expect(registerSessionExpiry).toHaveBeenCalled());
  const expire = vi.mocked(registerSessionExpiry).mock.calls[0][0];
  await expire("expired-token");
  expect(update).toHaveBeenCalledExactlyOnceWith();
});

it("shows the Arabic sign-in entrypoint after expiry and removes the expiry message after a new login", () => {
  const update = vi.fn();
  vi.mocked(useSession).mockReturnValue({
    data: { expires: "2099-01-01", sessionExpired: true, user: { name: "Old" } },
    status: "authenticated", update,
  });
  const view = render(<LoginPage />);
  expect(screen.getByRole("alert").textContent).toContain("انتهت جلستك");
  expect(screen.getByText("Sign in form")).toBeDefined();
  expect(screen.queryByText("Active account")).toBeNull();
  vi.mocked(useSession).mockReturnValue({
    data: { expires: "2099-01-01", sessionGeneration: "new", backendAuthenticated: true, sessionExpired: false, user: { name: "New" } },
    status: "authenticated", update,
  });
  view.rerender(<LoginPage />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("أنت مسجل الدخول بالفعل.")).toBeDefined();
});

it("keeps the session card visible during a transient authentication outage", () => {
  vi.mocked(useSession).mockReturnValue({ data: { expires: "2099-01-01", sessionUnavailable: true, backendAuthenticated: false, sessionExpired: false, user: { name: "A" } }, status: "authenticated", update: vi.fn() });
  render(<LoginPage />);
  expect(screen.getByText("أنت مسجل الدخول بالفعل.")).toBeDefined();
  expect(screen.queryByText("Sign in form")).toBeNull();
});
