import type { NextRequest } from "next/server";
import { handleBff } from "@/lib/bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleBff(request, (await context.params).path);
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE, handler as PUT };
