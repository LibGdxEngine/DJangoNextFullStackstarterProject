import { beforeEach, expect, it, vi } from "vitest";
import { getSession } from "next-auth/react";

vi.mock("next-auth/react", () => ({ getSession: vi.fn() }));
const mockSession = vi.mocked(getSession);
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  vi.resetModules();
  mockSession.mockReset();
  mockFetch.mockReset();
});

it("deduplicates concurrent protected 401s for the same session", async () => {
  const { apiClient, registerSessionExpiry } = await import("../browser");
  mockSession.mockResolvedValue({ accessToken: "old", expires: "2099-01-01" });
  mockFetch.mockImplementation(async () => new Response("{}", { status: 401 }));
  const expire = vi.fn().mockResolvedValue(undefined);
  registerSessionExpiry(expire);
  const results = await Promise.allSettled([apiClient.get("private/"), apiClient.get("private/")]);
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(expire).toHaveBeenCalledExactlyOnceWith("old");
  await expect(apiClient.get("private/")).rejects.toMatchObject({ status: 401 });
  expect(expire).toHaveBeenCalledTimes(1);
});

it("ignores a delayed failure from an older session", async () => {
  const { apiClient, registerSessionExpiry } = await import("../browser");
  mockSession.mockResolvedValueOnce({ accessToken: "old", expires: "2099-01-01" });
  mockSession.mockResolvedValue({ accessToken: "new", expires: "2099-01-01" });
  mockFetch.mockResolvedValue(new Response("{}", { status: 401 }));
  const expire = vi.fn();
  registerSessionExpiry(expire);
  await expect(apiClient.get("private/")).rejects.toMatchObject({ status: 401 });
  expect(expire).not.toHaveBeenCalled();
});

it("does not read credentials or invalidate sessions for public requests", async () => {
  const { apiClient, registerSessionExpiry } = await import("../browser");
  const expire = vi.fn();
  registerSessionExpiry(expire);
  mockFetch.mockResolvedValue(new Response("{}", { status: 401 }));
  await expect(apiClient.get("public/", { auth: false })).rejects.toMatchObject({ status: 401 });
  expect(expire).not.toHaveBeenCalled();
  expect(mockSession).not.toHaveBeenCalled();
});
