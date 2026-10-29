import { beforeEach, expect, it, vi } from "vitest";
import { authApi } from "../auth";
import { ApiError } from "../client";
import { accessTokenExpiry, needsRefresh, refreshAccessToken, resetRotationsForTests } from "@/lib/token-refresh";

vi.mock("../auth", () => ({ authApi: { refresh: vi.fn() } }));

function jwtExpiringAt(ms: number) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(ms / 1000) })).toString("base64url");
  return `header.${payload}.signature`;
}

beforeEach(() => resetRotationsForTests());

it("reads the access token expiry and refreshes shortly before it", () => {
  const now = Date.now();
  expect(accessTokenExpiry(jwtExpiringAt(now + 600_000))).toBe(Math.floor((now + 600_000) / 1000) * 1000);
  expect(needsRefresh({ accessToken: jwtExpiringAt(now + 600_000), refreshToken: "r" }, now)).toBe(false);
  expect(needsRefresh({ accessToken: jwtExpiringAt(now + 30_000), refreshToken: "r" }, now)).toBe(true);
  expect(needsRefresh({ accessToken: jwtExpiringAt(now - 1), refreshToken: undefined }, now)).toBe(false);
});

it("rotates a refresh token once even for concurrent callers", async () => {
  vi.mocked(authApi.refresh).mockResolvedValue({ access: "new-access", refresh: "new-refresh" });
  const token = { accessToken: "old", refreshToken: "r1" };
  const [a, b] = await Promise.all([refreshAccessToken(token), refreshAccessToken(token)]);
  const late = await refreshAccessToken(token);
  expect(authApi.refresh).toHaveBeenCalledExactlyOnceWith({ refresh: "r1" });
  for (const result of [a, b, late]) {
    expect(result).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh", sessionExpired: false });
  }
});

it("expires the session when the backend rejects the refresh token", async () => {
  vi.mocked(authApi.refresh).mockRejectedValue(new ApiError("Refresh token reuse detected.", 401, "not_authenticated"));
  expect(await refreshAccessToken({ accessToken: "old", refreshToken: "r2" })).toMatchObject({
    accessToken: undefined, refreshToken: undefined, sessionExpired: true,
  });
});

it("keeps the session and retries later when the backend is unreachable", async () => {
  vi.mocked(authApi.refresh)
    .mockRejectedValueOnce(new ApiError("Unable to reach the server.", 0, "network_error"))
    .mockResolvedValue({ access: "a2", refresh: "r4" });
  const token = { accessToken: "old", refreshToken: "r3" };
  expect(await refreshAccessToken(token)).toEqual(token);
  expect(await refreshAccessToken(token)).toMatchObject({ accessToken: "a2", refreshToken: "r4" });
});
