import type { Metadata } from "next";
import { ChatHome } from "@/features/wasel/dashboard/ChatHome";

export const metadata: Metadata = { title: "طلب جديد" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const { task } = await searchParams;
  return <ChatHome key={typeof task === "string" ? task : ""} initialTask={typeof task === "string" ? task : ""} />;
}
