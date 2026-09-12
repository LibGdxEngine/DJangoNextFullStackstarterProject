import { afterEach, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "../client";
import { trustedClientIdentity } from "../client-identity";
import { createServerApiClient } from "../server";
import { createAuthOptions } from "@/lib/auth";
import { authApi } from "../auth";
import { decodeAuthRetry, encodeAuthRetry, retrySeconds } from "../retry";

vi.mock("@/lib/auth-vault", () => ({
  createVaultSession: vi.fn(async (tokens: { access: string }) => ({ sessionId: tokens.access, sessionGeneration: "generation", sessionExpiresAt: Date.now() + 60000 })),
  revokeVaultSession: vi.fn(), vaultSessionActive: vi.fn(), SESSION_MAX_AGE: 604800,
}));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([429, 503])("retains %s and Retry-After without logging out or replaying POST", async (status) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: status === 429 ? "throttled" : "rate_limit_unavailable", message: "Try later.", fields: {} } }), { status, headers: { "Retry-After": "12" } }));
  vi.stubGlobal("fetch", fetchMock);
  const logout = vi.fn();
  const client = createApiClient({ baseUrl: "https://test.invalid", token: "token", onUnauthorized: logout });
  await expect(client.post("/login/", {})).rejects.toMatchObject({ status, retryAfterSeconds: 12 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(logout).not.toHaveBeenCalled();
});

it("parses only bounded retry values and safe auth error codes", () => {
  expect(retrySeconds("Wed, 09 Sep 2026 12:00:10 GMT", Date.parse("2026-09-09T12:00:00Z"))).toBe(10);
  expect(retrySeconds("99999999")).toBe(86400);
  for (const value of [null, "garbage", "-1", "1.5", "Infinity"]) expect(retrySeconds(value)).toBeUndefined();
  expect(decodeAuthRetry(encodeAuthRetry(429, 12))).toEqual({ status: 429, seconds: 12 });
  expect(encodeAuthRetry(401, 10)).toBeUndefined();
  expect(decodeAuthRetry("MOBSER_RETRY_429_999999")).toBeUndefined();
  expect(decodeAuthRetry("MOBSER_RETRY_429_12&secret=x")).toBeUndefined();
});

it("ignores forged identity in direct dev and rejects it in protected mode", () => {
  vi.stubEnv("RATE_LIMIT_PROXY_TOKEN", "a".repeat(48));
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "false");
  expect(trustedClientIdentity(new Headers({ "x-mobser-client-ip": "203.0.113.1", "x-mobser-proxy-token": "forged" }))).toBeUndefined();
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "true");
  expect(() => trustedClientIdentity(new Headers())).toThrow(ApiError);
  expect(() => trustedClientIdentity(new Headers({ "x-mobser-client-ip": "203.0.113.1, 198.51.100.1", "x-mobser-proxy-token": "a".repeat(48) }))).toThrow(ApiError);
});

it("keeps verified identities isolated across concurrent server requests", async () => {
  vi.stubEnv("RATE_LIMIT_PROXY_TOKEN", "a".repeat(48));
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "true");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    fetchMock(...args);
    return Promise.resolve(new Response("{}"));
  });
  await Promise.all(["203.0.113.1", "2001:db8::2"].map((ip) => {
    const identity = trustedClientIdentity(new Headers({ "x-mobser-client-ip": ip, "x-mobser-proxy-token": "a".repeat(48) }));
    return createServerApiClient(undefined, identity).post("/login/", {}, { auth: false });
  }));
  const ips = fetchMock.mock.calls.map((call) => new Headers(call[1].headers).get("x-mobser-client-ip"));
  expect(ips.sort()).toEqual(["2001:db8::2", "203.0.113.1"]);
});

it("rejects OAuth quota failures before minting a session and uses a safe redirect", async () => {
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "false");
  vi.spyOn(authApi, "exchangeSocialToken").mockRejectedValue(new ApiError("contains private detail", 429, "throttled", {}, undefined, 30));
  const options = createAuthOptions(new Headers());
  const signIn = options.callbacks!.signIn!;
  type Args = Parameters<typeof signIn>[0];
  expect(await signIn({ account: { provider: "google", id_token: "private" } } as Args)).toBe("/login?error=MOBSER_RETRY_429_30");
  type JwtArgs = Parameters<NonNullable<typeof options.callbacks>["jwt"] & object>[0];
  await expect(options.callbacks!.jwt!({ token: {}, account: { provider: "google", id_token: "private" } } as JwtArgs)).rejects.toThrow("not completed");
});

it("keeps OAuth results isolated when requests complete in the opposite order", async () => {
  vi.stubEnv("RATE_LIMIT_PROXY_TOKEN", "a".repeat(48));
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "true");
  type Result = Awaited<ReturnType<typeof authApi.exchangeSocialToken>>;
  let finishFirst!: (result: Result) => void;
  const exchange = vi.spyOn(authApi, "exchangeSocialToken")
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
    .mockResolvedValueOnce({ access: "second", refresh: "r2", user: { email: "second@example.com" } } as Result);
  const first = createAuthOptions(new Headers({ "x-mobser-client-ip": "203.0.113.1", "x-mobser-proxy-token": "a".repeat(48) }));
  const second = createAuthOptions(new Headers({ "x-mobser-client-ip": "203.0.113.2", "x-mobser-proxy-token": "a".repeat(48) }));
  type SignInArgs = Parameters<NonNullable<NonNullable<typeof first.callbacks>["signIn"]>>[0];
  type JwtArgs = Parameters<NonNullable<NonNullable<typeof first.callbacks>["jwt"]>>[0];
  const account = { provider: "google", id_token: "verified-by-backend" };
  const pending = first.callbacks!.signIn!({ account } as SignInArgs);
  expect(await second.callbacks!.signIn!({ account } as SignInArgs)).toBe(true);
  finishFirst({ access: "first", refresh: "r1", user: { email: "first@example.com" } } as Result);
  expect(await pending).toBe(true);
  expect(await first.callbacks!.jwt!({ account, token: {} } as JwtArgs)).toMatchObject({ sessionId: "first" });
  expect(await second.callbacks!.jwt!({ account, token: {} } as JwtArgs)).toMatchObject({ sessionId: "second" });
  expect(exchange.mock.calls.map((call) => call[2]?.ip)).toEqual(["203.0.113.1", "203.0.113.2"]);
});
