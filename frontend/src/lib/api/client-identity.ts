import "server-only";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { ApiError } from "./client";

export interface ClientIdentity {
  readonly ip: string;
  readonly proxyToken: string;
}

export function trustedClientIdentity(incoming: Pick<Headers, "get">): ClientIdentity | undefined {
  const token = process.env.RATE_LIMIT_PROXY_TOKEN ?? "";
  const received = incoming.get("x-mobser-proxy-token") ?? "";
  const ip = incoming.get("x-mobser-client-ip") ?? "";
  const validToken = token.length >= 32 && received.length <= 256
    && Buffer.byteLength(token) === Buffer.byteLength(received)
    && timingSafeEqual(Buffer.from(token), Buffer.from(received));
  if (validToken && isIP(ip)) return Object.freeze({ ip, proxyToken: token });
  const required = process.env.NODE_ENV === "production" || process.env.RATE_LIMIT_TRUST_PROXY === "true";
  if (required) throw new ApiError("Sign-in is temporarily unavailable. Please try again shortly.", 503, "rate_limit_unavailable", {}, undefined, 5);
  // Direct development has no authenticated original IP in App Router. The
  // backend uses a shared peer bucket; never forward untrusted supplied headers.
  return undefined;
}
