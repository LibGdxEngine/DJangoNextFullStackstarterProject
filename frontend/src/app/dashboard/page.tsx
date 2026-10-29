import type { Metadata } from "next";
import { ChatHome } from "@/features/wasel/dashboard/ChatHome";

export const metadata: Metadata = { title: "طلب جديد" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string | string[]; role?: string | string[] }>;
}) {
  const params = await searchParams;
  const task = typeof params.task === "string" ? params.task : "";
  const role = typeof params.role === "string" ? params.role : "";
  return <ChatHome key={`${task}|${role}`} initialTask={task} initialRole={role} />;
}
