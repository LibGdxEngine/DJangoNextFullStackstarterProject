// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { getSession, useSession } from "next-auth/react";
import SessionProvider from "@/components/SessionProvider";
import { apiClient } from "../browser";

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
  useSession: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));
afterEach(cleanup);

it.each([null, undefined])("retries expiry on a later 401 when update returns %s", async (failedUpdate) => {
  const token = `failed-${String(failedUpdate)}`;
  const current = { expires: "2099-01-01", sessionGeneration: token };
  vi.mocked(getSession).mockResolvedValue(current);
  const update = vi.fn().mockResolvedValueOnce(failedUpdate)
    .mockResolvedValue({ expires: "2099-01-01", sessionExpired: true });
  vi.mocked(useSession).mockReturnValue({ data: current, status: "authenticated", update });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("{}", { status: 401 })));
  render(<SessionProvider><div>Child</div></SessionProvider>);
  await expect(apiClient.get("private/")).rejects.toMatchObject({ status: 401 });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await expect(apiClient.get("private/")).rejects.toMatchObject({ status: 401 });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  await expect(apiClient.get("private/")).rejects.toMatchObject({ status: 401 });
  expect(update).toHaveBeenCalledTimes(2);
});
