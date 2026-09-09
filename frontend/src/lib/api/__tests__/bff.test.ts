import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { handleBff } from "@/lib/bff";
import { backendAccessToken, createVaultSession, revokeVaultSession } from "@/lib/auth-vault";
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/lib/auth-vault", () => ({ backendAccessToken: vi.fn(), createVaultSession: vi.fn(), revokeVaultSession: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_URL", "https://mobser.test");
  vi.stubEnv("BACKEND_API_URL", "http://django/api");
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "false");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response("{}"));
  vi.mocked(getToken).mockResolvedValue({ sessionId: "private", sessionExpiresAt: Date.now() + 600000 });
  vi.mocked(backendAccessToken).mockResolvedValue("server-secret");
});
const request = (method = "GET", headers?: HeadersInit, body?: string) => new NextRequest("https://mobser.test/api/bff/v1/auth/me", { method, headers, body });
it("enforces exact paths and method allowlists before dispatch", async () => {
  for (const path of [["v1", "auth", "token", "refresh"], [".."], ["constructor"], ["https:", "evil"]]) {
    expect((await handleBff(request(), path)).status).toBe(404);
  }
  expect((await handleBff(request("PUT"), ["v1", "auth", "me"])).status).toBe(405);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects cross-origin or missing CSRF proof without accessing credentials", async () => {
  for (const headers of [{ origin: "https://evil.test", "x-mobser-csrf": "1" }, { origin: "https://mobser.test" }]) {
    expect((await handleBff(request("PATCH", headers as HeadersInit, "{}"), ["v1", "auth", "me"])).status).toBe(403);
  }
  expect(backendAccessToken).not.toHaveBeenCalled();
});
it("uses only server bearer credentials and does not forward browser headers", async () => {
  const response = await handleBff(request("GET", { authorization: "Bearer attacker", cookie: "private-cookie", "x-forwarded-for": "forged" }), ["v1", "auth", "me"]);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const outgoing = new Headers(fetchMock.mock.calls[0][1]?.headers);
  expect(outgoing.get("authorization")).toBe("Bearer server-secret");
  expect(outgoing.get("cookie")).toBeNull();
  expect(outgoing.get("x-forwarded-for")).toBeNull();
  expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
});
it("revokes a protected 401 without retrying a mutation", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
  const response = await handleBff(request("PATCH", { origin: "https://mobser.test", "x-mobser-csrf": "1", "content-type": "application/json" }, "{}"), ["v1", "auth", "me"]);
  expect(response.status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(revokeVaultSession).toHaveBeenCalledWith("private");
});
it("strips and revokes verification tokens before returning safe metadata", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ access: "new-access", refresh: "new-refresh", message: "Verified", user: { id: "1" } })));
  vi.mocked(createVaultSession).mockResolvedValue({ sessionId: "11111111-1111-1111-1111-111111111111", sessionGeneration: "22222222-2222-2222-2222-222222222222", sessionExpiresAt: 0 });
  const response = await handleBff(request("POST", { origin: "https://mobser.test", "x-mobser-csrf": "1", "content-type": "application/json" }, "{}"), ["v1", "auth", "verification", "confirm"]);
  expect(await response.json()).toEqual({ message: "Verified", user: { id: "1" } });
  expect(revokeVaultSession).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
});
it("rejects oversized bodies", async () => {
  const response = await handleBff(request("POST", { origin: "https://mobser.test", "x-mobser-csrf": "1", "content-type": "application/json" }, "a".repeat(65537)), ["v1", "auth", "signup"]);
  expect(response.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});
