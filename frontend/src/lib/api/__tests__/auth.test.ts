import { expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { ApiError } from "../client";
import { authApi } from "../auth";
import { createServerApiClient } from "../server";

vi.mock("../auth", () => ({ authApi: { login: vi.fn(), exchangeSocialToken: vi.fn() } }));

type JwtArgs = Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>>[0];
const jwt = (args: Partial<JwtArgs>) => authOptions.callbacks!.jwt!(args as JwtArgs);

vi.mock("@/lib/auth-vault", () => ({
  createVaultSession: vi.fn().mockResolvedValue({ sessionId: "private-vault-id", sessionGeneration: "public-marker", sessionExpiresAt: 4099680000000 }),
  vaultSessionActive: vi.fn().mockResolvedValue(true), revokeVaultSession: vi.fn(), SESSION_MAX_AGE: 604800,
}));

it("removes legacy credentials from cookies and ignores browser update injection", async () => {
  const token = await jwt({ token: { accessToken: "secret-access", refreshToken: "secret-refresh", sessionId: "private-vault-id", sessionExpiresAt: 4099680000000 }, trigger: "update", session: { sessionId: "attacker", accessToken: "injected" } });
  expect(token).toMatchObject({ sessionId: "private-vault-id" });
  expect(token).not.toHaveProperty("accessToken");
  expect(token).not.toHaveProperty("refreshToken");
});

it("exposes only safe browser metadata and reflects server revocation", async () => {
  const { vaultSessionActive } = await import("@/lib/auth-vault");
  vi.mocked(vaultSessionActive).mockResolvedValue(true);
  const token = await jwt({ token: {}, user: { id: "id", name: "A", sessionId: "private-vault-id", sessionGeneration: "public-marker", sessionExpiresAt: 4099680000000 } });
  const args = { session: { expires: "2099-01-01", accessToken: "legacy" }, token: token as JWT } as unknown as Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>["session"]>>[0];
  const session = await authOptions.callbacks!.session!(args);
  expect(session).toMatchObject({ backendAuthenticated: true, sessionGeneration: "public-marker", sessionExpired: false });
  expect(JSON.stringify(session)).not.toMatch(/private-vault-id|accessToken|refreshToken/);
  vi.mocked(vaultSessionActive).mockResolvedValueOnce(false);
  expect(await authOptions.callbacks!.session!(args)).toMatchObject({ backendAuthenticated: false, sessionExpired: true });
  vi.mocked(vaultSessionActive).mockRejectedValueOnce(new Error("Redis offline"));
  expect(await authOptions.callbacks!.session!(args)).toMatchObject({ backendAuthenticated: false });
});

it("retains verification-required behavior at the NextAuth boundary", async () => {
  vi.mocked(authApi.login).mockRejectedValue(new ApiError("Verify phone.", 403, "PHONE_VERIFICATION_REQUIRED"));
  const provider = authOptions.providers[0];
  // CredentialsProvider stores its configured callback in options until NextAuth normalizes it.
  const authorize = (provider.options as { authorize: (credentials: { identifier: string; password: string }) => Promise<unknown> }).authorize;
  await expect(authorize({ identifier: "test@example.com", password: "secret" })).rejects.toThrow("PHONE_VERIFICATION_REQUIRED");
});

it("keeps server credentials request-scoped and handles a relative public URL", async () => {
  vi.stubEnv("BACKEND_API_URL", "");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "/api");
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  await createServerApiClient("first").get("/hello/");
  await createServerApiClient("second").get("/hello/");
  expect(fetchMock.mock.calls[0][0]).toBe("http://localhost/api/hello/");
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer first");
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer second");
  vi.unstubAllEnvs();
});
