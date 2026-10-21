"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Rail } from "./Rail";
import { ConversationListSidebar } from "./ConversationListSidebar";
import { WorkspaceProvider } from "./workspace";

export function DashboardShell({
  user,
  children,
}: {
  user: { name: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const showConversationList =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/conversations");

  // The refresh token was rejected (signed out elsewhere, or older than 7 days).
  useEffect(() => {
    if (session?.sessionExpired) router.replace("/login");
  }, [session?.sessionExpired, router]);

  return (
    <WorkspaceProvider>
      <div className="flex min-h-screen bg-paper">
        <Rail user={user} />
        {showConversationList ? <ConversationListSidebar /> : null}
        <main className="min-w-0 flex-1 pb-20">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
