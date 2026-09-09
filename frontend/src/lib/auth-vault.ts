import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "redis";
import { createServerApiClient } from "@/lib/api/server";
import type { ClientIdentity } from "@/lib/api/client-identity";
import { logServerEvent } from "@/lib/telemetry/logger";

export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const PREFIX = "mobser:auth:";
const PENDING = `${PREFIX}revocations`;
const LOCK_MS = 15_000;
const REQUEST_MS = 5_000;
interface VaultSession {
  access: string;
  refresh: string;
  accessExpiresAt: number;
  expiresAt: number;
  identity?: ClientIdentity;
  refreshing?: string;
}
let connection: ReturnType<typeof createClient> | undefined;
let connecting: Promise<unknown> | undefined;

async function redis() {
  if (!process.env.AUTH_SESSION_REDIS_URL) throw new Error("AUTH_SESSION_REDIS_URL is required.");
  if (!connection) {
    connection = createClient({ url: process.env.AUTH_SESSION_REDIS_URL, disableOfflineQueue: true, commandOptions: { timeout: 3_000 },
      socket: { connectTimeout: 3_000, reconnectStrategy: false } });
    connection.on("error", () => logServerEvent("ERROR", "auth.vault.unavailable"));
  }
  if (!connection.isOpen) {
    connecting ??= connection.connect().finally(() => { connecting = undefined; });
    await connecting;
  }
  return connection;
}
function key() {
  if (!process.env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is required.");
  return createHash("sha256").update(`mobser-auth-vault:${process.env.NEXTAUTH_SECRET}`).digest();
}
function encrypt(record: VaultSession, id: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(id));
  return Buffer.concat([iv, cipher.update(JSON.stringify(record)), cipher.final(), cipher.getAuthTag()]).toString("base64url");
}
function decrypt(value: string, id: string): VaultSession {
  const raw = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(raw.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString());
}
function expiration(token: string) {
  const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
  if (!Number.isSafeInteger(exp) || exp * 1000 <= Date.now()) throw new Error("Invalid token expiry.");
  return exp * 1000;
}
const sessionKey = (id: string) => `${PREFIX}session:${id}`;
const revokedKey = (id: string) => `${PREFIX}revoked:${id}`;
const lockKey = (id: string) => `${PREFIX}lock:${id}`;

export async function createVaultSession(tokens: { access: string; refresh: string }, identity?: ClientIdentity) {
  const id = randomUUID();
  const expiresAt = Math.min(expiration(tokens.refresh), Date.now() + SESSION_MAX_AGE * 1000);
  const record: VaultSession = { access: tokens.access, refresh: tokens.refresh, accessExpiresAt: expiration(tokens.access), expiresAt, identity };
  await (await redis()).set(sessionKey(id), encrypt(record, id), { PXAT: expiresAt, NX: true });
  return { sessionId: id, sessionGeneration: randomUUID(), sessionExpiresAt: expiresAt };
}
export async function vaultSessionActive(id?: string) {
  if (!id) return false;
  const value = await (await redis()).get(sessionKey(id));
  return !!value && decrypt(value, id).expiresAt > Date.now();
}

