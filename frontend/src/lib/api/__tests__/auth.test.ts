import { expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
import { authOptions } from "@/lib/auth";
import { ApiError } from "../client";
import { authApi } from "../auth";
import { createServerApiClient } from "../server";

vi.mock("../auth", () => ({ authApi: { login: vi.fn(), exchangeSocialToken: vi.fn() } }));

type JwtArgs = Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>>[0];
const jwt = (args: Partial<JwtArgs>) => authOptions.callbacks!.jwt!(args as JwtArgs);

it("invalidates only the matching token and requires sign-in", async () => {
  const token = { accessToken: "old", refreshToken: "refresh", name: "A" };
  const expired = await jwt({ token, trigger: "update", session: { invalidateAccessToken: "old" } });
  expect(expired).toMatchObject({ sessionExpired: true, accessToken: undefined, refreshToken: undefined });
  const newer = { accessToken: "new", refreshToken: "new-refresh" };
  expect(await jwt({ token: newer, trigger: "update", session: { invalidateAccessToken: "old" } })).toEqual(newer);
});

it("clears expiry on a successful credentials login", async () => {
  const token = await jwt({ token: { sessionExpired: true }, user: { id: "id", accessToken: "new", refreshToken: "refresh" } });
  expect(token).toMatchObject({ accessToken: "new", sessionExpired: false });
  const session = await authOptions.callbacks!.session!({ session: { expires: "2099-01-01" }, token: token as JWT } as Parameters<NonNullable<NonNullable<typeof authOptions.callbacks>["session"]>>[0]);
  expect(session).toMatchObject({ accessToken: "new", sessionExpired: false });
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
