import "server-only";

import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { backendAccessToken, createVaultSession, revokeVaultSession } from "@/lib/auth-vault";
import { trustedClientIdentity } from "@/lib/api/client-identity";
import { createServerApiClient } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";

// Exact routes prevent arbitrary proxying and keep token-issuing endpoints private.
const routes: Record<string, { methods: string[]; public?: boolean }> = {
  "hello": { methods: ["GET"], public: true },
  "status": { methods: ["GET"], public: true },
  "v1/auth/social/providers": { methods: ["GET"], public: true },
  "v1/auth/signup": { methods: ["POST"], public: true },
  "v1/auth/verification/resend": { methods: ["POST"], public: true },
  "v1/auth/verification/confirm": { methods: ["POST"], public: true },
  "v1/auth/password/forgot": { methods: ["POST"], public: true },
  "v1/auth/password/reset/verify": { methods: ["POST"], public: true },
  "v1/auth/password/reset": { methods: ["POST"], public: true },
  "v1/auth/password/change": { methods: ["POST"] },
  "v1/auth/phone/change": { methods: ["POST"] },
  "v1/auth/phone/change/confirm": { methods: ["POST"] },
  "v1/auth/email/change": { methods: ["POST"] },
  "v1/auth/me": { methods: ["GET", "PATCH", "DELETE"] },
};
function json(body: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Cookie");
  return body === undefined ? new Response(null, { status: 204, headers }) : Response.json(body, { status, headers });
}
function failure(status: number, code: string, message: string) {
  return json({ error: { code, message, fields: {} } }, status);
}
// Defense in depth for verification responses, which may include newly minted JWTs.
function safeResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeResponse);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([name]) =>
      !["access", "refresh", "accessToken", "refreshToken", "access_token", "refresh_token", "id_token"].includes(name))
      .map(([name, item]) => [name, safeResponse(item)]));
  }
  return value;
}

export async function handleBff(request: NextRequest, path: string[]) {
  if (path.some((segment) => !/^[a-z][a-z0-9-]*$/.test(segment))) return failure(404, "not_found", "Unknown endpoint.");
  const endpoint = path.join("/");
  const route = Object.hasOwn(routes, endpoint) ? routes[endpoint] : undefined;
  if (!route) return failure(404, "not_found", "Unknown endpoint.");
  if (!route.methods.includes(request.method)) return failure(405, "method_not_allowed", "Method not allowed.");
  if (!["GET", "HEAD"].includes(request.method)) {
    const trustedOrigin = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : undefined;
    if (!trustedOrigin || request.headers.get("origin") !== trustedOrigin || request.headers.get("x-mobser-csrf") !== "1") {
      return failure(403, "csrf_failed", "Invalid request origin.");
    }
    if (!request.headers.get("content-type")?.startsWith("application/json")) return failure(415, "invalid_content_type", "JSON is required.");
  }
  try {
    const identity = trustedClientIdentity(request.headers);
    const session = route.public ? null : await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    let access: string | undefined;
    if (!route.public) {
      if (!session?.sessionId || !session.sessionExpiresAt || session.sessionExpiresAt <= Date.now()) return failure(401, "session_expired", "Please sign in again.");
      access = await backendAccessToken(session.sessionId);
      if (!access) return failure(401, "session_expired", "Please sign in again.");
    }
    let body: unknown;
    if (!["GET", "HEAD"].includes(request.method)) {
      if (Number(request.headers.get("content-length")) > 65536) return failure(413, "body_too_large", "Request body is too large.");
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            return failure(413, "body_too_large", "Request body is too large.");
          }
          chunks.push(chunk.value);
        }
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : undefined; }
      catch { return failure(400, "invalid_json", "Invalid JSON."); }
    }
    const client = createServerApiClient(access, identity);
    const query: Record<string, string> = {};
    new URL(request.url).searchParams.forEach((value, key) => { query[key] = value; });
    try {
      const url = `/${endpoint}/`;
      let result: unknown;
      switch (request.method) {
        case "GET": result = await client.get(url, { query }); break;
        case "POST": result = await client.post(url, body); break;
        case "PATCH": result = await client.patch(url, body); break;
        case "DELETE": result = await client.delete(url, body); break;
      }
      if (endpoint === "v1/auth/verification/confirm" && result && typeof result === "object"
        && "access" in result && typeof result.access === "string" && "refresh" in result && typeof result.refresh === "string") {
        const discarded = await createVaultSession({ access: result.access, refresh: result.refresh }, identity);
        await revokeVaultSession(discarded.sessionId);
      }
      return json(safeResponse(result));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && session?.sessionId) await revokeVaultSession(session.sessionId);
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: { code: error.code, message: error.message, fields: error.fields, context: safeResponse(error.context) } }, error.status || 503,
        error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined);
    }
    return failure(503, "authentication_unavailable", "Authentication is temporarily unavailable.");
  }
}
