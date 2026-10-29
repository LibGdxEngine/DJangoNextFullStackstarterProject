import { redirect } from "next/navigation";
import { readSessionToken } from "@/lib/session-cookie";
import { DashboardShell } from "@/features/wasel/dashboard/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Not getServerSession: see readSessionToken. Expired access tokens are refreshed by the
  // client's /api/auth/session calls, which can save the rotated cookie.
  const token = await readSessionToken();
  if (!token || token.sessionExpired || !token.refreshToken) redirect("/login");

  const name = token.username || token.name || token.email || "";
  return <DashboardShell user={{ name }}>{children}</DashboardShell>;
}
