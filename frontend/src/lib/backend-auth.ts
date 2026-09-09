import type { TokenUser } from "@/lib/api/auth";

export function formatUserName(user: TokenUser | undefined, fallback: string): string {
  const fullName = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
  return fullName || user?.email || fallback;
}
