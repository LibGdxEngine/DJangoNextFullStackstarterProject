import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { DashboardShell } from "@/features/wasel/dashboard/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session || session.sessionExpired) redirect("/login");

  const name = session.user?.name || session.username || session.email || "";
  return <DashboardShell user={{ name }}>{children}</DashboardShell>;
}
