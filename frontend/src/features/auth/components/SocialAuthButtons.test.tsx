// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SocialAuthButtons } from "./SocialAuthButtons";
import { getProviders } from "next-auth/react";

vi.mock("next-auth/react", () => ({ getProviders: vi.fn().mockResolvedValue({ google: {} }), signIn: vi.fn() }));
afterEach(cleanup);

it("consumes retry redirects once without dropping other query parameters or hashes", async () => {
  vi.mocked(getProviders).mockResolvedValue({ google: { id: "google", name: "Google", type: "oauth", signinUrl: "/signin", callbackUrl: "/callback" } } as Awaited<ReturnType<typeof getProviders>>);
  window.history.replaceState(null, "", "/?keep=yes&error=MOBSER_RETRY_429_30#form");
  const view = render(<SocialAuthButtons />);
  await screen.findByRole("button", { name: "Try again in 30s" });
  expect(window.location.search).toBe("?keep=yes");
  expect(window.location.hash).toBe("#form");
  view.unmount();
  render(<SocialAuthButtons />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Continue with Google" }) as HTMLButtonElement).disabled).toBe(false));
});
