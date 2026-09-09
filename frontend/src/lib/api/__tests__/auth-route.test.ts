import { afterEach, expect, it, vi } from "vitest";
import NextAuth, { type NextAuthOptions } from "next-auth";
import { revokeVaultSession } from "@/lib/auth-vault";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/auth/[...nextauth]/route";

vi.mock("@/lib/auth-vault", () => ({ revokeVaultSession: vi.fn(), SESSION_MAX_AGE: 604800 }));
vi.mock("next-auth", () => ({ default: vi.fn().mockResolvedValue(new Response("{}")) }));
afterEach(() => vi.unstubAllEnvs());

it("returns the NextAuth data.url contract on missing-provenance credentials requests", async () => {
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "true");
  const response = await POST(new NextRequest("http://localhost/api/auth/callback/credentials", { method: "POST" }), { params: Promise.resolve({ nextauth: ["callback", "credentials"] }) });
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("5");
  expect(new URL((await response.json()).url).searchParams.get("error")).toBe("MOBSER_RETRY_503_5");
  expect(NextAuth).not.toHaveBeenCalled();
});

it("redirects invalid OAuth ingress before provider exchange without blocking session reads", async () => {
  vi.stubEnv("RATE_LIMIT_TRUST_PROXY", "true");
  const response = await GET(new NextRequest("http://localhost/api/auth/callback/google"), { params: Promise.resolve({ nextauth: ["callback", "google"] }) });
  expect(response.status).toBe(303);
  expect(new URL(response.headers.get("Location")!).searchParams.get("error")).toBe("MOBSER_RETRY_503_5");
  expect(NextAuth).not.toHaveBeenCalled();
  await GET(new NextRequest("http://localhost/api/auth/session"), { params: Promise.resolve({ nextauth: ["session"] }) });
  expect(NextAuth).toHaveBeenCalledTimes(1);
});

it("does not clear the cookie when NextAuth swallows a failed durable signout", async () => {
  vi.mocked(revokeVaultSession).mockRejectedValue(new Error("Redis offline"));
  vi.mocked(NextAuth).mockImplementation(async (...args: unknown[]) => {
    const options = args[2] as NextAuthOptions;
    try { await options.events!.signOut!({ token: { sessionId: "vault-id" }, session: { expires: "2099-01-01" } }); } catch { /* NextAuth swallows event errors. */ }
    return new Response("{}", { headers: { "Set-Cookie": "next-auth.session-token=; Max-Age=0" } });
  });
  const response = await POST(new NextRequest("http://localhost/api/auth/signout", { method: "POST" }), { params: Promise.resolve({ nextauth: ["signout"] }) });
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
});
