import { beforeEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { readSessionToken } from "@/lib/session-cookie";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  }),
}));

const secret = "test-secret";

beforeEach(() => {
  jar.clear();
  process.env.NEXTAUTH_SECRET = secret;
});

it("decodes the session cookie without running callbacks", async () => {
  jar.set("next-auth.session-token", await encode({ token: { username: "Mona", refreshToken: "r" }, secret }));
  expect(await readSessionToken()).toMatchObject({ username: "Mona", refreshToken: "r" });
});

it("joins a session split across chunked cookies", async () => {
  const value = await encode({ token: { username: "Chunked" }, secret });
  const middle = Math.floor(value.length / 2);
  jar.set("__Secure-next-auth.session-token.1", value.slice(middle));
  jar.set("__Secure-next-auth.session-token.0", value.slice(0, middle));
  expect(await readSessionToken()).toMatchObject({ username: "Chunked" });
});

it("treats a missing or tampered cookie as signed out", async () => {
  expect(await readSessionToken()).toBeNull();
  jar.set("next-auth.session-token", "not-a-jwe");
  expect(await readSessionToken()).toBeNull();
});
