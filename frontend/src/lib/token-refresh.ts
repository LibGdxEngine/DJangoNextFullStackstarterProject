import "server-only";

import type { JWT } from "next-auth/jwt";
import { authApi } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";

/** Refresh this long before the access token actually expires. */
const EXPIRY_SKEW_MS = 60_000;
/** How long a rotation result is replayed to requests still carrying the old refresh token. */
const RESULT_TTL_MS = 60_000;

type TokenPair = Awaited<ReturnType<typeof authApi.refresh>>;

// The backend revokes the whole session when a rotated refresh token is presented twice,
// and every getSession() call runs the jwt callback. Concurrent requests that hold the same
// refresh token must therefore share one rotation, and late arrivals reuse its result.
const rotations = new Map<string, { result: Promise<TokenPair>; expiresAt: number }>();

export function accessTokenExpiry(accessToken: string | undefined): number | undefined {
  const payload = accessToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export function needsRefresh(token: JWT, now = Date.now()): boolean {
  if (!token.accessToken || !token.refreshToken || token.sessionExpired) return false;
  const expiry = accessTokenExpiry(token.accessToken);
  return expiry !== undefined && expiry - EXPIRY_SKEW_MS <= now;
}

function rotate(refreshToken: string): Promise<TokenPair> {
  const now = Date.now();
  for (const [key, entry] of rotations) {
    if (entry.expiresAt <= now) rotations.delete(key);
  }
  const existing = rotations.get(refreshToken);
  if (existing) return existing.result;

  const result = authApi.refresh({ refresh: refreshToken });
  rotations.set(refreshToken, { result, expiresAt: now + RESULT_TTL_MS });
  // A transport failure may succeed later; only keep successful or definitive results.
  result.catch((error) => {
    if (!(error instanceof ApiError) || error.status === 0) rotations.delete(refreshToken);
  });
  return result;
}

/**
 * Returns the token with a fresh access/refresh pair, or marked expired when the backend
 * rejects the refresh token. Network failures leave the token unchanged.
 */
export async function refreshAccessToken(token: JWT): Promise<JWT> {
  if (!token.refreshToken) return { ...token, accessToken: undefined, sessionExpired: true };
  try {
    const pair = await rotate(token.refreshToken);
    return { ...token, accessToken: pair.access, refreshToken: pair.refresh, sessionExpired: false };
  } catch (error) {
    if (error instanceof ApiError && error.status > 0) {
      return { ...token, accessToken: undefined, refreshToken: undefined, sessionExpired: true };
    }
    return token;
  }
}

export function resetRotationsForTests() {
  rotations.clear();
}
