// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useSession } from "next-auth/react";
import SessionProvider from "@/components/SessionProvider";
import Home from "@/app/page";
import { registerSessionExpiry } from "../browser";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../browser", () => ({ registerSessionExpiry: vi.fn().mockReturnValue(() => {}) }));
vi.mock("@/features/system/components/SystemDiagnostics", () => ({ SystemDiagnostics: () => null }));
vi.mock("@/features/overview/components/ArchitectureGuide", () => ({ ArchitectureGuide: () => null }));
vi.mock("@/features/auth/components/LoginForm", () => ({ LoginForm: () => <div>Sign in form</div> }));
vi.mock("@/features/auth/components/UserSessionCard", () => ({ UserSessionCard: () => <div>Active account</div> }));
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

it("shows sign-in after expiry and removes the expiry message after a new login", () => {
  const update = vi.fn();
  vi.mocked(useSession).mockReturnValue({
    data: { expires: "2099-01-01", sessionExpired: true, user: { name: "Old" } },
    status: "authenticated", update,
  });
  const view = render(<Home />);
  expect(screen.getByRole("alert").textContent).toContain("Please sign in again");
  expect(screen.getByText("Sign in form")).toBeDefined();
  expect(screen.queryByText("Active account")).toBeNull();
  vi.mocked(useSession).mockReturnValue({
    data: { expires: "2099-01-01", sessionGeneration: "new", backendAuthenticated: true, sessionExpired: false, user: { name: "New" } },
    status: "authenticated", update,
  });
  view.rerender(<Home />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Active account")).toBeDefined();
});

it("keeps the session card visible during a transient authentication outage", () => {
  vi.mocked(useSession).mockReturnValue({ data: { expires: "2099-01-01", sessionUnavailable: true, backendAuthenticated: false, sessionExpired: false, user: { name: "A" } }, status: "authenticated", update: vi.fn() });
  render(<Home />);
  expect(screen.getByText("Active account")).toBeDefined();
  expect(screen.queryByText("Sign in form")).toBeNull();
});
