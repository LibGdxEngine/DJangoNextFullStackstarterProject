import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "redis";
import { backendAccessToken, createVaultSession, revokeVaultSession, retryPendingRevocations, vaultSessionActive } from "@/lib/auth-vault";

const post = vi.hoisted(() => vi.fn());
vi.mock("../server", () => ({ createServerApiClient: () => ({ post }) }));
const url = process.env.AUTH_VAULT_TEST_REDIS_URL;
const ids: string[] = [];
const client = createClient({ url });
const token = (seconds: number, label = "token") => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds, label })).toString("base64url")}.signature`;
async function session(accessSeconds = 10) {
  const result = await createVaultSession({ access: token(accessSeconds), refresh: token(3600, "refresh") });
  ids.push(result.sessionId);
  return result;
}
describe.skipIf(!url)("Redis credential vault", () => {
  beforeAll(async () => {
    vi.stubEnv("AUTH_SESSION_REDIS_URL", url!);
    vi.stubEnv("NEXTAUTH_SECRET", "vault-test-secret");
    await client.connect();
  });
  beforeEach(() => { post.mockReset(); });
  afterAll(async () => {
    for (const id of ids) {
      await client.del([`mobser:auth:session:${id}`, `mobser:auth:revoked:${id}`, `mobser:auth:lock:${id}`]);
      await client.zRem("mobser:auth:revocations", id);
    }
    await client.quit();
    vi.unstubAllEnvs();
  });
  it("encrypts credentials, binds ciphertext to its ID, and preserves absolute expiry", async () => {
    const first = await session(300);
    const second = await session(300);
    const raw = await client.get(`mobser:auth:session:${first.sessionId}`);
    expect(raw).not.toContain("refresh");
    expect(first.sessionExpiresAt).toBeLessThanOrEqual(Date.now() + 3600000);
    await client.set(`mobser:auth:session:${second.sessionId}`, raw!);
    await expect(vaultSessionActive(second.sessionId)).rejects.toThrow();
  });
  it("serializes concurrent refresh calls and writes the rotated pair once", async () => {
    const current = await session();
    const access = token(600, "new-access");
    post.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { access, refresh: token(7200, "new-refresh") };
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => backendAccessToken(current.sessionId)));
    expect(results).toEqual(Array(6).fill(access));
    expect(post).toHaveBeenCalledTimes(1);
    expect(await client.pTTL(`mobser:auth:session:${current.sessionId}`)).toBeLessThanOrEqual(current.sessionExpiresAt - Date.now() + 10);
  });
  it("does not resurrect a session when logout races a refresh", async () => {
    const current = await session();
    let finish!: (value: unknown) => void;
    post.mockImplementation((path: string) => path.includes("refresh") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({}));
    const refresh = backendAccessToken(current.sessionId);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await revokeVaultSession(current.sessionId);
    finish({ access: token(600), refresh: token(3600) });
    expect(await refresh).toBeUndefined();
    expect(await vaultSessionActive(current.sessionId)).toBe(false);
  });
  it("fails closed on lease loss and preserves a replacement owner's lock", async () => {
    const current = await session();
    let finish!: (value: unknown) => void;
    post.mockImplementation((path: string) => path.includes("refresh") ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve({}));
    const refresh = backendAccessToken(current.sessionId);
    await vi.waitFor(() => expect(finish).toBeDefined());
    await client.set(`mobser:auth:lock:${current.sessionId}`, "replacement-owner", { PX: 15000 });
    finish({ access: token(600), refresh: token(3600) });
    expect(await refresh).toBeUndefined();
    expect(await vaultSessionActive(current.sessionId)).toBe(false);
    expect(await client.get(`mobser:auth:lock:${current.sessionId}`)).toBe("replacement-owner");
  });
  it("fails closed after ambiguous refresh and retains a durable revocation retry", async () => {
    const current = await session();
    post.mockRejectedValue(new Error("timeout after upstream consumed refresh"));
    expect(await backendAccessToken(current.sessionId)).toBeUndefined();
    expect(await vaultSessionActive(current.sessionId)).toBe(false);
    expect(await client.exists(`mobser:auth:revoked:${current.sessionId}`)).toBe(1);
    expect(await backendAccessToken(current.sessionId)).toBeUndefined();
    expect(post.mock.calls.filter(([path]) => path.includes("refresh"))).toHaveLength(1);
    post.mockResolvedValue({});
    await client.zAdd("mobser:auth:revocations", { score: 0, value: current.sessionId });
    await retryPendingRevocations();
    expect(await client.exists(`mobser:auth:revoked:${current.sessionId}`)).toBe(0);
  });
  it("rejects expired sessions without refreshing", async () => {
    const current = await session();
    await client.pExpire(`mobser:auth:session:${current.sessionId}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await backendAccessToken(current.sessionId)).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});
