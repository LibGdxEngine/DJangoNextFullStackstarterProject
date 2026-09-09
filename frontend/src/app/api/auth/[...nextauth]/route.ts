import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { createAuthOptions } from "@/lib/auth";
import { trustedClientIdentity } from "@/lib/api/client-identity";
import { ApiError } from "@/lib/api/auth";
import { encodeAuthRetry } from "@/lib/api/retry";

async function handler(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await context.params;
  try {
    if (nextauth[0] === "signin" || nextauth[0] === "callback") trustedClientIdentity(request.headers);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // No provider exchange or credentials processing without ingress provenance.
    const url = new URL("/", process.env.NEXTAUTH_URL || request.url);
    url.searchParams.set("error", encodeAuthRetry(503, 5)!);
    if (request.method === "GET") return new Response(null, { status: 303, headers: { Location: url.toString(), "Retry-After": "5" } });
    return Response.json({ url: url.toString() }, { status: 503, headers: { "Retry-After": "5" } });
  }
  let signOutFailed = false;
  const response = await NextAuth(request, context, createAuthOptions(request.headers, () => { signOutFailed = true; }));
  // NextAuth swallows event errors. Retain the cookie until durable denial succeeds.
  if (signOutFailed) return Response.json({ error: "logout_unavailable" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
  return response;
}

export { handler as GET, handler as POST };
