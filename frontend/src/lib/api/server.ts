import "server-only";

import { createApiClient } from "./client";
import { headers } from "next/headers";
import { context, propagation } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { currentRequestId, validRequestId } from "@/lib/telemetry/context";

export function createServerApiClient(token?: string) {
  const publicUrl = process.env.NEXT_PUBLIC_API_URL;
  return createApiClient({
    baseUrl: process.env.BACKEND_API_URL || (publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl : "http://localhost/api"),
    token,
    async getHeaders() {
      const outgoing: Record<string, string> = {};
      propagation.inject(context.active(), outgoing);
      let incomingId: string | undefined;
      try {
        incomingId = validRequestId((await headers()).get("x-request-id"));
      } catch {
        // Background server calls have no Next.js request context.
      }
      outgoing["x-request-id"] = incomingId ?? currentRequestId() ?? randomUUID();
      return outgoing;
    },
  });
}