async function deliverRevocation(id: string) {
  const client = await redis();
  const value = await client.get(revokedKey(id));
  if (!value) { await client.zRem(PENDING, id); return; }
  const record = decrypt(value, id);
  try {
    await createServerApiClient(undefined, record.identity).post("/v1/auth/logout/", { refresh: record.refresh }, { auth: false, timeoutMs: REQUEST_MS });
    await client.del(revokedKey(id));
    await client.zRem(PENDING, id);
  } catch {
    // The tombstone denies local access and durably retains proof for another attempt.
    logServerEvent("WARN", "auth.remote_revocation.pending");
    await client.zAdd(PENDING, { score: Date.now() + 30_000, value: id });
  }
}
export async function revokeVaultSession(id: string) {
  const client = await redis();
  await client.eval(`
    local value = redis.call('GET', KEYS[1])
    if value then
      local ttl = redis.call('PTTL', KEYS[1])
      redis.call('SET', KEYS[2], value, 'PX', math.max(ttl, 1))
      redis.call('ZADD', KEYS[3], ARGV[1], ARGV[2])
      redis.call('DEL', KEYS[1])
    end
    return 1`, { keys: [sessionKey(id), revokedKey(id), PENDING], arguments: [String(Date.now()), id] });
  await deliverRevocation(id);
}
export async function retryPendingRevocations() {
  const client = await redis();
  const ids = await client.zRangeByScore(PENDING, 0, Date.now(), { LIMIT: { offset: 0, count: 10 } });
  await Promise.all(ids.map(deliverRevocation));
}
let retryTimer: ReturnType<typeof setInterval> | undefined;
export function startRevocationWorker() {
  if (retryTimer) return;
  const retry = () => { void retryPendingRevocations().catch(() => logServerEvent("ERROR", "auth.revocation_worker.failed")); };
  retry();
  retryTimer = setInterval(retry, 30_000);
  retryTimer.unref();
}

export async function backendAccessToken(id: string): Promise<string | undefined> {
  const client = await redis();
  const deadline = Date.now() + LOCK_MS + 1_000;
  while (Date.now() < deadline) {
    const value = await client.get(sessionKey(id));
    if (!value) return undefined;
    const record = decrypt(value, id);
    if (record.expiresAt <= Date.now()) { await revokeVaultSession(id); return undefined; }
    if (!record.refreshing && record.accessExpiresAt > Date.now() + 30_000) return record.access;
    const owner = randomUUID();
    if (!await client.set(lockKey(id), owner, { PX: LOCK_MS, NX: true })) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try {
      // A preceding refresh may have finished between our read and lock acquisition.
      const latest = await client.get(sessionKey(id));
      if (!latest) return undefined;
      const current = decrypt(latest, id);
      if (current.refreshing) { await revokeVaultSession(id); return undefined; }
      if (current.accessExpiresAt > Date.now() + 30_000) return current.access;
      const inFlight = encrypt({ ...current, refreshing: owner }, id);
      const marked = await client.eval(`
        if redis.call('GET', KEYS[1]) == ARGV[1] and redis.call('GET', KEYS[2]) == ARGV[2] then
          redis.call('SET', KEYS[2], ARGV[3], 'KEEPTTL')
          return 1
        end return 0`, { keys: [lockKey(id), sessionKey(id)], arguments: [owner, latest, inFlight] });
      if (marked !== 1) return undefined;
      const tokens = await createServerApiClient(undefined, current.identity).post<{ access: string; refresh: string }>(
        "/v1/auth/token/refresh/", { refresh: current.refresh }, { auth: false, timeoutMs: REQUEST_MS });
      const next = { ...current, access: tokens.access, refresh: tokens.refresh,
        accessExpiresAt: expiration(tokens.access), expiresAt: Math.min(current.expiresAt, expiration(tokens.refresh)) };
      const saved = await client.eval(`
        if redis.call('GET', KEYS[1]) == ARGV[1] and redis.call('GET', KEYS[2]) == ARGV[2] then
          redis.call('SET', KEYS[2], ARGV[3], 'PXAT', ARGV[4])
          return 1
        end
        return 0`, { keys: [lockKey(id), sessionKey(id)], arguments: [owner, inFlight, encrypt(next, id), String(next.expiresAt)] });
      if (saved === 1) return next.access;
      // Losing ownership or racing logout must never restore a session.
      await revokeVaultSession(id);
      return undefined;
    } catch {
      // A timeout may have spent the refresh token. Never retry that credential.
      await revokeVaultSession(id);
      return undefined;
    } finally {
      await client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        { keys: [lockKey(id)], arguments: [owner] });
    }
  }
  throw new Error("Authentication refresh is busy.");
}
