"use client";

import { usePathname } from "next/navigation";
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
  const showConversationList =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/conversations");

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
